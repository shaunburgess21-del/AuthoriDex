/**
 * CLI: 24h wiki_pageviews range per person (detect sawtooth candidates).
 *
 * Usage: npx tsx server/diagnostics/audit-wiki-volatility.ts [limit]
 */
import "../db";
import { db } from "../db";
import { sql } from "drizzle-orm";

const limit = Math.min(50, Math.max(1, Number(process.argv[2]) || 30));

const rows = await db.execute(sql`
  WITH recent AS (
    SELECT person_id, wiki_pageviews AS w
    FROM trend_snapshots
    WHERE timestamp > NOW() - INTERVAL '24 hours'
      AND snapshot_origin = 'ingest'
      AND wiki_pageviews IS NOT NULL
  )
  SELECT tp.name,
         COUNT(*)::int AS n,
         MIN(r.w)::int AS lo,
         MAX(r.w)::int AS hi,
         ROUND(((MAX(r.w)::numeric - MIN(r.w)) / NULLIF(MIN(r.w), 0) * 100), 1) AS range_pct
  FROM recent r
  JOIN trending_people tp ON tp.id = r.person_id
  GROUP BY tp.name
  HAVING COUNT(*) > 10
  ORDER BY range_pct DESC NULLS LAST
  LIMIT ${limit}
`);

console.log(`Top ${limit} wiki_pageviews 24h ranges (ingest snapshots):\n`);
for (const row of rows.rows ?? []) {
  console.log(
    `${row.name}: ${row.lo} → ${row.hi} (${row.range_pct}% over ${row.n} ticks)`,
  );
}

process.exit(0);
