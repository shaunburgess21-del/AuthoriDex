/**
 * Up/Down opening-price prior — velocity-conditioned.
 *
 * NOT WIRED IN YET. This module is pure and unreferenced by the generator
 * on purpose: it exists so `npm run updown:preview` can rehearse the
 * pricing against the live roster, and so the week-35 wiring diff is small
 * and reviewable. Deploying this file changes nothing.
 *
 * --------------------------------------------------------------------------
 * Why Up/Down needs a prior at all
 * --------------------------------------------------------------------------
 * 60% of `fameIndex` is `velocityScore`, which is a bounded percentile rank
 * against a rolling window of the whole roster's history
 * (`normalizeSourceValue` → `computePercentileRank`). That construction
 * mean-reverts two ways: the 0–100 scale gives someone at 74 only 26 points
 * of headroom up against 74 down, and their own spike enters the rolling
 * history and lifts the p90/p99 anchors, pushing their percentile back down
 * at constant raw signal.
 *
 * Measured roster-wide over weeks 29–32 (636 person-weeks, post-NEWS_SOV so
 * the cohort tide is not confounding), by quintile of opening fame:
 *
 *   quintile   open velocity   Δmass      Δvelocity   Δfame
 *   Q1 high        73.8        −1.43 pts  −5.27 pts   −5.64%
 *   Q3 middle      44.3        −0.44 pts  +1.82 pts   +2.38%
 *   Q5 low         14.3        +0.21 pts  +4.34 pts  +14.06%
 *
 * Mass is flat because `normalizeMass` is a fixed absolute log curve.
 * Velocity carries the whole gradient and crosses zero at the middle of the
 * distribution. The Up/Down field is drawn from rank bands 1–10, 11–40 and
 * 41–100, so it is concentrated in exactly the quintiles that fall.
 *
 * --------------------------------------------------------------------------
 * Why a single threshold and not a five-band ladder
 * --------------------------------------------------------------------------
 * Roster-wide the gradient is smooth across five velocity bands (62.7% Up
 * at <25 down to 22.3% at 70+), which suggests a graduated price ladder.
 * On the markets that actually got created it collapses, because the field
 * is already concentrated at the top. Over 180 resolved markets (weeks
 * 24–32), bucketing on the trailing-6h median velocity the generator can
 * actually observe at creation time:
 *
 *   band       markets   Up rate    note
 *   <25            5      80.0%     2 weeks only — unusable
 *   25–40         14      57.1%     6 weeks, sd 39.0 — unusable
 *   40–55         32      34.4%
 *   55–70         31      29.0%
 *   70+           98      28.6%     54% of the entire field
 *
 * The three bands at or above velocity 40 are statistically
 * indistinguishable from each other (34.4 / 29.0 / 28.6) and hold 161 of
 * 180 markets. Below 40 there are 2.7 cards per week with a weekly standard
 * deviation of 41.3 points — no level to price on. So the honest model is
 * one threshold, not a ladder:
 *
 *   velocity >= 40  →  161 markets, 9 weeks, pooled Up 29.8%,
 *                      mean weekly 31.6%, sd 22.0 (2.5 SE below a 50% null)
 *   velocity <  40  →  19 markets, 7 weeks, mean weekly 47.6%, sd 41.3
 *                      → left at 50/50, which is the honest price
 *
 * --------------------------------------------------------------------------
 * The threshold is a safety rail, not a discriminator
 * --------------------------------------------------------------------------
 * Be honest about what this module does. Running `npm run updown:preview`
 * against the live roster for week 34 put **all 20 cards** in the hot band,
 * with velocity spanning 51.0 to 86.3 and a median of 72.9 — not one card
 * came in below 40, and even the rank 41–100 wildcards sat at 51–55.
 * Historically it was 161 of 180 (89%).
 *
 * So in practice this is not "conditional pricing". It is "open Up/Down at
 * 0.40 instead of 0.50", and the velocity test almost never fires. Describe
 * it that way when you brief anyone on it.
 *
 * The threshold is still worth keeping, for one reason: it fails safe if the
 * field composition ever changes. If the anchored selection is widened to
 * lower ranks, or a genuinely cold person is drawn, that card reverts to
 * 50/50 automatically instead of being handed a prior that was never fitted
 * on it. It is insurance against a future field, not a live discriminator.
 *
 * --------------------------------------------------------------------------
 * Why Up opens at 0.40 rather than at the measured 0.316
 * --------------------------------------------------------------------------
 * The goal is to remove the free edge, not to extract maximum house profit,
 * and this estimate is far noisier than the H2H one it borrows its shape
 * from (weekly sd 22.0 points versus 6.6). So it is deliberately shaded
 * much less aggressively than H2H was:
 *
 *   measured mean weekly Up   31.6%
 *   opens at                  40.0%   → strips 54% of the mispricing
 *   edge left for a user       8.4pp
 *
 * H2H strips ~83% of its mispricing because its weekly range never made
 * that dangerous. Here a single surge week can push the true rate above 50%
 * (best observed week: 76.9% Up), so a 0.40 open stays on the right side of
 * the line in far more states of the world than a 0.32 open would. Down at
 * 0.60 pays 1.67x and Up pays 2.5x, so both sides remain tradeable.
 *
 * --------------------------------------------------------------------------
 * Depth preservation
 * --------------------------------------------------------------------------
 * `seedBFromPrices` sets `b = targetMaxLoss / ln(1 / pMin)`, so a lopsided
 * seed buys its price match by shrinking `b`. Reuses
 * `computeDepthPreservingTargetMaxLoss` from the H2H module — the maths is
 * identical for any binary market — passing the *higher* of the two prices
 * (Down at 0.60). That scales `targetMaxLoss` 2000 → 2644 and holds `b` at
 * ~2886 against the uniform 2885, so the fitted price survives normal flow.
 * House seed for the 20 Up/Down cards goes 40,000 → 52,880 credits.
 *
 * --------------------------------------------------------------------------
 * The blocker: agents will fight this seed
 * --------------------------------------------------------------------------
 * Read this before wiring the module in. Agents price Up/Down off
 * `computeLockInFairUp(pctChangeVsOpen, hoursRemaining)`. At Monday open
 * `pctChangeVsOpen` is 0 by definition, so `log(1 + 0) / sigma = 0` and the
 * model returns **exactly 0.50** — the agents are structurally uninformed at
 * open and will trade a 0.40 seed back toward 0.50, partially undoing it.
 *
 * This is the opposite of the H2H case, where `computeLockInFairH2H` reads
 * the same score gap the prior is built on and therefore agreed with the
 * seed. There is no velocity term in the Up/Down fair model.
 *
 * Two consequences:
 *   - Expect the opening price to drift up during the first agent sweep.
 *     Measure where it settles before judging whether the prior worked.
 *   - Making it hold properly means adding a velocity term to the agents'
 *     Up/Down fair model, which is agent tuning and explicitly out of scope
 *     without an ask (see the agent rules in `.cursorrules`).
 *
 * --------------------------------------------------------------------------
 * Scope
 * --------------------------------------------------------------------------
 *   - Rides the existing price-matched seeding path (`initialPrices` on
 *     `seedAmmMarket`) already used by World Markets and now H2H. No new
 *     ledger rows, no warm-start interaction.
 *   - Distinct from `WARM_START_PRIORS_ENABLED`, which leans on a change7d
 *     signal shown to have no edge. Do not enable both.
 *   - Gated behind `UPDOWN_OPENING_PRIOR_ENABLED` (default false). Markets
 *     generate Mondays, so the flag must be on before Monday 00:00 UTC to
 *     affect a week.
 */

import { getTargetMaxLoss } from "../config/amm";
import { computeDepthPreservingTargetMaxLoss } from "./h2h-opening-prices";

/**
 * Lenient flag parser, matching `envFlag` in `h2h-opening-prices.ts` and
 * `server/agents/constants.ts` so a Railway value of `TRUE` behaves.
 */
function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** Master switch. Read at call time so tests can toggle it. */
export function isUpDownOpeningPriorEnabled(): boolean {
  return envFlag(process.env.UPDOWN_OPENING_PRIOR_ENABLED);
}

/** See the depth-preservation note above. Defaults ON when the prior is on. */
export function isUpDownDepthPreservationEnabled(): boolean {
  const raw = process.env.UPDOWN_PRESERVE_DEPTH_ENABLED;
  if (typeof raw !== "string" || raw.trim() === "") return true;
  return envFlag(raw);
}

/**
 * Opening `velocityScore` at or above which the downward prior applies.
 *
 * 40 is where the three indistinguishable high bands begin (34.4 / 29.0 /
 * 28.6% Up) and it is also close to the roster-wide velocity mean of ~43,
 * i.e. the point the mean reversion crosses zero. Both readings agree, which
 * is the only reason a round number is defensible here.
 */
export const UPDOWN_HOT_VELOCITY_MIN = 40;

/** Price applied to the Up outcome for cards at or above the threshold. */
export const UPDOWN_HOT_UP_PRICE = 0.4;

/** Mean weekly Up rate behind `UPDOWN_HOT_UP_PRICE`. Audit trail only. */
export const UPDOWN_HOT_MEASURED_UP_RATE = 0.316;

/** Resolved markets behind `UPDOWN_HOT_MEASURED_UP_RATE`. */
export const UPDOWN_HOT_SAMPLE_SIZE = 161;

/**
 * Round to 4 decimal places.
 *
 * `1 - 0.4` is `0.6` exactly in IEEE-754, but the H2H module hit
 * `0.19999999999999996` on a neighbouring value and `normalizeSeedPrices`
 * silently renormalizes a vector that does not sum to 1. Snap both prices
 * so the seed input stays exact regardless of the constant chosen.
 */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Is a configured Up price usable?
 *
 * It must be a genuine lean toward Down (`< 0.5`) and positive, which is also
 * exactly the domain `computeDepthPreservingTargetMaxLoss` accepts once
 * inverted to the Down side. Exported so the guard can be tested without
 * mutating module constants.
 */
export function isValidUpLeanPrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && price < 0.5;
}

export interface UpDownOpeningPriceDecision {
  /** Opening prices aligned with displayOrder: [Up, Down]. */
  prices: [number, number];
  /** Price applied to the Up outcome. */
  upPrice: number;
  /** Trailing-6h median `velocityScore` the decision was made on. */
  openingVelocity: number;
  /** Measured mean weekly Up rate for this band, persisted for audit. */
  measuredUpRate: number;
  sampleSize: number;
  /**
   * `targetMaxLoss` to pass to `seedAmmMarket`. Equals the depth-preserving
   * value when `UPDOWN_PRESERVE_DEPTH_ENABLED` is on, otherwise the stock
   * per-market-type value.
   */
  targetMaxLoss: number;
  /** True when `targetMaxLoss` was scaled up to hold `b` constant. */
  depthPreserved: boolean;
}

export interface PickUpDownOpeningPricesInput {
  /**
   * Trailing-6h median `velocityScore` at market open. Null/undefined when
   * the person has too few recent ingest samples — treated as "no opinion".
   */
  openingVelocity: number | null | undefined;
  /**
   * Uniform `targetMaxLoss` this market would otherwise have used.
   * Defaults to the configured Up/Down value.
   */
  uniformTargetMaxLoss?: number;
  /** Test seam; defaults to the env-backed helper. */
  preserveDepth?: boolean;
}

/**
 * Decide an Up/Down market's opening prices from its opening velocity.
 *
 * Returns null — meaning "seed 50/50 exactly as before" — when velocity is
 * missing, non-finite, or below `UPDOWN_HOT_VELOCITY_MIN`. Callers should
 * treat null as the normal, safe path and omit `initialPrices` entirely.
 *
 * Pure apart from the optional env read for depth preservation.
 */
export function pickUpDownOpeningPrices(
  input: PickUpDownOpeningPricesInput,
): UpDownOpeningPriceDecision | null {
  const velocity = input.openingVelocity;
  if (velocity == null || !Number.isFinite(velocity)) return null;
  if (velocity < UPDOWN_HOT_VELOCITY_MIN) return null;

  const upPrice = round4(UPDOWN_HOT_UP_PRICE);
  const downPrice = round4(1 - upPrice);

  // Fail safe on a misconfigured constant instead of throwing.
  // `computeDepthPreservingTargetMaxLoss` rejects a price of exactly 0.5, and
  // 0.5 is precisely the value someone would try in order to "turn the lean
  // off" without reading this file. When this module is wired in it runs
  // inside the generator's single transaction, so one throw rolls back every
  // Up/Down market for the week — degrading to 50/50 is the only safe
  // response to a bad constant.
  if (!isValidUpLeanPrice(upPrice)) return null;

  const uniformTargetMaxLoss = input.uniformTargetMaxLoss ?? getTargetMaxLoss("updown");
  const preserveDepth = input.preserveDepth ?? isUpDownDepthPreservationEnabled();
  // Depth preservation is defined in terms of the *larger* price, since
  // `b = targetMaxLoss / ln(1 / pMin)` keys off the smaller one.
  const targetMaxLoss = preserveDepth
    ? computeDepthPreservingTargetMaxLoss(downPrice, uniformTargetMaxLoss)
    : uniformTargetMaxLoss;

  return {
    prices: [upPrice, downPrice],
    upPrice,
    openingVelocity: velocity,
    measuredUpRate: UPDOWN_HOT_MEASURED_UP_RATE,
    sampleSize: UPDOWN_HOT_SAMPLE_SIZE,
    targetMaxLoss,
    depthPreserved: preserveDepth,
  };
}
