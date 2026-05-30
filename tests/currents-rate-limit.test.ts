import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRateLimitHeaders,
  shouldHardStopFromRateLimit,
  CURRENTS_DAILY_LIMIT_DEFAULT,
} from "../server/providers/currents-parse";

test("parseRateLimitHeaders: reads x-ratelimit headers", () => {
  const headers = new Headers({
    "x-ratelimit-limit": "2500",
    "x-ratelimit-remaining": "100",
    "x-ratelimit-reset-time": "2026-05-31T00:00:00+00:00",
  });
  const snap = parseRateLimitHeaders(headers);
  assert.ok(snap);
  assert.equal(snap!.limit, 2500);
  assert.equal(snap!.remaining, 100);
  assert.equal(snap!.resetTime, "2026-05-31T00:00:00+00:00");
});

test("shouldHardStopFromRateLimit: stops at 5% floor", () => {
  const snap = { limit: 2500, remaining: 0, resetTime: null, capturedAt: "" };
  assert.equal(shouldHardStopFromRateLimit({ ...snap, remaining: 126 }), false);
  assert.equal(shouldHardStopFromRateLimit({ ...snap, remaining: 125 }), true);
  assert.equal(shouldHardStopFromRateLimit({ ...snap, remaining: 50 }), true);
  assert.equal(shouldHardStopFromRateLimit(null), false);
});

test("CURRENTS_DAILY_LIMIT_DEFAULT matches Builder tier", () => {
  assert.equal(CURRENTS_DAILY_LIMIT_DEFAULT, 2500);
});
