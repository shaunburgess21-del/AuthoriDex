import test from "node:test";
import assert from "node:assert/strict";
import {
  isSettlementEligibleVisibility,
  SETTLEMENT_ELIGIBLE_VISIBILITIES,
} from "../shared/lib/market-visibility";

test("isSettlementEligibleVisibility allows live and inactive only", () => {
  assert.equal(isSettlementEligibleVisibility("live"), true);
  assert.equal(isSettlementEligibleVisibility("inactive"), true);
  assert.equal(isSettlementEligibleVisibility("draft"), false);
  assert.equal(isSettlementEligibleVisibility("archived"), false);
  assert.equal(isSettlementEligibleVisibility(null), false);
  assert.equal(isSettlementEligibleVisibility(undefined), false);
  assert.equal(isSettlementEligibleVisibility(""), false);
});

test("SETTLEMENT_ELIGIBLE_VISIBILITIES is the canonical SQL filter list", () => {
  assert.deepEqual([...SETTLEMENT_ELIGIBLE_VISIBILITIES], ["live", "inactive"]);
});
