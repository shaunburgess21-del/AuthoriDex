import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBuyReplayResponse,
  buildSellReplayResponse,
} from "../server/services/amm-trades-replay";
import { pricesAll } from "../shared/lib/amm/lmsr";
import type { AmmStateSnapshot } from "../shared/lib/amm/positions";

// Pure response-builders for the idempotent-trade replay path. These
// tests pin the defensive guards (entryId mismatch, missing walletRow
// fallback, remainingShares clamp + filtering) so a future refactor
// cannot silently remove them — the DB-backed `replayPriorBuy/Sell`
// shells can't be exercised in unit tests without a live database, so
// the guards live here in pure functions instead.

const STATE: AmmStateSnapshot = {
  liquidityB: 10,
  outcomeOrder: ["yes", "no"],
  shareQuantities: { yes: 3, no: 1 },
};
const B = 10;

// ---------------------------------------------------------------------------
// Buy builder
// ---------------------------------------------------------------------------

test("buildBuyReplayResponse: valid prior bet returns hydrated response with correct field mapping", () => {
  const result = buildBuyReplayResponse({
    bet: {
      id: "bet-1",
      entryId: "yes",
      shareCount: "12.5",
      stakeAmount: 50,
      pricePerShare: "0.4",
    },
    walletRow: { predictCredits: 950 },
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.betId, "bet-1");
  assert.equal(result.sharesPurchased, 12.5);
  assert.equal(result.chargeCredits, 50);
  assert.equal(result.pricePerShareAvg, 0.4);
  assert.equal(result.userBalanceAfter, 950);
  assert.deepEqual(result.newQ, { yes: 3, no: 1 });
});

test("buildBuyReplayResponse: entryId mismatch returns null (defensive guard)", () => {
  const result = buildBuyReplayResponse({
    bet: {
      id: "bet-mismatch",
      entryId: "no",
      shareCount: "1",
      stakeAmount: 1,
      pricePerShare: "0.6",
    },
    walletRow: { predictCredits: 100 },
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.equal(result, null);
});

test("buildBuyReplayResponse: missing walletRow falls back to userBalanceAfter: 0", () => {
  const result = buildBuyReplayResponse({
    bet: {
      id: "bet-2",
      entryId: "yes",
      shareCount: "2",
      stakeAmount: 1,
      pricePerShare: "0.5",
    },
    walletRow: null,
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.userBalanceAfter, 0);
});

test("buildBuyReplayResponse: newPrices vector matches pricesAll(state, b) and newSharePrice picks the expected entry", () => {
  const result = buildBuyReplayResponse({
    bet: {
      id: "bet-3",
      entryId: "yes",
      shareCount: "1",
      stakeAmount: 1,
      pricePerShare: "0.5",
    },
    walletRow: { predictCredits: 100 },
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  const expected = pricesAll([3, 1], B);
  assert.equal(result.newPrices.yes, expected[0]);
  assert.equal(result.newPrices.no, expected[1]);
  assert.equal(result.newSharePrice, expected[0]);
});

test("buildBuyReplayResponse: nullable shareCount/stakeAmount/pricePerShare coerce to 0", () => {
  const result = buildBuyReplayResponse({
    bet: {
      id: "bet-nulls",
      entryId: "yes",
      shareCount: null,
      stakeAmount: null,
      pricePerShare: null,
    },
    walletRow: { predictCredits: 0 },
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.sharesPurchased, 0);
  assert.equal(result.chargeCredits, 0);
  assert.equal(result.pricePerShareAvg, 0);
});

// ---------------------------------------------------------------------------
// Sell builder
// ---------------------------------------------------------------------------

test("buildSellReplayResponse: valid prior sell returns hydrated response with correct field mapping", () => {
  const result = buildSellReplayResponse({
    bet: {
      id: "sell-1",
      entryId: "yes",
      shareCount: "4",
      pricePerShare: "0.45",
      payoutAmount: 18,
    },
    walletRow: { predictCredits: 1018 },
    positionRows: [
      { actionType: "buy", shareCount: "10" },
      { actionType: "sell", shareCount: "4" },
    ],
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.betId, "sell-1");
  assert.equal(result.sharesSold, 4);
  assert.equal(result.proceeds, 18);
  assert.equal(result.pricePerShareAvg, 0.45);
  assert.equal(result.userBalanceAfter, 1018);
  assert.equal(result.remainingShares, 6);
});

test("buildSellReplayResponse: entryId mismatch returns null (defensive guard)", () => {
  const result = buildSellReplayResponse({
    bet: {
      id: "sell-mismatch",
      entryId: "no",
      shareCount: "1",
      pricePerShare: "0.4",
      payoutAmount: 0,
    },
    walletRow: { predictCredits: 100 },
    positionRows: [],
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.equal(result, null);
});

test("buildSellReplayResponse: missing walletRow falls back to userBalanceAfter: 0", () => {
  const result = buildSellReplayResponse({
    bet: {
      id: "sell-2",
      entryId: "yes",
      shareCount: "1",
      pricePerShare: "0.5",
      payoutAmount: 0,
    },
    walletRow: null,
    positionRows: [],
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.userBalanceAfter, 0);
});

test("buildSellReplayResponse: remainingShares correctly sums buys minus sells across multiple rows", () => {
  const result = buildSellReplayResponse({
    bet: {
      id: "sell-3",
      entryId: "yes",
      shareCount: "2",
      pricePerShare: "0.5",
      payoutAmount: 1,
    },
    walletRow: { predictCredits: 0 },
    positionRows: [
      { actionType: "buy", shareCount: "5" },
      { actionType: "buy", shareCount: "3" },
      { actionType: "sell", shareCount: "1" },
      { actionType: "sell", shareCount: "2" },
    ],
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.remainingShares, 5);
});

test("buildSellReplayResponse: remainingShares clamps at 0 when float drift goes slightly negative", () => {
  const result = buildSellReplayResponse({
    bet: {
      id: "sell-4",
      entryId: "yes",
      shareCount: "10",
      pricePerShare: "0.5",
      payoutAmount: 5,
    },
    walletRow: { predictCredits: 0 },
    positionRows: [
      { actionType: "buy", shareCount: "10" },
      // Floating-point drift: a UI-supplied "sell all" computes
      // 10.0000000001 from accumulated quote slippage. We never want
      // to expose a negative remainingShares to the client.
      { actionType: "sell", shareCount: "10.0000000001" },
    ],
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.remainingShares, 0);
});

test("buildSellReplayResponse: positionRows with non buy/sell actionType are ignored", () => {
  const result = buildSellReplayResponse({
    bet: {
      id: "sell-5",
      entryId: "yes",
      shareCount: "1",
      pricePerShare: "0.5",
      payoutAmount: 0,
    },
    walletRow: { predictCredits: 0 },
    positionRows: [
      { actionType: "buy", shareCount: "5" },
      { actionType: "settle", shareCount: "100" },
      { actionType: null, shareCount: "999" },
      { actionType: "sell", shareCount: "2" },
    ],
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.remainingShares, 3);
});

test("buildSellReplayResponse: positionRows with non-finite shareCount are ignored", () => {
  const result = buildSellReplayResponse({
    bet: {
      id: "sell-6",
      entryId: "yes",
      shareCount: "1",
      pricePerShare: "0.5",
      payoutAmount: 0,
    },
    walletRow: { predictCredits: 0 },
    positionRows: [
      { actionType: "buy", shareCount: "5" },
      { actionType: "buy", shareCount: "not-a-number" },
      { actionType: "sell", shareCount: null },
    ],
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.remainingShares, 5);
});

test("buildSellReplayResponse: proceeds comes from bet.payoutAmount (frozen at original trade), not recomputed from current state", () => {
  const recomputedProceeds = 999;
  const recordedProceeds = 17;
  const result = buildSellReplayResponse({
    bet: {
      id: "sell-7",
      entryId: "yes",
      shareCount: "4",
      pricePerShare: "0.425",
      payoutAmount: recordedProceeds,
    },
    walletRow: { predictCredits: 0 },
    positionRows: [{ actionType: "buy", shareCount: "10" }],
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  assert.equal(result.proceeds, recordedProceeds);
  assert.notEqual(result.proceeds, recomputedProceeds);
});

test("buildSellReplayResponse: newPrices vector matches pricesAll(state, b)", () => {
  const result = buildSellReplayResponse({
    bet: {
      id: "sell-8",
      entryId: "yes",
      shareCount: "1",
      pricePerShare: "0.5",
      payoutAmount: 0,
    },
    walletRow: { predictCredits: 0 },
    positionRows: [],
    state: STATE,
    liquidityB: B,
    expectedEntryId: "yes",
  });
  assert.ok(result);
  const expected = pricesAll([3, 1], B);
  assert.equal(result.newPrices.yes, expected[0]);
  assert.equal(result.newPrices.no, expected[1]);
  assert.equal(result.newSharePrice, expected[0]);
});
