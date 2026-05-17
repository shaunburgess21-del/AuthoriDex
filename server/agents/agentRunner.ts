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
  TrendDirection,
  TrendMomentum,
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
  // All sweep markets are eligible — community markets get a separate
  // formatter inside the ranker since they have free-text options
  // instead of person entries. The world-market LLM (`worldMarketEngine`)
  // still drives community decisions; the ranker just becomes an
  // additional edge signal that bumps `priority` to "high" for sharp
  // agents on whichever community markets the ranker flags.
  const rankableMarkets = sweepMarkets;
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
        );
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
          entrySignals = new Map();
          for (const entry of entries) {
            if (entry.personId) {
              // Per-entry baseline: closest snapshot at-or-before the
              // market's createdAt. This is the Putin fix — without it,
              // pctChangeVsOpen would always be undefined for entries
              // and `decisionEngine` couldn't tilt on direction.
              const entryOpeningScore = market.createdAt
                ? await getEntryOpeningScore(entry.personId, market.id, market.createdAt)
                : null;
              entrySignals.set(
                entry.id,
                await getTrendSignals(entry.personId, {
                  includeMultiWindow: sharpFetch,
                  openingScore: entryOpeningScore,
                }),
              );
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

      // Only feed the LLM ranker's edge/conviction into sizing when the
      // agent ended up on the SAME side as the LLM. If the agent picked
      // the other entry (contrarian persona, deterministic-engine
      // disagreement, etc.) the LLM's `edge` doesn't apply — it was
      // computed for the OTHER side. In that case `null` falls back to
      // the deterministic-engine edge inside computeAgentStakeAmount.
      const rankerPick = sharpPicksByMarketId.get(market.id) ?? null;
      const pickSidesAgree =
        rankerPick &&
        chosenEntry?.label != null &&
        chosenEntry.label.toLowerCase() === rankerPick.side.toLowerCase();
      const sizingPick = pickSidesAgree ? rankerPick : null;

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
async function runConvictionSweep(
  agents: (typeof agentConfigs.$inferSelect)[],
  allMarkets: { id: string; personId: string | null; marketType: string | null; openMarketType?: string | null; title: string | null; engine?: string | null }[],
  _now: Date
): Promise<number> {
  let convictionScheduled = 0;

  // AMM-only after the parimutuel sunset. The `m.engine === "amm"`
  // filter is defensive — Phase 1.5 set the schema default to AMM and
  // the wipe script removed any in-flight parimutuel updown markets,
  // but cron may race ahead of a deploy, so we still gate explicitly.
  const ammUpdown = allMarkets.filter((m) =>
    m.personId &&
    (m.marketType === "updown" || (m.marketType === "community" && m.openMarketType === "updown")) &&
    m.engine === "amm",
  );
  if (!ammUpdown.length) return 0;

  // Pre-load AMM state for every market in the sweep — single batched
  // query, used by every agent below.
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
      // they hold. The anchor entry and the alternative entry on a
      // binary AMM market are symmetrical (price[A] + price[B] = 1).
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

async function getTrendSignals(
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
      wikiPulse: "stable",
      newsLevel: "amber",
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

  // Get latest snapshot for wiki/news signals AND the stored momentum
  // label. Momentum is free-text in the schema; we narrow it via
  // `normaliseMomentum` to the five buckets the scoring job emits.
  const [snap] = await db
    .select({
      wikiDelta: trendSnapshots.wikiDelta,
      newsDelta: trendSnapshots.newsDelta,
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

  const wikiDelta = snap?.wikiDelta ?? 0;
  const newsDelta = snap?.newsDelta ?? 0;

  let wikiPulse: TrendSignals["wikiPulse"] = "stable";
  if (wikiDelta > 0.15) wikiPulse = "rising";
  else if (wikiDelta < -0.15) wikiPulse = "falling";

  let newsLevel: TrendSignals["newsLevel"] = "amber";
  if (newsDelta > 0.3) newsLevel = "red";
  else if (newsDelta < -0.1) newsLevel = "green";

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
    wikiPulse,
    newsLevel,
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
  const confidence = decision.confidence ?? 0.5;

  const fallbackConviction = isSharp ? 0.6 : 0.4;
  const convictionFactor = Math.max(
    0,
    Math.min(1, pick?.conviction ?? fallbackConviction),
  );

  // |edge|: ranker pick first, deterministic engine second. Both are
  // signed; magnitude is what matters for sizing intent.
  const edgeMagnitude =
    pick?.edge != null && Number.isFinite(pick.edge)
      ? Math.abs(pick.edge)
      : Math.max(0, decision.edge ?? 0);
  // 10% edge = full size; larger edges get extra stretch up to 1.5x. Cap
  // is intentional — beyond ~15% edge the LLM is probably overconfident.
  const edgeFactor = Math.max(0, Math.min(1.5, edgeMagnitude / 0.10));

  const smartness = convictionFactor * edgeFactor;
  const smartnessMultiplier = 1 + 0.6 * smartness;

  // Narrow variance — ±15%. The point of the new curve is that smart
  // signals drive size, not RNG.
  const variance = 0.85 + Math.random() * 0.30;
  const base = computeStakeAmount(confidence);
  const stake = Math.round(base * simulation.stakeMultiplier * smartnessMultiplier * variance);

  // Soft cap: ±8% per-agent jitter on the persona maxStake so high-stake
  // bets don't all hit the cap at the exact same number.
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
