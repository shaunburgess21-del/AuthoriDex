import test from "node:test";
import assert from "node:assert/strict";

import { computeTrendScore, type TrendInputs } from "../server/scoring/trendScore";
import { DEFAULT_SOURCE_STATS, MASS_ALLOCATION, VELOCITY_ALLOCATION } from "../server/scoring/normalize";

// Build a minimal valid TrendInputs — the full type has many optional fields,
// these are the ones that actually drive the core score path.
function baseInputs(overrides: Partial<TrendInputs> = {}): TrendInputs {
  return {
    wikiPageviews: 50_000,
    wikiPageviews7dAvg: 50_000,
    wikiDelta: 0,
    newsDelta: 0,
    searchDelta: 0,
    newsCount: 10,
    searchVolume: 50,
    wikiBaseline: 50_000,
    newsBaseline: 10,
    searchBaseline: 50,
    activePlatforms: { wiki: true, instagram: false, youtube: false },
    platformStatuses: {
      wiki: "ACTIVE",
      news: "ACTIVE",
      search: "ACTIVE",
      instagram: "NOT_APPLICABLE",
      youtube: "NOT_APPLICABLE",
    },
    ...overrides,
  };
}

test("computeTrendScore: zero/typical inputs produce finite, non-negative scores", () => {
  const out = computeTrendScore(baseInputs());
  assert.ok(Number.isFinite(out.fameIndex), "fameIndex should be finite");
  assert.ok(Number.isFinite(out.trendScore), "trendScore should be finite");
  assert.ok(Number.isFinite(out.velocityScore), "velocityScore should be finite");
  assert.ok(Number.isFinite(out.massScore), "massScore should be finite");
  // Scores (not fameIndex) are 0-100 sub-scores; fameIndex is a raw composite.
  assert.ok(out.velocityScore >= 0 && out.velocityScore <= 100);
  assert.ok(out.massScore >= 0 && out.massScore <= 100);
  assert.ok(out.fameIndex >= 0, `fameIndex should be non-negative, got ${out.fameIndex}`);
});

test("computeTrendScore: higher velocity signals → higher trend score (monotonic)", () => {
  const low = computeTrendScore(baseInputs({
    wikiPageviews: 10_000, wikiPageviews7dAvg: 10_000,
    newsCount: 5, searchVolume: 10,
    wikiBaseline: 10_000, newsBaseline: 5, searchBaseline: 10,
  }));
  const high = computeTrendScore(baseInputs({
    wikiPageviews: 500_000, wikiPageviews7dAvg: 500_000,
    newsCount: 200, searchVolume: 500,
    wikiBaseline: 10_000, newsBaseline: 5, searchBaseline: 10,  // baseline is low → everything spikes
  }));
  assert.ok(
    high.fameIndex > low.fameIndex,
    `expected higher fameIndex for higher inputs: low=${low.fameIndex} high=${high.fameIndex}`
  );
});

test("computeTrendScore: change24h is null when no previousFameIndex24h", () => {
  const out = computeTrendScore(baseInputs());
  assert.equal(out.change24h, null);
  assert.equal(out.change7d, null);
});

test("computeTrendScore: change24h is computed when previousFameIndex24h is provided", () => {
  const out = computeTrendScore(
    baseInputs(),
    undefined,          // previousScore
    undefined,          // previousScore7d
    undefined,          // previousFameIndex
    DEFAULT_SOURCE_STATS,
    40,                 // previousFameIndex24h
  );
  assert.notEqual(out.change24h, null);
  assert.equal(typeof out.change24h, "number");
});

test("computeTrendScore: velocityComponents.weights sum to ~1.0", () => {
  const out = computeTrendScore(baseInputs());
  const { search, news, wiki } = out.velocityComponents.weights;
  const total = search + news + wiki;
  assert.ok(
    Math.abs(total - 1.0) < 1e-6,
    `velocity weights should sum to 1, got ${total}`
  );
});

test("computeTrendScore: momentum classification returns a known string", () => {
  const out = computeTrendScore(baseInputs());
  assert.ok(["Breakout", "Sustained", "Cooling", "Stable"].includes(out.momentum));
});

// ---- Ruthless-simplification invariants ----------------------------------
//
// After removing EMA smoothing, rate limiting, catch-up, recalibration, spike
// detection, anti-spam damping, velocity taper, diversity multiplier, wiki-lag
// mute, and outage weight redistribution, these invariants must hold for every
// input:
//
//   rawFameIndex === fameIndex      (no post-hoc damping)
//   wasStabilized === false         (no stabilization path exists)
//   stabDetail === null             (no stabilization metadata)
//   diversityMultiplier === 1       (constant placeholder)
//   spikingSourceCount === 0        (constant placeholder)
//   velocityAdjusted === velocityScore (no taper/damping)
//   fameIndex === round( (mass*0.4 + velocity*0.6) * 10000 )

test("computeTrendScore: rawFameIndex equals fameIndex (no stabilization)", () => {
  const out = computeTrendScore(baseInputs());
  assert.equal(out.rawFameIndex, out.fameIndex);
});

test("computeTrendScore: stabilization fields are constant placeholders", () => {
  const out = computeTrendScore(
    baseInputs(),
    800_000,   // previousScore — used to be a smoothing anchor
    750_000,   // previousScore7d
    800_000,   // previousFameIndex
    DEFAULT_SOURCE_STATS,
    700_000,   // previousFameIndex24h
    650_000,   // previousFameIndex7d
  );
  assert.equal(out.wasStabilized, false);
  assert.equal(out.stabDetail, null);
  assert.equal(out.diversityMultiplier, 1);
  assert.equal(out.spikingSourceCount, 0);
  assert.equal(out.velocityAdjusted, out.velocityScore);
});

test("computeTrendScore: fameIndex equals raw mass/velocity composite (within rounding)", () => {
  // massScore / velocityScore in the return are rounded to 2 decimals for
  // display, but fameIndex is computed from the unrounded values. Allow a
  // small tolerance (up to a few hundred units on a 0–1,000,000 scale).
  const out = computeTrendScore(baseInputs());
  const expected = Math.round(
    (out.massScore * MASS_ALLOCATION + out.velocityScore * VELOCITY_ALLOCATION) * 10000
  );
  assert.ok(
    Math.abs(out.fameIndex - expected) < 500,
    `expected fameIndex ≈ ${expected}, got ${out.fameIndex}`
  );
});

test("computeTrendScore: previous scores no longer dampen current score", () => {
  // A massive previousFameIndex used to pin the output via EMA / rate limit.
  // With stabilization removed, the output should match the no-previous case.
  const withPrev = computeTrendScore(
    baseInputs(),
    900_000,
    900_000,
    900_000,
    DEFAULT_SOURCE_STATS,
    900_000,
    900_000,
  );
  const withoutPrev = computeTrendScore(baseInputs());
  assert.equal(withPrev.fameIndex, withoutPrev.fameIndex);
});
