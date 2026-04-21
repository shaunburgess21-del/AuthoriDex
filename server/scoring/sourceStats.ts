import { db } from "../db";
import { apiCache } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import {
  SourceStats,
  AllSourceStats,
  DEFAULT_SOURCE_STATS,
  getNewsAggregationFlippedAt,
  getRollingWindowDaysBaseline,
  getRollingWindowDaysNews,
} from "./normalize";

const STATS_CACHE_KEY = "system:source_stats_reference";
const MIN_SNAPSHOT_COUNT = 100;
// Minimum news snapshots required before we trust a narrower news window
// (either the rolling ROLLING_WINDOW_DAYS_NEWS or a NEWS_AGGREGATION_FLIPPED_AT
// cutoff). Below this threshold we fall back to the full baseline window to
// keep thresholds statistically stable on day 1 of a cadence/flip change.
const MIN_NEWS_OVERRIDE_COUNT = 500;

export async function fetchRollingSourceStats(): Promise<AllSourceStats> {
  const baselineDays = getRollingWindowDaysBaseline();
  const newsDays = getRollingWindowDaysNews();
  const baselineWindowStart = new Date();
  baselineWindowStart.setDate(baselineWindowStart.getDate() - baselineDays);
  const newsWindowStart = new Date();
  newsWindowStart.setDate(newsWindowStart.getDate() - newsDays);

  try {
    const result = await db.execute(sql`
      WITH recent_snapshots AS (
        SELECT 
          wiki_pageviews,
          news_count,
          search_volume
        FROM trend_snapshots
        WHERE timestamp >= ${baselineWindowStart}
          AND timestamp = date_trunc('hour', timestamp)
          AND snapshot_origin = 'ingest'
          AND wiki_pageviews IS NOT NULL
          AND news_count IS NOT NULL
          AND search_volume IS NOT NULL
      )
      SELECT
        MIN(wiki_pageviews) as wiki_min,
        MAX(wiki_pageviews) as wiki_max,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p75,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p90,
        AVG(wiki_pageviews) as wiki_mean,
        
        MIN(news_count) as news_min,
        MAX(news_count) as news_max,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY news_count) as news_p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY news_count) as news_p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY news_count) as news_p75,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY news_count) as news_p90,
        AVG(news_count) as news_mean,
        
        MIN(search_volume) as search_min,
        MAX(search_volume) as search_max,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY search_volume) as search_p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY search_volume) as search_p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY search_volume) as search_p75,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY search_volume) as search_p90,
        AVG(search_volume) as search_mean,
        
        COUNT(*) as total_count
      FROM recent_snapshots
    `);
    
    if (!result.rows || result.rows.length === 0 || !result.rows[0].total_count) {
      console.log(`[SourceStats] No data in ${baselineDays}-day baseline window, trying persisted reference`);
      return await loadPersistedStats();
    }
    
    const row = result.rows[0] as Record<string, number>;
    const count = Number(row.total_count);
    
    if (count < MIN_SNAPSHOT_COUNT) {
      console.log(`[SourceStats] Only ${count} snapshots in ${baselineDays}-day baseline window, trying persisted reference`);
      return await loadPersistedStats();
    }
    
    const n = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

    const newsStats: SourceStats = {
      min: n(Number(row.news_min), DEFAULT_SOURCE_STATS.news.min),
      max: n(Number(row.news_max), DEFAULT_SOURCE_STATS.news.max),
      p25: n(Number(row.news_p25), DEFAULT_SOURCE_STATS.news.p25),
      p50: n(Number(row.news_p50), DEFAULT_SOURCE_STATS.news.p50),
      p75: n(Number(row.news_p75), DEFAULT_SOURCE_STATS.news.p75),
      p90: n(Number(row.news_p90), DEFAULT_SOURCE_STATS.news.p90),
      mean: n(Number(row.news_mean), DEFAULT_SOURCE_STATS.news.mean),
      count,
    };
    type NewsWindowSource = "baseline" | "news-rolling" | "post-flip";
    let newsWindowSource: NewsWindowSource = "baseline";

    // Decide whether to override news percentiles with a narrower window:
    //  (a) NEWS_AGGREGATION_FLIPPED_AT is set and inside the baseline window
    //      (so the legacy/union mix in the baseline would otherwise skew p75), or
    //  (b) ROLLING_WINDOW_DAYS_NEWS is narrower than the baseline window
    //      (the common case — news cycles shorter than wiki/search baselines).
    // The effective start is the MOST RECENT of (flippedAt, newsWindowStart),
    // so a very recent flip overrides the news rolling window and vice versa.
    const flippedAt = getNewsAggregationFlippedAt();
    const candidateStarts: Date[] = [];
    if (flippedAt && flippedAt > baselineWindowStart && flippedAt < new Date()) {
      candidateStarts.push(flippedAt);
    }
    if (newsWindowStart > baselineWindowStart) {
      candidateStarts.push(newsWindowStart);
    }
    if (candidateStarts.length > 0) {
      const effectiveStart = new Date(Math.max(...candidateStarts.map((d) => d.getTime())));
      const overrideReason: NewsWindowSource =
        flippedAt && effectiveStart.getTime() === flippedAt.getTime() ? "post-flip" : "news-rolling";
      try {
        // Match the NULL-filters from the baseline query so the override
        // population is identical (snapshots where wiki/search failed but news
        // was written are excluded here too). Keeps news stats comparable with
        // wiki/search, which always use the baseline window.
        const overrideResult = await db.execute(sql`
          SELECT
            MIN(news_count) as news_min,
            MAX(news_count) as news_max,
            PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY news_count) as news_p25,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY news_count) as news_p50,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY news_count) as news_p75,
            PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY news_count) as news_p90,
            AVG(news_count) as news_mean,
            COUNT(*) as total_count
          FROM trend_snapshots
          WHERE timestamp >= ${effectiveStart}
            AND timestamp = date_trunc('hour', timestamp)
            AND snapshot_origin = 'ingest'
            AND wiki_pageviews IS NOT NULL
            AND news_count IS NOT NULL
            AND search_volume IS NOT NULL
        `);
        const ovRow = (overrideResult.rows?.[0] ?? {}) as Record<string, number>;
        const ovCount = Number(ovRow.total_count ?? 0);
        if (ovCount >= MIN_NEWS_OVERRIDE_COUNT) {
          newsStats.min = n(Number(ovRow.news_min), newsStats.min);
          newsStats.max = n(Number(ovRow.news_max), newsStats.max);
          newsStats.p25 = n(Number(ovRow.news_p25), newsStats.p25);
          newsStats.p50 = n(Number(ovRow.news_p50), newsStats.p50);
          newsStats.p75 = n(Number(ovRow.news_p75), newsStats.p75);
          newsStats.p90 = n(Number(ovRow.news_p90), newsStats.p90);
          newsStats.mean = n(Number(ovRow.news_mean), newsStats.mean);
          newsStats.count = ovCount;
          newsWindowSource = overrideReason;
          console.log(
            `[SourceStats] News using ${overrideReason.toUpperCase()} window (${ovCount} snapshots since ${effectiveStart.toISOString()}) — ` +
            `p25=${newsStats.p25.toFixed(1)}, p50=${newsStats.p50.toFixed(1)}, p75=${newsStats.p75.toFixed(1)}`
          );
        } else {
          console.log(
            `[SourceStats] News ${overrideReason.toUpperCase()} window has only ${ovCount} snapshots ` +
            `(<${MIN_NEWS_OVERRIDE_COUNT}), falling back to baseline ${baselineDays}-day window`
          );
        }
      } catch (ovErr) {
        console.warn(
          `[SourceStats] News ${overrideReason} query failed, falling back to baseline ${baselineDays}-day window:`,
          ovErr
        );
      }
    }

    const stats: AllSourceStats = {
      wiki: {
        min: n(Number(row.wiki_min), DEFAULT_SOURCE_STATS.wiki.min),
        max: n(Number(row.wiki_max), DEFAULT_SOURCE_STATS.wiki.max),
        p25: n(Number(row.wiki_p25), DEFAULT_SOURCE_STATS.wiki.p25),
        p50: n(Number(row.wiki_p50), DEFAULT_SOURCE_STATS.wiki.p50),
        p75: n(Number(row.wiki_p75), DEFAULT_SOURCE_STATS.wiki.p75),
        p90: n(Number(row.wiki_p90), DEFAULT_SOURCE_STATS.wiki.p90),
        mean: n(Number(row.wiki_mean), DEFAULT_SOURCE_STATS.wiki.mean),
        count,
      },
      news: newsStats,
      search: {
        min: n(Number(row.search_min), DEFAULT_SOURCE_STATS.search.min),
        max: n(Number(row.search_max), DEFAULT_SOURCE_STATS.search.max),
        p25: n(Number(row.search_p25), DEFAULT_SOURCE_STATS.search.p25),
        p50: n(Number(row.search_p50), DEFAULT_SOURCE_STATS.search.p50),
        p75: n(Number(row.search_p75), DEFAULT_SOURCE_STATS.search.p75),
        p90: n(Number(row.search_p90), DEFAULT_SOURCE_STATS.search.p90),
        mean: n(Number(row.search_mean), DEFAULT_SOURCE_STATS.search.mean),
        count,
      },
    };

    console.log(
      `[SourceStats] Computed from ${count} snapshots ` +
      `(baseline=${baselineDays}d, news=${newsDays}d/source=${newsWindowSource}): ` +
      `wiki p50=${stats.wiki.p50.toFixed(0)}, news p50=${stats.news.p50.toFixed(1)}, search p50=${stats.search.p50.toFixed(0)}`
    );

    await persistStats(stats, baselineDays, newsDays);

    return stats;
  } catch (error) {
    console.error("[SourceStats] Error fetching stats:", error);
    return await loadPersistedStats();
  }
}

async function persistStats(stats: AllSourceStats, baselineDays: number, newsDays: number): Promise<void> {
  try {
    const payload = {
      ...stats,
      computedAt: new Date().toISOString(),
      baselineWindowDays: baselineDays,
      newsWindowDays: newsDays,
    };
    
    const existing = await db.query.apiCache.findFirst({
      where: eq(apiCache.cacheKey, STATS_CACHE_KEY),
    });

    if (existing) {
      await db.update(apiCache)
        .set({
          responseData: JSON.stringify(payload),
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        })
        .where(eq(apiCache.cacheKey, STATS_CACHE_KEY));
    } else {
      await db.insert(apiCache).values({
        cacheKey: STATS_CACHE_KEY,
        provider: "system",
        responseData: JSON.stringify(payload),
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
    }
    console.log(`[SourceStats] Persisted reference distribution to DB`);
  } catch (err) {
    console.error("[SourceStats] Failed to persist stats:", err);
  }
}

async function loadPersistedStats(): Promise<AllSourceStats> {
  try {
    const cached = await db.query.apiCache.findFirst({
      where: eq(apiCache.cacheKey, STATS_CACHE_KEY),
    });

    if (cached) {
      const parsed = JSON.parse(cached.responseData) as AllSourceStats & { computedAt?: string };
      console.log(`[SourceStats] Loaded persisted reference distribution (computed: ${parsed.computedAt || 'unknown'})`);
      return {
        wiki: parsed.wiki,
        news: parsed.news,
        search: parsed.search,
      };
    }
  } catch (err) {
    console.error("[SourceStats] Failed to load persisted stats:", err);
  }

  console.log("[SourceStats] No persisted stats available, using hardcoded defaults (last resort)");
  return DEFAULT_SOURCE_STATS;
}

export { fetchRollingSourceStats as fetch7DaySourceStats };

let cachedStats: AllSourceStats | null = null;
let cacheTimestamp: number = 0;
// Cache key combines every env input that would change the computed stats so
// flipping any of them at runtime busts the cache on the next call instead of
// waiting up to an hour: NEWS_AGGREGATION_FLIPPED_AT, ROLLING_WINDOW_DAYS_*
let cachedConfigKey: string = "";
const CACHE_TTL_MS = 60 * 60 * 1000;

function computeConfigKey(): string {
  const flippedKey = getNewsAggregationFlippedAt()?.toISOString() ?? "";
  return `baseline=${getRollingWindowDaysBaseline()};news=${getRollingWindowDaysNews()};flipped=${flippedKey}`;
}

export async function getSourceStats(): Promise<AllSourceStats> {
  const now = Date.now();
  const configKey = computeConfigKey();
  if (
    cachedStats &&
    (now - cacheTimestamp) < CACHE_TTL_MS &&
    cachedConfigKey === configKey
  ) {
    return cachedStats;
  }

  cachedStats = await fetchRollingSourceStats();
  cacheTimestamp = now;
  cachedConfigKey = configKey;
  return cachedStats;
}

export async function refreshSourceStats(): Promise<AllSourceStats> {
  cachedStats = await fetchRollingSourceStats();
  cacheTimestamp = Date.now();
  cachedConfigKey = computeConfigKey();
  return cachedStats;
}
