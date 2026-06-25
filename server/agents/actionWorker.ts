/**
 * Polling worker: runs every 2 minutes, picks up due scheduled_agent_actions rows,
 * places bets using the same transactional logic as user bets.
 */

import { db } from "../db";
import {
  scheduledAgentActions,
  agentConfigs,
  predictionMarkets,
  marketAmmState,
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
  BASE_STAKE_AMOUNT,
  MAX_AGENT_STAKE,
  ARB_AGENT_MAX_STAKE,
  ARB_COHORT_ENABLED,
  ARB_EDGE_BAND,
} from "./constants";
import { getSimulationProfile } from "./simulationProfile";
import { JACKPOT_TICKET_COST } from "../config/constants";
import { WORLD_MARKETS_LLM_ENABLED, MIN_SHARES_TO_SELL } from "./constants";
import type { PredictionDecision, SellDecision } from "./types";
import { buildAgentActionStakeIdempotencyKey, buildAgentBetMetadata } from "./actionWorker-utils";
import { getMarketBettingCutoff, getAmmTradingClosedMessage } from "../native-markets/lifecycle";
import { isAgentsPaused } from "./runtime-state";
import { executeBuy, executeSell, type TradeError } from "../services/amm-trades";
import { fireAmmPlacementHooks } from "../services/amm-bet-hooks";
import { upsertEngagement } from "../lib/engagementWriter";
import { gamificationService } from "../services/gamification";
import { checkAndAwardPredictionBadges } from "../services/badges";
import { maybeFireReferralCredit } from "../services/credits-earn";
import { syncProfilePredictionStats } from "../services/profile-prediction-stats";
import { sizeAmmBudget } from "./sizing";
import { type AmmStateSnapshot } from "@shared/lib/amm/positions";

const STALE_IN_PROGRESS_TIMEOUT_MINUTES = 30;

async function processDueActions(): Promise<void> {
  // Global "pause all agents" kill switch (admin Agents tab toggle).
  // Bail out before reclaiming or claiming any pending actions — those
  // stay queued and resume executing the moment the switch flips back on.
  if (await isAgentsPaused()) {
    return;
  }

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
        engine: predictionMarkets.engine,
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

    // Honour the world-markets kill switch even for actions queued BEFORE
    // the switch was flipped. Without this, agents keep executing pending
    // community-market bets for hours after the operator pauses LLM spend.
    if (!WORLD_MARKETS_LLM_ENABLED && market.marketType === "community") {
      await db
        .update(scheduledAgentActions)
        .set({
          status: "skipped",
          errorMessage: "World markets paused (WORLD_MARKETS_LLM_ENABLED=false)",
          executedAt: new Date(),
        })
        .where(eq(scheduledAgentActions.id, action.id));
      return;
    }

    // Parimutuel sunset: every non-jackpot weekly market is AMM, so the
    // cutoff is always the configurable AMM pre-resolve cooldown (see
    // `server/native-markets/amm-settings.ts`). The legacy Friday-23:59
    // UTC parimutuel wall is gone.
    const isWeeklyNative = ["updown", "h2h", "gainer"].includes(market.marketType ?? "");
    if (isWeeklyNative && market.endAt) {
      const cutoff = getMarketBettingCutoff(
        market.endAt,
        "amm",
        market.marketType ?? undefined,
      );
      if (new Date() > cutoff) {
        await db.update(scheduledAgentActions)
          .set({
            status: "skipped",
            errorMessage: getAmmTradingClosedMessage(market.marketType ?? undefined),
            executedAt: new Date(),
          })
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
    if (!agent.isActive) {
      await db
        .update(scheduledAgentActions)
        .set({
          status: "skipped",
          errorMessage: "Agent archived or inactive",
          executedAt: new Date(),
        })
        .where(eq(scheduledAgentActions.id, action.id));
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

    // Parimutuel sunset: every non-jackpot agent action now flows through
    // `executeAmmBuy` (sizing + `executeBuy` from `amm-trades.ts`). The
    // parimutuel pool math + ledger writes that used to live here are
    // gone. Strict pre-tx balance gate was parimutuel-only too (AMM
    // sizes the budget down inside `sizeAmmBudget` and defers the real
    // check to `executeBuy`).
    if (market.engine !== "amm") {
      await db
        .update(scheduledAgentActions)
        .set({
          status: "skipped",
          errorMessage: "Legacy parimutuel market (sunset)",
          executedAt: new Date(),
        })
        .where(eq(scheduledAgentActions.id, action.id));
      return;
    }

    // Sells route to a dedicated handler. Same idempotency, same
    // [ActionWorker] log shape, different terminal effect on the AMM.
    if (action.actionType === "sell") {
      await executeAmmSell(
        action,
        action.decisionPayload as SellDecision,
        agent,
        market,
        entry,
      );
      return;
    }

    await executeAmmBuy(action, decision, agent, market, entry);
    return;
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
 * AMM bet path (Phase 10). Loads the market's AMM state, sizes the
 * trade against `decision.confidence`, and delegates to `executeBuy`
 * which owns the LMSR math, credit movement, marketBets insert, and
 * credit_ledger row.
 *
 * Idempotency: we pass `betMetadata: {actionId}` into `executeBuy` so
 * the worker's existing "already placed?" pre-check at the top of
 * `executeAction` works for AMM bets too — a reclaim after the
 * transaction commits but before `markExecuted` runs will short-
 * circuit on the next pass instead of double-spending.
 *
 * `decision.direction === "no"` is impossible here in practice
 * because `agentRunner` translates it to a YES on the opposing entry
 * for binary AMM markets and abstains otherwise. The defensive guard
 * stays in place so a stale queued action never silently buys the
 * wrong side.
 */
async function executeAmmBuy(
  action: {
    id: string;
    agentId: string;
    marketId: string;
    entryId: string;
    decisionPayload: unknown;
    stakeAmount: number;
    actionType: string;
  },
  decision: PredictionDecision,
  agent: typeof agentConfigs.$inferSelect,
  market: { id: string; title: string | null; marketType: string | null; category: string | null },
  entry: typeof marketEntries.$inferSelect,
): Promise<void> {
  if (decision.direction === "no") {
    await db
      .update(scheduledAgentActions)
      .set({
        status: "skipped",
        errorMessage: "amm_no_direction_unsupported",
        executedAt: new Date(),
      })
      .where(eq(scheduledAgentActions.id, action.id));
    log(`[ActionWorker] AMM skipped: 'no' direction on AMM market ${action.marketId} action=${action.id}`);
    return;
  }

  // Load the live AMM state (no FOR UPDATE here — `executeBuy` takes
  // its own lock). We just need the snapshot for sizing.
  const [stateRow] = await db
    .select({
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(eq(marketAmmState.marketId, action.marketId))
    .limit(1);

  if (!stateRow) {
    await markFailed(action.id, "AMM state row missing for market");
    return;
  }

  const state: AmmStateSnapshot = {
    liquidityB: Number(stateRow.liquidityB),
    outcomeOrder: stateRow.outcomeOrder as string[],
    shareQuantities: stateRow.shareQuantities as Record<string, number>,
  };

  // The runner already capped `stakeAmount` via `computeAgentStakeAmount`.
  // We treat that as the maxBudget for the target-price walk: the agent
  // never spends more than persona allows, but may spend less if their
  // confidence target is reached cheaply. Floor at MIN_AMM_BUY_CREDITS=5
  // (mirrored in sizeAmmBudget defaults).
  const isArb =
    ARB_COHORT_ENABLED &&
    getSimulationProfile(agent.simulationProfile).personaBand === "arb";
  const agentMaxStake = isArb ? ARB_AGENT_MAX_STAKE : MAX_AGENT_STAKE;
  const maxBudget = Math.max(
    1,
    Math.min(agentMaxStake, Math.round(action.stakeAmount || BASE_STAKE_AMOUNT)),
  );

  const sizing = sizeAmmBudget({
    state,
    entryId: action.entryId,
    confidence: decision.confidence ?? 0.5,
    maxBudget,
    edgeBand: isArb ? ARB_EDGE_BAND : undefined,
    // Read back the LLM ranker's conviction (Agent v2). When present and
    // > 0.5, `sizeAmmBudget` linearly widens the per-trade edge band from
    // DEFAULT (0.10) toward MAX (0.20), letting a high-conviction sharp
    // push price meaningfully closer to their target in one buy. Falls
    // back silently to the default band when the field is absent (older
    // queued actions, agents that disagreed with the ranker, or markets
    // the ranker didn't pick at all).
    conviction: decision.rankerConviction,
  });

  if (sizing.creditBudget === 0) {
    const reason = sizing.abstainReason ?? "no_amm_edge";
    await db
      .update(scheduledAgentActions)
      .set({
        status: "skipped",
        errorMessage: `amm_${reason}`,
        executedAt: new Date(),
      })
      .where(eq(scheduledAgentActions.id, action.id));
    log(
      `[ActionWorker] AMM skipped (${reason}): agent=${agent.displayName} market=${action.marketId} entry=${entry.label} confidence=${decision.confidence} currentPrice=${sizing.currentPrice.toFixed(4)}`,
    );
    return;
  }

  const result = await executeBuy({
    marketId: action.marketId,
    userId: agent.userId,
    entryId: action.entryId,
    creditBudget: sizing.creditBudget,
    agentId: agent.id,
    betMetadata: buildAgentBetMetadata(action.id),
  });

  if ("error" in result) {
    await handleAmmTradeError(action.id, result, agent, market.id);
    return;
  }

  try {
    await fireAmmPlacementHooks({
      userId: agent.userId,
      marketId: action.marketId,
      betId: result.betId,
      stakeAmount: result.chargeCredits,
      categoryId: market.category ?? null,
    });
  } catch (hookErr) {
    log(
      `[ActionWorker] AMM placement hooks failed for action=${action.id}: ${
        hookErr instanceof Error ? hookErr.message : hookErr
      }`,
    );
  }

  await markExecuted(action.id);

  log(
    `[ActionWorker] AMM executed: agent=${agent.displayName} market=${action.marketId} entry=${entry.label} confidence=${decision.confidence} sized=${sizing.creditBudget}/${maxBudget} (current=${sizing.currentPrice.toFixed(4)} target=${sizing.targetPrice.toFixed(4)} -> ${result.newSharePrice.toFixed(4)}, charge=${result.chargeCredits}, shares=${result.sharesPurchased.toFixed(4)})`,
  );
}

/**
 * AMM sell path. Mirrors `executeAmmBuy` but for the exit half of a
 * position. The runner already decided WHETHER to sell and at what
 * fraction; this function:
 *   1. Looks up the agent's current netShares (buys minus sells).
 *      Sized live (not from the decision payload) so a partial sell
 *      that landed between scheduling and execution doesn't cause us
 *      to over-sell.
 *   2. Computes `sharesToSell = clamp(netShares * sellFraction, MIN, netShares)`.
 *   3. Calls `executeSell` with `betMetadata: {actionId}` so the
 *      worker's idempotency check matches sell rows the same way it
 *      matches buy rows.
 *
 * Note: the position-size check is intentionally LIVE rather than
 * trusting a snapshot from the runner — a 30-min gap between the
 * sell sweep and the action worker is plenty of time for another
 * sell action to have landed first or for the agent to have done a
 * conviction add-on (which doesn't unschedule pending sells).
 */
async function executeAmmSell(
  action: {
    id: string;
    agentId: string;
    marketId: string;
    entryId: string;
    decisionPayload: unknown;
    stakeAmount: number;
    actionType: string;
  },
  decision: SellDecision,
  agent: typeof agentConfigs.$inferSelect,
  market: { id: string; title: string | null; marketType: string | null },
  entry: typeof marketEntries.$inferSelect,
): Promise<void> {
  // 1. Resolve current netShares for this (agent, market, entry). Sum
  // buys minus sells. If the position has been fully exited since the
  // sell was scheduled, mark this action as a no-op skip.
  const positionRows = await db
    .select({
      actionType: marketBets.actionType,
      shareCount: marketBets.shareCount,
    })
    .from(marketBets)
    .where(
      and(
        eq(marketBets.userId, agent.userId),
        eq(marketBets.marketId, action.marketId),
        eq(marketBets.entryId, action.entryId),
      ),
    );

  let netShares = 0;
  for (const row of positionRows) {
    if (row.actionType !== "buy" && row.actionType !== "sell") continue;
    const sc = Number(row.shareCount ?? 0);
    if (!Number.isFinite(sc)) continue;
    netShares += row.actionType === "buy" ? sc : -sc;
  }

  if (netShares < MIN_SHARES_TO_SELL) {
    await db
      .update(scheduledAgentActions)
      .set({
        status: "skipped",
        errorMessage: `amm_no_position (netShares=${netShares.toFixed(6)})`,
        executedAt: new Date(),
      })
      .where(eq(scheduledAgentActions.id, action.id));
    log(
      `[ActionWorker] AMM sell skipped (no position): agent=${agent.displayName} market=${action.marketId} entry=${entry.label} netShares=${netShares.toFixed(6)}`,
    );
    return;
  }

  // 2. Compute sharesToSell. Defensive clamp on the fraction in case
  // an upstream bug snuck a >1 or <=0 value into the decision.
  //
  // De minimis policy: if the intended fraction × netShares is below
  // MIN_SHARES_TO_SELL we SKIP, not floor. Flooring would silently
  // amplify tiny intents (e.g. 5% of a 0.5-share position = 0.025
  // shares getting bumped up to 0.1 — a 4x over-sell). Easy edge to
  // hit because liquidity's earlyFractionRange goes as low as 0.15
  // and the runner's MIN_NET_SHARES_FOR_SELL_EVAL is 0.5, so 0.075 <
  // 0.1 is reachable with current tuning.
  const fraction = Math.min(
    1,
    Math.max(0, Number.isFinite(decision.sellFraction) ? decision.sellFraction : 0),
  );
  const rawSharesToSell = netShares * fraction;

  if (fraction <= 0 || rawSharesToSell < MIN_SHARES_TO_SELL) {
    await db
      .update(scheduledAgentActions)
      .set({
        status: "skipped",
        errorMessage: `amm_de_minimis_sell (fraction=${fraction.toFixed(3)} raw=${rawSharesToSell.toFixed(6)} netShares=${netShares.toFixed(6)})`,
        executedAt: new Date(),
      })
      .where(eq(scheduledAgentActions.id, action.id));
    return;
  }

  const sharesToSell = Math.min(rawSharesToSell, netShares);

  // 3. Execute the sell. `executeSell` handles the LMSR proceeds math,
  // credit transfer, market_bets/credit_ledger inserts, and final
  // market state mutation. We pass `betMetadata: {actionId}` so the
  // reclaim-after-commit idempotency path in `executeAction` finds
  // sell rows identically to how it finds buy rows.
  const result = await executeSell({
    marketId: action.marketId,
    userId: agent.userId,
    entryId: action.entryId,
    shares: sharesToSell,
    agentId: agent.id,
    betMetadata: buildAgentBetMetadata(action.id),
  });

  if ("error" in result) {
    await handleAmmTradeError(action.id, result, agent, market.id);
    return;
  }

  await markExecuted(action.id);

  log(
    `[ActionWorker] AMM sold: agent=${agent.displayName} market=${action.marketId} entry=${entry.label} reason=${decision.reason} fraction=${fraction.toFixed(2)} shares=${result.sharesSold.toFixed(4)}/${netShares.toFixed(4)} proceeds=${result.proceeds} (anchor=${decision.anchor.toFixed(4)} live=${decision.livePrice.toFixed(4)} -> ${result.newSharePrice.toFixed(4)}, conviction=${decision.conviction.toFixed(2)})`,
  );
}

/**
 * Translate a structured `TradeError` from `executeBuy` into the right
 * scheduledAgentActions terminal state. Validation/visibility/closed
 * errors are user-environment skips, not bugs; insufficient credits
 * is a hard fail (agent's wallet is empty).
 */
async function handleAmmTradeError(
  actionId: string,
  err: TradeError,
  agent: typeof agentConfigs.$inferSelect,
  marketId: string,
): Promise<void> {
  const skipKinds = new Set([
    "validation",
    "trade_too_small",
    "market_closed",
    "visibility_denied",
    "not_amm",
    "entry_not_found",
    "market_not_found",
  ]);
  if (skipKinds.has(err.error)) {
    await db
      .update(scheduledAgentActions)
      .set({
        status: "skipped",
        errorMessage: `amm_${err.error}: ${err.message}`,
        executedAt: new Date(),
      })
      .where(eq(scheduledAgentActions.id, actionId));
    log(`[ActionWorker] AMM skipped (${err.error}): agent=${agent.displayName} market=${marketId} -- ${err.message}`);
    return;
  }
  await markFailed(actionId, `amm_${err.error}: ${err.message}`);
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
        category: predictionMarkets.category,
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
    if (!agent.isActive) {
      await db.update(scheduledAgentActions)
        .set({ status: "skipped", errorMessage: "Agent archived or inactive", executedAt: new Date() })
        .where(eq(scheduledAgentActions.id, action.id));
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
    const jackpotBetId = await db.transaction(async (tx) => {
      const [updatedProfile] = await tx
        .update(profiles)
        .set({
          predictCredits: sql`${profiles.predictCredits} - ${JACKPOT_TICKET_COST}`,
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
        .returning({ id: marketBets.id });

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

      return insertedBet.id;
    });

    try {
      await upsertEngagement({
        userId: agent.userId,
        categoryId: market.category ?? null,
        stakeCredits: JACKPOT_TICKET_COST,
        source: "jackpot-bet",
      });
      await gamificationService.awardXp(
        agent.userId,
        "place_prediction",
        `prediction_${action.marketId}_${jackpotBetId}_${agent.userId}`,
        { marketId: action.marketId, stakeAmount: JACKPOT_TICKET_COST },
      );
      await maybeFireReferralCredit(agent.userId);
      await checkAndAwardPredictionBadges(agent.userId);
    } catch (hookErr) {
      log(
        `[ActionWorker] Jackpot placement hooks failed for action=${action.id}: ${
          hookErr instanceof Error ? hookErr.message : hookErr
        }`,
      );
    }

    await markExecuted(action.id);
    void syncProfilePredictionStats(agent.userId);
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
