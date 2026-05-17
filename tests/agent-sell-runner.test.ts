/**
 * Agent v3 phase 1 — sell-sweep aggregation tests.
 *
 * Covers the position-aggregation math used inside `runSellSweep` (the
 * helper that takes a list of buy/sell `market_bets` rows and produces
 * one `SellSweepPositionAgg` per (market, entry) for the engine to
 * evaluate). DB plumbing (Drizzle queries, action insert) is covered
 * implicitly by the existing prod path — the failure modes worth
 * pinning here are the ones in the math.
 *
 * The test fixture rows mirror the `marketBets` Drizzle row shape
 * (string-typed numerics, lowercase actionType strings) since that's
 * what `aggregateSellSweepPositions` actually receives in production.
 */

import test from "node:test";
import assert from "node:assert/strict";

// Importing from agentRunner pulls server/db transitively. db throws on
// module load without DATABASE_URL — drizzle is lazy-connected so a fake
// URL is enough; we never query in these tests.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { _aggregateSellSweepPositionsForTesting: aggregate } = await import(
  "../server/agents/agentRunner"
);
import { computeSellDecision } from "../server/agents/sellEngine";
import { createPRNG } from "../server/agents/prng";

interface FixtureBet {
  marketId: string;
  entryId: string;
  actionType: "buy" | "sell" | "parimutuel" | string;
  shareCount: string | null;
  pricePerShare: string | null;
  confidence: string | null;
}

function buy(
  marketId: string,
  entryId: string,
  shares: number,
  price: number,
  confidence?: number,
): FixtureBet {
  return {
    marketId,
    entryId,
    actionType: "buy",
    shareCount: shares.toString(),
    pricePerShare: price.toString(),
    confidence: confidence != null ? confidence.toString() : null,
  };
}

function sell(marketId: string, entryId: string, shares: number, price: number): FixtureBet {
  return {
    marketId,
    entryId,
    actionType: "sell",
    shareCount: shares.toString(),
    pricePerShare: price.toString(),
    confidence: null,
  };
}

// ---------------------------------------------------------------------------
// Aggregation math
// ---------------------------------------------------------------------------

test("single buy yields one position with anchor = buy price", () => {
  const positions = aggregate([buy("m1", "e1", 100, 0.40)]);
  assert.equal(positions.size, 1);
  const pos = positions.get("m1|e1")!;
  assert.equal(pos.netShares, 100);
  assert.equal(pos.buyShares, 100);
  assert.equal(pos.buyCostNotional, 40); // 100 × 0.40
});

test("multiple buys at different prices use weighted-average anchor", () => {
  // 100 @ 0.40 = 40 notional, 200 @ 0.50 = 100 notional. Total 140 / 300 = 0.4667
  const positions = aggregate([
    buy("m1", "e1", 100, 0.40),
    buy("m1", "e1", 200, 0.50),
  ]);
  const pos = positions.get("m1|e1")!;
  assert.equal(pos.buyShares, 300);
  assert.ok(Math.abs(pos.buyCostNotional - 140) < 1e-9);
  const anchor = pos.buyCostNotional / pos.buyShares;
  assert.ok(Math.abs(anchor - 0.4667) < 1e-3);
});

test("sells reduce netShares but DO NOT dilute the anchor", () => {
  // Buy 100 @ 0.40, sell 30 @ 0.55. Anchor must remain 0.40 — the sell
  // is not part of the cost basis. netShares = 70.
  const positions = aggregate([
    buy("m1", "e1", 100, 0.40),
    sell("m1", "e1", 30, 0.55),
  ]);
  const pos = positions.get("m1|e1")!;
  assert.equal(pos.netShares, 70);
  assert.equal(pos.buyShares, 100);
  assert.equal(pos.buyCostNotional, 40);
});

test("multiple entries in same market are tracked separately", () => {
  const positions = aggregate([
    buy("m1", "up", 100, 0.40),
    buy("m1", "down", 50, 0.60),
  ]);
  assert.equal(positions.size, 2);
  assert.equal(positions.get("m1|up")!.netShares, 100);
  assert.equal(positions.get("m1|down")!.netShares, 50);
});

test("non buy/sell action types are ignored", () => {
  const positions = aggregate([
    buy("m1", "e1", 100, 0.40),
    { marketId: "m1", entryId: "e1", actionType: "parimutuel", shareCount: "999", pricePerShare: "0.99", confidence: null },
  ]);
  const pos = positions.get("m1|e1")!;
  assert.equal(pos.netShares, 100);
  assert.equal(pos.buyShares, 100);
});

test("rows with non-finite or zero share counts are skipped", () => {
  const positions = aggregate([
    buy("m1", "e1", 100, 0.40),
    { marketId: "m1", entryId: "e1", actionType: "buy", shareCount: "NaN", pricePerShare: "0.45", confidence: null },
    { marketId: "m1", entryId: "e1", actionType: "buy", shareCount: "0", pricePerShare: "0.45", confidence: null },
    { marketId: "m1", entryId: "e1", actionType: "buy", shareCount: "-5", pricePerShare: "0.45", confidence: null },
  ]);
  const pos = positions.get("m1|e1")!;
  assert.equal(pos.netShares, 100); // only the legitimate buy counted
  assert.equal(pos.buyShares, 100);
});

test("latestBuyConfidence tracks the most recent buy with a confidence value", () => {
  // Three buys: first has confidence, second is null, third has confidence.
  // Result should be the THIRD buy's confidence (most recent non-null).
  const positions = aggregate([
    buy("m1", "e1", 50, 0.40, 0.55),
    buy("m1", "e1", 50, 0.42, undefined),
    buy("m1", "e1", 50, 0.44, 0.72),
  ]);
  const pos = positions.get("m1|e1")!;
  assert.equal(pos.latestBuyConfidence, 0.72);
});

test("net-zero positions still appear in the map (caller filters)", () => {
  // The aggregator's job is just to add up the rows. The runner
  // filters on `netShares >= MIN_NET_SHARES_FOR_SELL_EVAL`. This
  // separation matters: a future caller (e.g. an admin diagnostic
  // tile) might want to see net-zero positions explicitly.
  const positions = aggregate([
    buy("m1", "e1", 100, 0.40),
    sell("m1", "e1", 100, 0.55),
  ]);
  const pos = positions.get("m1|e1")!;
  assert.equal(pos.netShares, 0);
  assert.equal(pos.buyShares, 100);
});

// ---------------------------------------------------------------------------
// End-to-end: aggregator -> sell engine
// ---------------------------------------------------------------------------

test("aggregator output flows into computeSellDecision and produces a top-breach decision", () => {
  // Build a sharp-band position: 100 shares bought at 0.40 each.
  // Live price has rallied to 0.65 — well past sharp's bandTop
  // (0.40 + (0.10 + 0.4 * 0.10) * 0.85 ~ 0.519). Use a seed that
  // walks the cascade: forget pass + pSell pass + fraction roll.
  const positions = aggregate([buy("m1", "e1", 100, 0.40)]);
  const pos = positions.get("m1|e1")!;
  const anchor = pos.buyCostNotional / pos.buyShares;

  // Loop seeds until we land a non-null decision; assert the reason
  // is take_profit (top-breach) when it does fire.
  let firstDecision = null;
  for (let seed = 1; seed <= 50; seed++) {
    const d = computeSellDecision(
      {
        personaBand: "sharp",
        anchor,
        livePrice: 0.65,
        conviction: 0.6,
        netShares: pos.netShares,
      },
      createPRNG(seed),
    );
    if (d != null) {
      firstDecision = d;
      break;
    }
  }
  assert.ok(firstDecision, "expected at least one non-null sharp top-breach decision in 50 seeds");
  assert.equal(firstDecision!.reason, "take_profit");
  assert.equal(firstDecision!.anchor, 0.40);
  assert.equal(firstDecision!.livePrice, 0.65);
});

test("aggregator output with conviction add-on still uses original-buy weighted anchor", () => {
  // Initial buy + later conviction add-on at higher price. The anchor
  // is correctly diluted upward (weighted across both buys), and the
  // band is centred on the diluted anchor — NOT on the original buy.
  // This is the right behaviour: an agent who doubled down at 0.55
  // shouldn't still treat 0.40 as their cost basis.
  const positions = aggregate([
    buy("m1", "e1", 100, 0.40), // original buy
    buy("m1", "e1", 100, 0.55), // conviction add-on
  ]);
  const pos = positions.get("m1|e1")!;
  const anchor = pos.buyCostNotional / pos.buyShares;
  assert.ok(Math.abs(anchor - 0.475) < 1e-9, `expected weighted anchor 0.475, got ${anchor}`);

  // Live price 0.45 is below the diluted anchor but above the
  // original buy. The engine sees this as a small drift, not a top
  // breach. Inside-band region between bandBottom and bandTop.
  const decision = computeSellDecision(
    {
      personaBand: "sharp",
      anchor,
      livePrice: 0.45,
      conviction: 0.6,
      netShares: pos.netShares,
    },
    createPRNG(1),
  );
  // Either null (most likely: cascade declined inside-band) or
  // early_profit (very rare given lower-half position). It should
  // NEVER be take_profit at this anchor.
  if (decision != null) {
    assert.notEqual(decision.reason, "take_profit");
    assert.notEqual(decision.reason, "cut_loss");
  }
});
