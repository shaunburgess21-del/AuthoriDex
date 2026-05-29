import test from "node:test";
import assert from "node:assert/strict";

import { computeTrendsMomentumDeltaPct } from "../server/providers/trends-window";

test("computeTrendsMomentumDeltaPct: ratio 1.26 -> +26%", () => {
  assert.equal(computeTrendsMomentumDeltaPct(1.26, true), 26);
});

test("computeTrendsMomentumDeltaPct: ratio 0.70 -> -30%", () => {
  assert.equal(computeTrendsMomentumDeltaPct(0.7, true), -30);
});

test("computeTrendsMomentumDeltaPct: ratio 1.08 inside dead zone -> 0", () => {
  assert.equal(computeTrendsMomentumDeltaPct(1.08, true), 0);
});

test("computeTrendsMomentumDeltaPct: ratio 0.92 inside dead zone -> 0", () => {
  assert.equal(computeTrendsMomentumDeltaPct(0.92, true), 0);
});

test("computeTrendsMomentumDeltaPct: ratio 0 -> 0", () => {
  assert.equal(computeTrendsMomentumDeltaPct(0, true), 0);
});

test("computeTrendsMomentumDeltaPct: sentinel mismatch -> 0", () => {
  assert.equal(computeTrendsMomentumDeltaPct(1.26, false), 0);
});

test("computeTrendsMomentumDeltaPct: exactly at +10% boundary -> 0", () => {
  assert.equal(computeTrendsMomentumDeltaPct(1.1, true), 0);
});

test("computeTrendsMomentumDeltaPct: just outside +10% boundary -> 11%", () => {
  assert.equal(computeTrendsMomentumDeltaPct(1.11, true), 11);
});

test("computeTrendsMomentumDeltaPct: spiky recent peak (ratio 10) clamps to +200%", () => {
  // Messi-style: prior baseline near zero inflates the ratio; the displayed
  // delta must stay bounded rather than reading "+900%".
  assert.equal(computeTrendsMomentumDeltaPct(10, true), 200);
});
