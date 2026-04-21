// ============================================================================
// SCORING ENGINE - Stable Normalization & Weights
// ============================================================================

export const SCORE_VERSION = "v2";

// Platform weights - FIXED, never redistributed dynamically
// NOTE (Jan 2026): X API removed from trend score engine due to cost constraints.
// X API keys preserved for future Platform Insights feature.
// X weight redistributed to Wiki, News, and Search for velocity.
// For mass, wiki becomes the primary signal when follower data unavailable.
// Mar 2026: Rebalanced — Wiki raised from 0.25 to 0.30 to reflect its increased
// importance as the sole public-curiosity-depth signal after X removal.
// Search reduced from 0.40 to 0.35 to equal News. Both are leading indicators.
export const PLATFORM_WEIGHTS = {
  mass: {
    wiki: 0.50,
    instagram: 0.25,
    youtube: 0.25,
  },
  velocity: {
    wiki: 0.30,
    news: 0.35,
    search: 0.35,
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
// Configurable via environment variables for live tuning without code changes.
// v2 tuning: conservative 25% increase from original 0.12 base.
const parseEnvFloat = (key: string, fallback: number): number => {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback : parsed;
};

export const EMA_ALPHA_DEFAULT = parseEnvFloat('EMA_BASE_ALPHA', 0.22);
export const EMA_ALPHA_2_SOURCES = parseEnvFloat('EMA_2_SOURCE_ALPHA', 0.22);
export const EMA_ALPHA_3_SOURCES = parseEnvFloat('EMA_3_SOURCE_ALPHA', 0.28);
export const EMA_HIGH_BASELINE_MIN_ALPHA = parseEnvFloat('EMA_HIGH_BASELINE_MIN_ALPHA', 0.20);
export const EMA_HIGH_BASELINE_VELOCITY_THRESHOLD = parseEnvFloat('EMA_HIGH_BASELINE_VELOCITY_THRESHOLD', 65);
export const EMA_HIGH_BASELINE_MIN_STRONG_SOURCES = parseEnvFloat('EMA_HIGH_BASELINE_MIN_STRONG_SOURCES', 2);
export const EMA_DOWNWARD_MULTIPLIER = parseEnvFloat('EMA_DOWNWARD_MULTIPLIER', 1.1);

// Rate limiting - maximum change per hour
// Default 12% cap (relaxed from 8%), increases with multi-source breakouts
// Target: <25% of population rate-limited in steady state
export const MAX_HOURLY_CHANGE_PERCENT = 0.12;

// Legacy constant for backwards compatibility
export const EMA_ALPHA = EMA_ALPHA_DEFAULT;

// ============================================================================
// SMOOTHING MODE - Live-tunable dampening envelope
// ============================================================================
// Apr 2026: Smoothing was originally added when API providers were noisy and
// erratic. The APIs are now stable, so the dampening is actively delaying
// legitimate breaking-news moves (e.g. Tim Cook/Apple CEO departure) and
// letting cooled-off stories linger.
//
// SMOOTHING_MODE lets us flip behaviour without a redeploy:
//   - "legacy"  = original full dampening envelope (rate-limit + EMA). Default.
//   - "relaxed" = doubles rate caps and raises alpha floor to 0.40.
//   - "off"     = no rate-limit, no EMA. Raw fameIndex goes straight to the DB.
//                 Anti-spam damping, velocity taper, diversity multiplier,
//                 percentile normalization and catch-up mode all stay ON.
//
// Relaxed multipliers compose cleanly with catch-up/recalibration boosts.

export type SmoothingMode = "legacy" | "relaxed" | "off";

export const RELAXED_CAP_MULTIPLIER = parseEnvFloat("SMOOTHING_RELAXED_CAP_MULTIPLIER", 2.0);
export const RELAXED_ALPHA_FLOOR = parseEnvFloat("SMOOTHING_RELAXED_ALPHA_FLOOR", 0.40);

/**
 * Read the current smoothing mode from env. Default is "legacy" for safety.
 * Unknown values fall back to "legacy" so a typo can never silently disable
 * stabilization in production.
 */
export function getSmoothingMode(): SmoothingMode {
  const raw = (process.env.SMOOTHING_MODE ?? "legacy").trim().toLowerCase();
  if (raw === "off" || raw === "relaxed") return raw;
  return "legacy";
}

// ============================================================================
// NEWS AGGREGATION MODE - Multi-source news count vs tiered fallback
// ============================================================================
// "tiered" = legacy behaviour. Mediastack primary, GDELT fallback, Serper News
//            emergency fallback. Exactly one provider wins per run.
// "union"  = new multi-source mode. All three providers called in parallel,
//            URLs deduplicated, finalCount = max(mediastackPaginationTotal,
//            unionCount). Preserves Mediastack's uncapped signal for
//            mega-stories and captures articles other providers catch that
//            Mediastack missed.
//
// Default is "tiered" for zero-risk rollout. Flip to "union" via
// NEWS_AGGREGATION_MODE env var on Railway; no redeploy required.

export type NewsAggregationMode = "tiered" | "union";

export function getNewsAggregationMode(): NewsAggregationMode {
  const raw = (process.env.NEWS_AGGREGATION_MODE ?? "tiered").trim().toLowerCase();
  return raw === "union" ? "union" : "tiered";
}

/**
 * Timestamp of when NEWS_AGGREGATION_MODE was flipped from tiered to union.
 * When set, the momentum-signal percentile calibration (p25/p75 used for the
 * Low/Medium/High traffic lights) will only include news snapshots from AFTER
 * this cutoff — so the tiered-era (lower) counts don't skew the denominator
 * during the 14-day transition window, which would otherwise make everyone
 * look "High" until the rolling window caught up.
 *
 * Set as an ISO 8601 string on Railway, e.g.:
 *   NEWS_AGGREGATION_FLIPPED_AT=2026-04-21T14:30:00Z
 * Returns null if unset, blank, or unparseable.
 *
 * Only affects news percentiles — wiki and search continue to use the full
 * 14-day rolling window since their data pipelines didn't change.
 */
export function getNewsAggregationFlippedAt(): Date | null {
  const raw = (process.env.NEWS_AGGREGATION_FLIPPED_AT ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    console.warn(`[normalize] NEWS_AGGREGATION_FLIPPED_AT value "${raw}" is not a valid ISO timestamp, ignoring`);
    return null;
  }
  return parsed;
}

/**
 * Whether to emit the verbose per-snapshot union-mode diagnostics block
 * (`diagnostics.fresh.newsUnion`). Defaults to `true` during the union-mode
 * calibration period so we can spot baseline drift / provider skew per person.
 * Set DIAGNOSTICS_VERBOSE=false on Railway once the calibration is done to
 * shrink the `trend_snapshots.diagnostics` payload (~150 bytes per snapshot).
 */
export function isDiagnosticsVerbose(): boolean {
  const raw = (process.env.DIAGNOSTICS_VERBOSE ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

/**
 * Rolling percentile-window size, in days, used for Momentum Signals traffic
 * lights AND for the `normalizeSourceValue()` mapping from raw provider values
 * → 0..1 importance scores that feed `fameIndex`.
 *
 * Two independent windows:
 *  - `baseline` (default 14) applies to Wikipedia pageviews + Serper search
 *    volume. These have slower natural decay and benefit from a longer window
 *    for statistical stability.
 *  - `news` (default 7) applies to news_count. News cycles are fast and the
 *    baseline drifts quickly — a shorter window lets trending people cool off
 *    faster and prevents stale stories from dragging `p75` upward for weeks.
 *
 * Both clamped to [3, 30]. Returns the default if unset / invalid.
 */
function parseWindowDays(raw: string | undefined, fallback: number): number {
  const parsed = parseInt((raw ?? "").trim(), 10);
  if (Number.isNaN(parsed) || parsed < 3 || parsed > 30) return fallback;
  return parsed;
}
export function getRollingWindowDaysBaseline(): number {
  return parseWindowDays(process.env.ROLLING_WINDOW_DAYS_BASELINE, 14);
}
export function getRollingWindowDaysNews(): number {
  return parseWindowDays(process.env.ROLLING_WINDOW_DAYS_NEWS, 7);
}

// ============================================================================
// AUTO CATCH-UP MODE - Gap-driven dynamic rate boosting (DB-persisted)
// ============================================================================
// When the median gap between raw and final scores exceeds a threshold,
// the system enters catch-up mode with higher caps and alpha to let scores
// converge to reality. Exits automatically when gap is low for consecutive runs.
// State is persisted to DB (api_cache) so restarts don't reset the streak.

export const CATCHUP_FULL_ENTER_THRESHOLD = 0.10;  // Enter FULL when medianGapPct > 10%
export const CATCHUP_SOFT_ENTER_THRESHOLD = 0.06;  // Enter SOFT when medianGapPct > 6%
export const CATCHUP_EXIT_THRESHOLD = 0.04;         // Exit when medianGapPct < 4%
export const CATCHUP_EXIT_CONSECUTIVE = 2;           // Must be below exit threshold for 2 runs

export const CATCHUP_FULL_CAP_MULTIPLIER = 2.5;     // Multiply caps by 2.5x during full catch-up
export const CATCHUP_FULL_ALPHA_MULTIPLIER = 1.8;   // Multiply alpha by 1.8x during full catch-up
export const CATCHUP_SOFT_CAP_MULTIPLIER = 1.4;     // Multiply caps by 1.4x during soft catch-up
export const CATCHUP_SOFT_ALPHA_MULTIPLIER = 1.2;   // Multiply alpha by 1.2x during soft catch-up

export type CatchUpBand = "OFF" | "SOFT" | "FULL";

const CATCHUP_CACHE_KEY = "system:catchup_state";

interface CatchUpState {
  active: boolean;
  band: CatchUpBand;
  exitStreak: number;
  enteredAtHour: string | null;
  lastUpdated: string;
}

let catchUpBand: CatchUpBand = "OFF";
let consecutiveBelowExitCount = 0;
let catchUpEnteredAtHour: string | null = null;
let catchUpStateLoaded = false;

export function isCatchUpModeActive(): boolean {
  return catchUpBand !== "OFF";
}

export function getCatchUpBand(): CatchUpBand {
  return catchUpBand;
}

export function getCatchUpExitStreak(): number {
  return consecutiveBelowExitCount;
}

export function getCatchUpEnteredAtHour(): string | null {
  return catchUpEnteredAtHour;
}

export async function loadCatchUpStateFromDB(): Promise<void> {
  try {
    const { db } = await import("../db");
    const { apiCache } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const cached = await db.query.apiCache.findFirst({
      where: eq(apiCache.cacheKey, CATCHUP_CACHE_KEY),
    });

    if (cached) {
      const state: CatchUpState = JSON.parse(cached.responseData);
      catchUpBand = state.band || (state.active ? "FULL" : "OFF");
      consecutiveBelowExitCount = state.exitStreak;
      catchUpEnteredAtHour = state.enteredAtHour;
      catchUpStateLoaded = true;
      console.log(`[CatchUp] Loaded persisted state: band=${catchUpBand}, exitStreak=${state.exitStreak}, enteredAt=${state.enteredAtHour}`);
    } else {
      catchUpStateLoaded = true;
      console.log(`[CatchUp] No persisted state found, starting fresh`);
    }
  } catch (err) {
    console.error(`[CatchUp] Failed to load persisted state, using defaults:`, err);
    catchUpStateLoaded = true;
  }
}

async function persistCatchUpStateToDB(): Promise<void> {
  try {
    const { db } = await import("../db");
    const { apiCache } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const state: CatchUpState = {
      active: catchUpBand !== "OFF",
      band: catchUpBand,
      exitStreak: consecutiveBelowExitCount,
      enteredAtHour: catchUpEnteredAtHour,
      lastUpdated: new Date().toISOString(),
    };

    const existing = await db.query.apiCache.findFirst({
      where: eq(apiCache.cacheKey, CATCHUP_CACHE_KEY),
    });

    if (existing) {
      await db.update(apiCache)
        .set({
          responseData: JSON.stringify(state),
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        })
        .where(eq(apiCache.cacheKey, CATCHUP_CACHE_KEY));
    } else {
      await db.insert(apiCache).values({
        cacheKey: CATCHUP_CACHE_KEY,
        provider: "system",
        responseData: JSON.stringify(state),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
    }
  } catch (err) {
    console.error(`[CatchUp] Failed to persist state to DB:`, err);
  }
}

export async function updateCatchUpMode(medianGapPct: number): Promise<{ band: CatchUpBand; changed: boolean }> {
  if (!catchUpStateLoaded) {
    await loadCatchUpStateFromDB();
  }

  const previousBand = catchUpBand;

  if (catchUpBand === "OFF") {
    if (medianGapPct > CATCHUP_FULL_ENTER_THRESHOLD) {
      catchUpBand = "FULL";
      consecutiveBelowExitCount = 0;
      catchUpEnteredAtHour = new Date().toISOString();
      console.log(`[CatchUp] ENTERING FULL catch-up (medianGap=${(medianGapPct * 100).toFixed(1)}% > ${(CATCHUP_FULL_ENTER_THRESHOLD * 100).toFixed(0)}% threshold)`);
    } else if (medianGapPct > CATCHUP_SOFT_ENTER_THRESHOLD) {
      catchUpBand = "SOFT";
      consecutiveBelowExitCount = 0;
      catchUpEnteredAtHour = new Date().toISOString();
      console.log(`[CatchUp] ENTERING SOFT catch-up (medianGap=${(medianGapPct * 100).toFixed(1)}% in ${(CATCHUP_SOFT_ENTER_THRESHOLD * 100).toFixed(0)}%-${(CATCHUP_FULL_ENTER_THRESHOLD * 100).toFixed(0)}% band)`);
    }
  } else {
    if (medianGapPct < CATCHUP_EXIT_THRESHOLD) {
      consecutiveBelowExitCount++;
      if (consecutiveBelowExitCount >= CATCHUP_EXIT_CONSECUTIVE) {
        catchUpBand = "OFF";
        consecutiveBelowExitCount = 0;
        catchUpEnteredAtHour = null;
        console.log(`[CatchUp] EXITING catch-up (medianGap=${(medianGapPct * 100).toFixed(1)}% < ${(CATCHUP_EXIT_THRESHOLD * 100).toFixed(0)}% for ${CATCHUP_EXIT_CONSECUTIVE} runs)`);
      } else {
        console.log(`[CatchUp] Below exit threshold (${consecutiveBelowExitCount}/${CATCHUP_EXIT_CONSECUTIVE} consecutive)`);
      }
    } else {
      consecutiveBelowExitCount = 0;
      if (catchUpBand === "SOFT" && medianGapPct > CATCHUP_FULL_ENTER_THRESHOLD) {
        catchUpBand = "FULL";
        console.log(`[CatchUp] ESCALATING to FULL catch-up (medianGap=${(medianGapPct * 100).toFixed(1)}% > ${(CATCHUP_FULL_ENTER_THRESHOLD * 100).toFixed(0)}%)`);
      } else if (catchUpBand === "FULL" && medianGapPct < CATCHUP_FULL_ENTER_THRESHOLD) {
        catchUpBand = "SOFT";
        console.log(`[CatchUp] DE-ESCALATING to SOFT catch-up (medianGap=${(medianGapPct * 100).toFixed(1)}% < ${(CATCHUP_FULL_ENTER_THRESHOLD * 100).toFixed(0)}%)`);
      }
    }
  }

  await persistCatchUpStateToDB();

  return { band: catchUpBand, changed: catchUpBand !== previousBand };
}

export function getCatchUpCapMultiplier(): number {
  switch (catchUpBand) {
    case "FULL": return CATCHUP_FULL_CAP_MULTIPLIER;
    case "SOFT": return CATCHUP_SOFT_CAP_MULTIPLIER;
    default: return 1.0;
  }
}

export function getCatchUpAlphaMultiplier(): number {
  switch (catchUpBand) {
    case "FULL": return CATCHUP_FULL_ALPHA_MULTIPLIER;
    case "SOFT": return CATCHUP_SOFT_ALPHA_MULTIPLIER;
    default: return 1.0;
  }
}

// ============================================================================
// RECALIBRATION MODE - Temporary boost after scoring model changes
// ============================================================================

// Set this to the timestamp when the scoring model was last changed.
// For 48 hours after this date, use boosted caps/alpha to speed up transition.
// DISABLED: Set to past date to use normal 10% rate caps for stability
export const RECALIBRATION_START = new Date('2026-01-01T00:00:00Z');
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
    return Math.min(normalCap * 2, 0.50); // Max 50% in recalibration for multi-source corroboration
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
  instagram: PlatformStatusValue;
  youtube: PlatformStatusValue;
  news: PlatformStatusValue;
  search: PlatformStatusValue;
}

// For backwards compatibility
export interface ActivePlatforms {
  wiki: boolean;
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

export interface VelocitySubScores {
  wiki: number;
  news: number;
  search: number;
}

/**
 * Get dynamic EMA alpha based on number of spiking sources.
 * More sources spiking = faster response (higher alpha).
 * Also applies recalibration and catch-up boosts if active.
 * 
 * High-baseline boost (v2): Only activates when BOTH conditions are met:
 *   1. Aggregate velocityScore >= threshold (default 65)
 *   2. At least N sub-scores (wiki/news/search) are above 50 (default N=2)
 * This ensures only genuinely high-baseline people (strong across multiple signals)
 * get faster smoothing, not mid-tier people with one strong source.
 */
export function getDynamicAlpha(spikingCount: number, velocityScore?: number, subScores?: VelocitySubScores): number {
  let baseAlpha: number;
  switch (spikingCount) {
    case 3:
      baseAlpha = EMA_ALPHA_3_SOURCES;
      break;
    case 2:
      baseAlpha = EMA_ALPHA_2_SOURCES;
      break;
    default:
      baseAlpha = EMA_ALPHA_DEFAULT;
  }
  if (velocityScore !== undefined && velocityScore >= EMA_HIGH_BASELINE_VELOCITY_THRESHOLD && subScores) {
    const strongSourceCount = [subScores.wiki, subScores.news, subScores.search]
      .filter(s => s >= 50).length;
    if (strongSourceCount >= EMA_HIGH_BASELINE_MIN_STRONG_SOURCES) {
      baseAlpha = Math.max(baseAlpha, EMA_HIGH_BASELINE_MIN_ALPHA);
    }
  }
  // Relaxed smoothing mode: raise the alpha floor so EMA pulls harder toward
  // the new value. Applied before catch-up/recalibration so those still stack.
  const mode = getSmoothingMode();
  if (mode === "relaxed") {
    baseAlpha = Math.max(baseAlpha, RELAXED_ALPHA_FLOOR);
  }
  const recalBoosted = getRecalibrationAlphaBoost(baseAlpha);
  // Legacy keeps the historical 0.40 ceiling; relaxed opens it to 0.60 so the
  // higher floor + catch-up multiplier can actually translate into motion.
  const cap = mode === "relaxed" ? 0.60 : 0.40;
  return Math.min(recalBoosted * getCatchUpAlphaMultiplier(), cap);
}

/**
 * Apply EMA smoothing with dynamic alpha based on spike count.
 * Higher alpha = faster response to changes.
 */
export function applyDynamicEmaSmoothing(
  newScore: number, 
  previousScore: number | null,
  spikingCount: number,
  velocityScore?: number,
  subScores?: VelocitySubScores
): number {
  if (previousScore === null) return newScore;
  const alpha = getDynamicAlpha(spikingCount, velocityScore, subScores);
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
  /**
   * Number of snapshots used to compute the percentiles. Normally reflects the
   * full 14-day rolling window. For the `news` source only, this may reflect a
   * shorter post-flip window when NEWS_AGGREGATION_FLIPPED_AT is set — see
   * `server/scoring/sourceStats.ts`. `wiki.count` and `search.count` always
   * reflect the full 14-day window.
   */
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
  const logP25 = logTransform(stats.p25);
  const logP50 = logTransform(stats.p50);
  const logP75 = logTransform(stats.p75);
  const logP90 = logTransform(stats.p90);
  const p99Est = stats.p90 + 2 * (stats.p90 - stats.p75);
  const logEffectiveMax = logTransform(Math.min(stats.max, p99Est > stats.p90 ? p99Est : stats.max));
  
  if (logValue <= logMin) return 0;
  if (logValue >= logEffectiveMax) return 1;
  
  if (logValue <= logP25) {
    return 0 + 0.25 * ((logValue - logMin) / (logP25 - logMin || 1));
  } else if (logValue <= logP50) {
    return 0.25 + 0.25 * ((logValue - logP25) / (logP50 - logP25 || 1));
  } else if (logValue <= logP75) {
    return 0.50 + 0.25 * ((logValue - logP50) / (logP75 - logP50 || 1));
  } else if (logValue <= logP90) {
    return 0.75 + 0.15 * ((logValue - logP75) / (logP90 - logP75 || 1));
  } else {
    return 0.90 + 0.10 * ((logValue - logP90) / (logEffectiveMax - logP90 || 1));
  }
}

/**
 * Apply winsorization (p99 cap) to prevent extreme outliers from dominating.
 * Values above the p99 threshold (approximated as p90 + 2*(p90-p75)) are capped.
 * This prevents a single celebrity with extreme pageviews from defining the max
 * and compressing everyone else's normalized scores.
 */
export function winsorize(rawValue: number, stats: SourceStats): number {
  const p99Estimate = stats.p90 + 2 * (stats.p90 - stats.p75);
  if (p99Estimate <= stats.p90) return rawValue;
  return Math.min(rawValue, p99Estimate);
}

/**
 * Normalize a raw source value to 0-1 using log1p + percentile ranking.
 * Applies winsorization first to cap extreme outliers before normalization.
 * This makes different sources (wiki, news, search) comparable before weighting.
 */
export function normalizeSourceValue(rawValue: number, stats: SourceStats): number {
  const cappedValue = winsorize(rawValue, stats);
  const logValue = logTransform(cappedValue);
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
// DATA RECOVERY MODE
// ============================================================================

/**
 * Detect if a data source is recovering from a failure.
 * Recovery = previous value was 0 (or very low) but current value is substantial.
 * This allows faster score recovery when API data returns after an outage.
 */
export function isSourceRecovering(
  currentValue: number,
  previousValue: number,
  minThreshold: number
): boolean {
  // Previous was effectively 0 (or missing), but current is above threshold
  return previousValue < minThreshold && currentValue >= minThreshold;
}

/**
 * Count how many sources are recovering from missing data.
 * Used to boost rate caps when API data returns after failures.
 */
export interface RecoveryDetectionInputs {
  newsCurrentValue: number;
  newsPreviousValue: number;
  searchCurrentValue: number;
  searchPreviousValue: number;
}

export function countRecoveringSources(inputs: RecoveryDetectionInputs): number {
  let count = 0;
  // News is recovering if previous was <5 and current is >=5
  if (isSourceRecovering(inputs.newsCurrentValue, inputs.newsPreviousValue, 5)) count++;
  // Search is recovering if previous was <100 and current is >=100
  if (isSourceRecovering(inputs.searchCurrentValue, inputs.searchPreviousValue, 100)) count++;
  return count;
}

/**
 * Get boosted rate limit for data recovery mode.
 * When sources recover from failure, allow faster score recovery.
 */
export function getRecoveryRateBoost(recoveringCount: number): number {
  switch (recoveringCount) {
    case 2:
      return 0.15; // 15% cap when both sources recover
    case 1:
      return 0.10; // 10% cap when one source recovers
    default:
      return 0; // No boost
  }
}

// ============================================================================
// MULTI-SOURCE BREAKOUT DETECTION
// ============================================================================

// Minimum absolute deltas to qualify as a spike (prevents noise on low-volume
// accounts). Each threshold is env-configurable via SPIKE_MIN_DELTA_WIKI /
// _NEWS / _SEARCH on Railway so we can retune without a redeploy. Values are
// re-read on every access (getters) so runtime env changes take effect on the
// next ingest tick. Negative or non-numeric env values are ignored.
//
// Defaults (updated Apr 2026 for union-mode news volumes):
//   - wiki   5000  → 5K pageview increase over median
//   - news   20    → 20 article increase over median (was 10 pre-union; bumped
//                    because union mode's aggregated counts are ~2-3× higher,
//                    making 10 too easy to clear from noise)
//   - search 15    → 15 points on the 0-100 Serper composite
function parseSpikeMinDelta(raw: string | undefined, fallback: number): number {
  const parsed = parseFloat((raw ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
export const SPIKE_MIN_DELTA: { readonly wiki: number; readonly news: number; readonly search: number } = {
  get wiki() { return parseSpikeMinDelta(process.env.SPIKE_MIN_DELTA_WIKI, 5000); },
  get news() { return parseSpikeMinDelta(process.env.SPIKE_MIN_DELTA_NEWS, 20); },
  get search() { return parseSpikeMinDelta(process.env.SPIKE_MIN_DELTA_SEARCH, 15); },
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
 * Also applies recalibration and catch-up boosts if active.
 */
export function getDynamicRateLimit(spikingCount: number): number {
  let baseCap: number;
  switch (spikingCount) {
    case 3:
      baseCap = 0.35; // 35% - all three sources agree
      break;
    case 2:
      baseCap = 0.25; // 25% - two sources corroborate (relaxed from 20%)
      break;
    case 1:
      baseCap = 0.16; // 16% - one source spiking (relaxed from 12%)
      break;
    default:
      baseCap = MAX_HOURLY_CHANGE_PERCENT; // 12% - default steady-state (relaxed from 8%)
  }
  // Relaxed smoothing mode: double the base cap before recal/catch-up boosts.
  if (getSmoothingMode() === "relaxed") {
    baseCap = baseCap * RELAXED_CAP_MULTIPLIER;
  }
  const recalBoosted = getRecalibrationRateBoost(baseCap);
  return recalBoosted * getCatchUpCapMultiplier();
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
    instagram: number;
    youtube: number;
  };
  velocity: {
    wikiDelta: number;
    newsDelta: number;
    searchDelta: number;
  };
}

export const STANDARD_WEIGHTS: StandardWeights = {
  mass: PLATFORM_WEIGHTS.mass,
  velocity: {
    wikiDelta: PLATFORM_WEIGHTS.velocity.wiki,
    newsDelta: PLATFORM_WEIGHTS.velocity.news,
    searchDelta: PLATFORM_WEIGHTS.velocity.search,
  },
};

export interface AdjustedMassWeights {
  wiki: number;
  instagram: number;
  youtube: number;
}

export interface AdjustedVelocityWeights {
  wikiDelta: number;
  newsDelta: number;
  searchDelta: number;
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
): AdjustedVelocityWeights {
  // Now returns fixed weights - no more redistribution
  return {
    wikiDelta: PLATFORM_WEIGHTS.velocity.wiki,
    newsDelta: PLATFORM_WEIGHTS.velocity.news,
    searchDelta: PLATFORM_WEIGHTS.velocity.search,
  };
}

// ============================================================================
// VELOCITY TAPER
// ============================================================================
// When velocity signals are low (no recent news/search activity),
// taper the velocity contribution so scores "cool down" naturally.
// IMPORTANT: Mass stays stable as baseline fame. Velocity is what collapses.

/**
 * Calculate velocity taper multiplier.
 * When news/search signals are low, taper velocity contribution.
 * This lets celebrities "cool down" naturally after their news cycle ends.
 * 
 * CRITICAL: Apply to VELOCITY, not MASS. Mass = stable baseline fame.
 * 
 * @param newsCount - Raw news count for the period (typically 0-10)
 * @param searchVolume - Composite search activity score (0-100 scale from Serper)
 * @returns Taper multiplier (0.65 to 1.0) - lower means more velocity reduction
 */
export function getVelocityTaperMultiplier(
  newsCount: number,
  searchVolume: number
): number {
  // Thresholds for "low activity"
  // NOTE: searchVolume is now 0-100 composite score, not millions of results
  const NEWS_LOW_THRESHOLD = 5;       // Below this = very low news activity
  const SEARCH_LOW_THRESHOLD = 30;    // Below this = very low search activity (adjusted for 0-100 scale)
  
  // Count how many signals are "low"
  let lowSignalCount = 0;
  if (newsCount < NEWS_LOW_THRESHOLD) lowSignalCount++;
  if (searchVolume < SEARCH_LOW_THRESHOLD) lowSignalCount++;
  
  // Apply graduated taper based on number of low signals
  // 0 low signals = full velocity (1.0)
  // 1 low signal = slight taper (0.85)
  // 2 low signals = strong taper (0.65)
  const taperMultipliers: Record<number, number> = {
    0: 1.00,
    1: 0.85,
    2: 0.65,
  };
  
  return taperMultipliers[lowSignalCount] ?? 0.65;
}

// ============================================================================
// WEIGHT RENORMALIZATION DURING OUTAGES
// ============================================================================
// When a data source is in OUTAGE, redistribute its weight to active sources
// so the remaining active sources properly fill the scoring gap.

export interface SourceHealthStates {
  newsOutage: boolean;
  searchOutage: boolean;
  wikiOutage: boolean;
}

export interface RenormalizedVelocityWeights {
  wiki: number;
  news: number;
  search: number;
}

/**
 * Check whether outage-based velocity-weight redistribution is enabled.
 * Controlled by OUTAGE_WEIGHT_REDIST (default "false"). When false,
 * computeTrendScore ignores `sourceHealthStates` and uses base weights —
 * relying on the ingest pipeline's decay / fill-forward / EMA-hold path to
 * absorb the outage. Flip to "true" to let the scorer redistribute the
 * disabled source's share to remaining active sources for the duration of
 * the outage. Safer default is "false" because it has no behavior change.
 */
export function isOutageWeightRedistEnabled(): boolean {
  const raw = (process.env.OUTAGE_WEIGHT_REDIST ?? "false").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * Renormalize velocity weights when sources are in outage.
 * Redistributes disabled source weights proportionally to active sources.
 * 
 * Example: If News (35%) is in outage, its weight is distributed:
 *   - Wiki: 25% + (25/(25+40)) * 35% = 25% + 13.46% = 38.46%
 *   - Search: 40% + (40/(25+40)) * 35% = 40% + 21.54% = 61.54%
 */
export function getRenormalizedVelocityWeights(
  healthStates: SourceHealthStates
): RenormalizedVelocityWeights {
  // Start with base weights
  let wikiWeight = healthStates.wikiOutage ? 0 : PLATFORM_WEIGHTS.velocity.wiki;
  let newsWeight = healthStates.newsOutage ? 0 : PLATFORM_WEIGHTS.velocity.news;
  let searchWeight = healthStates.searchOutage ? 0 : PLATFORM_WEIGHTS.velocity.search;
  
  const totalActiveWeight = wikiWeight + newsWeight + searchWeight;
  
  if (totalActiveWeight === 0) {
    return { wiki: 0, news: 0, search: 0 };
  }
  
  const normalizationFactor = (PLATFORM_WEIGHTS.velocity.wiki + PLATFORM_WEIGHTS.velocity.news + PLATFORM_WEIGHTS.velocity.search) / totalActiveWeight;
  
  return {
    wiki: wikiWeight * normalizationFactor,
    news: newsWeight * normalizationFactor,
    search: searchWeight * normalizationFactor,
  };
}
