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
  /** How the opening score was derived: 6h_median | 7d_median | latest_tick */
  windowMethod?: "6h_median" | "7d_median" | "latest_tick";
  windowDays?: number;
};

export type OpeningScore = SnapshotScore & {
  personId: string;
};

export type LoadOpeningScoreOptions = {
  /** Anchor the trailing window to this instant (defaults to NOW()). */
  asOf?: Date;
};

/**
 * Minimum samples for the 6h primary window. 3 is the smallest count that
 * makes a median meaningful; in practice hourly ingest produces 6 samples
 * for any person with healthy recent coverage.
 */
const SIX_HOUR_MIN_SAMPLES = 3;

/**
 * Minimum samples for the 7d fallback window. People who fall through to
 * this path have sparse recent coverage (e.g. a new inductee or someone
 * with an ingest gap); requiring 24 hourly samples over 7 days ensures
 * the fallback is still a real central tendency, not a couple of stray
 * ticks.
 */
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
 * Opening score per person. Priority (changed Jul 2026 — see note below):
 *   1. 6-hour trailing median of fame_index (>= 3 samples) ending at `asOf`
 *      — primary path. With `asOf = monday` (00:00 UTC) this is the median
 *      of Sunday 18:00 → Monday 00:00, i.e. "where they were Sunday evening"
 *      rather than the trailing-week median. The previous 7d-median primary
 *      captured intra-week peaks and made almost every runner appear "down"
 *      vs baseline on naturally-declining weeks.
 *   2. 7-day trailing median when >= 24 samples — fallback for people whose
 *      recent 6h window is too sparse (e.g. a new inductee or someone with
 *      an ingest gap right at the week boundary). Keeps a real central
 *      tendency instead of dropping to a single tick.
 *   3. Latest single tick within 14 days — last resort.
 *
 * Baseline choice only affects NEW markets created by the weekly generator.
 * Already-OPEN markets keep the `metadata.openingScore` they were created
 * with, so this change never retroactively moves the goalposts on a market
 * that has bets against it.
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

  // 1. Primary: 6h trailing median ending at `asOf`. For weekly markets
  //    `asOf = monday` (Monday 00:00 UTC), so this window is Sunday 18:00
  //    → Monday 00:00 — i.e. "Sunday evening's level", which is the
  //    user-mental-model baseline for a Monday-starting market week.
  const sixHourRows = await executor.execute(sql`
    SELECT person_id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fame_index)::int AS opening_score,
           MAX(timestamp) AS snapshot_at,
           COUNT(*)::int AS sample_count
    FROM trend_snapshots
    WHERE person_id IN (${idList})
      AND snapshot_origin = ${OFFICIAL_SNAPSHOT_ORIGIN_SQL}
      AND ${OFFICIAL_SNAPSHOT_HOURLY_SQL}
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp >= ${asOfIso}::timestamptz - INTERVAL '6 hours'
    GROUP BY person_id
    HAVING COUNT(*) >= ${SIX_HOUR_MIN_SAMPLES}
  `);

  const covered = new Set<string>();
  for (const row of sixHourRows.rows ?? []) {
    if (row.opening_score == null) continue;
    const personId = String(row.person_id);
    map.set(personId, {
      score: Number(row.opening_score),
      snapshotAt: new Date(row.snapshot_at as string).toISOString(),
      sampleCount: Number(row.sample_count ?? SIX_HOUR_MIN_SAMPLES),
      windowMethod: "6h_median",
    });
    covered.add(personId);
  }

  const missingAfter6h = personIds.filter((id) => !covered.has(id));
  if (missingAfter6h.length === 0) return map;

  // 2. Fallback: 7-day trailing median for people whose 6h window was too
  //    sparse (new inductees, ingest gaps at the week boundary, etc.).
  //    Keeps a real central tendency instead of dropping to a single tick.
  const missing6hList = sql.join(missingAfter6h.map((id) => sql`${id}`), sql`, `);
  const sevenDayRows = await executor.execute(sql`
    SELECT person_id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fame_index)::int AS opening_score,
           MAX(timestamp) AS snapshot_at,
           COUNT(*)::int AS sample_count
    FROM trend_snapshots
    WHERE person_id IN (${missing6hList})
      AND snapshot_origin = ${OFFICIAL_SNAPSHOT_ORIGIN_SQL}
      AND ${OFFICIAL_SNAPSHOT_HOURLY_SQL}
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp >= ${asOfIso}::timestamptz - INTERVAL '7 days'
    GROUP BY person_id
    HAVING COUNT(*) >= ${SEVEN_DAY_MIN_SAMPLES}
  `);

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

  const missing = personIds.filter((id) => !covered.has(id));
  if (missing.length === 0) return map;

  // 3. Last resort: latest single tick within 14 days.
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
