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

test("computeTrendScore: velocityComponents.weights sum to ~1.0 (incl. momentum slot)", () => {
  // Apr 2026 (PR2 Fix X): momentum slot added with 0.20 weight; search
  // remains in the response shape at 0 weight for backward-compat with
  // historical `diagnostics.velocityComponents` blobs.
  const out = computeTrendScore(baseInputs());
  const { search, news, wiki, momentum } = out.velocityComponents.weights;
  const total = search + news + wiki + momentum;
  assert.ok(
    Math.abs(total - 1.0) < 1e-6,
    `velocity weights should sum to 1, got ${total} (search=${search}, news=${news}, wiki=${wiki}, momentum=${momentum})`
  );
});

test("computeTrendScore: momentum slot — newsCount=24h, missing avg7d → momentum=0", () => {
  const out = computeTrendScore(baseInputs({ newsAverageDaily7d: 0 }));
  assert.equal(out.velocityComponents.momentum, 0,
    "no 7d denominator → momentum velocity sub-score should be 0");
});

test("computeTrendScore: momentum slot — high 24h vs low avg7d → high momentum sub-score", () => {
  // Trump-shaped breakout: 24h count 5× the 7-day daily average.
  // Expected: momentum velocity > 70 (a 5× ratio maps to ~0.747 normalized).
  const out = computeTrendScore(baseInputs({
    newsCount: 50,
    newsAverageDaily7d: 10,
  }));
  assert.ok(
    out.velocityComponents.momentum >= 70,
    `5× breakout should yield momentum ≥ 70, got ${out.velocityComponents.momentum}`,
  );
});

test("computeTrendScore: momentum slot — steady-state (24h ≈ avg7d) → mid-range", () => {
  // Steady-state: 24h ≈ 7d daily average → ratio ≈ 1.0 → ~0.289 normalized.
  const out = computeTrendScore(baseInputs({
    newsCount: 12,
    newsAverageDaily7d: 12,
  }));
  assert.ok(
    out.velocityComponents.momentum > 20 && out.velocityComponents.momentum < 40,
    `steady-state should yield momentum in [20, 40], got ${out.velocityComponents.momentum}`,
  );
});

test("computeTrendScore: momentum slot — accelerating entity ranks higher than steady entity", () => {
  // Same wiki/news count, but one is accelerating (5× ratio) and one is
  // steady (1× ratio). The accelerating entity should score higher because
  // the momentum slot carries 0.20 weight.
  const steady = computeTrendScore(baseInputs({
    newsCount: 50,
    newsAverageDaily7d: 50,
  }));
  const accelerating = computeTrendScore(baseInputs({
    newsCount: 50,
    newsAverageDaily7d: 10,
  }));
  assert.ok(
    accelerating.fameIndex > steady.fameIndex,
    `accelerating (${accelerating.fameIndex}) should outrank steady (${steady.fameIndex})`,
  );
  assert.ok(
    accelerating.velocityComponents.momentum > steady.velocityComponents.momentum,
    "accelerating should have higher momentum velocity sub-score",
  );
});

test("computeTrendScore: momentum classification returns a known string", () => {
  const out = computeTrendScore(baseInputs());
  assert.ok(["Breakout", "Sustained", "Cooling", "Stable"].includes(out.momentum));
});

// ─── Wiki Momentum (May 2026 — display-only) ─────────────────────────────
test("computeTrendScore: velocityComponents.wikiMomentum is present and finite", () => {
  const out = computeTrendScore(baseInputs());
  assert.equal(typeof out.velocityComponents.wikiMomentum, "number");
  assert.ok(Number.isFinite(out.velocityComponents.wikiMomentum));
  assert.ok(out.velocityComponents.wikiMomentum >= 0 && out.velocityComponents.wikiMomentum <= 100);
});

test("computeTrendScore: wikiMomentum slot — high 24h vs low 7d-avg → high sub-score", () => {
  // Wiki spike shape (Tim Cook on Apple keynote: 24h pageviews 5× the
  // trailing-7d daily average). Should hit the same upper band as the
  // analogous news-momentum case since the curves are identical for now.
  const out = computeTrendScore(baseInputs({
    wikiPageviews: 100_000,
    wikiPageviews7dAvg: 20_000,
    wikiAverageDaily7d: 20_000,
  }));
  assert.ok(
    out.velocityComponents.wikiMomentum >= 70,
    `5× wiki breakout should yield wikiMomentum ≥ 70, got ${out.velocityComponents.wikiMomentum}`,
  );
});

test("computeTrendScore: wikiMomentum slot — falls back to wikiPageviews7dAvg when wikiAverageDaily7d omitted", () => {
  // Existing callers (audit-trend-engine, quick-score) don't pass an
  // explicit wikiAverageDaily7d. The score function should fall back to
  // wikiPageviews7dAvg so they keep working unchanged.
  const out = computeTrendScore(baseInputs({
    wikiPageviews: 100_000,
    wikiPageviews7dAvg: 20_000,
    // wikiAverageDaily7d intentionally omitted
  }));
  assert.ok(
    out.velocityComponents.wikiMomentum >= 70,
    `fallback denom should still produce 5× ratio, got ${out.velocityComponents.wikiMomentum}`,
  );
});

test("computeTrendScore: wikiMomentum is DORMANT in the score (display-only)", () => {
  // Critical safety rail for the May 2026 display-only scoping decision.
  // Two inputs differing only in wiki-momentum potential — same
  // wikiPageviews7dAvg (drives velocity.wiki and mass.wiki the same way),
  // but one has a 24h spike that lights up wikiMomentum and the other
  // doesn't. The fameIndex MUST be identical because wikiMomentum is
  // not a weighted velocity slot until calibration lands.
  const baseline = baseInputs({
    wikiPageviews: 20_000,
    wikiPageviews7dAvg: 20_000,
    wikiAverageDaily7d: 20_000,
    newsCount: 0,         // disable news-momentum so we isolate wiki
    newsAverageDaily7d: 0,
  });
  const spike = baseInputs({
    wikiPageviews: 20_000,        // same as baseline (same velocity.wiki / mass.wiki)
    wikiPageviews7dAvg: 20_000,
    wikiAverageDaily7d: 4_000,    // 5× ratio → wikiMomentum lights up
    newsCount: 0,
    newsAverageDaily7d: 0,
  });

  const baselineOut = computeTrendScore(baseline);
  const spikeOut = computeTrendScore(spike);

  // The wikiMomentum component differs between the two…
  assert.ok(
    spikeOut.velocityComponents.wikiMomentum > baselineOut.velocityComponents.wikiMomentum,
    `spike should have higher wikiMomentum component, got baseline=${baselineOut.velocityComponents.wikiMomentum} spike=${spikeOut.velocityComponents.wikiMomentum}`,
  );

  // …but the velocity score, fame index, and trend score must be
  // identical (within rounding) because wikiMomentum is dormant.
  assert.equal(
    spikeOut.velocityScore, baselineOut.velocityScore,
    "velocityScore must NOT change when only wikiMomentum changes (display-only)",
  );
  assert.equal(
    spikeOut.fameIndex, baselineOut.fameIndex,
    "fameIndex must NOT change when only wikiMomentum changes (display-only)",
  );
});

test("computeTrendScore: velocityComponents.weights does NOT include wikiMomentum", () => {
  // Companion to the normalize.test.ts canary. The weights blob is
  // surfaced in admin diagnostics and read by audit-trend-engine.ts; if
  // a wikiMomentum key sneaks in here, the score-impact audit can't
  // honestly replay weight=0 history.
  const out = computeTrendScore(baseInputs());
  const weights = out.velocityComponents.weights as Record<string, number>;
  assert.equal(
    weights.wikiMomentum, undefined,
    "velocityComponents.weights must not include wikiMomentum until the score-impact audit lands",
  );
});

// ─── trendsMomentum slot (May 2026 — Google Trends, display-only, dormant) ──

test("computeTrendScore: velocityComponents.trendsMomentum is present and finite", () => {
  const out = computeTrendScore(baseInputs({ trendsInterest: 80, trendsAvg7d: 40 }));
  assert.ok(
    typeof out.velocityComponents.trendsMomentum === "number" &&
    Number.isFinite(out.velocityComponents.trendsMomentum),
    "trendsMomentum must be a finite number in velocityComponents",
  );
  assert.ok(out.velocityComponents.trendsMomentum > 0,
    "trendsMomentum should be > 0 when interest=80, avg7d=40");
});

test("computeTrendScore: trendsMomentum is DORMANT in the score (display-only)", () => {
  const baseline = baseInputs({
    trendsInterest: 0,
    trendsAvg7d: 0,
  });
  const spike = baseInputs({
    trendsInterest: 100,
    trendsAvg7d: 10,   // 10× ratio → huge trendsMomentum
  });

  const baselineOut = computeTrendScore(baseline);
  const spikeOut = computeTrendScore(spike);

  assert.ok(
    spikeOut.velocityComponents.trendsMomentum > baselineOut.velocityComponents.trendsMomentum,
    `spike should have higher trendsMomentum, got baseline=${baselineOut.velocityComponents.trendsMomentum} spike=${spikeOut.velocityComponents.trendsMomentum}`,
  );

  assert.equal(
    spikeOut.velocityScore, baselineOut.velocityScore,
    "velocityScore must NOT change when only trendsMomentum changes (display-only)",
  );
  assert.equal(
    spikeOut.fameIndex, baselineOut.fameIndex,
    "fameIndex must NOT change when only trendsMomentum changes (display-only)",
  );
});

test("computeTrendScore: velocityComponents.weights does NOT include trendsMomentum", () => {
  const out = computeTrendScore(baseInputs());
  const weights = out.velocityComponents.weights as Record<string, number>;
  assert.equal(
    weights.trendsMomentum, undefined,
    "velocityComponents.weights must not include trendsMomentum until the score-impact audit lands",
  );
  assert.equal(
    weights.trends, undefined,
    "velocityComponents.weights must not include trends until the score-impact audit lands",
  );
});

test("computeTrendScore: trendsMomentum is 0 when inputs omit Trends data", () => {
  const out = computeTrendScore(baseInputs());
  assert.equal(out.velocityComponents.trendsMomentum, 0,
    "trendsMomentum should be 0 when no Trends inputs are provided");
});

// ---- Simplification invariants -------------------------------------------
//
// The legacy stabilization pipeline (rate limiting, catch-up, recalibration,
// spike detection, anti-spam damping, velocity taper, diversity multiplier,
// wiki-lag mute, outage weight redistribution) was deleted. Apr 2026: a
// targeted cross-snapshot EMA on the final fameIndex was re-introduced as
// `Fix Z` of the trend-engine tuning PR — driven by Phase 1 audit data
// showing residual ±150K oscillation that input-side soft-holds couldn't
// catch. With it, `fameIndex` may diverge from `rawFameIndex` whenever a
// prior tick's fameIndex is supplied.
//
// Invariants that still hold:
//
//   rawFameIndex === fameIndex when no previousFameIndex is supplied
//   wasStabilized === false      (legacy stabilization path is gone)
//   stabDetail === null          (no stabilization metadata)
//   diversityMultiplier === 1    (constant placeholder)
//   spikingSourceCount === 0     (constant placeholder)
//   velocityAdjusted === velocityScore (no taper/damping)
//   rawFameIndex === round( (mass*0.4 + velocity*0.6) * 10000 )
//   fameIndex === round( 0.5·rawFameIndex + 0.5·previousFameIndex )  (May 2026 temp)

test("computeTrendScore: rawFameIndex equals fameIndex when no previous tick", () => {
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

test("computeTrendScore: rawFameIndex equals raw mass/velocity composite (within rounding)", () => {
  // massScore / velocityScore in the return are rounded to 2 decimals for
  // display, but rawFameIndex is computed from the unrounded values. Allow a
  // small tolerance (up to a few hundred units on a 0–1,000,000 scale).
  const out = computeTrendScore(baseInputs());
  const expected = Math.round(
    (out.massScore * MASS_ALLOCATION + out.velocityScore * VELOCITY_ALLOCATION) * 10000
  );
  assert.ok(
    Math.abs(out.rawFameIndex - expected) < 500,
    `expected rawFameIndex ≈ ${expected}, got ${out.rawFameIndex}`
  );
});

test("computeTrendScore: cross-snapshot EMA dampens fameIndex toward previous tick", () => {
  // With a recent prior tick supplied, fameIndex should be a 50/50 blend of
  // the raw composite and the prior fameIndex. Pre-EMA composite is still
  // exposed as rawFameIndex.
  const withoutPrev = computeTrendScore(baseInputs());
  const withPrev = computeTrendScore(
    baseInputs(),
    undefined,
    undefined,
    900_000, // previousFameIndex (large — dragged toward this)
    DEFAULT_SOURCE_STATS,
  );
  assert.equal(withPrev.rawFameIndex, withoutPrev.fameIndex,
    "rawFameIndex should match the no-prev fameIndex (EMA happens after raw is computed)");
  const expected = Math.round(withoutPrev.fameIndex * 0.5 + 900_000 * 0.5);
  assert.ok(
    Math.abs(withPrev.fameIndex - expected) < 2,
    `expected EMA blend ≈ ${expected}, got ${withPrev.fameIndex}`
  );
  assert.ok(
    withPrev.fameIndex > withoutPrev.fameIndex,
    "fameIndex should be lifted by a higher previous tick",
  );
});

test("computeTrendScore: zero/missing previousFameIndex skips EMA", () => {
  const baseline = computeTrendScore(baseInputs());
  const withZeroPrev = computeTrendScore(
    baseInputs(),
    undefined,
    undefined,
    0, // explicitly zero — treated as no usable prior tick
    DEFAULT_SOURCE_STATS,
  );
  const withUndefinedPrev = computeTrendScore(
    baseInputs(),
    undefined,
    undefined,
    undefined,
    DEFAULT_SOURCE_STATS,
  );
  assert.equal(withZeroPrev.fameIndex, baseline.fameIndex);
  assert.equal(withUndefinedPrev.fameIndex, baseline.fameIndex);
});
