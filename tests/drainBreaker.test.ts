import test from "node:test";
import assert from "node:assert/strict";

import { evaluateDrainBreaker } from "../server/agents/drainBreaker-evaluate";

// Tests for the pure decision helper. The DB-reading shell
// `checkAndTripDrainBreaker` lives behind the same set of decisions
// these tests pin; pinning the decisions here keeps the live path
// honest without needing test DB scaffolding.

const baseThresholds = {
  absoluteLossCapCredits: 50_000,
  pctLossCap: 0.2,
};

test("evaluateDrainBreaker: positive house P&L never trips", () => {
  const result = evaluateDrainBreaker({
    houseDelta24h: 1_000,
    houseBalance: 1_000_000,
    thresholds: baseThresholds,
  });
  assert.equal(result.trip, false);
});

test("evaluateDrainBreaker: zero P&L never trips", () => {
  const result = evaluateDrainBreaker({
    houseDelta24h: 0,
    houseBalance: 1_000_000,
    thresholds: baseThresholds,
  });
  assert.equal(result.trip, false);
});

test("evaluateDrainBreaker: small loss below both caps does not trip", () => {
  // 10k loss, abs cap 50k, pct cap = 20% of 1M = 200k. min(50k, 200k) = 50k.
  // 10k < 50k → no trip.
  const result = evaluateDrainBreaker({
    houseDelta24h: -10_000,
    houseBalance: 1_000_000,
    thresholds: baseThresholds,
  });
  assert.equal(result.trip, false);
  assert.equal(result.thresholdApplied, 50_000);
});

test("evaluateDrainBreaker: loss exceeding absolute cap trips", () => {
  // 60k loss, abs cap 50k. -delta = 60k >= 50k → trip.
  const result = evaluateDrainBreaker({
    houseDelta24h: -60_000,
    houseBalance: 1_000_000,
    thresholds: baseThresholds,
  });
  assert.equal(result.trip, true);
  assert.equal(result.thresholdApplied, 50_000);
});

test("evaluateDrainBreaker: pct cap is the tighter threshold on small house balances", () => {
  // House balance 100k → pct cap = 20% * 100k = 20k. Abs cap = 50k.
  // min(50k, 20k) = 20k. 25k loss exceeds → trip.
  const result = evaluateDrainBreaker({
    houseDelta24h: -25_000,
    houseBalance: 100_000,
    thresholds: baseThresholds,
  });
  assert.equal(result.trip, true);
  assert.equal(result.thresholdApplied, 20_000);
});

test("evaluateDrainBreaker: abs cap is the tighter threshold on huge house balances", () => {
  // House balance 10M → pct cap = 2M. Abs cap = 50k.
  // min(50k, 2M) = 50k. 60k loss exceeds → trip.
  const result = evaluateDrainBreaker({
    houseDelta24h: -60_000,
    houseBalance: 10_000_000,
    thresholds: baseThresholds,
  });
  assert.equal(result.trip, true);
  assert.equal(result.thresholdApplied, 50_000);
});

test("evaluateDrainBreaker: zero house balance falls back to abs cap only", () => {
  // House balance 0 → pct cap = 0. The helper clamps pct → infinity
  // when 0 so the abs cap is the only constraint. 60k loss still
  // trips against the 50k abs cap.
  const result = evaluateDrainBreaker({
    houseDelta24h: -60_000,
    houseBalance: 0,
    thresholds: baseThresholds,
  });
  assert.equal(result.trip, true);
  assert.equal(result.thresholdApplied, 50_000);
});

test("evaluateDrainBreaker: exactly-at-threshold loss trips (>=)", () => {
  const result = evaluateDrainBreaker({
    houseDelta24h: -50_000,
    houseBalance: 1_000_000,
    thresholds: baseThresholds,
  });
  assert.equal(result.trip, true);
});

test("evaluateDrainBreaker: tighter pct cap from operator override", () => {
  // Operator dialed pct cap down to 5%. House balance 1M → pct cap
  // = 50k. Abs cap still 50k. min(50k, 50k) = 50k. 51k loss trips.
  const result = evaluateDrainBreaker({
    houseDelta24h: -51_000,
    houseBalance: 1_000_000,
    thresholds: {
      absoluteLossCapCredits: 50_000,
      pctLossCap: 0.05,
    },
  });
  assert.equal(result.trip, true);
});

test("evaluateDrainBreaker: loosened abs cap raises trip floor", () => {
  // Abs cap raised to 200k. House 1M → pct cap = 200k. Both equal.
  // 100k loss does NOT trip.
  const result = evaluateDrainBreaker({
    houseDelta24h: -100_000,
    houseBalance: 1_000_000,
    thresholds: {
      absoluteLossCapCredits: 200_000,
      pctLossCap: 0.2,
    },
  });
  assert.equal(result.trip, false);
});
