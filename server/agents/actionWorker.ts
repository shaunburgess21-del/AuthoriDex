/**
 * Polling worker: runs every 2 minutes, picks up due scheduled_agent_actions rows,
 * places bets using the same transactional logic as user bets.
 */

import { db } from "../db";
import {
  scheduledAgentActions,
  agentConfigs,
  predictionMarkets,
  marketEntries,
  marketBets,
  profiles,
  creditLedger,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { log } from "../log";
import { generateRationale } from "./rationaleGenerator";
import {
  ACTION_WORKER_BATCH_SIZE,
  ACTION_WORKER_INTERVAL_MS,
  RATIONALE_CONFIDENCE_THRESHOLD,
} from "./constants";
import type { AgentConfigData, MarketWithEntries, PredictionDecision } from "./types";
import { buildAgentActionStakeIdempotencyKey, buildAgentBetMetadata } from "./actionWorker-utils";

const STALE_IN_PROGRESS_TIMEOUT_MINUTES = 30;

async function processDueActions(): Promise<void> {
  const reclaimed = await db.execute(sql`
    UPDATE scheduled_agent_actions
    SET status = 'pending',
        error_message = NULL,
        executed_at = NULL
    WHERE status = 'in_progress'
      AND execute_after <= NOW() - (${STALE_IN_PROGRESS_TIMEOUT_MINUTES} * INTERVAL '1 minute')
    RETURNING id
  `);
  const reclaimedCount = (reclaimed.rows || []).length;
  if (reclaimedCount > 0) {
    log(`[ActionWorker] Reclaimed ${reclaimedCount} stale in_progress actions`);
  }

  const claimedActions = await db.execute(sql`
    WITH claimable AS (
      SELECT id
      FROM scheduled_agent_actions
      WHERE status = 'pending'
        AND execute_after <= NOW()
      ORDER BY execute_after ASC
      LIMIT ${ACTION_WORKER_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE scheduled_agent_actions AS saa
    SET status = 'in_progress'
    FROM claimable
    WHERE saa.id = claimable.id
    RETURNING
      saa.id,
      saa.agent_id AS "agentId",
      saa.market_id AS "marketId",
      saa.entry_id AS "entryId",
      saa.decision_payload AS "decisionPayload",
      saa.stake_amount AS "stakeAmount"
  `);

  const dueActions = claimedActions.rows as Array<{
    id: string;
    agentId: string;
    marketId: string;
    entryId: string;
    decisionPayload: unknown;
    stakeAmount: number;
  }>;

  if (!dueActions.length) return;

  log(`[ActionWorker] Processing ${dueActions.length} due actions`);

  for (const action of dueActions) {
    await executeAction(action);
  }
}

async function executeAction(action: {
  id: string;
  agentId: string;
  marketId: string;
  entryId: string;
  decisionPayload: unknown;
  stakeAmount: number;
}): Promise<void> {
  const decision = action.decisionPayload as PredictionDecision;

  try {
    const [existingBet] = await db
      .select({ id: marketBets.id })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.marketId, action.marketId),
          eq(marketBets.agentId, action.agentId),
          sql`${marketBets.betMetadata} ->> 'actionId' = ${action.id}`
        )
      )
      .limit(1);

    if (existingBet) {
      log(`[ActionWorker] reclaimed_then_already_executed action=${action.id} agent=${action.agentId} market=${action.marketId}`);
      await markExecuted(action.id);
      return;
    }

    // Verify market is still open
    const [market] = await db
      .select({
        id: predictionMarkets.id,
        status: predictionMarkets.status,
        title: predictionMarkets.title,
        marketType: predictionMarkets.marketType,
        category: predictionMarkets.category,
        personId: predictionMarkets.personId,
        endAt: predictionMarkets.endAt,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, action.marketId))
      .limit(1);

    if (!market || market.status !== "OPEN") {
      await db
        .update(scheduledAgentActions)
        .set({
          status: "skipped",
          errorMessage: "Market no longer open",
          executedAt: new Date(),
        })
        .where(eq(scheduledAgentActions.id, action.id));
      return;
    }

    if (market.endAt && market.endAt <= new Date()) {
      await db
        .update(scheduledAgentActions)
        .set({
          status: "skipped",
          errorMessage: "Market past end time",
          executedAt: new Date(),
        })
        .where(eq(scheduledAgentActions.id, action.id));
      return;
    }

    // Get agent info
    const [agent] = await db
      .select()
      .from(agentConfigs)
      .where(eq(agentConfigs.id, action.agentId))
      .limit(1);

    if (!agent) {
      await markFailed(action.id, "Agent config not found");
      return;
    }

    // Verify entry exists
    const [entry] = await db
      .select()
      .from(marketEntries)
      .where(
        and(
          eq(marketEntries.id, action.entryId),
          eq(marketEntries.marketId, action.marketId)
        )
      )
      .limit(1);

    if (!entry) {
      await markFailed(action.id, "Entry not found");
      return;
    }

    // Check agent has enough credits
    const [profile] = await db
      .select({ predictCredits: profiles.predictCredits })
      .from(profiles)
      .where(eq(profiles.id, agent.userId))
      .limit(1);

    if (!profile || profile.predictCredits < action.stakeAmount) {
      await markFailed(action.id, "Insufficient agent credits");
      return;
    }

    // Calculate potential payout (parimutuel)
    const allEntries = await db
      .select({ totalStake: marketEntries.totalStake })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, action.marketId));

    const totalPool =
      allEntries.reduce((sum, e) => sum + e.totalStake, 0) + action.stakeAmount;
    const entryPool = entry.totalStake + action.stakeAmount;
    const entryShare = entryPool / totalPool;
    const potentialPayout = Math.round(
      action.stakeAmount / Math.max(entryShare, 0.01)
    );

    // Optionally generate rationale
    let rationale: string | undefined;
    if (
      decision.confidence &&
      decision.confidence > RATIONALE_CONFIDENCE_THRESHOLD
    ) {
      const entries = await db
        .select({
          id: marketEntries.id,
          label: marketEntries.label,
          totalStake: marketEntries.totalStake,
        })
        .from(marketEntries)
        .where(eq(marketEntries.marketId, action.marketId));

      const marketData: MarketWithEntries = {
        ...market,
        entries,
      };

      const agentData: AgentConfigData = {
        id: agent.id,
        userId: agent.userId,
        displayName: agent.displayName,
        username: agent.username,
        bio: agent.bio ?? "",
        archetype: agent.archetype,
        specialties: agent.specialties ?? [],
        boldness: parseFloat(String(agent.boldness)),
        contrarianism: parseFloat(String(agent.contrarianism)),
        recencyWeight: parseFloat(String(agent.recencyWeight)),
        prestigeBias: parseFloat(String(agent.prestigeBias)),
        confidenceCal: parseFloat(String(agent.confidenceCal)),
        riskAppetite: parseFloat(String(agent.riskAppetite)),
        consensusSensitivity: parseFloat(String(agent.consensusSensitivity)),
        activityRate: parseFloat(String(agent.activityRate)),
        isActive: agent.isActive,
      };

      rationale = await generateRationale(agentData, marketData, decision);
    }

    // Place the bet (same transactional logic as placeMarketBet)
    await db.transaction(async (tx) => {
      const [updatedProfile] = await tx
        .update(profiles)
        .set({
          predictCredits: sql`${profiles.predictCredits} - ${action.stakeAmount}`,
          totalPredictions: sql`${profiles.totalPredictions} + 1`,
        })
        .where(
          and(
            eq(profiles.id, agent.userId),
            sql`${profiles.predictCredits} >= ${action.stakeAmount}`
          )
        )
        .returning({ predictCredits: profiles.predictCredits });

      if (!updatedProfile) {
        throw new Error("Insufficient credits during transaction");
      }

      const [insertedBet] = await tx
        .insert(marketBets)
        .values({
          marketId: action.marketId,
          entryId: action.entryId,
          userId: agent.userId,
          stakeAmount: action.stakeAmount,
          potentialPayout,
          status: "active",
          agentId: agent.id,
          confidence: decision.confidence?.toFixed(2) ?? null,
          betMetadata: buildAgentBetMetadata(action.id, rationale),
        })
        .returning();

      await tx.insert(creditLedger).values({
        userId: agent.userId,
        txnType: "prediction_stake",
        amount: -action.stakeAmount,
        walletType: "VIRTUAL",
        balanceAfter: updatedProfile.predictCredits,
        source: "agent_action",
        idempotencyKey: buildAgentActionStakeIdempotencyKey(action.id),
        metadata: {
          marketId: action.marketId,
          entryId: action.entryId,
          betId: insertedBet.id,
          agentId: agent.id,
          ...buildAgentBetMetadata(action.id),
        },
      });

      await tx
        .update(marketEntries)
        .set({
          totalStake: sql`${marketEntries.totalStake} + ${action.stakeAmount}`,
        })
        .where(eq(marketEntries.id, action.entryId));
    });

    // Mark action as executed
    await markExecuted(action.id);

    log(
      `[ActionWorker] Executed: agent=${agent.displayName} market=${action.marketId} entry=${entry.label} confidence=${decision.confidence} stake=${action.stakeAmount}`
    );
  } catch (err: any) {
    await markFailed(action.id, err?.message ?? String(err));
    console.error(`[ActionWorker] Action ${action.id} failed:`, err);
  }
}

async function markFailed(actionId: string, errorMessage: string) {
  await db
    .update(scheduledAgentActions)
    .set({ status: "failed", errorMessage, executedAt: new Date() })
    .where(eq(scheduledAgentActions.id, actionId));
}

async function markExecuted(actionId: string) {
  await db
    .update(scheduledAgentActions)
    .set({ status: "executed", executedAt: new Date(), errorMessage: null })
    .where(eq(scheduledAgentActions.id, actionId));
}

export function startActionWorkerScheduler(): void {
  log(
    `[ActionWorker] Starting polling worker (every ${ACTION_WORKER_INTERVAL_MS / 1000}s)`
  );
  setInterval(() => {
    processDueActions().catch((err) =>
      console.error("[ActionWorker] Processing failed:", err)
    );
  }, ACTION_WORKER_INTERVAL_MS);
}
