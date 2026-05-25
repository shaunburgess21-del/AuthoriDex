import test from "node:test";
import assert from "node:assert/strict";

import { computeTrendsDayOverDayMeans } from "../server/providers/trends-window";

const H = 60 * 60 * 1000;

function point(ms: number, interest: number) {
  return { date: new Date(ms).toISOString(), interest };
}

test("computeTrendsDayOverDayMeans: latest 24h higher than previous 24h is positive delta", () => {
  const end = Date.parse("2026-05-25T15:00:00.000Z");
  const series = [
    ...Array.from({ length: 6 }, (_, i) => point(end - (47 - i) * H, 20)),
    ...Array.from({ length: 6 }, (_, i) => point(end - (23 - i) * H, 50)),
  ];
  const { latestInterest, prevWindowInterest } = computeTrendsDayOverDayMeans(series);
  assert.equal(prevWindowInterest, 20);
  assert.equal(latestInterest, 50);
  assert.ok(latestInterest > prevWindowInterest);
});

test("computeTrendsDayOverDayMeans: latest 24h lower than previous 24h is negative delta", () => {
  const end = Date.parse("2026-05-25T15:00:00.000Z");
  const series = [
    ...Array.from({ length: 6 }, (_, i) => point(end - (47 - i) * H, 80)),
    ...Array.from({ length: 6 }, (_, i) => point(end - (23 - i) * H, 40)),
  ];
  const { latestInterest, prevWindowInterest } = computeTrendsDayOverDayMeans(series);
  assert.equal(prevWindowInterest, 80);
  assert.equal(latestInterest, 40);
  assert.ok(latestInterest < prevWindowInterest);
});

test("computeTrendsDayOverDayMeans: empty series returns zeros", () => {
  const out = computeTrendsDayOverDayMeans([]);
  assert.deepEqual(out, { latestInterest: 0, prevWindowInterest: 0, avgWindowInterest: 0 });
});

test("computeTrendsDayOverDayMeans: uneven timestamps still partition by 24h windows", () => {
  const end = Date.parse("2026-05-25T12:00:00.000Z");
  const series = [
    point(end - 40 * H, 10),
    point(end - 30 * H, 12),
    point(end - 10 * H, 60),
    point(end - 2 * H, 70),
  ];
  const { latestInterest, prevWindowInterest, avgWindowInterest } =
    computeTrendsDayOverDayMeans(series);
  assert.equal(prevWindowInterest, 11);
  assert.equal(latestInterest, 65);
  assert.ok(avgWindowInterest > 0);
});
