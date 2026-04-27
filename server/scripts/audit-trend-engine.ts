// Diagnostic script for Phase 1 of the trend-engine audit.
//
// Pulls live percentile shape, top-50 sub-score breakdowns, 24h fame
// oscillation magnitudes, and diagnostics blobs for the top 20. Output is
// written as JSON to stdout AND to ./audit-trend-engine-output.json so a
// follow-up canvas can render it without re-running the script.
//
// Read-only against the DB. Safe to run any time.
//
// Usage: npm run -s audit:trend-engine

import { db } from "../db";
import { sql, desc, eq } from "drizzle-orm";
import { trendingPeople, trendSnapshots, trackedPeople } from "@shared/schema";
import { fetchRollingSourceStats } from "../scoring/sourceStats";
import { computeTrendScore } from "../scoring/trendScore";
import {
  AllSourceStats,
  PLATFORM_WEIGHTS,
  MASS_ALLOCATION,
  VELOCITY_ALLOCATION,
  getNewsAggregationMode,
  getNewsAggregationFlippedAt,
  getRollingWindowDaysBaseline,
  getRollingWindowDaysNews,
} from "../scoring/normalize";
import * as fs from "fs";
import * as path from "path";

const TOP_N = 50;
const DIAGNOSTICS_TOP_N = 20;

function p99Estimate(p75: number, p90: number): number {
  return p90 + 2 * (p90 - p75);
}

async function main() {
  const startedAt = new Date();
  const out: any = { generatedAt: startedAt.toISOString() };

  // ---- 1. Engine config snapshot --------------------------------------------
  out.engineConfig = {
    newsAggregationMode: getNewsAggregationMode(),
    newsAggregationFlippedAt: getNewsAggregationFlippedAt()?.toISOString() ?? null,
    rollingWindowDaysBaseline: getRollingWindowDaysBaseline(),
    rollingWindowDaysNews: getRollingWindowDaysNews(),
    platformWeights: PLATFORM_WEIGHTS,
    massAllocation: MASS_ALLOCATION,
    velocityAllocation: VELOCITY_ALLOCATION,
  };

  // ---- 2. Full percentile shape (with p99Est & effectiveMax) ----------------
  const stats: AllSourceStats = await fetchRollingSourceStats();
  const enrich = (s: typeof stats.wiki) => ({
    ...s,
    p99Estimate: p99Estimate(s.p75, s.p90),
    effectiveMax: Math.min(s.max, p99Estimate(s.p75, s.p90)),
    p25_to_p75_range: s.p75 - s.p25,
    p75_to_p90_range: s.p90 - s.p75,
    upperTailHeadroom: p99Estimate(s.p75, s.p90) - s.p75,
  });
  out.percentiles = {
    wiki: enrich(stats.wiki),
    news: enrich(stats.news),
    search: enrich(stats.search),
  };

  // ---- 3. Top-N leaderboard with full sub-score breakdown -------------------
  const topPeople = await db
    .select()
    .from(trendingPeople)
    .orderBy(desc(trendingPeople.fameIndex))
    .limit(TOP_N);

  // Latest on-hour ingest snapshot per person (for raw signal + diagnostics)
  type SnapshotRow = typeof trendSnapshots.$inferSelect;
  const latestSnapshots = new Map<string, SnapshotRow>();
  for (const p of topPeople) {
    const rows = await db
      .select()
      .from(trendSnapshots)
      .where(eq(trendSnapshots.personId, p.id))
      .orderBy(desc(trendSnapshots.timestamp))
      .limit(1);
    if (rows[0]) latestSnapshots.set(p.id, rows[0]);
  }

  // Tracked-person record so we know activePlatforms
  const trackedById = new Map<string, typeof trackedPeople.$inferSelect>();
  for (const p of topPeople) {
    const rows = await db
      .select()
      .from(trackedPeople)
      .where(eq(trackedPeople.id, p.id))
      .limit(1);
    if (rows[0]) trackedById.set(p.id, rows[0]);
  }

  // 7d wiki avg per person — we need this for the mass score reproduction
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const wiki7dResult = await db.execute(sql`
    SELECT person_id, AVG(wiki_pageviews)::float AS avg7d
    FROM trend_snapshots
    WHERE timestamp >= ${sevenDaysAgo}
      AND snapshot_origin = 'ingest'
      AND wiki_pageviews IS NOT NULL
    GROUP BY person_id
  `);
  const wiki7dByPerson = new Map<string, number>();
  for (const row of wiki7dResult.rows as Array<{ person_id: string; avg7d: number }>) {
    wiki7dByPerson.set(row.person_id, Number(row.avg7d) || 0);
  }

  // 7d news daily-avg per person — denominator for the news-momentum
  // velocity slot (Apr 2026 — PR2 Fix X, refined PR4). Derived as
  // `AVG(news_count)` over the last 7 days of ingest snapshots. Since
  // PR4, ingest.ts uses this same aggregate as the canonical source for
  // `diagnostics.raw.news7d`, so the audit and the live engine are
  // computing the same number. (Pre-PR4, ingest used the provider's
  // built-in 7d query, which was structurally broken — Mediastack=0,
  // Serper/GDELT capped at ~35.71/day.)
  const news7dResult = await db.execute(sql`
    SELECT person_id, AVG(news_count)::float AS avg7d
    FROM trend_snapshots
    WHERE timestamp >= ${sevenDaysAgo}
      AND snapshot_origin = 'ingest'
      AND news_count IS NOT NULL
    GROUP BY person_id
  `);
  const news7dByPerson = new Map<string, number>();
  for (const row of news7dResult.rows as Array<{ person_id: string; avg7d: number }>) {
    news7dByPerson.set(row.person_id, Number(row.avg7d) || 0);
  }

  // 24h fame oscillation per person (max - min from on-hour ingest snapshots in last 24h)
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const oscResult = await db.execute(sql`
    SELECT
      person_id,
      MAX(fame_index) AS fame_max,
      MIN(fame_index) AS fame_min,
      COUNT(*) AS sample_count
    FROM trend_snapshots
    WHERE timestamp >= ${oneDayAgo}
      AND snapshot_origin = 'ingest'
      AND fame_index IS NOT NULL
    GROUP BY person_id
  `);
  const oscByPerson = new Map<string, { max: number; min: number; samples: number }>();
  for (const row of oscResult.rows as Array<{ person_id: string; fame_max: number; fame_min: number; sample_count: number }>) {
    oscByPerson.set(row.person_id, {
      max: Number(row.fame_max) || 0,
      min: Number(row.fame_min) || 0,
      samples: Number(row.sample_count) || 0,
    });
  }

  out.topPeople = topPeople.map((p, idx) => {
    const snap = latestSnapshots.get(p.id);
    const tracked = trackedById.get(p.id);
    const wiki7dAvg = wiki7dByPerson.get(p.id) ?? 0;
    const osc = oscByPerson.get(p.id);

    // Reproduce the score so we can see the per-source velocity components.
    // News 7d daily-avg priority:
    //   1. Persisted `diagnostics.raw.news7d` (set by ingest.ts — post-PR4
    //      this is itself the SQL aggregate from snapshot history when
    //      ≥14 samples are available, falling back to the provider value
    //      for brand-new tracked people).
    //   2. SQL aggregate over the last 7 days of ingest snapshots
    //      (fallback for pre-PR4 snapshots and as a parity check).
    //   3. 0 (no signal — momentum slot becomes 0).
    const diag = snap?.diagnostics as Record<string, any> | null;
    const persistedNewsAvg7d = Number(diag?.raw?.news7d ?? 0);
    const aggregateNewsAvg7d = news7dByPerson.get(p.id) ?? 0;
    const newsAvg7d = persistedNewsAvg7d > 0 ? persistedNewsAvg7d : aggregateNewsAvg7d;
    let recomputed: ReturnType<typeof computeTrendScore> | null = null;
    if (snap && tracked) {
      recomputed = computeTrendScore(
        {
          wikiPageviews: Number(snap.wikiPageviews ?? 0),
          wikiPageviews7dAvg: wiki7dAvg,
          wikiDelta: Number(snap.wikiDelta ?? 0),
          newsDelta: Number(snap.newsDelta ?? 0),
          searchDelta: Number(snap.searchDelta ?? 0),
          newsCount: Number(snap.newsCount ?? 0),
          searchVolume: Number(snap.searchVolume ?? 0),
          newsAverageDaily7d: newsAvg7d,
          activePlatforms: {
            wiki: !!tracked.wikiSlug,
            instagram: !!tracked.instagramHandle,
            youtube: !!tracked.youtubeId,
          },
        },
        undefined,
        undefined,
        undefined,
        stats,
      );
    }

    return {
      rank: idx + 1,
      personId: p.id,
      name: p.name,
      category: tracked?.category ?? null,
      fameIndex: p.fameIndex ?? 0,
      change24h: p.change24h ?? null,
      change7d: p.change7d ?? null,
      raw: snap
        ? {
            wikiPageviews24h: Number(snap.wikiPageviews ?? 0),
            wikiPageviews7dAvg: wiki7dAvg,
            newsCount: Number(snap.newsCount ?? 0),
            newsAverageDaily7d: newsAvg7d,
            searchVolume: Number(snap.searchVolume ?? 0),
            timestamp: snap.timestamp ? new Date(snap.timestamp).toISOString() : null,
            snapshotOrigin: snap.snapshotOrigin ?? null,
          }
        : null,
      recomputed: recomputed
        ? {
            fameIndex: recomputed.fameIndex,
            massScore: recomputed.massScore,
            velocityScore: recomputed.velocityScore,
            wikiVelocity: recomputed.velocityComponents.wiki,
            newsVelocity: recomputed.velocityComponents.news,
            searchVelocity: recomputed.velocityComponents.search,
            momentumVelocity: recomputed.velocityComponents.momentum,
            massContrib: Math.round(recomputed.massScore * MASS_ALLOCATION * 10000),
            wikiVelContrib: Math.round(
              recomputed.velocityComponents.wiki * PLATFORM_WEIGHTS.velocity.wiki * VELOCITY_ALLOCATION * 100,
            ),
            newsVelContrib: Math.round(
              recomputed.velocityComponents.news * PLATFORM_WEIGHTS.velocity.news * VELOCITY_ALLOCATION * 100,
            ),
            searchVelContrib: Math.round(
              recomputed.velocityComponents.search * PLATFORM_WEIGHTS.velocity.search * VELOCITY_ALLOCATION * 100,
            ),
            momentumVelContrib: Math.round(
              recomputed.velocityComponents.momentum * PLATFORM_WEIGHTS.velocity.momentum * VELOCITY_ALLOCATION * 100,
            ),
          }
        : null,
      oscillation24h: osc
        ? {
            max: osc.max,
            min: osc.min,
            spread: osc.max - osc.min,
            spreadPct: osc.max > 0 ? Number((((osc.max - osc.min) / osc.max) * 100).toFixed(1)) : 0,
            samples: osc.samples,
          }
        : null,
      diagnosticsKeys: snap?.diagnostics ? Object.keys(snap.diagnostics as Record<string, unknown>) : [],
    };
  });

  // ---- 4. Diagnostics blobs (raw vs adjusted) for top 20 --------------------
  out.diagnosticsTop = topPeople.slice(0, DIAGNOSTICS_TOP_N).map((p) => {
    const snap = latestSnapshots.get(p.id);
    if (!snap?.diagnostics) {
      return { rank: out.topPeople.find((tp: any) => tp.personId === p.id)?.rank, name: p.name, diagnostics: null };
    }
    const d = snap.diagnostics as Record<string, any>;
    return {
      rank: out.topPeople.find((tp: any) => tp.personId === p.id)?.rank,
      name: p.name,
      raw: d.raw ?? null,
      fresh: d.fresh ?? null,
      ema: d.ema ?? null,
      hold: d.hold ?? null,
      floor: d.floor ?? null,
      news: d.news ?? null,
      search: d.search ?? null,
      breakout: d.breakout ?? null,
      sustained: d.sustained ?? null,
      flags: Object.keys(d).filter((k) => /flag|hold|floor|reason|why|skip/i.test(k)),
    };
  });

  // ---- 5. Dominant-driver categorization for top 50 -------------------------
  const categories = { mass: 0, news: 0, search: 0, wiki: 0, momentum: 0, mixed: 0 };
  for (const tp of out.topPeople as any[]) {
    if (!tp.recomputed) continue;
    const m = tp.recomputed.massContrib;
    const w = tp.recomputed.wikiVelContrib;
    const n = tp.recomputed.newsVelContrib;
    const s = tp.recomputed.searchVelContrib;
    const mo = tp.recomputed.momentumVelContrib ?? 0;
    const total = m + w + n + s + mo;
    if (total === 0) continue;
    const dom = Math.max(m, w, n, s, mo);
    const domPct = dom / total;
    if (domPct < 0.45) categories.mixed++;
    else if (dom === m) categories.mass++;
    else if (dom === w) categories.wiki++;
    else if (dom === n) categories.news++;
    else if (dom === s) categories.search++;
    else if (dom === mo) categories.momentum++;
  }
  out.dominantDriverCounts = categories;

  // ---- 6. Persist + print ---------------------------------------------------
  const outPath = path.resolve(process.cwd(), "audit-trend-engine-output.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n[audit-trend-engine] Wrote results to ${outPath}\n`);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("[audit-trend-engine] fatal:", err);
  process.exit(1);
});
