import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeMass,
  normalizeVelocity,
  clamp,
  calculateMomentum,
  generateDrivers,
} from "../server/scoring/utils";

// ─── normalizeMass ──────────────────────────────────────────────────────────
test("normalizeMass: below 10k floor returns 0", () => {
  assert.equal(normalizeMass(0), 0);
  assert.equal(normalizeMass(9_999), 0);
});

test("normalizeMass: 10k floor starts at 0, monotonic up to max", () => {
  const a = normalizeMass(10_000);       // log10=4 → floor of mass range
  const b = normalizeMass(1_000_000);    // log10=6
  const c = normalizeMass(1_000_000_000); // log10=9 → cap
  assert.ok(a >= 0 && a <= 1, `low mass should be near 0, got ${a}`);
  assert.ok(b > a, "monotonic");
  assert.ok(c === 100, `cap should be 100, got ${c}`);
});

test("normalizeMass: values above range are clamped to 100", () => {
  assert.equal(normalizeMass(100_000_000_000), 100); // log10=11, above max=9
});

// ─── normalizeVelocity ──────────────────────────────────────────────────────
test("normalizeVelocity: -1 → 0, 2 → 100", () => {
  assert.equal(normalizeVelocity(-1), 0);
  assert.equal(normalizeVelocity(-2), 0);  // clamped
  assert.equal(normalizeVelocity(2), 100);
  assert.equal(normalizeVelocity(10), 100); // clamped
});

test("normalizeVelocity: 0 delta maps to ~33 (zero growth = middle-low)", () => {
  // (0 + 1) / 3 * 100 = 33.33
  assert.ok(Math.abs(normalizeVelocity(0) - 33.333) < 0.01);
});

// ─── clamp ──────────────────────────────────────────────────────────────────
test("clamp respects bounds on both sides", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(10, 10, 10), 10);
});

// ─── calculateMomentum ──────────────────────────────────────────────────────
test("calculateMomentum: high velocity + positive delta → Breakout", () => {
  assert.equal(calculateMomentum(80, 0.8), "Breakout");
});

test("calculateMomentum: moderate velocity + mild positive delta → Sustained", () => {
  assert.equal(calculateMomentum(55, 0.2), "Sustained");
});

test("calculateMomentum: low velocity + negative delta → Cooling", () => {
  assert.equal(calculateMomentum(30, -0.3), "Cooling");
});

test("calculateMomentum: default → Stable", () => {
  assert.equal(calculateMomentum(50, 0), "Stable");
  assert.equal(calculateMomentum(80, 0), "Stable"); // high vel but no delta
  assert.equal(calculateMomentum(20, -0.05), "Stable"); // negative but tiny
});

// ─── generateDrivers ────────────────────────────────────────────────────────
test("generateDrivers: no signals returns 'Steady Baseline'", () => {
  const drivers = generateDrivers(0, 0, 0);
  assert.deepEqual(drivers, ["Steady Baseline"]);
});

test("generateDrivers: high deltas produce three 'spike' labels", () => {
  const drivers = generateDrivers(0.8, 0.8, 0.8);
  assert.ok(drivers.includes("Wikipedia Spike"));
  assert.ok(drivers.includes("Heavy News Coverage"));
  assert.ok(drivers.includes("Search Breakout"));
});

test("generateDrivers: moderate deltas produce 'rising' labels", () => {
  const drivers = generateDrivers(0.3, 0.3, 0.3);
  assert.ok(drivers.includes("Rising Wikipedia Interest"));
  assert.ok(drivers.includes("Increased Media Attention"));
  assert.ok(drivers.includes("Trending in Search"));
});

test("generateDrivers: mixed signals only report active sources", () => {
  const drivers = generateDrivers(0.8, 0, 0);
  assert.deepEqual(drivers, ["Wikipedia Spike"]);
});
