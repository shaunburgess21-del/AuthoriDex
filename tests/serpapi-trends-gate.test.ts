import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldFetchGoogleTrends,
  TRENDS_FETCH_INTERVAL_MS,
} from "../server/providers/trends-window";

const NOW = Date.parse("2026-05-20T21:00:00.000Z");

test("shouldFetchGoogleTrends: null last fetch always fetches", () => {
  assert.equal(shouldFetchGoogleTrends(null, NOW), true);
});

test("shouldFetchGoogleTrends: 6h ago skips (within 12h window)", () => {
  const sixHoursAgo = new Date(NOW - 6 * 60 * 60 * 1000);
  assert.equal(shouldFetchGoogleTrends(sixHoursAgo, NOW), false);
});

test("shouldFetchGoogleTrends: 13h ago fetches (past 12h window)", () => {
  const thirteenHoursAgo = new Date(NOW - 13 * 60 * 60 * 1000);
  assert.equal(shouldFetchGoogleTrends(thirteenHoursAgo, NOW), true);
});

test("shouldFetchGoogleTrends: exactly 12h ago fetches (boundary)", () => {
  const exactlyTwelveHoursAgo = new Date(NOW - TRENDS_FETCH_INTERVAL_MS);
  assert.equal(shouldFetchGoogleTrends(exactlyTwelveHoursAgo, NOW), true);
});

test("shouldFetchGoogleTrends: invalid date treats as never fetched", () => {
  assert.equal(shouldFetchGoogleTrends(new Date(NaN), NOW), true);
});
