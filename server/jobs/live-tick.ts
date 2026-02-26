import { db } from "../db";
import { trendingPeople, votes, celebrityValueVotes } from "@shared/schema";
import { sql, eq, gte, and } from "drizzle-orm";

const LIVE_WEIGHT = 0.12;
const MAX_RANK_DELTA = 3;
const VOTE_BOOST_POINTS = 150;
const VIEW_BOOST_POINTS = 30;
const TICK_INTERVAL_MS = 10 * 60 * 1000;
const DAMPEN_DECAY_STEP = 0.1;

let _lastFullRefreshAt: Date | null = null;

export function setLastFullRefreshAt(date: Date) {
  _lastFullRefreshAt = date;
}

export function getLastFullRefreshAt(): Date | null {
  return _lastFullRefreshAt;
}

async function getRecentVoteCounts(sinceMinutes: number): Promise<Map<string, number>> {
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
  const counts = new Map<string, number>();

  try {
    const recentVotes = await db
      .select({
        targetId: votes.targetId,
        count: sql<number>`COUNT(*)`,
      })
      .from(votes)
      .where(and(
        gte(votes.votedAt, since),
        sql`${votes.targetType} = 'celebrity'`
      ))
      .groupBy(votes.targetId);

    for (const row of recentVotes) {
      counts.set(row.targetId, Number(row.count));
    }
  } catch (e) {
    // votes table might be empty or not have recent entries
  }

  try {
    const recentValueVotes = await db
      .select({
        celebrityId: celebrityValueVotes.celebrityId,
        count: sql<number>`COUNT(*)`,
      })
      .from(celebrityValueVotes)
      .where(gte(celebrityValueVotes.updatedAt, since))
      .groupBy(celebrityValueVotes.celebrityId);

    for (const row of recentValueVotes) {
      const existing = counts.get(row.celebrityId) || 0;
      counts.set(row.celebrityId, existing + Number(row.count));
    }
  } catch (e) {
    // value votes table might be empty
  }

  return counts;
}

export async function runLiveTick(): Promise<{ processed: number; moved: number }> {
  const now = new Date();

  const people = await db
    .select({
      id: trendingPeople.id,
      fameIndex: trendingPeople.fameIndex,
      fameIndexLive: trendingPeople.fameIndexLive,
      rank: trendingPeople.rank,
      liveRank: trendingPeople.liveRank,
      liveDampen: trendingPeople.liveDampen,
      profileViews10m: trendingPeople.profileViews10m,
    })
    .from(trendingPeople)
    .orderBy(sql`${trendingPeople.fameIndex} DESC NULLS LAST`);

  if (people.length === 0) return { processed: 0, moved: 0 };

  const voteCounts = await getRecentVoteCounts(10);

  const liveScores: Array<{
    id: string;
    canonical: number;
    liveScore: number;
    dampen: number;
    views: number;
    voteCount: number;
  }> = [];

  for (const p of people) {
    const canonical = p.fameIndex ?? 0;
    let dampen = p.liveDampen ?? 1.0;
    if (dampen < 1.0) {
      dampen = Math.min(1.0, dampen + DAMPEN_DECAY_STEP);
    }
    const views = p.profileViews10m ?? 0;
    const voteCount = voteCounts.get(p.id) ?? 0;

    const voteBoost = voteCount * VOTE_BOOST_POINTS;
    const viewBoost = views * VIEW_BOOST_POINTS;
    const totalBoost = voteBoost + viewBoost;

    const weight = LIVE_WEIGHT * dampen;
    const liveScore = Math.round(canonical + totalBoost * weight);

    liveScores.push({
      id: p.id,
      canonical,
      liveScore,
      dampen,
      views,
      voteCount,
    });
  }

  liveScores.sort((a, b) => b.liveScore - a.liveScore);

  const canonicalRankMap = new Map<string, number>();
  for (const p of people) {
    canonicalRankMap.set(p.id, p.rank);
  }

  const prevLiveMap = new Map<string, { fameIndexLive: number | null; liveRank: number | null; liveDampen: number | null }>();
  for (const p of people) {
    prevLiveMap.set(p.id, {
      fameIndexLive: p.fameIndexLive ?? null,
      liveRank: p.liveRank,
      liveDampen: p.liveDampen,
    });
  }

  let moved = 0;
  let written = 0;

  for (let i = 0; i < liveScores.length; i++) {
    const item = liveScores[i];
    const newLiveRank = i + 1;
    const canonicalRank = canonicalRankMap.get(item.id) ?? newLiveRank;

    let finalRank = newLiveRank;
    const rankDelta = Math.abs(newLiveRank - canonicalRank);
    if (rankDelta > MAX_RANK_DELTA) {
      finalRank = canonicalRank + (newLiveRank > canonicalRank ? MAX_RANK_DELTA : -MAX_RANK_DELTA);
    }

    if (finalRank !== canonicalRank) moved++;

    const prev = prevLiveMap.get(item.id);
    const scoreChanged = !prev || prev.fameIndexLive !== item.liveScore;
    const rankChanged = !prev || prev.liveRank !== finalRank;
    const dampenChanged = !prev || Math.abs((prev.liveDampen ?? 1.0) - item.dampen) > 0.001;
    const viewsNeedReset = item.views > 0;

    if (scoreChanged || rankChanged || dampenChanged || viewsNeedReset) {
      await db.update(trendingPeople)
        .set({
          fameIndexLive: item.liveScore,
          liveRank: finalRank,
          liveDampen: item.dampen,
          liveUpdatedAt: now,
          profileViews10m: 0,
        })
        .where(eq(trendingPeople.id, item.id));
      written++;
    }
  }

  if (!_lastFullRefreshAt) {
    try {
      const [latest] = await db
        .select({ ts: sql<Date>`MAX(${trendingPeople.liveUpdatedAt})` })
        .from(trendingPeople);
      if (latest?.ts) {
        _lastFullRefreshAt = new Date(latest.ts);
      }
    } catch (e) {}
  }

  console.log(`[LiveTick] Processed ${liveScores.length} people, ${written} rows written, ${moved} rank changes, ${voteCounts.size} with recent votes`);
  return { processed: liveScores.length, moved };
}

export async function applySnapBackDampening(): Promise<number> {
  const people = await db
    .select({
      id: trendingPeople.id,
      rank: trendingPeople.rank,
      liveRank: trendingPeople.liveRank,
      liveDampen: trendingPeople.liveDampen,
    })
    .from(trendingPeople);

  let dampened = 0;

  for (const p of people) {
    const hourlyRank = p.rank;
    const liveRank = p.liveRank ?? hourlyRank;
    const diff = Math.abs(hourlyRank - liveRank);

    let newDampen = 1.0;
    if (diff > 5) {
      newDampen = 0.5;
      dampened++;
    }

    if (newDampen !== (p.liveDampen ?? 1.0)) {
      await db.update(trendingPeople)
        .set({ liveDampen: newDampen })
        .where(eq(trendingPeople.id, p.id));
    }
  }

  if (dampened > 0) {
    console.log(`[LiveTick] Dampened ${dampened} people due to snap-back risk`);
  }

  return dampened;
}

let _tickTimer: ReturnType<typeof setInterval> | null = null;

export function startLiveTickScheduler() {
  console.log(`[LiveTick] Starting scheduler (every ${TICK_INTERVAL_MS / 60000} min)`);

  setTimeout(() => {
    runLiveTick().catch(e => console.error("[LiveTick] Error:", e));
  }, 15000);

  function scheduleNext() {
    const now = new Date();
    const nextTick = new Date(now);
    nextTick.setSeconds(0, 0);
    const currentMinute = nextTick.getMinutes();
    let nextBoundary = Math.ceil(currentMinute / 10) * 10;
    if (nextBoundary === currentMinute) {
      // Already at a 10-minute boundary; always advance to the NEXT one.
      // (Staying at the same boundary would schedule a tick in the past → 1s loop bug)
      nextBoundary = currentMinute + 10;
    }
    if (nextBoundary >= 60) {
      nextTick.setHours(nextTick.getHours() + 1);
      nextTick.setMinutes(nextBoundary - 60);
    } else {
      nextTick.setMinutes(nextBoundary);
    }
    const ms = Math.max(nextTick.getTime() - now.getTime(), 1000);
    console.log(`[LiveTick] Next tick at ${nextTick.toISOString()} (in ${Math.round(ms / 1000)}s)`);
    _tickTimer = setTimeout(async () => {
      try {
        await runLiveTick();
      } catch (e) {
        console.error("[LiveTick] Error:", e);
      }
      scheduleNext();
    }, ms);
  }

  scheduleNext();
}

export function stopLiveTickScheduler() {
  if (_tickTimer) {
    clearTimeout(_tickTimer);
    _tickTimer = null;
    console.log("[LiveTick] Scheduler stopped");
  }
}
