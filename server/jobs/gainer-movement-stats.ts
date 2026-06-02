import { sql } from "drizzle-orm";
import { GAINER_MOVEMENT_STDDEV_DAYS, GAINER_MOVEMENT_MOMENTUM_DAYS } from "@shared/constants";
import { db } from "../db";

export type GainerMovementStat = {
  personId: string;
  stddev30d: number;
  momentum7d: number;
  sampleCount: number;
};

type SqlExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows?: Record<string, unknown>[] }>;
};

/**
 * Batched movement stats for gainer field selection (mirrors insights volatility
 * hourly bucketing). `momentum7d` is |% change| from fame at `asOf - 7d` to `asOf`.
 *
 * BACKLOG — gap-aware coverage (not urgent; self-heals as old gaps age out of the
 * 30d/7d windows). Eligibility and the stddev/momentum below use a raw COUNT plus
 * endpoint lookups over a fixed window. A person with a sparse, NON-contiguous
 * cluster of old snapshots — e.g. an ex-induction shadow promoted to the main
 * leaderboard while the May 2026 "everyone-tracked" incident cluster is still
 * inside the window — can (a) fast-track the 24-sample gate and (b) read
 * artificially high volatility AND momentum, because `week_ago` grabs a stale
 * value across a multi-week gap. Fix: require recent CONTIGUOUS coverage (N
 * distinct hours in the last D days with no large gap) for BOTH the eligibility
 * gate and the momentum baseline — not just a raw window COUNT. Land before any
 * category with a freshly-promoted inductee actually starts racing.
 */
export async function loadGainerMovementStats(
  personIds: string[],
  executor: SqlExecutor = db,
  options: { asOf?: Date } = {},
): Promise<Map<string, GainerMovementStat>> {
  const map = new Map<string, GainerMovementStat>();
  if (personIds.length === 0) return map;

  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const idList = sql.join(personIds.map((id) => sql`${id}`), sql`, `);

  const result = await executor.execute(sql`
    WITH hourly AS (
      SELECT
        person_id,
        fame_index,
        timestamp
      FROM trend_snapshots
      WHERE person_id IN (${idList})
        AND snapshot_origin = 'ingest'
        AND timestamp = date_trunc('hour', timestamp)
        AND fame_index IS NOT NULL
        AND timestamp <= ${asOfIso}::timestamptz
        AND timestamp >= ${asOfIso}::timestamptz - make_interval(days => ${GAINER_MOVEMENT_STDDEV_DAYS}::int)
    ),
    vol AS (
      SELECT
        person_id,
        STDDEV(fame_index::float) AS stddev30d,
        COUNT(*)::int AS sample_count
      FROM hourly
      GROUP BY person_id
    ),
    latest AS (
      SELECT DISTINCT ON (person_id)
        person_id,
        fame_index::float AS fame_now
      FROM trend_snapshots
      WHERE person_id IN (${idList})
        AND snapshot_origin = 'ingest'
        AND fame_index IS NOT NULL
        AND timestamp <= ${asOfIso}::timestamptz
      ORDER BY person_id, timestamp DESC
    ),
    week_ago AS (
      SELECT DISTINCT ON (person_id)
        person_id,
        fame_index::float AS fame_then
      FROM trend_snapshots
      WHERE person_id IN (${idList})
        AND snapshot_origin = 'ingest'
        AND fame_index IS NOT NULL
        AND timestamp <= ${asOfIso}::timestamptz - make_interval(days => ${GAINER_MOVEMENT_MOMENTUM_DAYS}::int)
      ORDER BY person_id, timestamp DESC
    )
    SELECT
      v.person_id,
      COALESCE(v.stddev30d, 0)::float AS stddev30d,
      v.sample_count,
      CASE
        WHEN w.fame_then IS NOT NULL AND w.fame_then > 0 AND l.fame_now IS NOT NULL
        THEN ABS((l.fame_now - w.fame_then) / w.fame_then)
        ELSE 0
      END::float AS momentum7d
    FROM vol v
    LEFT JOIN latest l ON l.person_id = v.person_id
    LEFT JOIN week_ago w ON w.person_id = v.person_id
  `);

  const rows = result.rows ?? [];
  for (const row of rows) {
    const personId = String(row.person_id);
    map.set(personId, {
      personId,
      stddev30d: Number(row.stddev30d ?? 0),
      momentum7d: Number(row.momentum7d ?? 0),
      sampleCount: Number(row.sample_count ?? 0),
    });
  }

  return map;
}
