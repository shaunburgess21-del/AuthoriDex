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

const {
  _aggregateSellSweepPositionsForTesting: aggregate,
  _pickLargestPositionsByMarketForTesting: pickLargest,
} = await import("../server/agents/agentRunner");
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

// ---------------------------------------------------------------------------
// Multi-marketType coverage (Commit 2 — sell sweep expansion)
//
// `aggregateSellSweepPositions` is generic: it keys by (marketId,
// entryId) and doesn't care what kind of AMM market the bets live on.
// The runner's earlier UpDown-only filter masked that; with the filter
// loosened to `engine='amm'`, these fixtures lock in the behaviour
// for H2H (2 entries), Race (N entries), and Community-multi (also N
// entries) so any future regression in the math gets caught here
// instead of in production.
// ---------------------------------------------------------------------------

test("H2H: agent buys both sides, sells partial of one — per-entry anchor + netShares correct", () => {
  // H2H market 'h2h1' with entries person1 / person2. Agent buys
  // both sides, then trims person1. The two entries must produce
  // independent positions: person1's anchor is unchanged by the
  // partial sell, person2's position is untouched.
  const positions = aggregate([
    buy("h2h1", "person1", 80, 0.45),
    buy("h2h1", "person2", 60, 0.55),
    sell("h2h1", "person1", 30, 0.60),
  ]);
  assert.equal(positions.size, 2);

  const p1 = positions.get("h2h1|person1")!;
  assert.equal(p1.netShares, 50);
  assert.equal(p1.buyShares, 80);
  assert.ok(Math.abs(p1.buyCostNotional - 36) < 1e-9); // 80 * 0.45
  assert.ok(Math.abs(p1.buyCostNotional / p1.buyShares - 0.45) < 1e-9);

  const p2 = positions.get("h2h1|person2")!;
  assert.equal(p2.netShares, 60);
  assert.equal(p2.buyShares, 60);
  assert.ok(Math.abs(p2.buyCostNotional - 33) < 1e-9); // 60 * 0.55
});

test("Race: agent buys two of four entries — both produce independent sell positions", () => {
  // 4-entry race market 'race1'. Agent backs runner-a and runner-c
  // only. The aggregator returns positions only for entries the
  // agent actually traded — runner-b and runner-d are absent from
  // the map (no bets, no row). Critical so the runner's downstream
  // `for (pos of positions.values())` loop doesn't waste sell-decision
  // calls on entries the agent doesn't hold.
  const positions = aggregate([
    buy("race1", "runner-a", 40, 0.20, 0.55),
    buy("race1", "runner-c", 25, 0.32, 0.60),
  ]);
  assert.equal(positions.size, 2);
  assert.ok(positions.has("race1|runner-a"));
  assert.ok(positions.has("race1|runner-c"));
  assert.ok(!positions.has("race1|runner-b"));
  assert.ok(!positions.has("race1|runner-d"));

  // Each entry should be independently evaluable by the sell engine
  // — the runner now loops over ALL of them. Confirm anchors are the
  // per-entry buy prices, not some cross-entry blend.
  const a = positions.get("race1|runner-a")!;
  assert.equal(a.buyCostNotional / a.buyShares, 0.20);
  assert.equal(a.latestBuyConfidence, 0.55);
  const c = positions.get("race1|runner-c")!;
  assert.equal(c.buyCostNotional / c.buyShares, 0.32);
  assert.equal(c.latestBuyConfidence, 0.60);
});

test("Race: stacking buys + a partial sell on one entry — anchor immune to the sell", () => {
  // Same race, but the agent doubled down on runner-a and later
  // trimmed half. Weighted anchor must average the two BUYS and
  // ignore the sell entirely (matches the rule pinned by the
  // 'sells reduce netShares but DO NOT dilute the anchor' test).
  const positions = aggregate([
    buy("race1", "runner-a", 40, 0.20),
    buy("race1", "runner-a", 60, 0.28),
    sell("race1", "runner-a", 30, 0.35),
  ]);
  const p = positions.get("race1|runner-a")!;
  assert.equal(p.netShares, 70); // 40 + 60 − 30
  assert.equal(p.buyShares, 100); // 40 + 60
  // (40 * 0.20) + (60 * 0.28) = 8 + 16.8 = 24.8
  assert.ok(Math.abs(p.buyCostNotional - 24.8) < 1e-9);
  const anchor = p.buyCostNotional / p.buyShares;
  assert.ok(Math.abs(anchor - 0.248) < 1e-9);
});

test("Community-multi: marketType='community' doesn't break the per-entry math", () => {
  // The aggregator never inspects marketType — it just groups by
  // (marketId, entryId). This test guards against any future
  // refactor that might mistakenly add a marketType-aware branch
  // (e.g. "if community, do something different"). Behaviour must
  // remain identical to the Race case above.
  const positions = aggregate([
    buy("comm1", "candidate-x", 70, 0.18),
    buy("comm1", "candidate-y", 30, 0.42),
    buy("comm1", "candidate-x", 30, 0.22), // double-down on x
    sell("comm1", "candidate-y", 10, 0.50), // trim y
  ]);
  assert.equal(positions.size, 2);

  const x = positions.get("comm1|candidate-x")!;
  assert.equal(x.netShares, 100);
  assert.equal(x.buyShares, 100);
  // (70 * 0.18) + (30 * 0.22) = 12.6 + 6.6 = 19.2 → anchor 0.192
  assert.ok(Math.abs(x.buyCostNotional - 19.2) < 1e-9);

  const y = positions.get("comm1|candidate-y")!;
  assert.equal(y.netShares, 20);
  assert.equal(y.buyShares, 30);
  assert.equal(y.buyCostNotional, 30 * 0.42); // 12.6
});

test("multi-market mix: bets across H2H, Race, and Community-multi grouped independently", () => {
  // Single agent has positions across all three market types in one
  // pull. The aggregator must produce ONE entry per (marketId,
  // entryId) pair regardless of which market it came from. Catches
  // a bug class where cross-market bleed could occur if grouping
  // ever degraded to entryId-only.
  const positions = aggregate([
    buy("h2h1", "person1", 50, 0.45),
    buy("race1", "runner-a", 40, 0.20),
    buy("comm1", "candidate-x", 30, 0.18),
    // Same entryId string ('runner-a') in a DIFFERENT market —
    // must NOT collide with the race position.
    buy("h2h2", "runner-a", 25, 0.50),
  ]);
  assert.equal(positions.size, 4);
  assert.equal(positions.get("h2h1|person1")!.netShares, 50);
  assert.equal(positions.get("race1|runner-a")!.netShares, 40);
  assert.equal(positions.get("comm1|candidate-x")!.netShares, 30);
  assert.equal(positions.get("h2h2|runner-a")!.netShares, 25);
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

// ---------------------------------------------------------------------------
// Largest-position-per-market selection (used by repredict sweep)
// ---------------------------------------------------------------------------

test("pickLargestPositionsByMarket returns the larger side when agent holds both", () => {
  // Agent bought 80 UP early week, then flipped to DOWN via a conviction
  // buy of 200 shares. Their NET position is 200 DOWN (larger) — the
  // repredict sweep must NOT treat them as still "on UP" or it will
  // schedule a wrong-way flip.
  const positions = aggregate([
    buy("m1", "up", 80, 0.45),
    buy("m1", "down", 200, 0.55),
  ]);
  const largest = pickLargest(positions);
  assert.equal(largest.size, 1);
  assert.equal(largest.get("m1")!.entryId, "down");
  assert.equal(largest.get("m1")!.netShares, 200);
});

test("pickLargestPositionsByMarket skips dust positions below the eval floor", () => {
  // A 0.1-share dust position from rounding shouldn't qualify the
  // market for repredict consideration. The threshold matches
  // MIN_NET_SHARES_FOR_SELL_EVAL (currently 0.5).
  const positions = aggregate([
    buy("dust", "up", 0.1, 0.45),
  ]);
  const largest = pickLargest(positions);
  assert.equal(largest.size, 0);
});

test("pickLargestPositionsByMarket handles markets with single-side positions", () => {
  const positions = aggregate([
    buy("m1", "up", 50, 0.45),
    buy("m2", "down", 80, 0.55),
  ]);
  const largest = pickLargest(positions);
  assert.equal(largest.size, 2);
  assert.equal(largest.get("m1")!.entryId, "up");
  assert.equal(largest.get("m2")!.entryId, "down");
});
