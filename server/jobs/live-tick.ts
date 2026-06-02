import { db, withDbAdvisoryLock } from "../db";
import { trendingPeople, votes, celebrityValueVotes } from "@shared/schema";
import { sql, eq, gte, and, inArray } from "drizzle-orm";

/** Scheduler aligns to :00/:10/:20… — not this constant (legacy log only). */
const TICK_INTERVAL_MS = 10 * 60 * 1000;
const LIVE_TICK_LOCK_KEY = 5_203;

/** Minimum recent activity to show a cosmetic "surging" cue (votes + profile views). */
export const SURGE_ACTIVITY_THRESHOLD = 1;

let _lastFullRefreshAt: Date | null = null;

export function setLastFullRefreshAt(date: Date) {
  _lastFullRefreshAt = date;
}

export function getLastFullRefreshAt(): Date | null {
  return _lastFullRefreshAt;
}

/** Recent celebrity-target votes in the last N minutes (for cosmetic UI + ingest). */
export async function getRecentVoteCounts(sinceMinutes: number): Promise<Map<string, number>> {
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
        sql`${votes.targetType} = 'celebrity'`,
      ))
      .groupBy(votes.targetId);

    for (const row of recentVotes) {
      counts.set(row.targetId, Number(row.count));
    }
  } catch {
    // votes table might be empty
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
  } catch {
    // value votes table might be empty
  }

  return counts;
}

/** Batch surge map for leaderboard rows (cosmetic only). */
export async function getSurgingPersonIds(
  personIds: string[],
  sinceMinutes = 10,
): Promise<Set<string>> {
  const surging = new Set<string>();
  if (personIds.length === 0) return surging;

  const voteCounts = await getRecentVoteCounts(sinceMinutes);
  for (const id of personIds) {
    if ((voteCounts.get(id) ?? 0) >= SURGE_ACTIVITY_THRESHOLD) {
      surging.add(id);
    }
  }

  const viewRows = await db
    .select({ id: trendingPeople.id })
    .from(trendingPeople)
    .where(and(
      inArray(trendingPeople.id, personIds),
      sql`${trendingPeople.profileViews10m} >= ${SURGE_ACTIVITY_THRESHOLD}`,
    ));
  for (const row of viewRows) {
    surging.add(row.id);
  }

  return surging;
}

/**
 * Fast lane: cosmetic liveliness only. Mirrors canonical fame_index/rank into the
 * legacy live_* columns (for freshness heartbeat), resets view counters, never
 * writes trend_snapshots or competes with the hourly official score.
 */
async function runLiveTickOnce(): Promise<{ processed: number; moved: number }> {
  const now = new Date();

  const people = await db
    .select({
      id: trendingPeople.id,
      fameIndex: trendingPeople.fameIndex,
      rank: trendingPeople.rank,
      profileViews10m: trendingPeople.profileViews10m,
    })
    .from(trendingPeople);

  if (people.length === 0) return { processed: 0, moved: 0 };

  const voteCounts = await getRecentVoteCounts(10);
  let written = 0;
  let activeCount = 0;

  type LiveUpdate = {
    id: string;
    fameIndexLive: number;
    liveRank: number;
    profileViews10m: number;
  };
  const pendingUpdates: LiveUpdate[] = [];

  for (const p of people) {
    const canonicalScore = p.fameIndex ?? 0;
    const canonicalRank = p.rank ?? 0;
    const views = p.profileViews10m ?? 0;
    const voteCount = voteCounts.get(p.id) ?? 0;
    if (voteCount > 0 || views > 0) activeCount++;

    pendingUpdates.push({
      id: p.id,
      fameIndexLive: canonicalScore,
      liveRank: canonicalRank,
      profileViews10m: 0,
    });
  }

  if (pendingUpdates.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < pendingUpdates.length; i += CHUNK) {
      const chunk = pendingUpdates.slice(i, i + CHUNK);
      const valuesSql = sql.join(
        chunk.map((u) => sql`(${u.id}::varchar, ${u.fameIndexLive}::integer, ${u.liveRank}::integer, ${u.profileViews10m}::integer)`),
        sql`, `,
      );
      await db.execute(sql`
        UPDATE trending_people AS tp
        SET
          fame_index_live = v.fame_index_live,
          live_rank = v.live_rank,
          live_dampen = 1.0,
          live_updated_at = ${now},
          profile_views_10m = v.profile_views_10m
        FROM (VALUES ${valuesSql}) AS v(id, fame_index_live, live_rank, profile_views_10m)
        WHERE tp.id = v.id
      `);
      written += chunk.length;
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
    } catch (e) {
      console.error("[LiveTick] Error fetching last full refresh timestamp:", e);
    }
  }

  console.log(
    `[LiveTick] Cosmetic tick: ${people.length} people, ${written} rows synced to canonical, ${activeCount} with recent activity`,
  );
  return { processed: people.length, moved: 0 };
}

export async function runLiveTick(): Promise<{ processed: number; moved: number }> {
  const locked = await withDbAdvisoryLock(
    LIVE_TICK_LOCK_KEY,
    "LiveTick",
    runLiveTickOnce,
  );

  if (!locked.acquired) {
    console.log("[LiveTick] Skipping tick; another instance holds the lock");
    return { processed: 0, moved: 0 };
  }

  return locked.result ?? { processed: 0, moved: 0 };
}

/** @deprecated Snap-back dampening applied to competing live ranks; canonical-only lane makes this a no-op. */
export async function applySnapBackDampening(): Promise<number> {
  return 0;
}

let _tickTimer: ReturnType<typeof setTimeout> | null = null;

export function startLiveTickScheduler() {
  console.log("[LiveTick] Starting scheduler (10-minute boundaries)");

  setTimeout(() => {
    runLiveTick().catch((e) => console.error("[LiveTick] Error:", e));
  }, 15000);

  function scheduleNext() {
    const now = new Date();
    const nextTick = new Date(now);
    nextTick.setSeconds(0, 0);
    const currentMinute = nextTick.getMinutes();
    let nextBoundary = Math.ceil(currentMinute / 10) * 10;
    if (nextBoundary === currentMinute) {
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
