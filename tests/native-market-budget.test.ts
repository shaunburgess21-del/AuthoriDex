import test from "node:test";
import assert from "node:assert/strict";

process.env.NATIVE_MARKETS_DAILY_BUDGET_USD = "2.00";
process.env.NATIVE_MARKETS_PER_CALL_ESTIMATE_USD = "0.012";

const {
  tryReserveNativeLlmCall,
  getNativeBudgetSnapshot,
  getNativeCapUsd,
  _resetNativeBudgetForTesting,
} = await import("../server/agents/nativeMarketBudget");

test("native budget: initial state", () => {
  _resetNativeBudgetForTesting();
  const snap = getNativeBudgetSnapshot();
  assert.equal(snap.spendUsd, 0);
  assert.equal(snap.capUsd, 2.0);
  assert.equal(getNativeCapUsd(), 2.0);
});

test("native budget: blocks when cap exceeded", () => {
  _resetNativeBudgetForTesting();
  const r1 = tryReserveNativeLlmCall(1.5);
  assert.equal(r1.allowed, true);
  if (r1.allowed) r1.commit();
  const r2 = tryReserveNativeLlmCall(1.0);
  assert.equal(r2.allowed, false);
  if (!r2.allowed) assert.equal(r2.reason, "cap_exhausted");
});
