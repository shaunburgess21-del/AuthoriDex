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
import { refreshSourceStats } from "../scoring/sourceStats";
import {
  calculateGlobalHealthMetrics,
  updateSourceHealth,
  getStalenessDecayFactor,
  getCurrentHealthSnapshot,
  getHealthSummary,
  hasAnyDegradedSource,
} from "../scoring/sourceHealth";
import {
  updateCatchUpMode,
  isCatchUpModeActive,
  getCatchUpBand,
  loadCatchUpStateFromDB,
  getCatchUpExitStreak,
  getCatchUpEnteredAtHour,
  getCatchUpCapMultiplier,
  getCatchUpAlphaMultiplier,
  MAX_HOURLY_CHANGE_PERCENT,
  EMA_ALPHA_DEFAULT,
  EMA_ALPHA_2_SOURCES,
  EMA_ALPHA_3_SOURCES,
} from "../scoring/normalize";

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

  await loadCatchUpStateFromDB();

  try {
    const people = await db.select().from(trackedPeople);
    console.log(`[Ingest] Found ${people.length} tracked people`);

    const wikiData = await fetchBatchWikiPageviews(
      people.map(p => ({ id: p.id, wikiSlug: p.wikiSlug }))
    );

    // GDELT has SSL certificate issues (Dec 2024) - wrap with timeout and fallback
    // STABILITY FIX: Increased timeout from 120s to 180s to accommodate improved retry logic
    let gdeltData = new Map<string, any>();
    try {
      const gdeltPromise = fetchBatchGdeltNews(
        people.map(p => ({ id: p.id, name: p.name }))
      );
      const timeoutPromise = new Promise<Map<string, any>>((_, reject) => 
        setTimeout(() => reject(new Error('GDELT timeout')), 180000) // 3 minutes for 100 people with jittered delays
      );
      gdeltData = await Promise.race([gdeltPromise, timeoutPromise]);
    } catch (err) {
      console.log('[Ingest] GDELT fetch failed (certificate/timeout), continuing with other sources');
    }

    // COVERAGE GATE: If GDELT returns fresh data for <70% of celebrities, treat as degraded
    // and use previous values for EVERYONE to ensure population consistency.
    // This prevents "mixed freshness" where some celebs get fresh data and others get stale,
    // which creates unfair ranking comparisons within the same hour.
    const COVERAGE_THRESHOLD = 0.70;
    const gdeltCoverage = gdeltData.size / people.length;
    if (gdeltData.size > 0 && gdeltCoverage < COVERAGE_THRESHOLD) {
      console.log(`[Coverage Gate] GDELT partial failure: ${gdeltData.size}/${people.length} (${(gdeltCoverage * 100).toFixed(0)}%) < ${COVERAGE_THRESHOLD * 100}% threshold`);
      console.log(`[Coverage Gate] Treating NEWS as degraded for entire run - using previous values for all celebrities`);
      gdeltData.clear(); // Clear so everyone uses fallback consistently
    }

    let serperData = await fetchSerperBatch(
      people.map(p => ({ id: p.id, name: p.name, searchQueryOverride: p.searchQueryOverride })),
      2,
      1000
    );

    // COVERAGE GATE: Apply same logic to Serper for consistency
    const serperCoverage = serperData.size / people.length;
    if (serperData.size > 0 && serperCoverage < COVERAGE_THRESHOLD) {
      console.log(`[Coverage Gate] Serper partial failure: ${serperData.size}/${people.length} (${(serperCoverage * 100).toFixed(0)}%) < ${COVERAGE_THRESHOLD * 100}% threshold`);
      console.log(`[Coverage Gate] Treating SEARCH as degraded for entire run - using previous values for all celebrities`);
      serperData = new Map(); // Clear so everyone uses fallback consistently
    }

    // NOTE (Jan 2026): X API disabled for trend scoring - kept for Platform Insights
    // const xHandles = people.filter(p => p.xHandle).map(p => p.xHandle!);
    // const xData = await fetchXBatch(xHandles, 100);

    // Fetch historical snapshots for change calculations (same logic as quick-score.ts)
    // Also fetch news/search values for graceful degradation when APIs fail
    const now = new Date();
    const time24hAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const time7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const historicalSnapshots = await db.select({
      personId: trendSnapshots.personId,
      timestamp: trendSnapshots.timestamp,
      trendScore: trendSnapshots.trendScore,
      fameIndex: trendSnapshots.fameIndex,
      newsCount: trendSnapshots.newsCount,
      searchVolume: trendSnapshots.searchVolume,
      newsDelta: trendSnapshots.newsDelta,
      searchDelta: trendSnapshots.searchDelta,
    }).from(trendSnapshots).where(
      gte(trendSnapshots.timestamp, time7dAgo)
    );
    
    // Create maps for different lookups:
    // - mostRecentMap: Most recent snapshot for EMA continuity (CRITICAL for stabilization)
    //   Also stores news/search values for graceful degradation when APIs fail
    // - lastNonZeroNewsMap: Most recent snapshot with non-zero newsCount per person
    //   Used as bootstrap fallback when GDELT has been down for multiple runs
    // - lastNonZeroSearchMap: Same for search volume
    // - snapshot24hMap: Snapshot from ~24h ago for change24h calculation
    // - snapshot7dMap: Snapshot from ~7d ago for change7d calculation
    const mostRecentMap = new Map<string, { 
      trendScore: number; 
      fameIndex: number | null; 
      timestamp: Date;
      newsCount: number | null;
      searchVolume: number | null;
      newsDelta: number | null;
      searchDelta: number | null;
    }>();
    const lastNonZeroNewsMap = new Map<string, { newsCount: number; newsDelta: number; timestamp: Date }>();
    const lastNonZeroSearchMap = new Map<string, { searchVolume: number; searchDelta: number; timestamp: Date }>();
    const snapshot24hMap = new Map<string, { trendScore: number; fameIndex: number | null }>();
    const snapshot7dMap = new Map<string, { trendScore: number; fameIndex: number | null }>();
    
    for (const snap of historicalSnapshots) {
      const snapTime = new Date(snap.timestamp).getTime();
      const diff24h = Math.abs(snapTime - time24hAgo.getTime());
      const diff7d = Math.abs(snapTime - time7dAgo.getTime());
      
      // Track most recent snapshot per person (for EMA smoothing continuity + fallback data)
      const existingRecent = mostRecentMap.get(snap.personId);
      if (!existingRecent || new Date(snap.timestamp) > existingRecent.timestamp) {
        mostRecentMap.set(snap.personId, { 
          trendScore: snap.trendScore, 
          fameIndex: snap.fameIndex,
          timestamp: new Date(snap.timestamp),
          newsCount: snap.newsCount,
          searchVolume: snap.searchVolume,
          newsDelta: snap.newsDelta,
          searchDelta: snap.searchDelta,
        });
      }

      // Track last non-zero news snapshot (for bootstrap recovery from zero-propagation)
      if ((snap.newsCount ?? 0) > 0) {
        const existingNews = lastNonZeroNewsMap.get(snap.personId);
        if (!existingNews || new Date(snap.timestamp) > existingNews.timestamp) {
          lastNonZeroNewsMap.set(snap.personId, {
            newsCount: snap.newsCount!,
            newsDelta: snap.newsDelta ?? 0,
            timestamp: new Date(snap.timestamp),
          });
        }
      }

      // Track last non-zero search snapshot (same bootstrap logic)
      if ((snap.searchVolume ?? 0) > 0) {
        const existingSearch = lastNonZeroSearchMap.get(snap.personId);
        if (!existingSearch || new Date(snap.timestamp) > existingSearch.timestamp) {
          lastNonZeroSearchMap.set(snap.personId, {
            searchVolume: snap.searchVolume!,
            searchDelta: snap.searchDelta ?? 0,
            timestamp: new Date(snap.timestamp),
          });
        }
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
    
    console.log(`[Ingest] Bootstrap maps: ${lastNonZeroNewsMap.size} people with non-zero news history, ${lastNonZeroSearchMap.size} with non-zero search history`);
    
    console.log(`[Ingest] Found ${mostRecentMap.size} recent snapshots (EMA), ${snapshot24hMap.size} 24h snapshots, ${snapshot7dMap.size} 7d snapshots`);

    // Fetch 7-day source statistics for normalization
    const sourceStats = await refreshSourceStats();

    // Stabilization stats tracking for monitoring
    const stabilizationStats = {
      totalProcessed: 0,
      withPreviousScore: 0,  // EMA applied
      rateLimited: 0,        // Hit rate cap
      largeChanges: 0,       // >10% raw change
      maxRawChange: 0,       // Largest raw change %
      avgRawChange: 0,       // Average raw change %
      rawChanges: [] as number[],
      gapPcts: [] as number[], // abs(raw - final) / final for each celebrity
      spikeDistribution: { 0: 0, 1: 0, 2: 0, 3: 0 } as Record<number, number>,
    };

    // Capture old rankings for churn tracking (before we update)
    const oldRankings = await db.select({
      id: trendingPeople.id,
      rank: trendingPeople.rank,
    }).from(trendingPeople);
    const oldRankMap = new Map(oldRankings.map(r => [r.id, r.rank]));
    const oldTop10 = new Set(oldRankings.filter(r => r.rank && r.rank <= 10).map(r => r.id));
    const oldTop20 = new Set(oldRankings.filter(r => r.rank && r.rank <= 20).map(r => r.id));

    const scoreResults: Array<{
      person: typeof people[0];
      score: ReturnType<typeof computeTrendScore>;
    }> = [];

    // Track API failure stats for logging
    let newsApiUsedFallback = 0;
    let searchApiUsedFallback = 0;
    const gdeltFailed = gdeltData.size === 0;
    const serperFailed = serperData.size === 0;
    
    // Build maps of current source values for global-zero detection
    const currentNewsValues = new Map<string, number>();
    const currentSearchValues = new Map<string, number>();
    
    for (const person of people) {
      const news = gdeltData.get(person.id);
      const serper = serperData.get(person.id);
      currentNewsValues.set(person.id, news?.articleCount24h ?? 0);
      currentSearchValues.set(person.id, serper?.searchVolume ?? 0);
    }
    
    // GLOBAL-ZERO DETECTION: Check if >50% of celebrities have near-zero values
    // This indicates a global outage rather than individual genuine drops
    const globalHealth = calculateGlobalHealthMetrics(
      currentNewsValues,
      currentSearchValues,
      people.length
    );
    
    // Update source health states based on current conditions
    const newsHealth = updateSourceHealth("news", {
      apiFailed: gdeltFailed,
      isGlobalOutage: globalHealth.isNewsGlobalOutage,
      dataReturned: !gdeltFailed && !globalHealth.isNewsGlobalOutage,
    });
    
    const searchHealth = updateSourceHealth("search", {
      apiFailed: serperFailed,
      isGlobalOutage: globalHealth.isSearchGlobalOutage,
      dataReturned: !serperFailed && !globalHealth.isSearchGlobalOutage,
    });
    
    // Wiki is generally stable - just track if API returned data
    const wikiApiFailed = wikiData.size === 0;
    updateSourceHealth("wiki", {
      apiFailed: wikiApiFailed,
      isGlobalOutage: false, // Wiki rarely has global-zero issues
      dataReturned: !wikiApiFailed,
    });
    
    // Log health status
    console.log(getHealthSummary());
    
    if (gdeltFailed) {
      console.log('[Ingest] GDELT API failed completely - using graceful degradation (last known values)');
    } else if (globalHealth.isNewsGlobalOutage) {
      console.log(`[Ingest] GDELT global-zero detected (${Math.round(globalHealth.newsNearZeroPercent * 100)}% near-zero) - treating as OUTAGE`);
    }
    
    if (serperFailed) {
      console.log('[Ingest] Serper API failed completely - using graceful degradation (last known values)');
    } else if (globalHealth.isSearchGlobalOutage) {
      console.log(`[Ingest] Serper global-zero detected (${Math.round(globalHealth.searchNearZeroPercent * 100)}% near-zero) - treating as OUTAGE`);
    }
    
    // Get staleness decay factors for fill-forward values
    const newsDecayFactor = getStalenessDecayFactor(newsHealth.lastHealthyTimestamp);
    const searchDecayFactor = getStalenessDecayFactor(searchHealth.lastHealthyTimestamp);
    
    if (newsDecayFactor < 1.0 || searchDecayFactor < 1.0) {
      console.log(`[Ingest] Staleness decay: News=${(newsDecayFactor * 100).toFixed(0)}%, Search=${(searchDecayFactor * 100).toFixed(0)}%`);
    }

    for (const person of people) {
      try {
        const wiki = wikiData.get(person.id);
        const news = gdeltData.get(person.id);
        const serper = serperData.get(person.id);
        const mostRecent = mostRecentMap.get(person.id);
        // NOTE (Jan 2026): X API disabled for trend scoring - kept for Platform Insights
        // const xMetrics = person.xHandle 
        //   ? xData.get(person.xHandle.toLowerCase().replace("@", ""))
        //   : null;

        // GRACEFUL DEGRADATION: When API is in OUTAGE state (global-zero or complete failure),
        // carry forward last known values with staleness decay to prevent sudden score drops.
        // 
        // Key improvements:
        // 1. Only trigger fallback during GLOBAL OUTAGE (>50% near-zero), not individual drops
        // 2. Apply staleness decay: 100% → 50% → 20% over 6-12 hours
        // 3. Suspicious drops only count if global outage is detected
        let newsCount = news?.articleCount24h ?? 0;
        let newsDelta = news?.delta ?? 0;
        let searchVolume = serper?.searchVolume ?? 0;
        let searchDelta = serper?.delta ?? 0;
        let newsUsedFallback = false;
        let searchUsedFallback = false;
        
        const prevNewsCount = mostRecent?.newsCount ?? 0;
        const prevSearchVolume = mostRecent?.searchVolume ?? 0;
        
        // NEWS: Use fallback if source is in OUTAGE state (global-zero or API failed)
        const newsNeedsOutageFallback = newsHealth.state === "OUTAGE" || newsHealth.state === "DEGRADED";
        
        // Also detect individual suspicious drop, but only activate fallback if global outage
        const suspiciousNewsDrop = news && prevNewsCount >= 5 && 
          newsCount < prevNewsCount * 0.1; // 90%+ drop
        
        // Use fallback if: (global outage OR API failed)
        // Bootstrap recovery: if prevNewsCount is 0 (from prior zero-propagation), 
        // look back in history for the last non-zero value to prevent permanent zero-lock
        if (newsNeedsOutageFallback || !news || (suspiciousNewsDrop && globalHealth.isNewsGlobalOutage)) {
          let fallbackNewsCount = prevNewsCount;
          let fallbackNewsDelta = mostRecent?.newsDelta ?? 0;
          let fallbackDecay = newsDecayFactor;

          if (fallbackNewsCount <= 0) {
            const lastNonZero = lastNonZeroNewsMap.get(person.id);
            if (lastNonZero) {
              fallbackNewsCount = lastNonZero.newsCount;
              fallbackNewsDelta = lastNonZero.newsDelta;
              const staleHours = (now.getTime() - lastNonZero.timestamp.getTime()) / (1000 * 60 * 60);
              if (staleHours <= 2) fallbackDecay = 1.0;
              else if (staleHours <= 4) fallbackDecay = 1.0 - ((staleHours - 2) / 2) * 0.3;
              else if (staleHours <= 6) fallbackDecay = 0.7 - ((staleHours - 4) / 2) * 0.2;
              else if (staleHours <= 12) fallbackDecay = 0.5 - ((staleHours - 6) / 6) * 0.3;
              else fallbackDecay = 0.2;
            }
          }

          if (fallbackNewsCount > 0) {
            newsCount = Math.round(fallbackNewsCount * fallbackDecay);
            newsDelta = Math.round(fallbackNewsDelta * fallbackDecay);
            newsUsedFallback = true;
            newsApiUsedFallback++;
          }
        }
        
        // SEARCH: Use fallback if source is in OUTAGE state
        const searchNeedsOutageFallback = searchHealth.state === "OUTAGE" || searchHealth.state === "DEGRADED";
        
        const suspiciousSearchDrop = serper && prevSearchVolume >= 100 &&
          searchVolume < prevSearchVolume * 0.1; // 90%+ drop
        
        // Same bootstrap recovery logic for search
        if (searchNeedsOutageFallback || !serper || (suspiciousSearchDrop && globalHealth.isSearchGlobalOutage)) {
          let fallbackSearchVolume = prevSearchVolume;
          let fallbackSearchDelta = mostRecent?.searchDelta ?? 0;
          let fallbackDecay = searchDecayFactor;

          if (fallbackSearchVolume <= 0) {
            const lastNonZero = lastNonZeroSearchMap.get(person.id);
            if (lastNonZero) {
              fallbackSearchVolume = lastNonZero.searchVolume;
              fallbackSearchDelta = lastNonZero.searchDelta;
              const staleHours = (now.getTime() - lastNonZero.timestamp.getTime()) / (1000 * 60 * 60);
              if (staleHours <= 2) fallbackDecay = 1.0;
              else if (staleHours <= 4) fallbackDecay = 1.0 - ((staleHours - 2) / 2) * 0.3;
              else if (staleHours <= 6) fallbackDecay = 0.7 - ((staleHours - 4) / 2) * 0.2;
              else if (staleHours <= 12) fallbackDecay = 0.5 - ((staleHours - 6) / 6) * 0.3;
              else fallbackDecay = 0.2;
            }
          }

          if (fallbackSearchVolume > 0) {
            searchVolume = Math.round(fallbackSearchVolume * fallbackDecay);
            searchDelta = Math.round(fallbackSearchDelta * fallbackDecay);
            searchUsedFallback = true;
            searchApiUsedFallback++;
          }
        }

        // Get current source health states for weight renormalization
        const currentHealthSnapshot = getCurrentHealthSnapshot();
        
        const inputs = {
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiPageviews7dAvg: wiki?.averageDaily7d || 0, // 7-day average for stable mass baseline
          wikiDelta: wiki?.delta || 0,
          newsDelta: newsDelta,
          searchDelta: searchDelta,
          // Raw values for normalization - use graceful degradation values
          newsCount: newsCount,
          searchVolume: searchVolume,
          // Previous values for recovery detection (data returning after API failure)
          // Only pass previous values if current data is FRESH (not fallback)
          // This ensures recovery mode triggers when we get fresh data after using fallback
          prevNewsCount: newsUsedFallback ? newsCount : (prevNewsCount),
          prevSearchVolume: searchUsedFallback ? searchVolume : (prevSearchVolume),
          // Flag whether current data is fresh (for recovery detection)
          newsIsFresh: !newsUsedFallback && (news?.articleCount24h ?? 0) > 0,
          searchIsFresh: !searchUsedFallback && (serper?.searchVolume ?? 0) > 0,
          // Baseline medians for spike detection (p50 is more robust than mean)
          wikiBaseline: wiki?.averageDaily7d || sourceStats.wiki.p50,
          newsBaseline: sourceStats.news.p50,  // Use median (p50), not mean - more robust
          searchBaseline: sourceStats.search.p50,  // Use median (p50), not mean - more robust
          // X API disabled - set to 0
          xQuoteVelocity: 0,
          xReplyVelocity: 0,
          activePlatforms: {
            wiki: !!person.wikiSlug,
            x: false,  // X API disabled for trend scoring
            instagram: !!person.instagramHandle,
            youtube: !!person.youtubeId,
          },
          // Source health states for weight renormalization during outages
          sourceHealthStates: {
            newsOutage: currentHealthSnapshot.news.state === 'OUTAGE' || currentHealthSnapshot.news.state === 'DEGRADED',
            searchOutage: currentHealthSnapshot.search.state === 'OUTAGE' || currentHealthSnapshot.search.state === 'DEGRADED',
            wikiOutage: currentHealthSnapshot.wiki.state === 'OUTAGE' || currentHealthSnapshot.wiki.state === 'DEGRADED',
          },
        };

        // Get previous scores for change calculations and EMA smoothing
        // Note: mostRecent already fetched above for graceful degradation
        const prev24h = snapshot24hMap.get(person.id);
        const prev7d = snapshot7dMap.get(person.id);
        
        // CRITICAL: Use MOST RECENT fameIndex for EMA smoothing (not 24h-ago)
        // This ensures rate limiting and EMA are always applied for smooth transitions
        const previousFameIndex = mostRecent?.fameIndex ?? undefined;
        
        const scoreResult = computeTrendScore(
          inputs,
          prev24h?.trendScore,  // previousScore for change24h calculation
          prev7d?.trendScore,   // previousScore7d for change7d calculation
          previousFameIndex,    // Most recent fameIndex for EMA smoothing
          sourceStats           // 7-day stats for normalization
        );

        // Track stabilization stats using pre-stabilization rawFameIndex
        stabilizationStats.totalProcessed++;
        // Track spike count distribution (0/1/2/3 sources spiking)
        const spikeCount = Math.min(3, Math.max(0, scoreResult.spikingSourceCount));
        stabilizationStats.spikeDistribution[spikeCount]++;
        
        if (scoreResult.wasStabilized && previousFameIndex !== undefined && previousFameIndex > 0) {
          stabilizationStats.withPreviousScore++;
          const rawChangePct = Math.abs((scoreResult.rawFameIndex - previousFameIndex) / previousFameIndex) * 100;
          stabilizationStats.rawChanges.push(rawChangePct);
          if (rawChangePct >= 8) stabilizationStats.rateLimited++; // 8% cap (raised from 5%)
          if (rawChangePct > 10) stabilizationStats.largeChanges++;
          if (rawChangePct > stabilizationStats.maxRawChange) stabilizationStats.maxRawChange = rawChangePct;
        }

        if (scoreResult.fameIndex > 0) {
          const gapPct = Math.abs(scoreResult.rawFameIndex - scoreResult.fameIndex) / scoreResult.fameIndex;
          stabilizationStats.gapPcts.push(gapPct);
        }

        const snapshotValues = {
          personId: person.id,
          timestamp: hourTimestamp, // Truncated to hour for idempotency
          trendScore: scoreResult.trendScore,
          fameIndex: scoreResult.fameIndex,
          newsCount: newsCount,  // Use graceful degradation value
          searchVolume: searchVolume,  // Use graceful degradation value
          youtubeViews: 0,
          spotifyFollowers: 0,
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiDelta: wiki?.delta || 0,
          newsDelta: newsDelta,  // Use graceful degradation value
          searchDelta: searchDelta,  // Use graceful degradation value
          xQuoteVelocity: 0,  // X API disabled
          xReplyVelocity: 0,  // X API disabled
          massScore: scoreResult.massScore,
          velocityScore: scoreResult.velocityScore,
          velocityAdjusted: scoreResult.velocityAdjusted,
          confidence: scoreResult.confidence,
          diversityMultiplier: scoreResult.diversityMultiplier,
          momentum: scoreResult.momentum,
          drivers: scoreResult.drivers,
        };
        await db.insert(trendSnapshots).values(snapshotValues)
          .onConflictDoUpdate({
            target: [trendSnapshots.personId, trendSnapshots.timestamp],
            set: {
              trendScore: snapshotValues.trendScore,
              fameIndex: snapshotValues.fameIndex,
              newsCount: snapshotValues.newsCount,
              searchVolume: snapshotValues.searchVolume,
              wikiPageviews: snapshotValues.wikiPageviews,
              wikiDelta: snapshotValues.wikiDelta,
              newsDelta: snapshotValues.newsDelta,
              searchDelta: snapshotValues.searchDelta,
              massScore: snapshotValues.massScore,
              velocityScore: snapshotValues.velocityScore,
              velocityAdjusted: snapshotValues.velocityAdjusted,
              confidence: snapshotValues.confidence,
              diversityMultiplier: snapshotValues.diversityMultiplier,
              momentum: snapshotValues.momentum,
              drivers: snapshotValues.drivers,
            },
          });

        scoreResults.push({ person, score: scoreResult });
        processed++;
      } catch (error) {
        console.error(`[Ingest] Error processing ${person.name}:`, error);
        errors++;
      }
    }

    // Compute gap metrics (raw vs final score divergence) for catch-up mode
    const sortedGaps = [...stabilizationStats.gapPcts].sort((a, b) => a - b);
    const medianGapPct = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0;
    const p90GapPct = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length * 0.9)] : 0;

    await updateCatchUpMode(medianGapPct);
    const catchUpActive = isCatchUpModeActive();
    const catchUpCurrentBand = getCatchUpBand();
    const catchUpExitStreak = getCatchUpExitStreak();
    const catchUpEnteredAt = getCatchUpEnteredAtHour();
    const capMultiplier = getCatchUpCapMultiplier();
    const alphaMultiplier = getCatchUpAlphaMultiplier();
    console.log(`[Gap Metrics] medianGap=${(medianGapPct * 100).toFixed(1)}%, p90Gap=${(p90GapPct * 100).toFixed(1)}%, catchUp=${catchUpCurrentBand}, exitStreak=${catchUpExitStreak}`);

    // Sort by fameIndex (displayed on leaderboard) not trendScore - matches quick-score.ts
    scoreResults.sort((a, b) => b.score.fameIndex - a.score.fameIndex);

    // SAFEGUARD: Validate fameIndex range before writing to database
    // Real fame_index values should be in the 100k-600k range
    // Mock/corrupted data typically has values in the 5k-10k range
    if (scoreResults.length > 0) {
      const avgFameIndex = scoreResults.reduce((sum, r) => sum + (r.score.fameIndex ?? 0), 0) / scoreResults.length;
      if (avgFameIndex < 50000) {
        const errorMsg = `[Ingest] BLOCKED: Computed data has suspicious avg fameIndex (${avgFameIndex.toFixed(0)}). Real data should be > 50,000. Aborting write.`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      console.log(`[Ingest] Validated avg fameIndex: ${avgFameIndex.toFixed(0)} (above 50k threshold)`);
    }

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

    // Use transaction to ensure atomicity - if any insert fails, rollback the delete
    // This prevents data loss if the server crashes/restarts between delete and inserts
    const expectedRowCount = scoreResults.length;
    const TRENDING_PEOPLE_LOCK_ID = 12345; // Advisory lock ID for trending_people writes
    
    await db.transaction(async (tx) => {
      // Acquire advisory lock to prevent concurrent writes from other ingest jobs
      const lockResult = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${TRENDING_PEOPLE_LOCK_ID})`);
      // Handle both possible Drizzle return formats: array of rows OR object with .rows
      const rows = Array.isArray(lockResult) ? lockResult : (lockResult as any).rows ?? [];
      const lockAcquired = rows[0]?.pg_try_advisory_xact_lock;
      console.log(`[Ingest] Advisory lock result: ${JSON.stringify(rows[0])}, acquired: ${lockAcquired}`);
      if (!lockAcquired) {
        throw new Error("[Ingest] Another job is writing to trending_people. Aborting to prevent conflicts.");
      }
      console.log(`[Ingest] Acquired advisory lock for trending_people writes`);
      
      await tx.delete(trendingPeople);
      console.log(`[Ingest] Cleared trending_people table (in transaction)`);

      let insertedCount = 0;
      for (let i = 0; i < scoreResults.length; i++) {
        const { person, score } = scoreResults[i];
        
        // Use celebrity_images primary image, fallback to tracked_people avatar
        const avatarUrl = primaryImageMap.get(person.id) || person.avatar;

        await tx.insert(trendingPeople).values({
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
        insertedCount++;
      }
      
      // ROW COUNT VALIDATION: Query actual DB row count to verify inserts succeeded
      const countResult = await tx.execute(sql`SELECT COUNT(*) as count FROM trending_people`);
      const countRows = Array.isArray(countResult) ? countResult : (countResult as any).rows ?? [];
      const actualDbCount = parseInt(countRows[0]?.count || '0', 10);
      
      if (actualDbCount !== expectedRowCount) {
        throw new Error(`[Ingest] Row count mismatch: expected ${expectedRowCount}, DB has ${actualDbCount}. Rolling back.`);
      }
      console.log(`[Ingest] Row count validated: ${actualDbCount} rows in DB (matches expected ${expectedRowCount})`);
    });

    console.log(`[Ingest] Updated ${scoreResults.length} trending people records (transaction committed)`);

    // Calculate rank churn (entries entering/exiting top 10 and top 20)
    const newTop10 = new Set(scoreResults.slice(0, 10).map(r => r.person.id));
    const newTop20 = new Set(scoreResults.slice(0, 20).map(r => r.person.id));
    
    const enteredTop10 = Array.from(newTop10).filter(id => !oldTop10.has(id)).length;
    const exitedTop10 = Array.from(oldTop10).filter(id => !newTop10.has(id)).length;
    const enteredTop20 = Array.from(newTop20).filter(id => !oldTop20.has(id)).length;
    const exitedTop20 = Array.from(oldTop20).filter(id => !newTop20.has(id)).length;

    // Log stabilization stats summary
    if (stabilizationStats.rawChanges.length > 0) {
      stabilizationStats.avgRawChange = stabilizationStats.rawChanges.reduce((a, b) => a + b, 0) / stabilizationStats.rawChanges.length;
      console.log(`[Stabilization Stats] EMA applied: ${stabilizationStats.withPreviousScore}/${stabilizationStats.totalProcessed}, ` +
        `Rate limited (>5%): ${stabilizationStats.rateLimited}, Large changes (>10%): ${stabilizationStats.largeChanges}, ` +
        `Avg raw change: ${stabilizationStats.avgRawChange.toFixed(2)}%, Max: ${stabilizationStats.maxRawChange.toFixed(1)}%`);
    }
    
    // Log spike distribution (how many have 0/1/2/3 sources spiking)
    const spikeDist = stabilizationStats.spikeDistribution;
    console.log(`[Spike Distribution] 0 sources: ${spikeDist[0]}, 1 source: ${spikeDist[1]}, 2 sources: ${spikeDist[2]}, 3 sources: ${spikeDist[3]}`);
    
    // Log graceful degradation stats (when APIs fail)
    if (newsApiUsedFallback > 0 || searchApiUsedFallback > 0) {
      const newsBootstrapped = newsApiUsedFallback > 0 && Array.from(lastNonZeroNewsMap.keys()).length > 0 ? 
        ` (${lastNonZeroNewsMap.size} bootstrapped from history)` : '';
      const searchBootstrapped = searchApiUsedFallback > 0 && Array.from(lastNonZeroSearchMap.keys()).length > 0 ? 
        ` (${lastNonZeroSearchMap.size} bootstrapped from history)` : '';
      console.log(`[Graceful Degradation] News fallback: ${newsApiUsedFallback}/${people.length}${newsBootstrapped}, Search fallback: ${searchApiUsedFallback}/${people.length}${searchBootstrapped}`);
    }
    
    // Log rank churn
    console.log(`[Rank Churn] Top 10: +${enteredTop10}/-${exitedTop10} | Top 20: +${enteredTop20}/-${exitedTop20}`);
    
    // Churn guardrail: flag possible data anomalies
    const CHURN_THRESHOLD_TOP10 = 4;
    const CHURN_THRESHOLD_TOP20 = 8;
    const top10Churn = Math.max(enteredTop10, exitedTop10);
    const top20Churn = Math.max(enteredTop20, exitedTop20);
    
    if (top10Churn > CHURN_THRESHOLD_TOP10 || top20Churn > CHURN_THRESHOLD_TOP20) {
      console.warn(`[ANOMALY ALERT] Unusual rank churn detected! Top10: ${top10Churn}, Top20: ${top20Churn}`);
      
      // Log top 5 biggest movers (by absolute rank change)
      const movers = scoreResults
        .map((r, newRank) => {
          const oldRank = oldRankMap.get(r.person.id) ?? 999;
          const rankChange = oldRank - (newRank + 1); // Positive = moved up
          return {
            name: r.person.name,
            oldRank,
            newRank: newRank + 1,
            rankChange,
            rawFameIndex: r.score.rawFameIndex,
            finalFameIndex: r.score.fameIndex,
            spikingCount: r.score.spikingSourceCount,
          };
        })
        .sort((a, b) => Math.abs(b.rankChange) - Math.abs(a.rankChange))
        .slice(0, 5);
      
      console.warn(`[ANOMALY ALERT] Top 5 movers:`);
      for (const m of movers) {
        const direction = m.rankChange > 0 ? '↑' : m.rankChange < 0 ? '↓' : '→';
        console.warn(`  ${direction} ${m.name}: #${m.oldRank} → #${m.newRank} (raw: ${m.rawFameIndex}, final: ${m.finalFameIndex}, spikes: ${m.spikingCount})`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // POST-INGEST HEALTH SUMMARY - Single consolidated log for monitoring
    // ═══════════════════════════════════════════════════════════════════════════
    const jobDuration = Date.now() - startTime;
    const hourBucket = new Date().toISOString().slice(0, 13) + ":00:00Z"; // e.g. "2026-02-04T14:00:00Z"
    const healthSummary = {
      job: "ingest",
      hour: hourBucket,
      duration: `${jobDuration}ms`,
      rows: processed,
      lock: "acquired",
      sources: {
        wiki: wikiData.size < people.length * 0.7 ? "DEGRADED" : "OK",
        news: newsApiUsedFallback > people.length * 0.3 ? "DEGRADED" : "OK",
        search: searchApiUsedFallback > people.length * 0.3 ? "DEGRADED" : "OK",
      },
      fresh: {
        wiki: wikiData.size,
        news: people.length - newsApiUsedFallback,
        search: people.length - searchApiUsedFallback,
      },
      fallbacks: {
        news: newsApiUsedFallback,
        search: searchApiUsedFallback,
      },
      bootstrap: {
        newsHistory: lastNonZeroNewsMap.size,
        searchHistory: lastNonZeroSearchMap.size,
        newsDecay: `${(newsDecayFactor * 100).toFixed(0)}%`,
        searchDecay: `${(searchDecayFactor * 100).toFixed(0)}%`,
      },
      churn: {
        top10: `+${enteredTop10}/-${exitedTop10}`,
        top20: `+${enteredTop20}/-${exitedTop20}`,
      },
      rateLimited: stabilizationStats.rateLimited,
      rateLimitedPct: `${((stabilizationStats.rateLimited / stabilizationStats.totalProcessed) * 100).toFixed(1)}%`,
      convergence: {
        medianGapPct: `${(medianGapPct * 100).toFixed(1)}%`,
        p90GapPct: `${(p90GapPct * 100).toFixed(1)}%`,
        catchUpMode: catchUpCurrentBand,
        catchUpExitStreak: catchUpExitStreak,
        catchUpEnteredAt: catchUpEnteredAt,
      },
      capsUsed: {
        base: `${(MAX_HOURLY_CHANGE_PERCENT * capMultiplier * 100).toFixed(1)}%`,
        spike1: `${(0.12 * capMultiplier * 100).toFixed(1)}%`,
        spike2: `${(0.20 * capMultiplier * 100).toFixed(1)}%`,
        spike3: `${(0.35 * capMultiplier * 100).toFixed(1)}%`,
        multiplier: `${capMultiplier}x`,
      },
      alphaUsed: {
        base: `${(EMA_ALPHA_DEFAULT * alphaMultiplier).toFixed(3)}`,
        spike2: `${(EMA_ALPHA_2_SOURCES * alphaMultiplier).toFixed(3)}`,
        spike3: `${Math.min(EMA_ALPHA_3_SOURCES * alphaMultiplier, 0.40).toFixed(3)}`,
        multiplier: `${alphaMultiplier}x`,
      },
    };
    
    console.log(`[HEALTH SUMMARY] ${JSON.stringify(healthSummary)}`);
    // ═══════════════════════════════════════════════════════════════════════════

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
