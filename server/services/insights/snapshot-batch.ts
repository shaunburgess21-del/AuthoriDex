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

function coerceSnapshotTimestamp(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(String(value ?? ""));
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

async function loadLatestSnapshotsByPersonUncached(): Promise<Map<string, LatestSnapshotRow>> {
  // Lateral-join pattern driven by the small tracked_people table (~161 rows).
  // For each person we do an index-only lookup into trend_snapshots using
  // trend_snapshots_person_ts_idx (person_id, timestamp DESC) and grab the
  // single latest ingest snapshot. Total ~5ms on prod versus ~7s for the
  // previous DISTINCT-ON-over-the-whole-table approach.
  //
  // History:
  //   - Original code selected diagnostics inside DISTINCT ON over 322k rows
  //     and spilled ~220 MB to disk (~27 s cold).
  //   - First fix (commit 13c22dd5) split into a narrow DISTINCT ON then a
  //     JSONB join. Improved to ~7 s but still seq-scanned because the
  //     declared per-person indexes were missing in prod (migration 0009
  //     was silently baselined). Migration 0076 repaired those indexes.
  //   - With the indexes in place, the lateral pattern is dramatically
  //     simpler than the CTE and lets Postgres do ~161 index lookups
  //     instead of one giant scan + sort.
  const result = await db.execute(sql`
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
    FROM tracked_people tp
    CROSS JOIN LATERAL (
      SELECT *
      FROM trend_snapshots
      WHERE person_id = tp.id
        AND snapshot_origin = 'ingest'
      ORDER BY timestamp DESC, id DESC
      LIMIT 1
    ) ts
  `);

  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as LatestSnapshotRow[];
  const map = new Map<string, LatestSnapshotRow>();
  for (const row of rows) {
    const diag = row.diagnostics;
    map.set(row.personId, {
      ...row,
      timestamp: coerceSnapshotTimestamp(row.timestamp),
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
