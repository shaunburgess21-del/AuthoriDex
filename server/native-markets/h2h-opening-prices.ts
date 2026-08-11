/**
 * H2H opening-price priors.
 *
 * H2H markets have always opened at 50/50 because `seedAmmMarket` starts
 * from a uniform q vector. The entrant with the higher opening Trend
 * Score wins far more often than that, so anyone who compared the two
 * scores on the leaderboard had a free edge and the house funded it.
 *
 * Measured over the nine stable 20-card weeks (24–32, 180 resolved H2H
 * markets), bucketing on the percentage gap between opening scores:
 *
 *   gap  < 10%   → favourite won 64.9%   (n = 57)
 *   gap 10–30%   → favourite won 80.0%   (n = 65)
 *   gap ≥ 30%    → favourite won 91.4%   (n = 58)
 *   overall      → favourite won 78.9%   (n = 180, ~8 SE above a 50% null)
 *
 * The rate is also stable week to week — 70%, 75%, 80%, 85%, 75%, 70%,
 * 80%, 90%, 85% — a standard deviation of 6.6 points with no week where
 * pricing on it would have been badly wrong. That stability is what makes
 * H2H the safest of the three native markets to price on.
 *
 * (This block used to claim Up/Down had no level worth seeding at, on the
 * strength of its unconditional weekly Up rate swinging 0%–85%. That was
 * measured before the velocity decomposition: conditioned on opening
 * velocity the level is stable enough to price, just far noisier than H2H.
 * See `updown-opening-prices.ts`.)
 *
 * --------------------------------------------------------------------------
 * Why the opening prices sit BELOW the measured win rates
 * --------------------------------------------------------------------------
 * The goal is to remove the free edge, not to extract maximum house
 * profit. Each bucket opens a few points short of its measured rate,
 * which strips roughly 83% of the mispricing while leaving a modest,
 * uniform edge for a user who does the work:
 *
 *   bucket     measured   opens at   edge before   edge after
 *   narrow      64.9%      62%          30%           5%
 *   moderate    80.0%      72%          60%          11%
 *   wide        91.4%      80%          83%          14%
 *
 * It also means a wrong estimate costs the house less than a right one
 * earns, and the underdog stays genuinely attractive (5x at the widest
 * bucket) so both sides of the book remain tradeable.
 *
 * --------------------------------------------------------------------------
 * Depth preservation — the non-obvious part
 * --------------------------------------------------------------------------
 * `seedBFromPrices` sets `b = targetMaxLoss / ln(1 / pMin)`, so a lopsided
 * seed buys its price match by shrinking `b`. At 80/20 with the stock
 * `targetMaxLoss` of 2000, `b` falls from 2885 to 1242 — and at that
 * depth a single median-sized H2H bet (210 credits) would drag the
 * underdog from 0.20 to about 0.46, destroying the very price we just
 * fitted. Real H2H flow is ~49 buys per market averaging 248 credits, so
 * this is not a hypothetical.
 *
 * `computeDepthPreservingTargetMaxLoss` therefore scales `targetMaxLoss`
 * so `b` matches what the market would have had at 50/50. The trade is
 * explicit: the house's worst-case loss (and its seed, since the seed
 * equals `targetMaxLoss` on both paths) rises from 2000 to between 2792
 * and 4644 depending on the bucket. Set `H2H_PRESERVE_DEPTH_ENABLED=false`
 * to take the thin-book version at the original exposure instead.
 *
 * --------------------------------------------------------------------------
 * Interaction with the agents' lock-in fair model
 * --------------------------------------------------------------------------
 * `LOCKIN_FAIR_H2H_ENABLED` defaults ON, so agents already price H2H off
 * the same score gap via `computeLockInFairH2H`. Their estimate is
 * time-decayed, so it is worth knowing where the two agree. At Monday
 * open (168h remaining, sigma1d 0.109, beta 0.36):
 *
 *   gap    agent fair @open   opens at   measured
 *    5.4%       0.567           0.62       0.649
 *    9.9%       0.619           0.62       0.649
 *   18.8%       0.710           0.72       0.800
 *   48.8%       0.900           0.80       0.914
 *
 * The moderate and wide buckets line up or sit below the agents' own
 * model, so agents push those toward the measured rate rather than
 * fighting the seed — the division of labour is that this module fixes
 * the opening price and the existing convergence sweeps carry it the
 * rest of the way.
 *
 * The exception is the narrow bucket at small gaps, where the agents'
 * model (0.567) is below both our price and the measured 0.649, so
 * agents will drag those markets down a few points. We deliberately do
 * NOT bend the seed to match: 0.649 is what actually happened over 57
 * markets, and distorting the open to satisfy an under-confident sigma
 * would hide the real issue. If narrow-bucket markets keep converging
 * to ~0.57, the fix is to recalibrate `LOCKIN_H2H_SIGMA_1D` — agent
 * tuning, deliberately out of scope here.
 *
 * --------------------------------------------------------------------------
 * Scope
 * --------------------------------------------------------------------------
 *   - H2H only. Up/Down needs the market redefined, not repriced, and
 *     Gainer needs its metric normalised first — see the Phase 2 review.
 *   - Gated behind `H2H_OPENING_PRIOR_ENABLED` (default false), so
 *     deploying this file changes nothing until the flag is set. Markets
 *     are generated on Mondays, so the flag must be on before Monday
 *     00:00 UTC to affect a given week.
 *   - No new ledger rows and no extra house outflow beyond the seed:
 *     this rides the existing price-matched seeding path already used by
 *     World Markets, not the warm-start path.
 */

import { getTargetMaxLoss } from "../config/amm";

/**
 * Lenient flag parser, matching `envFlag` in `server/agents/constants.ts`
 * and `amm-warmstart.ts` so a Railway value of `TRUE` behaves.
 */
function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * Master switch. Read at call time rather than module load so tests and
 * the admin tooling can toggle it without import-order games.
 */
export function isH2HOpeningPriorEnabled(): boolean {
  return envFlag(process.env.H2H_OPENING_PRIOR_ENABLED);
}

/** See the depth-preservation note above. Defaults ON when the prior is on. */
export function isH2HDepthPreservationEnabled(): boolean {
  const raw = process.env.H2H_PRESERVE_DEPTH_ENABLED;
  if (typeof raw !== "string" || raw.trim() === "") return true;
  return envFlag(raw);
}

/**
 * Minimum score gap before any prior is applied, in percent.
 *
 * Below this the "favourite" is inside the noise of the opening median
 * itself, so 50/50 is the honest price. The narrow bucket's measured
 * 64.9% is an average over gaps up to 10% (mean 5.4%) and certainly
 * overstates the edge at a 0.5% gap — this floor stops us pricing a
 * genuine coin flip as a favourite.
 */
export const H2H_MIN_GAP_PCT = 2.0;

/**
 * Hard ceiling on the favourite's opening price. Never raise this
 * without re-measuring: the cost of being wrong grows as the price
 * approaches 1, and an underdog priced below 0.20 stops attracting the
 * volume that makes the market work.
 */
export const H2H_MAX_FAVOURITE_PRICE = 0.8;

export type H2HPriorBucketId = "narrow" | "moderate" | "wide";

export interface H2HPriorBucket {
  id: H2HPriorBucketId;
  /** Inclusive lower bound on `gapPct`. Buckets are tested high to low. */
  minGapPct: number;
  /** Favourite win rate measured over weeks 24–32. */
  measuredWinRate: number;
  /** Number of resolved markets behind `measuredWinRate`. */
  sampleSize: number;
  /** Price the favourite actually opens at. Always < `measuredWinRate`. */
  favouritePrice: number;
}

/** Ordered high-to-low so `pickH2HPriorBucket` can return the first match. */
export const H2H_PRIOR_BUCKETS: readonly H2HPriorBucket[] = [
  { id: "wide", minGapPct: 30, measuredWinRate: 0.914, sampleSize: 58, favouritePrice: 0.8 },
  { id: "moderate", minGapPct: 10, measuredWinRate: 0.8, sampleSize: 65, favouritePrice: 0.72 },
  { id: "narrow", minGapPct: H2H_MIN_GAP_PCT, measuredWinRate: 0.649, sampleSize: 57, favouritePrice: 0.62 },
];

/**
 * Percentage gap between two opening scores, relative to the smaller of
 * the two.
 *
 * This must stay identical to the definition used to fit
 * `H2H_PRIOR_BUCKETS` (`ABS(a-b) / LEAST(a,b) * 100`) — switching to a
 * mean- or max-relative denominator would silently shift every market
 * into a different bucket than the one its price was measured on.
 *
 * Returns null when either score is missing or non-positive.
 */
export function computeH2HGapPct(
  scoreA: number | null | undefined,
  scoreB: number | null | undefined,
): number | null {
  if (scoreA == null || scoreB == null) return null;
  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return null;
  if (scoreA <= 0 || scoreB <= 0) return null;
  const smaller = Math.min(scoreA, scoreB);
  return (Math.abs(scoreA - scoreB) / smaller) * 100;
}

/**
 * Round to 4 decimal places.
 *
 * `1 - 0.8` is `0.19999999999999996` in IEEE-754, which would flow into
 * `normalizeSeedPrices` as a vector that does not sum to 1 and get
 * silently renormalized. Prices are a 2-decimal concept here, so snap
 * them to a clean value and keep the seed input exact.
 */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Bucket for a gap, or null when the gap is below `H2H_MIN_GAP_PCT`. */
export function pickH2HPriorBucket(gapPct: number): H2HPriorBucket | null {
  if (!Number.isFinite(gapPct)) return null;
  for (const bucket of H2H_PRIOR_BUCKETS) {
    if (gapPct >= bucket.minGapPct) return bucket;
  }
  return null;
}

/**
 * `targetMaxLoss` that makes a price-matched seed carry the same LMSR
 * depth as the uniform 50/50 seed it replaces.
 *
 * Uniform binary:      b = tml / ln 2
 * Price-matched:       b = tml / ln(1 / pMin),  pMin = 1 − favouritePrice
 *
 * Equating the two gives the scale factor below. Rounded up to a whole
 * credit because the seed debit is an integer.
 */
export function computeDepthPreservingTargetMaxLoss(
  favouritePrice: number,
  uniformTargetMaxLoss: number,
): number {
  if (!Number.isFinite(favouritePrice) || favouritePrice <= 0.5 || favouritePrice >= 1) {
    throw new Error(
      `[h2hOpeningPrices] favouritePrice must be in (0.5, 1), got ${favouritePrice}`,
    );
  }
  if (!Number.isFinite(uniformTargetMaxLoss) || uniformTargetMaxLoss <= 0) {
    throw new Error(
      `[h2hOpeningPrices] uniformTargetMaxLoss must be positive, got ${uniformTargetMaxLoss}`,
    );
  }
  const pMin = 1 - favouritePrice;
  const scale = Math.log(1 / pMin) / Math.log(2);
  return Math.ceil(uniformTargetMaxLoss * scale);
}

export interface H2HOpeningPriceDecision {
  /** Opening prices aligned with `[entryA, entryB]` (displayOrder 0, 1). */
  prices: [number, number];
  /** Which entry the prior favours. */
  favourite: "a" | "b";
  gapPct: number;
  bucket: H2HPriorBucketId;
  /** Price applied to the favoured side. */
  favouritePrice: number;
  /** Measured win rate for the chosen bucket, persisted for later audit. */
  measuredWinRate: number;
  /**
   * `targetMaxLoss` to pass to `seedAmmMarket`. Equals the depth-preserving
   * value when `H2H_PRESERVE_DEPTH_ENABLED` is on, otherwise the stock
   * per-market-type value.
   */
  targetMaxLoss: number;
  /** True when `targetMaxLoss` was scaled up to hold `b` constant. */
  depthPreserved: boolean;
}

export interface PickH2HOpeningPricesInput {
  /** Opening score for the entry at displayOrder 0. */
  scoreA: number | null | undefined;
  /** Opening score for the entry at displayOrder 1. */
  scoreB: number | null | undefined;
  /**
   * Uniform `targetMaxLoss` this market would otherwise have used.
   * Defaults to the configured H2H value.
   */
  uniformTargetMaxLoss?: number;
  /** Test seam; defaults to the env-backed helper. */
  preserveDepth?: boolean;
}

/**
 * Decide a H2H market's opening prices from its two opening scores.
 *
 * Returns null — meaning "seed 50/50 exactly as before" — when either
 * score is missing or the gap is inside the noise floor. Callers should
 * treat null as the normal, safe path and simply omit `initialPrices`.
 *
 * Pure apart from the optional env read for depth preservation; exported
 * for unit testing.
 */
export function pickH2HOpeningPrices(
  input: PickH2HOpeningPricesInput,
): H2HOpeningPriceDecision | null {
  const gapPct = computeH2HGapPct(input.scoreA, input.scoreB);
  if (gapPct == null) return null;

  const bucket = pickH2HPriorBucket(gapPct);
  if (!bucket) return null;

  const favouritePrice = round4(Math.min(bucket.favouritePrice, H2H_MAX_FAVOURITE_PRICE));
  // Non-null assertions are safe: computeH2HGapPct rejects null/non-finite.
  const favourite: "a" | "b" = (input.scoreA as number) >= (input.scoreB as number) ? "a" : "b";
  const underdogPrice = round4(1 - favouritePrice);
  const prices: [number, number] =
    favourite === "a" ? [favouritePrice, underdogPrice] : [underdogPrice, favouritePrice];

  const uniformTargetMaxLoss = input.uniformTargetMaxLoss ?? getTargetMaxLoss("h2h");
  const preserveDepth = input.preserveDepth ?? isH2HDepthPreservationEnabled();
  const targetMaxLoss = preserveDepth
    ? computeDepthPreservingTargetMaxLoss(favouritePrice, uniformTargetMaxLoss)
    : uniformTargetMaxLoss;

  return {
    prices,
    favourite,
    gapPct,
    bucket: bucket.id,
    favouritePrice,
    measuredWinRate: bucket.measuredWinRate,
    targetMaxLoss,
    depthPreserved: preserveDepth,
  };
}
