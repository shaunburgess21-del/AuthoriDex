import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL set BEFORE any import that transitively loads
// server/db.ts (amm-house imports `db` for the seed/return helpers
// even though the pure helpers tested here don't touch it). pg.Pool
// is lazy, so a dummy URL only fails if we issue a query — we never
// do in this test file. Same pattern as tests/ranking-blend.test.ts.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { buildInitialQVector, pickB } = await import("../server/services/amm-house");
const {
  DEFAULT_TARGET_MAX_LOSS_PER_MARKET,
  getTargetMaxLoss,
  TARGET_MAX_LOSS_BY_MARKET_TYPE,
} = await import("../server/config/amm");
const { seedB, initialSeedCost } = await import("../shared/lib/amm/lmsr");

// ---------------------------------------------------------------------------
// buildInitialQVector — pure structural helper
// ---------------------------------------------------------------------------

test("buildInitialQVector returns zero shares for every entry", () => {
  const ids = ["a", "b", "c"];
  const { outcomeOrder, shareQuantities } = buildInitialQVector(ids);
  assert.deepEqual(outcomeOrder, ["a", "b", "c"]);
  assert.deepEqual(shareQuantities, { a: 0, b: 0, c: 0 });
});

test("buildInitialQVector returns a fresh array (no aliasing)", () => {
  const ids = ["a", "b"];
  const result = buildInitialQVector(ids);
  result.outcomeOrder.push("c");
  assert.deepEqual(ids, ["a", "b"], "input array must not be mutated");
});

test("buildInitialQVector preserves displayOrder of entries", () => {
  const ids = ["zzz", "aaa", "mmm"];
  const { outcomeOrder } = buildInitialQVector(ids);
  assert.deepEqual(outcomeOrder, ["zzz", "aaa", "mmm"]);
});

test("buildInitialQVector throws on < 2 entries", () => {
  assert.throws(() => buildInitialQVector([]), /requires >= 2/);
  assert.throws(() => buildInitialQVector(["only"]), /requires >= 2/);
});

test("buildInitialQVector throws on duplicate IDs", () => {
  assert.throws(() => buildInitialQVector(["a", "b", "a"]), /duplicate entry ID/);
});

test("buildInitialQVector throws on empty / non-string IDs", () => {
  assert.throws(() => buildInitialQVector(["a", ""]), /non-empty strings/);
  assert.throws(() => buildInitialQVector(["a", null as unknown as string]), /non-empty strings/);
});

test("buildInitialQVector handles up to 10 outcomes", () => {
  const ids = Array.from({ length: 10 }).map((_, i) => `e${i}`);
  const { outcomeOrder, shareQuantities } = buildInitialQVector(ids);
  assert.equal(outcomeOrder.length, 10);
  assert.equal(Object.keys(shareQuantities).length, 10);
  for (const id of ids) assert.equal(shareQuantities[id], 0);
});

// ---------------------------------------------------------------------------
// pickB — config + Phase 1 math composition
// ---------------------------------------------------------------------------

test("pickB matches seedB for the default target loss", () => {
  for (const N of [2, 3, 5, 10]) {
    const { liquidityB, targetMaxLoss } = pickB(N);
    assert.equal(targetMaxLoss, DEFAULT_TARGET_MAX_LOSS_PER_MARKET);
    assert.equal(liquidityB, seedB(N, DEFAULT_TARGET_MAX_LOSS_PER_MARKET));
  }
});

test("pickB houseSeedAmount equals ceil(initialSeedCost(N, b))", () => {
  for (const N of [2, 3, 5, 10]) {
    const { liquidityB, houseSeedAmount } = pickB(N);
    assert.equal(houseSeedAmount, Math.ceil(initialSeedCost(N, liquidityB)));
  }
});

test("pickB seed cost is approximately the targetMaxLoss (off by at most 1 from ceil)", () => {
  // initialSeedCost(N, b) = b · ln(N), and seedB sets b such that b · ln(N) = targetMaxLoss.
  // So ceil(seedCost) should be targetMaxLoss exactly when targetMaxLoss is an integer
  // (both factors are exact in Number precision for the test values below).
  for (const N of [2, 3, 5, 10]) {
    const { houseSeedAmount } = pickB(N);
    assert.equal(
      houseSeedAmount,
      DEFAULT_TARGET_MAX_LOSS_PER_MARKET,
      `N=${N}: ceil(b · ln(N)) should equal targetMaxLoss`,
    );
  }
});

test("pickB respects per-market-type override map", () => {
  TARGET_MAX_LOSS_BY_MARKET_TYPE["__test_h2h"] = 3000;
  try {
    const { targetMaxLoss, houseSeedAmount } = pickB(2, "__test_h2h");
    assert.equal(targetMaxLoss, 3000);
    assert.equal(houseSeedAmount, 3000);
  } finally {
    delete TARGET_MAX_LOSS_BY_MARKET_TYPE["__test_h2h"];
  }
});

test("pickB respects a caller-supplied override", () => {
  const { targetMaxLoss, houseSeedAmount } = pickB(2, "community", 1234);
  assert.equal(targetMaxLoss, 1234);
  assert.equal(houseSeedAmount, 1234);
});

test("pickB falls back to default for unknown market types", () => {
  const { targetMaxLoss } = pickB(2, "nope-this-doesnt-exist");
  assert.equal(targetMaxLoss, DEFAULT_TARGET_MAX_LOSS_PER_MARKET);
});

test("pickB ignores non-finite or non-positive overrides", () => {
  assert.equal(pickB(2, "community", 0).targetMaxLoss, DEFAULT_TARGET_MAX_LOSS_PER_MARKET);
  assert.equal(pickB(2, "community", -100).targetMaxLoss, DEFAULT_TARGET_MAX_LOSS_PER_MARKET);
  assert.equal(pickB(2, "community", Number.NaN).targetMaxLoss, DEFAULT_TARGET_MAX_LOSS_PER_MARKET);
  assert.equal(pickB(2, "community", Number.POSITIVE_INFINITY).targetMaxLoss, DEFAULT_TARGET_MAX_LOSS_PER_MARKET);
});

test("getTargetMaxLoss matches pickB precedence rules", () => {
  // Override > per-type > default.
  assert.equal(getTargetMaxLoss(undefined, undefined), DEFAULT_TARGET_MAX_LOSS_PER_MARKET);
  assert.equal(getTargetMaxLoss("community", undefined), DEFAULT_TARGET_MAX_LOSS_PER_MARKET);
  assert.equal(getTargetMaxLoss("community", 7777), 7777);
  TARGET_MAX_LOSS_BY_MARKET_TYPE["__test_x"] = 4242;
  try {
    assert.equal(getTargetMaxLoss("__test_x", undefined), 4242);
    assert.equal(getTargetMaxLoss("__test_x", 9999), 9999); // override still wins
  } finally {
    delete TARGET_MAX_LOSS_BY_MARKET_TYPE["__test_x"];
  }
});

// ---------------------------------------------------------------------------
// Cost-monotonicity sanity (loss grows with N for fixed targetMaxLoss target)
// ---------------------------------------------------------------------------

test("seed cost is approximately constant across N when targetMaxLoss is fixed", () => {
  // The whole point of `b = targetMaxLoss / ln(N)` is that worst-case
  // loss is invariant to numOutcomes. So seed cost (= worst-case loss
  // at q=0) should land on exactly targetMaxLoss for every N.
  const target = 5000;
  for (const N of [2, 3, 4, 5, 8, 10]) {
    const { houseSeedAmount } = pickB(N, undefined, target);
    assert.equal(
      houseSeedAmount,
      target,
      `N=${N}: seed cost should equal targetMaxLoss=${target} (got ${houseSeedAmount})`,
    );
  }
});
