// ============================================================================
// SCORING ENGINE - Stable Normalization & Weights
// ============================================================================

// Platform weights - FIXED, never redistributed dynamically
// NOTE (Jan 2026): X API removed from trend score engine due to cost constraints.
// X API keys preserved for future Platform Insights feature.
// X weight redistributed to Wiki, News, and Search for velocity.
// For mass, wiki becomes the primary signal when follower data unavailable.
export const PLATFORM_WEIGHTS = {
  mass: {
    wiki: 0.50,      // Increased from 0.30 (primary mass signal without follower data)
    x: 0.00,         // DISABLED - X API removed from trend engine
    instagram: 0.25, // Increased from 0.20 (future placeholder)
    youtube: 0.25,   // Increased from 0.15 (future placeholder)
  },
  velocity: {
    wiki: 0.25,      // Increased from 0.15
    news: 0.35,      // Increased from 0.20
    search: 0.40,    // Increased from 0.25
    x: 0.00,         // DISABLED - X API removed from trend engine
  },
};

// Score composition: 40% mass, 60% velocity (velocity-heavy for "trending" feel)
export const MASS_ALLOCATION = 0.40;
export const VELOCITY_ALLOCATION = 0.60;

// Diversity multiplier thresholds (silent penalty for missing platforms)
// 5/5 sources = 1.00x, 4/5 = 0.90x, 3/5 = 0.78x, 2/5 = 0.62x, 1/5 = 0.40x
export const DIVERSITY_MULTIPLIERS: Record<number, number> = {
  5: 1.00,
  4: 0.90,
  3: 0.78,
  2: 0.62,
  1: 0.40,
  0: 0.20,
};

// Anti-spam damping - prevents nobodies from spamming to top
// VelocityAdjusted = VelocityScore × (0.35 + 0.65 × MassScore)
export const ANTI_SPAM_BASE = 0.35;
export const ANTI_SPAM_MASS_FACTOR = 0.65;

// EMA smoothing alpha - lower = smoother curves (stock market style)
// Default 0.08 provides balanced responsiveness: smooth enough to filter noise,
// fast enough to show real breakouts within hours (not days)
export const EMA_ALPHA_DEFAULT = 0.08;
export const EMA_ALPHA_2_SOURCES = 0.12;  // When 2 sources spike together
export const EMA_ALPHA_3_SOURCES = 0.18;  // When 3 sources spike (genuine viral)

// Rate limiting - maximum change per hour
// Default 5% cap, increases with multi-source breakouts
export const MAX_HOURLY_CHANGE_PERCENT = 0.05;

// Legacy constant for backwards compatibility
export const EMA_ALPHA = EMA_ALPHA_DEFAULT;

// ============================================================================
// RECALIBRATION MODE - Temporary boost after scoring model changes
// ============================================================================

// Set this to the timestamp when the scoring model was last changed.
// For 48 hours after this date, use boosted caps/alpha to speed up transition.
export const RECALIBRATION_START = new Date('2026-02-02T17:00:00Z');
export const RECALIBRATION_DURATION_HOURS = 48;

/**
 * Check if we're currently in recalibration mode.
 * Active for 48 hours after a scoring model change.
 */
export function isRecalibrationModeActive(): boolean {
  const now = new Date();
  const endTime = new Date(RECALIBRATION_START.getTime() + RECALIBRATION_DURATION_HOURS * 60 * 60 * 1000);
  return now >= RECALIBRATION_START && now < endTime;
}

/**
 * Get boosted rate limit for recalibration mode.
 * During recalibration, double the default cap.
 */
export function getRecalibrationRateBoost(normalCap: number): number {
  if (isRecalibrationModeActive()) {
    return Math.min(normalCap * 2, 0.25); // Max 25% even in recalibration
  }
  return normalCap;
}

/**
 * Get boosted alpha for recalibration mode.
 * During recalibration, slightly increase responsiveness.
 */
export function getRecalibrationAlphaBoost(normalAlpha: number): number {
  if (isRecalibrationModeActive()) {
    return Math.min(normalAlpha * 1.25, 0.25); // Boost by 25%, max 0.25
  }
  return normalAlpha;
}

// Sanity check thresholds
export const FOLLOWER_DROP_THRESHOLD = 0.50; // Reject if drops >50%

// ============================================================================
// PLATFORM STATUS TYPES
// ============================================================================

export type PlatformStatusValue = "ACTIVE" | "NOT_PRESENT" | "NOT_APPLICABLE" | "TEMP_FAIL";

export interface PlatformStatuses {
  wiki: PlatformStatusValue;
  x: PlatformStatusValue;
  instagram: PlatformStatusValue;
  youtube: PlatformStatusValue;
  news: PlatformStatusValue;
  search: PlatformStatusValue;
}

// For backwards compatibility
export interface ActivePlatforms {
  wiki: boolean;
  x: boolean;
  instagram: boolean;
  youtube: boolean;
}

// ============================================================================
// DIVERSITY MULTIPLIER
// ============================================================================

/**
 * Calculates the diversity multiplier based on active platform count.
 * This silently penalizes celebrities with fewer data sources without showing badges.
 */
export function calculateDiversityMultiplier(platformStatuses: PlatformStatuses): number {
  let activeCount = 0;
  let applicableCount = 0;
  
  for (const [, status] of Object.entries(platformStatuses)) {
    if (status !== "NOT_APPLICABLE") {
      applicableCount++;
      if (status === "ACTIVE" || status === "TEMP_FAIL") {
        // TEMP_FAIL counts as active because we fill-forward
        activeCount++;
      }
    }
  }
  
  if (applicableCount === 0) return DIVERSITY_MULTIPLIERS[0];
  
  // Normalize to 5-point scale
  const normalizedRatio = Math.round((activeCount / applicableCount) * 5);
  return DIVERSITY_MULTIPLIERS[normalizedRatio] ?? DIVERSITY_MULTIPLIERS[0];
}

/**
 * Apply anti-spam damping to velocity score.
 * This prevents low-mass celebrities from gaming their way to the top.
 */
export function applyAntiSpamDamping(velocityScore: number, massScore: number): number {
  // Normalize massScore to 0-1 range (assuming 0-100 input)
  const normalizedMass = Math.min(1, Math.max(0, massScore / 100));
  const dampingFactor = ANTI_SPAM_BASE + (ANTI_SPAM_MASS_FACTOR * normalizedMass);
  return velocityScore * dampingFactor;
}

/**
 * Apply EMA smoothing to a new score (legacy version with fixed alpha).
 */
export function applyEmaSmoothing(newScore: number, previousScore: number | null): number {
  if (previousScore === null) return newScore;
  return (EMA_ALPHA * newScore) + ((1 - EMA_ALPHA) * previousScore);
}

/**
 * Get dynamic EMA alpha based on number of spiking sources.
 * More sources spiking = faster response (higher alpha).
 * Also applies recalibration boost if active.
 */
export function getDynamicAlpha(spikingCount: number): number {
  let baseAlpha: number;
  switch (spikingCount) {
    case 3:
      baseAlpha = EMA_ALPHA_3_SOURCES; // 0.18
      break;
    case 2:
      baseAlpha = EMA_ALPHA_2_SOURCES; // 0.12
      break;
    default:
      baseAlpha = EMA_ALPHA_DEFAULT;   // 0.08
  }
  return getRecalibrationAlphaBoost(baseAlpha);
}

/**
 * Apply EMA smoothing with dynamic alpha based on spike count.
 * Higher alpha = faster response to changes.
 */
export function applyDynamicEmaSmoothing(
  newScore: number, 
  previousScore: number | null,
  spikingCount: number
): number {
  if (previousScore === null) return newScore;
  const alpha = getDynamicAlpha(spikingCount);
  return (alpha * newScore) + ((1 - alpha) * previousScore);
}

/**
 * Apply rate limiting to prevent sudden large changes.
 * Limits the change per update to ±MAX_HOURLY_CHANGE_PERCENT of the previous score.
 */
export function applyRateLimiting(newScore: number, previousScore: number | null): number {
  if (previousScore === null || previousScore === 0) return newScore;
  
  const maxChange = previousScore * MAX_HOURLY_CHANGE_PERCENT;
  const actualChange = newScore - previousScore;
  
  if (actualChange > maxChange) {
    // Cap upward movement
    return previousScore + maxChange;
  } else if (actualChange < -maxChange) {
    // Cap downward movement
    return previousScore - maxChange;
  }
  
  return newScore;
}

// ============================================================================
// SOURCE NORMALIZATION - log1p + percentile ranking
// ============================================================================

/**
 * Statistics for a single data source across the top 100 over 7 days.
 * Used to compute percentile-based normalization.
 */
export interface SourceStats {
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
  count: number;
}

/**
 * All source statistics for normalization.
 */
export interface AllSourceStats {
  wiki: SourceStats;
  news: SourceStats;
  search: SourceStats;
}

/**
 * Apply log1p transformation to compress extreme values.
 * log1p(x) = ln(1 + x), handles 0 gracefully.
 */
export function logTransform(value: number): number {
  return Math.log1p(Math.max(0, value));
}

/**
 * Compute percentile rank of a value given source statistics.
 * Returns 0-1 where 1 = highest percentile.
 * Uses linear interpolation between percentile thresholds.
 */
export function computePercentileRank(logValue: number, stats: SourceStats): number {
  if (stats.count === 0 || stats.max === stats.min) return 0.5;
  
  const logMin = logTransform(stats.min);
  const logMax = logTransform(stats.max);
  const logP25 = logTransform(stats.p25);
  const logP50 = logTransform(stats.p50);
  const logP75 = logTransform(stats.p75);
  const logP90 = logTransform(stats.p90);
  
  // Linear interpolation between known percentile thresholds
  if (logValue <= logMin) return 0;
  if (logValue >= logMax) return 1;
  
  if (logValue <= logP25) {
    return 0 + 0.25 * ((logValue - logMin) / (logP25 - logMin || 1));
  } else if (logValue <= logP50) {
    return 0.25 + 0.25 * ((logValue - logP25) / (logP50 - logP25 || 1));
  } else if (logValue <= logP75) {
    return 0.50 + 0.25 * ((logValue - logP50) / (logP75 - logP50 || 1));
  } else if (logValue <= logP90) {
    return 0.75 + 0.15 * ((logValue - logP75) / (logP90 - logP75 || 1));
  } else {
    return 0.90 + 0.10 * ((logValue - logP90) / (logMax - logP90 || 1));
  }
}

/**
 * Normalize a raw source value to 0-1 using log1p + percentile ranking.
 * This makes different sources (wiki, news, search) comparable before weighting.
 */
export function normalizeSourceValue(rawValue: number, stats: SourceStats): number {
  const logValue = logTransform(rawValue);
  return computePercentileRank(logValue, stats);
}

/**
 * Default stats to use when no historical data available.
 * These are reasonable approximations based on observed data ranges.
 */
export const DEFAULT_SOURCE_STATS: AllSourceStats = {
  wiki: {
    min: 1000,
    max: 5000000,
    p25: 10000,
    p50: 50000,
    p75: 200000,
    p90: 500000,
    mean: 150000,
    count: 100,
  },
  news: {
    min: 0,
    max: 1000,
    p25: 5,
    p50: 20,
    p75: 80,
    p90: 200,
    mean: 50,
    count: 100,
  },
  search: {
    min: 0,
    max: 50000,
    p25: 100,
    p50: 500,
    p75: 2000,
    p90: 10000,
    mean: 2000,
    count: 100,
  },
};

// ============================================================================
// MULTI-SOURCE BREAKOUT DETECTION
// ============================================================================

// Minimum absolute deltas to qualify as a spike (prevents noise on low-volume accounts)
// These thresholds ensure only meaningful changes trigger breakout mode
export const SPIKE_MIN_DELTA = {
  wiki: 5000,    // At least 5K pageview increase
  news: 10,      // At least 10 new articles
  search: 500,   // At least 500 search volume increase
};

/**
 * Detect if a source is "spiking" - current value significantly above baseline.
 * A spike requires BOTH:
 * 1. current > threshold × baseline (relative change)
 * 2. current - baseline > minDelta (absolute change to filter noise)
 * 
 * Using median (p50) baseline is more robust than mean against outliers.
 */
export function isSourceSpiking(
  currentValue: number, 
  baselineMedian: number, 
  threshold: number = 1.5,
  minDelta: number = 0
): boolean {
  if (baselineMedian <= 0) return false;
  const relativeSpike = currentValue > baselineMedian * threshold;
  const absoluteSpike = (currentValue - baselineMedian) >= minDelta;
  return relativeSpike && absoluteSpike;
}

/**
 * Count how many sources are spiking simultaneously.
 * Uses median (p50) baselines and minimum delta requirements for robustness.
 */
export interface SpikeDetectionInputs {
  wikiCurrent: number;
  wikiBaseline: number;  // Should be p50 (median), not mean
  newsCurrent: number;
  newsBaseline: number;  // Should be p50 (median), not mean
  searchCurrent: number;
  searchBaseline: number;  // Should be p50 (median), not mean
}

export function countSpikingSources(inputs: SpikeDetectionInputs, threshold: number = 1.5): number {
  let count = 0;
  if (isSourceSpiking(inputs.wikiCurrent, inputs.wikiBaseline, threshold, SPIKE_MIN_DELTA.wiki)) count++;
  if (isSourceSpiking(inputs.newsCurrent, inputs.newsBaseline, threshold, SPIKE_MIN_DELTA.news)) count++;
  if (isSourceSpiking(inputs.searchCurrent, inputs.searchBaseline, threshold, SPIKE_MIN_DELTA.search)) count++;
  return count;
}

/**
 * Get dynamic rate limit based on source corroboration.
 * More sources spiking = higher allowed change rate.
 * Also applies recalibration boost if active.
 */
export function getDynamicRateLimit(spikingCount: number): number {
  let baseCap: number;
  switch (spikingCount) {
    case 3:
      baseCap = 0.25; // 25% - all three sources agree
      break;
    case 2:
      baseCap = 0.10; // 10% - two sources corroborate
      break;
    default:
      baseCap = MAX_HOURLY_CHANGE_PERCENT; // 5% - default
  }
  return getRecalibrationRateBoost(baseCap);
}

/**
 * Apply rate limiting with dynamic cap based on corroboration.
 * Limits the change per update based on how many sources are spiking together.
 */
export function applyDynamicRateLimiting(
  newScore: number, 
  previousScore: number | null,
  spikingCount: number
): number {
  if (previousScore === null || previousScore === 0) return newScore;
  
  const dynamicCap = getDynamicRateLimit(spikingCount);
  const maxChange = previousScore * dynamicCap;
  const actualChange = newScore - previousScore;
  
  if (actualChange > maxChange) {
    return previousScore + maxChange;
  } else if (actualChange < -maxChange) {
    return previousScore - maxChange;
  }
  
  return newScore;
}

// ============================================================================
// BACKWARDS COMPATIBILITY - Legacy functions
// ============================================================================

export interface StandardWeights {
  mass: {
    wiki: number;
    x: number;
    instagram: number;
    youtube: number;
  };
  velocity: {
    wikiDelta: number;
    newsDelta: number;
    searchDelta: number;
    xVelocity: number;
  };
}

export const STANDARD_WEIGHTS: StandardWeights = {
  mass: PLATFORM_WEIGHTS.mass,
  velocity: {
    wikiDelta: PLATFORM_WEIGHTS.velocity.wiki,
    newsDelta: PLATFORM_WEIGHTS.velocity.news,
    searchDelta: PLATFORM_WEIGHTS.velocity.search,
    xVelocity: PLATFORM_WEIGHTS.velocity.x,
  },
};

// Legacy constants
export const MISSING_X_PENALTY = 0.6;
export const WIKI_DOMINANCE_CAP = 0.4;

export interface AdjustedMassWeights {
  wiki: number;
  x: number;
  instagram: number;
  youtube: number;
}

export interface AdjustedVelocityWeights {
  wikiDelta: number;
  newsDelta: number;
  searchDelta: number;
  xVelocity: number;
}

/**
 * @deprecated Use fixed weights with diversity multiplier instead.
 * Kept for backwards compatibility during migration.
 */
export function calculateDynamicMassWeights(
  activePlatforms: ActivePlatforms
): AdjustedMassWeights {
  // Now returns fixed weights - no more redistribution
  return {
    wiki: PLATFORM_WEIGHTS.mass.wiki,
    x: activePlatforms.x ? PLATFORM_WEIGHTS.mass.x : 0,
    instagram: activePlatforms.instagram ? PLATFORM_WEIGHTS.mass.instagram : 0,
    youtube: activePlatforms.youtube ? PLATFORM_WEIGHTS.mass.youtube : 0,
  };
}

/**
 * @deprecated Use fixed weights with diversity multiplier instead.
 * Kept for backwards compatibility during migration.
 */
export function calculateDynamicVelocityWeights(
  hasWiki: boolean,
  hasNews: boolean,
  hasSearch: boolean,
  hasX: boolean
): AdjustedVelocityWeights {
  // Now returns fixed weights - no more redistribution
  return {
    wikiDelta: PLATFORM_WEIGHTS.velocity.wiki,
    newsDelta: PLATFORM_WEIGHTS.velocity.news,
    searchDelta: PLATFORM_WEIGHTS.velocity.search,
    xVelocity: PLATFORM_WEIGHTS.velocity.x,
  };
}
