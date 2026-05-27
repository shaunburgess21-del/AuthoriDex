import { db } from "../../db";
import { trendSnapshots } from "@shared/schema";
import { and, isNotNull, sql } from "drizzle-orm";

/** Rank map from ~24h ago hourly ingest snapshots (for new-entrant detection). */
export async function loadSnapshotRankMap24hAgo(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const now = Date.now();
  const t24hAgo = new Date(now - 24 * 60 * 60 * 1000);
  const targetHour = new Date(t24hAgo);
  targetHour.setMinutes(0, 0, 0);
  const tLow = new Date(targetHour.getTime() - 8 * 60 * 60 * 1000);
  const tHigh = new Date(targetHour.getTime() + 8 * 60 * 60 * 1000);

  try {
    const nearestHourRow = await db
      .select({ hour: sql<string>`date_trunc('hour', ${trendSnapshots.timestamp})` })
      .from(trendSnapshots)
      .where(
        and(
          sql`${trendSnapshots.timestamp} BETWEEN ${tLow} AND ${tHigh}`,
          sql`${trendSnapshots.snapshotOrigin} = 'ingest'`,
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
        ),
      )
      .groupBy(sql`date_trunc('hour', ${trendSnapshots.timestamp})`)
      .orderBy(
        sql`ABS(EXTRACT(EPOCH FROM date_trunc('hour', ${trendSnapshots.timestamp}) - ${targetHour}::timestamp))`,
      )
      .limit(1);

    if (nearestHourRow.length === 0) return map;

    const snapshotHour = new Date(nearestHourRow[0].hour);
    const snapshotHourEnd = new Date(snapshotHour.getTime() + 60 * 60 * 1000);

    const prevSnapshot = await db
      .select({
        personId: trendSnapshots.personId,
        fameIndex: sql<number>`MAX(${trendSnapshots.fameIndex})`,
      })
      .from(trendSnapshots)
      .where(
        and(
          sql`${trendSnapshots.timestamp} >= ${snapshotHour} AND ${trendSnapshots.timestamp} < ${snapshotHourEnd}`,
          sql`${trendSnapshots.snapshotOrigin} = 'ingest'`,
          isNotNull(trendSnapshots.fameIndex),
        ),
      )
      .groupBy(trendSnapshots.personId)
      .orderBy(sql`MAX(${trendSnapshots.fameIndex}) DESC NULLS LAST`);

    prevSnapshot.forEach((s, i) => {
      map.set(s.personId, i + 1);
    });
  } catch (e) {
    console.warn("[insights] 24h snapshot rank map failed:", e);
  }

  return map;
}
