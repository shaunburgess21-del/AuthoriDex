import test from "node:test";
import assert from "node:assert/strict";

import { computeTrendScore, type TrendInputs } from "../server/scoring/trendScore";
import { DEFAULT_SOURCE_STATS } from "../server/scoring/normalize";

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
  // previousScore=50 → then pass previousFameIndex24h=50 → change24h should reflect delta.
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

test("computeTrendScore: diversityMultiplier is 0-1", () => {
  const out = computeTrendScore(baseInputs());
  assert.ok(out.diversityMultiplier > 0 && out.diversityMultiplier <= 1);
});

test("computeTrendScore: velocityComponents.weights sum to ~1.0 (or 0 when all outage)", () => {
  const out = computeTrendScore(baseInputs());
  const { search, news, wiki } = out.velocityComponents.weights;
  const total = search + news + wiki;
  assert.ok(
    total === 0 || Math.abs(total - 1.0) < 1e-6,
    `velocity weights should sum to 0 or 1, got ${total}`
  );
});

test("computeTrendScore: momentum classification returns a known string", () => {
  const out = computeTrendScore(baseInputs());
  assert.ok(["Breakout", "Sustained", "Cooling", "Stable"].includes(out.momentum));
});
