import { db } from "../db";
import { trackedPeople, trendSnapshots, trendingPeople, celebrityImages } from "@shared/schema";
import { desc, eq, sql, gte } from "drizzle-orm";
import { fetchBatchWikiPageviews } from "../providers/wiki";
import { fetchBatchGdeltNews } from "../providers/gdelt";
import { fetchSerperBatch } from "../providers/serper";
// NOTE (Jan 2026): X API removed from trend score engine due to cost constraints.
// X API keys preserved for future Platform Insights feature.
// import { fetchXBatch } from "../providers/x-api";
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

  // Truncate to the hour for idempotency - multiple runs within same hour will be deduplicated
  // Using explicit truncation to prevent any race conditions or serialization issues
  const now = new Date();
  const hourTimestamp = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    0, 0, 0  // minutes, seconds, milliseconds all set to 0
  ));
  console.log(`[Ingest] Hour timestamp: ${hourTimestamp.toISOString()}`);

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

    // NOTE (Jan 2026): X API disabled for trend scoring - kept for Platform Insights
    // const xHandles = people.filter(p => p.xHandle).map(p => p.xHandle!);
    // const xData = await fetchXBatch(xHandles, 100);

    // Fetch historical snapshots for change calculations (same logic as quick-score.ts)
    const now = new Date();
    const time24hAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const time7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
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
    
    console.log(`[Ingest] Found ${snapshot24hMap.size} 24h snapshots, ${snapshot7dMap.size} 7d snapshots for change calculations`);

    const scoreResults: Array<{
      person: typeof people[0];
      score: ReturnType<typeof computeTrendScore>;
    }> = [];

    for (const person of people) {
      try {
        const wiki = wikiData.get(person.id);
        const news = gdeltData.get(person.id);
        const serper = serperData.get(person.name.toLowerCase());
        // NOTE (Jan 2026): X API disabled for trend scoring - kept for Platform Insights
        // const xMetrics = person.xHandle 
        //   ? xData.get(person.xHandle.toLowerCase().replace("@", ""))
        //   : null;

        const inputs = {
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiPageviews7dAvg: wiki?.averageDaily7d || 0, // 7-day average for stable mass baseline
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
          confidence: scoreResult.confidence,
          diversityMultiplier: scoreResult.diversityMultiplier,
          momentum: scoreResult.momentum,
          drivers: scoreResult.drivers,
        }).onConflictDoNothing(); // Deduplicate multiple runs within same hour

        scoreResults.push({ person, score: scoreResult });
        processed++;
      } catch (error) {
        console.error(`[Ingest] Error processing ${person.name}:`, error);
        errors++;
      }
    }

    // Sort by fameIndex (displayed on leaderboard) not trendScore - matches quick-score.ts
    scoreResults.sort((a, b) => b.score.fameIndex - a.score.fameIndex);

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
