// ============================================================================
// SCORING ENGINE — Normalization, Platform Weights, Allocations
// ============================================================================
//
// Apr 2026: Radical simplification. The engine used to carry ~12 interacting
// knobs (EMA smoothing, rate limiting, catch-up mode, recalibration boosts,
// anti-spam damping, diversity multiplier, velocity taper, spike detection,
// wiki-lag mute, outage weight redistribution, three smoothing modes). They
// have all been removed. What remains:
//
//   1. Percentile normalization per source (log1p + piecewise interp).
//      Required so wiki pageviews / news article counts / search volume are
//      comparable on a single 0..1 scale before the weighted sum.
//   2. Fixed platform weights + mass/velocity allocations.
//   3. Orthogonal diagnostics knobs: DIAGNOSTICS_VERBOSE,
//      NEWS_AGGREGATION_MODE, NEWS_AGGREGATION_FLIPPED_AT,
//      ROLLING_WINDOW_DAYS_*.
//
// Outage handling lives in ingest.ts (decay / fill-forward). Score volatility
// is expected and desired — the wiki 60/40 blend already provides implicit
// smoothing on the largest mass signal.

export const SCORE_VERSION = "v2";

// Platform weights — FIXED, never redistributed dynamically.
// NOTE (Jan 2026): X API removed from trend score engine due to cost
// constraints. X weight redistributed to Wiki, News, and Search.
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

// Score composition: 40% mass, 60% velocity (velocity-heavy for "trending" feel).
export const MASS_ALLOCATION = 0.40;
export const VELOCITY_ALLOCATION = 0.60;

// ============================================================================
// NEWS AGGREGATION MODE — Multi-source news count vs tiered fallback
// ============================================================================
// "tiered" = legacy. Mediastack primary, GDELT fallback, Serper News
//            emergency fallback. Exactly one provider wins per run.
// "union"  = multi-source. All three providers called in parallel, URLs
//            deduplicated, finalCount = max(mediastackPaginationTotal,
//            unionCount).
//
// Default "tiered" for zero-risk rollout. Flip to "union" via
// NEWS_AGGREGATION_MODE env var on Railway; no redeploy required.

export type NewsAggregationMode = "tiered" | "union";

export function getNewsAggregationMode(): NewsAggregationMode {
  const raw = (process.env.NEWS_AGGREGATION_MODE ?? "tiered").trim().toLowerCase();
  return raw === "union" ? "union" : "tiered";
}

/**
 * Timestamp of when NEWS_AGGREGATION_MODE was flipped from tiered to union.
 * When set, the news percentile calibration (p25/p75 used for Low/Medium/High
 * momentum labels) will only include snapshots from AFTER this cutoff — so
 * tiered-era (lower) counts don't skew the denominator during the transition
 * window. Only affects news percentiles; wiki and search continue to use the
 * full baseline window.
 *
 * Set as an ISO 8601 string on Railway, e.g.:
 *   NEWS_AGGREGATION_FLIPPED_AT=2026-04-21T14:30:00Z
 * Returns null if unset, blank, or unparseable.
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
 * (`diagnostics.fresh.newsUnion`). Defaults to `true` during calibration.
 * Set DIAGNOSTICS_VERBOSE=false on Railway once done to shrink the
 * `trend_snapshots.diagnostics` payload.
 */
export function isDiagnosticsVerbose(): boolean {
  const raw = (process.env.DIAGNOSTICS_VERBOSE ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

/**
 * Rolling percentile-window size, in days, used for Momentum Signals traffic
 * lights AND for the `normalizeSourceValue()` mapping from raw provider
 * values → 0..1 importance scores that feed `fameIndex`.
 *
 * Two independent windows:
 *  - `baseline` (default 14) applies to Wikipedia pageviews + Serper search
 *    volume. These have slower natural decay and benefit from a longer window
 *    for statistical stability.
 *  - `news` (default 7) applies to news_count. News cycles are fast and the
 *    baseline drifts quickly — a shorter window lets trending people cool off
 *    faster and prevents stale stories from dragging p75 upward for weeks.
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

// Sanity check threshold used by sanity-check logic in the ingest pipeline.
export const FOLLOWER_DROP_THRESHOLD = 0.50;

// ============================================================================
// TYPES
// ============================================================================

export interface ActivePlatforms {
  wiki: boolean;
  instagram: boolean;
  youtube: boolean;
}

// ============================================================================
// SOURCE NORMALIZATION — log1p + percentile ranking
// ============================================================================

export interface SourceStats {
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
  /**
   * Number of snapshots used to compute the percentiles. Normally reflects
   * the full baseline-window. For the `news` source only, this may reflect
   * a shorter post-flip window when NEWS_AGGREGATION_FLIPPED_AT is set —
   * see `server/scoring/sourceStats.ts`.
   */
  count: number;
}

export interface AllSourceStats {
  wiki: SourceStats;
  news: SourceStats;
  search: SourceStats;
}

/** log1p(x) = ln(1 + x), handles 0 gracefully. Compresses extreme values. */
export function logTransform(value: number): number {
  return Math.log1p(Math.max(0, value));
}

/**
 * Compute percentile rank of a value given source statistics.
 * Returns 0-1 where 1 = highest percentile. Uses linear interpolation
 * between percentile thresholds.
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
 * Winsorize (p99 cap) raw values so a single extreme outlier doesn't define
 * the max and compress everyone else's normalized scores.
 */
export function winsorize(rawValue: number, stats: SourceStats): number {
  const p99Estimate = stats.p90 + 2 * (stats.p90 - stats.p75);
  if (p99Estimate <= stats.p90) return rawValue;
  return Math.min(rawValue, p99Estimate);
}

/**
 * Normalize a raw source value to 0-1 using winsorize → log1p → percentile
 * rank. Makes wiki / news / search directly comparable before weighting.
 */
export function normalizeSourceValue(rawValue: number, stats: SourceStats): number {
  const cappedValue = winsorize(rawValue, stats);
  const logValue = logTransform(cappedValue);
  return computePercentileRank(logValue, stats);
}

/** Reasonable default stats for bootstrapping before real stats land. */
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
