import test from "node:test";
import assert from "node:assert/strict";

import {
  logTransform,
  computePercentileRank,
  winsorize,
  normalizeSourceValue,
  normalizeNewsMomentum,
  normalizeWikiMomentum,
  normalizeTrendsMomentum,
  computeMomentumLevel,
  MOMENTUM_RATIO_CAP,
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

// ─── News-momentum normalization (Apr 2026 — PR2 Fix X) ────────────────────
test("normalizeNewsMomentum returns 0 when 24h or 7d-avg is missing/zero", () => {
  // No current news → no momentum signal.
  assert.equal(normalizeNewsMomentum(0, 5), 0);
  assert.equal(normalizeNewsMomentum(-1, 5), 0);
  // No 7d denominator → can't measure acceleration.
  assert.equal(normalizeNewsMomentum(50, 0), 0);
  assert.equal(normalizeNewsMomentum(50, -1), 0);
});

test("normalizeNewsMomentum is monotonic and clamped to [0, 1]", () => {
  const cooling = normalizeNewsMomentum(2, 10); // 0.2× → cooling
  const steady = normalizeNewsMomentum(10, 10); // 1.0× → steady-state
  const accel = normalizeNewsMomentum(50, 10); // 5.0× → accelerating
  const burst = normalizeNewsMomentum(100, 10); // 10× → cap
  const extreme = normalizeNewsMomentum(1000, 10); // beyond cap

  assert.ok(cooling >= 0 && cooling <= 1);
  assert.ok(steady >= 0 && steady <= 1);
  assert.ok(accel >= 0 && accel <= 1);
  assert.ok(burst >= 0 && burst <= 1);
  assert.ok(extreme >= 0 && extreme <= 1);
  assert.ok(cooling < steady);
  assert.ok(steady < accel);
  assert.ok(accel < burst);
  // Above the cap, score saturates at 1.0.
  assert.ok(Math.abs(burst - 1.0) < 1e-9);
  assert.ok(Math.abs(extreme - 1.0) < 1e-9);
});

test("normalizeNewsMomentum: steady-state (1×) lands in low-mid band", () => {
  // ratio=1 → log1p(1)/log1p(10) ≈ 0.289. The momentum slot's design
  // intent: a person with consistent news flow gets a small, non-zero
  // contribution, so they're not penalized vs. someone with no news.
  const score = normalizeNewsMomentum(20, 20);
  assert.ok(
    score > 0.25 && score < 0.35,
    `expected ratio=1 → ~0.29, got ${score}`,
  );
});

test("normalizeNewsMomentum: 5× breakout lands in upper band", () => {
  // Trump-shaped breakout: 24h count is 5× the 7-day daily average.
  // ratio=5 → log1p(5)/log1p(10) ≈ 0.747.
  const score = normalizeNewsMomentum(50, 10);
  assert.ok(
    score > 0.70 && score < 0.80,
    `expected ratio=5 → ~0.75, got ${score}`,
  );
});

test("normalizeNewsMomentum: low-baseline floor prevents tiny-denominator spikes", () => {
  // 7d daily average below MOMENTUM_AVG_FLOOR (=1) is floored to 1, so a
  // single-article entity with one 24h article doesn't get treated as a
  // "1× steady" — it's still at the lower end.
  const tinyAvg = normalizeNewsMomentum(1, 0.01);
  // Floor of 1 is applied → ratio = 1/1 = 1.0 → ~0.289.
  assert.ok(
    tinyAvg > 0.25 && tinyAvg < 0.35,
    `tiny 7d-avg should be floored, got ${tinyAvg}`,
  );
});

test("MOMENTUM_RATIO_CAP is the documented value", () => {
  assert.equal(MOMENTUM_RATIO_CAP, 10,
    "MOMENTUM_RATIO_CAP=10 is part of the public contract — Score Inspector docs and admin diagnostics depend on it");
});

// ─── Weight / allocation invariants (post-simplification) ──────────────────
test("PLATFORM_WEIGHTS.velocity sums to 1.0", () => {
  // Apr 2026 (PR2 Fix X): added a `momentum` slot. `search` is retained
  // at 0 weight for backward-compat with persisted diagnostics blobs.
  const { wiki, news, search, momentum } = PLATFORM_WEIGHTS.velocity;
  const total = wiki + news + search + momentum;
  assert.ok(
    Math.abs(total - 1.0) < 1e-9,
    `velocity weights should sum to 1, got ${total} (wiki=${wiki}, news=${news}, search=${search}, momentum=${momentum})`,
  );
});

test("PLATFORM_WEIGHTS.velocity.search is permanently zero (Fix A)", () => {
  assert.equal(
    PLATFORM_WEIGHTS.velocity.search,
    0,
    "search slot is retained at 0 weight; momentum slot replaces it",
  );
});

test("MASS_ALLOCATION + VELOCITY_ALLOCATION equals 1.0", () => {
  assert.ok(Math.abs((MASS_ALLOCATION + VELOCITY_ALLOCATION) - 1.0) < 1e-9);
});

// ─── Wiki-momentum normalization (May 2026 — display-only) ─────────────────
// Mirrors the news-momentum behavioural contract. Same math under the
// hood for now, but kept as a separate function so future Wiki-specific
// curve calibration (the deferred score-weight integration) can edit
// only this function without touching news.
test("normalizeWikiMomentum returns 0 when 24h or 7d-avg is missing/zero", () => {
  assert.equal(normalizeWikiMomentum(0, 5000), 0);
  assert.equal(normalizeWikiMomentum(-1, 5000), 0);
  assert.equal(normalizeWikiMomentum(50_000, 0), 0);
  assert.equal(normalizeWikiMomentum(50_000, -1), 0);
});

test("normalizeWikiMomentum is monotonic and clamped to [0, 1]", () => {
  const cooling = normalizeWikiMomentum(2_000, 10_000); // 0.2× → cooling
  const steady = normalizeWikiMomentum(10_000, 10_000); // 1.0× → steady-state
  const accel = normalizeWikiMomentum(50_000, 10_000); // 5.0× → accelerating
  const burst = normalizeWikiMomentum(100_000, 10_000); // 10× → cap
  const extreme = normalizeWikiMomentum(1_000_000, 10_000); // beyond cap

  assert.ok(cooling >= 0 && cooling <= 1);
  assert.ok(steady >= 0 && steady <= 1);
  assert.ok(accel >= 0 && accel <= 1);
  assert.ok(burst >= 0 && burst <= 1);
  assert.ok(extreme >= 0 && extreme <= 1);
  assert.ok(cooling < steady);
  assert.ok(steady < accel);
  assert.ok(accel < burst);
  assert.ok(Math.abs(burst - 1.0) < 1e-9);
  assert.ok(Math.abs(extreme - 1.0) < 1e-9);
});

test("normalizeWikiMomentum: steady-state (1×) lands ~0.29 (parity with news)", () => {
  // Same log curve, same anchor — for now. This test will need updating
  // if Wiki-specific calibration changes the cap or compression shape.
  const score = normalizeWikiMomentum(20_000, 20_000);
  assert.ok(
    score > 0.25 && score < 0.35,
    `expected ratio=1 → ~0.29, got ${score}`,
  );
});

test("normalizeWikiMomentum: 5× breakout (Tim-Cook-on-keynote shape) lands in upper band", () => {
  // Audit captured Tim Cook on Apr-20 at ratio 33.7 (capped to 10×); a
  // 5× ratio is the "clearly elevated" shape we want this band to cover.
  const score = normalizeWikiMomentum(50_000, 10_000);
  assert.ok(
    score > 0.70 && score < 0.80,
    `expected ratio=5 → ~0.75, got ${score}`,
  );
});

test("normalizeWikiMomentum saturates the same way as normalizeNewsMomentum", () => {
  // Curve parity check — important for users reading both cards side by
  // side. If the curves diverge in future calibration, this assertion is
  // the canary that should be updated explicitly rather than drift.
  for (const ratio of [0.1, 0.5, 1.0, 2.0, 5.0, 10.0]) {
    const wiki = normalizeWikiMomentum(ratio * 1000, 1000);
    const news = normalizeNewsMomentum(ratio * 1000, 1000);
    assert.ok(
      Math.abs(wiki - news) < 1e-9,
      `wiki and news momentum curves should match; ratio=${ratio} → wiki=${wiki}, news=${news}`,
    );
  }
});

// ─── computeMomentumLevel: shared ratio-band → Low/Medium/High mapping ────
test("computeMomentumLevel: ratio bands match documented thresholds", () => {
  assert.equal(computeMomentumLevel(0), "none");
  assert.equal(computeMomentumLevel(-1), "none");
  assert.equal(computeMomentumLevel(0.01), "low");
  assert.equal(computeMomentumLevel(0.99), "low");
  assert.equal(computeMomentumLevel(1.0), "medium");
  assert.equal(computeMomentumLevel(1.99), "medium");
  assert.equal(computeMomentumLevel(2.0), "high");
  assert.equal(computeMomentumLevel(33.7), "high"); // Tim Cook Apr-20
});

// ─── Display-only scoping safety rail (May 2026) ──────────────────────────
test("PLATFORM_WEIGHTS.velocity does NOT include wikiMomentum (display-only)", () => {
  const weights = PLATFORM_WEIGHTS.velocity as Record<string, number>;
  assert.equal(weights.wikiMomentum, undefined,
    "wikiMomentum must not be a weighted slot until the score-impact audit lands");
  const total = weights.wiki + weights.news + weights.search + weights.momentum;
  assert.ok(Math.abs(total - 1.0) < 1e-9, `velocity weights should sum to 1, got ${total}`);
});

// ─── normalizeTrendsMomentum ─────────────────────────────────────────────
// Google Trends values are 0-100 (relative interest), but the ratio
// (today / 7d-avg) is self-normalizing so the same compression applies.

test("normalizeTrendsMomentum returns 0 when interest or avg is missing/zero", () => {
  assert.equal(normalizeTrendsMomentum(0, 50), 0);
  assert.equal(normalizeTrendsMomentum(-1, 50), 0);
  assert.equal(normalizeTrendsMomentum(50, 0), 0);
  assert.equal(normalizeTrendsMomentum(50, -1), 0);
});

test("normalizeTrendsMomentum is monotonic and clamped to [0, 1]", () => {
  const cooling = normalizeTrendsMomentum(10, 50);   // 0.2×
  const steady = normalizeTrendsMomentum(50, 50);    // 1.0×
  const accel = normalizeTrendsMomentum(100, 20);    // 5.0×
  const burst = normalizeTrendsMomentum(100, 10);    // 10× cap

  assert.ok(cooling >= 0 && cooling <= 1);
  assert.ok(steady >= 0 && steady <= 1);
  assert.ok(accel >= 0 && accel <= 1);
  assert.ok(burst >= 0 && burst <= 1);
  assert.ok(cooling < steady);
  assert.ok(steady < accel);
  assert.ok(accel <= burst);
});

test("normalizeTrendsMomentum: steady-state (1×) matches wiki/news ~0.29", () => {
  const score = normalizeTrendsMomentum(50, 50);
  assert.ok(
    score > 0.25 && score < 0.35,
    `expected ratio=1 → ~0.29, got ${score}`,
  );
});

test("normalizeTrendsMomentum curve parity with wiki/news momentum", () => {
  for (const ratio of [0.1, 0.5, 1.0, 2.0, 5.0, 10.0]) {
    const trends = normalizeTrendsMomentum(ratio * 50, 50);
    const news = normalizeNewsMomentum(ratio * 50, 50);
    const wiki = normalizeWikiMomentum(ratio * 50, 50);
    assert.ok(
      Math.abs(trends - news) < 1e-9 && Math.abs(trends - wiki) < 1e-9,
      `all momentum curves should match; ratio=${ratio} → trends=${trends}, news=${news}, wiki=${wiki}`,
    );
  }
});

// ─── Display-only scoping safety rail: Trends (May 2026) ─────────────────
test("PLATFORM_WEIGHTS.velocity does NOT include trendsMomentum (display-only)", () => {
  const weights = PLATFORM_WEIGHTS.velocity as Record<string, number>;
  assert.equal(weights.trendsMomentum, undefined,
    "trendsMomentum must not be a weighted slot until the score-impact audit lands");
  assert.equal(weights.trends, undefined,
    "trends must not be a weighted velocity slot until the score-impact audit lands");
});
