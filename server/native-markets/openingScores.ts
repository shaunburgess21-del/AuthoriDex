import { sql } from "drizzle-orm";
import {
  OFFICIAL_SNAPSHOT_ORIGIN_SQL,
  OFFICIAL_SNAPSHOT_HOURLY_SQL,
} from "../scoring/official-snapshots";

export type SnapshotScore = {
  score: number;
  snapshotAt: string;
  /** Number of trend_snapshots in the window; 1 when single-tick fallback. */
  sampleCount?: number;
  /** How the opening score was derived: 7d_median | 6h_median | latest_tick */
  windowMethod?: "7d_median" | "6h_median" | "latest_tick";
  windowDays?: number;
};

export type OpeningScore = SnapshotScore & {
  personId: string;
};

export type LoadOpeningScoreOptions = {
  /** Anchor the trailing window to this instant (defaults to NOW()). */
  asOf?: Date;
};

const SEVEN_DAY_MIN_SAMPLES = 24;

export function buildOpeningScores(
  personIds: string[],
  snapMap: Map<string, SnapshotScore>,
): OpeningScore[] {
  return personIds
    .map((personId) => ({ personId, snap: snapMap.get(personId) }))
    .filter((row): row is { personId: string; snap: SnapshotScore } => Boolean(row.snap))
    .map((row) => ({
      personId: row.personId,
      score: row.snap.score,
      snapshotAt: row.snap.snapshotAt,
      ...(row.snap.sampleCount != null ? { sampleCount: row.snap.sampleCount } : {}),
      ...(row.snap.windowMethod != null ? { windowMethod: row.snap.windowMethod } : {}),
      ...(row.snap.windowDays != null ? { windowDays: row.snap.windowDays } : {}),
    }));
}

type SqlExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows?: Record<string, unknown>[] }>;
};

/**
 * Opening score per person. Priority:
 *   1. 7-day trailing median of fame_index (>= 24 samples) ending at `asOf`
 *   2. 6-hour median when >= 3 samples (legacy fast path)
 *   3. Latest single tick within 14 days
 */
export async function loadOpeningScoreMap(
  personIds: string[],
  executor: SqlExecutor,
  options: LoadOpeningScoreOptions = {},
): Promise<Map<string, SnapshotScore>> {
  const map = new Map<string, SnapshotScore>();
  if (personIds.length === 0) return map;

  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();

  const idList = sql.join(personIds.map((id) => sql`${id}`), sql`, `);

  const sevenDayRows = await executor.execute(sql`
    SELECT person_id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fame_index)::int AS opening_score,
           MAX(timestamp) AS snapshot_at,
           COUNT(*)::int AS sample_count
    FROM trend_snapshots
    WHERE person_id IN (${idList})
      AND snapshot_origin = ${OFFICIAL_SNAPSHOT_ORIGIN_SQL}
      AND ${OFFICIAL_SNAPSHOT_HOURLY_SQL}
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp >= ${asOfIso}::timestamptz - INTERVAL '7 days'
    GROUP BY person_id
    HAVING COUNT(*) >= ${SEVEN_DAY_MIN_SAMPLES}
  `);

  const covered = new Set<string>();
  for (const row of sevenDayRows.rows ?? []) {
    if (row.opening_score == null) continue;
    const personId = String(row.person_id);
    map.set(personId, {
      score: Number(row.opening_score),
      snapshotAt: new Date(row.snapshot_at as string).toISOString(),
      sampleCount: Number(row.sample_count ?? SEVEN_DAY_MIN_SAMPLES),
      windowMethod: "7d_median",
      windowDays: 7,
    });
    covered.add(personId);
  }

  const missingAfter7d = personIds.filter((id) => !covered.has(id));
  if (missingAfter7d.length === 0) return map;

  const missing7dList = sql.join(missingAfter7d.map((id) => sql`${id}`), sql`, `);
  const sixHourRows = await executor.execute(sql`
    SELECT person_id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fame_index)::int AS opening_score,
           MAX(timestamp) AS snapshot_at,
           COUNT(*)::int AS sample_count
    FROM trend_snapshots
    WHERE person_id IN (${missing7dList})
      AND snapshot_origin = ${OFFICIAL_SNAPSHOT_ORIGIN_SQL}
      AND ${OFFICIAL_SNAPSHOT_HOURLY_SQL}
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp >= ${asOfIso}::timestamptz - INTERVAL '6 hours'
    GROUP BY person_id
    HAVING COUNT(*) >= 3
  `);

  for (const row of sixHourRows.rows ?? []) {
    if (row.opening_score == null) continue;
    const personId = String(row.person_id);
    map.set(personId, {
      score: Number(row.opening_score),
      snapshotAt: new Date(row.snapshot_at as string).toISOString(),
      sampleCount: Number(row.sample_count ?? 3),
      windowMethod: "6h_median",
    });
    covered.add(personId);
  }

  const missing = personIds.filter((id) => !covered.has(id));
  if (missing.length === 0) return map;

  const missingList = sql.join(missing.map((id) => sql`${id}`), sql`, `);
  const fallbackRows = await executor.execute(sql`
    SELECT DISTINCT ON (person_id) person_id, fame_index, timestamp
    FROM trend_snapshots
    WHERE person_id IN (${missingList})
      AND snapshot_origin = ${OFFICIAL_SNAPSHOT_ORIGIN_SQL}
      AND ${OFFICIAL_SNAPSHOT_HOURLY_SQL}
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp > ${asOfIso}::timestamptz - INTERVAL '14 days'
    ORDER BY person_id, timestamp DESC
  `);

  for (const row of fallbackRows.rows ?? []) {
    if (row.fame_index == null) continue;
    map.set(String(row.person_id), {
      score: Number(row.fame_index),
      snapshotAt: new Date(row.timestamp as string).toISOString(),
      sampleCount: 1,
      windowMethod: "latest_tick",
    });
  }

  return map;
}
