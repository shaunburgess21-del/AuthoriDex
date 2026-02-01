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
// 0.04 provides gentle transitions for stock-market-style curves
export const EMA_ALPHA = 0.04;

// Rate limiting - maximum change per hour (±5%)
// Prevents cliff-edge drops from data refresh timing
export const MAX_HOURLY_CHANGE_PERCENT = 0.05;

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
 * Apply EMA smoothing to a new score.
 */
export function applyEmaSmoothing(newScore: number, previousScore: number | null): number {
  if (previousScore === null) return newScore;
  return (EMA_ALPHA * newScore) + ((1 - EMA_ALPHA) * previousScore);
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
