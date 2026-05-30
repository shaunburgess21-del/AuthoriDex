import { db } from "../../db";
import { ingestionRuns, trendSnapshots } from "@shared/schema";
import { eq, and, gt, sql, desc, isNotNull } from "drizzle-orm";
import { SCORE_VERSION } from "../../scoring/normalize";

// Cached snapshot rank lookup (shared between /api/trending and /api/leaderboard)
// Pinned baseline: only re-selects when a new completed ingestion run is detected.
let _cachedPrevRanks: Map<string, number> | null = null;
let _lastCompletedRunId: string | null = null;

export async function getLatestCompletedRunId(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(eq(ingestionRuns.status, "completed"))
      .orderBy(desc(ingestionRuns.finishedAt))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function getSnapshotRankMap(): Promise<Map<string, number>> {
  const now = Date.now();

  const newestRunId = await getLatestCompletedRunId();
  const newRunCompleted = newestRunId && newestRunId !== _lastCompletedRunId;

  if (_cachedPrevRanks && _cachedPrevRanks.size > 0 && !newRunCompleted) {
    return _cachedPrevRanks;
  }

  if (newestRunId) {
    _lastCompletedRunId = newestRunId;
  }

  const map = new Map<string, number>();
  try {
    const t24hAgo = new Date(now - 24 * 60 * 60 * 1000);

    const [baselineRun] = await db
      .select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(and(
        eq(ingestionRuns.status, "completed"),
        eq(ingestionRuns.scoreVersion, SCORE_VERSION),
        gt(ingestionRuns.finishedAt, new Date(now - 28 * 60 * 60 * 1000)),
        sql`${ingestionRuns.finishedAt} < ${new Date(now - 20 * 60 * 60 * 1000)}`,
      ))
      .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${t24hAgo}::timestamp))`)
      .limit(1);

    if (baselineRun) {
      const prevSnapshot = await db
        .select({
          personId: trendSnapshots.personId,
          fameIndex: sql<number>`MAX(${trendSnapshots.fameIndex})`,
        })
        .from(trendSnapshots)
        .where(eq(trendSnapshots.runId, baselineRun.id))
        .groupBy(trendSnapshots.personId)
        .orderBy(sql`MAX(${trendSnapshots.fameIndex}) DESC NULLS LAST`);

      prevSnapshot.forEach((s, i) => {
        map.set(s.personId, i + 1);
      });
    } else {
      const targetHour = new Date(t24hAgo);
      targetHour.setMinutes(0, 0, 0);
      const tLow = new Date(targetHour.getTime() - 8 * 60 * 60 * 1000);
      const tHigh = new Date(targetHour.getTime() + 8 * 60 * 60 * 1000);

      const nearestHourRow = await db
        .select({ hour: sql<string>`date_trunc('hour', ${trendSnapshots.timestamp})` })
        .from(trendSnapshots)
        .where(and(
          sql`${trendSnapshots.timestamp} BETWEEN ${tLow} AND ${tHigh}`,
          isNotNull(trendSnapshots.runId),
        ))
        .groupBy(sql`date_trunc('hour', ${trendSnapshots.timestamp})`)
        .orderBy(sql`ABS(EXTRACT(EPOCH FROM date_trunc('hour', ${trendSnapshots.timestamp}) - ${targetHour}::timestamp))`)
        .limit(1);

      if (nearestHourRow.length > 0) {
        const snapshotHour = new Date(nearestHourRow[0].hour);
        const snapshotHourEnd = new Date(snapshotHour.getTime() + 60 * 60 * 1000);

        const prevSnapshot = await db
          .select({
            personId: trendSnapshots.personId,
            fameIndex: sql<number>`MAX(${trendSnapshots.fameIndex})`,
          })
          .from(trendSnapshots)
          .where(and(
            sql`${trendSnapshots.timestamp} >= ${snapshotHour} AND ${trendSnapshots.timestamp} < ${snapshotHourEnd}`,
            isNotNull(trendSnapshots.runId),
          ))
          .groupBy(trendSnapshots.personId)
          .orderBy(sql`MAX(${trendSnapshots.fameIndex}) DESC NULLS LAST`);

        prevSnapshot.forEach((s, i) => {
          map.set(s.personId, i + 1);
        });
      }
    }
  } catch (e) {
    console.warn("[rankChange] Snapshot rank computation failed:", e);
  }

  if (map.size > 0) {
    _cachedPrevRanks = map;
  }
  return map;
}

/** Test helper — clear rank-map memo between tests. */
export function clearSnapshotRankMapCacheForTests(): void {
  _cachedPrevRanks = null;
  _lastCompletedRunId = null;
}
