import { db } from "../db";
import { trackedPeople, trendSnapshots, apiCache, trendingPeople } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { computeTrendScore } from "../scoring/trendScore";

export async function captureHourlySnapshots(): Promise<{ captured: number; errors: number }> {
  console.log("[Snapshot] Capturing hourly snapshots...");
  
  let captured = 0;
  let errors = 0;
  
  // Truncate to the hour for idempotency - multiple runs within same hour will conflict
  const hourTimestamp = new Date();
  hourTimestamp.setMinutes(0, 0, 0);

  try {
    const people = await db.select().from(trackedPeople);
    console.log(`[Snapshot] Processing ${people.length} people`);

    // Fetch previous fameIndex values from trendingPeople for EMA smoothing
    const currentTrending = await db.select({
      id: trendingPeople.id,
      fameIndex: trendingPeople.fameIndex,
      trendScore: trendingPeople.trendScore,
    }).from(trendingPeople);
    
    const previousFameIndexMap = new Map<string, number>();
    const previousTrendScoreMap = new Map<string, number>();
    for (const t of currentTrending) {
      if (t.fameIndex) previousFameIndexMap.set(t.id, t.fameIndex);
      if (t.trendScore) previousTrendScoreMap.set(t.id, t.trendScore);
    }

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
      } catch (e) {}
    }

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
          wikiDelta: wiki?.delta || 0,
          newsDelta: news?.delta || 0,
          searchDelta: serper?.delta || 0,
          // X API disabled - set to 0
          xQuoteVelocity: 0,
          xReplyVelocity: 0,
          activePlatforms: {
            wiki: !!person.wikiSlug,
            x: false,  // X API disabled for trend scoring
            instagram: !!person.instagramHandle,
            youtube: !!person.youtubeId,
          },
        };

        // Get previous values for EMA smoothing (critical for smooth curves!)
        const prevTrendScore = previousTrendScoreMap.get(person.id);
        const prevFameIndex = previousFameIndexMap.get(person.id);
        
        // Pass previous values for EMA smoothing
        const scoreResult = computeTrendScore(
          inputs,
          prevTrendScore,     // previousScore (for change24h calc)
          undefined,          // previousScore7d (not needed for snapshots)
          prevFameIndex       // previousFameIndex (for EMA smoothing!)
        );

        await db.insert(trendSnapshots).values({
          personId: person.id,
          timestamp: hourTimestamp, // Truncated to hour for idempotency
          trendScore: scoreResult.trendScore,
          fameIndex: scoreResult.fameIndex, // Save smoothed fameIndex!
          newsCount: news?.articleCount24h || 0,
          searchVolume: serper?.searchVolume || 0,
          youtubeViews: 0,
          spotifyFollowers: 0,
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiDelta: wiki?.delta || 0,
          newsDelta: news?.delta || 0,
          searchDelta: serper?.delta || 0,
          xQuoteVelocity: 0,  // X API disabled
          xReplyVelocity: 0,  // X API disabled
          massScore: scoreResult.massScore,
          velocityScore: scoreResult.velocityScore,
          velocityAdjusted: scoreResult.velocityAdjusted,
          diversityMultiplier: scoreResult.diversityMultiplier,
          confidence: scoreResult.confidence,
          momentum: scoreResult.momentum,
          drivers: scoreResult.drivers,
        }).onConflictDoNothing();

        captured++;
      } catch (error) {
        console.error(`[Snapshot] Error capturing ${person.name}:`, error);
        errors++;
      }
    }

    console.log(`[Snapshot] Captured ${captured} snapshots, ${errors} errors`);
  } catch (error) {
    console.error("[Snapshot] Fatal error:", error);
    errors++;
  }

  return { captured, errors };
}

let snapshotInterval: NodeJS.Timeout | null = null;

// Serverless mode detection
const SERVERLESS_MODE = process.env.SERVERLESS_MODE === "true" || process.env.VERCEL === "1";

export function startSnapshotScheduler(intervalMs: number = 60 * 60 * 1000) {
  if (SERVERLESS_MODE) {
    console.log("[Snapshot] Skipped - serverless mode enabled. Use /api/cron/capture-snapshots instead.");
    return;
  }
  
  console.log(`[Snapshot] Starting scheduler (interval: ${intervalMs / 1000 / 60} minutes)`);
  
  captureHourlySnapshots();
  
  snapshotInterval = setInterval(() => {
    captureHourlySnapshots();
  }, intervalMs);
}

export function stopSnapshotScheduler() {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
    console.log("[Snapshot] Scheduler stopped");
  }
}
