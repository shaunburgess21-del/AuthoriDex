import { db } from "../../db";
import { sql } from "drizzle-orm";

export interface MostDiscussedRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  insightCount: number;
}

export async function loadMostDiscussed(): Promise<{ rows: MostDiscussedRow[] }> {
  const result = await db.execute(sql`
    SELECT
      ci.person_id AS id,
      COUNT(*)::int AS insight_count,
      tp.name,
      tp.avatar,
      tp.category,
      tp.rank
    FROM community_insights ci
    INNER JOIN trending_people tp ON tp.id = ci.person_id
    WHERE ci.deleted_at IS NULL
      AND ci.created_at > NOW() - INTERVAL '7 days'
    GROUP BY ci.person_id, tp.name, tp.avatar, tp.category, tp.rank
    ORDER BY insight_count DESC
    LIMIT 10
  `);

  const raw =
    (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];

  const rows: MostDiscussedRow[] = raw.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    avatar: (row.avatar as string) ?? null,
    category: (row.category as string) ?? null,
    rank: Number(row.rank ?? 0),
    insightCount: Number(row.insight_count ?? 0),
  }));

  return { rows };
}
