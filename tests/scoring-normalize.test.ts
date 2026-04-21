import test from "node:test";
import assert from "node:assert/strict";

import {
  logTransform,
  computePercentileRank,
  winsorize,
  normalizeSourceValue,
  applyAntiSpamDamping,
  isSourceSpiking,
  countSpikingSources,
  calculateDiversityMultiplier,
  getRenormalizedVelocityWeights,
  DIVERSITY_MULTIPLIERS,
  PLATFORM_WEIGHTS,
  ANTI_SPAM_BASE,
  ANTI_SPAM_MASS_FACTOR,
  type SourceStats,
  type PlatformStatuses,
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
  // Values at each percentile threshold should map (approximately) to the
  // associated percentile rank.
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

// ─── Anti-spam damping ──────────────────────────────────────────────────────
test("applyAntiSpamDamping collapses to base floor at zero mass", () => {
  // At massScore=0, the damping factor collapses to ANTI_SPAM_BASE.
  const damped = applyAntiSpamDamping(100, 0);
  assert.ok(Math.abs(damped - 100 * ANTI_SPAM_BASE) < 1e-9);
});

test("applyAntiSpamDamping passes through at full mass", () => {
  // At massScore=100, damping factor = BASE + MASS_FACTOR = 0.35 + 0.65 = 1.
  const damped = applyAntiSpamDamping(100, 100);
  assert.ok(Math.abs(damped - 100) < 1e-9);
});

test("applyAntiSpamDamping clamps massScore to [0, 100] range", () => {
  // Over-100 mass should not amplify past 1.0 multiplier.
  assert.equal(applyAntiSpamDamping(100, 200), applyAntiSpamDamping(100, 100));
  // Negative mass should not reduce below the BASE floor.
  assert.equal(applyAntiSpamDamping(100, -50), applyAntiSpamDamping(100, 0));
});

test("applyAntiSpamDamping interpolates linearly between base and full", () => {
  // At mass=50, expected factor = 0.35 + 0.65 * 0.5 = 0.675.
  const damped = applyAntiSpamDamping(100, 50);
  assert.ok(Math.abs(damped - 100 * (ANTI_SPAM_BASE + ANTI_SPAM_MASS_FACTOR * 0.5)) < 1e-9);
});

// ─── Spike detection ────────────────────────────────────────────────────────
test("isSourceSpiking requires BOTH relative and absolute threshold", () => {
  // current=30, baseline=10, threshold=1.5, minDelta=15 → relative yes (30>15),
  // absolute (30-10=20)>=15 → SPIKE.
  assert.equal(isSourceSpiking(30, 10, 1.5, 15), true);
  // Same relative, but absolute delta too small.
  assert.equal(isSourceSpiking(11, 10, 1.5, 5), false); // 11 < 10*1.5=15
  // Big absolute but not relative enough.
  assert.equal(isSourceSpiking(14, 10, 1.5, 3), false); // 14 < 15
  // baseline <= 0 → no spike possible (avoid div-by-zero).
  assert.equal(isSourceSpiking(100, 0, 1.5, 1), false);
});

test("countSpikingSources counts 0-3 correctly", () => {
  const none = countSpikingSources({
    wikiCurrent: 1000, wikiBaseline: 1000,
    newsCurrent: 5, newsBaseline: 5,
    searchCurrent: 10, searchBaseline: 10,
  });
  assert.equal(none, 0);

  const allThree = countSpikingSources({
    wikiCurrent: 100_000, wikiBaseline: 10_000, // 10x spike
    newsCurrent: 200, newsBaseline: 20,           // 10x spike
    searchCurrent: 500, searchBaseline: 20,       // 25x spike
  });
  assert.equal(allThree, 3);
});

// ─── Diversity multiplier ───────────────────────────────────────────────────
const ps = (p: Partial<PlatformStatuses>): PlatformStatuses => ({
  wiki: "ACTIVE", news: "ACTIVE", search: "ACTIVE", instagram: "ACTIVE", youtube: "ACTIVE",
  ...p,
});

test("calculateDiversityMultiplier: all-active platforms give 1.0", () => {
  assert.equal(calculateDiversityMultiplier(ps({})), DIVERSITY_MULTIPLIERS[5]);
});

test("calculateDiversityMultiplier: TEMP_FAIL counts as active (fill-forward)", () => {
  assert.equal(calculateDiversityMultiplier(ps({ wiki: "TEMP_FAIL" })), DIVERSITY_MULTIPLIERS[5]);
});

test("calculateDiversityMultiplier: NOT_APPLICABLE platforms are skipped", () => {
  // 3/3 applicable platforms active → 5/5 ratio, not penalized for skipped ones.
  assert.equal(
    calculateDiversityMultiplier(ps({ instagram: "NOT_APPLICABLE", youtube: "NOT_APPLICABLE" })),
    DIVERSITY_MULTIPLIERS[5]
  );
});

test("calculateDiversityMultiplier: zero applicable platforms → lowest tier", () => {
  assert.equal(
    calculateDiversityMultiplier(ps({
      wiki: "NOT_APPLICABLE", news: "NOT_APPLICABLE", search: "NOT_APPLICABLE",
      instagram: "NOT_APPLICABLE", youtube: "NOT_APPLICABLE",
    })),
    DIVERSITY_MULTIPLIERS[0]
  );
});

// ─── Outage weight redistribution ───────────────────────────────────────────
test("getRenormalizedVelocityWeights: no outages = base weights unchanged", () => {
  const w = getRenormalizedVelocityWeights({ wikiOutage: false, newsOutage: false, searchOutage: false });
  assert.ok(Math.abs(w.wiki - PLATFORM_WEIGHTS.velocity.wiki) < 1e-9);
  assert.ok(Math.abs(w.news - PLATFORM_WEIGHTS.velocity.news) < 1e-9);
  assert.ok(Math.abs(w.search - PLATFORM_WEIGHTS.velocity.search) < 1e-9);
});

test("getRenormalizedVelocityWeights: wiki outage redistributes proportionally, total stays 1.0", () => {
  const w = getRenormalizedVelocityWeights({ wikiOutage: true, newsOutage: false, searchOutage: false });
  assert.equal(w.wiki, 0);
  assert.ok(w.news > PLATFORM_WEIGHTS.velocity.news);
  assert.ok(w.search > PLATFORM_WEIGHTS.velocity.search);
  const total = w.wiki + w.news + w.search;
  assert.ok(Math.abs(total - 1.0) < 1e-9);
});

test("getRenormalizedVelocityWeights: all outages = zeros", () => {
  const w = getRenormalizedVelocityWeights({ wikiOutage: true, newsOutage: true, searchOutage: true });
  assert.equal(w.wiki, 0);
  assert.equal(w.news, 0);
  assert.equal(w.search, 0);
});
