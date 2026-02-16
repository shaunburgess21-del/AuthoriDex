import { 
  PLATFORM_WEIGHTS,
  MASS_ALLOCATION,
  VELOCITY_ALLOCATION,
  calculateDiversityMultiplier,
  applyAntiSpamDamping,
  applyDynamicEmaSmoothing,
  getDynamicAlpha,
  isRecalibrationModeActive,
  PlatformStatuses,
  ActivePlatforms,
  MISSING_X_PENALTY,
  WIKI_DOMINANCE_CAP,
  AllSourceStats,
  DEFAULT_SOURCE_STATS,
  normalizeSourceValue,
  countSpikingSources,
  applyDynamicRateLimiting,
  getDynamicRateLimit,
  SpikeDetectionInputs,
  getRecoveryRateBoost,
  getVelocityTaperMultiplier,
  SourceHealthStates, // Kept for interface compatibility, but not used for weight redistribution
} from "./normalize";
import { 
  normalizeMass, 
  normalizeVelocity, 
  clamp, 
  calculateMomentum, 
  generateDrivers 
} from "./utils";

export interface TrendInputs {
  wikiPageviews: number;       // 24h pageviews (used for velocity)
  wikiPageviews7dAvg: number;  // 7-day daily average (used for mass - more stable baseline)
  wikiDelta: number;
  newsDelta: number;
  searchDelta: number;
  xQuoteVelocity: number;
  xReplyVelocity: number;
  
  // Raw source values for normalization (current period)
  newsCount?: number;          // Raw news article count
  searchVolume?: number;       // Raw search volume
  
  // Previous source values for recovery detection (graceful degradation)
  prevNewsCount?: number;      // Previous snapshot's news count
  prevSearchVolume?: number;   // Previous snapshot's search volume
  
  // Freshness flags for recovery detection (when fresh data returns after fallback)
  newsIsFresh?: boolean;       // True if news data is fresh (not fallback)
  searchIsFresh?: boolean;     // True if search data is fresh (not fallback)
  
  // Baseline averages for spike detection
  wikiBaseline?: number;       // 7-day avg wiki pageviews
  newsBaseline?: number;       // 7-day avg news count
  searchBaseline?: number;     // 7-day avg search volume
  
  totalFollowers?: number;
  
  activePlatforms: ActivePlatforms;
  
  // New: platform statuses for diversity multiplier
  platformStatuses?: PlatformStatuses;
  
  // Source health states for weight renormalization during outages
  sourceHealthStates?: SourceHealthStates;
  
  // Staleness decay factors for velocity weight adjustment (0.0-1.0)
  // When a source is stale, its velocity weight is reduced and redistributed
  newsStalenessFactor?: number;   // 1.0 = fresh, 0.5 = very stale
  searchStalenessFactor?: number; // 1.0 = fresh, 0.5 = very stale
}

export interface StabilizationDetail {
  prevFame: number;
  rawFame: number;
  afterRateLimit: number;
  afterEma: number;
  finalFame: number;
  capUsed: number;
  alphaUsed: number;
  asymmetric: boolean;
  rawVsPrevPct: number;
  rateLimitDeltaPct: number;
  emaDeltaPct: number;
  rateLimitStepPct: number;
  emaStepPct: number;
}

export interface TrendScoreResult {
  trendScore: number;
  fameIndex: number;
  rawFameIndex: number;
  wasStabilized: boolean;
  stabDetail: StabilizationDetail | null;
  spikingSourceCount: number;
  massScore: number;
  velocityScore: number;
  velocityAdjusted: number;
  confidence: number;
  diversityMultiplier: number;
  momentum: "Breakout" | "Sustained" | "Cooling" | "Stable";
  drivers: string[];
  
  change24h: number | null;
  change7d: number | null;
}

/**
 * Computes the trend score using the stable algorithm:
 * - Fixed weights (no redistribution)
 * - Diversity multiplier penalty for missing platforms
 * - Anti-spam damping for velocity
 * - EMA smoothing option
 * - Per-source normalization (log1p + percentile ranking)
 * - Multi-source breakout mode (dynamic rate limits)
 */
export function computeTrendScore(
  inputs: TrendInputs,
  previousScore?: number,
  previousScore7d?: number,
  previousFameIndex?: number,
  sourceStats?: AllSourceStats,
  previousFameIndex24h?: number,
  previousFameIndex7d?: number,
): TrendScoreResult {
  // Use provided stats or defaults
  const stats = sourceStats || DEFAULT_SOURCE_STATS;
  // =========================================================================
  // 1. CALCULATE MASS SCORE (0-100)
  // =========================================================================
  
  // Wiki mass contribution - only if wiki is active
  // Use 7-day average for stability (prevents cliff-edge drops from data timing)
  // Fallback to 24h if 7d not available (for backwards compatibility)
  const wikiPageviewsForMass = inputs.wikiPageviews7dAvg > 0 
    ? inputs.wikiPageviews7dAvg 
    : inputs.wikiPageviews;
  
  let wikiMassScore = inputs.activePlatforms.wiki 
    ? normalizeMass(wikiPageviewsForMass * 365) 
    : 0;
  
  // Follower-based mass - only apply if we actually have follower data
  const followerScore = inputs.totalFollowers 
    ? normalizeMass(inputs.totalFollowers) 
    : 0;
  
  // If we have follower data, use the standard weighted approach
  // If not, wiki becomes the primary mass signal (scaled up to compensate)
  let massScore: number;
  
  if (inputs.totalFollowers && inputs.totalFollowers > 0) {
    // Standard weighted approach when we have follower data
    const xMassContrib = inputs.activePlatforms.x ? followerScore * PLATFORM_WEIGHTS.mass.x : 0;
    const instagramMassContrib = inputs.activePlatforms.instagram ? followerScore * PLATFORM_WEIGHTS.mass.instagram : 0;
    const youtubeMassContrib = inputs.activePlatforms.youtube ? followerScore * PLATFORM_WEIGHTS.mass.youtube : 0;
    
    massScore = (
      (wikiMassScore * PLATFORM_WEIGHTS.mass.wiki) +
      xMassContrib +
      instagramMassContrib +
      youtubeMassContrib
    );
  } else {
    // Wiki-only mode: wiki becomes the full mass signal
    // Scale appropriately since wiki normally only gets 30% weight
    massScore = wikiMassScore;
  }
  
  // =========================================================================
  // 2. CALCULATE VELOCITY SCORE (0-100) with per-source normalization
  // =========================================================================
  
  // Get raw values for normalization (use pageviews/counts, not deltas)
  // Wiki velocity: blend 24h and 7d to balance responsiveness with stability.
  // Pure 7d avg caused event spikes (e.g. Super Bowl) to persist for a full week.
  // Blend: 60% 24h (responsive) + 40% 7d avg (stability buffer) — spikes fade in 1-2 days.
  const wiki24h = inputs.wikiPageviews || 0;
  const wiki7d = inputs.wikiPageviews7dAvg || 0;
  const wikiRaw = wiki7d > 0 
    ? (wiki24h > 0 ? wiki24h * 0.6 + wiki7d * 0.4 : wiki7d)
    : wiki24h;
  const newsRaw = inputs.newsCount ?? 0;
  const searchRaw = inputs.searchVolume ?? 0;
  
  // Normalize each source using log1p + percentile ranking (0-1 output)
  const wikiNormalized = normalizeSourceValue(wikiRaw, stats.wiki);
  const newsNormalized = normalizeSourceValue(newsRaw, stats.news);
  const searchNormalized = normalizeSourceValue(searchRaw, stats.search);
  
  // Scale normalized values to 0-100 range for consistency with legacy code
  const wikiVelocityScore = inputs.activePlatforms.wiki 
    ? wikiNormalized * 100
    : 0;
  const newsVelocityScore = newsNormalized * 100;
  const searchVelocityScore = searchNormalized * 100;
  
  // X velocity - only if X handle is present (currently disabled)
  const xTotalVelocity = inputs.xQuoteVelocity + inputs.xReplyVelocity;
  const xVelocityScore = inputs.activePlatforms.x 
    ? Math.min(100, xTotalVelocity * 2) 
    : 0;
  
  // VELOCITY WEIGHT DECAY: When a source is stale, reduce its weight and redistribute
  // to active sources. This prevents frozen data from having full influence.
  const baseWeights = PLATFORM_WEIGHTS.velocity;
  const newsFreshness = inputs.newsStalenessFactor ?? 1.0;
  const searchFreshness = inputs.searchStalenessFactor ?? 1.0;
  
  const effectiveNewsWeight = baseWeights.news * newsFreshness;
  const effectiveSearchWeight = baseWeights.search * searchFreshness;
  const effectiveWikiWeight = baseWeights.wiki;
  const effectiveXWeight = baseWeights.x;
  
  const totalEffectiveWeight = effectiveWikiWeight + effectiveNewsWeight + effectiveSearchWeight + effectiveXWeight;
  const totalBaseWeight = baseWeights.wiki + baseWeights.news + baseWeights.search + baseWeights.x;
  const renormFactor = totalEffectiveWeight > 0 
    ? totalBaseWeight / totalEffectiveWeight 
    : 1.0;
  
  const MAX_BOOST = 1.5; // Cap: no source exceeds 1.5x base weight (post-cap sum may be < 1.0 intentionally)
  const velocityWeights = {
    wiki: Math.min(effectiveWikiWeight * renormFactor, baseWeights.wiki * MAX_BOOST),
    news: Math.min(effectiveNewsWeight * renormFactor, baseWeights.news * MAX_BOOST),
    search: Math.min(effectiveSearchWeight * renormFactor, baseWeights.search * MAX_BOOST),
    x: Math.min(effectiveXWeight * renormFactor, baseWeights.x * MAX_BOOST),
  };
  
  const velocityScore = (
    (wikiVelocityScore * velocityWeights.wiki) +
    (newsVelocityScore * velocityWeights.news) +
    (searchVelocityScore * velocityWeights.search) +
    (xVelocityScore * velocityWeights.x)
  );
  
  // =========================================================================
  // 2b. SPIKE DETECTION for dynamic rate limiting
  // =========================================================================
  
  const spikeInputs: SpikeDetectionInputs = {
    wikiCurrent: wikiRaw,
    wikiBaseline: inputs.wikiBaseline || inputs.wikiPageviews7dAvg || wikiRaw,
    newsCurrent: newsRaw,
    newsBaseline: inputs.newsBaseline || newsRaw,
    searchCurrent: searchRaw,
    searchBaseline: inputs.searchBaseline || searchRaw,
  };
  const spikingSourceCount = countSpikingSources(spikeInputs);
  
  // =========================================================================
  // 3. APPLY ANTI-SPAM DAMPING TO VELOCITY
  // =========================================================================
  
  const velocityAdjusted = applyAntiSpamDamping(velocityScore, massScore);
  
  // =========================================================================
  // 3b. APPLY VELOCITY TAPER
  // =========================================================================
  // When news/search signals are low, taper velocity contribution.
  // CRITICAL: Mass stays stable (baseline fame). Velocity is what collapses.
  // This lets celebrities "cool down" naturally after their news cycle ends.
  
  const velocityTaperMultiplier = getVelocityTaperMultiplier(newsRaw, searchRaw);
  const velocityTapered = velocityAdjusted * velocityTaperMultiplier;
  
  // =========================================================================
  // 4. CALCULATE BASE SCORE
  // =========================================================================
  
  const baseScore = (massScore * MASS_ALLOCATION) + (velocityTapered * VELOCITY_ALLOCATION);
  
  // =========================================================================
  // 5. CALCULATE DIVERSITY MULTIPLIER (silent penalty)
  // =========================================================================
  
  // Build platform statuses from inputs if not provided
  // NOTE: Instagram and YouTube are marked as NOT_APPLICABLE until we implement data fetching for them
  // This prevents unfair penalization for platforms we don't yet track
  const platformStatuses: PlatformStatuses = inputs.platformStatuses || {
    wiki: inputs.activePlatforms.wiki ? "ACTIVE" : "NOT_PRESENT",
    x: inputs.activePlatforms.x ? "ACTIVE" : "NOT_PRESENT",
    instagram: "NOT_APPLICABLE", // Not tracking yet - don't penalize
    youtube: "NOT_APPLICABLE",   // Not tracking yet - don't penalize
    news: "ACTIVE",              // News is always a data source (even if 0)
    search: "ACTIVE",            // Search is always a data source (even if 0)
  };
  
  const diversityMultiplier = calculateDiversityMultiplier(platformStatuses);
  
  // =========================================================================
  // 6. CALCULATE FINAL SCORES
  // =========================================================================
  
  const finalScoreRaw = baseScore * diversityMultiplier;
  
  // Fame Index (0-1,000,000) - the primary UI number
  // Multiplied by 10000 for greater variance and prediction difficulty
  let fameIndex = clamp(Math.round(finalScoreRaw * 10000), 0, 1000000);
  const rawFameIndex = fameIndex; // Store raw value for logging
  
  // Apply stabilization in order:
  // 1. Dynamic rate limiting (cap varies by source corroboration + recalibration + recovery)
  //    - 0-1 sources spiking: 5% cap (10% in recalibration)
  //    - 2 sources spiking: 18% cap (36% in recalibration) - faster rise for corroborated trends
  //    - 3 sources spiking: 35% cap (50% in recalibration) - explosive viral events
  //    - Recovery mode: boost cap when API data returns after failure
  // 2. Dynamic EMA smoothing - alpha varies by spike count + recalibration
  //    - 0-1 sources: 0.08 (0.10 in recalibration)
  //    - 2 sources: 0.12 (0.15 in recalibration)
  //    - 3 sources: 0.18 (0.225 in recalibration)
  
  // Detect data recovery (fresh API data after period of fallback/missing data)
  // Recovery mode allows faster score changes when data sources "come back"
  let recoveringSources = 0;
  
  // News is recovering if: current data is fresh AND previous was likely fallback/missing
  // "Likely fallback" = previous value was very low (<5) OR current is significantly higher
  if (inputs.newsIsFresh && (inputs.newsCount || 0) >= 5) {
    const prevNews = inputs.prevNewsCount ?? 0;
    // Recovery if: previous was very low OR current is 50%+ higher than previous
    if (prevNews < 5 || (inputs.newsCount || 0) > prevNews * 1.5) {
      recoveringSources++;
    }
  }
  
  // Search is recovering if: current data is fresh AND previous was likely fallback/missing
  if (inputs.searchIsFresh && (inputs.searchVolume || 0) >= 100) {
    const prevSearch = inputs.prevSearchVolume ?? 0;
    // Recovery if: previous was very low OR current is 50%+ higher than previous
    if (prevSearch < 100 || (inputs.searchVolume || 0) > prevSearch * 1.5) {
      recoveringSources++;
    }
  }
  
  const recoveryRateBoost = getRecoveryRateBoost(recoveringSources);
  
  let stabilizationApplied = false;
  let stabDetail: {
    prevFame: number;
    rawFame: number;
    afterRateLimit: number;
    afterEma: number;
    finalFame: number;
    capUsed: number;
    alphaUsed: number;
    asymmetric: boolean;
    rawVsPrevPct: number;
    rateLimitDeltaPct: number;
    emaDeltaPct: number;
    rateLimitStepPct: number;
    emaStepPct: number;
  } | null = null;

  if (previousFameIndex !== undefined) {
    stabilizationApplied = true;
    
    let effectiveCap = getDynamicRateLimit(spikingSourceCount);
    
    if (recoveryRateBoost > 0 && recoveryRateBoost > effectiveCap) {
      effectiveCap = recoveryRateBoost;
    }
    
    const DOWN_CAP_MULTIPLIER = 1.5;
    const maxChangeUp = previousFameIndex * effectiveCap;
    const maxChangeDown = previousFameIndex * effectiveCap * DOWN_CAP_MULTIPLIER;
    const actualChange = fameIndex - previousFameIndex;
    let afterRateLimiting = fameIndex;
    if (actualChange > maxChangeUp) {
      afterRateLimiting = previousFameIndex + maxChangeUp;
    } else if (actualChange < -maxChangeDown) {
      afterRateLimiting = previousFameIndex - maxChangeDown;
    }
    afterRateLimiting = Math.round(afterRateLimiting);
    
    let usedAlpha: number;
    let isAsymmetric = false;
    if (afterRateLimiting < previousFameIndex) {
      const baseAlpha = getDynamicAlpha(spikingSourceCount);
      usedAlpha = Math.min(0.30, baseAlpha * 1.5);
      isAsymmetric = true;
      fameIndex = Math.round((usedAlpha * afterRateLimiting) + ((1 - usedAlpha) * previousFameIndex));
    } else {
      usedAlpha = getDynamicAlpha(spikingSourceCount);
      fameIndex = Math.round(applyDynamicEmaSmoothing(afterRateLimiting, previousFameIndex, spikingSourceCount));
    }

    const prevF = previousFameIndex;
    const rawVsPrevPct = prevF > 0 ? Math.round(((rawFameIndex - prevF) / prevF) * 1000) / 10 : 0;
    const rateLimitDeltaPct = prevF > 0 ? Math.round(((afterRateLimiting - prevF) / prevF) * 1000) / 10 : 0;
    const emaDeltaPct = prevF > 0 ? Math.round(((fameIndex - prevF) / prevF) * 1000) / 10 : 0;
    const rateLimitStepPct = rawFameIndex > 0 ? Math.round(((afterRateLimiting - rawFameIndex) / rawFameIndex) * 1000) / 10 : 0;
    const emaStepPct = afterRateLimiting > 0 ? Math.round(((fameIndex - afterRateLimiting) / afterRateLimiting) * 1000) / 10 : 0;

    stabDetail = {
      prevFame: prevF,
      rawFame: rawFameIndex,
      afterRateLimit: afterRateLimiting,
      afterEma: fameIndex,
      finalFame: fameIndex,
      capUsed: Math.round(effectiveCap * 1000) / 1000,
      alphaUsed: Math.round(usedAlpha * 1000) / 1000,
      asymmetric: isAsymmetric,
      rawVsPrevPct,
      rateLimitDeltaPct,
      emaDeltaPct,
      rateLimitStepPct,
      emaStepPct,
    };
    
    const rawChange = Math.abs((rawFameIndex - previousFameIndex) / previousFameIndex);
    if (rawChange > 0.10) {
      const recalMode = isRecalibrationModeActive() ? ' [RECAL]' : '';
      const recoveryMode = recoveringSources > 0 ? ` [RECOVERY:${recoveringSources}]` : '';
      console.log(`[Stabilization] Raw: ${rawFameIndex}, Prev: ${previousFameIndex}, Final: ${fameIndex} ` +
        `(${Math.round(rawChange * 100)}% raw, ${Math.round(effectiveCap * 100)}% cap, α=${usedAlpha.toFixed(2)}, ` +
        `${spikingSourceCount} spiking)${recalMode}${recoveryMode}`);
    }
  }
  
  // Legacy trend score (large number for backwards compatibility)
  const trendScore = clamp(finalScoreRaw * 10000, 0, 1000000);
  
  // =========================================================================
  // 7. CALCULATE CONFIDENCE (legacy, for backwards compatibility)
  // =========================================================================
  
  const hasWiki = inputs.wikiDelta !== 0 || inputs.wikiPageviews > 0;
  const hasNews = inputs.newsDelta !== 0;
  const hasSearch = inputs.searchDelta !== 0;
  const hasX = inputs.xQuoteVelocity > 0 || inputs.xReplyVelocity > 0;
  
  let dataSourceCount = 0;
  if (hasWiki) dataSourceCount++;
  if (hasNews) dataSourceCount++;
  if (hasSearch) dataSourceCount++;
  if (hasX) dataSourceCount++;
  
  const hasXHandle = inputs.activePlatforms.x;
  const xPenalty = hasXHandle ? 1.0 : MISSING_X_PENALTY;
  
  let confidence = dataSourceCount >= 3 ? 1.3 : 
                   dataSourceCount >= 2 ? 1.0 : 
                   dataSourceCount >= 1 ? 0.8 : 0.6;
  confidence = confidence * xPenalty;
  
  // =========================================================================
  // 8. CALCULATE MOMENTUM & DRIVERS
  // =========================================================================
  
  const avgDelta = (inputs.wikiDelta + inputs.newsDelta + inputs.searchDelta) / 3;
  const momentum = calculateMomentum(velocityScore, avgDelta);
  
  const drivers = generateDrivers(
    inputs.wikiDelta,
    inputs.newsDelta,
    inputs.searchDelta,
    xTotalVelocity
  );
  
  // =========================================================================
  // 9. CALCULATE CHANGES (no random fallback!)
  // =========================================================================
  
  const change24h = previousFameIndex24h && previousFameIndex24h > 0
    ? ((fameIndex - previousFameIndex24h) / previousFameIndex24h) * 100
    : (previousScore 
      ? ((trendScore - previousScore) / previousScore) * 100
      : null);
  
  const change7d = previousFameIndex7d && previousFameIndex7d > 0
    ? ((fameIndex - previousFameIndex7d) / previousFameIndex7d) * 100
    : (previousScore7d
      ? ((trendScore - previousScore7d) / previousScore7d) * 100
      : null);
  
  // =========================================================================
  // 10. RETURN RESULT
  // =========================================================================
  
  return {
    trendScore: Math.round(trendScore),
    fameIndex,
    rawFameIndex,
    wasStabilized: stabilizationApplied,
    stabDetail,
    spikingSourceCount,
    massScore: Math.round(massScore * 100) / 100,
    velocityScore: Math.round(velocityScore * 100) / 100,
    velocityAdjusted: Math.round(velocityAdjusted * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    diversityMultiplier: Math.round(diversityMultiplier * 100) / 100,
    momentum,
    drivers,
    change24h: change24h !== null ? Math.round(change24h * 10) / 10 : null,
    change7d: change7d !== null ? Math.round(change7d * 10) / 10 : null,
  };
}
