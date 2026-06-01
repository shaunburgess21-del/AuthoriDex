import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeLockInFairUp,
  hoursUntilEnd,
  LOCKIN_FAIR_MAX,
  normalCdf,
  sigmaRemain,
} from "../server/agents/lockInFair.ts";

describe("lockInFair", () => {
  it("normalCdf(0) ≈ 0.5", () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 0.001);
  });

  it("large positive move near close → fairUp near max", () => {
    const fair = computeLockInFairUp(1.259, 3.5);
    assert.ok(fair != null);
    assert.ok(fair >= 0.95, `expected ~0.99, got ${fair}`);
    assert.ok(fair <= LOCKIN_FAIR_MAX);
  });

  it("mid-week small move stays uncertain", () => {
    const fair = computeLockInFairUp(0.04, 6 * 24);
    assert.ok(fair != null);
    assert.ok(fair > 0.52 && fair < 0.65, `expected ~0.58, got ${fair}`);
  });

  it("sigmaRemain shrinks as hours decrease", () => {
    const long = sigmaRemain(120);
    const short = sigmaRemain(3);
    assert.ok(short < long);
  });

  it("hoursUntilEnd", () => {
    const end = new Date("2026-06-01T00:00:00Z");
    const now = new Date("2026-05-31T18:00:00Z");
    const h = hoursUntilEnd(end, now);
    assert.ok(Math.abs(h - 6) < 0.01);
  });
});
