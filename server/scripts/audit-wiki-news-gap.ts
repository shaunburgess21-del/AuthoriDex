// One-off follow-up diagnostic for audit-wiki-momentum-thresholds.
//
// Several top-ratio person-days came back with `newsCountSameDay: null`. We
// already confirmed those rows are entirely missing from `trend_snapshots`.
// Now we want to know whether the gap is per-person (some people's ingest
// silently skipped) or system-wide (the ingest job didn't run that day at
// all).
//
// Read-only. Usage: npm run -s audit:wiki-news-gap

import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  // Per-day snapshot counts for the full sample window.
  const perDay = await db.execute(sql`
    SELECT
      to_char(date_trunc('day', timestamp AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
      COUNT(*)                                              AS snapshots_total,
      COUNT(DISTINCT person_id)                             AS distinct_people,
      COUNT(DISTINCT run_id)                                AS distinct_runs,
      COUNT(*) FILTER (WHERE snapshot_origin = 'ingest')    AS ingest_snapshots,
      COUNT(*) FILTER (WHERE news_count > 0)                AS rows_with_news,
      MIN(timestamp)                                        AS first_ts,
      MAX(timestamp)                                        AS last_ts
    FROM trend_snapshots
    WHERE timestamp >= (CURRENT_DATE - interval '37 days')
      AND timestamp <  CURRENT_DATE
    GROUP BY day
    ORDER BY day
  `);

  // Did the four flagged people exist as tracked rows during the gap window?
  const people = await db.execute(sql`
    SELECT name, id, status,
           (SELECT MIN(timestamp) FROM trend_snapshots ts WHERE ts.person_id = tp.id) AS first_snapshot,
           (SELECT MAX(timestamp) FROM trend_snapshots ts WHERE ts.person_id = tp.id) AS last_snapshot,
           (SELECT COUNT(*)        FROM trend_snapshots ts WHERE ts.person_id = tp.id) AS total_snapshots
    FROM tracked_people tp
    WHERE name IN ('John Ternus','Péter Magyar','Justin Bieber','Donald Trump','Tim Cook')
    ORDER BY name
  `);

  console.log(JSON.stringify({
    perDayCoverage: perDay.rows,
    flaggedPeople: people.rows,
  }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[audit-wiki-news-gap] fatal:", err);
  process.exit(1);
});
