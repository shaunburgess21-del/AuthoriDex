import test from "node:test";
import assert from "node:assert/strict";

import { computeEarlyBirdMultiplier } from "../server/jobs/settlement-utils";

// Parimutuel sunset: `calculateSettlementPayouts` was removed alongside
// `settleMarketBets`. The remaining consumer of `settlement-utils` is
// the jackpot resolver, which still pari-mutuels with an early-bird
// weight. These tests pin the multiplier curve so the jackpot payouts
// stay deterministic.

const WEEK_START = "2026-05-04T00:00:00.000Z"; // Mon 00:00 UTC
const WEEK_CLOSE = "2026-05-08T23:59:00.000Z"; // Fri 23:59 UTC
const MID_WEEK = "2026-05-06T12:00:00.000Z";   // Wed noon
const NEAR_CLOSE = "2026-05-08T22:00:00.000Z"; // Fri ~close

test("boost: bet placed at window start gets max multiplier (1.5x)", () => {
  assert.equal(
    computeEarlyBirdMultiplier(WEEK_START, WEEK_START, WEEK_CLOSE),
    1.5,
  );
});

test("boost: bet placed at midweek decays roughly halfway", () => {
  const mid = computeEarlyBirdMultiplier(MID_WEEK, WEEK_START, WEEK_CLOSE);
  assert.ok(mid > 1.0 && mid < 1.5, `expected mid 1<x<1.5, got ${mid}`);
});

test("boost: bet placed near close approaches 1.0", () => {
  const near = computeEarlyBirdMultiplier(NEAR_CLOSE, WEEK_START, WEEK_CLOSE);
  assert.ok(near < 1.05, `expected near close ~1.0, got ${near}`);
  assert.ok(near >= 1.0, `expected near close >=1.0, got ${near}`);
});

test("boost: bet placed before start clamps to max boost (1.5x)", () => {
  const before = computeEarlyBirdMultiplier(
    "2026-05-01T00:00:00.000Z", // 3 days before window
    WEEK_START,
    WEEK_CLOSE,
  );
  assert.equal(before, 1.5);
});

test("boost: bet placed after close clamps to 1.0", () => {
  const after = computeEarlyBirdMultiplier(
    "2026-05-09T00:00:00.000Z", // after close
    WEEK_START,
    WEEK_CLOSE,
  );
  assert.equal(after, 1);
});

test("boost: zero/negative window returns multiplier 1", () => {
  const same = computeEarlyBirdMultiplier(MID_WEEK, WEEK_CLOSE, WEEK_CLOSE);
  assert.equal(same, 1);
  const inverted = computeEarlyBirdMultiplier(MID_WEEK, WEEK_CLOSE, WEEK_START);
  assert.equal(inverted, 1);
});

test("boost: missing timing context returns 1.0", () => {
  assert.equal(computeEarlyBirdMultiplier(MID_WEEK, null, null), 1);
  assert.equal(computeEarlyBirdMultiplier(null, WEEK_START, WEEK_CLOSE), 1);
});

test("boost: invalid date inputs return 1.0", () => {
  assert.equal(
    computeEarlyBirdMultiplier("not a date", WEEK_START, WEEK_CLOSE),
    1,
  );
});
