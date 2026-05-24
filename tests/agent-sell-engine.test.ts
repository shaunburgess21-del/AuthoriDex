/**
 * Agent v3 phase 1 — sell engine unit tests.
 *
 * Pure tests against `computeSellDecision` and `computeBandRadii`. No
 * DB, no network, no actionWorker. Seeded RNGs throughout so the
 * cascade is deterministic per test.
 *
 * The engine has five gates in sequence:
 *   1. Forgot-to-look skip
 *   2. Band classification (top breach / bottom breach / inside band)
 *   3. Persona pSell roll (top branch)
 *   4. Hope-for-reversal + persona pSell roll (bottom branch)
 *   5. Inside-band early-profit roll (upper half only)
 *
 * Each test exercises ONE gate at a time by feeding seeds that walk
 * the rolls in a predictable order. We keep `rng.nextFloat` simple
 * (fixed value) where the test only asserts presence/absence of a
 * decision, and use `createPRNG(seed)` where we need to assert
 * sell-fraction range or band math.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeSellDecision,
  computeBandRadii,
  isScoreReversal,
} from "../server/agents/sellEngine";
import { SELL_PERSONA_TUNING } from "../server/agents/constants";
import { createPRNG } from "../server/agents/prng";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tiny deterministic RNG that returns a scripted sequence of floats and
 * loops at the end. Used when we want to walk the cascade through a
 * specific path without hunting for a magic seed.
 */
function scriptedRNG(values: number[]): { nextFloat: () => number } {
  let i = 0;
  return {
    nextFloat: () => {
      const v = values[i % values.length];
      i++;
      return v;
    },
  };
}

const ANCHOR = 0.50;

// ---------------------------------------------------------------------------
// computeBandRadii — band width math (gate 2)
// ---------------------------------------------------------------------------

test("computeBandRadii widens with low conviction", () => {
  const { topRadius: tHigh } = computeBandRadii(0.9, 1.0);
  const { topRadius: tLow } = computeBandRadii(0.1, 1.0);
  assert.ok(
    tLow > tHigh,
    `low conviction band should be wider; tHigh=${tHigh} tLow=${tLow}`,
  );
});

test("computeBandRadii: sharp scaling factor 0.85 produces tighter bands than casual 1.10", () => {
  const sharp = computeBandRadii(0.6, SELL_PERSONA_TUNING.sharp.bandRadiusScale);
  const casual = computeBandRadii(0.6, SELL_PERSONA_TUNING.casual.bandRadiusScale);
  assert.ok(sharp.topRadius < casual.topRadius);
  assert.ok(sharp.bottomRadius < casual.bottomRadius);
});

test("computeBandRadii clamps conviction outside [0, 1]", () => {
  const negative = computeBandRadii(-0.5, 1.0);
  const tooHigh = computeBandRadii(1.5, 1.0);
  // -0.5 -> clamped to 0 -> topRadius = 0.10 + 1.0 * 0.10 = 0.20
  // 1.5  -> clamped to 1 -> topRadius = 0.10 + 0.0 * 0.10 = 0.10
  assert.equal(negative.topRadius, 0.20);
  assert.equal(tooHigh.topRadius, 0.10);
});

// ---------------------------------------------------------------------------
// Gate 1 — forgot-to-look skip
// ---------------------------------------------------------------------------

test("forgot-to-look gate fires deterministically when RNG < forgetSkipPct", () => {
  // sharp.forgetSkipPct = 0.20. RNG returns 0.1 first -> skip fires.
  const decision = computeSellDecision(
    { personaBand: "sharp", anchor: ANCHOR, livePrice: 0.80, conviction: 0.7, netShares: 100 },
    scriptedRNG([0.1]),
  );
  assert.equal(decision, null, "expected null when forget gate fires");
});

test("forgot-to-look gate passes when RNG >= forgetSkipPct, then evaluates band", () => {
  // sharp.forgetSkipPct = 0.20. First roll 0.5 (passes forget), second
  // roll 0.0 forces pSellTop to fire (sharp.pSellTop = 0.65). Third
  // roll 0.5 is the sell-fraction picker which lands mid-range:
  // mid of [0.85, 1.00] = ~0.925.
  const decision = computeSellDecision(
    { personaBand: "sharp", anchor: ANCHOR, livePrice: 0.80, conviction: 0.7, netShares: 100 },
    scriptedRNG([0.5, 0.0, 0.5]),
  );
  assert.ok(decision != null, "expected non-null decision");
  assert.equal(decision!.reason, "take_profit");
  assert.ok(decision!.sellFraction >= 0.85 && decision!.sellFraction <= 1.0);
});

// ---------------------------------------------------------------------------
// Gate 3 — top breach -> persona pSell roll
// ---------------------------------------------------------------------------

test("top breach + RNG >= pSellTop returns null (persona declined)", () => {
  // sharp.pSellTop = 0.65. Forget gate passes (0.5), pSell roll 0.99
  // exceeds 0.65 so the agent declines despite being in the profit zone.
  const decision = computeSellDecision(
    { personaBand: "sharp", anchor: ANCHOR, livePrice: 0.80, conviction: 0.7, netShares: 100 },
    scriptedRNG([0.5, 0.99]),
  );
  assert.equal(decision, null);
});

test("sell fraction stays inside persona top range (sharp 0.85-1.00)", () => {
  // Run 50 seeds; for each non-null top-breach decision verify the
  // fraction is in [0.85, 1.00]. Catches range bugs even if the mean
  // looks plausible.
  const range = SELL_PERSONA_TUNING.sharp.topFractionRange;
  let sampled = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const rng = createPRNG(seed);
    const decision = computeSellDecision(
      { personaBand: "sharp", anchor: ANCHOR, livePrice: 0.80, conviction: 0.7, netShares: 100 },
      rng,
    );
    if (decision == null || decision.reason !== "take_profit") continue;
    sampled++;
    assert.ok(
      decision.sellFraction >= range[0] && decision.sellFraction <= range[1],
      `seed=${seed} fraction=${decision.sellFraction} outside [${range[0]}, ${range[1]}]`,
    );
  }
  assert.ok(sampled > 0, "expected at least one top-breach sample across 50 seeds");
});

// ---------------------------------------------------------------------------
// Gate 4 — bottom breach + hope-for-reversal
// ---------------------------------------------------------------------------

test("bottom breach + hope-for-reversal fires returns null (denial)", () => {
  // casual.hopeForReversalPct = 0.40. Forget passes (0.5), hope roll
  // 0.1 < 0.40 so the agent stubbornly holds despite the loss.
  const decision = computeSellDecision(
    { personaBand: "casual", anchor: ANCHOR, livePrice: 0.30, conviction: 0.5, netShares: 100 },
    scriptedRNG([0.6, 0.1]),
  );
  assert.equal(decision, null);
});

test("bottom breach past hope-for-reversal + pSell fires returns cut_loss", () => {
  // casual.hopeForReversalPct = 0.40, casual.pSellBottom = 0.20.
  // Sequence: forget pass (0.55), hope skip (0.45 > 0.40), pSell fire
  // (0.05 < 0.20), then fraction picker.
  const decision = computeSellDecision(
    { personaBand: "casual", anchor: ANCHOR, livePrice: 0.30, conviction: 0.5, netShares: 100 },
    scriptedRNG([0.55, 0.45, 0.05, 0.5]),
  );
  assert.ok(decision != null, "expected non-null decision");
  assert.equal(decision!.reason, "cut_loss");
  const range = SELL_PERSONA_TUNING.casual.bottomFractionRange;
  assert.ok(decision!.sellFraction >= range[0] && decision!.sellFraction <= range[1]);
});

// ---------------------------------------------------------------------------
// Gate 5 — inside-band early-profit (upper half only)
// ---------------------------------------------------------------------------

test("inside-band lower half never triggers early-profit", () => {
  // Live price below anchor — explicitly NOT the upper half. Even with
  // a very high earlyProfitPct roll, no decision should fire.
  const decision = computeSellDecision(
    { personaBand: "noisy", anchor: ANCHOR, livePrice: 0.45, conviction: 0.6, netShares: 100 },
    scriptedRNG([0.0, 0.0, 0.0, 0.0]),
  );
  assert.equal(decision, null, "lower-half-of-band should never fire early-profit");
});

test("inside-band upper half + early-profit roll fires", () => {
  // noisy.earlyProfitPct = 0.15. anchor = 0.50, conviction = 0.6,
  // bandRadiusScale 1.0 -> topRadius = 0.10 + 0.4 * 0.10 = 0.14.
  // bandTop = 0.64. Upper-half threshold = anchor + 0.5 * (bandTop -
  // anchor) = 0.57. livePrice = 0.60 -> in upper half. Forget passes
  // (0.5), early-profit roll 0.05 < 0.15.
  const decision = computeSellDecision(
    { personaBand: "noisy", anchor: ANCHOR, livePrice: 0.60, conviction: 0.6, netShares: 100 },
    scriptedRNG([0.5, 0.05, 0.5]),
  );
  assert.ok(decision != null);
  assert.equal(decision!.reason, "early_profit");
  const range = SELL_PERSONA_TUNING.noisy.earlyFractionRange;
  assert.ok(decision!.sellFraction >= range[0] && decision!.sellFraction <= range[1]);
});

// ---------------------------------------------------------------------------
// Persona variance
// ---------------------------------------------------------------------------

test("sharp fires more often than casual on the same top-breach across many seeds", () => {
  // 200 seeds each. Sharp's tighter band + higher pSellTop + lower
  // forgetSkip should produce visibly more decisions.
  let sharpHits = 0;
  let casualHits = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const sharp = computeSellDecision(
      { personaBand: "sharp", anchor: ANCHOR, livePrice: 0.80, conviction: 0.6, netShares: 100 },
      createPRNG(seed),
    );
    const casual = computeSellDecision(
      { personaBand: "casual", anchor: ANCHOR, livePrice: 0.80, conviction: 0.6, netShares: 100 },
      createPRNG(seed),
    );
    if (sharp != null) sharpHits++;
    if (casual != null) casualHits++;
  }
  assert.ok(
    sharpHits > casualHits,
    `expected sharp > casual; sharpHits=${sharpHits} casualHits=${casualHits}`,
  );
  // Sanity: don't expect either to be wildly out of band given the
  // tuning. Sharp ~ 80% pass forget * 65% pSellTop = 52% expected.
  // Casual ~ 50% pass forget * 30% pSellTop = 15% expected.
  assert.ok(sharpHits >= 70, `sharpHits=${sharpHits} below expected band (>=70)`);
  assert.ok(casualHits <= 60, `casualHits=${casualHits} above expected band (<=60)`);
});

// ---------------------------------------------------------------------------
// Default conviction fallback
// ---------------------------------------------------------------------------

test("missing conviction defaults to widest band (lower-conviction equivalent)", () => {
  // No conviction passed -> SELL_DEFAULT_CONVICTION = 0.5. Sharp
  // bandRadiusScale = 0.85. topRadius = (0.10 + 0.5 * 0.10) * 0.85 =
  // 0.1275. bandTop ~ 0.628. livePrice 0.62 should be INSIDE the
  // band so a top-breach decision should NOT fire — but the
  // upper-half early-profit might. Forget pass + early-profit pass
  // sequence chosen accordingly.
  const noConviction = computeSellDecision(
    { personaBand: "sharp", anchor: ANCHOR, livePrice: 0.62, netShares: 100 },
    scriptedRNG([0.5, 0.0, 0.5]),
  );
  assert.ok(noConviction != null);
  assert.equal(noConviction!.reason, "early_profit");

  // Same scenario but with conviction = 1.0 -> topRadius = 0.10 *
  // 0.85 = 0.085 -> bandTop = 0.585. livePrice 0.62 is now ABOVE
  // bandTop so the cascade lands on take_profit instead.
  const highConviction = computeSellDecision(
    { personaBand: "sharp", anchor: ANCHOR, livePrice: 0.62, conviction: 1.0, netShares: 100 },
    scriptedRNG([0.5, 0.0, 0.5]),
  );
  assert.ok(highConviction != null);
  assert.equal(highConviction!.reason, "take_profit");
});

// ---------------------------------------------------------------------------
// Decision payload completeness
// ---------------------------------------------------------------------------

test("decision payload carries all telemetry fields populated", () => {
  // Test that every field the action worker / admin tile reads is
  // present and finite. Catches regressions where someone removes a
  // band edge or anchor by mistake.
  const decision = computeSellDecision(
    { personaBand: "sharp", anchor: 0.40, livePrice: 0.70, conviction: 0.7, netShares: 100 },
    scriptedRNG([0.5, 0.0, 0.5]),
  );
  assert.ok(decision != null);
  assert.equal(decision!.anchor, 0.40);
  assert.equal(decision!.livePrice, 0.70);
  assert.equal(decision!.conviction, 0.7);
  assert.equal(decision!.personaBand, "sharp");
  assert.ok(Number.isFinite(decision!.bandTop));
  assert.ok(Number.isFinite(decision!.bandBottom));
  assert.ok(decision!.bandTop > decision!.anchor);
  assert.ok(decision!.bandBottom < decision!.anchor);
  assert.ok(decision!.sellFraction > 0 && decision!.sellFraction <= 1);
});

test("isScoreReversal detects UP held while score below open", () => {
  assert.equal(
    isScoreReversal({
      personaBand: "casual",
      anchor: 0.55,
      livePrice: 0.58,
      netShares: 50,
      scoreContext: { pctChangeVsOpen: -0.13, heldEntryIsUp: true },
    }),
    true,
  );
  assert.equal(
    isScoreReversal({
      personaBand: "casual",
      anchor: 0.55,
      livePrice: 0.58,
      netShares: 50,
      scoreContext: { pctChangeVsOpen: -0.03, heldEntryIsUp: true },
    }),
    false,
  );
});

test("score_reversal exit fires for casual UP holder in drawdown", () => {
  const decision = computeSellDecision(
    {
      personaBand: "casual",
      anchor: 0.50,
      livePrice: 0.56,
      netShares: 100,
      scoreContext: { pctChangeVsOpen: -0.13, heldEntryIsUp: true },
    },
    // forgetSkip 0.15 on score reversal — need roll >= 0.15 to evaluate
    scriptedRNG([0.2, 0.01, 0.5]),
  );
  assert.ok(decision != null);
  assert.equal(decision!.reason, "score_reversal");
});
