import {
  PLATFORM_WEIGHTS,
  MASS_ALLOCATION,
  VELOCITY_ALLOCATION,
  ActivePlatforms,
  AllSourceStats,
  DEFAULT_SOURCE_STATS,
  normalizeSourceValue,
  normalizeNewsMomentum,
  normalizeWikiMomentum,
  normalizeTrendsMomentum,
  normalizeSearchVolumeMass,
  getSearchVolumeMassWeight,
} from "./normalize";
import {
  normalizeMass,
  clamp,
  calculateMomentum,
  generateDrivers,
} from "./utils";

// ============================================================================
// TREND SCORE — raw mass + velocity with cross-snapshot Fame Index EMA.
// ============================================================================
// Single deterministic code path:
//   massScore     = wikiMass * 0.50 + igMass * 0.25 + ytMass * 0.25
//   velocityScore = wikiVel * 0.35 + newsVel * 0.45 + momentumVel * 0.20
//                   (Fix X — Apr 2026 PR2: momentum slot added; news slot
//                   trimmed from 0.60; wiki trimmed from 0.40; search
//                   permanently zero. Momentum carries the news 24h-vs-7d
//                   acceleration ratio.)
//   rawFameIndex  = clamp( round( (massScore * 0.40 + velocityScore * 0.60) * 10000 ), 0, 1M )
//   fameIndex     = clamp( round( 0.7 × rawFameIndex + 0.3 × previousFameIndex ), 0, 1M )
//                   (Fix Z — Apr 2026 PR2: cross-snapshot EMA when a
//                   recent previousFameIndex is supplied; otherwise
//                   fameIndex === rawFameIndex.)
//
// The Apr 2026 cross-snapshot EMA caps any single-tick fameIndex swing to
// ~70% of the raw delta. Step-up from baseline to spike: 70% on tick 1,
// 91% on tick 2, ~98% on tick 4 — fast enough that breakouts still
// register, but enough damping to eliminate the leftover ±150K
// oscillation that upstream input smoothing (ingest.ts soft-hold) doesn't
// catch (e.g. mass-side wiki-7d-avg refresh flips). Step-down has the
// same shape, so a real news-cycle decline takes ~5 ticks to fully
// propagate.
//
// `rawFameIndex` is preserved un-smoothed for admin diagnostics so the
// pre-EMA composite is always inspectable. Other "stability" fields
// (`wasStabilized`, `stabDetail`, `spikingSourceCount`, `velocityAdjusted`,
// `diversityMultiplier`) are still legacy placeholders held for storage
// compatibility — none of them re-enable the historical full
// stabilization pipeline.

export interface TrendInputs {
  wikiPageviews: number;
  wikiPageviews7dAvg: number;
  wikiDelta: number;
  newsDelta: number;
  searchDelta: number;

  newsCount?: number;
  searchVolume?: number;

  /**
   * Trailing 7-day average daily news count for this entity. Combined with
   * `newsCount` (which is the 24h count) to compute the news-momentum
   * velocity slot (Apr 2026 — PR2 Fix X). When omitted, missing, or zero
   * the momentum score is 0 — see `normalizeNewsMomentum`.
   */
  newsAverageDaily7d?: number;

  /**
   * Trailing 7-day daily-average Wikipedia pageviews for this entity.
   * Combined with `wikiPageviews` (24h) to compute the wiki-momentum
   * velocity sub-score (May 2026 — display-only addition, dormant in
   * `velocityScore`). When omitted the function falls back to
   * `wikiPageviews7dAvg` so existing callers keep working without
   * change. See `normalizeWikiMomentum` for the cap/compression curve.
   */
  wikiAverageDaily7d?: number;

  /**
   * Google Trends latest-day interest value (0-100, SerpApi TIMESERIES).
   * Combined with `trendsAvg7d` to compute the trends-momentum velocity
   * sub-score (May 2026 — display-only, dormant in `velocityScore`).
   */
  trendsInterest?: number;
  /** Trailing 7-day average daily Google Trends interest (0-100). */
  trendsAvg7d?: number;

  /**
   * Absolute average monthly Google searches for this person (DataForSEO
   * Google Ads search volume). May 2026 — blended into the wiki/attention
   * MASS slot via `normalizeSearchVolumeMass` + `getSearchVolumeMassWeight`.
   * When 0/undefined the mass score is full wiki (no blend, no penalty).
   */
  searchVolumeMonthly?: number;

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
  /**
   * Google Ads search-volume mass sub-score (0..100) before weighting.
   * May 2026 — persisted for diagnostics / weight audits. 0 when no data.
   */
  searchVolumeMassScore: number;
  /**
   * Blended wiki+search attention mass (0..100) that actually fed `massScore`.
   * Equals the wiki mass when search volume is absent. May 2026.
   */
  attentionMassScore: number;
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
    /**
     * News-acceleration velocity sub-score (0..100). Derived from the
     * 24h-vs-7d news ratio — see `normalizeNewsMomentum`. Apr 2026 (PR2
     * Fix X). Carried in the response shape so admin diagnostics
     * (`Why Trending`, `Hot Movers` source attribution) can render the
     * acceleration slice alongside stock (wiki) and volume (news count).
     */
    momentum: number;
    /**
     * Wiki-acceleration velocity sub-score (0..100). Derived from the
     * 24h-vs-7d wiki pageviews ratio — see `normalizeWikiMomentum`.
     * May 2026 (display-only addition).
     *
     * IMPORTANT: this slot is computed and persisted on every snapshot
     * but is NOT consumed by `velocityScore` in this PR — `weights` does
     * not include a `wikiMomentum` key, and the velocity composite at
     * lines below sums only `search/news/wiki/momentum`. Promotion to a
     * weighted slot is gated on a follow-up `audit-wiki-momentum-score-
     * impact.ts` script — see header note in `normalize.ts`.
     */
    wikiMomentum: number;
    /**
     * Google Trends acceleration velocity sub-score (0..100). Derived from
     * latest-day interest vs trailing-7d mean — see `normalizeTrendsMomentum`.
     * May 2026 (display-only addition, dormant in `velocityScore`).
     */
    trendsMomentum: number;
    weights: { search: number; news: number; wiki: number; momentum: number };
  };
}

// ── CROSS-SNAPSHOT EMA CONSTANTS (Apr 2026 trend-engine tuning) ──────────────
// TEMPORARY (May 2026 native-markets calibration): tightened from 0.70/0.30
// while ingest news-count smoothing (3-tick) is verified stable in prod for
// ~7 days. Relax back to 0.70/0.30 once sawtooth is confirmed gone.
const FAME_INDEX_EMA_ALPHA_CURRENT = 0.50;
const FAME_INDEX_EMA_ALPHA_PREVIOUS = 0.50;

export function computeTrendScore(
  inputs: TrendInputs,
  previousScore?: number,
  previousScore7d?: number,
  // Most-recent persisted fameIndex (1-tick-ago snapshot). When supplied
  // and non-zero we apply a cross-snapshot EMA so single-tick swings are
  // capped. Callers should pass `undefined` when the previous tick is
  // stale (>1 ingest cadence ago) so new entrants / post-gap recoveries
  // aren't pinned to outdated values — see ingest.ts FAME_EMA_MAX_GAP_HOURS.
  previousFameIndex?: number,
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

  // Google Ads search volume → mass (May 2026). Absolute monthly searches,
  // annualised onto the same log curve as wiki. Blended into the wiki/attention
  // slot ONLY when a meaningful signal exists, so wiki-strong / low-search
  // people aren't penalised by a zero. Weight is env-tunable + inert without
  // DataForSEO data (searchVolumeMassScore == 0).
  const searchVolumeMassScore = normalizeSearchVolumeMass(inputs.searchVolumeMonthly ?? 0);
  const searchVolumeMassWeight = getSearchVolumeMassWeight();
  const attentionMassScore = searchVolumeMassScore > 0
    ? wikiMassScore * (1 - searchVolumeMassWeight) + searchVolumeMassScore * searchVolumeMassWeight
    : wikiMassScore;

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
    massScore = (attentionMassScore * PLATFORM_WEIGHTS.mass.wiki)
      + instagramMassContrib
      + youtubeMassContrib;
  } else {
    massScore = attentionMassScore;
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

  // News-momentum velocity slot (Apr 2026 — PR2 Fix X). The
  // `newsAverageDaily7d` input falls through from the multi-source news
  // aggregator (union mode) or per-provider 7d count (tiered GDELT /
  // Serper News). When unavailable (e.g. tiered Mediastack-only mode)
  // momentumNormalized is 0 — see `normalizeNewsMomentum`.
  const momentumNormalized = normalizeNewsMomentum(
    newsRaw,
    inputs.newsAverageDaily7d ?? 0,
  );

  // Wiki-momentum velocity slot (May 2026 — display-only). Computed and
  // persisted on every snapshot so the future score-impact audit can replay
  // candidate weights against history, but DELIBERATELY NOT included in the
  // `velocityScore` sum below. The `wiki7d` input here is the same trailing
  // 7-day daily average that drives `velocity.wiki`'s 60/40 blend; if a
  // caller passes an explicit `wikiAverageDaily7d` (e.g. an
  // excluding-today aggregate from ingest history) we prefer it. See
  // `normalize.ts` header note for the promotion criterion.
  const wikiMomentumDenom = inputs.wikiAverageDaily7d ?? wiki7d;
  const wikiMomentumNormalized = normalizeWikiMomentum(
    wiki24h,
    wikiMomentumDenom,
  );

  // Trends-momentum velocity slot (May 2026 — display-only, same pattern as
  // wikiMomentum). Computed from Google Trends 0-100 interest values.
  const trendsMomentumNormalized = normalizeTrendsMomentum(
    inputs.trendsInterest ?? 0,
    inputs.trendsAvg7d ?? 0,
  );

  const wikiVelocityScore = inputs.activePlatforms.wiki
    ? wikiNormalized * 100
    : 0;
  const newsVelocityScore = newsNormalized * 100;
  const searchVelocityScore = searchNormalized * 100;
  const momentumVelocityScore = momentumNormalized * 100;
  const wikiMomentumVelocityScore = inputs.activePlatforms.wiki
    ? wikiMomentumNormalized * 100
    : 0;
  const trendsMomentumVelocityScore = trendsMomentumNormalized * 100;

  const velocityWeights = PLATFORM_WEIGHTS.velocity;
  // NOTE: `wikiMomentumVelocityScore` is intentionally NOT summed here.
  // It's a dormant signal until calibrated — see normalize.ts header.
  const velocityScore = (
    (wikiVelocityScore * velocityWeights.wiki)
    + (newsVelocityScore * velocityWeights.news)
    + (searchVelocityScore * velocityWeights.search)
    + (momentumVelocityScore * velocityWeights.momentum)
  );

  // ---- 3. Composite -------------------------------------------------------
  // Linear mass + velocity composite, then a cross-snapshot EMA on the
  // final fameIndex (Apr 2026 trend-engine tuning). Pre-EMA composite is
  // preserved as `rawFameIndex` for admin diagnostics.
  const baseScore = (massScore * MASS_ALLOCATION) + (velocityScore * VELOCITY_ALLOCATION);
  const rawFameIndex = clamp(Math.round(baseScore * 10000), 0, 1000000);
  const rawTrendScore = clamp(baseScore * 10000, 0, 1000000);

  // Apply cross-snapshot EMA only when we have a usable prior tick. Caller
  // (ingest) is responsible for not passing a stale previousFameIndex.
  const hasUsablePrev =
    typeof previousFameIndex === "number" &&
    Number.isFinite(previousFameIndex) &&
    previousFameIndex > 0;

  const fameIndex = hasUsablePrev
    ? clamp(
        Math.round(
          rawFameIndex * FAME_INDEX_EMA_ALPHA_CURRENT +
            previousFameIndex * FAME_INDEX_EMA_ALPHA_PREVIOUS,
        ),
        0,
        1000000,
      )
    : rawFameIndex;

  const trendScore = hasUsablePrev
    ? clamp(
        rawTrendScore * FAME_INDEX_EMA_ALPHA_CURRENT +
          previousFameIndex * FAME_INDEX_EMA_ALPHA_PREVIOUS,
        0,
        1000000,
      )
    : rawTrendScore;

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
    rawFameIndex,
    // `wasStabilized` previously meant "the legacy stabilization pipeline
    // (rate-limit + asymmetric EMA + diversity multiplier + …) modified the
    // raw composite this tick". That pipeline is gone. The cross-snapshot
    // EMA is a single targeted layer with deterministic alpha, not a
    // stabilization regime, so this flag stays false even when EMA fires —
    // any divergence between fameIndex and rawFameIndex is the EMA, by
    // definition.
    wasStabilized: false,
    stabDetail: null,
    spikingSourceCount: 0,
    massScore: Math.round(massScore * 100) / 100,
    searchVolumeMassScore: Math.round(searchVolumeMassScore * 100) / 100,
    attentionMassScore: Math.round(attentionMassScore * 100) / 100,
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
      momentum: Math.round(momentumVelocityScore * 100) / 100,
      wikiMomentum: Math.round(wikiMomentumVelocityScore * 100) / 100,
      trendsMomentum: Math.round(trendsMomentumVelocityScore * 100) / 100,
      weights: {
        search: Math.round(velocityWeights.search * 1000) / 1000,
        news: Math.round(velocityWeights.news * 1000) / 1000,
        wiki: Math.round(velocityWeights.wiki * 1000) / 1000,
        momentum: Math.round(velocityWeights.momentum * 1000) / 1000,
      },
    },
  };
}
