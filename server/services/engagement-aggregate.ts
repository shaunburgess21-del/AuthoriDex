import { db } from "../db";
import { votes, trendingPeople, trendSnapshots } from "@shared/schema";
import { and, gte, lt, sql, isNotNull, inArray, eq } from "drizzle-orm";
import { capEngagementInputs } from "../scoring/engagement";
import {
  officialSnapshotOriginCondition,
} from "../scoring/official-snapshots";

export type PersonEngagementSignals = {
  votes: number;
  /** Only populated on primary (non-backfill) ingest; not historically reconstructable. */
  profileViews: number;
};

export type EngagementIngestOptions = {
  /** Hour bucket start (UTC hour-truncated), same as snapshot timestamp. */
  hourBucket: Date;
  /** Primary hourly run vs backfill of a past hour. */
  isBackfill: boolean;
  personIds: string[];
};

/** Start of the trailing complete hour [hourBucket - 1h, hourBucket). */
function trailingHourStart(hourBucket: Date): Date {
  return new Date(hourBucket.getTime() - 60 * 60 * 1000);
}

/**
 * Votes with votedAt in the TRAILING complete hour [hourBucket - 1h, hourBucket).
 *
 * Ingest runs at :02, so the current hour [hourBucket, +1h) is almost entirely
 * in the future at capture time — windowing forward would undercount to the
 * first ~2 minutes and persist that. The trailing hour is complete + immutable
 * at capture, so primary and backfill runs compute the identical value (votes
 * become fully reconstructable on backfill).
 */
async function loadVotesForHourWindow(
  hourBucket: Date,
  personIds?: string[],
): Promise<Map<string, number>> {
  const windowStart = trailingHourStart(hourBucket);
  const counts = new Map<string, number>();

  const conditions = [
    gte(votes.votedAt, windowStart),
    lt(votes.votedAt, hourBucket),
    sql`${votes.targetType} = 'celebrity'`,
    isNotNull(votes.userId),
    sql`length(trim(${votes.userId})) > 0`,
  ];

  if (personIds && personIds.length > 0) {
    conditions.push(inArray(votes.targetId, personIds));
  }

  try {
    const voteRows = await db
      .select({
        targetId: votes.targetId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(votes)
      .where(and(...conditions))
      .groupBy(votes.targetId);

    for (const row of voteRows) {
      counts.set(row.targetId, Number(row.count));
    }
  } catch {
    // empty votes table
  }

  return counts;
}

/**
 * Read engagement persisted on official snapshots for this hour (backfill reuse).
 */
export async function loadPersistedEngagementForHour(
  hourBucket: Date,
  personIds: string[],
): Promise<Map<string, PersonEngagementSignals>> {
  const map = new Map<string, PersonEngagementSignals>();
  if (personIds.length === 0) return map;

  const rows = await db
    .select({
      personId: trendSnapshots.personId,
      diagnostics: trendSnapshots.diagnostics,
    })
    .from(trendSnapshots)
    .where(and(
      eq(trendSnapshots.timestamp, hourBucket),
      officialSnapshotOriginCondition(),
      inArray(trendSnapshots.personId, personIds),
    ));

  for (const row of rows) {
    const raw = (row.diagnostics as Record<string, unknown> | null)?.raw as
      | Record<string, unknown>
      | undefined;
    if (!raw) continue;
    const votes = Number(raw.engagementVotes ?? 0);
    const profileViews = Number(raw.engagementProfileViews ?? 0);
    if (!Number.isFinite(votes) && !Number.isFinite(profileViews)) continue;
    const capped = capEngagementInputs(
      Number.isFinite(votes) ? votes : 0,
      Number.isFinite(profileViews) ? profileViews : 0,
    );
    map.set(row.personId, capped);
  }

  return map;
}

/** Live profile-view counter — only meaningful on primary ingest (not backfill). */
async function loadLiveProfileViewCounts(
  personIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (personIds.length === 0) return map;

  const viewRows = await db
    .select({
      id: trendingPeople.id,
      views: trendingPeople.profileViews10m,
    })
    .from(trendingPeople)
    .where(inArray(trendingPeople.id, personIds));

  for (const row of viewRows) {
    const views = Number(row.views ?? 0);
    if (views > 0) map.set(row.id, views);
  }

  return map;
}

function mergeSignals(
  voteCounts: Map<string, number>,
  viewCounts: Map<string, number>,
  personIds: string[],
): { byPerson: Map<string, PersonEngagementSignals>; fleetTotalEvents: number } {
  const byPerson = new Map<string, PersonEngagementSignals>();
  let fleetTotalEvents = 0;

  const ids = personIds.length > 0
    ? personIds
    : [...new Set([...voteCounts.keys(), ...viewCounts.keys()])];

  for (const id of ids) {
    const capped = capEngagementInputs(
      voteCounts.get(id) ?? 0,
      viewCounts.get(id) ?? 0,
    );
    if (capped.votes > 0 || capped.profileViews > 0) {
      byPerson.set(id, capped);
      fleetTotalEvents += capped.votes + capped.profileViews;
    } else {
      byPerson.set(id, { votes: 0, profileViews: 0 });
    }
  }

  return { byPerson, fleetTotalEvents };
}

/**
 * Engagement inputs for one ingest hour bucket.
 *
 * - Votes: trailing complete hour [hourBucket - 1h, hourBucket) — immutable at
 *   :02 capture, so backfill-safe and fully reconstructable.
 * - Profile views: primary ingest only (rolling ~10-min counter, best-effort,
 *   not historically reconstructable); backfill reuses persisted snapshot
 *   diagnostics when available, else votes-only.
 */
export async function loadEngagementSignalsForIngest(
  options: EngagementIngestOptions,
): Promise<{ byPerson: Map<string, PersonEngagementSignals>; fleetTotalEvents: number }> {
  const { hourBucket, isBackfill, personIds } = options;

  if (isBackfill) {
    const persisted = await loadPersistedEngagementForHour(hourBucket, personIds);
    const voteCounts = await loadVotesForHourWindow(hourBucket, personIds);

    const byPerson = new Map<string, PersonEngagementSignals>();
    let fleetTotalEvents = 0;

    for (const id of personIds) {
      const fromSnap = persisted.get(id);
      if (fromSnap) {
        byPerson.set(id, fromSnap);
        fleetTotalEvents += fromSnap.votes + fromSnap.profileViews;
        continue;
      }
      const votes = voteCounts.get(id) ?? 0;
      const capped = capEngagementInputs(votes, 0);
      byPerson.set(id, capped);
      fleetTotalEvents += capped.votes;
    }

    return { byPerson, fleetTotalEvents };
  }

  const voteCounts = await loadVotesForHourWindow(hourBucket, personIds);
  const viewCounts = await loadLiveProfileViewCounts(personIds);
  return mergeSignals(voteCounts, viewCounts, personIds);
}
