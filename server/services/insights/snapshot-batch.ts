import { db } from "../../db";
import { trendSnapshots } from "@shared/schema";
import { sql } from "drizzle-orm";
import { INSIGHTS_REQUEST_MEMO_TTL_MS, memoizeAsync } from "./request-memo";

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

const SNAPSHOTS_MEMO_KEY = "insights:latest-snapshots-by-person";

async function loadLatestSnapshotsByPersonUncached(): Promise<Map<string, LatestSnapshotRow>> {
  // Two-step: resolve the latest snapshot id per person over NARROW columns
  // first, then fetch the wide `diagnostics` JSONB for only those ~hundreds of
  // rows. Selecting diagnostics in the DISTINCT ON forced Postgres to sort the
  // entire 320k-row history with the JSONB payload, spilling ~220MB to disk
  // (~27s). This keeps the sort narrow and joins the heavy column by PK (~4s).
  const result = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (person_id) id
      FROM trend_snapshots
      WHERE snapshot_origin = 'ingest'
        AND timestamp = date_trunc('hour', timestamp)
      ORDER BY person_id, timestamp DESC, id DESC
    )
    SELECT
      ts.person_id AS "personId",
      ts.timestamp,
      ts.news_count AS "newsCount",
      ts.wiki_pageviews AS "wikiPageviews",
      ts.velocity_score AS "velocityScore",
      ts.mass_score AS "massScore",
      ts.fame_index AS "fameIndex",
      ts.diagnostics,
      ts.drivers
    FROM trend_snapshots ts
    JOIN latest l ON l.id = ts.id
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

/** Latest on-the-hour ingest snapshot per person (bulk). Memoized in-process. */
export async function loadLatestSnapshotsByPerson(): Promise<Map<string, LatestSnapshotRow>> {
  return memoizeAsync(SNAPSHOTS_MEMO_KEY, INSIGHTS_REQUEST_MEMO_TTL_MS, loadLatestSnapshotsByPersonUncached);
}
