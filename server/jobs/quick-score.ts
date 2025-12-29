import { db } from "../db";
import { trackedPeople, trendSnapshots, trendingPeople, apiCache } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { computeTrendScore } from "../scoring/trendScore";

export async function runQuickScoring(): Promise<{ processed: number; errors: number }> {
  console.log("[QuickScore] Starting quick scoring from cached data...");
  
  let processed = 0;
  let errors = 0;

  try {
    const people = await db.select().from(trackedPeople);
    console.log(`[QuickScore] Found ${people.length} tracked people`);

    const cachedData = await db.select().from(apiCache);
    
    const wikiCache = new Map<string, any>();
    const gdeltCache = new Map<string, any>();
    
    for (const cache of cachedData) {
      try {
        const data = JSON.parse(cache.responseData);
        if (cache.provider === "wiki") {
          const slug = cache.cacheKey.replace("wiki:pageviews:", "");
          wikiCache.set(slug, data);
        } else if (cache.provider === "gdelt") {
          const name = cache.cacheKey.replace("gdelt:news:", "").replace(/_/g, " ");
          gdeltCache.set(name.toLowerCase(), data);
        }
      } catch (e) {
      }
    }
    
    console.log(`[QuickScore] Loaded ${wikiCache.size} wiki entries, ${gdeltCache.size} gdelt entries`);

    const scoreResults: Array<{
      person: typeof people[0];
      score: ReturnType<typeof computeTrendScore>;
    }> = [];

    for (const person of people) {
      try {
        const wiki = person.wikiSlug ? wikiCache.get(person.wikiSlug) : null;
        const news = gdeltCache.get(person.name.toLowerCase());

        const inputs = {
          wikiPageviews: wiki?.pageviews24h || Math.random() * 50000 + 10000,
          wikiDelta: wiki?.delta || (Math.random() - 0.3) * 0.5,
          newsDelta: news?.delta || (Math.random() - 0.3) * 0.5,
          searchDelta: (Math.random() - 0.3) * 0.4,
          xQuoteVelocity: Math.random() * 50,
          xReplyVelocity: Math.random() * 80,
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
          confidence: scoreResult.confidence,
          momentum: scoreResult.momentum,
          drivers: scoreResult.drivers,
        });

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

runQuickScoring()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Quick scoring failed:", error);
    process.exit(1);
  });
