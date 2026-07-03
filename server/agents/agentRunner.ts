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
import {
  computeArbPrediction,
  computeArbPredictionH2H,
  computeArbPredictionGainer,
  computeArbPredictionCommunity,
  isArbAgent,
} from "./arbAgent";
import { readSourceFairByEntryId } from "./sourceFair";
import { computeWorldMarketPrediction } from "./worldMarketEngine";
import { prefetchNativeAssessmentsForSweep } from "./nativeMarketEngine";
import { JACKPOT_TICKET_COST } from "../config/constants";
import { getWeeklyBettingCutoff } from "../jobs/market-generator";
import { getMarketBettingCutoff } from "../native-markets/lifecycle";
import type {
  AgentConfigData,
  MarketWithEntries,
  MarketEntryData,
  TrendSignals,
  TrendDirection,
  TrendMomentum,
  CrowdSplit,
  PredictionDecision,
  SellDecision,
} from "./types";
import { getSimulationProfile } from "./simulationProfile";
import { getSharpRanking } from "./sharpRanker";
import { computeSellDecision } from "./sellEngine";
import { computeConvictionFollowUp } from "./convictionEngine";
import {
  ARCHETYPE_DELAY_RANGES,
  WORLD_MARKET_DELAY_RANGES,
  QUIET_HOUR_START_SAST,
  QUIET_HOUR_END_SAST,
  BASE_STAKE_AMOUNT,
  MAX_AGENT_STAKE,
  ARB_COHORT_ENABLED,
  ARB_AGENT_MAX_STAKE,
  ARB_CONVERGENCE_MARKETS_PER_SWEEP,
  ARB_MIN_EDGE_PP,
  isLockInFairH2HEnabled,
  isLockInFairGainerEnabled,
  LOCKIN_H2H_SIGMA_1D,
  LOCKIN_H2H_BETA,
  LOCKIN_GAINER_SIGMA_1D,
  LOCKIN_GAINER_BETA,
  AGENT_RUNNER_INTERVAL_MS,
  AGENT_RUNNER_STARTUP_DELAY_MS,
  AGENT_CREDIT_LOW_THRESHOLD,
  AGENT_CREDIT_TOPUP_TARGET,
  MARKETS_PER_SWEEP,
  WORLD_MARKET_RESERVE_PER_SWEEP,
  NATIVE_ROTATION_MEMORY,
  CONVICTION_MAX_PER_MARKET,
  DECISIVE_WEEKLY_MOVE_PCT,
  REPREDICT_PCT_THRESHOLD,
  REPREDICT_MAX_PER_MARKET,
  MISPRICED_PRIORITY_SLICE,
  MISPRICED_SCORE_PCT,
  MISPRICED_UP_PRICE_HIGH,
  MISPRICED_UP_PRICE_LOW,
  LATCH_TRAILING_SAMPLE_COUNT,
  isLatchRevertShadow,
  ARB_MIDWEEK_MIN_EDGE_PP,
  ARB_MIDWEEK_DECISIVE_PCT,
  isMidweekConvergenceShadow,
  isMidweekConvergenceEnabled,
  isCommunityConvergenceShadow,
  isCommunityConvergenceEnabled,
  isCommunitySellSweepEnabled,
  COMMUNITY_ARB_MIN_EDGE_PP,
  COMMUNITY_CONVERGENCE_MARKETS_PER_SWEEP,
  AGENT_STAKE_OVERRIDES,
  WORLD_REEVAL_INTERVAL_DAYS,
  WORLD_CONVICTION_INTERVAL_DAYS,
  WORLD_CONVICTION_CHANCE,
  WORLD_CONVICTION_MIN_DAYS_OPEN,
  JACKPOT_AGENT_MIN_BUFFER_HOURS,
  MAX_SELLS_PER_MARKET_PER_AGENT,
  MIN_NET_SHARES_FOR_SELL_EVAL,
  SELL_DEFAULT_CONVICTION,
  WORLD_MARKETS_LLM_ENABLED,
  POSITIVE_HINTS,
  NEGATIVE_HINTS,
} from "./constants";
import { filterRankableMarketsForRanker } from "./sharpRanker-input";
import { isAgentsPaused } from "./runtime-state";
import { sizeAmmBudget } from "./sizing";
import {
  fairH2HByEntryId,
  fairGainerByEntryId,
  favoredH2HFromFairMap,
  hoursUntilEnd,
  computeLockInFairUp,
  fairForEntry,
} from "./lockInFair";
import {
  readWeeklyOpen,
  resolveDecisiveLatched,
  shouldLatchFromTrailingMedian,
  wouldDisarmLatch,
} from "./weeklyOpenLatch";

const AGENT_RUNNER_LOCK_KEY = 5_201;

function openingScoreFromMeta(
  meta: Record<string, unknown> | null | undefined,
): number | null {
  const score = (meta?.openingScore as { score?: unknown } | undefined)?.score;
  return typeof score === "number" && Number.isFinite(score) && score > 0
    ? score
    : null;
}

function upDownEntryIds(
  entries: { id: string; label: string | null }[],
): { upEntryId: string; downEntryId: string } | null {
  const up = entries.find((e) => (e.label ?? "").toLowerCase() === "up");
  const down = entries.find((e) => (e.label ?? "").toLowerCase() === "down");
  if (!up?.id || !down?.id) return null;
  return { upEntryId: up.id, downEntryId: down.id };
}

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
      // Used as the per-entry opening-score cutoff for H2H / Race so the
      // ranker + decision engine see `pctChangeVsOpen` at the entry level.
      createdAt: predictionMarkets.createdAt,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "OPEN"),
        eq(predictionMarkets.visibility, "live"),
        gte(predictionMarkets.endAt, now),
      )
    );

  // Sweep-scoped cache for per-entry opening scores. Memory hygiene only —
  // the closest-at-or-before snapshot for a fixed (personId, marketCreatedAt)
  // pair shouldn't change between sweeps in normal operation, but clearing
  // every 30 min keeps the map bounded as old markets resolve.
  entryOpeningScoreCache.clear();

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
  const nativePool = nativeMarkets.slice(0, MARKETS_PER_SWEEP - worldSlice.length);

  // Build the shared up/down sweep context ONCE per batch — every
  // score-aware sub-sweep below (mispriced slice, conviction,
  // repredict, sell, weekly-open latch) reuses the same map of
  // {entries, pctChangeVsOpen} keyed by marketId plus the per-person
  // TrendSignals cache. Previously each helper rebuilt this from
  // scratch which meant 4-5 full entries queries + duplicate trend
  // lookups per sweep.
  const ammUpdownNative = filterAmmPerPersonUpdown(nativeMarkets);
  const updownSweepCtx = await buildUpdownSweepContext(ammUpdownNative);

  const priorityIds = await pickMispricedUpdownMarketIds(
    nativeMarkets,
    MISPRICED_PRIORITY_SLICE,
    updownSweepCtx.marketContext,
  );
  const prioritySet = new Set(priorityIds);
  const nativeSlice = [
    ...nativeMarkets.filter((m) => prioritySet.has(m.id)),
    ...nativePool.filter((m) => !prioritySet.has(m.id)),
  ].slice(0, MARKETS_PER_SWEEP - worldSlice.length);
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
  // Community markets are eligible only when the world-market LLM kill
  // switch is on. When `WORLD_MARKETS_LLM_ENABLED=false` the action
  // worker hard-skips community actions, so any ranker slot spent on a
  // world market is dead weight — we keep all 6 slots aimed at markets
  // the agents will actually trade this sweep. When the env flag flips
  // back on, community markets re-enter the pool on the next sweep.
  const rankerFilter = filterRankableMarketsForRanker(sweepMarkets, {
    worldMarketsLlmEnabled: WORLD_MARKETS_LLM_ENABLED,
  });
  if (rankerFilter.dropped.length > 0) {
    log(
      `[AgentRunner] Sharp ranker: dropping ${rankerFilter.dropped.length} community market(s) from input ` +
      `(WORLD_MARKETS_LLM_ENABLED=false). Keeping ${rankerFilter.kept.length} of ${sweepMarkets.length}.`,
    );
  }
  const rankableMarkets = rankerFilter.kept;
  const rankerInputs = (
    await Promise.all(
      rankableMarkets.map(async (m): Promise<
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
        const isPerEntry = m.marketType === "h2h" || m.marketType === "gainer";
        const [personSignals, entrySignalsMap] = await Promise.all([
          m.personId ? getTrendSignals(m.personId) : Promise.resolve(null),
          isPerEntry
            ? Promise.all(
                entries
                  .filter((e) => e.personId)
                  .map(async (e) => {
                    // Look up the entry's opening score so the ranker sees
                    // `pctChangeVsOpen` per entry, not just per market.
                    // Falls back gracefully when no snapshot pre-dates the
                    // market (returns null -> getTrendSignals skips the
                    // pctChangeVsOpen calc).
                    const openingScore = m.createdAt
                      ? await getEntryOpeningScore(e.personId!, m.id, m.createdAt)
                      : null;
                    const sig = await getTrendSignals(e.personId!, { openingScore });
                    return [e.id, sig] as const;
                  }),
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
  // Build a marketId-keyed map so the per-agent stake-sizing pass can
  // look up the LLM's edge + conviction in O(1) and feed them into the
  // smartness curve. Set of IDs is kept for the existing priority-bump
  // logic that doesn't care about per-pick numerics.
  const sharpPicksByMarketId = new Map(rankerSnapshot.picks.map((p) => [p.marketId, p] as const));
  const sharpPickedMarketIds = new Set(sharpPicksByMarketId.keys());
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

  const nativeAssessmentByMarket = await prefetchNativeAssessmentsForSweep(
    rankerInputs
      .filter(
        (r): r is { market: MarketWithEntries; signals: TrendSignals } =>
          r != null && r.signals != null,
      )
      .map((r) => ({ market: r.market, signals: r.signals })),
  );

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

      // --- Cutoff for weekly native markets ---
      // Parimutuel sunset: every non-jackpot market is AMM and trades
      // until `endAt - <pre-resolve cooldown>`. Jackpot is the only
      // remaining parimutuel market and still locks at Friday 23:59
      // UTC. We always go through `getMarketBettingCutoff` so the
      // jackpot branch picks up `market.engine === "parimutuel"`
      // automatically.
      const isWeeklyNative = ["jackpot", "updown", "h2h", "gainer"].includes(market.marketType);
      if (isWeeklyNative && market.endAt) {
        const bufferMs = JACKPOT_AGENT_MIN_BUFFER_HOURS * 60 * 60 * 1000;
        const cutoff = getMarketBettingCutoff(
          market.endAt,
          market.engine === "parimutuel" ? "parimutuel" : "amm",
          market.marketType ?? undefined,
        );
        if (now.getTime() >= cutoff.getTime() - bufferMs) {
          // Near-close window: arb cohort is handled by runConvergenceSweep.
          if (
            !(
              ARB_COHORT_ENABLED &&
              isArbAgent(agentData) &&
              (market.marketType === "updown" ||
                market.marketType === "h2h" ||
                market.marketType === "gainer")
            )
          ) {
            skipped++;
          }
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

      if (isCommunity && isArbAgent(agentData)) {
        // Arb cohort never burns LLM budget on World Markets — no
        // computeWorldMarketPrediction call. Community convergence trading
        // happens exclusively via `runConvergenceSweepCommunity` (which has
        // the market-per-day dedupe and per-sweep cap); letting the 8 arb
        // agents ALSO trade here would pile onto the same anchor gap once
        // per agent per sweep.
        decision = { abstain: true, abstainReason: "low_edge" };
      } else if (isCommunity) {
        decision = await computeWorldMarketPrediction(agentData, marketData, entries);
      } else {
        const sharpFetch = getSimulationProfile(agent.simulationProfile).personaBand === "sharp";
        // Pull the per-market opening score out of metadata so the deterministic
        // engine can read `signals.pctChangeVsOpen`. Up/Down per-person markets
        // carry it as `metadata.openingScore.score`; H2H / Race resolve their
        // per-entry baselines below via `getEntryOpeningScore`.
        const meta = market.metadata as Record<string, any> | null;
        const openingScore =
          typeof meta?.openingScore?.score === "number"
            ? (meta.openingScore.score as number)
            : null;
        const signals = await getTrendSignals(market.personId, {
          includeMultiWindow: sharpFetch,
          openingScore,
        });
        const crowd = computeCrowdSplit(entries);

        let entrySignals: Map<string, TrendSignals> | undefined;
        if ((market.marketType === "h2h" || market.marketType === "gainer") && entries.some(e => e.personId)) {
          // Parallelise per-entry signal/baseline lookups. H2H = 2 entries,
          // Race = up to ~8. Sequential awaits used to stack 16-24 round
          // trips per market (3 queries deep × N entries); parallel cuts
          // that to one round trip per entry batch. The opening-score
          // cache + multi-window cache absorb most of the cost on later
          // agents' visits anyway, so this mainly helps the first agent
          // through each market.
          const pairs = await Promise.all(
            entries
              .filter((entry) => entry.personId)
              .map(async (entry) => {
                // Per-entry baseline: closest snapshot at-or-before the
                // market's createdAt. This is the Putin fix — without it,
                // pctChangeVsOpen would always be undefined for entries
                // and `decisionEngine` couldn't tilt on direction.
                const entryOpeningScore = market.createdAt
                  ? await getEntryOpeningScore(entry.personId!, market.id, market.createdAt)
                  : null;
                const sig = await getTrendSignals(entry.personId!, {
                  includeMultiWindow: sharpFetch,
                  openingScore: entryOpeningScore,
                });
                return [entry.id, sig] as const;
              }),
          );
          entrySignals = new Map(pairs);
        }

        // High-priority signal for sharps: the LLM market-ranker has flagged
        // this market as one of the top-edge markets for the current sweep.
        // computePrediction will skip its random abstain so the sharp cohort
        // reliably engages with the LLM's picks (model gates still apply).
        const priority: "high" | "normal" =
          sharpFetch && sharpPickedMarketIds.has(market.id) ? "high" : "normal";
        const decisiveLatched = resolveDecisiveLatched(
          meta,
          signals.pctChangeVsOpen,
        );

        const hoursRemaining =
          market.endAt != null
            ? Math.max(0, (market.endAt.getTime() - now.getTime()) / 3_600_000)
            : 7 * 24;

        if (ARB_COHORT_ENABLED && isArbAgent(agentData) && market.marketType === "updown") {
          const snap = ammStateByMarket.get(market.id);
          const prices = snap ? ammCurrentPrices(snap) : {};
          decision = computeArbPrediction(marketData, signals, hoursRemaining, prices);
        } else if (
          ARB_COHORT_ENABLED &&
          isArbAgent(agentData) &&
          market.marketType === "h2h" &&
          isLockInFairH2HEnabled() &&
          entrySignals
        ) {
          const snap = ammStateByMarket.get(market.id);
          const prices = snap ? ammCurrentPrices(snap) : {};
          const scoreByEntryId: Record<string, number> = {};
          for (const entry of entries) {
            const fi = entrySignals.get(entry.id)?.fameIndex;
            if (fi != null && Number.isFinite(fi)) scoreByEntryId[entry.id] = fi;
          }
          decision = computeArbPredictionH2H(
            marketData.entries,
            scoreByEntryId,
            hoursRemaining,
            prices,
          );
        } else if (
          ARB_COHORT_ENABLED &&
          isArbAgent(agentData) &&
          market.marketType === "gainer" &&
          isLockInFairGainerEnabled() &&
          entrySignals
        ) {
          const snap = ammStateByMarket.get(market.id);
          const prices = snap ? ammCurrentPrices(snap) : {};
          const pctByEntryId: Record<string, number | null | undefined> = {};
          for (const entry of entries) {
            pctByEntryId[entry.id] = entrySignals.get(entry.id)?.pctChangeVsOpen;
          }
          decision = computeArbPredictionGainer(
            marketData.entries,
            pctByEntryId,
            hoursRemaining,
            prices,
          );
        } else {
          decision = computePrediction(agentData, marketData, signals, crowd, undefined, entrySignals, {
            priority,
            decisiveLatched,
            nativeAssessment: nativeAssessmentByMarket.get(market.id) ?? null,
            hoursRemaining,
          });
        }
      }

      if (!isArbAgent(agentData)) {
        decision = applySimulationDecisionLayer(agentData, marketData, decision);
      }

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

      // Only feed the LLM ranker's edge/conviction into sizing when the
      // agent ended up on the SAME side as the LLM. If the agent picked
      // the other entry (contrarian persona, deterministic-engine
      // disagreement, etc.) the LLM's `edge` doesn't apply — it was
      // computed for the OTHER side. In that case `null` falls back to
      // the deterministic-engine edge inside computeAgentStakeAmount.
      const rankerPick = sharpPicksByMarketId.get(market.id) ?? null;
      const sidesAgree = rankerPickMatchesChosenEntry(rankerPick, chosenEntry);
      const sizingPick = sidesAgree ? rankerPick : null;

      let stakeAmount = computeAgentStakeAmount(agentData, decision, sizingPick);

      // Persist the LLM ranker's conviction into the queued decision so
      // the worker can scale the AMM edge band for high-conviction trades
      // (see `sizeAmmBudget` + `resolveEdgeBand`). Only stamped when sides
      // agree — sizingPick is already gated on side agreement above.
      if (sizingPick && typeof sizingPick.conviction === "number") {
        decision = { ...decision, rankerConviction: sizingPick.conviction };
      }

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

      // Tag the log with ranker context when this trade was sized off an
      // LLM pick (sides agreed). Lets manual smoke verify "stake amounts
      // vary smoothly with conviction" without reading two log streams.
      const rankerLogTag = sizingPick
        ? ` ranker=[edge=${sizingPick.edge >= 0 ? "+" : ""}${(sizingPick.edge * 100).toFixed(1)}%, conv=${(sizingPick.conviction * 100).toFixed(0)}%, dir=${sizingPick.direction}]`
        : "";

      scheduled++;
      log(`[AgentRunner] ${agent.displayName} → ${market.title?.slice(0, 30)} (engine=${market.engine}, entry=${chosenEntryId.slice(0, 8)}, confidence=${decision.confidence?.toFixed(2)}, stake=${stakeAmount}, source=${decision.source ?? "deterministic"}, execAfter=${executeAfter.toISOString()})${rankerLogTag}`);
    }
  }

  // --- Conviction re-bet sweep ---
  // After the initial scheduling pass, check markets where agents already bet.
  // If the person's score has moved significantly from the baseline, allow a
  // second "conviction" bet (up to CONVICTION_MAX_PER_MARKET per agent per market).
  let convictionScheduled = 0;
  try {
    convictionScheduled = await runConvictionSweep(
      agents,
      markets,
      now,
      updownSweepCtx.marketContext,
    );
  } catch (convErr) {
    log(`[AgentRunner] Conviction sweep error: ${convErr instanceof Error ? convErr.message : convErr}`);
  }

  let repredictScheduled = 0;
  try {
    repredictScheduled = await runRepredictSweep(
      agents,
      markets,
      now,
      updownSweepCtx,
    );
  } catch (repredictErr) {
    log(`[AgentRunner] Repredict sweep error: ${repredictErr instanceof Error ? repredictErr.message : repredictErr}`);
  }

  try {
    await touchWeeklyOpenMetadataLatch(markets, updownSweepCtx.marketContext);
  } catch (latchErr) {
    log(`[AgentRunner] weeklyOpen latch error: ${latchErr instanceof Error ? latchErr.message : latchErr}`);
  }

  // Sell sweep — Agent v3 phase 1. Independent of conviction sweep on
  // purpose: a market that just triggered a conviction add-on still
  // gets evaluated for sells (the runner's idempotency check below
  // makes them mutually exclusive at the per-(agent, market) level).
  let convergenceScheduled = 0;
  try {
    convergenceScheduled = await runConvergenceSweep(
      agents,
      markets,
      now,
      updownSweepCtx,
    );
    convergenceScheduled += await runConvergenceSweepH2H(agents, markets, now);
    convergenceScheduled += await runConvergenceSweepGainer(agents, markets, now);
    convergenceScheduled += await runMidweekConvergenceSweep(
      agents,
      markets,
      now,
      updownSweepCtx,
    );
    convergenceScheduled += await runConvergenceSweepCommunity(agents, markets, now);
  } catch (convSweepErr) {
    log(
      `[AgentRunner] Convergence sweep error: ${convSweepErr instanceof Error ? convSweepErr.message : convSweepErr}`,
    );
  }

  let sellsScheduled = 0;
  try {
    sellsScheduled = await runSellSweep(
      agents,
      markets,
      updownSweepCtx.marketContext,
    );
  } catch (sellErr) {
    log(`[AgentRunner] Sell sweep error: ${sellErr instanceof Error ? sellErr.message : sellErr}`);
  }

  const exitStats = {
    scheduled,
    abstained,
    skipped,
    skippedNoEntries,
    skippedNoEntryId,
    convictionScheduled,
    repredictScheduled,
    convergenceScheduled,
    sellsScheduled,
  };
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
 * Conviction re-bet sweep: for each agent, look at markets they already
 * bet on where the LMSR price has moved against (or for) their position
 * and schedule a follow-up bet.
 *
 * Parimutuel sunset: this used to fork between a fameIndex-vs-baseline
 * trigger (parimutuel) and an AMM-price-vs-original-fill trigger (AMM).
 * Only the AMM path remains — every non-jackpot updown market is AMM
 * now, and jackpot doesn't take conviction follow-ups (single-shot
 * exact-score guess).
 *
 * Anchor = the price the agent paid on their first AMM buy in the
 * market. Re-uses `sizeAmmBudget` for the second-leg sizing so the
 * conviction bet respects the same per-trade price-move cap as a fresh
 * bet.
 */
type UpdownMarketRow = {
  id: string;
  personId: string | null;
  marketType: string | null;
  openMarketType?: string | null;
  title: string | null;
  engine?: string | null;
  metadata?: unknown;
  endAt?: Date | null;
  createdAt?: Date | null;
};

function filterAmmPerPersonUpdown(
  allMarkets: UpdownMarketRow[],
): UpdownMarketRow[] {
  return allMarkets.filter(
    (m) => m.personId && m.marketType === "updown" && m.engine === "amm",
  );
}

/**
 * Per-sweep cache of the data every score-aware sub-sweep needs:
 *   - `marketContext` — UP/DOWN entry IDs + `pctChangeVsOpen` per market
 *   - `signalsByPerson` — full `TrendSignals` keyed by personId (reused by
 *     `runRepredictSweep` when it calls `computePrediction`)
 *
 * Built once at the top of `runAgentBatchOnce` and threaded through the
 * sub-sweeps to avoid 4-5 duplicate `buildUpdownMarketContext` calls per
 * batch, each of which would re-query market entries and re-hit
 * `getTrendSignals` for every person in the catalogue.
 */
export interface UpdownSweepContext {
  marketContext: Map<
    string,
    { upEntryId: string; downEntryId: string; pctChangeVsOpen: number }
  >;
  signalsByPerson: Map<string, TrendSignals>;
}

async function buildUpdownSweepContext(
  ammUpdown: UpdownMarketRow[],
): Promise<UpdownSweepContext> {
  const marketContext = new Map<
    string,
    { upEntryId: string; downEntryId: string; pctChangeVsOpen: number }
  >();
  const signalsByPerson = new Map<string, TrendSignals>();
  if (!ammUpdown.length) return { marketContext, signalsByPerson };

  const entryRows = await db
    .select({
      marketId: marketEntries.marketId,
      id: marketEntries.id,
      label: marketEntries.label,
    })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, ammUpdown.map((m) => m.id)));

  const entriesByMarket = new Map<string, { id: string; label: string | null }[]>();
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({ id: row.id, label: row.label });
    entriesByMarket.set(row.marketId, list);
  }

  for (const market of ammUpdown) {
    const entries = entriesByMarket.get(market.id) ?? [];
    const ids = upDownEntryIds(entries);
    if (!ids || !market.personId) continue;

    const openingScore = openingScoreFromMeta(
      market.metadata as Record<string, unknown> | null,
    );
    if (openingScore == null) continue;

    let signals = signalsByPerson.get(market.personId);
    if (!signals) {
      signals = await getTrendSignals(market.personId, { openingScore });
      signalsByPerson.set(market.personId, signals);
    }
    if (signals.pctChangeVsOpen == null) continue;

    marketContext.set(market.id, {
      ...ids,
      pctChangeVsOpen: signals.pctChangeVsOpen,
    });
  }

  return { marketContext, signalsByPerson };
}

/** Back-compat shim — returns only the `marketContext` map. */
async function buildUpdownMarketContext(
  ammUpdown: UpdownMarketRow[],
): Promise<UpdownSweepContext["marketContext"]> {
  const ctx = await buildUpdownSweepContext(ammUpdown);
  return ctx.marketContext;
}

async function pickMispricedUpdownMarketIds(
  nativeMarkets: UpdownMarketRow[],
  limit: number,
  preBuiltCtx?: UpdownSweepContext["marketContext"],
): Promise<string[]> {
  const candidates = nativeMarkets.filter(
    (m) => m.personId && m.marketType === "updown" && m.engine === "amm",
  );
  if (!candidates.length || limit <= 0) return [];

  const ctx = preBuiltCtx ?? (await buildUpdownMarketContext(candidates));
  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, candidates.map((m) => m.id)));

  const scored: { id: string; gap: number }[] = [];
  for (const row of stateRows) {
    const b = Number(row.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    const snap: AmmStateSnapshot = {
      liquidityB: b,
      outcomeOrder: row.outcomeOrder as string[],
      shareQuantities: row.shareQuantities as Record<string, number>,
    };
    const marketCtx = ctx.get(row.marketId);
    if (!marketCtx) continue;
    const prices = ammCurrentPrices(snap);
    const upPrice = prices[marketCtx.upEntryId] ?? 0.5;
    const pct = marketCtx.pctChangeVsOpen;
    let gap = 0;
    if (pct < -MISPRICED_SCORE_PCT && upPrice > MISPRICED_UP_PRICE_HIGH) {
      gap = upPrice - 0.5 + Math.abs(pct);
    } else if (pct > MISPRICED_SCORE_PCT && upPrice < MISPRICED_UP_PRICE_LOW) {
      gap = 0.5 - upPrice + Math.abs(pct);
    }
    if (gap > 0) scored.push({ id: row.marketId, gap });
  }

  scored.sort((a, b) => b.gap - a.gap);
  return scored.slice(0, limit).map((s) => s.id);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function fetchTrailingFameSamplesByPerson(
  personIds: string[],
  sampleCount: number,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (!personIds.length || sampleCount <= 0) return result;

  const rows = (await db.execute(sql`
    SELECT person_id, fame_index
    FROM (
      SELECT
        person_id,
        fame_index,
        ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY timestamp DESC) AS rn
      FROM trend_snapshots
      WHERE person_id IN (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})
    ) ranked
    WHERE rn <= ${sampleCount}
    ORDER BY person_id, rn
  `)).rows as Array<{ person_id: string; fame_index: number }>;

  for (const row of rows) {
    const fame = Number(row.fame_index);
    if (!Number.isFinite(fame)) continue;
    const list = result.get(row.person_id) ?? [];
    list.push(fame);
    result.set(row.person_id, list);
  }
  return result;
}

async function pickMidweekConvergenceMarketIds(
  candidates: UpdownMarketRow[],
  limit: number,
  ctx: UpdownSweepContext,
  now: Date,
  minEdgePp: number,
): Promise<string[]> {
  const bufferMs = JACKPOT_AGENT_MIN_BUFFER_HOURS * 60 * 60 * 1000;
  const outsideNearClose = candidates.filter((m) => {
    if (!m.endAt) return false;
    const cutoff = getMarketBettingCutoff(m.endAt, "amm", m.marketType ?? undefined);
    return now.getTime() < cutoff.getTime() - bufferMs;
  });
  if (!outsideNearClose.length || limit <= 0) return [];

  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, outsideNearClose.map((m) => m.id)));

  const scored: { id: string; gap: number }[] = [];
  for (const row of stateRows) {
    const b = Number(row.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    const marketCtx = ctx.marketContext.get(row.marketId);
    if (!marketCtx) continue;

    const market = outsideNearClose.find((m) => m.id === row.marketId);
    if (!market?.endAt) continue;

    const pct = marketCtx.pctChangeVsOpen;
    const hoursRemaining = Math.max(0, (market.endAt.getTime() - now.getTime()) / 3_600_000);
    const fairUp = computeLockInFairUp(pct, hoursRemaining);
    if (fairUp == null) continue;

    const snap: AmmStateSnapshot = {
      liquidityB: b,
      outcomeOrder: row.outcomeOrder as string[],
      shareQuantities: row.shareQuantities as Record<string, number>,
    };
    const prices = ammCurrentPrices(snap);

    const upFair =
      fairForEntry(fairUp, "Up", POSITIVE_HINTS, NEGATIVE_HINTS) ?? 0.5;
    const downFair =
      fairForEntry(fairUp, "Down", POSITIVE_HINTS, NEGATIVE_HINTS) ?? 0.5;
    const upPrice = prices[marketCtx.upEntryId] ?? 0.5;
    const downPrice = prices[marketCtx.downEntryId] ?? 0.5;

    const upGap = upFair - upPrice;
    const downGap = downFair - downPrice;
    const gap = Math.max(upGap, downGap);
    if (gap >= minEdgePp) {
      scored.push({ id: row.marketId, gap });
    }
  }

  scored.sort((a, b) => b.gap - a.gap);
  return scored.slice(0, limit).map((s) => s.id);
}

async function touchWeeklyOpenMetadataLatch(
  allMarkets: UpdownMarketRow[],
  preBuiltCtx?: UpdownSweepContext["marketContext"],
): Promise<void> {
  const ammUpdown = filterAmmPerPersonUpdown(allMarkets);
  if (!ammUpdown.length) return;

  const ctx = preBuiltCtx ?? (await buildUpdownMarketContext(ammUpdown));
  const now = new Date();

  if (isLatchRevertShadow()) {
    for (const market of ammUpdown) {
      const meta = (market.metadata ?? {}) as Record<string, unknown>;
      const weekly = readWeeklyOpen(meta);
      if (!weekly.decisiveLatched) continue;
      const pct = ctx.get(market.id)?.pctChangeVsOpen;
      log(
        `[LatchRevert][shadow] market=${market.id.slice(0, 8)} pct=${pct != null ? pct.toFixed(3) : "n/a"} wouldDisarm=${wouldDisarmLatch(meta, pct)}`,
      );
    }
  }

  const personIds = [
    ...new Set(
      ammUpdown.map((m) => m.personId).filter((id): id is string => id != null),
    ),
  ];
  const trailingSamples = await fetchTrailingFameSamplesByPerson(
    personIds,
    LATCH_TRAILING_SAMPLE_COUNT,
  );

  const updates: Promise<unknown>[] = [];
  for (const market of ammUpdown) {
    if (!market.personId) continue;
    const openingScore = openingScoreFromMeta(
      market.metadata as Record<string, unknown> | null,
    );
    if (openingScore == null) continue;

    const samples = trailingSamples.get(market.personId) ?? [];
    const { latch, medianPct } = shouldLatchFromTrailingMedian(samples, openingScore);
    if (!latch || medianPct == null) continue;

    const pct = medianPct;
    const meta = (market.metadata ?? {}) as Record<string, unknown>;
    const weekly = readWeeklyOpen(meta);
    const nextPeak = Math.max(weekly.peakAbsPctChangeVsOpen ?? 0, Math.abs(pct));
    if (weekly.decisiveLatched === true && nextPeak === weekly.peakAbsPctChangeVsOpen) {
      continue;
    }
    const nextMeta = {
      ...meta,
      weeklyOpen: {
        ...weekly,
        decisiveLatched: true,
        peakAbsPctChangeVsOpen: nextPeak,
      },
    };

    updates.push(
      db
        .update(predictionMarkets)
        .set({ metadata: nextMeta, updatedAt: now })
        .where(eq(predictionMarkets.id, market.id)),
    );
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }
}

async function runConvictionSweep(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: UpdownMarketRow[],
  _now: Date,
  preBuiltCtx?: UpdownSweepContext["marketContext"],
): Promise<number> {
  let convictionScheduled = 0;

  const ammUpdown = filterAmmPerPersonUpdown(allMarkets);
  if (!ammUpdown.length) return 0;

  const marketContext =
    preBuiltCtx ?? (await buildUpdownMarketContext(ammUpdown));

  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
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

    // One-shot existence query for this agent across every in-scope
    // updown market. Replaces the N-queries-per-agent pattern that
    // the sell sweep already optimised away (~2,800 round-trips on
    // a 56-agent / 50-market sweep before this change).
    const existingConvictionRows = await db
      .select({
        marketId: scheduledAgentActions.marketId,
      })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.agentId, agent.id),
          inArray(scheduledAgentActions.marketId, ammUpdown.map((m) => m.id)),
          eq(scheduledAgentActions.actionType, "conviction"),
          sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`,
        ),
      );
    const convictionCountByMarket = new Map<string, number>();
    for (const row of existingConvictionRows) {
      convictionCountByMarket.set(
        row.marketId,
        (convictionCountByMarket.get(row.marketId) ?? 0) + 1,
      );
    }

    for (const market of ammUpdown) {
      const state = ammStateByMarket.get(market.id);
      if (!state) continue;
      const anchor = anchorByMarket.get(market.id);
      if (!anchor) continue;

      if (
        (convictionCountByMarket.get(market.id) ?? 0) >=
        CONVICTION_MAX_PER_MARKET
      ) {
        continue;
      }

      const mctx = marketContext.get(market.id);
      if (!mctx) continue;

      const followUp = computeConvictionFollowUp({
        anchorEntryId: anchor.entryId,
        upEntryId: mctx.upEntryId,
        downEntryId: mctx.downEntryId,
        pctChangeVsOpen: mctx.pctChangeVsOpen,
        contrarianism: parseFloat(String(agent.contrarianism ?? 0)),
      });
      if (!followUp) continue;

      const livePrice = ammCurrentPrices(state)[followUp.chosenEntryId] ?? 0;

      const sizing = sizeAmmBudget({
        state,
        entryId: followUp.chosenEntryId,
        confidence: followUp.confidence,
        maxBudget: Math.min(
          MAX_AGENT_STAKE,
          computeStakeAmount(followUp.confidence),
        ),
      });
      if (sizing.creditBudget === 0) continue;

      const executeAfter = computeExecuteAfter(agent.archetype);

      await db.insert(scheduledAgentActions).values({
        agentId: agent.id,
        marketId: market.id,
        entryId: followUp.chosenEntryId,
        actionType: "conviction",
        decisionPayload: {
          abstain: false,
          entryId: followUp.chosenEntryId,
          confidence: followUp.confidence,
          scorePctChangeVsOpen: parseFloat(mctx.pctChangeVsOpen.toFixed(4)),
          scoreAgreesWithHold: followUp.scoreAgreesWithHold,
          flipApplied: followUp.flipApplied,
          originalEntryId: anchor.entryId,
          doubled: followUp.doubled,
          ammAnchorPrice: anchor.pricePerShare,
          ammLivePrice: livePrice,
        },
        stakeAmount: sizing.creditBudget,
        executeAfter,
        status: "pending",
      });

      convictionScheduled++;
      const action = followUp.doubled ? "doubled down" : "flipped";
      log(
        `[AgentRunner] Score Conviction: ${agent.displayName} ${action} on ${market.title?.slice(0, 30)} (vsOpen=${(mctx.pctChangeVsOpen * 100).toFixed(1)}% agrees=${followUp.scoreAgreesWithHold} sized=${sizing.creditBudget})`,
      );
    }
  }

  if (convictionScheduled > 0) {
    log(`[AgentRunner] Conviction sweep scheduled ${convictionScheduled} re-bets`);
  }

  return convictionScheduled;
}

/**
 * One score-driven "change mind" per agent per AMM up/down market when
 * the weekly-open move crosses REPREDICT_PCT_THRESHOLD and the agent's
 * net position is on the wrong side.
 */
async function runRepredictSweep(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: UpdownMarketRow[],
  now: Date,
  preBuiltCtx?: UpdownSweepContext,
): Promise<number> {
  let repredictScheduled = 0;
  const ammUpdown = filterAmmPerPersonUpdown(allMarkets);
  if (!ammUpdown.length) return 0;

  const sweepCtx = preBuiltCtx ?? (await buildUpdownSweepContext(ammUpdown));
  const marketContext = sweepCtx.marketContext;
  const signalsByPerson = sweepCtx.signalsByPerson;
  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
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

  const entryRows = await db
    .select({
      id: marketEntries.id,
      marketId: marketEntries.marketId,
      label: marketEntries.label,
      totalStake: marketEntries.totalStake,
      noStake: marketEntries.noStake,
      personId: marketEntries.personId,
    })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, ammUpdown.map((m) => m.id)));

  const entriesByMarket = new Map<string, MarketWithEntries["entries"]>();
  for (const market of ammUpdown) {
    const entries = entryRows
      .filter((e) => e.marketId === market.id)
      .map((e) => ({
        id: e.id,
        label: e.label,
        totalStake: e.totalStake,
        noStake: e.noStake,
        personId: e.personId,
      }));
    entriesByMarket.set(market.id, entries);
  }

  const nativeAssessmentByMarket = await prefetchNativeAssessmentsForSweep(
    ammUpdown
      .filter((m) => m.personId)
      .map((market) => {
        const entries = entriesByMarket.get(market.id) ?? [];
        const signals = signalsByPerson.get(market.personId!) ?? {
          trendScore: 50,
          fameIndex: 5000,
          scoreBaseline: 5000,
          scoreDelta7d: 0,
          change24h: 0,
          momentum: "Unknown",
          trendDirection: "FLAT",
        };
        return {
          market: {
            id: market.id,
            marketType: "updown" as const,
            openMarketType: market.openMarketType ?? null,
            status: "OPEN" as const,
            title: market.title ?? "",
            category: null,
            personId: market.personId,
            endAt: market.endAt ?? null,
            createdAt: market.createdAt ?? null,
            metadata: market.metadata,
            entries,
          },
          signals,
        };
      }),
  );

  for (const agent of agents) {
    const agentData = toAgentData(agent);

    const ammBets = await db
      .select({
        marketId: marketBets.marketId,
        entryId: marketBets.entryId,
        actionType: marketBets.actionType,
        shareCount: marketBets.shareCount,
        pricePerShare: marketBets.pricePerShare,
        confidence: marketBets.confidence,
        createdAt: marketBets.createdAt,
      })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.agentId, agent.id),
          inArray(marketBets.marketId, ammUpdown.map((m) => m.id)),
        ),
      )
      .orderBy(marketBets.createdAt);

    if (!ammBets.length) continue;

    const positions = aggregateSellSweepPositions(ammBets);
    const largestPositionByMarket = pickLargestPositionsByMarket(positions);
    if (largestPositionByMarket.size === 0) continue;

    // Batch the "is there already a repredict?" gate into one query
    // per agent instead of one per (agent, market) — same pattern as
    // the conviction sweep optimisation just above.
    const existingRepredictRows = await db
      .select({ marketId: scheduledAgentActions.marketId })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.agentId, agent.id),
          inArray(scheduledAgentActions.marketId, ammUpdown.map((m) => m.id)),
          eq(scheduledAgentActions.actionType, "repredict"),
          sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`,
        ),
      );
    const repredictCountByMarket = new Map<string, number>();
    for (const row of existingRepredictRows) {
      repredictCountByMarket.set(
        row.marketId,
        (repredictCountByMarket.get(row.marketId) ?? 0) + 1,
      );
    }

    for (const market of ammUpdown) {
      const mctx = marketContext.get(market.id);
      if (!mctx) continue;
      if (Math.abs(mctx.pctChangeVsOpen) < REPREDICT_PCT_THRESHOLD) continue;

      const entries = entriesByMarket.get(market.id) ?? [];
      const ids = upDownEntryIds(entries);
      if (!ids) continue;

      const held = largestPositionByMarket.get(market.id);
      if (!held) continue;
      const heldEntryId = held.entryId;

      // Use REPREDICT_PCT_THRESHOLD for the scoreFavours check so the
      // two thresholds stay aligned: we already gated on |pct| >= that
      // value just above, so a heldIsUp position with pct <= -threshold
      // is unambiguously "wrong side".
      const heldIsUp = heldEntryId === ids.upEntryId;
      const wrongSide =
        (heldIsUp && mctx.pctChangeVsOpen <= -REPREDICT_PCT_THRESHOLD) ||
        (!heldIsUp && mctx.pctChangeVsOpen >= REPREDICT_PCT_THRESHOLD);
      if (!wrongSide) continue;

      if (market.endAt) {
        const cutoff = getMarketBettingCutoff(market.endAt, "amm", market.marketType ?? undefined);
        const bufferMs = JACKPOT_AGENT_MIN_BUFFER_HOURS * 60 * 60 * 1000;
        if (now.getTime() >= cutoff.getTime() - bufferMs) continue;
      }

      if (
        (repredictCountByMarket.get(market.id) ?? 0) >=
        REPREDICT_MAX_PER_MARKET
      ) {
        continue;
      }

      const meta = market.metadata as Record<string, unknown> | null;
      // Re-use the TrendSignals already loaded by buildUpdownSweepContext
      // for this person. Falls back to a fresh fetch only if the cache
      // missed (e.g. market entered scope after the context was built).
      let signals = market.personId
        ? signalsByPerson.get(market.personId)
        : undefined;
      if (!signals) {
        const openingScore = openingScoreFromMeta(meta);
        signals = await getTrendSignals(market.personId!, { openingScore });
        if (market.personId) signalsByPerson.set(market.personId, signals);
      }
      const decisiveLatched = resolveDecisiveLatched(meta, signals.pctChangeVsOpen);
      const marketData: MarketWithEntries = {
        id: market.id,
        marketType: "updown",
        status: "OPEN",
        title: market.title ?? "",
        category: null,
        personId: market.personId,
        endAt: market.endAt ?? null,
        createdAt: market.createdAt ?? null,
        entries,
      };

      const hoursRemaining =
        market.endAt != null
          ? Math.max(0, (market.endAt.getTime() - now.getTime()) / 3_600_000)
          : 7 * 24;

      let decision = computePrediction(
        agentData,
        marketData,
        signals,
        computeCrowdSplit(entries),
        undefined,
        undefined,
        {
          decisiveLatched,
          nativeAssessment: nativeAssessmentByMarket.get(market.id) ?? null,
          hoursRemaining,
        },
      );
      decision = applySimulationDecisionLayer(agentData, marketData, decision);
      if (decision.abstain || !decision.entryId) continue;
      if (decision.entryId === heldEntryId) continue;

      const state = ammStateByMarket.get(market.id);
      const conf = decision.confidence ?? 0.5;
      if (state && decision.entryId) {
        const cur = ammCurrentPrices(state)[decision.entryId] ?? 0;
        if (conf <= cur + 0.02) continue;
      }

      const executeAfter = computeExecuteAfter(agent.archetype);
      const stakeAmount = computeAgentStakeAmount(agentData, decision, null);

      await db.insert(scheduledAgentActions).values({
        agentId: agent.id,
        marketId: market.id,
        entryId: decision.entryId,
        actionType: "repredict",
        decisionPayload: {
          ...decision,
          repredictFromEntryId: heldEntryId,
          scorePctChangeVsOpen: mctx.pctChangeVsOpen,
        },
        stakeAmount: Math.max(
          BASE_STAKE_AMOUNT,
          Math.min(MAX_AGENT_STAKE * 3, stakeAmount),
        ),
        executeAfter,
        status: "pending",
      });

      repredictScheduled++;
      log(
        `[AgentRunner] Repredict: ${agent.displayName} on ${market.title?.slice(0, 30)} (${heldIsUp ? "UP" : "DOWN"} -> ${decision.entryId === ids.upEntryId ? "UP" : "DOWN"}, vsOpen=${(mctx.pctChangeVsOpen * 100).toFixed(1)}%)`,
      );
    }
  }

  if (repredictScheduled > 0) {
    log(`[AgentRunner] Repredict sweep scheduled ${repredictScheduled} actions`);
  }

  return repredictScheduled;
}

/**
 * Near-close convergence sweep — arb cohort only, inside the final-hours
 * window the main agent loop skips. Walks decided up/down markets toward
 * lock-in fair when |fair − price| exceeds ARB_MIN_EDGE_PP.
 */
async function runConvergenceSweep(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: UpdownMarketRow[],
  now: Date,
  ctx: UpdownSweepContext,
): Promise<number> {
  if (!ARB_COHORT_ENABLED) return 0;

  const arbAgents = agents.filter((a) => isArbAgent(toAgentData(a)));
  if (!arbAgents.length) return 0;

  const ammUpdown = filterAmmPerPersonUpdown(allMarkets);
  if (!ammUpdown.length) return 0;

  const bufferMs = JACKPOT_AGENT_MIN_BUFFER_HOURS * 60 * 60 * 1000;
  const nearCloseMarkets = ammUpdown.filter((m) => {
    if (!m.endAt) return false;
    const cutoff = getMarketBettingCutoff(m.endAt, "amm", m.marketType ?? undefined);
    const t = now.getTime();
    return t >= cutoff.getTime() - bufferMs && t <= cutoff.getTime();
  });
  if (!nearCloseMarkets.length) return 0;

  const priorityIds = await pickMispricedUpdownMarketIds(
    nearCloseMarkets,
    ARB_CONVERGENCE_MARKETS_PER_SWEEP,
    ctx.marketContext,
  );
  const targetIds = new Set(
    priorityIds.length > 0
      ? priorityIds
      : nearCloseMarkets.slice(0, ARB_CONVERGENCE_MARKETS_PER_SWEEP).map((m) => m.id),
  );

  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, Array.from(targetIds)));

  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
  for (const row of stateRows) {
    const b = Number(row.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    ammStateByMarket.set(row.marketId, {
      liquidityB: b,
      outcomeOrder: row.outcomeOrder as string[],
      shareQuantities: row.shareQuantities as Record<string, number>,
    });
  }

  const entriesByMarket = new Map<string, { id: string; label: string | null }[]>();
  const entryRows = await db
    .select({ marketId: marketEntries.marketId, id: marketEntries.id, label: marketEntries.label })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, Array.from(targetIds)));
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({ id: row.id, label: row.label });
    entriesByMarket.set(row.marketId, list);
  }

  let scheduled = 0;
  let agentIdx = 0;

  for (const market of nearCloseMarkets) {
    if (!targetIds.has(market.id)) continue;
    const mctx = ctx.marketContext.get(market.id);
    if (!mctx) continue;

    const entries = entriesByMarket.get(market.id) ?? [];
    if (entries.length !== 2) continue;

    let signals = market.personId ? ctx.signalsByPerson.get(market.personId) : undefined;
    if (!signals && market.personId) {
      const meta = market.metadata as Record<string, unknown> | null;
      const openingScore =
        typeof (meta?.openingScore as { score?: number } | undefined)?.score === "number"
          ? (meta!.openingScore as { score: number }).score
          : null;
      signals = await getTrendSignals(market.personId, { openingScore });
      ctx.signalsByPerson.set(market.personId, signals);
    }
    if (!signals) continue;

    const hoursRemaining =
      market.endAt != null
        ? Math.max(0, (market.endAt.getTime() - now.getTime()) / 3_600_000)
        : 0;

    const snap = ammStateByMarket.get(market.id);
    if (!snap) continue;
    const prices = ammCurrentPrices(snap);

    const agent = arbAgents[agentIdx % arbAgents.length];
    agentIdx++;
    const agentData = toAgentData(agent);

    const marketData: MarketWithEntries = {
      id: market.id,
      marketType: "updown",
      status: "OPEN",
      title: market.title ?? "",
      category: null,
      personId: market.personId,
      endAt: market.endAt ?? null,
      createdAt: market.createdAt ?? null,
      entries: entries.map((e) => ({
        id: e.id,
        label: e.label ?? "",
        totalStake: 0,
        noStake: 0,
        personId: market.personId,
      })),
    };

    const decision = computeArbPrediction(marketData, signals, hoursRemaining, prices);
    if (decision.abstain || !decision.entryId) continue;

    const existing = await db
      .select({ id: scheduledAgentActions.id })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.agentId, agent.id),
          eq(scheduledAgentActions.marketId, market.id),
          sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`,
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    const stakeAmount = computeAgentStakeAmount(agentData, decision, null);
    const executeAfter = new Date(now.getTime() + 60_000);

    await db.insert(scheduledAgentActions).values({
      agentId: agent.id,
      marketId: market.id,
      entryId: decision.entryId,
      actionType: "buy",
      decisionPayload: { ...decision, convergenceSweep: true },
      stakeAmount,
      executeAfter,
      status: "pending",
    });
    scheduled++;
    log(
      `[AgentRunner] Convergence ${agent.displayName} → ${market.title?.slice(0, 28)} conf=${decision.confidence?.toFixed(2)} stake=${stakeAmount}`,
    );
  }

  if (scheduled > 0) {
    log(`[AgentRunner] Convergence sweep scheduled ${scheduled} actions`);
  }
  return scheduled;
}

/**
 * Mid-week convergence — arb cohort nudges genuinely decisive up/down markets
 * toward lock-in fair before the final-6h near-close window. Higher edge bar
 * than the near-close sweep to limit thrash.
 */
async function runMidweekConvergenceSweep(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: UpdownMarketRow[],
  now: Date,
  ctx: UpdownSweepContext,
): Promise<number> {
  const shadow = isMidweekConvergenceShadow();
  const enabled = isMidweekConvergenceEnabled();
  if (!shadow && !enabled) return 0;
  if (!ARB_COHORT_ENABLED) return 0;

  const arbAgents = agents.filter((a) => isArbAgent(toAgentData(a)));
  if (!arbAgents.length) return 0;

  const ammUpdown = filterAmmPerPersonUpdown(allMarkets);
  if (!ammUpdown.length) return 0;

  const targetIds = new Set(
    await pickMidweekConvergenceMarketIds(
      ammUpdown,
      ARB_CONVERGENCE_MARKETS_PER_SWEEP,
      ctx,
      now,
      ARB_MIDWEEK_MIN_EDGE_PP,
    ),
  );
  if (!targetIds.size) return 0;

  const dayStart = startOfUtcDay(now);

  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, Array.from(targetIds)));

  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
  for (const row of stateRows) {
    const b = Number(row.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    ammStateByMarket.set(row.marketId, {
      liquidityB: b,
      outcomeOrder: row.outcomeOrder as string[],
      shareQuantities: row.shareQuantities as Record<string, number>,
    });
  }

  const entriesByMarket = new Map<string, { id: string; label: string | null }[]>();
  const entryRows = await db
    .select({ marketId: marketEntries.marketId, id: marketEntries.id, label: marketEntries.label })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, Array.from(targetIds)));
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({ id: row.id, label: row.label });
    entriesByMarket.set(row.marketId, list);
  }

  let scheduled = 0;
  let agentIdx = 0;

  for (const market of ammUpdown) {
    if (!targetIds.has(market.id)) continue;
    const mctx = ctx.marketContext.get(market.id);
    if (!mctx) continue;

    const entries = entriesByMarket.get(market.id) ?? [];
    if (entries.length !== 2) continue;

    let signals = market.personId ? ctx.signalsByPerson.get(market.personId) : undefined;
    if (!signals && market.personId) {
      const meta = market.metadata as Record<string, unknown> | null;
      const openingScore = openingScoreFromMeta(meta);
      if (openingScore == null) continue;
      signals = await getTrendSignals(market.personId, { openingScore });
      ctx.signalsByPerson.set(market.personId, signals);
    }
    if (!signals) continue;

    const hoursRemaining =
      market.endAt != null
        ? Math.max(0, (market.endAt.getTime() - now.getTime()) / 3_600_000)
        : 0;

    const snap = ammStateByMarket.get(market.id);
    if (!snap) continue;
    const prices = ammCurrentPrices(snap);

    const agent = arbAgents[agentIdx % arbAgents.length];
    agentIdx++;
    const agentData = toAgentData(agent);

    const marketData: MarketWithEntries = {
      id: market.id,
      marketType: "updown",
      status: "OPEN",
      title: market.title ?? "",
      category: null,
      personId: market.personId,
      endAt: market.endAt ?? null,
      createdAt: market.createdAt ?? null,
      entries: entries.map((e) => ({
        id: e.id,
        label: e.label ?? "",
        totalStake: 0,
        noStake: 0,
        personId: market.personId,
      })),
    };

    const decision = computeArbPrediction(marketData, signals, hoursRemaining, prices, {
      minEdgePp: ARB_MIDWEEK_MIN_EDGE_PP,
      allowUnfavoredSide: true,
      decisivePct: ARB_MIDWEEK_DECISIVE_PCT,
    });

    const fairUp = computeLockInFairUp(signals.pctChangeVsOpen ?? null, hoursRemaining);
    const upFair = fairUp != null ? fairForEntry(fairUp, "Up", POSITIVE_HINTS, NEGATIVE_HINTS) : null;
    const upPrice = prices[mctx.upEntryId] ?? 0.5;
    const gap = upFair != null ? Math.abs(upFair - upPrice) : 0;

    if (shadow) {
      const chosenLabel = decision.entryId
        ? entries.find((e) => e.id === decision.entryId)?.label ?? "?"
        : "-";
      log(
        `[MidweekConvergence][shadow] market=${market.id.slice(0, 8)} gap=${gap.toFixed(3)} ` +
          `wouldSchedule=${!decision.abstain && decision.entryId != null} ` +
          `side=${chosenLabel} pct=${((signals.pctChangeVsOpen ?? 0) * 100).toFixed(1)}%`,
      );
    }

    if (!enabled) continue;
    if (decision.abstain || !decision.entryId) continue;

    const [recentMidweek] = await db
      .select({ id: scheduledAgentActions.id })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.marketId, market.id),
          sql`${scheduledAgentActions.decisionPayload}->>'midweekConvergenceSweep' = 'true'`,
          gte(scheduledAgentActions.createdAt, dayStart),
        ),
      )
      .limit(1);
    if (recentMidweek) continue;

    const existing = await db
      .select({ id: scheduledAgentActions.id })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.agentId, agent.id),
          eq(scheduledAgentActions.marketId, market.id),
          sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`,
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    const stakeAmount = computeAgentStakeAmount(agentData, decision, null);
    const executeAfter = new Date(now.getTime() + 60_000);

    await db.insert(scheduledAgentActions).values({
      agentId: agent.id,
      marketId: market.id,
      entryId: decision.entryId,
      actionType: "buy",
      decisionPayload: { ...decision, midweekConvergenceSweep: true },
      stakeAmount,
      executeAfter,
      status: "pending",
    });
    scheduled++;
    log(
      `[AgentRunner] Midweek convergence ${agent.displayName} → ${market.title?.slice(0, 28)} conf=${decision.confidence?.toFixed(2)} stake=${stakeAmount}`,
    );
  }

  if (scheduled > 0) {
    log(`[AgentRunner] Midweek convergence sweep scheduled ${scheduled} actions`);
  }
  return scheduled;
}

/**
 * Community convergence — arb cohort trades scouted World Markets toward
 * their source anchor (Polymarket consensus prices in metadata.source,
 * refreshed daily by the source watcher). Deterministic, zero LLM cost.
 *
 * Mirrors the mid-week up/down sweep: shadow/enable flags, one convergence
 * action per market per UTC day (the anchor refreshes daily, so more would
 * be thrash), biggest-gap markets first, capped per sweep. Manual
 * (non-scouted) markets have no anchor and are never touched.
 */
async function runConvergenceSweepCommunity(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: UpdownMarketRow[],
  now: Date,
): Promise<number> {
  const shadow = isCommunityConvergenceShadow();
  const enabled = isCommunityConvergenceEnabled();
  if (!shadow && !enabled) return 0;
  if (!ARB_COHORT_ENABLED) return 0;

  const arbAgents = agents.filter((a) => isArbAgent(toAgentData(a)));
  if (!arbAgents.length) return 0;

  const communityAmm = allMarkets.filter(
    (m) => m.marketType === "community" && m.engine === "amm",
  );
  if (!communityAmm.length) return 0;

  const marketIds = communityAmm.map((m) => m.id);

  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, marketIds));
  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
  for (const row of stateRows) {
    const b = Number(row.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    ammStateByMarket.set(row.marketId, {
      liquidityB: b,
      outcomeOrder: row.outcomeOrder as string[],
      shareQuantities: row.shareQuantities as Record<string, number>,
    });
  }

  const entriesByMarket = new Map<string, { id: string; label: string | null }[]>();
  const entryRows = await db
    .select({ marketId: marketEntries.marketId, id: marketEntries.id, label: marketEntries.label })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, marketIds));
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({ id: row.id, label: row.label });
    entriesByMarket.set(row.marketId, list);
  }

  // Rank candidates by best available edge vs the source anchor, biggest
  // first, so the per-sweep cap always lands on the worst mispricings.
  const candidates: Array<{
    market: UpdownMarketRow;
    entries: { id: string; label: string | null }[];
    fairByEntryId: Record<string, number>;
    anchor: "live" | "import";
    prices: Record<string, number>;
    bestEdge: number;
  }> = [];

  for (const market of communityAmm) {
    // Respect the trading cutoff with a small pad so a queued action
    // can't race the pre-resolve cooldown.
    if (market.endAt) {
      const cutoff = getMarketBettingCutoff(market.endAt, "amm", "community");
      if (now.getTime() >= cutoff.getTime() - 10 * 60 * 1000) continue;
    }

    const entries = entriesByMarket.get(market.id) ?? [];
    if (entries.length < 2) continue;
    const snap = ammStateByMarket.get(market.id);
    if (!snap) continue;

    const sourceFair = readSourceFairByEntryId(market.metadata, entries);
    if (!sourceFair) continue;

    const prices = ammCurrentPrices(snap);
    let bestEdge = -Infinity;
    for (const entry of entries) {
      const fair = sourceFair.fairByEntryId[entry.id];
      if (fair == null) continue;
      const edge = fair - (prices[entry.id] ?? 1 / entries.length);
      if (edge > bestEdge) bestEdge = edge;
    }
    if (!Number.isFinite(bestEdge)) continue;

    candidates.push({
      market,
      entries,
      fairByEntryId: sourceFair.fairByEntryId,
      anchor: sourceFair.anchor,
      prices,
      bestEdge,
    });
  }

  candidates.sort((a, b) => b.bestEdge - a.bestEdge);
  const targets = candidates.slice(0, COMMUNITY_CONVERGENCE_MARKETS_PER_SWEEP);
  if (!targets.length) return 0;

  const dayStart = startOfUtcDay(now);
  let scheduled = 0;
  let agentIdx = 0;

  for (const target of targets) {
    const { market, entries } = target;

    const agent = arbAgents[agentIdx % arbAgents.length];
    agentIdx++;
    const agentData = toAgentData(agent);

    const entryData: MarketEntryData[] = entries.map((e) => ({
      id: e.id,
      label: e.label ?? "",
      totalStake: 0,
      noStake: 0,
    }));

    const decision = computeArbPredictionCommunity(
      entryData,
      target.fairByEntryId,
      target.prices,
      { minEdgePp: COMMUNITY_ARB_MIN_EDGE_PP },
    );

    if (shadow && !enabled) {
      if (!decision.abstain && decision.entryId) {
        const label = entries.find((e) => e.id === decision.entryId)?.label ?? "?";
        log(
          `[CommunityConvergence][shadow] market=${market.id.slice(0, 8)} anchor=${target.anchor} ` +
            `wouldBuy=${label} edge=${decision.edge?.toFixed(3)} conf=${decision.confidence?.toFixed(3)}`,
        );
      }
      continue;
    }
    if (decision.abstain || !decision.entryId) continue;

    // One community convergence action per market per UTC day.
    const [recentCommunity] = await db
      .select({ id: scheduledAgentActions.id })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.marketId, market.id),
          sql`${scheduledAgentActions.decisionPayload}->>'communityConvergenceSweep' = 'true'`,
          gte(scheduledAgentActions.createdAt, dayStart),
        ),
      )
      .limit(1);
    if (recentCommunity) continue;

    const existing = await db
      .select({ id: scheduledAgentActions.id })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.agentId, agent.id),
          eq(scheduledAgentActions.marketId, market.id),
          sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`,
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    const stakeAmount = computeAgentStakeAmount(agentData, decision, null);
    const executeAfter = new Date(now.getTime() + 60_000);

    await db.insert(scheduledAgentActions).values({
      agentId: agent.id,
      marketId: market.id,
      entryId: decision.entryId,
      actionType: "buy",
      decisionPayload: { ...decision, communityConvergenceSweep: true, sourceAnchor: target.anchor },
      stakeAmount,
      executeAfter,
      status: "pending",
    });
    scheduled++;
    log(
      `[AgentRunner] Community convergence ${agent.displayName} → ${market.title?.slice(0, 28)} ` +
        `anchor=${target.anchor} edge=${decision.edge?.toFixed(3)} conf=${decision.confidence?.toFixed(2)} stake=${stakeAmount}`,
    );
  }

  if (scheduled > 0) {
    log(`[AgentRunner] Community convergence sweep scheduled ${scheduled} actions`);
  }
  return scheduled;
}

function lmsrH2HEntryPrice(
  b: number,
  sq: Record<string, number>,
  entryId: string,
  entryIds: string[],
): number {
  if (!Number.isFinite(b) || b <= 0 || entryIds.length === 0) {
    return 1 / Math.max(1, entryIds.length);
  }
  const qs = entryIds.map((id) => Number(sq[id] ?? 0));
  const maxQ = Math.max(...qs);
  const weights = qs.map((q) => Math.exp((q - maxQ) / b));
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0) return 1 / entryIds.length;
  const idx = entryIds.indexOf(entryId);
  return idx >= 0 ? weights[idx]! / sum : 1 / entryIds.length;
}

/** Rank near-close H2H markets by lock-in fair minus live price on the favoured side. */
async function pickMispricedH2HMarketIds(
  candidates: UpdownMarketRow[],
  limit: number,
  now: Date,
): Promise<string[]> {
  if (!candidates.length || limit <= 0) return [];

  const marketIds = candidates.map((m) => m.id);
  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, marketIds));

  const entryRows = await db
    .select({
      marketId: marketEntries.marketId,
      id: marketEntries.id,
      personId: marketEntries.personId,
    })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, marketIds));

  const entriesByMarket = new Map<
    string,
    Array<{ id: string; personId: string | null }>
  >();
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({ id: row.id, personId: row.personId });
    entriesByMarket.set(row.marketId, list);
  }

  const scored: { id: string; gap: number }[] = [];

  for (const market of candidates) {
    const entries = entriesByMarket.get(market.id) ?? [];
    if (entries.length !== 2 || !entries.every((e) => e.personId)) continue;

    const state = stateRows.find((r) => r.marketId === market.id);
    if (!state) continue;
    const b = Number(state.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    const sq = (state.shareQuantities ?? {}) as Record<string, number>;
    const entryIds = entries.map((e) => e.id);

    const scoreByEntryId: Record<string, number> = {};
    for (const entry of entries) {
      const sig = await getTrendSignals(entry.personId!);
      const fi = sig.fameIndex;
      if (fi != null && Number.isFinite(fi)) scoreByEntryId[entry.id] = fi;
    }
    if (Object.keys(scoreByEntryId).length < 2) continue;

    const [eA, eB] = entries;
    const hrs = hoursUntilEnd(market.endAt ?? null, now);
    const fairMap = fairH2HByEntryId(
      eA.id,
      scoreByEntryId[eA.id]!,
      eB.id,
      scoreByEntryId[eB.id]!,
      hrs,
      LOCKIN_H2H_SIGMA_1D,
      LOCKIN_H2H_BETA,
    );
    const favored = favoredH2HFromFairMap(fairMap);
    if (!favored) continue;

    const price = lmsrH2HEntryPrice(b, sq, favored.entryId, entryIds);
    const gap = favored.fair - price;
    if (gap >= ARB_MIN_EDGE_PP) scored.push({ id: market.id, gap });
  }

  scored.sort((a, b) => b.gap - a.gap);
  return scored.slice(0, limit).map((s) => s.id);
}

/**
 * Near-close H2H convergence — arb cohort pushes prices toward lock-in fair.
 */
async function runConvergenceSweepH2H(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: UpdownMarketRow[],
  now: Date,
): Promise<number> {
  if (!ARB_COHORT_ENABLED || !isLockInFairH2HEnabled()) return 0;

  const arbAgents = agents.filter((a) => isArbAgent(toAgentData(a)));
  if (!arbAgents.length) return 0;

  const ammH2h = allMarkets.filter(
    (m) => m.marketType === "h2h" && m.engine === "amm",
  );
  if (!ammH2h.length) return 0;

  const bufferMs = JACKPOT_AGENT_MIN_BUFFER_HOURS * 60 * 60 * 1000;
  const nearCloseMarkets = ammH2h.filter((m) => {
    if (!m.endAt) return false;
    const cutoff = getMarketBettingCutoff(m.endAt, "amm", "h2h");
    const t = now.getTime();
    return t >= cutoff.getTime() - bufferMs && t <= cutoff.getTime();
  });
  if (!nearCloseMarkets.length) return 0;

  const priorityIds = await pickMispricedH2HMarketIds(
    nearCloseMarkets,
    ARB_CONVERGENCE_MARKETS_PER_SWEEP,
    now,
  );
  const targetIds = new Set(
    priorityIds.length > 0
      ? priorityIds
      : nearCloseMarkets.slice(0, ARB_CONVERGENCE_MARKETS_PER_SWEEP).map((m) => m.id),
  );

  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, Array.from(targetIds)));

  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
  for (const row of stateRows) {
    const b = Number(row.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    ammStateByMarket.set(row.marketId, {
      liquidityB: b,
      outcomeOrder: row.outcomeOrder as string[],
      shareQuantities: row.shareQuantities as Record<string, number>,
    });
  }

  const entryRows = await db
    .select({
      marketId: marketEntries.marketId,
      id: marketEntries.id,
      label: marketEntries.label,
      personId: marketEntries.personId,
    })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, Array.from(targetIds)));

  const entriesByMarket = new Map<
    string,
    { id: string; label: string | null; personId: string | null }[]
  >();
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({ id: row.id, label: row.label, personId: row.personId });
    entriesByMarket.set(row.marketId, list);
  }

  let scheduled = 0;
  let agentIdx = 0;

  for (const market of nearCloseMarkets) {
    if (!targetIds.has(market.id)) continue;
    const entries = entriesByMarket.get(market.id) ?? [];
    if (entries.length !== 2) continue;
    if (!entries.every((e) => e.personId)) continue;

    const scoreByEntryId: Record<string, number> = {};
    for (const entry of entries) {
      const entryOpeningScore = market.createdAt
        ? await getEntryOpeningScore(entry.personId!, market.id, market.createdAt)
        : null;
      const sig = await getTrendSignals(entry.personId!, {
        openingScore: entryOpeningScore,
      });
      const fi = sig.fameIndex;
      if (fi == null || !Number.isFinite(fi)) continue;
      scoreByEntryId[entry.id] = fi;
    }
    if (Object.keys(scoreByEntryId).length < 2) continue;

    const hoursRemaining =
      market.endAt != null
        ? Math.max(0, (market.endAt.getTime() - now.getTime()) / 3_600_000)
        : 0;

    const snap = ammStateByMarket.get(market.id);
    if (!snap) continue;
    const prices = ammCurrentPrices(snap);

    const agent = arbAgents[agentIdx % arbAgents.length];
    agentIdx++;
    const agentData = toAgentData(agent);

    const marketEntriesData = entries.map((e) => ({
      id: e.id,
      label: e.label ?? "",
      totalStake: 0,
      noStake: 0,
      personId: e.personId,
    }));

    const decision = computeArbPredictionH2H(
      marketEntriesData,
      scoreByEntryId,
      hoursRemaining,
      prices,
    );
    if (decision.abstain || !decision.entryId) continue;

    const existing = await db
      .select({ id: scheduledAgentActions.id })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.agentId, agent.id),
          eq(scheduledAgentActions.marketId, market.id),
          sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`,
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    const stakeAmount = computeAgentStakeAmount(agentData, decision, null);
    const executeAfter = new Date(now.getTime() + 60_000);

    await db.insert(scheduledAgentActions).values({
      agentId: agent.id,
      marketId: market.id,
      entryId: decision.entryId,
      actionType: "buy",
      decisionPayload: { ...decision, convergenceSweepH2H: true },
      stakeAmount,
      executeAfter,
      status: "pending",
    });
    scheduled++;
    log(
      `[AgentRunner] H2H convergence ${agent.displayName} → ${market.title?.slice(0, 28)} conf=${decision.confidence?.toFixed(2)} stake=${stakeAmount}`,
    );
  }

  if (scheduled > 0) {
    log(`[AgentRunner] H2H convergence sweep scheduled ${scheduled} actions`);
  }
  return scheduled;
}

/** Rank near-close gainer markets by lock-in fair minus live price on the favored entry. */
async function pickMispricedGainerMarketIds(
  candidates: UpdownMarketRow[],
  limit: number,
  now: Date,
): Promise<string[]> {
  if (!candidates.length || limit <= 0) return [];

  const marketIds = candidates.map((m) => m.id);
  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, marketIds));

  const entryRows = await db
    .select({
      marketId: marketEntries.marketId,
      id: marketEntries.id,
      personId: marketEntries.personId,
    })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, marketIds));

  const entriesByMarket = new Map<
    string,
    Array<{ id: string; personId: string | null }>
  >();
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({ id: row.id, personId: row.personId });
    entriesByMarket.set(row.marketId, list);
  }

  const scored: { id: string; gap: number }[] = [];

  for (const market of candidates) {
    const entries = entriesByMarket.get(market.id) ?? [];
    if (entries.length < 2 || !entries.every((e) => e.personId)) continue;

    const state = stateRows.find((r) => r.marketId === market.id);
    if (!state) continue;
    const b = Number(state.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    const sq = (state.shareQuantities ?? {}) as Record<string, number>;
    const entryIds = entries.map((e) => e.id);

    const pctByEntryId: Record<string, number | null | undefined> = {};
    for (const entry of entries) {
      const entryOpeningScore = market.createdAt
        ? await getEntryOpeningScore(entry.personId!, market.id, market.createdAt)
        : null;
      const sig = await getTrendSignals(entry.personId!, {
        openingScore: entryOpeningScore,
      });
      pctByEntryId[entry.id] = sig.pctChangeVsOpen;
    }

    const hrs = hoursUntilEnd(market.endAt ?? null, now);
    const fairMap = fairGainerByEntryId(
      pctByEntryId,
      hrs,
      LOCKIN_GAINER_SIGMA_1D,
      LOCKIN_GAINER_BETA,
    );
    const favored = favoredH2HFromFairMap(fairMap);
    if (!favored) continue;

    const price = lmsrH2HEntryPrice(b, sq, favored.entryId, entryIds);
    const gap = favored.fair - price;
    if (gap >= ARB_MIN_EDGE_PP) scored.push({ id: market.id, gap });
  }

  scored.sort((a, b) => b.gap - a.gap);
  return scored.slice(0, limit).map((s) => s.id);
}

/**
 * Near-close gainer convergence — arb cohort pushes prices toward lock-in fair.
 */
async function runConvergenceSweepGainer(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: UpdownMarketRow[],
  now: Date,
): Promise<number> {
  if (!ARB_COHORT_ENABLED || !isLockInFairGainerEnabled()) return 0;

  const arbAgents = agents.filter((a) => isArbAgent(toAgentData(a)));
  if (!arbAgents.length) return 0;

  const ammGainer = allMarkets.filter(
    (m) => m.marketType === "gainer" && m.engine === "amm",
  );
  if (!ammGainer.length) return 0;

  const bufferMs = JACKPOT_AGENT_MIN_BUFFER_HOURS * 60 * 60 * 1000;
  const nearCloseMarkets = ammGainer.filter((m) => {
    if (!m.endAt) return false;
    const cutoff = getMarketBettingCutoff(m.endAt, "amm", "gainer");
    const t = now.getTime();
    return t >= cutoff.getTime() - bufferMs && t <= cutoff.getTime();
  });
  if (!nearCloseMarkets.length) return 0;

  const priorityIds = await pickMispricedGainerMarketIds(
    nearCloseMarkets,
    ARB_CONVERGENCE_MARKETS_PER_SWEEP,
    now,
  );
  const targetIds = new Set(
    priorityIds.length > 0
      ? priorityIds
      : nearCloseMarkets.slice(0, ARB_CONVERGENCE_MARKETS_PER_SWEEP).map((m) => m.id),
  );

  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, Array.from(targetIds)));

  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
  for (const row of stateRows) {
    const b = Number(row.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    ammStateByMarket.set(row.marketId, {
      liquidityB: b,
      outcomeOrder: row.outcomeOrder as string[],
      shareQuantities: row.shareQuantities as Record<string, number>,
    });
  }

  const entryRows = await db
    .select({
      marketId: marketEntries.marketId,
      id: marketEntries.id,
      label: marketEntries.label,
      personId: marketEntries.personId,
    })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, Array.from(targetIds)));

  const entriesByMarket = new Map<
    string,
    { id: string; label: string | null; personId: string | null }[]
  >();
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push({ id: row.id, label: row.label, personId: row.personId });
    entriesByMarket.set(row.marketId, list);
  }

  let scheduled = 0;
  let agentIdx = 0;

  for (const market of nearCloseMarkets) {
    if (!targetIds.has(market.id)) continue;
    const entries = entriesByMarket.get(market.id) ?? [];
    if (entries.length < 2) continue;
    if (!entries.every((e) => e.personId)) continue;

    const pctByEntryId: Record<string, number | null | undefined> = {};
    for (const entry of entries) {
      const entryOpeningScore = market.createdAt
        ? await getEntryOpeningScore(entry.personId!, market.id, market.createdAt)
        : null;
      const sig = await getTrendSignals(entry.personId!, {
        openingScore: entryOpeningScore,
      });
      pctByEntryId[entry.id] = sig.pctChangeVsOpen;
    }

    const hoursRemaining =
      market.endAt != null
        ? Math.max(0, (market.endAt.getTime() - now.getTime()) / 3_600_000)
        : 0;

    const snap = ammStateByMarket.get(market.id);
    if (!snap) continue;
    const prices = ammCurrentPrices(snap);

    const agent = arbAgents[agentIdx % arbAgents.length];
    agentIdx++;
    const agentData = toAgentData(agent);

    const marketEntriesData = entries.map((e) => ({
      id: e.id,
      label: e.label ?? "",
      totalStake: 0,
      noStake: 0,
      personId: e.personId,
    }));

    const decision = computeArbPredictionGainer(
      marketEntriesData,
      pctByEntryId,
      hoursRemaining,
      prices,
    );
    if (decision.abstain || !decision.entryId) continue;

    const existing = await db
      .select({ id: scheduledAgentActions.id })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.agentId, agent.id),
          eq(scheduledAgentActions.marketId, market.id),
          sql`${scheduledAgentActions.status} IN ('pending', 'in_progress', 'executed')`,
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;

    const stakeAmount = computeAgentStakeAmount(agentData, decision, null);
    const executeAfter = new Date(now.getTime() + 60_000);

    await db.insert(scheduledAgentActions).values({
      agentId: agent.id,
      marketId: market.id,
      entryId: decision.entryId,
      actionType: "buy",
      decisionPayload: { ...decision, convergenceSweepGainer: true },
      stakeAmount,
      executeAfter,
      status: "pending",
    });
    scheduled++;
    log(
      `[AgentRunner] Gainer convergence ${agent.displayName} → ${market.title?.slice(0, 28)} conf=${decision.confidence?.toFixed(2)} stake=${stakeAmount}`,
    );
  }

  if (scheduled > 0) {
    log(`[AgentRunner] Gainer convergence sweep scheduled ${scheduled} actions`);
  }
  return scheduled;
}

/**
 * Sell sweep — Agent v3 phase 1.
 *
 * For each agent's open AMM up/down position, run the persona-aware
 * `computeSellDecision`. If the cascade produces a `SellDecision`,
 * persist a `scheduled_agent_actions` row with `actionType='sell'` so
 * the existing action worker poll picks it up on its next pass.
 *
 * Scope: AMM up/down only (mirrors `runConvictionSweep`). H2H, race,
 * and community AMM markets stay buy-only for this phase — those
 * market types need bespoke anchor logic and are deferred to phase 2.
 *
 * Imperfection by design:
 *   - The cascade in `computeSellDecision` rejects most agent×market
 *     pairs even when the band is breached (forgot-to-look + persona
 *     pSell + hope-for-reversal gates).
 *   - We DO NOT pre-filter on "in profit" / "in loss" before calling
 *     the engine. The engine's gate ordering means agents waste a
 *     dice roll on positions inside the band, but that's the right
 *     shape — it's how a "did I check my portfolio today?" model
 *     actually behaves.
 *
 * Mutual exclusion with conviction sweep:
 *   - Skip if a pending or in-progress sell or conviction action
 *     already exists for this (agent, market). The conviction sweep
 *     ran first this batch; if it scheduled an add-on, we silently
 *     defer the sell to next sweep.
 *   - Cap lifetime sells at MAX_SELLS_PER_MARKET_PER_AGENT to prevent
 *     a death-spiral of partial-sell-then-sell-again.
 */
/**
 * Aggregated position state for a single (agent, market, entry).
 * Exported (via the test-only re-export below) so unit tests can
 * exercise the buy/sell aggregation math without standing up Drizzle.
 */
export interface SellSweepPositionAgg {
  marketId: string;
  entryId: string;
  /** Net shares = sum(buy.shares) - sum(sell.shares). */
  netShares: number;
  /** Sum of buy share counts only — denominator for the anchor. */
  buyShares: number;
  /** Sum of buy.shares × buy.pricePerShare — numerator for the anchor. */
  buyCostNotional: number;
  /** Most recent buy's `confidence` column (used in conviction fallback chain). */
  latestBuyConfidence?: number;
}

/**
 * Pure aggregator for the sell sweep — collapses a list of buy/sell
 * bet rows into one entry per (market, entry) with net-share + cost-
 * basis fields ready for `computeSellDecision`.
 *
 * Skips rows with non-finite or non-positive shareCount (defensive
 * — the upstream insert code clamps these but a future bug shouldn't
 * blow up the sweep). Sells dilute `netShares` only — they don't
 * touch `buyCostNotional` or `buyShares` because the anchor is
 * "what I paid", not "what's left".
 *
 * Internal helper, exported via `_aggregateSellSweepPositionsForTesting`.
 */
function aggregateSellSweepPositions(
  bets: ReadonlyArray<{
    marketId: string;
    entryId: string;
    actionType: string | null;
    shareCount: string | number | null;
    pricePerShare: string | number | null;
    confidence: string | number | null;
  }>,
): Map<string, SellSweepPositionAgg> {
  const positions = new Map<string, SellSweepPositionAgg>();
  for (const bet of bets) {
    if (bet.actionType !== "buy" && bet.actionType !== "sell") continue;
    const sc = Number(bet.shareCount ?? 0);
    if (!Number.isFinite(sc) || sc <= 0) continue;
    const key = `${bet.marketId}|${bet.entryId}`;
    let agg = positions.get(key);
    if (!agg) {
      agg = {
        marketId: bet.marketId,
        entryId: bet.entryId,
        netShares: 0,
        buyShares: 0,
        buyCostNotional: 0,
      };
      positions.set(key, agg);
    }
    if (bet.actionType === "buy") {
      const ps = parseFloat(String(bet.pricePerShare ?? "0"));
      if (Number.isFinite(ps) && ps > 0) {
        agg.buyCostNotional += sc * ps;
        agg.buyShares += sc;
      }
      agg.netShares += sc;
      const conf = bet.confidence == null ? null : parseFloat(String(bet.confidence));
      if (conf != null && Number.isFinite(conf)) agg.latestBuyConfidence = conf;
    } else {
      agg.netShares -= sc;
    }
  }
  return positions;
}

/**
 * Group aggregated positions by market and return the LARGEST net-share
 * position per market. Used by `runRepredictSweep` to decide which side
 * an agent is "on" when they hold positions on both sides of an updown
 * market (e.g. an UP buy followed by a conviction flip to DOWN). Picking
 * the wrong side here causes spurious repredict thrashing — see the
 * multi-position regression case covered in tests.
 *
 * Pure helper; exported via `_pickLargestPositionsByMarketForTesting`.
 */
function pickLargestPositionsByMarket(
  positions: Map<string, SellSweepPositionAgg>,
): Map<string, { entryId: string; netShares: number }> {
  const out = new Map<string, { entryId: string; netShares: number }>();
  for (const pos of positions.values()) {
    if (pos.netShares < MIN_NET_SHARES_FOR_SELL_EVAL) continue;
    const cur = out.get(pos.marketId);
    if (!cur || pos.netShares > cur.netShares) {
      out.set(pos.marketId, { entryId: pos.entryId, netShares: pos.netShares });
    }
  }
  return out;
}

async function runSellSweep(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: { id: string; personId: string | null; marketType: string | null; openMarketType?: string | null; title: string | null; engine?: string | null; status?: string | null }[],
  preBuiltUpdownCtx?: UpdownSweepContext["marketContext"],
): Promise<number> {
  let sellsScheduled = 0;

  // Sell sweep operates on every AMM market regardless of marketType.
  // Per-entry weighted-avg cost basis in `aggregateSellSweepPositions`
  // handles 2-entry (UpDown/H2H) and N-entry (Race, Community-multi)
  // markets identically — the engine compares per-entry anchor vs
  // live price. Jackpot is parimutuel (engine !== 'amm') so it's
  // excluded automatically by the `engine === 'amm'` gate.
  //
  // `personId` filter retained for NATIVE markets because the Town Square
  // log lines + sell-engine telemetry use the person identity for context;
  // the few admin-built generic races without a personId sit out the
  // sweep until that wiring exists. Documented limitation, not a bug.
  //
  // Community (World Market) parity: most world events have no linked
  // person, which used to exclude them entirely and made agent flow
  // buy-only (prices only ever pushed one way by simulated traders).
  // Gated behind COMMUNITY_SELL_SWEEP_ENABLED so the rollout can watch
  // the price-band exits before they go live. The sell engine's
  // anchor-vs-live-price cascade is market-type agnostic; community
  // positions simply never get an updown scoreContext.
  //
  // Note on community markets: when `WORLD_MARKETS_LLM_ENABLED=false`
  // we block community BUYS in actionWorker, but sells fire here
  // regardless — agents holding positions when the kill switch flips
  // off must still be able to manage their exits.
  const communitySells = isCommunitySellSweepEnabled();
  const ammMarkets = allMarkets.filter((m) =>
    m.engine === "amm" &&
    (m.personId || (communitySells && m.marketType === "community")),
  );
  if (!ammMarkets.length) return 0;

  const updownContext =
    preBuiltUpdownCtx ??
    (await buildUpdownMarketContext(
      ammMarkets.filter((m) => m.marketType === "updown"),
    ));
  const updownEntryRows =
    updownContext.size > 0
      ? await db
          .select({
            marketId: marketEntries.marketId,
            id: marketEntries.id,
            label: marketEntries.label,
          })
          .from(marketEntries)
          .where(
            inArray(
              marketEntries.marketId,
              Array.from(updownContext.keys()),
            ),
          )
      : [];

  // Pre-collapse updownEntryRows into a marketId -> {upEntryId,downEntryId}
  // map ONCE here so the per-position loop below is O(1) instead of
  // re-filtering the full entries list for every (agent, position).
  // On a 50-market sweep × 56 agents × 2 entries/position that saves
  // ~280k Array.filter passes per batch.
  const updownIdsByMarket = new Map<
    string,
    { upEntryId: string; downEntryId: string }
  >();
  {
    const rowsByMarket = new Map<
      string,
      { id: string; label: string | null }[]
    >();
    for (const row of updownEntryRows) {
      const list = rowsByMarket.get(row.marketId) ?? [];
      list.push({ id: row.id, label: row.label });
      rowsByMarket.set(row.marketId, list);
    }
    for (const [marketId, entries] of rowsByMarket) {
      const ids = upDownEntryIds(entries);
      if (ids) updownIdsByMarket.set(marketId, ids);
    }
  }

  // Pre-load AMM state for every market once. Same pattern as the
  // conviction sweep — one batched query, reused across all agents.
  const ammStateByMarket = new Map<string, AmmStateSnapshot>();
  const stateRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, ammMarkets.map((m) => m.id)));
  for (const row of stateRows) {
    const b = Number(row.liquidityB);
    if (!Number.isFinite(b) || b <= 0) continue;
    ammStateByMarket.set(row.marketId, {
      liquidityB: b,
      outcomeOrder: row.outcomeOrder as string[],
      shareQuantities: row.shareQuantities as Record<string, number>,
    });
  }

  for (const agent of agents) {
    if (!agent.isActive) continue;

    // Pull every AMM trade (buys AND sells) for this agent across
    // the in-scope markets. Net shares per (market, entry) drives
    // whether a position even exists; weighted-average cost-basis
    // drives the sell engine's anchor.
    const ammBets = await db
      .select({
        marketId: marketBets.marketId,
        entryId: marketBets.entryId,
        actionType: marketBets.actionType,
        shareCount: marketBets.shareCount,
        pricePerShare: marketBets.pricePerShare,
        confidence: marketBets.confidence,
        betMetadata: marketBets.betMetadata,
        createdAt: marketBets.createdAt,
      })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.agentId, agent.id),
          inArray(marketBets.marketId, ammMarkets.map((m) => m.id)),
        ),
      )
      .orderBy(marketBets.createdAt);

    if (!ammBets.length) continue;

    // Aggregate buys minus sells per (market, entry). Anchor is the
    // weighted average of buy prices ONLY (sells don't dilute the
    // anchor — the engine compares "live" vs. "what I paid"). Note
    // this differs from runConvictionSweep which uses first-fill
    // price; the conviction sweep cares about "did the price move
    // in my favour since I opened?" while the sell sweep cares
    // about "have I made/lost money on the position as it stands?"
    const positions = aggregateSellSweepPositions(ammBets);

    // Pre-load all sell/conviction blocker actions for this agent
    // across the in-scope markets in ONE query (was N+1 — one
    // query per position). Group by marketId for O(1) lookup in
    // the position loop.
    const blockerRows = await db
      .select({
        marketId: scheduledAgentActions.marketId,
        actionType: scheduledAgentActions.actionType,
        status: scheduledAgentActions.status,
      })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.agentId, agent.id),
          inArray(scheduledAgentActions.marketId, ammMarkets.map((m) => m.id)),
          // 'repredict' is included so a pending flip-buy doesn't race a
          // sell on the same (agent, market): if the repredict will swap
          // the agent's net position to the opposite side, scheduling a
          // sell of the old side in the same sweep would either double-
          // execute or cancel itself out via the position aggregator.
          sql`${scheduledAgentActions.actionType} IN ('sell', 'conviction', 'repredict')`,
        ),
      );
    const blockersByMarket = new Map<string, typeof blockerRows>();
    for (const row of blockerRows) {
      const list = blockersByMarket.get(row.marketId) ?? [];
      list.push(row);
      blockersByMarket.set(row.marketId, list);
    }

    // Pre-load the latest executed (predict | conviction) decision
    // payload per (market, entry) so the conviction-fallback chain
    // can read it without hitting the DB inside the position loop.
    // ORDER BY executedAt DESC + take-first-per-key gives us the
    // most-recent payload per group in one query.
    const decisionRows = await db
      .select({
        marketId: scheduledAgentActions.marketId,
        entryId: scheduledAgentActions.entryId,
        decisionPayload: scheduledAgentActions.decisionPayload,
      })
      .from(scheduledAgentActions)
      .where(
        and(
          eq(scheduledAgentActions.agentId, agent.id),
          inArray(scheduledAgentActions.marketId, ammMarkets.map((m) => m.id)),
          sql`${scheduledAgentActions.actionType} IN ('predict', 'conviction')`,
          eq(scheduledAgentActions.status, "executed"),
        ),
      )
      .orderBy(desc(scheduledAgentActions.executedAt));
    const latestDecisionByEntry = new Map<string, unknown>();
    for (const row of decisionRows) {
      const key = `${row.marketId}|${row.entryId}`;
      if (!latestDecisionByEntry.has(key)) {
        latestDecisionByEntry.set(key, row.decisionPayload);
      }
    }

    const personaBand = getSimulationProfile(agent.simulationProfile).personaBand;

    // In-memory tally of sells scheduled per market WITHIN this sweep.
    // `marketBlockers` is a one-shot snapshot of DB rows taken before
    // the position loop runs — it can't observe inserts we make
    // mid-loop. Without this tally, a multi-entry market (Race,
    // Community-multi) where the agent holds 3+ positions could
    // schedule a sell on EVERY breached entry in one sweep, blowing
    // past `MAX_SELLS_PER_MARKET_PER_AGENT` even though the cap is
    // documented as market-wide. The UpDown-only filter masked this
    // because UpDown has 2 entries and the cap is also 2; expanding
    // to all AMM market types exposes the gap.
    const scheduledThisSweepByMarket = new Map<string, number>();

    for (const pos of Array.from(positions.values())) {
      if (pos.netShares < MIN_NET_SHARES_FOR_SELL_EVAL) continue;
      if (pos.buyShares <= 0) continue;
      const market = ammMarkets.find((m) => m.id === pos.marketId);
      if (!market) continue;
      const state = ammStateByMarket.get(market.id);
      if (!state) continue;

      // Weighted-average buy price = total notional / total bought
      // shares. Sells don't contribute (anchor is "what I paid").
      const anchor = pos.buyCostNotional / pos.buyShares;
      if (!Number.isFinite(anchor) || anchor <= 0) continue;

      const livePrice = ammCurrentPrices(state)[pos.entryId];
      if (!Number.isFinite(livePrice) || livePrice <= 0) continue;

      // Idempotency / mutual exclusion: skip if any pending or
      // in-progress sell or conviction action already exists for
      // (agent, market) FROM A PRIOR SWEEP. Within the current
      // sweep, we ALLOW scheduling on multiple entries (per the
      // plan: a race with N entries can produce N sell decisions,
      // bounded only by the market-wide cap below).
      const marketBlockers = blockersByMarket.get(market.id) ?? [];
      const hasOpenBlocker = marketBlockers.some(
        (row) => row.status === "pending" || row.status === "in_progress",
      );
      if (hasOpenBlocker) continue;
      // Cap check: lifetime executed sells PLUS what we've already
      // scheduled in this sweep. Without the in-sweep counter the
      // cap silently fails on multi-entry markets (see comment on
      // `scheduledThisSweepByMarket` above).
      const lifetimeSells = marketBlockers.filter(
        (row) => row.actionType === "sell" && row.status === "executed",
      ).length;
      const scheduledThisSweep = scheduledThisSweepByMarket.get(market.id) ?? 0;
      if (lifetimeSells + scheduledThisSweep >= MAX_SELLS_PER_MARKET_PER_AGENT) {
        continue;
      }

      // Look up the original conviction (rankerConviction stamped at
      // buy time). Fallback chain: most-recent decision_payload first,
      // then `market_bets.confidence` from the latest buy row, then
      // a wide default. Either may be absent for legacy positions.
      let conviction: number | undefined;
      const cachedPayload = latestDecisionByEntry.get(`${market.id}|${pos.entryId}`);
      if (cachedPayload && typeof cachedPayload === "object") {
        const payload = cachedPayload as { rankerConviction?: number; confidence?: number };
        if (typeof payload.rankerConviction === "number" && Number.isFinite(payload.rankerConviction)) {
          conviction = payload.rankerConviction;
        } else if (typeof payload.confidence === "number" && Number.isFinite(payload.confidence)) {
          conviction = payload.confidence;
        }
      }
      if (conviction == null && pos.latestBuyConfidence != null) {
        conviction = pos.latestBuyConfidence;
      }
      if (conviction == null) conviction = SELL_DEFAULT_CONVICTION;

      let scoreContext: { pctChangeVsOpen: number; heldEntryIsUp: boolean } | undefined;
      if (market.marketType === "updown") {
        const uctx = updownContext.get(market.id);
        const ids = updownIdsByMarket.get(market.id);
        if (uctx && ids) {
          scoreContext = {
            pctChangeVsOpen: uctx.pctChangeVsOpen,
            heldEntryIsUp: pos.entryId === ids.upEntryId,
          };
        }
      }

      const decision = computeSellDecision({
        personaBand,
        anchor,
        livePrice,
        conviction,
        netShares: pos.netShares,
        scoreContext,
      });
      if (!decision) continue;

      // Schedule the sell. We re-use ARCHETYPE_DELAY_RANGES so the
      // execute_after stagger lines up with the existing buy/conviction
      // pacing — nothing about a sell needs to be more urgent than a
      // buy decision.
      const executeAfter = computeExecuteAfter(agent.archetype);
      const decisionPayload: SellDecision = decision;

      await db.insert(scheduledAgentActions).values({
        agentId: agent.id,
        marketId: market.id,
        entryId: pos.entryId,
        actionType: "sell",
        decisionPayload,
        // For sells, `stake_amount` carries the live notional value
        // of the position fraction we're exiting. Purely informational
        // — the worker re-computes shares from netShares × fraction
        // at execution time. Use 0 if math doesn't produce a finite
        // value to avoid storing NaN.
        stakeAmount: Math.max(
          0,
          Math.round(pos.netShares * decision.sellFraction * livePrice),
        ),
        executeAfter,
        status: "pending",
      });
      scheduledThisSweepByMarket.set(
        market.id,
        (scheduledThisSweepByMarket.get(market.id) ?? 0) + 1,
      );

      sellsScheduled++;
      log(
        `[AgentRunner] AMM Sell scheduled: ${agent.displayName} ${decision.reason} on ${market.title?.slice(0, 30)} (anchor=${anchor.toFixed(3)} live=${livePrice.toFixed(3)} band=${decision.bandBottom.toFixed(3)}-${decision.bandTop.toFixed(3)} fraction=${decision.sellFraction.toFixed(2)} band=${personaBand} conviction=${conviction.toFixed(2)})`,
      );
    }
  }

  if (sellsScheduled > 0) {
    log(`[AgentRunner] Sell sweep scheduled ${sellsScheduled} exits`);
  }

  return sellsScheduled;
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

/**
 * Derive a coarse UP/DOWN/FLAT direction from the underlying signals.
 *
 * Priority ladder — first rule that fires wins:
 *   1. `pctChangeVsOpen` is the strongest "vs baseline" signal because it's
 *      anchored to the market's actual open. If we have it and it's
 *      meaningful (> 2% in either direction), trust it.
 *   2. Fall back to deltas, but require BOTH the 24h and 7d windows to
 *      agree in sign. Disagreement = noisy / mean-reverting → don't tilt.
 *      24h threshold of 0.5 (raw fame-index points) keeps tiny intraday
 *      jitter from flipping the bucket.
 *   3. Last resort: read the snapshot's `momentum` label. "Breakout" maps
 *      to UP, "Cooling" to DOWN. "Sustained"/"Stable"/"Unknown" stay FLAT
 *      because they tell us about the regime, not the direction.
 *
 * Conservative by design — see comment on `TrendDirection` in types.ts.
 */
export const _aggregateSellSweepPositionsForTesting = aggregateSellSweepPositions;
export const _pickLargestPositionsByMarketForTesting = pickLargestPositionsByMarket;

export function _deriveTrendDirectionForTesting(input: {
  pctChangeVsOpen?: number;
  change24h: number;
  change7d: number;
  momentum: TrendMomentum;
}): TrendDirection {
  return deriveTrendDirection(input);
}

function deriveTrendDirection(input: {
  pctChangeVsOpen?: number;
  change24h: number;
  change7d: number;
  momentum: TrendMomentum;
}): TrendDirection {
  if (
    input.pctChangeVsOpen != null &&
    Number.isFinite(input.pctChangeVsOpen) &&
    Math.abs(input.pctChangeVsOpen) > 0.02
  ) {
    return input.pctChangeVsOpen > 0 ? "UP" : "DOWN";
  }
  if (Math.abs(input.change24h) > 0.5) {
    if (input.change24h > 0 && input.change7d >= 0) return "UP";
    if (input.change24h < 0 && input.change7d <= 0) return "DOWN";
  }
  if (input.momentum === "Breakout") return "UP";
  if (input.momentum === "Cooling") return "DOWN";
  return "FLAT";
}

function normaliseMomentum(raw: string | null | undefined): TrendMomentum {
  switch (raw) {
    case "Breakout":
    case "Sustained":
    case "Cooling":
    case "Stable":
      return raw;
    default:
      return "Unknown";
  }
}

export async function getTrendSignals(
  personId: string | null,
  options: { includeMultiWindow?: boolean; openingScore?: number | null } = {},
): Promise<TrendSignals> {
  if (!personId) {
    return {
      trendScore: 50,
      fameIndex: 5000,
      scoreBaseline: 5000,
      scoreDelta7d: 0,
      change24h: 0,
      momentum: "Unknown",
      trendDirection: "FLAT",
    };
  }

  const [person] = await db
    .select({
      trendScore: trendingPeople.trendScore,
      fameIndex: trendingPeople.fameIndex,
      change7d: trendingPeople.change7d,
      change24h: trendingPeople.change24h,
    })
    .from(trendingPeople)
    .where(eq(trendingPeople.id, personId))
    .limit(1);

  // Latest snapshot supplies the stored momentum label only. Momentum is
  // free-text in the schema; `normaliseMomentum` narrows it to the five
  // buckets the scoring job emits. Plan D (this commit) removed the
  // wikiPulse / newsLevel derivation here — the leaderboard score
  // already integrates wiki+news activity, so the deterministic decision
  // engine doesn't need to read raw wiki/news deltas separately.
  const [snap] = await db
    .select({
      fameIndex: trendSnapshots.fameIndex,
      trendScore: trendSnapshots.trendScore,
      momentum: trendSnapshots.momentum,
      timestamp: trendSnapshots.timestamp,
    })
    .from(trendSnapshots)
    .where(eq(trendSnapshots.personId, personId))
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(1);

  const trendScore = person?.trendScore ?? 50;
  const fameIndex = person?.fameIndex ?? 5000;
  const change7d = person?.change7d ?? 0;
  const change24h = person?.change24h ?? 0;
  const momentum = normaliseMomentum(snap?.momentum);

  // Weekly-open delta — only meaningful when the caller passed an
  // `openingScore`. Guard against a zero/missing baseline so we never
  // emit NaN/Infinity: an opening score of 0 means the person was
  // unranked at open, in which case "% change vs open" isn't a coherent
  // quantity. Computed BEFORE direction derivation because direction
  // uses it as the highest-priority signal.
  let pctChangeVsOpen: number | undefined;
  if (
    options.openingScore != null &&
    Number.isFinite(options.openingScore) &&
    options.openingScore > 0
  ) {
    pctChangeVsOpen = (fameIndex - options.openingScore) / options.openingScore;
  }

  const trendDirection = deriveTrendDirection({
    pctChangeVsOpen,
    change24h,
    change7d,
    momentum,
  });

  const result: TrendSignals = {
    trendScore,
    fameIndex,
    scoreBaseline: snap?.fameIndex ?? fameIndex,
    scoreDelta7d: change7d,
    change24h,
    momentum,
    trendDirection,
  };

  if (pctChangeVsOpen !== undefined) {
    result.pctChangeVsOpen = pctChangeVsOpen;
  }

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

/**
 * Per-entry opening score cache, keyed by `${personId}:${marketId}`.
 * Sweep-scoped — cleared at the top of each `runAgentBatch`. See call site
 * for why clearing is safe (closest-at-or-before is stable for a fixed
 * `(personId, marketCreatedAt)` pair).
 *
 * Bounds the worst case at ~90 lookups per sweep (30 markets * ~3 entries
 * each), all served by the existing `(person_id, timestamp)` index on
 * `trend_snapshots`.
 */
const entryOpeningScoreCache = new Map<string, number | null>();

/**
 * Resolve the trend_snapshots fame index for `personId` at-or-just-before
 * `marketCreatedAt`. Used as the "opening score" for H2H / Race per-entry
 * `pctChangeVsOpen` calculations, since `market_entries` doesn't store an
 * opening baseline of its own.
 *
 * Returns null when this person has no snapshot rows at-or-before the
 * cutoff (rare — would mean the market was created before the person was
 * ever ingested). Callers should treat null as "no opening baseline";
 * `getTrendSignals` already guards against zero/null openings.
 */
async function getEntryOpeningScore(
  personId: string,
  marketId: string,
  marketCreatedAt: Date,
): Promise<number | null> {
  const cacheKey = `${personId}:${marketId}`;
  const cached = entryOpeningScoreCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const [row] = await db
    .select({ fameIndex: trendSnapshots.fameIndex })
    .from(trendSnapshots)
    .where(
      and(
        eq(trendSnapshots.personId, personId),
        lte(trendSnapshots.timestamp, marketCreatedAt),
      ),
    )
    .orderBy(desc(trendSnapshots.timestamp))
    .limit(1);

  const score = row?.fameIndex ?? null;
  entryOpeningScoreCache.set(cacheKey, score);
  return score;
}

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

function computeStakeAmount(confidence: number, maxStake = MAX_AGENT_STAKE): number {
  const scaled =
    BASE_STAKE_AMOUNT +
    Math.round((confidence - 0.5) * 2 * (maxStake - BASE_STAKE_AMOUNT));
  return Math.max(BASE_STAKE_AMOUNT, Math.min(maxStake, scaled));
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

/**
 * Conviction-times-edge sizing curve (Agent v2).
 *
 * Replaces the old `edgeBoost * wide-random-variance` formula with:
 *   smartness = convictionFactor * edgeFactor          // 0..1.5
 *   stake     = base(confidence) * stakeMultiplier
 *               * (1 + 0.6 * smartness)                // up to ~1.9x floor
 *               * narrowVariance(0.85..1.15)           // ±15%
 *   then clamped to persona min..softMax (with ±8% cap jitter).
 *
 * Inputs:
 *   - `pick.conviction` (0..1) — the LLM ranker's self-reported confidence
 *     in this market's edge. `null` (no pick / sides disagreed) falls back
 *     to a band-tuned conviction (sharps default 0.6, others 0.4).
 *   - `pick.edge` (signed) — LLM's edgeProb minus crowd-implied price.
 *     Falls back to `decision.edge` (deterministic engine) when no pick.
 *     We take `|edge|` here because a "no" decision on a -0.10 edge is
 *     just as actionable as "yes" on +0.10.
 *
 * Why this shape (vs the old edgeBoost):
 *   - Random jitter range narrowed (0.70-1.30 → 0.85-1.15) so identical
 *     decisions don't produce wildly different stakes the way the old
 *     formula did. Town Square should still feel varied — the variance
 *     now comes mostly from `confidence` and `smartness` differing across
 *     agents, not from RNG noise.
 *   - Worst-case multiplier is ~1.9x the floor (vs ~2.4x old), keeping
 *     the loadgen-tested price-impact bound in place.
 *   - Non-sharp personas with `fallbackConviction = 0.4` and the
 *     deterministic edge (capped at 0.10 -> edgeFactor=1) get smartness=0.4
 *     -> multiplier=1.24 — close to the old casual-band edgeBoost average.
 */
export function _computeAgentStakeAmountForTesting(
  agent: AgentConfigData,
  decision: PredictionDecision,
  pick: { conviction?: number; edge?: number } | null = null,
): number {
  return computeAgentStakeAmount(agent, decision, pick);
}

function computeAgentStakeAmount(
  agent: AgentConfigData,
  decision: PredictionDecision,
  pick: { conviction?: number; edge?: number } | null = null,
): number {
  const simulation = getSimulationProfile(agent.simulationProfile);
  const isSharp = simulation.personaBand === "sharp";

  // Defensive NaN/undefined coercion. `decision.confidence` /
  // `decision.edge` are both typed as `number?` but a corrupted upstream
  // payload (e.g. cached scheduled action with bad JSON, world-engine
  // returning NaN, etc.) could leak NaN here. `?? 0` does NOT catch NaN
  // — `NaN ?? 0` is `NaN`, and once NaN enters the curve it propagates
  // through `Math.max` / `Math.min` and we'd end up scheduling a NaN
  // stake row that breaks the worker. Always sanitise to a finite
  // fallback before any arithmetic.
  const confidence = Number.isFinite(decision.confidence)
    ? (decision.confidence as number)
    : 0.5;

  const fallbackConviction = isSharp ? 0.6 : 0.4;
  const pickConviction =
    pick?.conviction != null && Number.isFinite(pick.conviction) ? pick.conviction : null;
  const convictionFactor = Math.max(
    0,
    Math.min(1, pickConviction ?? fallbackConviction),
  );

  // |edge|: ranker pick first, deterministic engine second. Both are
  // signed; magnitude is what matters for sizing intent. Each branch
  // is finite-guarded so a corrupted edge can't poison the curve.
  const decisionEdge = Number.isFinite(decision.edge) ? (decision.edge as number) : 0;
  const edgeMagnitude =
    pick?.edge != null && Number.isFinite(pick.edge)
      ? Math.abs(pick.edge)
      : Math.max(0, decisionEdge);
  // 10% edge = full size; larger edges get extra stretch up to 1.5x. Cap
  // is intentional — beyond ~15% edge the LLM is probably overconfident.
  const edgeFactor = Math.max(0, Math.min(1.5, edgeMagnitude / 0.10));

  const smartness = convictionFactor * edgeFactor;
  const smartnessMultiplier = 1 + 0.6 * smartness;

  // Narrow variance — ±15%. The point of the new curve is that smart
  // signals drive size, not RNG.
  const variance = 0.85 + Math.random() * 0.30;
  const stakeCap =
    ARB_COHORT_ENABLED && isArbAgent(agent) ? ARB_AGENT_MAX_STAKE : MAX_AGENT_STAKE;
  const base = computeStakeAmount(confidence, stakeCap);
  const rawStake = base * simulation.stakeMultiplier * smartnessMultiplier * variance;
  const stake = Number.isFinite(rawStake) ? Math.round(rawStake) : simulation.minStake;

  // Soft cap: ±8% per-agent jitter on the persona maxStake so high-stake
  // bets don't all hit the cap at the exact same number.
  const capJitter = 1 + (Math.random() * 0.16 - 0.08);
  const softMax = Math.round(simulation.maxStake * capJitter);

  // Final belt-and-braces. `Math.max(min, NaN)` is NaN in JS, so even
  // after the rawStake guard above, an unexpected NaN slip elsewhere
  // (capJitter, softMax) would still poison the result. Clamp again.
  const final = Math.max(simulation.minStake, Math.min(softMax, stake));
  return Number.isFinite(final) ? final : simulation.minStake;
}

/**
 * True iff the LLM ranker picked the same side the agent's deterministic
 * engine ended up on. We compare on entry label with case-insensitive
 * fallback to match the parser's resolution semantics — a pick that
 * survived `parseRankerResponse` already has its `side` set to the
 * canonical entry label, so the lower-case compare is mostly belt-and-
 * suspenders for any future drift.
 *
 * Only when this returns true do we feed the LLM's conviction/edge into
 * the sizing curve and persist `rankerConviction` for the worker.
 */
function rankerPickMatchesChosenEntry(
  pick: { side: string } | null,
  chosenEntry: { label: string | null } | undefined,
): boolean {
  if (!pick || !chosenEntry?.label) return false;
  return chosenEntry.label.toLowerCase() === pick.side.toLowerCase();
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
