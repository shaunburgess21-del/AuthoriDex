import test from "node:test";
import assert from "node:assert/strict";

import { computeLockInFairUp } from "../server/agents/lockInFair";
import {
  usesNativeFridayBettingCutoff,
  NATIVE_FRIDAY_CUTOFF_MARKET_TYPES,
  getAmmTradingClosedMessage,
} from "../server/native-markets/lifecycle";
import { evaluateDrainBreaker } from "../server/agents/drainBreaker-evaluate";

test("computeLockInFairUp: large positive move yields high fair", () => {
  const fair = computeLockInFairUp(0.525, 158);
  assert.ok(fair != null && fair > 0.9);
});

test("usesNativeFridayBettingCutoff: only updown when flag on", () => {
  const prev = process.env.NATIVE_FRIDAY_CUTOFF_ENABLED;
  process.env.NATIVE_FRIDAY_CUTOFF_ENABLED = "true";
  try {
    assert.equal(NATIVE_FRIDAY_CUTOFF_MARKET_TYPES.length, 1);
    assert.equal(NATIVE_FRIDAY_CUTOFF_MARKET_TYPES[0], "updown");
    assert.equal(usesNativeFridayBettingCutoff("updown", "amm"), true);
    assert.equal(usesNativeFridayBettingCutoff("h2h", "amm"), false);
    assert.equal(usesNativeFridayBettingCutoff("gainer", "amm"), false);
  } finally {
    if (prev === undefined) delete process.env.NATIVE_FRIDAY_CUTOFF_ENABLED;
    else process.env.NATIVE_FRIDAY_CUTOFF_ENABLED = prev;
  }
});

test("getAmmTradingClosedMessage: Friday copy only when cutoff applies", () => {
  const prev = process.env.NATIVE_FRIDAY_CUTOFF_ENABLED;
  process.env.NATIVE_FRIDAY_CUTOFF_ENABLED = "true";
  try {
    assert.match(getAmmTradingClosedMessage("updown"), /Friday 23:59 UTC/);
    assert.match(getAmmTradingClosedMessage("h2h"), /final minutes/);
  } finally {
    if (prev === undefined) delete process.env.NATIVE_FRIDAY_CUTOFF_ENABLED;
    else process.env.NATIVE_FRIDAY_CUTOFF_ENABLED = prev;
  }
});

test("evaluateDrainBreaker: headroom math for 30k loss on 100k balance", () => {
  const thresholds = { absoluteLossCapCredits: 50_000, pctLossCap: 0.2 };
  const { trip, thresholdApplied } = evaluateDrainBreaker({
    houseDelta24h: -30_000,
    houseBalance: 100_000,
    thresholds,
  });
  assert.equal(thresholdApplied, 20_000);
  assert.equal(trip, true);
});
