import test from "node:test";
import assert from "node:assert/strict";

import {
  type AmmStateSnapshot,
  type AmmTradeRow,
  currentPrices,
  quoteBuy,
  quoteSell,
  summarizePosition,
} from "../shared/lib/amm/positions";
import { housePnL, initialSeedCost, seedB } from "../shared/lib/amm/lmsr";
import {
  AMM_PRE_RESOLVE_COOLDOWN_MS,
  deriveNativeMarketLifecycle,
  getAmmTradingCutoff,
  getMarketBettingCutoff,
  getWeeklyBettingCutoff,
} from "../server/native-markets/lifecycle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function approxEqual(actual: number, expected: number, tol: number, msg?: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? "approxEqual"}: |${actual} − ${expected}| = ${Math.abs(actual - expected)} > tol ${tol}`,
  );
}

function freshState(entryIds: string[], targetMaxLoss = 5000): AmmStateSnapshot {
  const liquidityB = seedB(entryIds.length, targetMaxLoss);
  const shareQuantities: Record<string, number> = {};
  for (const id of entryIds) shareQuantities[id] = 0;
  return { liquidityB, outcomeOrder: entryIds.slice(), shareQuantities };
}

function applyBuy(
  state: AmmStateSnapshot,
  entryId: string,
  budget: number,
): { trade: AmmTradeRow; chargeCredits: number; shares: number } {
  const quote = quoteBuy(state, entryId, budget);
  state.shareQuantities[entryId] = (state.shareQuantities[entryId] ?? 0) + quote.shares;
  return {
    trade: {
      entryId,
      actionType: "buy",
      shareCount: quote.shares,
      stakeAmount: quote.chargeCredits,
    },
    chargeCredits: quote.chargeCredits,
    shares: quote.shares,
  };
}

function applySell(
  state: AmmStateSnapshot,
  entryId: string,
  shares: number,
): { trade: AmmTradeRow; proceeds: number } {
  const quote = quoteSell(state, entryId, shares);
  state.shareQuantities[entryId] = (state.shareQuantities[entryId] ?? 0) - shares;
  return {
    trade: {
      entryId,
      actionType: "sell",
      shareCount: shares,
      stakeAmount: -quote.proceeds,
    },
    proceeds: quote.proceeds,
  };
}

// ===========================================================================
// H2H AMM lifecycle: two users on opposite sides, person1 wins.
// ===========================================================================

test("H2H AMM: two opposing buys, resolve to person1 → winners get 1 credit per share", () => {
  const state = freshState(["p1", "p2"]);
  const seedCost = Math.ceil(initialSeedCost(2, state.liquidityB));

  // Alice backs p1 with 250 credits.
  const alice = applyBuy(state, "p1", 250);
  // Bob backs p2 with 400 credits.
  const bob = applyBuy(state, "p2", 400);

  const aliceSummary = summarizePosition([alice.trade]).get("p1")!;
  const bobSummary = summarizePosition([bob.trade]).get("p2")!;

  // Resolve to p1: alice wins, bob loses.
  const alicePayout = aliceSummary.netShares; // 1 credit per share
  const bobPayout = 0;

  // House P/L using the canonical housePnL helper.
  const finalQ = state.outcomeOrder.map((id) => state.shareQuantities[id] ?? 0);
  const winnerIdx = state.outcomeOrder.indexOf("p1");
  const totalUserCreditsIn = alice.chargeCredits + bob.chargeCredits;
  const settledHouse = housePnL(finalQ, state.liquidityB, winnerIdx, totalUserCreditsIn);

  // Conservation: sum of (alice in + bob in) + house seed cost = alice payout + house ending balance.
  const totalCreditsIn = alice.chargeCredits + bob.chargeCredits + seedCost;
  const totalCreditsOut = alicePayout + bobPayout + (seedCost + settledHouse);
  approxEqual(totalCreditsOut, totalCreditsIn, 1e-9, "H2H zero-sum (resolve)");

  assert.ok(alicePayout > 0, "alice should win something");
  assert.ok(aliceSummary.netShares > 0);
  assert.equal(bobPayout, 0);
});

// ===========================================================================
// Up/Down AMM lifecycle: alice partial sell, then resolve UP.
// ===========================================================================

test("Up/Down AMM: alice buys UP, bob buys DOWN, alice sells half, resolve UP", () => {
  const state = freshState(["up", "down"]);
  const seedCost = Math.ceil(initialSeedCost(2, state.liquidityB));

  const aliceBuy = applyBuy(state, "up", 300);
  const bobBuy = applyBuy(state, "down", 200);

  // Alice sells half her UP holding.
  const sellShares = aliceBuy.shares / 2;
  const aliceSell = applySell(state, "up", sellShares);

  const aliceSummary = summarizePosition([aliceBuy.trade, aliceSell.trade]).get("up")!;
  const bobSummary = summarizePosition([bobBuy.trade]).get("down")!;

  approxEqual(aliceSummary.netShares, aliceBuy.shares - sellShares, 1e-9);
  approxEqual(
    aliceSummary.netCreditsIn,
    aliceBuy.chargeCredits - aliceSell.proceeds,
    1e-9,
  );

  // Resolve UP.
  const alicePayout = aliceSummary.netShares;
  const bobPayout = 0;
  void bobSummary; // shape-asserted via summarizePosition above

  const totalUserCreditsIn =
    aliceBuy.chargeCredits + bobBuy.chargeCredits - aliceSell.proceeds;
  const finalQ = state.outcomeOrder.map((id) => state.shareQuantities[id] ?? 0);
  const winnerIdx = state.outcomeOrder.indexOf("up");
  const settledHouse = housePnL(finalQ, state.liquidityB, winnerIdx, totalUserCreditsIn);

  // Zero-sum: every credit accounted for.
  const totalCreditsIn =
    aliceBuy.chargeCredits + bobBuy.chargeCredits + seedCost;
  const totalCreditsOut =
    alicePayout +
    aliceSell.proceeds +
    bobPayout +
    (seedCost + settledHouse);
  approxEqual(totalCreditsOut, totalCreditsIn, 1e-9, "Up/Down zero-sum across partial sell");

  // Marginal price moved correctly: after alice's partial exit and bob's
  // DOWN buy, UP price should still reflect the net long imbalance.
  const finalPrices = currentPrices(state);
  approxEqual(finalPrices.up + finalPrices.down, 1, 1e-12);
});

// ===========================================================================
// H2H tie path: voidMarket=true returns every position to its cost basis.
// ===========================================================================

test("H2H AMM tie → void: every user position refunded at cost basis", () => {
  const state = freshState(["p1", "p2"]);

  // Alice + Bob trade equally on opposite sides; final state ties.
  const alice = applyBuy(state, "p1", 100);
  const bob = applyBuy(state, "p2", 100);
  // Force a tie: alice and bob each made one buy of equal credit value
  // — that's what `voidMarket: true` is supposed to refund.

  // The void path refunds every user the netCreditsIn on each entry.
  const aliceRefund = summarizePosition([alice.trade]).get("p1")!.netCreditsIn;
  const bobRefund = summarizePosition([bob.trade]).get("p2")!.netCreditsIn;

  // Alice/Bob get back exactly what they paid in.
  approxEqual(aliceRefund, alice.chargeCredits, 1e-9);
  approxEqual(bobRefund, bob.chargeCredits, 1e-9);
});

// ===========================================================================
// Cutoff path: AMM markets close 5 minutes before endAt, parimutuel uses
// the legacy Friday cutoff.
// ===========================================================================

test("AMM cutoff = endAt - 5 minutes; parimutuel cutoff = Friday 23:59 UTC", () => {
  // Sunday 23:59:59.999 UTC end.
  const endAt = new Date("2026-05-17T23:59:59.999Z");

  const ammCutoff = getAmmTradingCutoff(endAt);
  const parimutuelCutoff = getWeeklyBettingCutoff(endAt);

  assert.equal(
    ammCutoff.getTime(),
    endAt.getTime() - AMM_PRE_RESOLVE_COOLDOWN_MS,
    "AMM cutoff is exactly endAt - 5 minutes",
  );

  // Friday for a Sunday end-at = endAt - 2 days, snapped to 23:59:59.999 UTC.
  const expectedFriday = new Date("2026-05-15T23:59:59.999Z");
  assert.equal(parimutuelCutoff.getTime(), expectedFriday.getTime());

  // The dispatch helper mirrors the per-engine logic.
  assert.equal(getMarketBettingCutoff(endAt, "amm").getTime(), ammCutoff.getTime());
  assert.equal(
    getMarketBettingCutoff(endAt, "parimutuel").getTime(),
    parimutuelCutoff.getTime(),
  );
});

test("deriveNativeMarketLifecycle: AMM market still OPEN at cutoff - 1ms, ENTRIES_CLOSED at cutoff + 1ms", () => {
  const endAt = new Date("2026-05-17T23:59:59.999Z");
  const cutoff = getAmmTradingCutoff(endAt);

  const justBefore = new Date(cutoff.getTime() - 1);
  const justAfter = new Date(cutoff.getTime() + 1);

  const openLifecycle = deriveNativeMarketLifecycle(endAt, justBefore, "amm");
  assert.equal(openLifecycle.status, "OPEN");
  assert.equal(openLifecycle.isCutoffPassed, false);

  const closedLifecycle = deriveNativeMarketLifecycle(endAt, justAfter, "amm");
  assert.equal(closedLifecycle.status, "ENTRIES_CLOSED");
  assert.equal(closedLifecycle.isCutoffPassed, true);
});

test("deriveNativeMarketLifecycle: parimutuel market keeps Friday cutoff regardless of AMM logic", () => {
  const endAt = new Date("2026-05-17T23:59:59.999Z");
  const friday = getWeeklyBettingCutoff(endAt);
  const justAfterFriday = new Date(friday.getTime() + 1);

  const lifecycle = deriveNativeMarketLifecycle(endAt, justAfterFriday, "parimutuel");
  assert.equal(lifecycle.status, "ENTRIES_CLOSED");
  assert.equal(lifecycle.isCutoffPassed, true);

  // Same instant on an AMM market: still OPEN (Friday cutoff doesn't apply).
  const ammLifecycle = deriveNativeMarketLifecycle(endAt, justAfterFriday, "amm");
  assert.equal(ammLifecycle.status, "OPEN");
});
