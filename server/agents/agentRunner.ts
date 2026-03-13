/**
 * Orchestrator: fetches active agents and open markets, computes decisions,
 * writes scheduled actions to the DB. Does NOT place bets directly.
 */

import { db } from "../db";
import {
  agentConfigs,
  predictionMarkets,
  marketEntries,
  trendingPeople,
  trendSnapshots,
  scheduledAgentActions,
  profiles,
  creditLedger,
} from "@shared/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { log } from "../log";
import { computePrediction } from "./decisionEngine";
import type {
  AgentConfigData,
  MarketWithEntries,
  TrendSignals,
  CrowdSplit,
} from "./types";
import {
  ARCHETYPE_DELAY_RANGES,
  QUIET_HOUR_START_SAST,
  QUIET_HOUR_END_SAST,
  BASE_STAKE_AMOUNT,
  MAX_AGENT_STAKE,
  AGENT_RUNNER_INTERVAL_MS,
  AGENT_RUNNER_STARTUP_DELAY_MS,
  AGENT_CREDIT_LOW_THRESHOLD,
  AGENT_CREDIT_TOPUP_TARGET,
} from "./constants";

export async function runAgentBatch(): Promise<{
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

      if (!profile || profile.predictCredits >= AGENT_CREDIT_LOW_THRESHOLD) {
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
        idempotencyKey: `agent_topup_${agent.id}_${Date.now()}`,
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
      status: predictionMarkets.status,
      title: predictionMarkets.title,
      category: predictionMarkets.category,
      personId: predictionMarkets.personId,
      endAt: predictionMarkets.endAt,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "OPEN"),
        eq(predictionMarkets.visibility, "live"),
        gte(predictionMarkets.endAt, now)
      )
    );

  if (!markets.length) {
    log("[AgentRunner] No active markets found");
    return { scheduled: 0, abstained: 0, skipped: 0, diagnostics: diag };
  }

  const marketSummary = markets.map(m => ({
    id: m.id.slice(0, 8),
    type: m.marketType,
    title: m.title?.slice(0, 40),
    personId: m.personId?.slice(0, 8) ?? null,
    endAt: m.endAt?.toISOString?.() ?? null,
  }));
  log(`[AgentRunner] Found ${markets.length} open markets: ${JSON.stringify(marketSummary)}`);

  let scheduled = 0;
  let abstained = 0;
  let skipped = 0;
  let skippedCommunity = 0;
  let skippedNoEntries = 0;
  let skippedNoEntryId = 0;

  for (const agent of agents) {
    const agentData = toAgentData(agent);

    for (const market of markets) {
      if (market.marketType === "community") {
        skippedCommunity++;
        continue;
      }

      const alreadyExists = await db
        .select({ id: scheduledAgentActions.id })
        .from(scheduledAgentActions)
        .where(
          and(
            eq(scheduledAgentActions.agentId, agent.id),
            eq(scheduledAgentActions.marketId, market.id),
            sql`${scheduledAgentActions.status} IN ('pending', 'executed')`
          )
        )
        .limit(1);

      if (alreadyExists.length > 0) {
        skipped++;
        continue;
      }

      const entries = await db
        .select({
          id: marketEntries.id,
          label: marketEntries.label,
          totalStake: marketEntries.totalStake,
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

      const signals = await getTrendSignals(market.personId);
      const crowd = computeCrowdSplit(entries);

      const decision = computePrediction(agentData, marketData, signals, crowd);

      if (decision.abstain) {
        abstained++;
        log(`[AgentRunner] ${agent.displayName} abstained on ${market.id.slice(0, 8)}: ${decision.abstainReason}`);
        continue;
      }

      if (!decision.entryId) {
        skippedNoEntryId++;
        log(`[AgentRunner] ${agent.displayName} decision had no entryId for ${market.id.slice(0, 8)}: ${JSON.stringify(decision)}`);
        continue;
      }

      const executeAfter = computeExecuteAfter(agent.archetype);
      const stakeAmount = computeStakeAmount(decision.confidence ?? 0.5);

      await db.insert(scheduledAgentActions).values({
        agentId: agent.id,
        marketId: market.id,
        entryId: decision.entryId,
        actionType: "predict",
        decisionPayload: decision,
        stakeAmount,
        executeAfter,
        status: "pending",
      });

      scheduled++;
      log(`[AgentRunner] ${agent.displayName} → ${market.title?.slice(0, 30)} (entry=${decision.entryId.slice(0, 8)}, confidence=${decision.confidence?.toFixed(2)}, stake=${stakeAmount}, execAfter=${executeAfter.toISOString()})`);
    }
  }

  const exitStats = { scheduled, abstained, skipped, skippedCommunity, skippedNoEntries, skippedNoEntryId };
  log(`[AgentRunner] Batch complete: ${JSON.stringify(exitStats)}`);
  return { ...exitStats, diagnostics: diag };
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
    isActive: row.isActive,
  };
}

async function getTrendSignals(
  personId: string | null
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

  return {
    trendScore,
    fameIndex,
    scoreBaseline: snap?.fameIndex ?? fameIndex,
    scoreDelta7d: change7d,
    wikiPulse,
    newsLevel,
  };
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
  const delaySec = Math.floor(Math.random() * (max - min) + min);
  const executeAt = new Date(Date.now() + delaySec * 1000);

  // SAST quiet window: push to 07:00 SAST if in quiet hours
  const sastHour = (executeAt.getUTCHours() + 2) % 24;
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
