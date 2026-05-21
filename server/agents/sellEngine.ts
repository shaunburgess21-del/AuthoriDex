/**
 * Sell engine — pure decision functions for agent position exits.
 *
 * Mirror of `decisionEngine.computePrediction` in role: takes a snapshot
 * of an agent's open position plus persona context, returns either a
 * `SellDecision` or `null`. The runner (`agentRunner.runSellSweep`) is
 * responsible for fetching positions, the action worker is responsible
 * for executing the sell — this module only DECIDES.
 *
 * Design priorities (in order):
 *   1. Pure & deterministic given an RNG. No DB, no clock, no globals.
 *   2. Persona-aware. Sharps are disciplined; casuals procrastinate.
 *      Same band breach should produce different behaviour by band.
 *   3. Imperfect on purpose. Even a "should sell" agent often does NOT
 *      sell on any given sweep — that's the human-realism bit. The
 *      cohort doesn't move in lockstep.
 *
 * No imports from `agentRunner` / `actionWorker` / `db` — keeps the
 * engine unit-testable with seeded RNGs and easy to hold in your head.
 */

import {
  SELL_PERSONA_TUNING,
  SELL_DEFAULT_CONVICTION,
  SCORE_REVERSAL_SELL_PCT,
} from "./constants";
import type { SimulationPersonaBand } from "./simulationProfile";
import type { SellDecision } from "./types";
import { productionRNG, type RNG } from "./prng";

export interface SellEngineInput {
  /** Persona band — drives the entire tuning lookup. */
  personaBand: SimulationPersonaBand;
  /**
   * Agent's anchor price for this position. Conceptually the price the
   * agent thinks they paid. We use weighted-average buy cost (computed
   * upstream from `market_bets`) — a single number that's stable across
   * conviction add-ons and partial sells.
   */
  anchor: number;
  /** Current AMM share price for the entry the agent holds. */
  livePrice: number;
  /**
   * Conviction (0..1) used to derive band width. Pulled by the runner
   * from the agent's most recent buy decision payload; falls back to
   * `SELL_DEFAULT_CONVICTION` when absent (legacy positions).
   */
  conviction?: number;
  /** Net shares held — used only for the de-minimis sanity check below. */
  netShares: number;
  /** Weekly-open score vs held side — enables score-reversal exits. */
  scoreContext?: {
    pctChangeVsOpen: number;
    heldEntryIsUp: boolean;
  };
}

/** UP held while score is decisively below open, or DOWN held while above. */
export function isScoreReversal(input: SellEngineInput): boolean {
  const ctx = input.scoreContext;
  if (!ctx || !Number.isFinite(ctx.pctChangeVsOpen)) return false;
  const pct = ctx.pctChangeVsOpen;
  if (ctx.heldEntryIsUp && pct <= -SCORE_REVERSAL_SELL_PCT) return true;
  if (!ctx.heldEntryIsUp && pct >= SCORE_REVERSAL_SELL_PCT) return true;
  return false;
}

const SCORE_REVERSAL_FORGET_SKIP: Partial<
  Record<SimulationPersonaBand, number>
> = {
  casual: 0.15,
  liquidity: 0.15,
};

/**
 * Compute the conviction band edges for a position. Band widths are
 * deliberately asymmetric:
 *
 *   - topRadius   ranges 0.10–0.20: wider for low-conviction positions.
 *                 The intuition is that agents who were less sure when
 *                 they bought give the price more room to run before
 *                 they declare "the edge has played out".
 *   - bottomRadius is a flat 0.10: thesis-broken threshold doesn't
 *                  scale with conviction the same way — a 10pp drop
 *                  against you is "the read was wrong" regardless of
 *                  how confident you were.
 *
 * Persona scaling:
 *   - sharps shrink the band (they trust their original read more
 *     and exit faster on validation).
 *   - casuals / liquidity widen it (they tolerate more drift).
 *
 * Exported for tests; not used outside this module in production.
 */
export function computeBandRadii(
  conviction: number,
  bandRadiusScale: number,
): { topRadius: number; bottomRadius: number } {
  const clampedConviction = Math.max(0, Math.min(1, conviction));
  const baseTopRadius = 0.10 + (1 - clampedConviction) * 0.10;
  const topRadius = baseTopRadius * bandRadiusScale;
  const bottomRadius = 0.10 * bandRadiusScale;
  return { topRadius, bottomRadius };
}

/**
 * Sample a uniform random value from a [min, max] range using the given
 * RNG. Inclusive on min, exclusive on max in line with `Math.random()`.
 */
function pickInRange(range: [number, number], rng: RNG): number {
  const [min, max] = range;
  if (max <= min) return min;
  return min + rng.nextFloat() * (max - min);
}

/**
 * The headline sell-decision function. Returns:
 *   - `null` when the agent should NOT sell this sweep (most common case)
 *   - `SellDecision` when the persona cascade fires through to a sell
 *
 * Decision cascade (each gate can return null):
 *   1. Forgot-to-look gate           — uniform skip per band
 *   2. Compute band                  — anchor +/- conviction-derived radii
 *   3. Classify breach               — top / bottom / inside
 *   4a. Top breach   -> persona pSellTop roll
 *   4b. Bottom breach -> hope-for-reversal roll, then pSellBottom roll
 *   4c. Inside band   -> upper-half early-profit roll
 *   5. Pick sell fraction from persona range
 *
 * No null entries / NaN guards needed: the runner pre-filters positions
 * with stale or missing data before calling this.
 */
export function computeSellDecision(
  input: SellEngineInput,
  rng: RNG = productionRNG,
): SellDecision | null {
  const tuning = SELL_PERSONA_TUNING[input.personaBand];
  if (!tuning) return null;

  const scoreReversal = isScoreReversal(input);
  const forgetSkip =
    scoreReversal && SCORE_REVERSAL_FORGET_SKIP[input.personaBand] != null
      ? SCORE_REVERSAL_FORGET_SKIP[input.personaBand]!
      : tuning.forgetSkipPct;

  if (rng.nextFloat() < forgetSkip) return null;

  const conviction = input.conviction ?? SELL_DEFAULT_CONVICTION;
  const { topRadius, bottomRadius } = computeBandRadii(
    conviction,
    tuning.bandRadiusScale,
  );
  const bandTop = input.anchor + topRadius;
  const bandBottom = input.anchor - bottomRadius;
  const livePrice = input.livePrice;

  // Helper to assemble the SellDecision once a reason has been picked.
  const buildDecision = (
    reason: SellDecision["reason"],
    range: [number, number],
  ): SellDecision => ({
    reason,
    sellFraction: pickInRange(range, rng),
    anchor: input.anchor,
    livePrice,
    bandTop,
    bandBottom,
    conviction,
    personaBand: input.personaBand,
  });

  // Score vs weekly open reversed against the held side — exit even when
  // AMM price still looks fine (UP shares in profit while score crashed).
  if (scoreReversal) {
    const elevatedPSell = Math.min(0.85, tuning.pSellBottom + 0.35);
    // Score already broke the thesis — skip the hope-for-reversal gate
    // that normally blocks loss-zone exits.
    if (rng.nextFloat() >= elevatedPSell) return null;
    return buildDecision("score_reversal", tuning.bottomFractionRange);
  }

  // Top of band (profit zone): edge has played out, take it off.
  if (livePrice >= bandTop) {
    if (rng.nextFloat() >= tuning.pSellTop) return null;
    return buildDecision("take_profit", tuning.topFractionRange);
  }

  // Bottom of band (loss zone): thesis broken. Two gates here in series
  // because human bettors specifically struggle to exit at a loss —
  // the hope-for-reversal gate captures "this'll come back". Order
  // matters: hope first (~15-50% per band), THEN pSellBottom (~15-55%).
  if (livePrice <= bandBottom) {
    if (rng.nextFloat() < tuning.hopeForReversalPct) return null;
    if (rng.nextFloat() >= tuning.pSellBottom) return null;
    return buildDecision("cut_loss", tuning.bottomFractionRange);
  }

  // Inside the band: opportunistic partial profit-take ONLY in the
  // upper half (above anchor, more than halfway to bandTop). Sized
  // smaller than full breach exits — this is a "I'm up a bit and a
  // little nervous" partial scale-out, not a thesis-validated exit.
  const distanceToTop = bandTop - input.anchor;
  if (distanceToTop > 0) {
    const inUpperHalfOfBand =
      livePrice > input.anchor &&
      (livePrice - input.anchor) / distanceToTop > 0.5;
    if (inUpperHalfOfBand && rng.nextFloat() < tuning.earlyProfitPct) {
      return buildDecision("early_profit", tuning.earlyFractionRange);
    }
  }

  return null;
}

// Test-only exports — keep these out of any non-test path.
export const _computeBandRadiiForTesting = computeBandRadii;
export const _pickInRangeForTesting = pickInRange;
export const _isScoreReversalForTesting = isScoreReversal;
