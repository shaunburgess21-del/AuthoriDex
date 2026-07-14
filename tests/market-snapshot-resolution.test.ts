import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureDate,
  getCloseSnapshotFallbackMaxHours,
  getNativeCloseMedianHours,
  computeMedianFameScore,
  getStoredOpeningScore,
} from "../server/jobs/market-snapshot-utils";
import {
  getNativeMarketEligibilityWindow,
  getMinRecentIngestSamplesForNativeMarkets,
} from "../server/native-markets/native-market-eligibility";

test("ensureDate parses ISO strings and rejects invalid values", () => {
  const d = ensureDate("2026-06-01T00:00:00.000Z");
  assert.ok(d);
  assert.equal(d!.toISOString(), "2026-06-01T00:00:00.000Z");
  assert.equal(ensureDate("not-a-date"), null);
  assert.equal(ensureDate(null), null);
});

test("getStoredOpeningScore reads single-person metadata", () => {
  const market = {
    metadata: {
      openingScore: {
        personId: "p1",
        score: 500_000,
        snapshotAt: "2026-06-01T00:00:00.000Z",
      },
    },
  };
  const snap = getStoredOpeningScore(market, "p1");
  assert.ok(snap);
  assert.equal(snap!.score, 500_000);
  assert.equal(snap!.capturedAt.toISOString(), "2026-06-01T00:00:00.000Z");
});

test("getStoredOpeningScore reads multi-person openingScores array", () => {
  const market = {
    metadata: {
      openingScores: [
        { personId: "a", score: 100, snapshotAt: "2026-06-01T00:00:00.000Z" },
        { personId: "b", score: 200, snapshotAt: "2026-06-01T01:00:00.000Z" },
      ],
    },
  };
  const snap = getStoredOpeningScore(market, "b");
  assert.ok(snap);
  assert.equal(snap!.score, 200);
});

test("native market eligibility window is 7 days before Monday", () => {
  const monday = new Date("2026-06-08T00:00:00.000Z");
  const { windowStart, windowEnd } = getNativeMarketEligibilityWindow(monday);
  assert.equal(windowEnd.toISOString(), monday.toISOString());
  assert.equal(windowStart.toISOString(), "2026-06-01T00:00:00.000Z");
});

test("min recent ingest samples defaults to 24", () => {
  const prev = process.env.NATIVE_MARKET_MIN_RECENT_INGEST_SAMPLES;
  delete process.env.NATIVE_MARKET_MIN_RECENT_INGEST_SAMPLES;
  assert.equal(getMinRecentIngestSamplesForNativeMarkets(), 24);
  if (prev !== undefined) {
    process.env.NATIVE_MARKET_MIN_RECENT_INGEST_SAMPLES = prev;
  }
});

test("close snapshot fallback max age defaults to 24 hours", () => {
  const prev = process.env.CLOSE_SNAPSHOT_FALLBACK_MAX_HOURS;
  delete process.env.CLOSE_SNAPSHOT_FALLBACK_MAX_HOURS;
  assert.equal(getCloseSnapshotFallbackMaxHours(), 24);
  if (prev !== undefined) {
    process.env.CLOSE_SNAPSHOT_FALLBACK_MAX_HOURS = prev;
  }
});

test("native close median hours defaults to 6", () => {
  const prevNative = process.env.NATIVE_CLOSE_MEDIAN_HOURS;
  const prevGainer = process.env.GAINER_CLOSE_MEDIAN_HOURS;
  delete process.env.NATIVE_CLOSE_MEDIAN_HOURS;
  delete process.env.GAINER_CLOSE_MEDIAN_HOURS;
  assert.equal(getNativeCloseMedianHours(), 6);
  if (prevNative !== undefined) process.env.NATIVE_CLOSE_MEDIAN_HOURS = prevNative;
  if (prevGainer !== undefined) process.env.GAINER_CLOSE_MEDIAN_HOURS = prevGainer;
});

test("native close median hours honors NATIVE_CLOSE_MEDIAN_HOURS and clamps", () => {
  const prevNative = process.env.NATIVE_CLOSE_MEDIAN_HOURS;
  const prevGainer = process.env.GAINER_CLOSE_MEDIAN_HOURS;
  delete process.env.GAINER_CLOSE_MEDIAN_HOURS;
  process.env.NATIVE_CLOSE_MEDIAN_HOURS = "1";
  assert.equal(getNativeCloseMedianHours(), 1);
  process.env.NATIVE_CLOSE_MEDIAN_HOURS = "12";
  assert.equal(getNativeCloseMedianHours(), 12);
  process.env.NATIVE_CLOSE_MEDIAN_HOURS = "99";
  assert.equal(getNativeCloseMedianHours(), 6); // out of range → default
  if (prevNative !== undefined) process.env.NATIVE_CLOSE_MEDIAN_HOURS = prevNative;
  else delete process.env.NATIVE_CLOSE_MEDIAN_HOURS;
  if (prevGainer !== undefined) process.env.GAINER_CLOSE_MEDIAN_HOURS = prevGainer;
});

test("native close median hours falls back to GAINER_CLOSE_MEDIAN_HOURS alias", () => {
  const prevNative = process.env.NATIVE_CLOSE_MEDIAN_HOURS;
  const prevGainer = process.env.GAINER_CLOSE_MEDIAN_HOURS;
  delete process.env.NATIVE_CLOSE_MEDIAN_HOURS;
  process.env.GAINER_CLOSE_MEDIAN_HOURS = "4";
  assert.equal(getNativeCloseMedianHours(), 4);
  if (prevNative !== undefined) process.env.NATIVE_CLOSE_MEDIAN_HOURS = prevNative;
  if (prevGainer !== undefined) process.env.GAINER_CLOSE_MEDIAN_HOURS = prevGainer;
  else delete process.env.GAINER_CLOSE_MEDIAN_HOURS;
});

test("computeMedianFameScore: odd, even, empty, non-finite", () => {
  assert.equal(computeMedianFameScore([]), null);
  assert.equal(computeMedianFameScore([10]), 10);
  assert.equal(computeMedianFameScore([1, 3, 5]), 3);
  assert.equal(computeMedianFameScore([1, 2, 3, 4]), 3); // (2+3)/2 rounded
  assert.equal(computeMedianFameScore([Number.NaN, 5, 7]), 6); // (5+7)/2
  assert.equal(computeMedianFameScore([Number.NaN]), null);
});

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { alignCloseMethodsForMarket } = await import(
  "../server/jobs/market-snapshot-resolution"
);

test("alignCloseMethodsForMarket keeps median when all median", () => {
  const at = new Date("2026-07-12T23:00:00.000Z");
  const pairs = [
    {
      settled: { score: 100, capturedAt: at, method: "median" as const, windowHours: 6, sampleCount: 4 },
      single: { score: 90, capturedAt: at },
    },
    {
      settled: { score: 200, capturedAt: at, method: "median" as const, windowHours: 6, sampleCount: 5 },
      single: { score: 210, capturedAt: at },
    },
  ];
  const aligned = alignCloseMethodsForMarket(pairs);
  assert.equal(aligned[0]!.method, "median");
  assert.equal(aligned[0]!.score, 100);
  assert.equal(aligned[1]!.method, "median");
  assert.equal(aligned[1]!.score, 200);
});

test("alignCloseMethodsForMarket forces single when any entry fell back", () => {
  const at = new Date("2026-07-12T23:00:00.000Z");
  const pairs = [
    {
      settled: { score: 100, capturedAt: at, method: "median" as const, windowHours: 6, sampleCount: 4 },
      single: { score: 90, capturedAt: at },
    },
    {
      settled: { score: 200, capturedAt: at, method: "single" as const, windowHours: 6, sampleCount: 1 },
      single: { score: 200, capturedAt: at },
    },
  ];
  const aligned = alignCloseMethodsForMarket(pairs);
  assert.equal(aligned[0]!.method, "single");
  assert.equal(aligned[0]!.score, 90);
  assert.equal(aligned[1]!.method, "single");
  assert.equal(aligned[1]!.score, 200);
});
