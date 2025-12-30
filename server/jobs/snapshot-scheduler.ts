import { db } from "../db";
import { trackedPeople, trendSnapshots, apiCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import { computeTrendScore } from "../scoring/trendScore";

export async function captureHourlySnapshots(): Promise<{ captured: number; errors: number }> {
  console.log("[Snapshot] Capturing hourly snapshots...");
  
  let captured = 0;
  let errors = 0;

  try {
    const people = await db.select().from(trackedPeople);
    console.log(`[Snapshot] Processing ${people.length} people`);

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
        const xMetrics = person.xHandle 
          ? xCache.get(person.xHandle.toLowerCase().replace("@", ""))
          : null;

        const inputs = {
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiDelta: wiki?.delta || 0,
          newsDelta: news?.delta || 0,
          searchDelta: serper?.delta || 0,
          xQuoteVelocity: xMetrics?.quoteVelocity || 0,
          xReplyVelocity: xMetrics?.replyVelocity || 0,
          activePlatforms: {
            wiki: !!person.wikiSlug,
            x: !!person.xHandle,
            instagram: !!person.instagramHandle,
            youtube: !!person.youtubeId,
          },
        };

        const scoreResult = computeTrendScore(inputs);

        await db.insert(trendSnapshots).values({
          personId: person.id,
          trendScore: scoreResult.trendScore,
          newsCount: news?.articleCount24h || 0,
          searchVolume: serper?.searchVolume || 0,
          youtubeViews: 0,
          spotifyFollowers: 0,
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiDelta: wiki?.delta || 0,
          newsDelta: news?.delta || 0,
          searchDelta: serper?.delta || 0,
          xQuoteVelocity: xMetrics?.quoteVelocity || 0,
          xReplyVelocity: xMetrics?.replyVelocity || 0,
          massScore: scoreResult.massScore,
          velocityScore: scoreResult.velocityScore,
          confidence: scoreResult.confidence,
          momentum: scoreResult.momentum,
          drivers: scoreResult.drivers,
        });

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

export function startSnapshotScheduler(intervalMs: number = 60 * 60 * 1000) {
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
