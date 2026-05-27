import type { InsightsDivergenceType, InsightsDiscoverRow } from "@shared/insights/types";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { loadSingleSourceSurge } from "./drivers";

export async function loadDivergence(
  type: InsightsDivergenceType,
  limit = 25,
): Promise<{ rows: InsightsDiscoverRow[]; total: number }> {
  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT
        cm.celebrity_id AS id,
        cm.approval_pct,
        cm.underrated_pct,
        cm.overrated_pct,
        cm.fairly_rated_pct,
        cm.approval_votes_count,
        tp.rank,
        tp.fame_index,
        tp.change_7d,
        tp.name,
        tp.avatar,
        tp.category,
        COALESCE(ts.velocity_score, 0) AS velocity_score,
        PERCENT_RANK() OVER (ORDER BY cm.approval_avg_rating NULLS LAST) AS approval_percentile
      FROM celebrity_metrics cm
      INNER JOIN trending_people tp ON tp.id = cm.celebrity_id
      LEFT JOIN LATERAL (
        SELECT velocity_score
        FROM trend_snapshots
        WHERE person_id = cm.celebrity_id
          AND snapshot_origin = 'ingest'
          AND timestamp = date_trunc('hour', timestamp)
        ORDER BY timestamp DESC
        LIMIT 1
      ) ts ON true
      WHERE cm.approval_votes_count >= 20
    )
    SELECT * FROM ranked
  `);

  const rawRows = (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];

  const filtered = rawRows.filter((row) => {
    const velocity = Number(row.velocity_score ?? 0);
    const change7d = Number(row.change_7d ?? 0);
    const approvalPct = Number(row.approval_pct ?? 0);
    const percentile = Number(row.approval_percentile ?? 0.5);
    const underrated = Number(row.underrated_pct ?? 0);
    const overrated = Number(row.overrated_pct ?? 0);
    const fairly = Number(row.fairly_rated_pct ?? 0);

    switch (type) {
      case "rising_disliked":
        return change7d > 3 && percentile < 0.35;
      case "underrated_gaining":
        return underrated >= 40 && change7d > 2;
      case "overrated_cooling":
        return overrated >= 40 && change7d < -2;
      case "consensus":
        return approvalPct >= 60 && fairly >= 40;
      default:
        return false;
    }
  });

  const rows: InsightsDiscoverRow[] = filtered.slice(0, limit).map((row) => {
    const change7d = Number(row.change_7d ?? 0);
    let highlight = "";
    switch (type) {
      case "rising_disliked":
        highlight = `Rising (${change7d.toFixed(1)}% 7d) but crowd approval is low`;
        break;
      case "underrated_gaining":
        highlight = `Underrated by ${Number(row.underrated_pct ?? 0).toFixed(0)}% of voters, gaining`;
        break;
      case "overrated_cooling":
        highlight = `Overrated by ${Number(row.overrated_pct ?? 0).toFixed(0)}% of voters, cooling`;
        break;
      case "consensus":
        highlight = `High approval with fair-rating consensus`;
        break;
    }

    return {
      id: String(row.id),
      name: String(row.name ?? ""),
      avatar: (row.avatar as string) ?? null,
      category: (row.category as string) ?? null,
      rank: Number(row.rank ?? 0),
      fameIndex: Number(row.fame_index ?? 0),
      approvalPct: row.approval_pct != null ? Number(row.approval_pct) : null,
      approvalPercentile:
        row.approval_percentile != null ? Math.round(Number(row.approval_percentile) * 100) : null,
      change7d: row.change_7d != null ? Number(row.change_7d) : null,
      velocityScore: Number(row.velocity_score ?? 0),
      underratedPct: row.underrated_pct != null ? Number(row.underrated_pct) : null,
      overratedPct: row.overrated_pct != null ? Number(row.overrated_pct) : null,
      fairlyRatedPct: row.fairly_rated_pct != null ? Number(row.fairly_rated_pct) : null,
      highlight,
    };
  });

  return { rows, total: filtered.length };
}

export { loadSingleSourceSurge };
