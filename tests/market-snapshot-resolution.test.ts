import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureDate,
  getCloseSnapshotFallbackMaxHours,
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
