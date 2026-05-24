import { sql } from "drizzle-orm";

export type SnapshotScore = {
  score: number;
  snapshotAt: string;
  /** Number of trend_snapshots in the 6h median window; 1 when single-tick fallback. */
  sampleCount?: number;
};

export type OpeningScore = SnapshotScore & {
  personId: string;
};

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
    }));
}

type SqlExecutor = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows?: Record<string, unknown>[] }>;
};

/**
 * Opening score per person: 6-hour median of fame_index when >=3 samples,
 * otherwise latest single tick within 14 days.
 */
export async function loadOpeningScoreMap(
  personIds: string[],
  executor: SqlExecutor,
): Promise<Map<string, SnapshotScore>> {
  const map = new Map<string, SnapshotScore>();
  if (personIds.length === 0) return map;

  const idList = sql.join(personIds.map((id) => sql`${id}`), sql`, `);

  const medianRows = await executor.execute(sql`
    SELECT person_id,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fame_index)::int AS opening_score,
           MAX(timestamp) AS snapshot_at,
           COUNT(*)::int AS sample_count
    FROM trend_snapshots
    WHERE person_id IN (${idList})
      AND timestamp >= NOW() - INTERVAL '6 hours'
    GROUP BY person_id
    HAVING COUNT(*) >= 3
  `);

  const covered = new Set<string>();
  for (const row of medianRows.rows ?? []) {
    if (row.opening_score == null) continue;
    const personId = String(row.person_id);
    map.set(personId, {
      score: Number(row.opening_score),
      snapshotAt: new Date(row.snapshot_at as string).toISOString(),
      sampleCount: Number(row.sample_count ?? 3),
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
      AND timestamp > NOW() - INTERVAL '14 days'
    ORDER BY person_id, timestamp DESC
  `);

  for (const row of fallbackRows.rows ?? []) {
    if (row.fame_index == null) continue;
    map.set(String(row.person_id), {
      score: Number(row.fame_index),
      snapshotAt: new Date(row.timestamp as string).toISOString(),
      sampleCount: 1,
    });
  }

  return map;
}
