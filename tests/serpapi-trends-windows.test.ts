import test from "node:test";
import assert from "node:assert/strict";

import { computeTrendsWindowMeans } from "../server/providers/trends-window";

test("computeTrendsWindowMeans: head and tail share one normalisation window", () => {
  // 24 points: first 4 avg 10, last 4 avg 50 — same peak in a real response.
  const series = [
    ...Array.from({ length: 4 }, (_, i) => ({ date: `t${i}`, interest: 10 })),
    ...Array.from({ length: 16 }, (_, i) => ({ date: `m${i}`, interest: 30 })),
    ...Array.from({ length: 4 }, (_, i) => ({ date: `e${i}`, interest: 50 })),
  ];
  const { latestInterest, prevWindowInterest, avg24hInterest } = computeTrendsWindowMeans(series);
  assert.equal(prevWindowInterest, 10);
  assert.equal(latestInterest, 50);
  // (4×10 + 16×30 + 4×50) / 24 = 30
  assert.equal(avg24hInterest, 30);
});

test("computeTrendsWindowMeans: rising intraday interest is positive delta", () => {
  const series = Array.from({ length: 24 }, (_, i) => ({
    date: `t${i}`,
    interest: 10 + i * 2,
  }));
  const { latestInterest, prevWindowInterest, avg24hInterest } = computeTrendsWindowMeans(series);
  assert.ok(latestInterest > prevWindowInterest);
  assert.ok(avg24hInterest > prevWindowInterest);
  assert.ok(latestInterest > avg24hInterest);
});
