import test from "node:test";
import assert from "node:assert/strict";
import { applyAdminCreditAdjustment } from "../server/utils/admin-credits";

test("applyAdminCreditAdjustment keeps requested amount when balance stays non-negative", () => {
  assert.deepEqual(applyAdminCreditAdjustment(100, -25), {
    appliedAmount: -25,
    newBalance: 75,
    wasClamped: false,
  });
});

test("applyAdminCreditAdjustment clamps over-debits to zero balance", () => {
  assert.deepEqual(applyAdminCreditAdjustment(100, -250), {
    appliedAmount: -100,
    newBalance: 0,
    wasClamped: true,
  });
});
