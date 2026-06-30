import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRateLimitHeaders,
  shouldHardStopFromRateLimit,
  hasRateLimitWindowReset,
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

test("shouldHardStopFromRateLimit: clears once the reset window has passed", () => {
  // Reproduces the Jun 2026 deadlock: remaining latched below the floor with a
  // resetTime that has since elapsed must NOT keep the hard stop engaged.
  const stale = {
    limit: 2500,
    remaining: 18,
    resetTime: "2026-06-29T00:00:00+00:00",
    capturedAt: "2026-06-28T18:02:58.342Z",
  };
  const before = new Date("2026-06-28T19:00:00Z");
  const after = new Date("2026-06-30T08:00:00Z");
  assert.equal(shouldHardStopFromRateLimit(stale, before), true);
  assert.equal(shouldHardStopFromRateLimit(stale, after), false);
});

test("hasRateLimitWindowReset: falls back to UTC-day rollover when resetTime missing", () => {
  const snap = {
    limit: 2500,
    remaining: 5,
    resetTime: null,
    capturedAt: "2026-06-28T18:00:00.000Z",
  };
  assert.equal(hasRateLimitWindowReset(snap, new Date("2026-06-28T23:00:00Z")), false);
  assert.equal(hasRateLimitWindowReset(snap, new Date("2026-06-29T01:00:00Z")), true);
  // No usable timestamps → never auto-clears (preserves floor behaviour).
  assert.equal(
    hasRateLimitWindowReset({ ...snap, capturedAt: "" }, new Date("2026-06-29T01:00:00Z")),
    false,
  );
});

test("CURRENTS_DAILY_LIMIT_DEFAULT matches Builder tier", () => {
  assert.equal(CURRENTS_DAILY_LIMIT_DEFAULT, 2500);
});
