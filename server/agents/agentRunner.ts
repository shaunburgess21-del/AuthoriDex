/**
 * Orchestrator: fetches active agents and open markets, computes decisions,
 * writes scheduled actions to the DB. Does NOT place bets directly.
 */

import { db, withDbAdvisoryLock } from "../db";
import {
  agentConfigs,
  predictionMarkets,
  marketEntries,
  marketBets,
  marketAmmState,
  trendingPeople,
  trendSnapshots,
  scheduledAgentActions,
  profiles,
  creditLedger,
} from "@shared/schema";
import {
  type AmmStateSnapshot,
  currentPrices as ammCurrentPrices,
} from "@shared/lib/amm/positions";
import { eq, and, sql, gte, lte, desc, inArray } from "drizzle-orm";
import { log } from "../log";
import { computePrediction, computeJackpotPrediction } from "./decisionEngine";
import { computeWorldMarketPrediction } from "./worldMarketEngine";
import { JACKPOT_TICKET_COST } from "../config/constants";
import { getWeeklyBettingCutoff } from "../jobs/market-generator";
import { getMarketBettingCutoff } from "../native-markets/lifecycle";
import type {
  AgentConfigData,
  MarketWithEntries,
  TrendSignals,
  CrowdSplit,
  PredictionDecision,
} from "./types";
import { getSimulationProfile } from "./simulationProfile";
import { getSharpRanking } from "./sharpRanker";
import {
  ARCHETYPE_DELAY_RANGES,
  WORLD_MARKET_DELAY_RANGES,
  QUIET_HOUR_START_SAST,
  QUIET_HOUR_END_SAST,
  BASE_STAKE_AMOUNT,
  MAX_AGENT_STAKE,
  AGENT_RUNNER_INTERVAL_MS,
  AGENT_RUNNER_STARTUP_DELAY_MS,
  AGENT_CREDIT_LOW_THRESHOLD,
  AGENT_CREDIT_TOPUP_TARGET,
  MARKETS_PER_SWEEP,
  WORLD_MARKET_RESERVE_PER_SWEEP,
  NATIVE_ROTATION_MEMORY,
  CONVICTION_SCORE_THRESHOLD_PCT,
  CONVICTION_MAX_PER_MARKET,
  AGENT_STAKE_OVERRIDES,
  WORLD_REEVAL_INTERVAL_DAYS,
  WORLD_CONVICTION_INTERVAL_DAYS,
  WORLD_CONVICTION_CHANCE,
  WORLD_CONVICTION_MIN_DAYS_OPEN,
  JACKPOT_AGENT_MIN_BUFFER_HOURS,
} from "./constants";
import { isAgentsPaused } from "./runtime-state";
import { sizeAmmBudget } from "./sizing";

const AGENT_RUNNER_LOCK_KEY = 5_201;

// Process-local rotation memory for native market sampling. Insertion order
// is preserved by Set, so we can drop the oldest entries when the buffer
// exceeds NATIVE_ROTATION_MEMORY. Survives a single Railway deploy lifetime,
// which is exactly what we want — fresh deploys reset the rotation, and
// across a single uptime window agents cycle through the full 159-celeb
// catalogue instead of clustering on the same handful.
const recentNativeMarketIds = new Set<string>();

async function runAgentBatchOnce(): Promise<{
  scheduled: number;
  abstained: number;
  skipped: number;
  diagnostics?: Record<string, unknown>;
}> {
  const agents = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.isActive, true));

  if (!agents.length) {
    log("[AgentRunner] No active agents found");
    return { scheduled: 0, abstained: 0, skipped: 0, diagnostics: { reason: "no_agents" } };
  }

  for (const agent of agents) {
    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ predictCredits: profiles.predictCredits })
        .from(profiles)
        .where(eq(profiles.id, agent.userId))
        .limit(1);

      if (!profile) {
        log(`[AgentRunner] No profile found for agent ${agent.id} (${agent.displayName}) — skipping top-up`);
        return;
      }
      if (profile.predictCredits >= AGENT_CREDIT_LOW_THRESHOLD) {
        return;
      }

      const topupAmount = AGENT_CREDIT_TOPUP_TARGET - profile.predictCredits;
      const [updatedProfile] = await tx
        .update(profiles)
        .set({ predictCredits: AGENT_CREDIT_TOPUP_TARGET })
        .where(
          and(
            eq(profiles.id, agent.userId),
            eq(profiles.predictCredits, profile.predictCredits)
          )
        )
        .returning({ predictCredits: profiles.predictCredits });

      if (!updatedProfile) {
        return;
      }

      await tx.insert(creditLedger).values({
        userId: agent.userId,
        txnType: "agent_topup",
        amount: topupAmount,
        walletType: "VIRTUAL",
        balanceAfter: updatedProfile.predictCredits,
        source: "agent_runner",
        // Stable per-hour so duplicate runs within the same hour don't double top-up
        idempotencyKey: `agent_topup_${agent.id}_${Math.floor(Date.now() / 3_600_000)}`,
      });

      log(
        `[AgentRunner] Topped up ${agent.displayName}: ${profile.predictCredits} -> ${updatedProfile.predictCredits}`
      );
    });
  }

  const now = new Date();

  // Diagnostic: count markets by various criteria to identify filter issues
  const [totalCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(predictionMarkets);
  const [nativeCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(predictionMarkets)
    .where(sql`${predictionMarkets.marketType} != 'community'`);
  const [openCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.status, "OPEN"));
  const [liveCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "OPEN"),
        eq(predictionMarkets.visibility, "live")
      )
    );
  const [futureCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "OPEN"),
        eq(predictionMarkets.visibility, "live"),
        gte(predictionMarkets.endAt, now)
      )
    );

  // Also grab a sample of statuses and visibilities to see what's actually in the DB
  const statusSample = await db
    .select({
      status: predictionMarkets.status,
      visibility: predictionMarkets.visibility,
      marketType: predictionMarkets.marketType,
      endAt: predictionMarkets.endAt,
    })
    .from(predictionMarkets)
    .where(sql`${predictionMarkets.marketType} != 'community'`)
    .limit(5);

  const diag = {
    now: now.toISOString(),
    total_markets: totalCount.count,
    native_markets: nativeCount.count,
    open_markets: openCount.count,
    open_and_live: liveCount.count,
    open_live_future: futureCount.count,
    sample: statusSample.map(s => ({
      status: s.status,
      visibility: s.visibility,
      marketType: s.marketType,
      endAt: s.endAt?.toISOString?.() ?? String(s.endAt),
    })),
  };

  log(`[AgentRunner] Diagnostics: ${JSON.stringify(diag)}`);

  const markets = await db
    .select({
      id: predictionMarkets.id,
      marketType: predictionMarkets.marketType,
      openMarketType: predictionMarkets.openMarketType,
      status: predictionMarkets.status,
      title: predictionMarkets.title,
      category: predictionMarkets.category,
      personId: predictionMarkets.personId,
      endAt: predictionMarkets.endAt,
      teaser: predictionMarkets.teaser,
      resolutionCriteria: predictionMarkets.resolutionCriteria,
      metadata: predictionMarkets.metadata,
      engine: predictionMarkets.engine,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "OPEN"),
        eq(predictionMarkets.visibility, "live"),
        gte(predictionMarkets.endAt, now),
      )
    );

  if (!markets.length) {
    log("[AgentRunner] No active markets found");
    return { scheduled: 0, abstained: 0, skipped: 0, diagnostics: diag };
  }

  log(`[AgentRunner] Found ${markets.length} open markets total`);

  // Split into two pools so World Markets are guaranteed representation.
  // Without this, 29 World Markets in 800+ total markets are statistically buried.
  const worldMarkets = markets.filter(m => m.marketType === "community");
  const nativeMarkets = markets.filter(m => m.marketType !== "community");

  for (let i = worldMarkets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [worldMarkets[i], worldMarkets[j]] = [worldMarkets[j], worldMarkets[i]];
  }
  for (let i = nativeMarkets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nativeMarkets[i], nativeMarkets[j]] = [nativeMarkets[j], nativeMarkets[i]];
  }

  // Rotation memory: push markets sampled in recent sweeps to the back of
  // the queue so the catalogue actually cycles. Without this, the random
  // shuffle has no memory and the same handful of markets keep landing in
  // the slice. Markets seen in the last NATIVE_ROTATION_MEMORY sweeps move
  // to the tail, fresh markets float to the head.
  const recentlySampled = recentNativeMarketIds;
  if (recentlySampled.size > 0) {
    nativeMarkets.sort((a, b) => {
      const aRecent = recentlySampled.has(a.id) ? 1 : 0;
      const bRecent = recentlySampled.has(b.id) ? 1 : 0;
      return aRecent - bRecent;
    });
  }

  const worldSlice = worldMarkets.slice(0, WORLD_MARKET_RESERVE_PER_SWEEP);
  const nativeSlice = nativeMarkets.slice(0, MARKETS_PER_SWEEP - worldSlice.length);
  const sweepMarkets = [...worldSlice, ...nativeSlice];

  // Update rotation memory with this sweep's native picks. Delete-then-add
  // refreshes insertion order in JavaScript Sets — without the delete, a
  // market that was first sampled long ago and keeps getting re-encountered
  // would still be the "oldest" by insertion order and get evicted while
  // never-resampled markets stay in. With the delete, a re-encountered
  // market moves to the back of the memory and the genuinely-stale ones
  // get evicted first, which is what we want.
  for (const market of nativeSlice) {
    recentNativeMarketIds.delete(market.id);
    recentNativeMarketIds.add(market.id);
  }
  if (recentNativeMarketIds.size > NATIVE_ROTATION_MEMORY) {
    const overflow = recentNativeMarketIds.size - NATIVE_ROTATION_MEMORY;
    const iter = recentNativeMarketIds.values();
    for (let i = 0; i < overflow; i++) {
      const oldest = iter.next().value;
      if (oldest) recentNativeMarketIds.delete(oldest);
    }
  }

  const marketSummary = sweepMarkets.map(m => ({
    id: m.id.slice(0, 8),
    type: m.marketType,
    title: m.title?.slice(0, 40),
    personId: m.personId?.slice(0, 8) ?? null,
    endAt: m.endAt?.toISOString?.() ?? null,
  }));
  log(`[AgentRunner] Sweep subset: ${sweepMarkets.length} of ${markets.length} markets: ${JSON.stringify(marketSummary)}`);

  // Pre-pass for the LLM sharp-ranker. Fetches entries + signals for the
  // native markets in this sweep so the ranker has live data to reason
  // over. Parallelised so the whole pre-pass takes the time of a single
  // round-trip (~200ms) instead of ~3-5s of sequential queries.
  // getTrendSignals is internally idempotent for the same person within a
  // sweep, so sharp agents re-evaluating the same markets seconds later
  // don't re-pay the DB cost.
  const nativeForRanker = sweepMarkets.filter((m) => m.marketType !== "community");
  const rankerInputs = (
    await Promise.all(
      nativeForRanker.map(async (m): Promise<
        | { market: MarketWithEntries; signals: TrendSignals | null; entrySignals?: Map<string, TrendSignals> }
        | null
      > => {
        const entries = await db
          .select({
            id: marketEntries.id,
            label: marketEntries.label,
            totalStake: marketEntries.totalStake,
            noStake: marketEntries.noStake,
            personId: marketEntries.personId,
          })
          .from(marketEntries)
          .where(eq(marketEntries.marketId, m.id));
        if (entries.length === 0) return null;

        const marketData: MarketWithEntries = { ...m, entries };
        const [personSignals, entrySignalsMap] = await Promise.all([
          m.personId ? getTrendSignals(m.personId) : Promise.resolve(null),
          (m.marketType === "h2h" || m.marketType === "gainer")
            ? Promise.all(
                entries
                  .filter((e) => e.personId)
                  .map(async (e) => [e.id, await getTrendSignals(e.personId!)] as const),
              ).then((pairs) => new Map(pairs))
            : Promise.resolve(undefined),
        ]);

        return { market: marketData, signals: personSignals, entrySignals: entrySignalsMap };
      }),
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null);

  // Fire the LLM ranker (cached, deduped). Sharps will skip their random
  // abstain on any market that lands in this snapshot's picks.
  const rankerSnapshot = await getSharpRanking(rankerInputs).catch((err) => {
    log(`[AgentRunner] sharp ranker failed: ${err instanceof Error ? err.message : err}`);
    return { picks: [], generatedAt: Date.now(), marketsConsidered: 0, source: "fallback" as const, costEstimateUsd: 0 };
  });
  const sharpPickedMarketIds = new Set(rankerSnapshot.picks.map((p) => p.marketId));
  if (sharpPickedMarketIds.size > 0) {
    log(`[AgentRunner] Sharp ranker picks (${rankerSnapshot.source}): ${Array.from(sharpPickedMarketIds).map((id) => id.slice(0, 8)).join(", ")}`);
  }

  // ---------------------------------------------------------------------
  // Phase 10: precompute AMM state for AMM markets in the sweep.
  // The inner loop below runs per (agent x market). Without batching, we
  // would re-fetch the same market_amm_state row N_agents times per AMM
  // market every sweep. Batched up-front, the cost is one query for the
  // whole sweep regardless of cohort size.
  // ---------------------------------------------------------------------
  const ammSweepIds = sweepMarkets
    .filter((m) => m.engine === "amm")
    .map((m) => m.id);
  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
  if (ammSweepIds.length > 0) {
    const stateRows = await db
      .select({
        marketId: marketAmmState.marketId,
        liquidityB: marketAmmState.liquidityB,
        outcomeOrder: marketAmmState.outcomeOrder,
        shareQuantities: marketAmmState.shareQuantities,
      })
      .from(marketAmmState)
      .where(inArray(marketAmmState.marketId, ammSweepIds));
    for (const row of stateRows) {
      const b = Number(row.liquidityB);
      if (!Number.isFinite(b) || b <= 0) continue;
      ammStateByMarket.set(row.marketId, {
        liquidityB: b,
        outcomeOrder: row.outcomeOrder as string[],
        shareQuantities: row.shareQuantities as Record<string, number>,
      });
    }
  }

  let scheduled = 0;
  let abstained = 0;
  let skipped = 0;
  let skippedNoEntries = 0;
  let skippedNoEntryId = 0;

  for (const agent of agents) {
    const agentData = toAgentData(agent);

    for (const market of sweepMarkets) {
      const isCommunity = market.marketType === "community";

      // --- Duplicate / re-evaluation gate ---
      if (isCommunity) {
        // World Markets: check for existing actions including world_abstained
        const existingActions = await db
          .select({
            id: scheduledAgentActions.id,
            status: scheduledAgentActions.status,
            executedAt: scheduledAgentActions.executedAt,
            createdAt: scheduledAgentActions.createdAt,
          })
          .from(scheduledAgentActions)
          .where(
            and(
              eq(scheduledAgentActions.agentId, agent.id),
              eq(scheduledAgentActions.marketId, market.id),
              sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed', 'world_abstained')`
            )
          )
          .orderBy(
            sql`CASE WHEN ${scheduledAgentActions.status} IN ('pending', 'in_progress') THEN 0 ELSE 1 END`,
            desc(sql`COALESCE(${scheduledAgentActions.executedAt}, ${scheduledAgentActions.createdAt})`)
          )
          .limit(5);

        if (existingActions.length > 0) {
          const blockingAction = existingActions.find(
            (action) => action.status === "pending" || action.status === "in_progress"
          );
          if (blockingAction) {
            skipped++;
            continue;
          }

          const existing = existingActions.find(
            (action) => action.status === "world_abstained" || action.status === "executed"
          );
          if (!existing) {
            skipped++;
            continue;
          }

          if (existing.status === "world_abstained") {
            // Allow re-eval if abstention is older than WORLD_REEVAL_INTERVAL_DAYS
            const ageMs = Date.now() - (existing.executedAt?.getTime() ?? Date.now());
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays < WORLD_REEVAL_INTERVAL_DAYS) {
              skipped++;
              continue;
            }
            // Stale abstain — delete so a fresh evaluation can proceed
            await db.delete(scheduledAgentActions).where(eq(scheduledAgentActions.id, existing.id));
          } else if (existing.status === "executed") {
            // Conviction re-eval: allow after WORLD_CONVICTION_INTERVAL_DAYS
            const ageMs = Date.now() - (existing.executedAt?.getTime() ?? Date.now());
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            const daysToResolution = market.endAt
              ? (market.endAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              : 0;
            const agentRisk = parseFloat(String(agent.riskAppetite));
            if (
              ageDays >= WORLD_CONVICTION_INTERVAL_DAYS &&
              daysToResolution > WORLD_CONVICTION_MIN_DAYS_OPEN &&
              agentRisk > 0.6 &&
              Math.random() < WORLD_CONVICTION_CHANCE
            ) {
              log(`[AgentRunner] World conviction re-eval: ${agent.displayName} on ${market.id.slice(0, 8)}`);
              // Allow fall-through to GPT evaluation
            } else {
              skipped++;
              continue;
            }
          }
        }
      } else {
        // Native markets: original duplicate check
        const alreadyExists = await db
          .select({ id: scheduledAgentActions.id })
          .from(scheduledAgentActions)
          .where(
            and(
              eq(scheduledAgentActions.agentId, agent.id),
              eq(scheduledAgentActions.marketId, market.id),
              sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`
            )
          )
          .limit(1);

        if (alreadyExists.length > 0) {
          skipped++;
          continue;
        }
      }

      const entries = await db
        .select({
          id: marketEntries.id,
          label: marketEntries.label,
          totalStake: marketEntries.totalStake,
          noStake: marketEntries.noStake,
          personId: marketEntries.personId,
        })
        .from(marketEntries)
        .where(eq(marketEntries.marketId, market.id));

      if (!entries.length) {
        skippedNoEntries++;
        log(`[AgentRunner] Market ${market.id.slice(0, 8)} (${market.marketType}) has 0 entries — skipping`);
        continue;
      }

      const marketData: MarketWithEntries = {
        ...market,
        entries,
      };

      // --- Friday cutoff for all weekly native markets ---
      // AMM markets trade until 5 min before resolution, parimutuel
      // markets stop at Friday 23:59 UTC. Use the engine-aware helper
      // so AMM gainer (Phase 14) gets the full week, not a 2-day
      // cutoff from the parimutuel rule.
      const isWeeklyNative = ["jackpot", "updown", "h2h", "gainer"].includes(market.marketType);
      if (isWeeklyNative && market.endAt) {
        const bufferMs = JACKPOT_AGENT_MIN_BUFFER_HOURS * 60 * 60 * 1000;
        const cutoff = market.engine === "amm"
          ? getMarketBettingCutoff(market.endAt, "amm")
          : getWeeklyBettingCutoff(market.endAt);
        if (now.getTime() >= cutoff.getTime() - bufferMs) {
          skipped++;
          continue;
        }
      }

      // --- Route decision by market type ---
      const isJackpot = market.marketType === "jackpot";

      if (isJackpot) {
        const bufferMs = JACKPOT_AGENT_MIN_BUFFER_HOURS * 60 * 60 * 1000;
        const cutoff = market.endAt ? getWeeklyBettingCutoff(market.endAt) : null;

        const signals = await getTrendSignals(market.personId);

        // Gather taken numbers: active bets + pending agent actions
        const activeBets = await db
          .select({ betMetadata: marketBets.betMetadata })
          .from(marketBets)
          .where(and(eq(marketBets.marketId, market.id), eq(marketBets.status, "active")));

        const pendingActions = await db
          .select({ decisionPayload: scheduledAgentActions.decisionPayload })
          .from(scheduledAgentActions)
          .where(
            and(
              eq(scheduledAgentActions.marketId, market.id),
              eq(scheduledAgentActions.actionType, "jackpot_bet"),
              sql`${scheduledAgentActions.status} IN ('pending', 'in_progress')`
            )
          );

        const takenNumbers = new Set<number>();
        for (const bet of activeBets) {
          const meta = bet.betMetadata as Record<string, unknown> | null;
          const score = Number(meta?.predictedScore);
          if (Number.isFinite(score) && score > 0) takenNumbers.add(Math.round(score));
        }
        for (const action of pendingActions) {
          const payload = action.decisionPayload as Record<string, unknown> | null;
          const score = Number(payload?.predictedScore);
          if (Number.isFinite(score) && score > 0) takenNumbers.add(Math.round(score));
        }

        const decision = computeJackpotPrediction(agentData, signals, takenNumbers, market.category);

        if (decision.abstain) {
          abstained++;
          log(`[AgentRunner] ${agent.displayName} abstained on jackpot ${market.id.slice(0, 8)}: ${decision.abstainReason}`);
          continue;
        }

        if (!decision.predictedScore) {
          skippedNoEntryId++;
          log(`[AgentRunner] ${agent.displayName} jackpot decision had no predictedScore for ${market.id.slice(0, 8)}`);
          continue;
        }

        // Clamp executeAfter to at least JACKPOT_AGENT_MIN_BUFFER_HOURS before cutoff
        let executeAfter = computeExecuteAfter(agent.archetype);
        if (cutoff && executeAfter.getTime() > cutoff.getTime() - bufferMs) {
          executeAfter = new Date(cutoff.getTime() - bufferMs - Math.floor(Math.random() * 3_600_000));
          if (executeAfter <= now) executeAfter = new Date(now.getTime() + 60_000);
        }

        const jackpotEntryId = entries[0]?.id ?? "";

        await db.insert(scheduledAgentActions).values({
          agentId: agent.id,
          marketId: market.id,
          entryId: jackpotEntryId,
          actionType: "jackpot_bet",
          decisionPayload: decision,
          stakeAmount: JACKPOT_TICKET_COST,
          executeAfter,
          status: "pending",
        });

        // Track taken number for subsequent agents in this sweep
        takenNumbers.add(decision.predictedScore);

        scheduled++;
        log(`[AgentRunner] ${agent.displayName} → jackpot ${market.title?.slice(0, 30)} (score=${decision.predictedScore}, confidence=${decision.confidence?.toFixed(2)}, execAfter=${executeAfter.toISOString()})`);
        continue;
      }

      let decision: PredictionDecision;

      if (isCommunity) {
        decision = await computeWorldMarketPrediction(agentData, marketData, entries);
      } else {
        const sharpFetch = getSimulationProfile(agent.simulationProfile).personaBand === "sharp";
        const signals = await getTrendSignals(market.personId, { includeMultiWindow: sharpFetch });
        const crowd = computeCrowdSplit(entries);

        let entrySignals: Map<string, TrendSignals> | undefined;
        if ((market.marketType === "h2h" || market.marketType === "gainer") && entries.some(e => e.personId)) {
          entrySignals = new Map();
          for (const entry of entries) {
            if (entry.personId) {
              entrySignals.set(entry.id, await getTrendSignals(entry.personId, { includeMultiWindow: sharpFetch }));
            }
          }
        }

        // High-priority signal for sharps: the LLM market-ranker has flagged
        // this market as one of the top-edge markets for the current sweep.
        // computePrediction will skip its random abstain so the sharp cohort
        // reliably engages with the LLM's picks (model gates still apply).
        const priority: "high" | "normal" =
          sharpFetch && sharpPickedMarketIds.has(market.id) ? "high" : "normal";

        decision = computePrediction(agentData, marketData, signals, crowd, undefined, entrySignals, { priority });
      }

      decision = applySimulationDecisionLayer(agentData, marketData, decision);

      if (decision.abstain) {
        abstained++;
        log(`[AgentRunner] ${agent.displayName} abstained on ${market.id.slice(0, 8)}: ${decision.abstainReason}`);

        // Only record world_abstained when GPT-5.4 actually ran and abstained.
        // Pre-filter rejections (domain, activity_gate) are silently skipped so
        // agents retry on the next 30-minute sweep instead of being locked out for 7 days.
        if (isCommunity && (decision.abstainReason === "world_abstain" || decision.abstainReason === "api_error")) {
          await db.insert(scheduledAgentActions).values({
            agentId: agent.id,
            marketId: market.id,
            entryId: entries[0]?.id ?? "",
            actionType: "world_eval",
            decisionPayload: decision,
            stakeAmount: 0,
            executeAfter: now,
            executedAt: now,
            status: "world_abstained",
          });
        }
        continue;
      }

      if (!decision.entryId) {
        skippedNoEntryId++;
        log(`[AgentRunner] ${agent.displayName} decision had no entryId for ${market.id.slice(0, 8)}: ${JSON.stringify(decision)}`);
        continue;
      }

      // ----------------------------------------------------------------
      // Phase 10: AMM-specific decision adjustments. Run BEFORE the
      // per-action delay/stake computation so a translated entryId
      // flows naturally into the rest of the path.
      // ----------------------------------------------------------------
      if (market.engine === "amm") {
        // (1) "no" direction has no AMM equivalent. On a binary market we
        //     can translate to a YES on the OTHER entry (the prices sum
        //     to 1, so betting against A is identical to betting for B).
        //     On multi-outcome AMM markets (category races shipped in
        //     Phase 14, community multi shipped in Phase 13) there's no
        //     clean translation since rejecting one outcome doesn't
        //     uniquely identify which of the remaining N-1 to back.
        //     Documented gap: agents skip "no" on >2-way AMM markets.
        //     They participate only when the decision is "yes" with a
        //     specific outcome. The skip is logged for observability.
        if (decision.direction === "no") {
          if (entries.length === 2) {
            const otherEntry = entries.find((e) => e.id !== decision.entryId);
            if (otherEntry) {
              decision = {
                ...decision,
                entryId: otherEntry.id,
                direction: "yes",
                confidence:
                  typeof decision.confidence === "number"
                    ? Math.max(0, Math.min(1, 1 - decision.confidence))
                    : decision.confidence,
              };
            } else {
              skipped++;
              log(`[AgentRunner] AMM 'no' translation failed (no opposite entry) on ${market.id.slice(0, 8)} agent=${agent.displayName}`);
              continue;
            }
          } else {
            skipped++;
            log(`[AgentRunner] AMM 'no' direction unsupported on ${entries.length}-way market ${market.id.slice(0, 8)} agent=${agent.displayName}`);
            continue;
          }
        }

        // (2) Pre-filter: skip queueing if the AMM price for the chosen
        //     entry is already at or above the agent's confidence
        //     (no edge). This prevents the worker from chewing through
        //     no-op actions — `sizeAmmBudget` would just return 0 and
        //     mark them `skipped: amm_no_edge`. Cheaper to skip here.
        const ammSnap = ammStateByMarket.get(market.id);
        const ammEntryId = decision.entryId;
        if (ammSnap && ammEntryId) {
          const cur = ammCurrentPrices(ammSnap)[ammEntryId] ?? 0;
          const conf = typeof decision.confidence === "number" ? decision.confidence : 0.5;
          // 0.02 buffer keeps tiny-edge bets out of the queue. The worker's
          // sizing helper uses a tighter (0.005) epsilon so an in-flight
          // price move between scheduling and execution doesn't kill the
          // bet — agents can still execute when current price drifts up
          // a hair after we scheduled them.
          if (conf <= cur + 0.02) {
            skipped++;
            log(`[AgentRunner] AMM no-edge skip: agent=${agent.displayName} market=${market.id.slice(0, 8)} entry=${ammEntryId.slice(0, 8)} conf=${conf.toFixed(3)} <= price=${cur.toFixed(3)} + 0.02`);
            continue;
          }
        }
      }

      // After the AMM block we may have reassigned decision (e.g. 'no'
      // translation). Re-narrow entryId locally so the rest of the
      // scheduling path sees a definite string.
      const chosenEntryId = decision.entryId;
      if (!chosenEntryId) {
        skippedNoEntryId++;
        continue;
      }

      // Use World Market delay ranges for community markets
      const executeAfter = isCommunity
        ? computeWorldMarketExecuteAfter(agent.archetype)
        : computeExecuteAfter(agent.archetype);

      const chosenEntry = entries.find((entry) => entry.id === chosenEntryId);
      let stakeAmount = computeAgentStakeAmount(agentData, decision);

      // Agent-specific stake overrides
      const override = AGENT_STAKE_OVERRIDES[agent.username];
      if (override) {
        if (override.multiplier) stakeAmount = Math.round(stakeAmount * override.multiplier);
        if (override.cap) stakeAmount = Math.min(stakeAmount, override.cap);
        if (override.floor) {
          const shouldApplyFloor =
            agent.username !== "wildcard_za" ||
            isOtherStyleOutcome(chosenEntry?.label ?? null);
          if (shouldApplyFloor) {
            stakeAmount = Math.max(stakeAmount, override.floor);
          }
        }
      }
      stakeAmount = Math.max(BASE_STAKE_AMOUNT, Math.min(MAX_AGENT_STAKE * 3, stakeAmount));

      await db.insert(scheduledAgentActions).values({
        agentId: agent.id,
        marketId: market.id,
        entryId: chosenEntryId,
        actionType: "predict",
        decisionPayload: decision,
        stakeAmount,
        executeAfter,
        status: "pending",
      });

      scheduled++;
      log(`[AgentRunner] ${agent.displayName} → ${market.title?.slice(0, 30)} (engine=${market.engine}, entry=${chosenEntryId.slice(0, 8)}, confidence=${decision.confidence?.toFixed(2)}, stake=${stakeAmount}, source=${decision.source ?? "deterministic"}, execAfter=${executeAfter.toISOString()})`);
    }
  }

  // --- Conviction re-bet sweep ---
  // After the initial scheduling pass, check markets where agents already bet.
  // If the person's score has moved significantly from the baseline, allow a
  // second "conviction" bet (up to CONVICTION_MAX_PER_MARKET per agent per market).
  let convictionScheduled = 0;
  try {
    convictionScheduled = await runConvictionSweep(agents, markets, now);
  } catch (convErr) {
    log(`[AgentRunner] Conviction sweep error: ${convErr instanceof Error ? convErr.message : convErr}`);
  }

  const exitStats = { scheduled, abstained, skipped, skippedNoEntries, skippedNoEntryId, convictionScheduled };
  log(`[AgentRunner] Batch complete: ${JSON.stringify(exitStats)}`);
  return { ...exitStats, diagnostics: diag };
}

export async function runAgentBatch(): Promise<{
  scheduled: number;
  abstained: number;
  skipped: number;
  diagnostics?: Record<string, unknown>;
}> {
  // Global "pause all agents" kill switch (admin Agents tab toggle).
  // Bail out before grabbing the advisory lock so a paused cohort doesn't
  // even hold a connection slot.
  if (await isAgentsPaused()) {
    log("[AgentRunner] Skipping batch; agents are globally paused");
    return { scheduled: 0, abstained: 0, skipped: 0, diagnostics: { paused: true } };
  }

  const locked = await withDbAdvisoryLock(
    AGENT_RUNNER_LOCK_KEY,
    "AgentRunner",
    runAgentBatchOnce,
  );

  if (!locked.acquired) {
    log("[AgentRunner] Skipping batch; another runner instance holds the lock");
    return {
      scheduled: 0,
      abstained: 0,
      skipped: 0,
      diagnostics: { reason: "locked_out" },
    };
  }

  return locked.result ?? {
    scheduled: 0,
    abstained: 0,
    skipped: 0,
    diagnostics: { reason: "no_result" },
  };
}

/**
 * Conviction re-bet sweep: for each agent, look at markets they already bet on
 * where the situation has moved against (or for) their position, and schedule
 * a follow-up bet.
 *
 * Engine-aware (Phase 10):
 *  - Parimutuel Up/Down: existing fameIndex-vs-baseline drift trigger.
 *  - AMM Up/Down: AMM-price-vs-original-fill drift trigger. We compare the
 *    current LMSR price for the agent's chosen entry against the
 *    `pricePerShare` recorded on their FIRST AMM buy in that market.
 *    Re-uses `sizeAmmBudget` for the second-leg sizing so the conviction
 *    bet respects the same per-trade price-move cap as a fresh bet.
 */
async function runConvictionSweep(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: { id: string; personId: string | null; marketType: string | null; openMarketType?: string | null; title: string | null; engine?: string | null }[],
  _now: Date
): Promise<number> {
  let convictionScheduled = 0;

  const updownMarkets = allMarkets.filter(m =>
    m.personId && (m.marketType === "updown" || (m.marketType === "community" && m.openMarketType === "updown"))
  );
  if (!updownMarkets.length) return 0;

  // Split into engines. Parimutuel uses the legacy fameIndex baseline; AMM
  // uses on-chain price drift. Community ('updown' opened from world
  // markets) stays parimutuel until world markets ship on AMM.
  const parimutuelUpdown = updownMarkets.filter((m) => (m.engine ?? "parimutuel") !== "amm");
  const ammUpdown = updownMarkets.filter((m) => m.engine === "amm");

  // Pre-load AMM state for AMM updown markets in this sweep — single
  // batched query, used by every agent below.
  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
  if (ammUpdown.length > 0) {
    const stateRows = await db
      .select({
        marketId: marketAmmState.marketId,
        liquidityB: marketAmmState.liquidityB,
        outcomeOrder: marketAmmState.outcomeOrder,
        shareQuantities: marketAmmState.shareQuantities,
      })
      .from(marketAmmState)
      .where(inArray(marketAmmState.marketId, ammUpdown.map((m) => m.id)));
    for (const row of stateRows) {
      const b = Number(row.liquidityB);
      if (!Number.isFinite(b) || b <= 0) continue;
      ammStateByMarket.set(row.marketId, {
        liquidityB: b,
        outcomeOrder: row.outcomeOrder as string[],
        shareQuantities: row.shareQuantities as Record<string, number>,
      });
    }
  }

  // ---------------------------------------------------------------------
  // Parimutuel path — fameIndex baseline drift (unchanged from pre-Phase 10)
  // ---------------------------------------------------------------------
  const personIds = Array.from(new Set(parimutuelUpdown.map(m => m.personId!)));
  const liveScores = personIds.length
    ? await db
        .select({ id: trendingPeople.id, fameIndex: trendingPeople.fameIndex })
        .from(trendingPeople)
        .where(inArray(trendingPeople.id, personIds))
    : [];
  const scoreMap = new Map(liveScores.map(p => [p.id, p.fameIndex ?? 0]));

  for (const agent of agents) {
    const existingBets = await db
      .select({
        marketId: marketBets.marketId,
        entryId: marketBets.entryId,
      })
      .from(marketBets)
      .where(eq(marketBets.agentId, agent.id));

    if (!existingBets.length) continue;

    const betByMarket = new Map(existingBets.map(b => [b.marketId, b.entryId]));

    for (const market of parimutuelUpdown) {
      if (!betByMarket.has(market.id)) continue;

      const convictionExists = await db
        .select({ id: scheduledAgentActions.id })
        .from(scheduledAgentActions)
        .where(
          and(
            eq(scheduledAgentActions.agentId, agent.id),
            eq(scheduledAgentActions.marketId, market.id),
            eq(scheduledAgentActions.actionType, "conviction"),
            sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`
          )
        )
        .limit(1);

      if (convictionExists.length >= CONVICTION_MAX_PER_MARKET) continue;

      const liveScore = scoreMap.get(market.personId!);
      if (liveScore == null) continue;

      const entries = await db
        .select({
          id: marketEntries.id,
          label: marketEntries.label,
          totalStake: marketEntries.totalStake,
          personId: marketEntries.personId,
        })
        .from(marketEntries)
        .where(eq(marketEntries.marketId, market.id));

      if (entries.length < 2) continue;

      const baselineRow = await db
        .select({ metadata: predictionMarkets.metadata })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, market.id))
        .limit(1);

      const metadata = baselineRow[0]?.metadata as Record<string, any> | null;
      const baseline = metadata?.openingScore?.score as number | undefined;
      if (baseline == null || baseline === 0) continue;

      const delta = (liveScore - baseline) / baseline;
      if (Math.abs(delta) < CONVICTION_SCORE_THRESHOLD_PCT) continue;

      // Significant move detected — schedule a conviction bet
      const originalEntryId = betByMarket.get(market.id)!;
      const originalEntry = entries.find(e => e.id === originalEntryId);
      const originalLabel = (originalEntry?.label ?? "").toLowerCase();
      const isOriginalUp = originalLabel.includes("up");

      let chosenEntryId: string;
      const scoreMovedUp = delta > 0;

      if (scoreMovedUp === isOriginalUp) {
        // Score moved in agent's favour — double down (same entry)
        chosenEntryId = originalEntryId;
      } else {
        // Score moved against agent — 30% flip chance (higher for contrarians)
        const flipChance = 0.30 + (agent.contrarianism ? parseFloat(String(agent.contrarianism)) * 0.15 : 0);
        if (Math.random() < flipChance) {
          const otherEntry = entries.find(e => e.id !== originalEntryId);
          chosenEntryId = otherEntry?.id ?? originalEntryId;
        } else {
          chosenEntryId = originalEntryId;
        }
      }

      const confidence = Math.min(0.95, 0.6 + Math.abs(delta));
      const stakeAmount = computeStakeAmount(confidence);
      const executeAfter = computeExecuteAfter(agent.archetype);

      await db.insert(scheduledAgentActions).values({
        agentId: agent.id,
        marketId: market.id,
        entryId: chosenEntryId,
        actionType: "conviction",
        decisionPayload: {
          abstain: false,
          entryId: chosenEntryId,
          confidence: parseFloat(confidence.toFixed(3)),
          convictionDelta: parseFloat(delta.toFixed(4)),
          originalEntryId,
          doubled: chosenEntryId === originalEntryId,
        },
        stakeAmount,
        executeAfter,
        status: "pending",
      });

      convictionScheduled++;
      const action = chosenEntryId === originalEntryId ? "doubled down" : "flipped";
      log(`[AgentRunner] Conviction: ${agent.displayName} ${action} on ${market.title?.slice(0, 30)} (delta=${(delta * 100).toFixed(1)}%, stake=${stakeAmount})`);
    }
  }

  // ---------------------------------------------------------------------
  // AMM path (Phase 10) — drift trigger is on the LMSR price for the
  // agent's chosen entry, measured against the fill price recorded on
  // their first AMM buy in that market. We re-use the same threshold
  // (CONVICTION_SCORE_THRESHOLD_PCT) so admin tuning continues to
  // affect both engines uniformly.
  // ---------------------------------------------------------------------
  if (ammUpdown.length > 0) {
    for (const agent of agents) {
      // Pull this agent's AMM buys across the AMM updown markets in the
      // sweep, ordered oldest-first so the first row per (market, entry)
      // is the agent's initial fill — that's our cost-basis anchor.
      const ammBets = await db
        .select({
          marketId: marketBets.marketId,
          entryId: marketBets.entryId,
          actionType: marketBets.actionType,
          pricePerShare: marketBets.pricePerShare,
          createdAt: marketBets.createdAt,
        })
        .from(marketBets)
        .where(
          and(
            eq(marketBets.agentId, agent.id),
            eq(marketBets.actionType, "buy"),
            inArray(marketBets.marketId, ammUpdown.map((m) => m.id)),
          ),
        )
        .orderBy(marketBets.createdAt);

      if (!ammBets.length) continue;

      // First fill per market: we'll trigger conviction off the delta
      // between current price and this anchor. `ammBets` is ordered
      // oldest-first, so `Map.set(...)` with a `has()` guard preserves
      // the first-fill semantics in O(1) per market lookup below.
      const anchorByMarket = new Map<string, { entryId: string; pricePerShare: number }>();
      for (const bet of ammBets) {
        if (anchorByMarket.has(bet.marketId)) continue;
        const ps = parseFloat(String(bet.pricePerShare ?? "0"));
        if (!Number.isFinite(ps) || ps <= 0) continue;
        anchorByMarket.set(bet.marketId, { entryId: bet.entryId, pricePerShare: ps });
      }

      for (const market of ammUpdown) {
        const state = ammStateByMarket.get(market.id);
        if (!state) continue;
        const anchor = anchorByMarket.get(market.id);
        if (!anchor) continue;

        // Skip if a conviction bet for this agent+market already exists.
        const convictionExists = await db
          .select({ id: scheduledAgentActions.id })
          .from(scheduledAgentActions)
          .where(
            and(
              eq(scheduledAgentActions.agentId, agent.id),
              eq(scheduledAgentActions.marketId, market.id),
              eq(scheduledAgentActions.actionType, "conviction"),
              sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`,
            ),
          )
          .limit(1);

        if (convictionExists.length >= CONVICTION_MAX_PER_MARKET) continue;

        const livePrice = ammCurrentPrices(state)[anchor.entryId] ?? 0;
        if (livePrice <= 0) continue;

        const delta = (livePrice - anchor.pricePerShare) / anchor.pricePerShare;
        if (Math.abs(delta) < CONVICTION_SCORE_THRESHOLD_PCT) continue;

        // Score moved in agent's favour iff price went UP on the entry
        // they hold. Same flip mechanic as parimutuel — the anchor entry
        // and the alternative entry on a binary AMM market are
        // symmetrical (price[A] + price[B] = 1).
        const movedInFavour = delta > 0;

        let chosenEntryId = anchor.entryId;
        if (!movedInFavour) {
          const flipChance =
            0.30 + (agent.contrarianism ? parseFloat(String(agent.contrarianism)) * 0.15 : 0);
          if (Math.random() < flipChance) {
            const otherEntryId = state.outcomeOrder.find((id) => id !== anchor.entryId);
            if (otherEntryId) chosenEntryId = otherEntryId;
          }
        }

        const confidence = Math.min(0.95, 0.6 + Math.abs(delta));

        // Re-use the same target-price sizer the worker uses. We feed
        // it the live state so the budget reflects what the actual
        // executor will charge. If sizer says no-edge here we abstain
        // entirely (the worker would just skip it on the other end).
        const sizing = sizeAmmBudget({
          state,
          entryId: chosenEntryId,
          confidence,
          maxBudget: Math.min(MAX_AGENT_STAKE, computeStakeAmount(confidence)),
        });
        if (sizing.creditBudget === 0) continue;

        const executeAfter = computeExecuteAfter(agent.archetype);

        await db.insert(scheduledAgentActions).values({
          agentId: agent.id,
          marketId: market.id,
          entryId: chosenEntryId,
          actionType: "conviction",
          decisionPayload: {
            abstain: false,
            entryId: chosenEntryId,
            confidence: parseFloat(confidence.toFixed(3)),
            convictionDelta: parseFloat(delta.toFixed(4)),
            originalEntryId: anchor.entryId,
            doubled: chosenEntryId === anchor.entryId,
            // AMM-specific telemetry — useful when auditing why a
            // conviction action got scheduled.
            ammAnchorPrice: anchor.pricePerShare,
            ammLivePrice: livePrice,
          },
          // We persist the SIZED budget so the worker can use it as the
          // maxBudget cap on its second sizing pass. The worker re-sizes
          // against the latest state at execution time, which prevents
          // overcommitting if price has moved further between now and
          // execute_after.
          stakeAmount: sizing.creditBudget,
          executeAfter,
          status: "pending",
        });

        convictionScheduled++;
        const action = chosenEntryId === anchor.entryId ? "doubled down" : "flipped";
        log(
          `[AgentRunner] AMM Conviction: ${agent.displayName} ${action} on ${market.title?.slice(0, 30)} (anchor=${anchor.pricePerShare.toFixed(3)} live=${livePrice.toFixed(3)} delta=${(delta * 100).toFixed(1)}%, sized=${sizing.creditBudget})`,
        );
      }
    }
  }

  if (convictionScheduled > 0) {
    log(`[AgentRunner] Conviction sweep scheduled ${convictionScheduled} re-bets`);
  }

  return convictionScheduled;
}

function toAgentData(row: typeof agentConfigs.$inferSelect): AgentConfigData {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    username: row.username,
    bio: row.bio ?? "",
    archetype: row.archetype,
    specialties: row.specialties ?? [],
    boldness: parseFloat(String(row.boldness)),
    contrarianism: parseFloat(String(row.contrarianism)),
    recencyWeight: parseFloat(String(row.recencyWeight)),
    prestigeBias: parseFloat(String(row.prestigeBias)),
    confidenceCal: parseFloat(String(row.confidenceCal)),
    riskAppetite: parseFloat(String(row.riskAppetite)),
    consensusSensitivity: parseFloat(String(row.consensusSensitivity)),
    activityRate: parseFloat(String(row.activityRate)),
    simulationProfile: row.simulationProfile,
    isActive: row.isActive,
  };
}

async function getTrendSignals(
  personId: string | null,
  options: { includeMultiWindow?: boolean } = {},
): Promise<TrendSignals> {
  if (!personId) {
    return {
      trendScore: 50,
      fameIndex: 5000,
      scoreBaseline: 5000,
      scoreDelta7d: 0,
      wikiPulse: "stable",
      newsLevel: "amber",
    };
  }

  const [person] = await db
    .select({
      trendScore: trendingPeople.trendScore,
      fameIndex: trendingPeople.fameIndex,
      change7d: trendingPeople.change7d,
    })
    .from(trendingPeople)
    .where(eq(trendingPeople.id, personId))
    .limit(1);

  // Get latest snapshot for wiki/news signals
  const [snap] = await db
    .select({
      wikiDelta: trendSnapshots.wikiDelta,
      newsDelta: trendSnapshots.newsDelta,
      fameIndex: trendSnapshots.fameIndex,
      trendScore: trendSnapshots.trendScore,
      timestamp: trendSnapshots.timestamp,
    })
    .from(trendSnapshots)
    .where(eq(trendSnapshots.personId, personId))
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(1);

  const trendScore = person?.trendScore ?? 50;
  const fameIndex = person?.fameIndex ?? 5000;
  const change7d = person?.change7d ?? 0;

  const wikiDelta = snap?.wikiDelta ?? 0;
  const newsDelta = snap?.newsDelta ?? 0;

  let wikiPulse: TrendSignals["wikiPulse"] = "stable";
  if (wikiDelta > 0.15) wikiPulse = "rising";
  else if (wikiDelta < -0.15) wikiPulse = "falling";

  let newsLevel: TrendSignals["newsLevel"] = "amber";
  if (newsDelta > 0.3) newsLevel = "red";
  else if (newsDelta < -0.1) newsLevel = "green";

  const result: TrendSignals = {
    trendScore,
    fameIndex,
    scoreBaseline: snap?.fameIndex ?? fameIndex,
    scoreDelta7d: change7d,
    wikiPulse,
    newsLevel,
  };

  // Multi-window momentum for sharps. Two extra ranged queries — kept off
  // the hot path for non-sharp evaluations because it would otherwise add
  // ~120 queries per sweep across the whole cohort. Sharps eat the cost
  // because their decisions actually use the data.
  if (options.includeMultiWindow && snap?.trendScore != null) {
    const cached = multiWindowCache.get(personId);
    const ttlOk = cached && Date.now() - cached.fetchedAt < MULTI_WINDOW_TTL_MS;
    if (ttlOk && cached) {
      if (cached.delta14d != null) result.scoreDelta14d = cached.delta14d;
      if (cached.delta30d != null) result.scoreDelta30d = cached.delta30d;
    } else {
      const [snap14, snap30] = await Promise.all([
        loadHistoricalSnapshot(personId, 14),
        loadHistoricalSnapshot(personId, 30),
      ]);
      const delta14d = snap14 != null ? snap.trendScore - snap14 : null;
      const delta30d = snap30 != null ? snap.trendScore - snap30 : null;
      multiWindowCache.set(personId, {
        delta14d,
        delta30d,
        fetchedAt: Date.now(),
      });
      if (delta14d != null) result.scoreDelta14d = delta14d;
      if (delta30d != null) result.scoreDelta30d = delta30d;
    }
  }

  return result;
}

const MULTI_WINDOW_TTL_MS = 6 * 60 * 60 * 1000;
const multiWindowCache = new Map<
  string,
  { delta14d: number | null; delta30d: number | null; fetchedAt: number }
>();

async function loadHistoricalSnapshot(
  personId: string,
  daysBack: number,
): Promise<number | null> {
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ trendScore: trendSnapshots.trendScore })
    .from(trendSnapshots)
    .where(
      and(
        eq(trendSnapshots.personId, personId),
        lte(trendSnapshots.timestamp, cutoff),
      ),
    )
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(1);
  return row?.trendScore ?? null;
}

function computeCrowdSplit(
  entries: { id: string; totalStake: number }[]
): CrowdSplit {
  const totalStake = entries.reduce((sum, e) => sum + e.totalStake, 0);
  if (totalStake === 0) return {};

  const split: CrowdSplit = {};
  entries.forEach((e) => {
    split[e.id] = e.totalStake / totalStake;
  });
  return split;
}

function computeExecuteAfter(archetype: string): Date {
  const [min, max] = ARCHETYPE_DELAY_RANGES[archetype] ?? [3_600, 21_600];
  return applyQuietHours(min, max);
}

function computeWorldMarketExecuteAfter(archetype: string): Date {
  const [min, max] = WORLD_MARKET_DELAY_RANGES[archetype] ?? [3_600, 86_400];
  return applyQuietHours(min, max);
}

function applyQuietHours(minSec: number, maxSec: number): Date {
  const delaySec = Math.floor(Math.random() * (maxSec - minSec) + minSec);
  const executeAt = new Date(Date.now() + delaySec * 1000);

  const sastHour = (executeAt.getUTCHours() + executeAt.getUTCMinutes() / 60 + 2) % 24;
  if (sastHour >= QUIET_HOUR_START_SAST || sastHour < QUIET_HOUR_END_SAST) {
    const nextMorning = new Date(executeAt);
    nextMorning.setUTCHours(5, 0, 0, 0); // 07:00 SAST = 05:00 UTC
    if (nextMorning <= executeAt) {
      nextMorning.setDate(nextMorning.getDate() + 1);
    }
    return nextMorning;
  }

  return executeAt;
}

function computeStakeAmount(confidence: number): number {
  // Higher confidence → higher stake, between BASE and MAX
  const scaled =
    BASE_STAKE_AMOUNT +
    Math.round((confidence - 0.5) * 2 * (MAX_AGENT_STAKE - BASE_STAKE_AMOUNT));
  return Math.max(BASE_STAKE_AMOUNT, Math.min(MAX_AGENT_STAKE, scaled));
}

function applySimulationDecisionLayer(
  agent: AgentConfigData,
  market: MarketWithEntries,
  decision: PredictionDecision,
): PredictionDecision {
  if (decision.abstain || !decision.entryId) return decision;

  const simulation = getSimulationProfile(agent.simulationProfile);
  const impliedProbability = computeImpliedProbability(market.entries, decision);
  const modelProbability = computeModelProbability(market, decision);
  const baseConfidence = decision.confidence ?? modelProbability;
  const calibrationScale = 0.82 + simulation.skillTier * 0.34;
  let confidence = 0.5 + (baseConfidence - 0.5) * calibrationScale;

  if (simulation.personaBand === "noisy") {
    confidence = Math.min(0.95, confidence + 0.04);
  }
  confidence = Math.max(0.05, Math.min(0.95, confidence));

  if (impliedProbability == null) {
    return { ...decision, confidence: Number(confidence.toFixed(3)) };
  }

  const edge = modelProbability - impliedProbability;
  if (edge < simulation.edgeThreshold) {
    return {
      ...decision,
      abstain: true,
      abstainReason: "low_edge",
      confidence: Number(confidence.toFixed(3)),
      impliedProbability: Number(impliedProbability.toFixed(3)),
      edge: Number(edge.toFixed(3)),
    };
  }

  return {
    ...decision,
    confidence: Number(confidence.toFixed(3)),
    impliedProbability: Number(impliedProbability.toFixed(3)),
    edge: Number(edge.toFixed(3)),
  };
}

function computeImpliedProbability(
  entries: MarketWithEntries["entries"],
  decision: PredictionDecision,
): number | null {
  if (!decision.entryId || entries.length === 0) return null;
  const entry = entries.find((item) => item.id === decision.entryId);
  if (!entry) return null;

  const yesPool = entries.reduce((sum, item) => sum + Number(item.totalStake || 0), 0);
  const noPool = entries.reduce((sum, item) => sum + Number(item.noStake || 0), 0);
  const totalPool = yesPool + noPool;
  if (totalPool <= 0) return 1 / Math.max(entries.length, 2);

  if (decision.direction === "no") {
    const otherEntries = entries.filter((item) => item.id !== decision.entryId);
    const likelyWinner = otherEntries.reduce<typeof entries[number] | null>(
      (best, item) => (!best || Number(item.totalStake || 0) > Number(best.totalStake || 0) ? item : best),
      null,
    );
    const winnerPool =
      Number(likelyWinner?.totalStake || 0) +
      (noPool - Number(likelyWinner?.noStake || 0));
    return Math.max(0.02, Math.min(0.98, winnerPool / totalPool));
  }

  const winnerPool =
    Number(entry.totalStake || 0) +
    entries
      .filter((item) => item.id !== decision.entryId)
      .reduce((sum, item) => sum + Number(item.noStake || 0), 0);
  return Math.max(0.02, Math.min(0.98, winnerPool / totalPool));
}

function computeModelProbability(
  market: MarketWithEntries,
  decision: PredictionDecision,
): number {
  const fallback = decision.confidence ?? 0.5;
  const raw = decision.rawProbability;

  // H2H rawProbability is normalized by the deterministic engine. Multi-option
  // markets use relative scores, so confidence is the safer comparable signal.
  if (
    market.marketType === "h2h" &&
    typeof raw === "number" &&
    Number.isFinite(raw)
  ) {
    return Math.max(0.05, Math.min(0.95, raw));
  }

  return Math.max(0.05, Math.min(0.95, fallback));
}

function computeAgentStakeAmount(
  agent: AgentConfigData,
  decision: PredictionDecision,
): number {
  const simulation = getSimulationProfile(agent.simulationProfile);
  const isSharp = simulation.personaBand === "sharp";
  const confidence = decision.confidence ?? 0.5;
  const edge = Math.max(0, decision.edge ?? 0);

  // Edge-aware stake sizing. Sharps use a steeper curve so genuine value
  // bets (edge > 0.15) get pushed materially higher, and marginal-edge
  // bets get a smaller boost — they bet to confidence the way real sharps
  // do (Kelly-ish, not flat-stake). Non-sharps keep the flatter curve so
  // their stake distribution feels more "casual punter".
  const edgeBoost = isSharp
    ? 1 + Math.min(edge, 0.35) * 4.0
    : 1 + Math.min(edge, 0.35) * 2.5;

  // Widened from 0.85-1.20 → 0.70-1.30. Town Square was showing the same
  // stakes (220, 300, 209) appearing 5+ times in a row because the narrow
  // variance + persona maxStake clamp produced clusters at the cap. Wider
  // variance plus the soft cap below spreads numbers out so the feed
  // reads like a real cohort instead of identical bot output.
  const variance = 0.70 + Math.random() * 0.60;
  const base = computeStakeAmount(confidence);
  const stake = Math.round(base * simulation.stakeMultiplier * edgeBoost * variance);

  // Soft cap: instead of a hard clamp at the persona maxStake (which made
  // every casual band hit 220 exactly when they wanted to bet big), allow
  // ±8% per-agent jitter on the cap so high-stake bets land at varied
  // numbers like 213, 218, 221, 226, etc.
  const capJitter = 1 + (Math.random() * 0.16 - 0.08);
  const softMax = Math.round(simulation.maxStake * capJitter);
  return Math.max(simulation.minStake, Math.min(softMax, stake));
}

function isOtherStyleOutcome(label: string | null): boolean {
  const normalized = (label ?? "").trim().toLowerCase();
  return (
    normalized === "other" ||
    normalized.includes(" other") ||
    normalized.startsWith("other ") ||
    normalized.includes("field")
  );
}

export function startAgentRunnerScheduler(): void {
  log(
    `[AgentRunner] Scheduler starting (sweep every ${AGENT_RUNNER_INTERVAL_MS / 60000} min, ${AGENT_RUNNER_STARTUP_DELAY_MS / 60000} min startup delay)`
  );
  setTimeout(() => {
    runAgentBatch().catch((e) =>
      console.error("[AgentRunner] Batch failed:", e)
    );
    setInterval(() => {
      runAgentBatch().catch((e) =>
        console.error("[AgentRunner] Batch failed:", e)
      );
    }, AGENT_RUNNER_INTERVAL_MS);
  }, AGENT_RUNNER_STARTUP_DELAY_MS);
}
