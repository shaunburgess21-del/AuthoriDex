import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { trendingPeople, celebrityMetrics } from "@shared/schema";

/** Compact profile metrics mirrored on Voices profile link cards. */
export interface VoicesProfileStats {
  categoryRank: number | null;
  fameIndex: number | null;
  change24h: number | null;
  change7d: number | null;
  approvalAvgRating: number | null;
}

/**
 * Batch-load leaderboard stats for person profile previews on the Voices feed.
 * Returns entries only for people on the main leaderboard (`trending_people`).
 */
export async function loadPersonProfileStats(
  personIds: string[],
): Promise<Map<string, VoicesProfileStats>> {
  const out = new Map<string, VoicesProfileStats>();
  if (personIds.length === 0) return out;

  const rows = await db
    .select({
      id: trendingPeople.id,
      fameIndex: trendingPeople.fameIndex,
      change24h: trendingPeople.change24h,
      change7d: trendingPeople.change7d,
      approvalAvgRating: celebrityMetrics.approvalAvgRating,
    })
    .from(trendingPeople)
    .leftJoin(celebrityMetrics, eq(celebrityMetrics.celebrityId, trendingPeople.id))
    .where(inArray(trendingPeople.id, personIds));

  if (rows.length === 0) return out;

  const rankRows = await db.execute(sql`
    WITH ranked AS (
      SELECT ${trendingPeople.id} AS id,
        ROW_NUMBER() OVER (
          PARTITION BY ${trendingPeople.category}
          ORDER BY ${trendingPeople.fameIndex} DESC NULLS LAST, ${trendingPeople.name} ASC
        ) AS category_rank
      FROM ${trendingPeople}
    )
    SELECT id, category_rank FROM ranked
    WHERE id IN (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})
  `);

  const rankById = new Map<string, number>();
  const rankResultRows =
    (rankRows as { rows?: Record<string, unknown>[] }).rows ?? (rankRows as Record<string, unknown>[]);
  for (const row of rankResultRows) {
    const id = String(row.id);
    const raw = row.category_rank ?? row.categoryRank;
    const n = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) rankById.set(id, n);
  }

  for (const r of rows) {
    out.set(r.id, {
      categoryRank: rankById.get(r.id) ?? null,
      fameIndex: r.fameIndex ?? null,
      change24h: r.change24h ?? null,
      change7d: r.change7d ?? null,
      approvalAvgRating: r.approvalAvgRating ?? null,
    });
  }

  return out;
}
