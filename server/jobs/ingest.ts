import { db } from "../db";
import { trackedPeople, trendSnapshots, trendingPeople, celebrityImages } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
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

    // GDELT has SSL certificate issues (Dec 2024) - wrap with timeout and fallback
    let gdeltData = new Map<string, any>();
    try {
      const gdeltPromise = fetchBatchGdeltNews(
        people.map(p => ({ id: p.id, name: p.name }))
      );
      const timeoutPromise = new Promise<Map<string, any>>((_, reject) => 
        setTimeout(() => reject(new Error('GDELT timeout')), 30000)
      );
      gdeltData = await Promise.race([gdeltPromise, timeoutPromise]);
    } catch (err) {
      console.log('[Ingest] GDELT fetch failed (certificate/timeout), continuing with other sources');
    }

    const serperData = await fetchSerperBatch(
      people.map(p => p.name),
      2,
      1000
    );

    const xHandles = people.filter(p => p.xHandle).map(p => p.xHandle!);
    const xData = await fetchXBatch(xHandles, 100); // Fetch all 100 celebrities (3x/day = 9K calls/month, within 10K limit)

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
          fameIndex: scoreResult.fameIndex,
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
          velocityAdjusted: scoreResult.velocityAdjusted,
          confidence: scoreResult.confidence,
          diversityMultiplier: scoreResult.diversityMultiplier,
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

    // Fetch primary images for all celebrities (from celebrity_images table)
    // Order by personId first, then by isPrimary (desc) and vote score (desc)
    // This ensures when we iterate, we see the "best" image for each person first
    const allImages = await db
      .select()
      .from(celebrityImages)
      .orderBy(
        celebrityImages.personId,
        desc(celebrityImages.isPrimary), 
        desc(sql`(${celebrityImages.votesUp} - ${celebrityImages.votesDown})`)
      );
    
    // Build a map of personId -> primary image URL (O(n) - one pass)
    const primaryImageMap = new Map<string, string>();
    for (const img of allImages) {
      // Only set if not already set (first image for each personId is the "best")
      if (!primaryImageMap.has(img.personId)) {
        primaryImageMap.set(img.personId, img.imageUrl);
      }
    }
    console.log(`[Ingest] Loaded ${primaryImageMap.size} primary avatar images from celebrity_images`);

    await db.delete(trendingPeople);

    for (let i = 0; i < scoreResults.length; i++) {
      const { person, score } = scoreResults[i];
      
      // Use celebrity_images primary image, fallback to tracked_people avatar
      const avatarUrl = primaryImageMap.get(person.id) || person.avatar;

      await db.insert(trendingPeople).values({
        id: person.id,
        name: person.name,
        avatar: avatarUrl,
        bio: person.bio,
        rank: i + 1,
        trendScore: score.trendScore,
        fameIndex: score.fameIndex,
        change24h: score.change24h,
        change7d: score.change7d,
        category: person.category,
      }).onConflictDoUpdate({
        target: trendingPeople.id,
        set: {
          name: person.name,
          avatar: avatarUrl,
          bio: person.bio,
          rank: i + 1,
          trendScore: score.trendScore,
          fameIndex: score.fameIndex,
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
