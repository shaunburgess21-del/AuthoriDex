import { 
  PLATFORM_WEIGHTS,
  MASS_ALLOCATION,
  VELOCITY_ALLOCATION,
  calculateDiversityMultiplier,
  applyAntiSpamDamping,
  applyEmaSmoothing,
  applyRateLimiting,
  PlatformStatuses,
  ActivePlatforms,
  MISSING_X_PENALTY,
  WIKI_DOMINANCE_CAP,
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
  
  totalFollowers?: number;
  
  activePlatforms: ActivePlatforms;
  
  // New: platform statuses for diversity multiplier
  platformStatuses?: PlatformStatuses;
}

export interface TrendScoreResult {
  trendScore: number;
  fameIndex: number; // 0-1,000,000 normalized score for UI (higher variance for prediction difficulty)
  rawFameIndex: number; // Pre-stabilization fameIndex (for monitoring stats)
  wasStabilized: boolean; // Whether rate limiting/EMA was applied
  massScore: number;
  velocityScore: number;
  velocityAdjusted: number; // After anti-spam damping
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
 */
export function computeTrendScore(
  inputs: TrendInputs,
  previousScore?: number,
  previousScore7d?: number,
  previousFameIndex?: number,
): TrendScoreResult {
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
  // 2. CALCULATE VELOCITY SCORE (0-100)
  // =========================================================================
  
  // Wiki velocity - only if wiki is active
  const wikiVelocityScore = inputs.activePlatforms.wiki 
    ? normalizeVelocity(inputs.wikiDelta) 
    : 0;
  
  // News and search velocities (always available as data sources)
  const newsVelocityScore = normalizeVelocity(inputs.newsDelta);
  const searchVelocityScore = normalizeVelocity(inputs.searchDelta);
  
  // X velocity - only if X handle is present
  const xTotalVelocity = inputs.xQuoteVelocity + inputs.xReplyVelocity;
  const xVelocityScore = inputs.activePlatforms.x 
    ? Math.min(100, xTotalVelocity * 2) 
    : 0;
  
  // Total velocity score with fixed weights (no redistribution for missing platforms)
  const velocityScore = (
    (wikiVelocityScore * PLATFORM_WEIGHTS.velocity.wiki) +
    (newsVelocityScore * PLATFORM_WEIGHTS.velocity.news) +
    (searchVelocityScore * PLATFORM_WEIGHTS.velocity.search) +
    (xVelocityScore * PLATFORM_WEIGHTS.velocity.x)
  );
  
  // =========================================================================
  // 3. APPLY ANTI-SPAM DAMPING TO VELOCITY
  // =========================================================================
  
  const velocityAdjusted = applyAntiSpamDamping(velocityScore, massScore);
  
  // =========================================================================
  // 4. CALCULATE BASE SCORE
  // =========================================================================
  
  const baseScore = (massScore * MASS_ALLOCATION) + (velocityAdjusted * VELOCITY_ALLOCATION);
  
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
  // 1. Rate limiting (±5% cap) - prevents cliff-edge drops from data refresh timing
  // 2. EMA smoothing - creates smooth stock-market-style curves
  let stabilizationApplied = false;
  if (previousFameIndex !== undefined) {
    stabilizationApplied = true;
    // First apply rate limiting to cap the maximum change
    const afterRateLimiting = Math.round(applyRateLimiting(fameIndex, previousFameIndex));
    // Then apply EMA smoothing for gradual transitions
    fameIndex = Math.round(applyEmaSmoothing(afterRateLimiting, previousFameIndex));
    
    // Log significant stabilization events (>10% change would have occurred)
    const rawChange = Math.abs((rawFameIndex - previousFameIndex) / previousFameIndex);
    if (rawChange > 0.10) {
      console.log(`[Stabilization] Raw: ${rawFameIndex}, Prev: ${previousFameIndex}, Final: ${fameIndex} (${Math.round(rawChange * 100)}% capped)`);
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
  
  const change24h = previousScore 
    ? ((trendScore - previousScore) / previousScore) * 100
    : null;
  
  const change7d = previousScore7d
    ? ((trendScore - previousScore7d) / previousScore7d) * 100
    : null;
  
  // =========================================================================
  // 10. RETURN RESULT
  // =========================================================================
  
  return {
    trendScore: Math.round(trendScore),
    fameIndex,
    rawFameIndex, // Pre-stabilization value for monitoring
    wasStabilized: stabilizationApplied,
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
