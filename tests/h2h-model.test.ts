import test from "node:test";
import assert from "node:assert/strict";

import { h2hModelProbability } from "../shared/h2hModel";

test("h2hModelProbability: equal scores with identical momentum → 50/50", () => {
  const r = h2hModelProbability(
    { fameIndex: 500_000, momentum: "Stable" },
    { fameIndex: 500_000, momentum: "Stable" },
  );
  assert.equal(r.p1, 50);
  assert.equal(r.p2, 50);
  assert.equal(r.confidence, "low");
});

test("h2hModelProbability: dominant fame wins", () => {
  const r = h2hModelProbability(
    { fameIndex: 800_000, momentum: "Stable" },
    { fameIndex: 200_000, momentum: "Stable" },
  );
  assert.equal(r.p1, 80);
  assert.equal(r.p2, 20);
  assert.equal(r.confidence, "high");
});

test("h2hModelProbability: momentum breaks a fame tie", () => {
  const r = h2hModelProbability(
    { fameIndex: 500_000, momentum: "Breakout" },
    { fameIndex: 500_000, momentum: "Cooling" },
  );
  assert.ok(r.p1 > 50, `expected p1 > 50 with Breakout vs Cooling, got ${r.p1}`);
  assert.equal(r.p1 + r.p2, 100);
});

test("h2hModelProbability: Sustained favours over Stable", () => {
  const r = h2hModelProbability(
    { fameIndex: 500_000, momentum: "Sustained" },
    { fameIndex: 500_000, momentum: "Stable" },
  );
  assert.ok(r.p1 > 50);
});

test("h2hModelProbability: p1 + p2 always equal 100", () => {
  const cases: Array<[number, number]> = [
    [10_000, 990_000],
    [123_456, 789_012],
    [1, 1],
    [999_999, 1],
  ];
  for (const [a, b] of cases) {
    const r = h2hModelProbability(
      { fameIndex: a, momentum: "Stable" },
      { fameIndex: b, momentum: "Stable" },
    );
    assert.equal(r.p1 + r.p2, 100, `failed for (${a}, ${b}): p1=${r.p1}, p2=${r.p2}`);
  }
});

test("h2hModelProbability: clamps to [1, 99] when one side is near zero", () => {
  const r = h2hModelProbability(
    { fameIndex: 1_000_000, momentum: "Breakout" },
    { fameIndex: 0, momentum: "Stable" },
  );
  assert.ok(r.p1 <= 99, `p1 should be capped at 99, got ${r.p1}`);
  assert.ok(r.p2 >= 1, `p2 should be floored at 1, got ${r.p2}`);
  assert.equal(r.p1 + r.p2, 100);
});

test("h2hModelProbability: null / undefined momentum defaults to 1.0 multiplier", () => {
  const r1 = h2hModelProbability(
    { fameIndex: 500_000 },
    { fameIndex: 500_000, momentum: "Stable" },
  );
  const r2 = h2hModelProbability(
    { fameIndex: 500_000, momentum: null },
    { fameIndex: 500_000, momentum: "Stable" },
  );
  assert.equal(r1.p1, 50);
  assert.equal(r2.p1, 50);
});

test("h2hModelProbability: confidence thresholds work at boundaries", () => {
  // gap of ~15 from 50 should be "high"
  const hi = h2hModelProbability(
    { fameIndex: 650_000, momentum: "Stable" },
    { fameIndex: 350_000, momentum: "Stable" },
  );
  assert.equal(hi.confidence, "high");

  // gap of ~7-14 should be "medium"
  const mid = h2hModelProbability(
    { fameIndex: 580_000, momentum: "Stable" },
    { fameIndex: 420_000, momentum: "Stable" },
  );
  assert.equal(mid.confidence, "medium");

  // gap of <7 should be "low"
  const lo = h2hModelProbability(
    { fameIndex: 520_000, momentum: "Stable" },
    { fameIndex: 480_000, momentum: "Stable" },
  );
  assert.equal(lo.confidence, "low");
});

test("h2hModelProbability: negative or missing fameIndex is treated as 1", () => {
  const r = h2hModelProbability(
    { fameIndex: -5, momentum: "Stable" },
    { fameIndex: 100_000, momentum: "Stable" },
  );
  assert.ok(r.p1 >= 1 && r.p1 <= 99);
  assert.equal(r.p1 + r.p2, 100);
});
