/**
 * Drift term for the Up/Down fair-value model.
 *
 * The model is a driftless random walk, so at open (`pctChangeVsOpen === 0`) it
 * is forced to return exactly 0.5 — known to be wrong, since the measured Up
 * rate for a high-velocity card is 31.6%. These tests cover the optional drift
 * term that fixes that, and above all that the DEFAULT is untouched:
 * `computeLockInFairUp` is shared by the decision engine, the agent runner, the
 * arb agent and liveConvergence, and the last of those moves real prices.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  LOCKIN_BETA,
  LOCKIN_FAIR_MAX,
  LOCKIN_FAIR_MIN,
  LOCKIN_SIGMA_1D,
  computeLockInFairUp,
  driftPerDayForTargetOpen,
  normalCdf,
  normalPpf,
  sigmaRemain,
} from "../server/agents/lockInFair";

const WEEK_HOURS = 24 * 7;

// ---------------------------------------------------------------------------
// The default must not move. This is the regression guard for all six
// existing call sites, one of which moves live prices.
// ---------------------------------------------------------------------------

// `normalCdf` is the Abramowitz & Stegun 7.1.26 rational approximation, which
// carries ~3e-8 of absolute error — normalCdf(0) is 0.50000003, not 0.5. So
// "no opinion at open" is asserted to that tolerance, not to exactness.
const CDF_EPS = 1e-6;

test("default is driftless — a flat card at open still has no opinion", () => {
  assert.ok(Math.abs(computeLockInFairUp(0, WEEK_HOURS)! - 0.5) < CDF_EPS);
});

test("omitting the drift matches passing 0 explicitly, across the curve", () => {
  for (const pct of [-0.3, -0.05, -0.001, 0, 0.001, 0.05, 0.3, 1.25]) {
    for (const h of [WEEK_HOURS, 96, 24, 6, 1, 0.25, 0]) {
      assert.equal(
        computeLockInFairUp(pct, h),
        computeLockInFairUp(pct, h, LOCKIN_SIGMA_1D, LOCKIN_BETA, 0),
        `drift-free default changed at pct=${pct} h=${h}`,
      );
    }
  }
});

test("null and non-finite inputs still return null regardless of drift", () => {
  assert.equal(computeLockInFairUp(null, WEEK_HOURS, LOCKIN_SIGMA_1D, LOCKIN_BETA, -0.01), null);
  assert.equal(computeLockInFairUp(undefined, WEEK_HOURS, LOCKIN_SIGMA_1D, LOCKIN_BETA, -0.01), null);
  assert.equal(computeLockInFairUp(Number.NaN, WEEK_HOURS, LOCKIN_SIGMA_1D, LOCKIN_BETA, -0.01), null);
});

test("a non-finite drift degrades to driftless rather than producing NaN", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(
      computeLockInFairUp(0.02, 48, LOCKIN_SIGMA_1D, LOCKIN_BETA, bad),
      computeLockInFairUp(0.02, 48),
    );
  }
});

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

test("normalPpf round-trips through the module's own normalCdf", () => {
  // The reason for bisecting instead of using a closed-form inverse: a second
  // approximation would not invert THIS cdf, so a drift calibrated to open at
  // 0.40 would not actually open at 0.40.
  // Against normalCdf directly, not through computeLockInFairUp — that wrapper
  // clamps to [0.015, 0.985], which would mask the inverse's accuracy at the
  // tails (p=0.01 would come back as 0.015).
  for (const p of [0.01, 0.1, 0.316, 0.4, 0.5, 0.6, 0.9, 0.99]) {
    const back = normalCdf(normalPpf(p));
    assert.ok(Math.abs(back - p) < 1e-6, `round-trip failed for ${p}: got ${back}`);
  }
});

test("normalPpf is 0 at the median and antisymmetric", () => {
  assert.ok(Math.abs(normalPpf(0.5)) < 1e-9);
  assert.ok(Math.abs(normalPpf(0.4) + normalPpf(0.6)) < 1e-6);
});

test("normalPpf returns 0 for out-of-range input instead of throwing", () => {
  for (const p of [0, 1, -0.5, 1.5, Number.NaN]) {
    assert.equal(normalPpf(p), 0);
  }
});

test("drift calibrated to 0.40 makes an unmoved card open at exactly 0.40", () => {
  const drift = driftPerDayForTargetOpen(0.4, WEEK_HOURS);
  const fair = computeLockInFairUp(0, WEEK_HOURS, LOCKIN_SIGMA_1D, LOCKIN_BETA, drift);
  assert.ok(Math.abs(fair! - 0.4) < 1e-6, `expected 0.40, got ${fair}`);
});

test("the calibration works for the measured rate too, not just the seed", () => {
  const drift = driftPerDayForTargetOpen(0.316, WEEK_HOURS);
  const fair = computeLockInFairUp(0, WEEK_HOURS, LOCKIN_SIGMA_1D, LOCKIN_BETA, drift);
  assert.ok(Math.abs(fair! - 0.316) < 1e-6, `expected 0.316, got ${fair}`);
});

test("a target below 0.5 gives negative drift, above gives positive, 0.5 gives none", () => {
  assert.ok(driftPerDayForTargetOpen(0.4, WEEK_HOURS) < 0);
  assert.ok(driftPerDayForTargetOpen(0.6, WEEK_HOURS) > 0);
  assert.ok(Math.abs(driftPerDayForTargetOpen(0.5, WEEK_HOURS)) < 1e-9);
});

test("degenerate calibration inputs yield zero drift, never NaN", () => {
  for (const p of [0, 1, -1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(driftPerDayForTargetOpen(p, WEEK_HOURS), 0);
  }
  for (const h of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(driftPerDayForTargetOpen(0.4, h), 0);
  }
});

// ---------------------------------------------------------------------------
// The property that makes this safe: the correction dies out toward close.
// ---------------------------------------------------------------------------

const DRIFT_40 = driftPerDayForTargetOpen(0.4, WEEK_HOURS);

test("the drift correction shrinks monotonically as the close approaches", () => {
  const hours = [WEEK_HOURS, 144, 120, 96, 72, 48, 24, 12, 6, 1];
  let prevGap = Infinity;
  for (const h of hours) {
    const base = computeLockInFairUp(0, h)!;
    const drifted = computeLockInFairUp(0, h, LOCKIN_SIGMA_1D, LOCKIN_BETA, DRIFT_40)!;
    const gap = base - drifted;
    assert.ok(gap > 0, `drift should lower fair at h=${h}`);
    assert.ok(gap < prevGap, `correction should shrink toward close (h=${h})`);
    prevGap = gap;
  }
});

test("the correction is effectively gone in the final minutes", () => {
  const base = computeLockInFairUp(0, 0.25)!;
  const drifted = computeLockInFairUp(0, 0.25, LOCKIN_SIGMA_1D, LOCKIN_BETA, DRIFT_40)!;
  assert.ok(
    Math.abs(base - drifted) < 0.01,
    `settlement-adjacent pricing must be untouched, gap was ${base - drifted}`,
  );
});

test("a decisive realised move still dominates the drift near close", () => {
  // A card up 10% with an hour left must still pin to the tradeable ceiling.
  // Asserted against the clamps rather than a round number, because fair is
  // never allowed to reach 0 or 1 — that would make AMM buys impossible.
  const up = computeLockInFairUp(0.1, 1, LOCKIN_SIGMA_1D, LOCKIN_BETA, DRIFT_40)!;
  assert.equal(up, LOCKIN_FAIR_MAX, `expected the ceiling, got ${up}`);

  const down = computeLockInFairUp(-0.1, 1, LOCKIN_SIGMA_1D, LOCKIN_BETA, DRIFT_40)!;
  assert.equal(down, LOCKIN_FAIR_MIN, `expected the floor, got ${down}`);
});

// ---------------------------------------------------------------------------
// Shape preservation
// ---------------------------------------------------------------------------

test("fair is still monotonically increasing in the realised move", () => {
  const pcts = [-0.2, -0.1, -0.05, -0.01, 0, 0.01, 0.05, 0.1, 0.2];
  for (const h of [WEEK_HOURS, 72, 12]) {
    let prev = -Infinity;
    for (const pct of pcts) {
      const fair = computeLockInFairUp(pct, h, LOCKIN_SIGMA_1D, LOCKIN_BETA, DRIFT_40)!;
      assert.ok(fair > prev, `monotonicity broken at pct=${pct} h=${h}`);
      prev = fair;
    }
  }
});

test("drift never pushes fair outside the tradeable clamps", () => {
  for (const drift of [DRIFT_40, -5, 5]) {
    for (const pct of [-0.99, -0.5, 0, 0.5, 5]) {
      for (const h of [WEEK_HOURS, 24, 0.25]) {
        const fair = computeLockInFairUp(pct, h, LOCKIN_SIGMA_1D, LOCKIN_BETA, drift)!;
        assert.ok(
          fair >= LOCKIN_FAIR_MIN && fair <= LOCKIN_FAIR_MAX,
          `fair ${fair} out of clamps at drift=${drift} pct=${pct} h=${h}`,
        );
      }
    }
  }
});

test("a negative drift can never make Up look better than driftless", () => {
  for (const pct of [-0.1, 0, 0.1]) {
    for (const h of [WEEK_HOURS, 48, 6, 1]) {
      const base = computeLockInFairUp(pct, h)!;
      const drifted = computeLockInFairUp(pct, h, LOCKIN_SIGMA_1D, LOCKIN_BETA, DRIFT_40)!;
      assert.ok(drifted <= base + 1e-12, `drift raised fair at pct=${pct} h=${h}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The constant that will be wired in
// ---------------------------------------------------------------------------

test("UPDOWN_AGENT_DRIFT_PER_DAY reproduces the seed price at open", async () => {
  const { UPDOWN_AGENT_DRIFT_PER_DAY, UPDOWN_HOT_UP_PRICE, UPDOWN_WEEK_HOURS } =
    await import("../server/native-markets/updown-opening-prices");

  const fair = computeLockInFairUp(
    0,
    UPDOWN_WEEK_HOURS,
    LOCKIN_SIGMA_1D,
    LOCKIN_BETA,
    UPDOWN_AGENT_DRIFT_PER_DAY,
  );

  // The whole point of deriving the drift from the seed constant: the house
  // and the agents cannot disagree at open.
  assert.ok(
    Math.abs(fair! - UPDOWN_HOT_UP_PRICE) < 1e-6,
    `agent fair ${fair} should equal seed price ${UPDOWN_HOT_UP_PRICE}`,
  );
  assert.ok(UPDOWN_AGENT_DRIFT_PER_DAY < 0);
});

test("nothing has enabled the drift yet — the shipped default is still ~0.5", () => {
  // Guards the "parameter only, no call site enabled" decision: the default
  // path must remain the driftless martingale every existing call site expects.
  assert.ok(Math.abs(computeLockInFairUp(0, WEEK_HOURS)! - 0.5) < CDF_EPS);
  assert.ok(Math.abs(computeLockInFairUp(0, 24)! - 0.5) < CDF_EPS);
});
