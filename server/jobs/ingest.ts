import { db } from "../db";
import { trackedPeople, trendSnapshots, trendingPeople } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { fetchBatchWikiPageviews } from "../providers/wiki";
import { fetchBatchGdeltNews } from "../providers/gdelt";
import { fetchSerperBatch } from "../providers/serper";
import { fetchXBatch } from "../providers/x-api";
import { computeTrendScore } from "../scoring/trendScore";

export interface IngestResult {
  processed: number;
  errors: number;
  duration: number;
}

export async function runDataIngestion(): Promise<IngestResult> {
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;

  console.log("[Ingest] Starting data ingestion...");

  try {
    const people = await db.select().from(trackedPeople);
    console.log(`[Ingest] Found ${people.length} tracked people`);

    const wikiData = await fetchBatchWikiPageviews(
      people.map(p => ({ id: p.id, wikiSlug: p.wikiSlug }))
    );

    const gdeltData = await fetchBatchGdeltNews(
      people.map(p => ({ id: p.id, name: p.name }))
    );

    const serperData = await fetchSerperBatch(
      people.map(p => p.name),
      2,
      1000
    );

    const xHandles = people.filter(p => p.xHandle).map(p => p.xHandle!);
    const xData = await fetchXBatch(xHandles, 30);

    const scoreResults: Array<{
      person: typeof people[0];
      score: ReturnType<typeof computeTrendScore>;
    }> = [];

    for (const person of people) {
      try {
        const wiki = wikiData.get(person.id);
        const news = gdeltData.get(person.id);
        const serper = serperData.get(person.name.toLowerCase());
        const xMetrics = person.xHandle 
          ? xData.get(person.xHandle.toLowerCase().replace("@", ""))
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

        scoreResults.push({ person, score: scoreResult });
        processed++;
      } catch (error) {
        console.error(`[Ingest] Error processing ${person.name}:`, error);
        errors++;
      }
    }

    scoreResults.sort((a, b) => b.score.trendScore - a.score.trendScore);

    await db.delete(trendingPeople);

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
      }).onConflictDoUpdate({
        target: trendingPeople.id,
        set: {
          name: person.name,
          avatar: person.avatar,
          bio: person.bio,
          rank: i + 1,
          trendScore: score.trendScore,
          change24h: score.change24h,
          change7d: score.change7d,
          category: person.category,
        },
      });
    }

    console.log(`[Ingest] Updated ${scoreResults.length} trending people records`);

  } catch (error) {
    console.error("[Ingest] Fatal error:", error);
    errors++;
  }

  const duration = Date.now() - startTime;
  console.log(`[Ingest] Complete: ${processed} processed, ${errors} errors, ${duration}ms`);

  return { processed, errors, duration };
}

export async function getLastIngestionTime(): Promise<Date | null> {
  const lastSnapshot = await db.query.trendSnapshots.findFirst({
    orderBy: [desc(trendSnapshots.timestamp)],
  });

  return lastSnapshot?.timestamp || null;
}

if (process.argv[1]?.endsWith('ingest.ts')) {
  runDataIngestion().then((result) => {
    console.log('[Ingest] Final result:', result);
    process.exit(0);
  }).catch((err) => {
    console.error('[Ingest] Fatal error:', err);
    process.exit(1);
  });
}
