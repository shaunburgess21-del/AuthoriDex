import test from "node:test";
import assert from "node:assert/strict";

import {
  logTransform,
  computePercentileRank,
  winsorize,
  normalizeSourceValue,
  PLATFORM_WEIGHTS,
  MASS_ALLOCATION,
  VELOCITY_ALLOCATION,
  type SourceStats,
} from "../server/scoring/normalize";

// ─── Percentile normalization ───────────────────────────────────────────────
// Scoring engine invariant: `normalizeSourceValue(raw, stats)` returns a
// number in [0, 1] that monotonically increases with `raw` and hits known
// anchor values at the percentile thresholds.
const STATS: SourceStats = {
  count: 100,
  min: 1000,
  max: 5_000_000,
  p25: 10_000,
  p50: 50_000,
  p75: 200_000,
  p90: 1_000_000,
};

test("logTransform is monotonic and handles zero / negative inputs safely", () => {
  assert.ok(logTransform(0) === 0);
  // Negative values are clamped to 0 before log1p.
  assert.ok(logTransform(-100) === 0);
  assert.ok(logTransform(1000) < logTransform(10_000));
  assert.ok(logTransform(10_000) < logTransform(100_000));
});

test("computePercentileRank hits known anchors (p25=0.25, p50=0.50, p75=0.75)", () => {
  assert.ok(Math.abs(computePercentileRank(logTransform(STATS.p25), STATS) - 0.25) < 1e-9);
  assert.ok(Math.abs(computePercentileRank(logTransform(STATS.p50), STATS) - 0.50) < 1e-9);
  assert.ok(Math.abs(computePercentileRank(logTransform(STATS.p75), STATS) - 0.75) < 1e-9);
  assert.ok(Math.abs(computePercentileRank(logTransform(STATS.p90), STATS) - 0.90) < 1e-9);
});

test("computePercentileRank clamps below min to 0 and at/above effective-max to 1", () => {
  assert.equal(computePercentileRank(logTransform(1), STATS), 0);
  // Effective max is p90 + 2*(p90 - p75) = 1M + 2*(800k) = 2.6M, so 5M is above it.
  assert.equal(computePercentileRank(logTransform(STATS.max), STATS), 1);
});

test("computePercentileRank returns 0.5 for degenerate stats (count=0 or min=max)", () => {
  const degenerate: SourceStats = { count: 0, min: 0, max: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  assert.equal(computePercentileRank(logTransform(42), degenerate), 0.5);

  const flat: SourceStats = { ...STATS, min: STATS.max };
  assert.equal(computePercentileRank(logTransform(42), flat), 0.5);
});

test("winsorize caps extreme outliers at p99 estimate", () => {
  // p99 estimate = p90 + 2*(p90 - p75) = 1M + 2*(800k) = 2.6M
  const p99Est = STATS.p90 + 2 * (STATS.p90 - STATS.p75);
  assert.equal(winsorize(5_000_000, STATS), p99Est);
  assert.equal(winsorize(500_000, STATS), 500_000); // below cap, unchanged
});

test("normalizeSourceValue returns 0..1 and is monotonic", () => {
  const low = normalizeSourceValue(5000, STATS);
  const mid = normalizeSourceValue(100_000, STATS);
  const high = normalizeSourceValue(800_000, STATS);
  assert.ok(low >= 0 && low <= 1);
  assert.ok(mid >= 0 && mid <= 1);
  assert.ok(high >= 0 && high <= 1);
  assert.ok(low < mid && mid < high);
});

// ─── Weight / allocation invariants (post-simplification) ──────────────────
test("PLATFORM_WEIGHTS.velocity sums to 1.0", () => {
  const { wiki, news, search } = PLATFORM_WEIGHTS.velocity;
  assert.ok(Math.abs((wiki + news + search) - 1.0) < 1e-9);
});

test("MASS_ALLOCATION + VELOCITY_ALLOCATION equals 1.0", () => {
  assert.ok(Math.abs((MASS_ALLOCATION + VELOCITY_ALLOCATION) - 1.0) < 1e-9);
});
