import { db } from "../db";
import { trackedPeople, trendSnapshots, trendingPeople, apiCache } from "@shared/schema";
import { eq, desc, gte, sql } from "drizzle-orm";
import { computeTrendScore } from "../scoring/trendScore";

export async function runQuickScoring(): Promise<{ processed: number; errors: number }> {
  console.log("[QuickScore] Starting quick scoring from cached data...");
  
  let processed = 0;
  let errors = 0;
  
  // NOTE: Quick-score no longer writes snapshots - only updates trending_people table

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

        // NOTE: Quick-score does NOT write snapshots - only ingest.ts writes snapshots
        // to prevent duplicate/conflicting data points that cause jagged trend graphs.
        // This job only updates the trending_people leaderboard table.

        scoreResults.push({ person, score: scoreResult });
        processed++;
      } catch (error) {
        console.error(`[QuickScore] Error processing ${person.name}:`, error);
        errors++;
      }
    }

    // Sort by fameIndex (displayed on leaderboard) not trendScore
    scoreResults.sort((a, b) => b.score.fameIndex - a.score.fameIndex);

    // SAFEGUARD: Validate fameIndex range before writing to database
    // Real fame_index values should be in the 100k-600k range
    // Mock/corrupted data typically has values in the 5k-10k range
    if (scoreResults.length > 0) {
      const avgFameIndex = scoreResults.reduce((sum, r) => sum + (r.score.fameIndex ?? 0), 0) / scoreResults.length;
      if (avgFameIndex < 50000) {
        const errorMsg = `[QuickScore] BLOCKED: Computed data has suspicious avg fameIndex (${avgFameIndex.toFixed(0)}). Real data should be > 50,000. Aborting write.`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      console.log(`[QuickScore] Validated avg fameIndex: ${avgFameIndex.toFixed(0)} (above 50k threshold)`);
    }

    // Use transaction to ensure atomicity - if any insert fails, rollback the delete
    const expectedRowCount = scoreResults.length;
    const TRENDING_PEOPLE_LOCK_ID = 12345; // Same lock ID as ingest.ts - prevents concurrent writes
    
    await db.transaction(async (tx) => {
      // Acquire advisory lock to prevent concurrent writes from ingest or other quick-score jobs
      const lockResult = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${TRENDING_PEOPLE_LOCK_ID})`);
      // Drizzle returns array of rows directly, not object with .rows
      const lockAcquired = (lockResult as any)[0]?.pg_try_advisory_xact_lock;
      if (!lockAcquired) {
        throw new Error("[QuickScore] Another job is writing to trending_people. Aborting to prevent conflicts.");
      }
      console.log(`[QuickScore] Acquired advisory lock for trending_people writes`);
      
      await tx.delete(trendingPeople);
      console.log(`[QuickScore] Cleared trending_people table (in transaction)`);

      let insertedCount = 0;
      for (let i = 0; i < scoreResults.length; i++) {
        const { person, score } = scoreResults[i];

        await tx.insert(trendingPeople).values({
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
        insertedCount++;
      }
      
      // ROW COUNT VALIDATION: Query actual DB row count to verify inserts succeeded
      const countResult = await tx.execute(sql`SELECT COUNT(*) as count FROM trending_people`);
      const actualDbCount = parseInt((countResult as any)[0]?.count || '0', 10);
      
      if (actualDbCount !== expectedRowCount) {
        throw new Error(`[QuickScore] Row count mismatch: expected ${expectedRowCount}, DB has ${actualDbCount}. Rolling back.`);
      }
      console.log(`[QuickScore] Row count validated: ${actualDbCount} rows in DB (matches expected ${expectedRowCount})`);
    });

    console.log(`[QuickScore] Updated ${scoreResults.length} trending people records (transaction committed)`);

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
