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

test("computePercentileRank hits known anchors (p25=0.25, p50=0.50, p75=0.75, p90=0.85)", () => {
  // Apr 2026 (Fix B): the upper-tail mapping was re-spread so the p90 anchor
  // moved from 0.90 → 0.85 (giving the p90 → p99-est band 0.85 → 0.95 and
  // p99-est → empirical-max its own 0.95 → 1.00 band). Lower anchors
  // (p25 / p50 / p75) are unchanged.
  assert.ok(Math.abs(computePercentileRank(logTransform(STATS.p25), STATS) - 0.25) < 1e-9);
  assert.ok(Math.abs(computePercentileRank(logTransform(STATS.p50), STATS) - 0.50) < 1e-9);
  assert.ok(Math.abs(computePercentileRank(logTransform(STATS.p75), STATS) - 0.75) < 1e-9);
  assert.ok(Math.abs(computePercentileRank(logTransform(STATS.p90), STATS) - 0.85) < 1e-9);
});

test("computePercentileRank clamps below min to 0 and at empirical max to 1", () => {
  assert.equal(computePercentileRank(logTransform(1), STATS), 0);
  // Apr 2026 (Fix B): the rank curve now anchors the top at the empirical
  // `stats.max` (rank 1.0) rather than the p99 estimate, so genuine
  // extreme outliers can climb past the p99 cluster.
  assert.equal(computePercentileRank(logTransform(STATS.max), STATS), 1);
});

test("computePercentileRank returns 0.5 for degenerate stats (count=0 or min=max)", () => {
  const degenerate: SourceStats = { count: 0, min: 0, max: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  assert.equal(computePercentileRank(logTransform(42), degenerate), 0.5);

  const flat: SourceStats = { ...STATS, min: STATS.max };
  assert.equal(computePercentileRank(logTransform(42), flat), 0.5);
});

test("winsorize caps extreme outliers at empirical stats.max", () => {
  // Apr 2026 (Fix B): winsorize cap raised from p99 estimate to the
  // empirical max so legitimate top-tier values aren't double-clipped
  // (the rank function now reserves its own band for the p99 → max range).
  // The test stat sheet has max=5_000_000, so any value at or below the
  // empirical max passes through unchanged; only values above the
  // empirical max are clipped down.
  assert.equal(winsorize(STATS.max, STATS), STATS.max);
  assert.equal(winsorize(500_000, STATS), 500_000); // below cap, unchanged
  assert.equal(winsorize(STATS.max + 1, STATS), STATS.max); // above cap, clipped
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
