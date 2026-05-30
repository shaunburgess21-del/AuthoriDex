import { db } from "../../db";
import { sql } from "drizzle-orm";

export const STREAK_RETENTION_DAYS = 90;

export interface StreakPerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  streakHours: number;
  firstTop10At: string | null;
}

export interface StreaksResponse {
  firstTimeTop10: StreakPerson[];
  longestStreaks: StreakPerson[];
  retentionDays: number;
}

type StreakRow = Record<string, unknown>;

function extractRows(result: unknown): StreakRow[] {
  return (
    (Array.isArray(result) ? result : (result as { rows: StreakRow[] }).rows) ?? []
  );
}

function mapFirstTimeRow(row: StreakRow): StreakPerson {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    avatar: (row.avatar as string) ?? null,
    category: (row.category as string) ?? null,
    rank: Number(row.rank ?? 0),
    streakHours: 0,
    firstTop10At: row.first_top10_at
      ? new Date(row.first_top10_at as string | Date).toISOString()
      : null,
  };
}

function mapLongestRow(row: StreakRow): StreakPerson {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    avatar: (row.avatar as string) ?? null,
    category: (row.category as string) ?? null,
    rank: Number(row.rank ?? 0),
    streakHours: Number(row.streak_hours ?? 0),
    firstTop10At: row.streak_start
      ? new Date(row.streak_start as string | Date).toISOString()
      : null,
  };
}

/** Single round-trip: one 90-day hourly_ranks scan feeds both leaderboard branches. */
export async function loadStreaks(): Promise<StreaksResponse> {
  const result = await db.execute(sql`
    WITH hourly_ranks AS MATERIALIZED (
      SELECT
        person_id,
        timestamp,
        RANK() OVER (
          PARTITION BY timestamp
          ORDER BY fame_index DESC NULLS LAST
        ) AS rnk
      FROM trend_snapshots
      WHERE snapshot_origin = 'ingest'
        AND timestamp = date_trunc('hour', timestamp)
        AND fame_index IS NOT NULL
        AND timestamp >= NOW() - INTERVAL '90 days'
    ),
    top10_hours AS (
      SELECT person_id, timestamp
      FROM hourly_ranks
      WHERE rnk <= 10
    ),
    first_entries AS (
      SELECT
        person_id,
        MIN(timestamp) AS first_top10_at
      FROM top10_hours
      GROUP BY person_id
    ),
    first_time_candidates AS (
      SELECT
        fe.person_id AS id,
        fe.first_top10_at,
        tp.name,
        tp.avatar,
        tp.category,
        tp.rank
      FROM first_entries fe
      INNER JOIN trending_people tp ON tp.id = fe.person_id
      WHERE fe.first_top10_at >= NOW() - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1
          FROM top10_hours th
          WHERE th.person_id = fe.person_id
            AND th.timestamp < fe.first_top10_at - INTERVAL '1 hour'
        )
      ORDER BY fe.first_top10_at DESC
      LIMIT 10
    ),
    top10_flag AS (
      SELECT
        person_id,
        timestamp,
        CASE WHEN rnk <= 10 THEN 1 ELSE 0 END AS in_top10,
        LAG(CASE WHEN rnk <= 10 THEN 1 ELSE 0 END) OVER (
          PARTITION BY person_id ORDER BY timestamp
        ) AS prev_in_top10
      FROM hourly_ranks
    ),
    streak_groups AS (
      SELECT
        person_id,
        timestamp,
        in_top10,
        SUM(CASE WHEN in_top10 = 1 AND COALESCE(prev_in_top10, 0) = 0 THEN 1 ELSE 0 END)
          OVER (PARTITION BY person_id ORDER BY timestamp) AS streak_id
      FROM top10_flag
      WHERE in_top10 = 1
    ),
    streak_lengths AS (
      SELECT
        person_id,
        streak_id,
        COUNT(*)::int AS streak_hours,
        MIN(timestamp) AS streak_start,
        MAX(timestamp) AS streak_end
      FROM streak_groups
      GROUP BY person_id, streak_id
    ),
    best_streaks AS (
      SELECT DISTINCT ON (person_id)
        person_id,
        streak_hours,
        streak_start,
        streak_end
      FROM streak_lengths
      ORDER BY person_id, streak_hours DESC
    ),
    longest_candidates AS (
      SELECT
        bs.person_id AS id,
        bs.streak_hours,
        bs.streak_start,
        tp.name,
        tp.avatar,
        tp.category,
        tp.rank
      FROM best_streaks bs
      INNER JOIN trending_people tp ON tp.id = bs.person_id
      WHERE bs.streak_hours >= 24
      ORDER BY bs.streak_hours DESC
      LIMIT 10
    )
    SELECT
      (SELECT COALESCE(json_agg(row_to_json(f) ORDER BY f.first_top10_at DESC), '[]'::json)
       FROM first_time_candidates f) AS first_time_json,
      (SELECT COALESCE(json_agg(row_to_json(l) ORDER BY l.streak_hours DESC), '[]'::json)
       FROM longest_candidates l) AS longest_json
  `);

  const parseJsonArray = (value: unknown): StreakRow[] => {
    if (Array.isArray(value)) return value as StreakRow[];
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as StreakRow[];
      } catch {
        return [];
      }
    }
    return [];
  };

  const [row] = extractRows(result);
  const firstTimeRows = parseJsonArray(row?.first_time_json);
  const longestRows = parseJsonArray(row?.longest_json);

  return {
    firstTimeTop10: firstTimeRows.map(mapFirstTimeRow),
    longestStreaks: longestRows.map(mapLongestRow),
    retentionDays: STREAK_RETENTION_DAYS,
  };
}
