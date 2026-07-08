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
  // After the community_insights → comments merge, "most discussed" counts
  // top-level profile posts (comments with parent_type='community_insight',
  // parent_comment_id=null) per person in the last 7 days.
  const result = await db.execute(sql`
    SELECT
      c.parent_id AS id,
      COUNT(*)::int AS insight_count,
      tp.name,
      tp.avatar,
      tp.category,
      tp.rank
    FROM comments c
    INNER JOIN trending_people tp ON tp.id = c.parent_id
    WHERE c.parent_type = 'community_insight'
      AND c.parent_comment_id IS NULL
      AND c.deleted_at IS NULL
      AND c.created_at > NOW() - INTERVAL '7 days'
    GROUP BY c.parent_id, tp.name, tp.avatar, tp.category, tp.rank
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
