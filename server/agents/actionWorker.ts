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
import {
  ACTION_WORKER_BATCH_SIZE,
  ACTION_WORKER_INTERVAL_MS,
  JACKPOT_AGENT_COLLISION_RANGE,
} from "./constants";
import { JACKPOT_TICKET_COST } from "../config/constants";
import type { PredictionDecision } from "./types";
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
      saa.stake_amount AS "stakeAmount",
      saa.action_type AS "actionType"
  `);

  const dueActions = claimedActions.rows as Array<{
    id: string;
    agentId: string;
    marketId: string;
    entryId: string;
    decisionPayload: unknown;
    stakeAmount: number;
    actionType: string;
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
  actionType: string;
}): Promise<void> {
  const decision = action.decisionPayload as PredictionDecision;

  // Route jackpot bets to their dedicated handler
  if (action.actionType === "jackpot_bet") {
    return executeJackpotAction(action, decision);
  }

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
        visibility: predictionMarkets.visibility,
        title: predictionMarkets.title,
        marketType: predictionMarkets.marketType,
        category: predictionMarkets.category,
        personId: predictionMarkets.personId,
        endAt: predictionMarkets.endAt,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, action.marketId))
      .limit(1);

    if (!market || market.status !== "OPEN" || market.visibility !== "live") {
      await db
        .update(scheduledAgentActions)
        .set({
          status: "skipped",
          errorMessage: "Market no longer live",
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
          betMetadata: buildAgentBetMetadata(action.id),
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
    const [alreadyPlacedBet] = await db
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

    if (alreadyPlacedBet) {
      log(`[ActionWorker] Bet committed but post-commit step failed for action=${action.id}, marking executed`);
      await markExecuted(action.id);
    } else {
      await markFailed(action.id, err?.message ?? String(err));
      console.error(`[ActionWorker] Action ${action.id} failed:`, err);
    }
  }
}

/**
 * Executes a jackpot bet action: re-validates number availability,
 * finds a nearby number if taken, and places the bet via DB transaction.
 */
async function executeJackpotAction(
  action: {
    id: string;
    agentId: string;
    marketId: string;
    entryId: string;
    decisionPayload: unknown;
    stakeAmount: number;
  },
  decision: PredictionDecision,
): Promise<void> {
  try {
    // Idempotency: check if this action already placed a bet
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
      log(`[ActionWorker] Jackpot already executed action=${action.id}`);
      await markExecuted(action.id);
      return;
    }

    // Verify market is still open and within cutoff
    const [market] = await db
      .select({
        id: predictionMarkets.id,
        status: predictionMarkets.status,
        visibility: predictionMarkets.visibility,
        endAt: predictionMarkets.endAt,
        marketType: predictionMarkets.marketType,
      })
      .from(predictionMarkets)
      .where(
        and(
          eq(predictionMarkets.id, action.marketId),
          eq(predictionMarkets.marketType, "jackpot"),
          eq(predictionMarkets.status, "OPEN"),
          eq(predictionMarkets.visibility, "live"),
        )
      )
      .limit(1);

    if (!market) {
      await db.update(scheduledAgentActions)
        .set({ status: "skipped", errorMessage: "Jackpot market no longer live", executedAt: new Date() })
        .where(eq(scheduledAgentActions.id, action.id));
      return;
    }

    if (market.endAt) {
      const cutoff = new Date(market.endAt);
      cutoff.setUTCDate(cutoff.getUTCDate() - 2);
      cutoff.setUTCHours(23, 59, 59, 999);
      if (new Date() > cutoff) {
        await db.update(scheduledAgentActions)
          .set({ status: "skipped", errorMessage: "Jackpot betting cutoff passed", executedAt: new Date() })
          .where(eq(scheduledAgentActions.id, action.id));
        return;
      }
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

    // Credit check
    const [profile] = await db
      .select({ predictCredits: profiles.predictCredits })
      .from(profiles)
      .where(eq(profiles.id, agent.userId))
      .limit(1);

    if (!profile || profile.predictCredits < JACKPOT_TICKET_COST) {
      await markFailed(action.id, "Insufficient agent credits for jackpot");
      return;
    }

    // Re-validate number availability and find nearest open number
    let predictedScore = decision.predictedScore;
    if (!predictedScore || predictedScore <= 0) {
      await markFailed(action.id, "Invalid predictedScore in decision payload");
      return;
    }

    const activeBets = await db
      .select({ betMetadata: marketBets.betMetadata })
      .from(marketBets)
      .where(and(eq(marketBets.marketId, action.marketId), eq(marketBets.status, "active")));

    const takenNumbers = new Set<number>();
    for (const bet of activeBets) {
      const meta = bet.betMetadata as Record<string, unknown> | null;
      const score = Number(meta?.predictedScore);
      if (Number.isFinite(score) && score > 0) takenNumbers.add(Math.round(score));
    }

    if (takenNumbers.has(predictedScore)) {
      let found = false;
      for (let offset = 1; offset <= JACKPOT_AGENT_COLLISION_RANGE; offset++) {
        if (predictedScore + offset <= 2_000_000 && !takenNumbers.has(predictedScore + offset)) {
          predictedScore = predictedScore + offset;
          found = true;
          break;
        }
        if (predictedScore - offset >= 1 && !takenNumbers.has(predictedScore - offset)) {
          predictedScore = predictedScore - offset;
          found = true;
          break;
        }
      }
      if (!found) {
        await db.update(scheduledAgentActions)
          .set({ status: "skipped", errorMessage: `No available number within ±${JACKPOT_AGENT_COLLISION_RANGE} of ${decision.predictedScore}`, executedAt: new Date() })
          .where(eq(scheduledAgentActions.id, action.id));
        return;
      }
    }

    // Place jackpot bet via DB transaction (mirrors user-facing jackpot endpoint)
    await db.transaction(async (tx) => {
      const [updatedProfile] = await tx
        .update(profiles)
        .set({
          predictCredits: sql`${profiles.predictCredits} - ${JACKPOT_TICKET_COST}`,
          totalPredictions: sql`${profiles.totalPredictions} + 1`,
        })
        .where(
          and(
            eq(profiles.id, agent.userId),
            sql`${profiles.predictCredits} >= ${JACKPOT_TICKET_COST}`
          )
        )
        .returning({ predictCredits: profiles.predictCredits });

      if (!updatedProfile) {
        throw new Error("Insufficient credits during jackpot transaction");
      }

      // Double-check inside transaction that number is still free
      const [conflict] = await tx
        .select({ id: marketBets.id })
        .from(marketBets)
        .where(
          and(
            eq(marketBets.marketId, action.marketId),
            eq(marketBets.status, "active"),
            sql`${marketBets.betMetadata}->>'predictedScore' = ${String(predictedScore)}`
          )
        )
        .limit(1);

      if (conflict) {
        throw new Error(`Number ${predictedScore} was claimed during transaction`);
      }

      const [insertedBet] = await tx
        .insert(marketBets)
        .values({
          marketId: action.marketId,
          entryId: action.entryId,
          userId: agent.userId,
          stakeAmount: JACKPOT_TICKET_COST,
          status: "active",
          agentId: agent.id,
          confidence: decision.confidence?.toFixed(2) ?? null,
          betMetadata: { predictedScore, actionId: action.id },
        })
        .returning();

      await tx.insert(creditLedger).values({
        userId: agent.userId,
        txnType: "prediction_stake",
        amount: -JACKPOT_TICKET_COST,
        walletType: "VIRTUAL",
        balanceAfter: updatedProfile.predictCredits,
        source: "agent_action",
        idempotencyKey: buildAgentActionStakeIdempotencyKey(action.id),
        metadata: {
          marketId: action.marketId,
          entryId: action.entryId,
          betId: insertedBet.id,
          agentId: agent.id,
          predictedScore,
        },
      });

      await tx
        .update(marketEntries)
        .set({ totalStake: sql`${marketEntries.totalStake} + ${JACKPOT_TICKET_COST}` })
        .where(eq(marketEntries.id, action.entryId));
    });

    await markExecuted(action.id);
    log(`[ActionWorker] Jackpot executed: agent=${agent.displayName} market=${action.marketId} score=${predictedScore} confidence=${decision.confidence}`);
  } catch (err: any) {
    // Check if the bet was committed despite the error
    const [alreadyPlacedBet] = await db
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

    if (alreadyPlacedBet) {
      log(`[ActionWorker] Jackpot bet committed but post-commit failed for action=${action.id}, marking executed`);
      await markExecuted(action.id);
    } else {
      await markFailed(action.id, err?.message ?? String(err));
      console.error(`[ActionWorker] Jackpot action ${action.id} failed:`, err);
    }
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
