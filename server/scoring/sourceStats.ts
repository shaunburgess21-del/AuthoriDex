import { db } from "../db";
import { apiCache } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { SourceStats, AllSourceStats, DEFAULT_SOURCE_STATS } from "./normalize";

const STATS_CACHE_KEY = "system:source_stats_reference";
const ROLLING_WINDOW_DAYS = 14;
const MIN_SNAPSHOT_COUNT = 100;

export async function fetchRollingSourceStats(): Promise<AllSourceStats> {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - ROLLING_WINDOW_DAYS);
  
  try {
    const result = await db.execute(sql`
      WITH recent_snapshots AS (
        SELECT 
          wiki_pageviews,
          news_count,
          search_volume
        FROM trend_snapshots
        WHERE timestamp >= ${windowStart}
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
      console.log(`[SourceStats] No data in ${ROLLING_WINDOW_DAYS}-day window, trying persisted reference`);
      return await loadPersistedStats();
    }
    
    const row = result.rows[0] as Record<string, number>;
    const count = Number(row.total_count);
    
    if (count < MIN_SNAPSHOT_COUNT) {
      console.log(`[SourceStats] Only ${count} snapshots in ${ROLLING_WINDOW_DAYS}-day window, trying persisted reference`);
      return await loadPersistedStats();
    }
    
    const n = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
    
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
      news: {
        min: n(Number(row.news_min), DEFAULT_SOURCE_STATS.news.min),
        max: n(Number(row.news_max), DEFAULT_SOURCE_STATS.news.max),
        p25: n(Number(row.news_p25), DEFAULT_SOURCE_STATS.news.p25),
        p50: n(Number(row.news_p50), DEFAULT_SOURCE_STATS.news.p50),
        p75: n(Number(row.news_p75), DEFAULT_SOURCE_STATS.news.p75),
        p90: n(Number(row.news_p90), DEFAULT_SOURCE_STATS.news.p90),
        mean: n(Number(row.news_mean), DEFAULT_SOURCE_STATS.news.mean),
        count,
      },
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
    
    console.log(`[SourceStats] Computed from ${count} snapshots (${ROLLING_WINDOW_DAYS}-day window): ` +
      `wiki p50=${stats.wiki.p50.toFixed(0)}, news p50=${stats.news.p50.toFixed(1)}, search p50=${stats.search.p50.toFixed(0)}`);
    
    await persistStats(stats);
    
    return stats;
  } catch (error) {
    console.error("[SourceStats] Error fetching stats:", error);
    return await loadPersistedStats();
  }
}

async function persistStats(stats: AllSourceStats): Promise<void> {
  try {
    const payload = {
      ...stats,
      computedAt: new Date().toISOString(),
      windowDays: ROLLING_WINDOW_DAYS,
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
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function getSourceStats(): Promise<AllSourceStats> {
  const now = Date.now();
  if (cachedStats && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedStats;
  }
  
  cachedStats = await fetchRollingSourceStats();
  cacheTimestamp = now;
  return cachedStats;
}

export async function refreshSourceStats(): Promise<AllSourceStats> {
  cachedStats = await fetchRollingSourceStats();
  cacheTimestamp = Date.now();
  return cachedStats;
}
