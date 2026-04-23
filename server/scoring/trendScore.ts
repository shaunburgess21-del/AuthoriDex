import {
  PLATFORM_WEIGHTS,
  MASS_ALLOCATION,
  VELOCITY_ALLOCATION,
  ActivePlatforms,
  AllSourceStats,
  DEFAULT_SOURCE_STATS,
  normalizeSourceValue,
} from "./normalize";
import {
  normalizeMass,
  clamp,
  calculateMomentum,
  generateDrivers,
} from "./utils";

// ============================================================================
// TREND SCORE — raw mass + velocity, no stabilization, no smoothing.
// ============================================================================
// One deterministic code path. What the raw signals say is what the score is.
//   fameIndex = round( (massScore * 0.40 + velocityScore * 0.60) * 10000 )
// Clamped to [0, 1,000,000]. Percentile normalization still runs so different
// sources are comparable before the weighted sum, but nothing is smoothed,
// rate-limited, tapered, dampened, or rank-adjusted after the math above.
//
// Stability fields (`wasStabilized`, `stabDetail`, `spikingSourceCount`,
// `velocityAdjusted`, `diversityMultiplier`) are preserved in the return
// type but hold constant values. They exist only to avoid a cascade of
// downstream edits in storage / admin diagnostics. rawFameIndex === fameIndex
// in every output.

export interface TrendInputs {
  wikiPageviews: number;
  wikiPageviews7dAvg: number;
  wikiDelta: number;
  newsDelta: number;
  searchDelta: number;

  newsCount?: number;
  searchVolume?: number;

  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  prevNewsCount?: number;
  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  prevSearchVolume?: number;

  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  newsIsFresh?: boolean;
  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  searchIsFresh?: boolean;

  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  wikiBaseline?: number;
  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  newsBaseline?: number;
  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  searchBaseline?: number;

  totalFollowers?: number;

  activePlatforms: ActivePlatforms;

  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  platformStatuses?: unknown;

  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  sourceHealthStates?: unknown;

  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  newsStalenessFactor?: number;
  /** @deprecated Unused after simplification. Kept for caller compatibility. */
  searchStalenessFactor?: number;
}

/**
 * Historically this described the pre-EMA / pre-rate-limit intermediate
 * values. Retained as an always-null placeholder in the return type so admin
 * diagnostics don't need a cascade of optional-field edits.
 */
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
  smoothingMode: "off";
}

export interface TrendScoreResult {
  trendScore: number;
  fameIndex: number;
  rawFameIndex: number;
  /** Always false — stabilization is gone. Kept for caller compatibility. */
  wasStabilized: boolean;
  /** Always null — stabilization is gone. Kept for caller compatibility. */
  stabDetail: StabilizationDetail | null;
  /** Always 0 — spike detection is gone. Kept for caller compatibility. */
  spikingSourceCount: number;
  massScore: number;
  velocityScore: number;
  /** Equal to velocityScore. Kept for caller compatibility. */
  velocityAdjusted: number;
  confidence: number;
  /** Always 1 — diversity multiplier is gone. Kept for caller compatibility. */
  diversityMultiplier: number;
  momentum: "Breakout" | "Sustained" | "Cooling" | "Stable";
  drivers: string[];

  change24h: number | null;
  change7d: number | null;
  velocityComponents: {
    search: number;
    news: number;
    wiki: number;
    weights: { search: number; news: number; wiki: number };
  };
}

export function computeTrendScore(
  inputs: TrendInputs,
  previousScore?: number,
  previousScore7d?: number,
  // Intentionally unused after simplification (was: previousFameIndex for EMA).
  // Kept positionally so call sites don't need to change.
  _previousFameIndex?: number,
  sourceStats?: AllSourceStats,
  previousFameIndex24h?: number,
  previousFameIndex7d?: number,
): TrendScoreResult {
  const stats = sourceStats || DEFAULT_SOURCE_STATS;

  // ---- 1. Mass score ------------------------------------------------------
  // Wiki 7-day average is our long-term baseline fame signal. Fall back to
  // the 24h value only if 7d isn't available (e.g. first-ingest bootstrap).
  const wikiPageviewsForMass = inputs.wikiPageviews7dAvg > 0
    ? inputs.wikiPageviews7dAvg
    : inputs.wikiPageviews;

  const wikiMassScore = inputs.activePlatforms.wiki
    ? normalizeMass(wikiPageviewsForMass * 365)
    : 0;

  const followerScore = inputs.totalFollowers
    ? normalizeMass(inputs.totalFollowers)
    : 0;

  let massScore: number;
  if (inputs.totalFollowers && inputs.totalFollowers > 0) {
    const instagramMassContrib = inputs.activePlatforms.instagram
      ? followerScore * PLATFORM_WEIGHTS.mass.instagram
      : 0;
    const youtubeMassContrib = inputs.activePlatforms.youtube
      ? followerScore * PLATFORM_WEIGHTS.mass.youtube
      : 0;
    massScore = (wikiMassScore * PLATFORM_WEIGHTS.mass.wiki)
      + instagramMassContrib
      + youtubeMassContrib;
  } else {
    massScore = wikiMassScore;
  }

  // ---- 2. Velocity score --------------------------------------------------
  // Wiki velocity blend: 60% 24h (responsive) + 40% 7d avg (stability buffer).
  // Kept because the blend is how wiki signals "breaking" vs "slow-burn" —
  // nothing to do with smoothing. Spikes fade in 1-2 days regardless.
  const wiki24h = inputs.wikiPageviews || 0;
  const wiki7d = inputs.wikiPageviews7dAvg || 0;
  const wikiRaw = wiki7d > 0
    ? (wiki24h > 0 ? wiki24h * 0.6 + wiki7d * 0.4 : wiki7d)
    : wiki24h;
  const newsRaw = inputs.newsCount ?? 0;
  const searchRaw = inputs.searchVolume ?? 0;

  const wikiNormalized = normalizeSourceValue(wikiRaw, stats.wiki);
  const newsNormalized = normalizeSourceValue(newsRaw, stats.news);
  const searchNormalized = normalizeSourceValue(searchRaw, stats.search);

  const wikiVelocityScore = inputs.activePlatforms.wiki
    ? wikiNormalized * 100
    : 0;
  const newsVelocityScore = newsNormalized * 100;
  const searchVelocityScore = searchNormalized * 100;

  const velocityWeights = PLATFORM_WEIGHTS.velocity;
  const velocityScore = (
    (wikiVelocityScore * velocityWeights.wiki)
    + (newsVelocityScore * velocityWeights.news)
    + (searchVelocityScore * velocityWeights.search)
  );

  // ---- 3. Composite -------------------------------------------------------
  // Single linear path. No damping, taper, diversity multiplier, EMA, rate
  // limit, catch-up, recalibration, or smoothing modes.
  const baseScore = (massScore * MASS_ALLOCATION) + (velocityScore * VELOCITY_ALLOCATION);
  const fameIndex = clamp(Math.round(baseScore * 10000), 0, 1000000);
  const trendScore = clamp(baseScore * 10000, 0, 1000000);

  // ---- 4. Confidence (cosmetic — unused in scoring) -----------------------
  const hasWiki = inputs.wikiDelta !== 0 || inputs.wikiPageviews > 0;
  const hasNews = inputs.newsDelta !== 0;
  const hasSearch = inputs.searchDelta !== 0;
  let dataSourceCount = 0;
  if (hasWiki) dataSourceCount++;
  if (hasNews) dataSourceCount++;
  if (hasSearch) dataSourceCount++;
  const confidence = dataSourceCount >= 3 ? 1.3
    : dataSourceCount >= 2 ? 1.0
    : dataSourceCount >= 1 ? 0.8
    : 0.6;

  // ---- 5. Momentum + drivers (cosmetic UI labels) -------------------------
  const avgDelta = (inputs.wikiDelta + inputs.newsDelta + inputs.searchDelta) / 3;
  const momentum = calculateMomentum(velocityScore, avgDelta);
  const drivers = generateDrivers(
    inputs.wikiDelta,
    inputs.newsDelta,
    inputs.searchDelta,
    0,
  );

  // ---- 6. 24h / 7d changes ------------------------------------------------
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

  return {
    trendScore: Math.round(trendScore),
    fameIndex,
    rawFameIndex: fameIndex,
    wasStabilized: false,
    stabDetail: null,
    spikingSourceCount: 0,
    massScore: Math.round(massScore * 100) / 100,
    velocityScore: Math.round(velocityScore * 100) / 100,
    velocityAdjusted: Math.round(velocityScore * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    diversityMultiplier: 1,
    momentum,
    drivers,
    change24h: change24h !== null ? Math.round(change24h * 10) / 10 : null,
    change7d: change7d !== null ? Math.round(change7d * 10) / 10 : null,
    velocityComponents: {
      search: Math.round(searchVelocityScore * 100) / 100,
      news: Math.round(newsVelocityScore * 100) / 100,
      wiki: Math.round(wikiVelocityScore * 100) / 100,
      weights: {
        search: Math.round(velocityWeights.search * 1000) / 1000,
        news: Math.round(velocityWeights.news * 1000) / 1000,
        wiki: Math.round(velocityWeights.wiki * 1000) / 1000,
      },
    },
  };
}
