import test from "node:test";
import assert from "node:assert/strict";

import {
  SELF_TRADE_GUARD_ENABLED,
  isSelfTradeDenied,
} from "../server/services/amm-self-trade";

const CREATOR = "035adc7b-6087-421e-b635-b6b9ad2c8cd2";
const OTHER = "00000000-0000-0000-0000-000000000001";

test("isSelfTradeDenied: guard off -> never blocks", () => {
  assert.equal(isSelfTradeDenied(false, CREATOR, CREATOR), false);
  assert.equal(isSelfTradeDenied(false, CREATOR, OTHER), false);
  assert.equal(isSelfTradeDenied(false, null, CREATOR), false);
});

test("isSelfTradeDenied: guard on -> blocks only matching creator", () => {
  assert.equal(isSelfTradeDenied(true, CREATOR, CREATOR), true);
  assert.equal(isSelfTradeDenied(true, CREATOR, OTHER), false);
  assert.equal(isSelfTradeDenied(true, null, CREATOR), false);
  assert.equal(isSelfTradeDenied(true, undefined, CREATOR), false);
});

test("SELF_TRADE_GUARD_ENABLED defaults off when env unset", () => {
  // Pre-launch default: founders can trade markets they created.
  // If this fails locally, check .env for SELF_TRADE_GUARD_ENABLED=true.
  if (process.env.SELF_TRADE_GUARD_ENABLED != null) {
    assert.ok(true, "skipped — env override present");
    return;
  }
  assert.equal(SELF_TRADE_GUARD_ENABLED, false);
});
