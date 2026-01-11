import { db } from "../db";
import { trackedPeople, trendSnapshots, trendingPeople, apiCache } from "@shared/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { computeTrendScore } from "../scoring/trendScore";

export async function runQuickScoring(): Promise<{ processed: number; errors: number }> {
  console.log("[QuickScore] Starting quick scoring from cached data...");
  
  let processed = 0;
  let errors = 0;
  
  // Truncate to the hour for idempotency - multiple runs within same hour will conflict
  const hourTimestamp = new Date();
  hourTimestamp.setMinutes(0, 0, 0);

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
      gte(trendSnapshots.timestamp, time7dAgo)
    );
    
    // Create maps for 24h and 7d lookups (closest snapshot to target time)
    const snapshot24hMap = new Map<string, { trendScore: number; fameIndex: number | null }>();
    const snapshot7dMap = new Map<string, { trendScore: number; fameIndex: number | null }>();
    
    for (const snap of historicalSnapshots) {
      const snapTime = new Date(snap.timestamp).getTime();
      const diff24h = Math.abs(snapTime - time24hAgo.getTime());
      const diff7d = Math.abs(snapTime - time7dAgo.getTime());
      
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
    
    console.log(`[QuickScore] Found ${snapshot24hMap.size} 24h snapshots, ${snapshot7dMap.size} 7d snapshots for change calculations`);

    const scoreResults: Array<{
      person: typeof people[0];
      score: ReturnType<typeof computeTrendScore>;
    }> = [];

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

        // Get previous scores for change calculations
        const prev24h = snapshot24hMap.get(person.id);
        const prev7d = snapshot7dMap.get(person.id);
        
        const scoreResult = computeTrendScore(
          inputs,
          prev24h?.trendScore,  // previousScore for change24h calculation
          prev7d?.trendScore,   // previousScore7d for change7d calculation
          prev24h?.fameIndex ?? undefined  // previousFameIndex for EMA smoothing
        );

        await db.insert(trendSnapshots).values({
          personId: person.id,
          timestamp: hourTimestamp, // Truncated to hour for idempotency
          trendScore: scoreResult.trendScore,
          fameIndex: scoreResult.fameIndex,
          newsCount: news?.articleCount24h || 0,
          searchVolume: 0,
          youtubeViews: 0,
          spotifyFollowers: 0,
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiDelta: wiki?.delta || 0,
          newsDelta: news?.delta || 0,
          searchDelta: inputs.searchDelta,
          xQuoteVelocity: inputs.xQuoteVelocity,
          xReplyVelocity: inputs.xReplyVelocity,
          massScore: scoreResult.massScore,
          velocityScore: scoreResult.velocityScore,
          velocityAdjusted: scoreResult.velocityAdjusted,
          confidence: scoreResult.confidence,
          diversityMultiplier: scoreResult.diversityMultiplier,
          momentum: scoreResult.momentum,
          drivers: scoreResult.drivers,
        }).onConflictDoNothing();

        scoreResults.push({ person, score: scoreResult });
        processed++;
      } catch (error) {
        console.error(`[QuickScore] Error processing ${person.name}:`, error);
        errors++;
      }
    }

    scoreResults.sort((a, b) => b.score.trendScore - a.score.trendScore);

    await db.delete(trendingPeople);
    console.log(`[QuickScore] Cleared trending_people table`);

    for (let i = 0; i < scoreResults.length; i++) {
      const { person, score } = scoreResults[i];

      await db.insert(trendingPeople).values({
        id: person.id,
        name: person.name,
        avatar: person.avatar,
        bio: person.bio,
        rank: i + 1,
        trendScore: score.trendScore,
        fameIndex: score.fameIndex,
        change24h: score.change24h,
        change7d: score.change7d,
        category: person.category,
      });
    }

    console.log(`[QuickScore] Updated ${scoreResults.length} trending people records`);

  } catch (error) {
    console.error("[QuickScore] Fatal error:", error);
    errors++;
  }

  console.log(`[QuickScore] Complete: ${processed} processed, ${errors} errors`);
  return { processed, errors };
}

if (process.argv[1]?.endsWith('quick-score.ts')) {
  runQuickScoring()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Quick scoring failed:", error);
      process.exit(1);
    });
}
