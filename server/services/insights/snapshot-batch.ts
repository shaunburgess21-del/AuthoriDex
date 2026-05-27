import { db } from "../../db";
import { trendSnapshots } from "@shared/schema";
import { sql } from "drizzle-orm";

export interface LatestSnapshotRow {
  personId: string;
  timestamp: Date;
  newsCount: number;
  wikiPageviews: number;
  velocityScore: number;
  massScore: number;
  fameIndex: number | null;
  diagnostics: Record<string, unknown> | null;
  drivers: string[] | null;
}

/** Latest on-the-hour ingest snapshot per person (bulk). */
export async function loadLatestSnapshotsByPerson(): Promise<Map<string, LatestSnapshotRow>> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (person_id)
      person_id AS "personId",
      timestamp,
      news_count AS "newsCount",
      wiki_pageviews AS "wikiPageviews",
      velocity_score AS "velocityScore",
      mass_score AS "massScore",
      fame_index AS "fameIndex",
      diagnostics,
      drivers
    FROM trend_snapshots
    WHERE snapshot_origin = 'ingest'
      AND timestamp = date_trunc('hour', timestamp)
    ORDER BY person_id, timestamp DESC, id DESC
  `);

  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as LatestSnapshotRow[];
  const map = new Map<string, LatestSnapshotRow>();
  for (const row of rows) {
    const diag = row.diagnostics;
    map.set(row.personId, {
      ...row,
      newsCount: Number(row.newsCount ?? 0),
      wikiPageviews: Number(row.wikiPageviews ?? 0),
      velocityScore: Number(row.velocityScore ?? 0),
      massScore: Number(row.massScore ?? 0),
      fameIndex: row.fameIndex != null ? Number(row.fameIndex) : null,
      diagnostics:
        typeof diag === "object" && diag !== null ? (diag as Record<string, unknown>) : null,
      drivers: Array.isArray(row.drivers) ? row.drivers : null,
    });
  }
  return map;
}
