import { db } from "../db";
import { trendSnapshots } from "@shared/schema";
import { sql, desc, gte } from "drizzle-orm";
import { SourceStats, AllSourceStats, DEFAULT_SOURCE_STATS } from "./normalize";

/**
 * Fetch 7-day source statistics from trend_snapshots table.
 * Used for percentile-based normalization of raw source values.
 * 
 * Computes min, max, percentiles (p25, p50, p75, p90), mean, and count
 * for each source (wiki, news, search) across all snapshots in the last 7 days.
 */
export async function fetch7DaySourceStats(): Promise<AllSourceStats> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  try {
    const result = await db.execute(sql`
      WITH recent_snapshots AS (
        SELECT 
          wiki_pageviews,
          news_count,
          search_volume
        FROM trend_snapshots
        WHERE timestamp >= ${sevenDaysAgo}
          AND EXTRACT(MINUTE FROM timestamp) <= 3
          AND wiki_pageviews IS NOT NULL
          AND news_count IS NOT NULL
          AND search_volume IS NOT NULL
      )
      SELECT
        -- Wiki stats
        MIN(wiki_pageviews) as wiki_min,
        MAX(wiki_pageviews) as wiki_max,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p75,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p90,
        AVG(wiki_pageviews) as wiki_mean,
        
        -- News stats
        MIN(news_count) as news_min,
        MAX(news_count) as news_max,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY news_count) as news_p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY news_count) as news_p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY news_count) as news_p75,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY news_count) as news_p90,
        AVG(news_count) as news_mean,
        
        -- Search stats
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
      console.log("[SourceStats] No recent data, using defaults");
      return DEFAULT_SOURCE_STATS;
    }
    
    const row = result.rows[0] as Record<string, number>;
    const count = Number(row.total_count);
    
    if (count < 100) {
      console.log(`[SourceStats] Only ${count} snapshots, using defaults`);
      return DEFAULT_SOURCE_STATS;
    }
    
    const stats: AllSourceStats = {
      wiki: {
        min: Number(row.wiki_min) || DEFAULT_SOURCE_STATS.wiki.min,
        max: Number(row.wiki_max) || DEFAULT_SOURCE_STATS.wiki.max,
        p25: Number(row.wiki_p25) || DEFAULT_SOURCE_STATS.wiki.p25,
        p50: Number(row.wiki_p50) || DEFAULT_SOURCE_STATS.wiki.p50,
        p75: Number(row.wiki_p75) || DEFAULT_SOURCE_STATS.wiki.p75,
        p90: Number(row.wiki_p90) || DEFAULT_SOURCE_STATS.wiki.p90,
        mean: Number(row.wiki_mean) || DEFAULT_SOURCE_STATS.wiki.mean,
        count,
      },
      news: {
        min: Number(row.news_min) || DEFAULT_SOURCE_STATS.news.min,
        max: Number(row.news_max) || DEFAULT_SOURCE_STATS.news.max,
        p25: Number(row.news_p25) || DEFAULT_SOURCE_STATS.news.p25,
        p50: Number(row.news_p50) || DEFAULT_SOURCE_STATS.news.p50,
        p75: Number(row.news_p75) || DEFAULT_SOURCE_STATS.news.p75,
        p90: Number(row.news_p90) || DEFAULT_SOURCE_STATS.news.p90,
        mean: Number(row.news_mean) || DEFAULT_SOURCE_STATS.news.mean,
        count,
      },
      search: {
        min: Number(row.search_min) || DEFAULT_SOURCE_STATS.search.min,
        max: Number(row.search_max) || DEFAULT_SOURCE_STATS.search.max,
        p25: Number(row.search_p25) || DEFAULT_SOURCE_STATS.search.p25,
        p50: Number(row.search_p50) || DEFAULT_SOURCE_STATS.search.p50,
        p75: Number(row.search_p75) || DEFAULT_SOURCE_STATS.search.p75,
        p90: Number(row.search_p90) || DEFAULT_SOURCE_STATS.search.p90,
        mean: Number(row.search_mean) || DEFAULT_SOURCE_STATS.search.mean,
        count,
      },
    };
    
    console.log(`[SourceStats] Computed from ${count} snapshots: ` +
      `wiki p50=${stats.wiki.p50.toFixed(0)}, news p50=${stats.news.p50.toFixed(1)}, search p50=${stats.search.p50.toFixed(0)}`);
    
    return stats;
  } catch (error) {
    console.error("[SourceStats] Error fetching stats:", error);
    return DEFAULT_SOURCE_STATS;
  }
}

/**
 * Cached source stats to avoid repeated DB queries.
 * Refreshed every hour during ingestion.
 */
let cachedStats: AllSourceStats | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getSourceStats(): Promise<AllSourceStats> {
  const now = Date.now();
  if (cachedStats && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedStats;
  }
  
  cachedStats = await fetch7DaySourceStats();
  cacheTimestamp = now;
  return cachedStats;
}

/**
 * Force refresh of cached stats (called at start of ingestion).
 */
export async function refreshSourceStats(): Promise<AllSourceStats> {
  cachedStats = await fetch7DaySourceStats();
  cacheTimestamp = Date.now();
  return cachedStats;
}
