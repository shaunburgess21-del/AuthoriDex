/**
 * Unit tests for the pure helpers in `server/services/amm-warmstart.ts`.
 *
 * The DB-touching `applyWarmStartPrior` is intentionally NOT covered
 * here — it lives behind the same transaction shape as `executeBuy`
 * and is exercised by the AMM smoke flow + by the seed-return drift
 * audit running against real production data.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL set BEFORE any import that transitively loads
// server/db.ts. pg.Pool is lazy, so this only fails if we actually
// issue a query — the pure helpers tested here never touch the DB.
// Same pattern as tests/amm-house.test.ts.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const {
  WARM_START_MIN_DELTA_PCT,
  WARM_START_SOFT_TARGET,
  WARM_START_STRONG_DELTA_PCT,
  WARM_START_STRONG_TARGET,
  computeWarmStartShares,
  pickWarmStartTarget,
} = await import("../server/services/amm-warmstart");
const { pricesAll } = await import("../shared/lib/amm/lmsr");

// ---------------------------------------------------------------------------
// pickWarmStartTarget
// ---------------------------------------------------------------------------

test("pickWarmStartTarget: null delta -> no warm-start", () => {
  assert.equal(pickWarmStartTarget(null), null);
  assert.equal(pickWarmStartTarget(undefined), null);
});

test("pickWarmStartTarget: NaN / non-finite -> no warm-start", () => {
  assert.equal(pickWarmStartTarget(NaN), null);
  assert.equal(pickWarmStartTarget(Number.POSITIVE_INFINITY), null);
});

test("pickWarmStartTarget: small positive delta below MIN -> no warm-start", () => {
  assert.equal(pickWarmStartTarget(WARM_START_MIN_DELTA_PCT - 0.01), null);
  assert.equal(pickWarmStartTarget(0.5), null);
});

test("pickWarmStartTarget: small negative delta below MIN -> no warm-start", () => {
  assert.equal(pickWarmStartTarget(-(WARM_START_MIN_DELTA_PCT - 0.01)), null);
});

test("pickWarmStartTarget: positive delta at MIN -> soft target on UP side", () => {
  const r = pickWarmStartTarget(WARM_START_MIN_DELTA_PCT);
  assert.ok(r, "should warm-start at the threshold");
  assert.equal(r!.direction, "up");
  assert.equal(r!.targetPrice, WARM_START_SOFT_TARGET);
  assert.equal(r!.magnitude, WARM_START_MIN_DELTA_PCT);
});

test("pickWarmStartTarget: positive delta at STRONG -> strong target on UP", () => {
  const r = pickWarmStartTarget(WARM_START_STRONG_DELTA_PCT);
  assert.ok(r);
  assert.equal(r!.direction, "up");
  assert.equal(r!.targetPrice, WARM_START_STRONG_TARGET);
});

test("pickWarmStartTarget: negative delta past STRONG -> strong target on DOWN", () => {
  const r = pickWarmStartTarget(-(WARM_START_STRONG_DELTA_PCT + 5));
  assert.ok(r);
  assert.equal(r!.direction, "down");
  assert.equal(r!.targetPrice, WARM_START_STRONG_TARGET);
  assert.equal(r!.magnitude, WARM_START_STRONG_DELTA_PCT + 5);
});

test("pickWarmStartTarget: extreme +50% delta still caps at STRONG_TARGET", () => {
  // No matter how strong the signal, never aim past the hard cap.
  const r = pickWarmStartTarget(50);
  assert.ok(r);
  assert.equal(r!.targetPrice, WARM_START_STRONG_TARGET);
  // Magnitude preserves the raw value for analysis later.
  assert.equal(r!.magnitude, 50);
});

test("pickWarmStartTarget: extreme -100% delta still caps at STRONG_TARGET", () => {
  const r = pickWarmStartTarget(-100);
  assert.ok(r);
  assert.equal(r!.targetPrice, WARM_START_STRONG_TARGET);
  assert.equal(r!.direction, "down");
});

// ---------------------------------------------------------------------------
// computeWarmStartShares
// ---------------------------------------------------------------------------

test("computeWarmStartShares: validates target range", () => {
  assert.throws(() => computeWarmStartShares(7213, 0.5));
  assert.throws(() => computeWarmStartShares(7213, 0.4));
  assert.throws(() => computeWarmStartShares(7213, 1.0));
  assert.throws(() => computeWarmStartShares(7213, 1.5));
});

test("computeWarmStartShares: 0.60 target with b=7213 matches plan estimate", () => {
  // Plan worked-example: b ≈ 7213, target 0.60 → ~2925 shares, ~1609 credits.
  // Verify both the share count and the cost agree with the LMSR closed form
  // q_target = b * ln(p/(1-p)) and C(q_target).
  const r = computeWarmStartShares(7213, 0.6);
  // ln(1.5) ≈ 0.4055; 7213 * 0.4055 ≈ 2924.5
  assert.ok(Math.abs(r.shares - 2924.5) < 2, `shares=${r.shares} not near 2924.5`);
  assert.ok(Math.abs(r.cost - 1609) < 5, `cost=${r.cost} not near 1609`);
});

test("computeWarmStartShares: 0.55 target costs less than 0.60 target", () => {
  // Convexity check: aiming higher always costs more (no degenerate
  // value for which 0.55 is more expensive than 0.60).
  const soft = computeWarmStartShares(7213, 0.55);
  const strong = computeWarmStartShares(7213, 0.6);
  assert.ok(soft.cost < strong.cost);
  assert.ok(soft.shares < strong.shares);
});

test("computeWarmStartShares: applying buy actually achieves the target price", () => {
  // End-to-end sanity: feed shares back through pricesAll and verify
  // the LMSR marginal price equals target within float tolerance.
  const b = 5000;
  for (const target of [0.51, 0.55, 0.6, 0.62, 0.65]) {
    const { shares } = computeWarmStartShares(b, target);
    const [pUp] = pricesAll([shares, 0], b);
    assert.ok(
      Math.abs(pUp - target) < 1e-6,
      `target=${target}, achieved pUp=${pUp}`,
    );
  }
});

test("computeWarmStartShares: cost is monotonic in b for fixed target", () => {
  // Doubling b should ~double the warm-start cost (since shares scale
  // linearly with b and the cost curve is approximately linear here).
  const small = computeWarmStartShares(2000, 0.6);
  const big = computeWarmStartShares(4000, 0.6);
  // Allow 1% tolerance; the LMSR is not strictly linear in b.
  const ratio = big.cost / small.cost;
  assert.ok(Math.abs(ratio - 2.0) < 0.02, `ratio=${ratio}, expected ~2.0`);
});
