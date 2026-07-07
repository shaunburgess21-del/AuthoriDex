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
 * Cushion past the 7d momentum anchor and the "latest" lookup. Snapshots are
 * written every 10 minutes for active people, so the row we want is virtually
 * always within hours; 14 days is a generous backstop in case of an ingest
 * gap. Critically, bounding these reads keeps the planner on the
 * `(person_id, snapshot_origin, timestamp DESC)` index — without a lower
 * bound the planner sometimes falls off the index on a long IN-list and
 * seq-scans the whole `trend_snapshots` table, hitting `statement_timeout`.
 * Mirrors the pattern in `loadOpeningScoreMap` + `generateWeeklyUpDown`.
 */
const LATEST_LOOKBACK_CUSHION_DAYS = 14;

/**
 * Batched movement stats for gainer field selection (mirrors insights volatility
 * hourly bucketing). `momentum7d` is |% change| from fame at `asOf - 7d` to `asOf`.
 *
 * Runs as three separate queries (stddev / latest / week_ago) instead of one
 * 3-CTE statement so each gets its own `statement_timeout` budget and the
 * planner only has to reason about one scan at a time. The previous single
 * statement timed out on Supabase's 30s `statement_timeout` because the
 * unbounded `latest` / `week_ago` CTEs pulled the planner into a seq scan.
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

  // 1. stddev + sample count over the trailing 30d hourly window. This is the
  //    heaviest scan, so it gets its own statement_timeout budget.
  const stddevRows = await executor.execute(sql`
    SELECT
      person_id,
      STDDEV(fame_index::float) AS stddev30d,
      COUNT(*)::int AS sample_count
    FROM trend_snapshots
    WHERE person_id IN (${idList})
      AND snapshot_origin = 'ingest'
      AND timestamp = date_trunc('hour', timestamp)
      AND fame_index IS NOT NULL
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp >= ${asOfIso}::timestamptz - make_interval(days => ${GAINER_MOVEMENT_STDDEV_DAYS}::int)
    GROUP BY person_id
  `);

  const stats = new Map<string, { stddev30d: number; sampleCount: number }>();
  for (const row of stddevRows.rows ?? []) {
    const personId = String(row.person_id);
    stats.set(personId, {
      stddev30d: Number(row.stddev30d ?? 0),
      sampleCount: Number(row.sample_count ?? 0),
    });
  }

  if (stats.size === 0) return map;

  // Only bother with latest / week_ago for people who have stddev data —
  // matches the original `vol`-driven semantics where a person with no
  // hourly snapshots in the 30d window is excluded entirely.
  const coveredIds = Array.from(stats.keys());
  const coveredList = sql.join(coveredIds.map((id) => sql`${id}`), sql`, `);

  // 2. latest fame_index per person (bounded to asOf - 14d cushion).
  const latestRows = await executor.execute(sql`
    SELECT DISTINCT ON (person_id)
      person_id,
      fame_index::float AS fame_now
    FROM trend_snapshots
    WHERE person_id IN (${coveredList})
      AND snapshot_origin = 'ingest'
      AND fame_index IS NOT NULL
      AND timestamp <= ${asOfIso}::timestamptz
      AND timestamp >= ${asOfIso}::timestamptz - make_interval(days => ${LATEST_LOOKBACK_CUSHION_DAYS}::int)
    ORDER BY person_id, timestamp DESC
  `);

  const latestMap = new Map<string, number>();
  for (const row of latestRows.rows ?? []) {
    if (row.fame_now != null) {
      latestMap.set(String(row.person_id), Number(row.fame_now));
    }
  }

  // 3. fame_index at ~7d ago (bounded to asOf - 7d - 14d cushion so the
  //    planner has a tight range to use the index).
  const weekAgoLowerDays = GAINER_MOVEMENT_MOMENTUM_DAYS + LATEST_LOOKBACK_CUSHION_DAYS;
  const weekAgoRows = await executor.execute(sql`
    SELECT DISTINCT ON (person_id)
      person_id,
      fame_index::float AS fame_then
    FROM trend_snapshots
    WHERE person_id IN (${coveredList})
      AND snapshot_origin = 'ingest'
      AND fame_index IS NOT NULL
      AND timestamp <= ${asOfIso}::timestamptz - make_interval(days => ${GAINER_MOVEMENT_MOMENTUM_DAYS}::int)
      AND timestamp >= ${asOfIso}::timestamptz - make_interval(days => ${weekAgoLowerDays}::int)
    ORDER BY person_id, timestamp DESC
  `);

  const weekAgoMap = new Map<string, number>();
  for (const row of weekAgoRows.rows ?? []) {
    if (row.fame_then != null) {
      weekAgoMap.set(String(row.person_id), Number(row.fame_then));
    }
  }

  for (const [personId, stat] of stats) {
    const fameNow = latestMap.get(personId);
    const fameThen = weekAgoMap.get(personId);
    let momentum7d = 0;
    if (fameThen != null && fameThen > 0 && fameNow != null) {
      momentum7d = Math.abs((fameNow - fameThen) / fameThen);
    }
    map.set(personId, {
      personId,
      stddev30d: stat.stddev30d,
      momentum7d,
      sampleCount: stat.sampleCount,
    });
  }

  return map;
}
