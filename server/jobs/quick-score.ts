import { db } from "../db";
import { trackedPeople, trendSnapshots, apiCache } from "@shared/schema";
import { gte, and, eq } from "drizzle-orm";
import { computeTrendScore } from "../scoring/trendScore";

/**
 * COMPUTE-ONLY QUICK SCORING
 * 
 * This job computes fame scores from cached API data for preview/debugging purposes.
 * It does NOT write to trending_people - that is ONLY done by ingest.ts.
 * 
 * This design prevents lock conflicts between jobs and ensures a single
 * authoritative writer to the leaderboard table.
 * 
 * Returns: Array of computed scores for preview, plus stats
 */
export interface QuickScoreResult {
  personId: string;
  name: string;
  rank: number;
  fameIndex: number;
  trendScore: number;
  change24h: number | null;
  change7d: number | null;
  category: string | null;
}

export interface QuickScoreOutput {
  processed: number;
  errors: number;
  results: QuickScoreResult[];
  healthSummary: {
    job: string;
    hour: string;
    duration: string;
    rows: number;
    sources: { wiki: string; news: string; search: string };
    cacheHits: { wiki: number; news: number; search: number };
    avgFameIndex: number;
  };
}

export async function runQuickScoring(): Promise<QuickScoreOutput> {
  console.log("[QuickScore] Starting PREVIEW-ONLY scoring from cached data...");
  console.log("[QuickScore] NOTE: This job does NOT write to trending_people. Only ingest.ts writes.");
  const startTime = Date.now();
  
  let processed = 0;
  let errors = 0;

  try {
    const people = await db.select().from(trackedPeople);
    console.log(`[QuickScore] Found ${people.length} tracked people`);

    const cachedData = await db.select().from(apiCache);
    
    const wikiCache = new Map<string, any>();
    const gdeltCache = new Map<string, any>();
    const serperCache = new Map<string, any>();
    const xCache = new Map<string, any>();
    
    for (const cache of cachedData) {
      try {
        const data = JSON.parse(cache.responseData);
        if (cache.provider === "wiki") {
          const slug = cache.cacheKey.replace("wiki:pageviews:", "");
          wikiCache.set(slug, data);
        } else if (cache.provider === "gdelt") {
          const name = cache.cacheKey.replace("gdelt:news:", "").replace(/_/g, " ");
          gdeltCache.set(name.toLowerCase(), data);
        } else if (cache.provider === "serper") {
          const name = cache.cacheKey.replace("serper:search:", "").replace(/_/g, " ");
          serperCache.set(name.toLowerCase(), data);
        } else if (cache.provider === "x") {
          const handle = cache.cacheKey.replace("x:metrics:", "");
          xCache.set(handle.toLowerCase(), data);
        }
      } catch (e) {
      }
    }
    
    console.log(`[QuickScore] Loaded ${wikiCache.size} wiki, ${gdeltCache.size} gdelt, ${serperCache.size} serper, ${xCache.size} x entries`);

    // Fetch historical snapshots for change calculations
    const now = new Date();
    const time24hAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const time7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Build lookup maps for historical scores
    const historicalSnapshots = await db.select({
      personId: trendSnapshots.personId,
      timestamp: trendSnapshots.timestamp,
      trendScore: trendSnapshots.trendScore,
      fameIndex: trendSnapshots.fameIndex,
    }).from(trendSnapshots).where(
      and(
        gte(trendSnapshots.timestamp, time7dAgo),
        eq(trendSnapshots.snapshotOrigin, 'ingest')
      )
    );
    
    // Create maps for different lookups:
    // - mostRecentMap: Most recent snapshot for EMA continuity (CRITICAL for stabilization)
    // - snapshot24hMap: Snapshot from ~24h ago for change24h calculation
    // - snapshot7dMap: Snapshot from ~7d ago for change7d calculation
    const mostRecentMap = new Map<string, { trendScore: number; fameIndex: number | null; timestamp: Date }>();
    const snapshot24hMap = new Map<string, { trendScore: number; fameIndex: number | null }>();
    const snapshot7dMap = new Map<string, { trendScore: number; fameIndex: number | null }>();
    
    for (const snap of historicalSnapshots) {
      const snapTime = new Date(snap.timestamp).getTime();
      const diff24h = Math.abs(snapTime - time24hAgo.getTime());
      const diff7d = Math.abs(snapTime - time7dAgo.getTime());
      
      // Track most recent snapshot per person (for EMA smoothing continuity)
      const existingRecent = mostRecentMap.get(snap.personId);
      if (!existingRecent || new Date(snap.timestamp) > existingRecent.timestamp) {
        mostRecentMap.set(snap.personId, { 
          trendScore: snap.trendScore, 
          fameIndex: snap.fameIndex,
          timestamp: new Date(snap.timestamp)
        });
      }
      
      // Keep closest snapshot to 24h ago (within 2 hour window)
      if (diff24h < 2 * 60 * 60 * 1000) {
        const existing = snapshot24hMap.get(snap.personId);
        if (!existing) {
          snapshot24hMap.set(snap.personId, { trendScore: snap.trendScore, fameIndex: snap.fameIndex });
        }
      }
      
      // Keep closest snapshot to 7d ago (within 12 hour window)
      if (diff7d < 12 * 60 * 60 * 1000) {
        const existing = snapshot7dMap.get(snap.personId);
        if (!existing) {
          snapshot7dMap.set(snap.personId, { trendScore: snap.trendScore, fameIndex: snap.fameIndex });
        }
      }
    }
    
    console.log(`[QuickScore] Found ${mostRecentMap.size} recent snapshots (EMA), ${snapshot24hMap.size} 24h snapshots, ${snapshot7dMap.size} 7d snapshots`);

    const scoreResults: Array<{
      person: typeof people[0];
      score: ReturnType<typeof computeTrendScore>;
    }> = [];

    for (const person of people) {
      try {
        const wiki = person.wikiSlug ? wikiCache.get(person.wikiSlug) : null;
        const news = gdeltCache.get(person.name.toLowerCase());
        const serper = serperCache.get(person.name.toLowerCase());
        // NOTE (Jan 2026): X API disabled for trend scoring - kept for Platform Insights
        // const xMetrics = person.xHandle 
        //   ? xCache.get(person.xHandle.toLowerCase().replace("@", ""))
        //   : null;

        const inputs = {
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiPageviews7dAvg: wiki?.averageDaily7d || 0,
          wikiDelta: wiki?.delta || 0,
          newsDelta: news?.delta || 0,
          searchDelta: serper?.delta || 0,
          activePlatforms: {
            wiki: !!person.wikiSlug,
            instagram: !!person.instagramHandle,
            youtube: !!person.youtubeId,
          },
        };

        // Get previous scores for change calculations and EMA smoothing
        const mostRecent = mostRecentMap.get(person.id);
        const prev24h = snapshot24hMap.get(person.id);
        const prev7d = snapshot7dMap.get(person.id);
        
        // CRITICAL: Use MOST RECENT fameIndex for EMA smoothing (not 24h-ago)
        // This ensures rate limiting and EMA are always applied for smooth transitions
        const previousFameIndex = mostRecent?.fameIndex ?? undefined;
        
        const scoreResult = computeTrendScore(
          inputs,
          prev24h?.trendScore,  // previousScore for change24h calculation
          prev7d?.trendScore,   // previousScore7d for change7d calculation
          previousFameIndex     // Most recent fameIndex for EMA smoothing
        );

        // NOTE: Quick-score is PREVIEW-ONLY - it does NOT write to any tables.
        // Only ingest.ts writes to trending_people and trend_snapshots.
        // This job computes scores for debugging/preview purposes only.

        scoreResults.push({ person, score: scoreResult });
        processed++;
      } catch (error) {
        console.error(`[QuickScore] Error processing ${person.name}:`, error);
        errors++;
      }
    }

    // Sort by fameIndex (displayed on leaderboard) not trendScore
    scoreResults.sort((a, b) => b.score.fameIndex - a.score.fameIndex);

    // Build preview results (NO DATABASE WRITES)
    const previewResults: QuickScoreResult[] = scoreResults.map(({ person, score }, index) => ({
      personId: person.id,
      name: person.name,
      rank: index + 1,
      fameIndex: score.fameIndex,
      trendScore: score.trendScore,
      change24h: score.change24h,
      change7d: score.change7d,
      category: person.category,
    }));
    
    // ═══════════════════════════════════════════════════════════════════════════
    // HEALTH SUMMARY - Single consolidated log for monitoring (preview only)
    // ═══════════════════════════════════════════════════════════════════════════
    const jobDuration = Date.now() - startTime;
    const hourBucket = new Date().toISOString().slice(0, 13) + ":00:00Z";
    const avgFameIndex = scoreResults.length > 0 
      ? scoreResults.reduce((sum, r) => sum + (r.score.fameIndex ?? 0), 0) / scoreResults.length 
      : 0;
    const healthSummary = {
      job: "quick-score-preview",
      hour: hourBucket,
      duration: `${jobDuration}ms`,
      rows: processed,
      sources: {
        wiki: wikiCache.size > 0 ? "OK" : "EMPTY",
        news: gdeltCache.size > 0 ? "OK" : "EMPTY",
        search: serperCache.size > 0 ? "OK" : "EMPTY",
      },
      cacheHits: {
        wiki: wikiCache.size,
        news: gdeltCache.size,
        search: serperCache.size,
      },
      avgFameIndex: Math.round(avgFameIndex),
    };
    
    console.log(`[HEALTH SUMMARY] ${JSON.stringify(healthSummary)}`);
    console.log(`[QuickScore] Preview complete: ${processed} scores computed (NOT written to DB)`);
    // ═══════════════════════════════════════════════════════════════════════════

    return { processed, errors, results: previewResults, healthSummary };

  } catch (error) {
    console.error("[QuickScore] Fatal error:", error);
    errors++;
    
    const jobDuration = Date.now() - startTime;
    const hourBucket = new Date().toISOString().slice(0, 13) + ":00:00Z";
    return { 
      processed, 
      errors, 
      results: [],
      healthSummary: {
        job: "quick-score-preview",
        hour: hourBucket,
        duration: `${jobDuration}ms`,
        rows: 0,
        sources: { wiki: "ERROR", news: "ERROR", search: "ERROR" },
        cacheHits: { wiki: 0, news: 0, search: 0 },
        avgFameIndex: 0,
      }
    };
  }
}

if (process.argv[1]?.endsWith('quick-score.ts')) {
  runQuickScoring()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Quick scoring failed:", error);
      process.exit(1);
    });
}
