import { db } from "../../db";
import { sql } from "drizzle-orm";

export const VOLATILITY_SAMPLE_FLOOR = 100;

export interface VolatilityPerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  stddev: number;
  sampleCount: number;
  fameIndex: number | null;
}

export interface VolatilityResponse {
  volatile: VolatilityPerson[];
  stable: VolatilityPerson[];
  sampleFloor: number;
}

export async function loadVolatility(): Promise<VolatilityResponse> {
  const result = await db.execute(sql`
    WITH hourly AS (
      SELECT
        person_id,
        fame_index,
        timestamp
      FROM trend_snapshots
      WHERE snapshot_origin = 'ingest'
        AND timestamp = date_trunc('hour', timestamp)
        AND fame_index IS NOT NULL
        AND timestamp >= NOW() - INTERVAL '30 days'
    ),
    stats AS (
      SELECT
        h.person_id,
        STDDEV(h.fame_index::float) AS stddev,
        COUNT(*)::int AS sample_count
      FROM hourly h
      GROUP BY h.person_id
      HAVING COUNT(*) >= ${VOLATILITY_SAMPLE_FLOOR}
    )
    SELECT
      s.person_id AS id,
      tp.name,
      tp.avatar,
      tp.category,
      tp.rank,
      s.stddev,
      s.sample_count,
      tp.fame_index AS fame_index
    FROM stats s
    INNER JOIN trending_people tp ON tp.id = s.person_id
    ORDER BY s.stddev DESC
    LIMIT 20
  `);

  const rows =
    (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];

  const mapped: VolatilityPerson[] = rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    avatar: (row.avatar as string) ?? null,
    category: (row.category as string) ?? null,
    rank: Number(row.rank ?? 0),
    stddev: Number(row.stddev ?? 0),
    sampleCount: Number(row.sample_count ?? 0),
    fameIndex: row.fame_index != null ? Number(row.fame_index) : null,
  }));

  const volatile = mapped.slice(0, 10);
  const stable = [...mapped].sort((a, b) => a.stddev - b.stddev).slice(0, 10);

  return { volatile, stable, sampleFloor: VOLATILITY_SAMPLE_FLOOR };
}
