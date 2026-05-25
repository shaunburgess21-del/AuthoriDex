/**
 * CLI: compare raw vs 3-tick-smoothed news inputs for a person (last 48h).
 *
 * Usage: npx tsx server/diagnostics/audit-news-smoothing.ts <personId>
 */
import "../db";
import { db } from "../db";
import { trendSnapshots } from "@shared/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { smoothLastNTicks, NEWS_SMOOTHING_WINDOW } from "../scoring/smoothing";
import { normalizeSourceValue, DEFAULT_SOURCE_STATS } from "../scoring/normalize";

const personId = process.argv[2];
if (!personId) {
  console.error("Usage: npx tsx server/diagnostics/audit-news-smoothing.ts <personId>");
  process.exit(1);
}

const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
const rows = await db
  .select({
    timestamp: trendSnapshots.timestamp,
    newsCount: trendSnapshots.newsCount,
    velocityScore: trendSnapshots.velocityScore,
    fameIndex: trendSnapshots.fameIndex,
    diagnostics: trendSnapshots.diagnostics,
  })
  .from(trendSnapshots)
  .where(
    and(
      eq(trendSnapshots.personId, personId),
      eq(trendSnapshots.snapshotOrigin, "ingest"),
      gte(trendSnapshots.timestamp, since),
    ),
  )
  .orderBy(trendSnapshots.timestamp);

console.log(`Person ${personId} — last ${rows.length} ingest snapshots (48h)\n`);
console.log("ts\t\t\traw_news\tsmoothed_news\tvel_score\tfame_index\tnews7d_raw");

const series: number[] = [];
for (const row of rows) {
  const raw = row.newsCount ?? 0;
  series.push(raw);
  const smoothed = smoothLastNTicks(series, NEWS_SMOOTHING_WINDOW) ?? raw;
  const velFromSmoothed =
    normalizeSourceValue(smoothed, DEFAULT_SOURCE_STATS.news) * 100;
  const rawDiag = (row.diagnostics as Record<string, unknown> | null)?.raw as
    | Record<string, unknown>
    | undefined;
  const news7d = rawDiag?.news7d ?? "";
  const ts = new Date(row.timestamp).toISOString().slice(0, 16);
  console.log(
    `${ts}\t${String(raw).padStart(8)}\t${smoothed.toFixed(2).padStart(12)}\t` +
      `${String(row.velocityScore ?? "").padStart(8)}\t${String(row.fameIndex ?? "").padStart(10)}\t${news7d}`,
  );
  console.log(`  → vel if smoothed count only: ${velFromSmoothed.toFixed(2)}`);
}

process.exit(0);
