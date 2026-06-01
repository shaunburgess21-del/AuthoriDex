import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveNativeMarketLifecycle,
  getMarketBettingCutoff,
  getWeeklyBettingCutoff,
  getAmmTradingCutoff,
} from "../server/native-markets/lifecycle";

const SUNDAY_END = new Date("2026-06-07T23:59:59.999Z");

test("getMarketBettingCutoff: updown uses Friday when NATIVE_FRIDAY_CUTOFF_ENABLED", () => {
  const prev = process.env.NATIVE_FRIDAY_CUTOFF_ENABLED;
  process.env.NATIVE_FRIDAY_CUTOFF_ENABLED = "true";
  try {
    const friday = getMarketBettingCutoff(SUNDAY_END, "amm", "updown");
    assert.equal(friday.getTime(), getWeeklyBettingCutoff(SUNDAY_END).getTime());
    assert.notEqual(friday.getTime(), getAmmTradingCutoff(SUNDAY_END).getTime());
  } finally {
    if (prev === undefined) delete process.env.NATIVE_FRIDAY_CUTOFF_ENABLED;
    else process.env.NATIVE_FRIDAY_CUTOFF_ENABLED = prev;
  }
});

test("deriveNativeMarketLifecycle: updown ENTRIES_CLOSED after Friday when flag on", () => {
  const prev = process.env.NATIVE_FRIDAY_CUTOFF_ENABLED;
  process.env.NATIVE_FRIDAY_CUTOFF_ENABLED = "true";
  try {
    const saturday = new Date("2026-06-06T12:00:00.000Z");
    const lifecycle = deriveNativeMarketLifecycle(SUNDAY_END, saturday, "amm", "updown");
    assert.equal(lifecycle.status, "ENTRIES_CLOSED");
    assert.equal(lifecycle.isCutoffPassed, true);
  } finally {
    if (prev === undefined) delete process.env.NATIVE_FRIDAY_CUTOFF_ENABLED;
    else process.env.NATIVE_FRIDAY_CUTOFF_ENABLED = prev;
  }
});
