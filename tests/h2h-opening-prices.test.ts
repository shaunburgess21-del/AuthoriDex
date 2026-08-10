/**
 * Unit tests for H2H opening-price priors.
 *
 * Covers the pure bucketing/orientation logic, the depth-preservation
 * math, and an end-to-end check that feeding the decision into
 * `pickSeedState` really opens the market at the intended price with
 * unchanged liquidity depth.
 */
import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const {
  computeH2HGapPct,
  pickH2HPriorBucket,
  computeDepthPreservingTargetMaxLoss,
  pickH2HOpeningPrices,
  H2H_MIN_GAP_PCT,
  H2H_MAX_FAVOURITE_PRICE,
  H2H_PRIOR_BUCKETS,
} = await import("../server/native-markets/h2h-opening-prices");

const { pickSeedState } = await import("../server/services/amm-house");
const { pricesAll, seedB } = await import("../shared/lib/amm/lmsr");
const { getTargetMaxLoss } = await import("../server/config/amm");

const UNIFORM_TML = getTargetMaxLoss("h2h");

// ---------------------------------------------------------------------------
// Gap computation
// ---------------------------------------------------------------------------

test("computeH2HGapPct: relative to the smaller score, matching the fit", () => {
  // The buckets were fitted with ABS(a-b)/LEAST(a,b)*100 — keep it identical.
  assert.equal(computeH2HGapPct(110, 100), 10);
  assert.equal(computeH2HGapPct(100, 110), 10);
  assert.equal(computeH2HGapPct(200, 100), 100);
});

test("computeH2HGapPct: identical scores give a zero gap, not a divide-by-zero", () => {
  assert.equal(computeH2HGapPct(250000, 250000), 0);
});

test("computeH2HGapPct: rejects missing, non-finite and non-positive scores", () => {
  assert.equal(computeH2HGapPct(null, 100), null);
  assert.equal(computeH2HGapPct(100, undefined), null);
  assert.equal(computeH2HGapPct(Number.NaN, 100), null);
  assert.equal(computeH2HGapPct(Number.POSITIVE_INFINITY, 100), null);
  assert.equal(computeH2HGapPct(0, 100), null);
  assert.equal(computeH2HGapPct(100, -5), null);
});

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

test("pickH2HPriorBucket: boundaries are inclusive on the lower bound", () => {
  assert.equal(pickH2HPriorBucket(H2H_MIN_GAP_PCT)?.id, "narrow");
  assert.equal(pickH2HPriorBucket(9.99)?.id, "narrow");
  assert.equal(pickH2HPriorBucket(10)?.id, "moderate");
  assert.equal(pickH2HPriorBucket(29.99)?.id, "moderate");
  assert.equal(pickH2HPriorBucket(30)?.id, "wide");
  assert.equal(pickH2HPriorBucket(500)?.id, "wide");
});

test("pickH2HPriorBucket: below the noise floor there is no prior", () => {
  assert.equal(pickH2HPriorBucket(0), null);
  assert.equal(pickH2HPriorBucket(1.99), null);
});

test("every bucket prices the favourite BELOW its measured win rate", () => {
  // This is the design invariant: we remove the free edge but deliberately
  // leave a slice for informed traders, and never price above the evidence.
  for (const bucket of H2H_PRIOR_BUCKETS) {
    assert.ok(
      bucket.favouritePrice < bucket.measuredWinRate,
      `${bucket.id}: price ${bucket.favouritePrice} must be < measured ${bucket.measuredWinRate}`,
    );
    assert.ok(bucket.favouritePrice > 0.5, `${bucket.id}: favourite must be favoured`);
    assert.ok(
      bucket.favouritePrice <= H2H_MAX_FAVOURITE_PRICE,
      `${bucket.id}: price must respect the cap`,
    );
  }
});

test("buckets are ordered high-to-low so the first match wins", () => {
  for (let i = 1; i < H2H_PRIOR_BUCKETS.length; i++) {
    assert.ok(
      H2H_PRIOR_BUCKETS[i].minGapPct < H2H_PRIOR_BUCKETS[i - 1].minGapPct,
      "bucket thresholds must descend",
    );
  }
});

test("wider gaps never price the favourite lower than narrower gaps", () => {
  const narrow = pickH2HOpeningPrices({ scoreA: 105, scoreB: 100, preserveDepth: false });
  const moderate = pickH2HOpeningPrices({ scoreA: 120, scoreB: 100, preserveDepth: false });
  const wide = pickH2HOpeningPrices({ scoreA: 200, scoreB: 100, preserveDepth: false });
  assert.ok(narrow && moderate && wide);
  assert.ok(narrow.favouritePrice < moderate.favouritePrice);
  assert.ok(moderate.favouritePrice < wide.favouritePrice);
});

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

test("pickH2HOpeningPrices: favours entry A when A has the higher score", () => {
  const d = pickH2HOpeningPrices({ scoreA: 300000, scoreB: 100000, preserveDepth: false });
  assert.ok(d);
  assert.equal(d.favourite, "a");
  assert.equal(d.bucket, "wide");
  assert.equal(d.prices[0], 0.8);
  assert.equal(d.prices[1], 0.2);
});

test("pickH2HOpeningPrices: favours entry B when B has the higher score", () => {
  const d = pickH2HOpeningPrices({ scoreA: 100000, scoreB: 300000, preserveDepth: false });
  assert.ok(d);
  assert.equal(d.favourite, "b");
  assert.equal(d.prices[0], 0.2);
  assert.equal(d.prices[1], 0.8);
});

test("pickH2HOpeningPrices: prices always sum to exactly 1", () => {
  for (const [a, b] of [[105, 100], [120, 100], [200, 100], [100, 260]] as const) {
    const d = pickH2HOpeningPrices({ scoreA: a, scoreB: b, preserveDepth: false });
    assert.ok(d);
    assert.equal(d.prices[0] + d.prices[1], 1);
  }
});

test("pickH2HOpeningPrices: returns null for a dead heat (seed stays 50/50)", () => {
  assert.equal(pickH2HOpeningPrices({ scoreA: 250000, scoreB: 250000 }), null);
});

test("pickH2HOpeningPrices: returns null when either opening score is missing", () => {
  // A missing snapshot must degrade to the pre-existing uniform seed, never throw.
  assert.equal(pickH2HOpeningPrices({ scoreA: null, scoreB: 250000 }), null);
  assert.equal(pickH2HOpeningPrices({ scoreA: 250000, scoreB: undefined }), null);
});

test("pickH2HOpeningPrices: a sub-noise gap gets no prior", () => {
  // 1% apart — inside the opening-median noise, so pricing a favourite here
  // would be inventing signal.
  assert.equal(pickH2HOpeningPrices({ scoreA: 252500, scoreB: 250000 }), null);
});

// ---------------------------------------------------------------------------
// Depth preservation
// ---------------------------------------------------------------------------

test("computeDepthPreservingTargetMaxLoss: holds b equal to the uniform seed", () => {
  const uniformB = seedB(2, UNIFORM_TML);
  for (const favPrice of [0.62, 0.72, 0.8]) {
    const tml = computeDepthPreservingTargetMaxLoss(favPrice, UNIFORM_TML);
    const pricedB = tml / Math.log(1 / (1 - favPrice));
    // Ceil on the credit boundary allows a sub-credit difference.
    assert.ok(
      Math.abs(pricedB - uniformB) < 1,
      `favPrice ${favPrice}: b ${pricedB} should match uniform ${uniformB}`,
    );
  }
});

test("computeDepthPreservingTargetMaxLoss: scales up, never down", () => {
  for (const favPrice of [0.55, 0.62, 0.72, 0.8]) {
    assert.ok(computeDepthPreservingTargetMaxLoss(favPrice, UNIFORM_TML) > UNIFORM_TML);
  }
});

test("computeDepthPreservingTargetMaxLoss: rejects prices outside (0.5, 1)", () => {
  assert.throws(() => computeDepthPreservingTargetMaxLoss(0.5, UNIFORM_TML));
  assert.throws(() => computeDepthPreservingTargetMaxLoss(1, UNIFORM_TML));
  assert.throws(() => computeDepthPreservingTargetMaxLoss(0.3, UNIFORM_TML));
  assert.throws(() => computeDepthPreservingTargetMaxLoss(Number.NaN, UNIFORM_TML));
});

test("computeDepthPreservingTargetMaxLoss: rejects a non-positive uniform loss", () => {
  assert.throws(() => computeDepthPreservingTargetMaxLoss(0.72, 0));
  assert.throws(() => computeDepthPreservingTargetMaxLoss(0.72, -100));
});

test("pickH2HOpeningPrices: preserveDepth=false leaves targetMaxLoss untouched", () => {
  const d = pickH2HOpeningPrices({ scoreA: 200, scoreB: 100, preserveDepth: false });
  assert.ok(d);
  assert.equal(d.targetMaxLoss, UNIFORM_TML);
  assert.equal(d.depthPreserved, false);
});

test("pickH2HOpeningPrices: preserveDepth=true raises targetMaxLoss", () => {
  const d = pickH2HOpeningPrices({ scoreA: 200, scoreB: 100, preserveDepth: true });
  assert.ok(d);
  assert.ok(d.targetMaxLoss > UNIFORM_TML);
  assert.equal(d.depthPreserved, true);
});

// ---------------------------------------------------------------------------
// End-to-end through the real seeding path
// ---------------------------------------------------------------------------

test("seeded market actually opens at the intended price", () => {
  const d = pickH2HOpeningPrices({ scoreA: 300000, scoreB: 100000, preserveDepth: true });
  assert.ok(d);
  const seed = pickSeedState(["entry-a", "entry-b"], "h2h", d.targetMaxLoss, d.prices);
  assert.equal(seed.priceMatched, true);

  const q = seed.outcomeOrder.map((id) => seed.shareQuantities[id]);
  const opened = pricesAll(q, seed.liquidityB);
  assert.ok(
    Math.abs(opened[0] - 0.8) < 0.001,
    `favourite should open at 0.80, got ${opened[0]}`,
  );
  assert.ok(Math.abs(opened[1] - 0.2) < 0.001);
});

test("depth-preserved seed keeps b equal to the uniform 50/50 seed", () => {
  const uniform = pickSeedState(["entry-a", "entry-b"], "h2h");
  const d = pickH2HOpeningPrices({ scoreA: 300000, scoreB: 100000, preserveDepth: true });
  assert.ok(d);
  const priced = pickSeedState(["entry-a", "entry-b"], "h2h", d.targetMaxLoss, d.prices);
  assert.ok(
    Math.abs(priced.liquidityB - uniform.liquidityB) < 1,
    `b should be preserved: ${priced.liquidityB} vs uniform ${uniform.liquidityB}`,
  );
});

test("without depth preservation b collapses — the trap this guards against", () => {
  // Documents WHY the override exists: at the stock targetMaxLoss an 80/20
  // seed is ~2.3x thinner, and a single median-sized bet would blow the price.
  const uniform = pickSeedState(["entry-a", "entry-b"], "h2h");
  const d = pickH2HOpeningPrices({ scoreA: 300000, scoreB: 100000, preserveDepth: false });
  assert.ok(d);
  const thin = pickSeedState(["entry-a", "entry-b"], "h2h", d.targetMaxLoss, d.prices);
  assert.ok(
    thin.liquidityB < uniform.liquidityB * 0.5,
    `expected a much thinner book, got ${thin.liquidityB} vs ${uniform.liquidityB}`,
  );
});

test("house seed equals targetMaxLoss on both the uniform and priced paths", () => {
  // The worst-case-loss invariant: seed == targetMaxLoss either way, so the
  // only thing depth preservation changes is the size of that known bound.
  const uniform = pickSeedState(["entry-a", "entry-b"], "h2h");
  assert.equal(uniform.houseSeedAmount, UNIFORM_TML);

  const d = pickH2HOpeningPrices({ scoreA: 300000, scoreB: 100000, preserveDepth: true });
  assert.ok(d);
  const priced = pickSeedState(["entry-a", "entry-b"], "h2h", d.targetMaxLoss, d.prices);
  assert.equal(priced.houseSeedAmount, d.targetMaxLoss);
});

test("a favoured underdog still pays out attractively (market stays tradeable)", () => {
  // At the widest bucket the underdog is 0.20, i.e. 5x — deliberately kept
  // above the point where nobody would take the other side.
  const d = pickH2HOpeningPrices({ scoreA: 900000, scoreB: 100000, preserveDepth: false });
  assert.ok(d);
  const underdogPrice = Math.min(...d.prices);
  assert.ok(underdogPrice >= 0.2, `underdog priced at ${underdogPrice}, too thin to attract volume`);
});
