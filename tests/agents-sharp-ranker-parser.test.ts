/**
 * Unit tests for the Sharp Ranker response parser.
 *
 * The parser is the trust boundary between an LLM (which can return any
 * JSON, well-formed or not) and the deterministic sizing curve. These
 * tests pin the contract so a future prompt tweak that changes how the
 * model formats picks won't silently let bad numbers through:
 *
 *   - Numeric fields clamp to [0, 1].
 *   - `currentPrice` and `edge` are recomputed server-side from the
 *     known stake split — never trusted from the LLM.
 *   - Picks below `SHARP_RANKER_MIN_EDGE` (0.03) are dropped.
 *   - Picks whose `side` doesn't resolve to a real entry are dropped.
 *   - Direction labels are normalised to UP/DOWN/FLAT.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  _parseRankerResponseForTesting as parseRankerResponse,
  type _RankableMarketForTesting as RankableMarket,
} from "../server/agents/sharpRanker";
import type { MarketWithEntries } from "../server/agents/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBinaryMarket(): MarketWithEntries {
  return {
    id: "m-1",
    marketType: "updown",
    status: "OPEN",
    title: "Will X happen this week?",
    category: "politics",
    personId: "p-1",
    endAt: new Date(Date.now() + 86400_000),
    // 60% of the binary pool on Up = crowdPrice 0.6 for Up, 0.4 for Down.
    entries: [
      { id: "e-up", label: "Up", totalStake: 600, noStake: 400, personId: "p-1" },
      { id: "e-down", label: "Down", totalStake: 400, noStake: 600, personId: "p-1" },
    ],
  };
}

function makeRaceMarket(): MarketWithEntries {
  return {
    id: "m-race",
    marketType: "gainer",
    status: "OPEN",
    title: "Top mover this week",
    category: "music",
    personId: null,
    endAt: new Date(Date.now() + 86400_000),
    // Race pool: A=500, B=300, C=200 → crowdPrice 0.5/0.3/0.2.
    entries: [
      { id: "e-a", label: "Alice", totalStake: 500, personId: "p-a" },
      { id: "e-b", label: "Bob", totalStake: 300, personId: "p-b" },
      { id: "e-c", label: "Cara", totalStake: 200, personId: "p-c" },
    ],
  };
}

function rankable(market: MarketWithEntries): RankableMarket {
  return { market, signals: null };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("happy path: clamps edgeProb/conviction, recomputes edge from stakes", () => {
  const m = makeBinaryMarket();
  const raw = JSON.stringify({
    picks: [
      {
        marketId: "m-1",
        side: "Up",
        edgeProb: 0.75, // LLM's view
        conviction: 0.82,
        direction: "UP",
        edge: 999, // LLM's number — must be IGNORED, server recomputes
        currentPrice: 999, // same: must be ignored
        reasoning: "Fame momentum and breakout signal both strongly up",
      },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  assert.equal(out.length, 1);
  const [pick] = out;
  assert.equal(pick.marketId, "m-1");
  assert.equal(pick.side, "Up");
  assert.equal(pick.edgeProb, 0.75);
  assert.equal(pick.conviction, 0.82);
  // crowdPrice = 600/(600+400) = 0.6, so edge = 0.75 - 0.6 = 0.15 (server-truth)
  assert.equal(pick.currentPrice, 0.6);
  assert.ok(Math.abs(pick.edge - 0.15) < 1e-9, `edge=${pick.edge}`);
  assert.equal(pick.direction, "UP");
});

// ---------------------------------------------------------------------------
// Numeric clamping
// ---------------------------------------------------------------------------

test("clamps edgeProb above 1 and below 0", () => {
  const m = makeBinaryMarket();
  const raw = JSON.stringify({
    picks: [
      { marketId: "m-1", side: "Up", edgeProb: 1.5, conviction: 0.7, direction: "UP", reasoning: "" },
      { marketId: "m-1", side: "Down", edgeProb: -0.3, conviction: 0.7, direction: "DOWN", reasoning: "" },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  assert.equal(out.length, 2);
  assert.equal(out[0].edgeProb, 1);
  assert.equal(out[1].edgeProb, 0);
});

test("non-numeric edgeProb falls back to 0.5 (then dropped if no edge)", () => {
  const m = makeBinaryMarket(); // crowdPrice for Up = 0.6
  const raw = JSON.stringify({
    picks: [
      { marketId: "m-1", side: "Up", edgeProb: "not a number", conviction: 0.7, direction: "UP", reasoning: "" },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  // edgeProb fallback 0.5, currentPrice 0.6, edge = -0.10 → |edge|=0.10 > 0.03 → kept as DOWN-leaning bet on Up entry
  assert.equal(out.length, 1);
  assert.equal(out[0].edgeProb, 0.5);
  assert.ok(Math.abs(out[0].edge - -0.10) < 1e-9);
});

// ---------------------------------------------------------------------------
// Edge gating (SHARP_RANKER_MIN_EDGE = 0.03)
// ---------------------------------------------------------------------------

test("drops picks where |edge| < 0.03 (LLM agreed with crowd)", () => {
  const m = makeBinaryMarket(); // Up crowdPrice = 0.6
  const raw = JSON.stringify({
    picks: [
      // edgeProb 0.61 vs crowd 0.60 → edge 0.01, below threshold
      { marketId: "m-1", side: "Up", edgeProb: 0.61, conviction: 0.7, direction: "UP", reasoning: "" },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  assert.equal(out.length, 0);
});

test("keeps picks at the boundary where |edge| == 0.03 only when strict (>=)", () => {
  // We use < 0.03 to drop (strict), so |edge| == 0.03 is KEPT. Pin this.
  const m = makeBinaryMarket(); // crowdPrice = 0.6
  const raw = JSON.stringify({
    picks: [
      { marketId: "m-1", side: "Up", edgeProb: 0.63, conviction: 0.7, direction: "UP", reasoning: "" },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  assert.equal(out.length, 1);
});

// ---------------------------------------------------------------------------
// Side resolution
// ---------------------------------------------------------------------------

test("drops picks whose side doesn't match any entry label", () => {
  const m = makeBinaryMarket();
  const raw = JSON.stringify({
    picks: [
      { marketId: "m-1", side: "Sideways", edgeProb: 0.8, conviction: 0.7, direction: "UP", reasoning: "" },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  assert.equal(out.length, 0);
});

test("side match is case-insensitive", () => {
  const m = makeBinaryMarket();
  const raw = JSON.stringify({
    picks: [
      { marketId: "m-1", side: "UP", edgeProb: 0.8, conviction: 0.7, direction: "UP", reasoning: "" },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  assert.equal(out.length, 1);
  // Canonical entry label is preserved on the pick
  assert.equal(out[0].side, "Up");
});

// ---------------------------------------------------------------------------
// Direction normalisation
// ---------------------------------------------------------------------------

test("direction defaults to FLAT when missing or unrecognised", () => {
  const m = makeBinaryMarket();
  const raw = JSON.stringify({
    picks: [
      { marketId: "m-1", side: "Up", edgeProb: 0.8, conviction: 0.7, reasoning: "" }, // no direction
      { marketId: "m-1", side: "Down", edgeProb: 0.7, conviction: 0.7, direction: "sideways", reasoning: "" },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  assert.equal(out.length, 2);
  for (const p of out) assert.equal(p.direction, "FLAT");
});

// ---------------------------------------------------------------------------
// Race-style markets
// ---------------------------------------------------------------------------

test("race markets compute crowdPrice as entry share of total pool", () => {
  const m = makeRaceMarket(); // A=0.5, B=0.3, C=0.2
  const raw = JSON.stringify({
    picks: [
      { marketId: "m-race", side: "Cara", edgeProb: 0.4, conviction: 0.8, direction: "UP", reasoning: "" },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  assert.equal(out.length, 1);
  // Cara crowdPrice = 200/1000 = 0.2 → edge = 0.4 - 0.2 = 0.2
  assert.equal(out[0].currentPrice, 0.2);
  assert.ok(Math.abs(out[0].edge - 0.20) < 1e-9);
});

// ---------------------------------------------------------------------------
// Malformed responses
// ---------------------------------------------------------------------------

test("returns [] on non-JSON garbage", () => {
  const m = makeBinaryMarket();
  const out = parseRankerResponse("not even json", [rankable(m)]);
  assert.deepEqual(out, []);
});

test("returns [] when picks isn't an array", () => {
  const m = makeBinaryMarket();
  const out = parseRankerResponse(JSON.stringify({ picks: "nope" }), [rankable(m)]);
  assert.deepEqual(out, []);
});

test("drops picks for unknown marketIds, keeps the good ones", () => {
  const m = makeBinaryMarket();
  const raw = JSON.stringify({
    picks: [
      { marketId: "ghost-market", side: "Up", edgeProb: 0.9, conviction: 0.9, direction: "UP", reasoning: "" },
      { marketId: "m-1", side: "Up", edgeProb: 0.8, conviction: 0.7, direction: "UP", reasoning: "" },
    ],
  });
  const out = parseRankerResponse(raw, [rankable(m)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].marketId, "m-1");
});
