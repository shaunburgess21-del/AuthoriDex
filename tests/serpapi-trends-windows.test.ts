import test from "node:test";
import assert from "node:assert/strict";

import { computeTrendsCurrentInterest } from "../server/providers/trends-window";

const H = 60 * 60 * 1000;

function point(ms: number, interest: number) {
  return { date: new Date(ms).toISOString(), interest };
}

test("computeTrendsCurrentInterest: averages the last ~3 hourly points", () => {
  const end = Date.parse("2026-05-26T20:00:00.000Z");
  const series = [
    ...Array.from({ length: 21 }, (_, i) => point(end - (23 - i) * H, 30)),
    point(end - 2 * H, 80),
    point(end - 1 * H, 90),
    point(end - 0 * H, 100),
  ];
  const { currentInterest, avgWindowInterest } = computeTrendsCurrentInterest(series);
  // Window is `t > end - 3h && t <= end`; that includes points at -2, -1, 0
  // (the -3 boundary is exclusive). Mean(80, 90, 100) = 90.
  assert.equal(currentInterest, 90);
  assert.ok(avgWindowInterest > 0 && avgWindowInterest < 100);
});

test("computeTrendsCurrentInterest: empty series returns zeros", () => {
  const out = computeTrendsCurrentInterest([]);
  assert.deepEqual(out, { currentInterest: 0, avgWindowInterest: 0 });
});

test("computeTrendsCurrentInterest: sparse series falls back to most recent point", () => {
  const end = Date.parse("2026-05-26T20:00:00.000Z");
  // No points within the last 3h; only one stale point 8h before end.
  const series = [point(end - 8 * H, 42)];
  const { currentInterest, avgWindowInterest } = computeTrendsCurrentInterest(series);
  assert.equal(currentInterest, 42);
  assert.equal(avgWindowInterest, 42);
});

test("computeTrendsCurrentInterest: full-day mean reflects the whole returned series", () => {
  const end = Date.parse("2026-05-26T20:00:00.000Z");
  const series = Array.from({ length: 24 }, (_, i) => point(end - (23 - i) * H, 50));
  const { currentInterest, avgWindowInterest } = computeTrendsCurrentInterest(series);
  assert.equal(currentInterest, 50);
  assert.equal(avgWindowInterest, 50);
});

test("computeTrendsCurrentInterest: 3h boundary is exclusive on the older side", () => {
  // Point at exactly end-3h must NOT be included; window is `t > end-3h`.
  // This guards the smoothing window from drifting to 4h on aligned series.
  const end = Date.parse("2026-05-26T20:00:00.000Z");
  const series = [
    point(end - 3 * H, 100), // boundary — must be excluded
    point(end - 2 * H, 50),
    point(end - 1 * H, 50),
    point(end - 0 * H, 50),
  ];
  const { currentInterest } = computeTrendsCurrentInterest(series);
  assert.equal(currentInterest, 50);
});

test("computeTrendsCurrentInterest: out-of-order timestamps are sorted before windowing", () => {
  const end = Date.parse("2026-05-26T20:00:00.000Z");
  const series = [
    point(end - 0 * H, 100),
    point(end - 5 * H, 10),
    point(end - 1 * H, 80),
    point(end - 2 * H, 60),
  ];
  const { currentInterest } = computeTrendsCurrentInterest(series);
  // Window includes 0, -1, -2 → mean(100, 80, 60) = 80
  assert.equal(currentInterest, 80);
});
