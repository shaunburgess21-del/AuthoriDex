import { normalizeMass } from "./utils";

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
// NOTE (Apr 2026 — PR1): `velocity.search` zeroed out. The Serper-derived
// `searchVolume` is a SERP-feature density score (organic count + KG +
// sitelinks etc., capped at 100 — see `server/providers/serper.ts:209-215`),
// not a search-interest signal. It barely moves when news breaks and was
// dominating top-of-leaderboard ordering with the wrong signal.
// NOTE (Apr 2026 — PR2 / Fix X): `velocity.momentum` introduced. Carries
// the news 24h-vs-7d acceleration signal (articleCount24h / averageDaily7d),
// which the union-mode aggregator already produces for every person. Wiki
// (stock of attention) trims 0.05, news count (volume) trims 0.15, and the
// freed 0.20 lands on momentum (acceleration). The velocity composite now
// reads as: stock × 0.35 + volume × 0.45 + acceleration × 0.20. The
// `search` slot is retained at 0 weight for backward compatibility with
// historical `diagnostics.velocityComponents` blobs persisted on
// `trend_snapshots`.
export const PLATFORM_WEIGHTS = {
  mass: {
    wiki: 0.50,
    instagram: 0.25,
    youtube: 0.25,
  },
  velocity: {
    wiki: 0.35,
    news: 0.45,
    momentum: 0.20,
    search: 0,
  },
};

// ============================================================================
// NEWS MOMENTUM NORMALIZATION (Apr 2026 — PR2 Fix X)
// ============================================================================
// `momentum` velocity slot reads from the news 24h-vs-7d ratio. The ratio
// is *already* a self-normalizing acceleration metric (1.0 = steady state,
// >1.0 = accelerating, <1.0 = cooling), so it doesn't need percentile
// normalization the way raw counts do. Instead we cap it at MOMENTUM_RATIO_CAP
// (a 10× burst is the most we'll reward) and apply log1p compression so
// the curve is gentle in the steady-state band and assertive in the
// breakout band:
//
//   ratio=0.0  → 0.000 (pure cooldown / no recent news)
//   ratio=0.5  → 0.169 (cooling)
//   ratio=1.0  → 0.289 (steady state)
//   ratio=2.0  → 0.458 (accelerating)
//   ratio=5.0  → 0.747 (clear breakout)
//   ratio=10.0 → 1.000 (extreme burst, e.g. major breaking story)
//
// When the 7-day average is missing or zero (tiered-Mediastack-only mode,
// no GDELT, no Serper News 7d), momentum cannot be measured and the score
// is 0 — uniform across affected entities, so it doesn't differentiate
// them but also doesn't penalize one vs another.
export const MOMENTUM_RATIO_CAP = 10;
const MOMENTUM_LOG_DENOM = Math.log1p(MOMENTUM_RATIO_CAP);

/**
 * Floor on the 7d-average denominator. Avoids divide-by-near-zero
 * spikes for entities with sub-1-article-per-day baseline (where a
 * single 24h breakout would otherwise produce ratios of 100+).
 * Tuned to the production news distribution where p50 ≈ 1-2 articles/day.
 */
const MOMENTUM_AVG_FLOOR = 1;

/**
 * Compute the news-momentum velocity score from raw 24h count and 7d
 * average. Returns 0..1. Returns 0 when the 7d average is unavailable
 * or zero (signal not measurable), 0 when 24h is zero (no current news).
 */
export function normalizeNewsMomentum(
  articleCount24h: number,
  averageDaily7d: number,
): number {
  if (!Number.isFinite(articleCount24h) || articleCount24h <= 0) return 0;
  if (!Number.isFinite(averageDaily7d) || averageDaily7d <= 0) return 0;
  const denom = Math.max(averageDaily7d, MOMENTUM_AVG_FLOOR);
  const ratio = Math.min(articleCount24h / denom, MOMENTUM_RATIO_CAP);
  if (ratio <= 0) return 0;
  return Math.log1p(ratio) / MOMENTUM_LOG_DENOM;
}

// ============================================================================
// WIKI MOMENTUM NORMALIZATION (May 2026 — display-only, dormant in score)
// ============================================================================
// Parallel to normalizeNewsMomentum: per-person acceleration on Wikipedia
// daily pageviews (pageviews24h vs trailing-7d daily average). Same math as
// the news version for now (cap=10, log1p compression) so the display
// thresholds calibrated against the audit (Low <1.0, Medium 1.0–2.0, High
// ≥2.0) align with how the score-equivalent number behaves.
//
// IMPORTANT: this function is computed and persisted on every snapshot but
// is NOT consumed by `velocityScore` in this PR. Promotion criterion: after
// ≥14 days of persisted ratios, run `audit-wiki-momentum-score-impact.ts`
// to re-derive the right `MOMENTUM_RATIO_CAP` for Wiki and replay
// historical snapshots at candidate weights (0.05, 0.10, 0.15) trimming
// from `velocity.wiki`. Only then should this function be wired into the
// velocity composite.
//
// A separate function (rather than a generic `normalizeMomentum`) is
// deliberate: future curve tuning for Wiki specifically will edit only
// this function, and the same template will spawn `normalizeTrendsMomentum`
// when SerpApi data lands.
export function normalizeWikiMomentum(
  pageviews24h: number,
  averageDaily7d: number,
): number {
  if (!Number.isFinite(pageviews24h) || pageviews24h <= 0) return 0;
  if (!Number.isFinite(averageDaily7d) || averageDaily7d <= 0) return 0;
  const denom = Math.max(averageDaily7d, MOMENTUM_AVG_FLOOR);
  const ratio = Math.min(pageviews24h / denom, MOMENTUM_RATIO_CAP);
  if (ratio <= 0) return 0;
  return Math.log1p(ratio) / MOMENTUM_LOG_DENOM;
}

// ============================================================================
// TRENDS MOMENTUM NORMALIZATION (May 2026 — display-only, dormant in score)
// ============================================================================
// Per-person acceleration on Google Trends interest (latest-day interest vs
// trailing-7d daily average). Same math as News and Wiki Momentum (cap=10,
// log1p compression). Google Trends values are 0-100 relative interest, not
// absolute counts, but the ratio (today / 7d-avg) is self-normalizing so
// the same compression curve applies.
//
// IMPORTANT: computed and persisted on every snapshot but NOT consumed by
// `velocityScore` in this PR. Promotion after ≥14 days of persisted ratios
// via `audit-trends-score-impact.ts`.
export function normalizeTrendsMomentum(
  latestInterest: number,
  avg7dInterest: number,
): number {
  if (!Number.isFinite(latestInterest) || latestInterest <= 0) return 0;
  if (!Number.isFinite(avg7dInterest) || avg7dInterest <= 0) return 0;
  const denom = Math.max(avg7dInterest, MOMENTUM_AVG_FLOOR);
  const ratio = Math.min(latestInterest / denom, MOMENTUM_RATIO_CAP);
  if (ratio <= 0) return 0;
  return Math.log1p(ratio) / MOMENTUM_LOG_DENOM;
}

// User-facing Low/Medium/High pill for momentum-style ratio signals
// (News Momentum, Wiki Momentum, Trends Momentum). Source-agnostic
// because the audit confirmed the same 1.0/2.0 thresholds work fairly
// across wiki tiers, and it would be confusing if news and wiki used
// different cutoffs for what reads as "the same kind of signal" in the UI.
//
// `routes.ts` historically had its own private copy of this function for
// the news endpoint. New consumers (ingest persistence, future Trends
// Momentum) should import this canonical version. The routes.ts copy is
// left in place to keep the news PR's blast radius tight; a future tidy
// can collapse them.
export type MomentumLevel = "none" | "low" | "medium" | "high";
export function computeMomentumLevel(ratio: number): MomentumLevel {
  if (!Number.isFinite(ratio) || ratio <= 0) return "none";
  if (ratio < 1.0) return "low";
  if (ratio < 2.0) return "medium";
  return "high";
}

// ============================================================================
// GOOGLE SEARCH VOLUME → MASS (May 2026 — DataForSEO Google Ads search volume)
// ============================================================================
// Absolute average monthly Google searches for a person, blended into the
// wiki/attention half of the MASS score. Unlike Google Trends (relative 0-100,
// self-normalised per person → not cross-comparable, retired from scoring),
// Google Ads search volume is an absolute count on one shared scale, so it's a
// legitimate cross-person popularity signal.
//
// We annualise the monthly figure (×12) so it lands on the SAME log curve as
// wiki mass (which annualises daily pageviews ×365). normalizeMass floors at
// 10,000 raw (≈833 searches/mo) and saturates at 1e9 — i.e. people with
// negligible search volume contribute 0 and aren't penalised.
export function normalizeSearchVolumeMass(monthlySearchVolume: number): number {
  if (!Number.isFinite(monthlySearchVolume) || monthlySearchVolume <= 0) return 0;
  return normalizeMass(monthlySearchVolume * 12);
}

// Fraction of the wiki/attention MASS slot that Google search volume takes when
// a person has a (nonzero-normalised) search-volume signal. 0 disables the
// blend (full wiki). Env-overridable (SEARCH_VOLUME_MASS_WEIGHT) for instant
// tuning / rollback without a redeploy. Inert until DataForSEO data is present,
// so the feature can ship before the weight is trusted.
export const SEARCH_VOLUME_MASS_WEIGHT_DEFAULT = 0.30;
export function getSearchVolumeMassWeight(): number {
  const raw = Number(process.env.SEARCH_VOLUME_MASS_WEIGHT);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return SEARCH_VOLUME_MASS_WEIGHT_DEFAULT;
  return raw;
}

// Score composition: 40% mass, 60% velocity (velocity-heavy for "trending" feel).
export const MASS_ALLOCATION = 0.40;
export const VELOCITY_ALLOCATION = 0.60;

// ============================================================================
// NEWS AGGREGATION MODE — Multi-source news count vs tiered fallback
// ============================================================================
// "tiered"  = legacy. Mediastack primary, GDELT fallback, Serper News emergency.
// "union"   = CURRENT PRODUCTION. Multi-source parallel URL union. Mediastack
//             is the primary (uncapped paginationTotal); GDELT + Serper union in
//             for coverage. Currents is disabled (blank CURRENTS_API_KEY) after
//             it showed structural coverage gaps for digital-native categories.
// "cascade" = Currents primary; DataForSEO → Serper → GDELT only when
//             Currents returns 0 (retired; kept for rollback only).
//
// Default "tiered" when unset. Production runs NEWS_AGGREGATION_MODE=union on
// Railway; no code redeploy required to flip between modes.

export type NewsAggregationMode = "tiered" | "union" | "cascade";

export function getNewsAggregationMode(): NewsAggregationMode {
  const raw = (process.env.NEWS_AGGREGATION_MODE ?? "tiered").trim().toLowerCase();
  if (raw === "union") return "union";
  if (raw === "cascade") return "cascade";
  return "tiered";
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
 * Returns 0-1 where 1 = highest percentile. Uses piecewise linear
 * interpolation in log-space between percentile thresholds.
 *
 * Apr 2026: upper tail re-spread. Previously the band p90 → effectiveMax
 * (effectiveMax ≈ p99 estimate) consumed the full 0.90 → 1.00 rank
 * headroom, so anything above the estimated p99 was capped at rank 1.
 * For tight distributions like `news` (p90=17, p99Est=27, max=330) this
 * meant news=27 and news=255 were indistinguishable. We now reserve a
 * dedicated p99 → empirical-max band (rank 0.95 → 1.00) so true
 * outliers (Trump's 255 articles, McIlroy's KG-rich SERP) are clearly
 * separated from the p90-cluster.
 */
export function computePercentileRank(logValue: number, stats: SourceStats): number {
  if (stats.count === 0 || stats.max === stats.min) return 0.5;

  const logMin = logTransform(stats.min);
  const logP25 = logTransform(stats.p25);
  const logP50 = logTransform(stats.p50);
  const logP75 = logTransform(stats.p75);
  const logP90 = logTransform(stats.p90);
  const p99Est = stats.p90 + 2 * (stats.p90 - stats.p75);
  // Anchor the very top of the rank curve at the empirical max so genuine
  // extreme values still climb toward 1.0 instead of saturating at p99Est.
  const logP99 = logTransform(Math.max(stats.p90, p99Est));
  const logMax = logTransform(Math.max(stats.max, Math.max(stats.p90, p99Est)));

  if (logValue <= logMin) return 0;
  if (logValue >= logMax) return 1;

  if (logValue <= logP25) {
    return 0 + 0.25 * ((logValue - logMin) / (logP25 - logMin || 1));
  } else if (logValue <= logP50) {
    return 0.25 + 0.25 * ((logValue - logP25) / (logP50 - logP25 || 1));
  } else if (logValue <= logP75) {
    return 0.50 + 0.25 * ((logValue - logP50) / (logP75 - logP50 || 1));
  } else if (logValue <= logP90) {
    // p75 → p90 band: 0.75 → 0.85 (10 rank points; was 15)
    return 0.75 + 0.10 * ((logValue - logP75) / (logP90 - logP75 || 1));
  } else if (logValue <= logP99) {
    // p90 → p99-estimate band: 0.85 → 0.95 (10 rank points; was 0.90 → 1.00)
    return 0.85 + 0.10 * ((logValue - logP90) / (logP99 - logP90 || 1));
  } else {
    // p99-estimate → empirical-max band: 0.95 → 1.00 (new — gives genuine
    // outliers headroom above the p99 cluster instead of capping at rank 1
    // the moment they clear p99Est).
    return 0.95 + 0.05 * ((logValue - logP99) / (logMax - logP99 || 1));
  }
}

/**
 * Winsorize raw values so a corrupt/extreme outlier doesn't define the
 * upper bound. Apr 2026: cap at the empirical `stats.max` instead of the
 * (much tighter) p99 estimate. The previous p99-cap collapsed legitimate
 * top-tier signals — e.g. Trump's news=255 → 27 — into the same rank
 * band as p99 values, defeating the purpose of having them. The rank
 * function (`computePercentileRank`) reserves its own band for the
 * p99 → max range so real differentiation is preserved.
 */
export function winsorize(rawValue: number, stats: SourceStats): number {
  if (!Number.isFinite(stats.max) || stats.max <= 0) return rawValue;
  return Math.min(rawValue, stats.max);
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
