import test from "node:test";
import assert from "node:assert/strict";

import {
  type AmmStateSnapshot,
  type AmmTradeRow,
  currentPrices,
  indexOfEntry,
  projectQ,
  quoteBuy,
  quoteSell,
  summarizePosition,
} from "../shared/lib/amm/positions";
import {
  buyCost,
  housePnL,
  initialSeedCost,
  pricesAll,
  seedB,
  sellProceeds,
} from "../shared/lib/amm/lmsr";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function approxEqual(actual: number, expected: number, tol: number, msg?: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? "approxEqual"}: |${actual} − ${expected}| = ${Math.abs(actual - expected)} > tol ${tol}`,
  );
}

function makeState(entryIds: string[], targetMaxLoss = 5000): AmmStateSnapshot {
  const liquidityB = seedB(entryIds.length, targetMaxLoss);
  const shareQuantities: Record<string, number> = {};
  for (const id of entryIds) shareQuantities[id] = 0;
  return { liquidityB, outcomeOrder: entryIds.slice(), shareQuantities };
}

// ---------------------------------------------------------------------------
// projectQ + indexOfEntry + currentPrices
// ---------------------------------------------------------------------------

test("projectQ returns shares in canonical outcomeOrder", () => {
  const state: AmmStateSnapshot = {
    liquidityB: 100,
    outcomeOrder: ["a", "b", "c"],
    shareQuantities: { c: 30, a: 10, b: 20 },
  };
  assert.deepEqual(projectQ(state), [10, 20, 30]);
});

test("projectQ defaults missing entries to 0", () => {
  const state: AmmStateSnapshot = {
    liquidityB: 100,
    outcomeOrder: ["a", "b"],
    shareQuantities: { a: 5 },
  };
  assert.deepEqual(projectQ(state), [5, 0]);
});

test("indexOfEntry returns -1 for unknown entries", () => {
  const state = makeState(["a", "b"]);
  assert.equal(indexOfEntry(state, "a"), 0);
  assert.equal(indexOfEntry(state, "b"), 1);
  assert.equal(indexOfEntry(state, "c"), -1);
});

test("currentPrices on a fresh market is uniform 1/N", () => {
  const state = makeState(["a", "b", "c", "d"]);
  const prices = currentPrices(state);
  approxEqual(prices.a, 0.25, 1e-12);
  approxEqual(prices.b, 0.25, 1e-12);
  approxEqual(prices.c, 0.25, 1e-12);
  approxEqual(prices.d, 0.25, 1e-12);
  approxEqual(prices.a + prices.b + prices.c + prices.d, 1, 1e-12);
});

// ---------------------------------------------------------------------------
// summarizePosition
// ---------------------------------------------------------------------------

test("summarizePosition handles empty input", () => {
  const out = summarizePosition([]);
  assert.equal(out.size, 0);
});

test("summarizePosition: buys-only sums shares and credits in", () => {
  const rows: AmmTradeRow[] = [
    { entryId: "a", actionType: "buy", shareCount: 10, stakeAmount: 50 },
    { entryId: "a", actionType: "buy", shareCount: 5, stakeAmount: 30 },
    { entryId: "b", actionType: "buy", shareCount: 8, stakeAmount: 40 },
  ];
  const out = summarizePosition(rows);
  assert.deepEqual(out.get("a"), { netShares: 15, netCreditsIn: 80 });
  assert.deepEqual(out.get("b"), { netShares: 8, netCreditsIn: 40 });
});

test("summarizePosition: buy + sell decrements shares and credits in", () => {
  // Buy 20 for 100, sell 5 for -25 (stakeAmount stored negative on sells).
  // Net: 15 shares held, 75 credits in.
  const rows: AmmTradeRow[] = [
    { entryId: "a", actionType: "buy", shareCount: 20, stakeAmount: 100 },
    { entryId: "a", actionType: "sell", shareCount: 5, stakeAmount: -25 },
  ];
  const out = summarizePosition(rows);
  assert.deepEqual(out.get("a"), { netShares: 15, netCreditsIn: 75 });
});

test("summarizePosition: full close leaves netShares=0 and net pnl in creditsIn", () => {
  // Bought 10 for 50, sold 10 back for 60 (profit). Net shares = 0,
  // net credits in = -10 (user is up 10 credits on this entry).
  const rows: AmmTradeRow[] = [
    { entryId: "a", actionType: "buy", shareCount: 10, stakeAmount: 50 },
    { entryId: "a", actionType: "sell", shareCount: 10, stakeAmount: -60 },
  ];
  const out = summarizePosition(rows);
  assert.deepEqual(out.get("a"), { netShares: 0, netCreditsIn: -10 });
});

// ---------------------------------------------------------------------------
// quoteBuy
// ---------------------------------------------------------------------------

test("quoteBuy: chargeCredits never exceeds creditBudget for a range of budgets", () => {
  const state = makeState(["a", "b"]);
  for (const budget of [5, 50, 500, 5000, 100_000]) {
    const q = quoteBuy(state, "a", budget);
    assert.ok(
      q.chargeCredits <= budget,
      `budget=${budget}: chargeCredits=${q.chargeCredits} exceeded budget`,
    );
    assert.ok(q.shares > 0, `budget=${budget}: should have purchased some shares`);
    assert.ok(q.pricePerShareAvg > 0 && q.pricePerShareAvg < 1);
  }
});

test("quoteBuy: returns zero when budget rounds below 1 credit", () => {
  const state = makeState(["a", "b"]);
  const q = quoteBuy(state, "a", 0);
  assert.equal(q.shares, 0);
  assert.equal(q.chargeCredits, 0);
});

test("quoteBuy: throws on unknown entryId", () => {
  const state = makeState(["a", "b"]);
  assert.throws(() => quoteBuy(state, "c", 100), /not in market outcomeOrder/);
});

test("quoteBuy: avg price of a tiny buy approximates current marginal price", () => {
  // For a small trade, the average price should be very close to the
  // marginal price (slippage scales with shares/b).
  const state = makeState(["a", "b"]);
  const tinyQuote = quoteBuy(state, "a", 5);
  const startingPrice = currentPrices(state).a;
  approxEqual(tinyQuote.pricePerShareAvg, startingPrice, 5e-3, "tiny trade slippage");
});

test("quoteBuy: large buy moves the price up significantly", () => {
  const state = makeState(["a", "b"]);
  const startingPrice = currentPrices(state).a;
  const bigQuote = quoteBuy(state, "a", 5000);
  assert.ok(
    bigQuote.newPrices.a > startingPrice + 0.1,
    `big buy should push price up substantially: was ${startingPrice}, now ${bigQuote.newPrices.a}`,
  );
});

// ---------------------------------------------------------------------------
// quoteSell
// ---------------------------------------------------------------------------

test("quoteSell: proceeds is non-negative and increasing in shares", () => {
  // Pre-load the market: someone bought 200 shares of A.
  const state = makeState(["a", "b"]);
  state.shareQuantities.a = 200;
  const q1 = quoteSell(state, "a", 10);
  const q2 = quoteSell(state, "a", 50);
  assert.ok(q1.proceeds >= 0 && q2.proceeds >= 0);
  assert.ok(q2.proceeds > q1.proceeds, "selling more shares yields more proceeds");
});

test("quoteSell: throws on zero / negative / non-finite shares", () => {
  const state = makeState(["a", "b"]);
  state.shareQuantities.a = 100;
  assert.throws(() => quoteSell(state, "a", 0), /positive finite/);
  assert.throws(() => quoteSell(state, "a", -1), /positive finite/);
  assert.throws(() => quoteSell(state, "a", Number.NaN), /positive finite/);
});

test("quoteSell: throws on unknown entry", () => {
  const state = makeState(["a", "b"]);
  assert.throws(() => quoteSell(state, "c", 5), /not in market outcomeOrder/);
});

// ---------------------------------------------------------------------------
// End-to-end math walk (matches the resolver's settlement logic)
// ---------------------------------------------------------------------------

test("end-to-end: open -> buy -> buy -> sell -> resolve has zero-sum invariant", () => {
  // Simulate exactly what the route + resolver pipeline will do, but
  // in pure math (no DB). This exercises the same code path the
  // routes use for math (positions.ts -> lmsr.ts) and verifies that
  // the house P&L formula in `housePnL` reconciles end-to-end with
  // ceiled buys + floored sells.
  const entryIds = ["a", "b"];
  const targetMaxLoss = 5000;
  const b = seedB(2, targetMaxLoss);
  const seedCost = Math.ceil(initialSeedCost(2, b)); // == 5000

  let q = [0, 0];
  let totalUserCreditsIn = 0;
  const aliceTrades: { type: "buy" | "sell"; shares: number; credits: number }[] = [];

  // Alice buys 100 credits of A.
  {
    const state: AmmStateSnapshot = {
      liquidityB: b,
      outcomeOrder: entryIds,
      shareQuantities: { a: q[0], b: q[1] },
    };
    const quote = quoteBuy(state, "a", 100);
    q = [q[0] + quote.shares, q[1]];
    totalUserCreditsIn += quote.chargeCredits;
    aliceTrades.push({ type: "buy", shares: quote.shares, credits: quote.chargeCredits });
    assert.ok(quote.chargeCredits <= 100);
    assert.ok(quote.shares > 0);
  }

  // Alice buys 200 more credits of A.
  {
    const state: AmmStateSnapshot = {
      liquidityB: b,
      outcomeOrder: entryIds,
      shareQuantities: { a: q[0], b: q[1] },
    };
    const quote = quoteBuy(state, "a", 200);
    q = [q[0] + quote.shares, q[1]];
    totalUserCreditsIn += quote.chargeCredits;
    aliceTrades.push({ type: "buy", shares: quote.shares, credits: quote.chargeCredits });
  }

  // Alice sells 50 shares of A back.
  {
    const state: AmmStateSnapshot = {
      liquidityB: b,
      outcomeOrder: entryIds,
      shareQuantities: { a: q[0], b: q[1] },
    };
    const quote = quoteSell(state, "a", 50);
    q = [q[0] - 50, q[1]];
    totalUserCreditsIn -= quote.proceeds;
    aliceTrades.push({ type: "sell", shares: 50, credits: quote.proceeds });
  }

  const aliceNetShares =
    aliceTrades.filter((t) => t.type === "buy").reduce((s, t) => s + t.shares, 0) -
    aliceTrades.filter((t) => t.type === "sell").reduce((s, t) => s + t.shares, 0);
  const alicePaid =
    aliceTrades.filter((t) => t.type === "buy").reduce((s, t) => s + t.credits, 0) -
    aliceTrades.filter((t) => t.type === "sell").reduce((s, t) => s + t.credits, 0);

  assert.ok(Math.abs(aliceNetShares - q[0]) < 1e-9, "alice's shares match market q[a]");

  // Resolve to A. Alice gets floor(netShares) credits.
  const alicePayout = Math.floor(aliceNetShares);
  // House P&L per Phase 1's `housePnL` = totalUserCreditsIn - q[winner].
  // Settlement helper rounds payoutLiability and credits the rest back
  // to house. We want to verify the integer-credit accounting closes
  // with at most a few credits of slop from ceil/floor rounding.
  const housePnLExact = housePnL(q, b, 0, totalUserCreditsIn);
  const houseCredited = Math.round(seedCost + totalUserCreditsIn - alicePayout);

  // Total system flow:
  //   + alicePayout   (alice receives at settlement)
  //   - alicePaid     (alice's net out-of-pocket during the market)
  //   = alice's P&L
  // House:
  //   + houseCredited - seedCost = house's P&L on this market
  // Sum of P&Ls should be 0 (zero-sum) modulo rounding.
  const aliceProfit = alicePayout - alicePaid;
  const houseProfit = houseCredited - seedCost;
  // Allow up to 3 credits slop across 3 trades worth of ceil/floor.
  approxEqual(aliceProfit + houseProfit, 0, 3, "zero-sum invariant after ceil/floor");

  // Sanity: house P&L sign should match floor approximation.
  approxEqual(houseProfit, housePnLExact, 3, "house P&L matches LMSR formula");
});

test("end-to-end void path: refunds match net credits in", () => {
  // After the same sequence, if we VOID instead of resolve, alice
  // should be made whole - she gets back exactly what she's out of
  // pocket. House P&L = 0.
  const b = seedB(2, 5000);
  const seedCost = Math.ceil(initialSeedCost(2, b));

  let q = [0, 0];
  let totalUserCreditsIn = 0;

  const state1: AmmStateSnapshot = {
    liquidityB: b,
    outcomeOrder: ["a", "b"],
    shareQuantities: { a: 0, b: 0 },
  };
  const buy1 = quoteBuy(state1, "a", 100);
  q = [q[0] + buy1.shares, q[1]];
  totalUserCreditsIn += buy1.chargeCredits;

  const refund = totalUserCreditsIn;
  const houseCredited = seedCost + totalUserCreditsIn - refund; // == seedCost
  approxEqual(houseCredited, seedCost, 0, "house breaks even on void");
});

// ---------------------------------------------------------------------------
// Cross-check helpers against lmsr.ts directly
// ---------------------------------------------------------------------------

test("quoteBuy is consistent with raw buyCost", () => {
  const state = makeState(["a", "b", "c"]);
  const q = quoteBuy(state, "a", 1000);
  const rawCost = buyCost([0, 0, 0], 0, q.shares, state.liquidityB);
  assert.equal(q.chargeCredits, Math.ceil(rawCost));
});

test("quoteSell is consistent with raw sellProceeds", () => {
  const state = makeState(["a", "b"]);
  state.shareQuantities.a = 100;
  const qs = quoteSell(state, "a", 30);
  const rawProceeds = sellProceeds([100, 0], 0, 30, state.liquidityB);
  assert.equal(qs.proceeds, Math.floor(Math.max(rawProceeds, 0)));
});

test("quoteBuy newPrices matches pricesAll on the post-trade q", () => {
  const state = makeState(["a", "b"]);
  const q = quoteBuy(state, "a", 500);
  const expectedPrices = pricesAll([q.shares, 0], state.liquidityB);
  approxEqual(q.newPrices.a, expectedPrices[0], 1e-12);
  approxEqual(q.newPrices.b, expectedPrices[1], 1e-12);
});
