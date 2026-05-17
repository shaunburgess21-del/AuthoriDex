/**
 * Phase 10 — agent sizing unit tests.
 *
 * Pure tests against `sizeAmmBudget`. No DB. We build small in-memory
 * `AmmStateSnapshot`s the same way `tests/amm-trades.test.ts` does so
 * the budget we size for matches what `executeBuy` would actually charge.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  type AmmStateSnapshot,
  currentPrices,
  quoteBuy,
} from "../shared/lib/amm/positions";
import { seedB } from "../shared/lib/amm/lmsr";
import {
  DEFAULT_AGENT_EDGE_BAND,
  sizeAmmBudget,
} from "../server/agents/sizing";

function makeState(entryIds: string[], targetMaxLoss = 5000): AmmStateSnapshot {
  const liquidityB = seedB(entryIds.length, targetMaxLoss);
  const shareQuantities: Record<string, number> = {};
  for (const id of entryIds) shareQuantities[id] = 0;
  return { liquidityB, outcomeOrder: entryIds.slice(), shareQuantities };
}

// ---------------------------------------------------------------------------
// No-edge guard
// ---------------------------------------------------------------------------

test("sizeAmmBudget returns 0 with reason 'no_edge' when confidence <= currentPrice", () => {
  const state = makeState(["a", "b"]);
  // Fresh binary market: current price = 0.5 for both. Confidence 0.5
  // is also no-edge (within EDGE_EPSILON).
  for (const conf of [0.3, 0.49, 0.5]) {
    const r = sizeAmmBudget({ state, entryId: "a", confidence: conf, maxBudget: 300 });
    assert.equal(r.creditBudget, 0, `conf=${conf}`);
    assert.equal(r.abstainReason, "no_edge");
  }
});

test("sizeAmmBudget returns 0 with reason 'invalid_confidence' for NaN/<0/>1", () => {
  const state = makeState(["a", "b"]);
  for (const conf of [Number.NaN, -0.1, 1.1, Number.POSITIVE_INFINITY]) {
    const r = sizeAmmBudget({ state, entryId: "a", confidence: conf, maxBudget: 300 });
    assert.equal(r.creditBudget, 0);
    assert.equal(r.abstainReason, "invalid_confidence");
  }
});

test("sizeAmmBudget returns 0 with reason 'below_min_budget' when maxBudget<minBudget", () => {
  const state = makeState(["a", "b"]);
  const r = sizeAmmBudget({ state, entryId: "a", confidence: 0.8, maxBudget: 1, minBudget: 5 });
  assert.equal(r.creditBudget, 0);
  assert.equal(r.abstainReason, "below_min_budget");
});

// ---------------------------------------------------------------------------
// Sized output never overshoots the target price
// ---------------------------------------------------------------------------

test("sizeAmmBudget output keeps post-trade price <= targetPrice (binary market)", () => {
  const state = makeState(["a", "b"]);
  const r = sizeAmmBudget({
    state,
    entryId: "a",
    confidence: 0.7,
    maxBudget: 300,
    edgeBand: DEFAULT_AGENT_EDGE_BAND,
  });
  assert.ok(r.creditBudget >= 5, `expected viable bet, got ${r.creditBudget}`);
  assert.equal(r.abstainReason, undefined);

  const q = quoteBuy(state, "a", r.creditBudget);
  const newPrice = q.newPrices.a ?? 0;
  // edgeBand caps at currentPrice (0.5) + 0.10 = 0.60
  assert.ok(newPrice <= 0.6 + 1e-9, `newPrice=${newPrice} overshot target 0.60`);
});

test("sizeAmmBudget honours custom edgeBand", () => {
  const state = makeState(["a", "b"]);
  const r = sizeAmmBudget({
    state,
    entryId: "a",
    confidence: 0.95,
    maxBudget: 1000,
    edgeBand: 0.05,
  });
  assert.ok(r.creditBudget > 0);
  const q = quoteBuy(state, "a", r.creditBudget);
  const newPrice = q.newPrices.a ?? 0;
  // edgeBand=0.05 caps at 0.5 + 0.05 = 0.55
  assert.ok(newPrice <= 0.55 + 1e-9, `newPrice=${newPrice} > 0.55`);
});

// ---------------------------------------------------------------------------
// Confidence-limited path: full budget when target is far above max move
// ---------------------------------------------------------------------------

test("sizeAmmBudget returns full maxBudget when confidence is reachable with budget", () => {
  // Tiny budget on a deep market: even spending all of it won't push price
  // anywhere near targetPrice. Sizer should hand back the full budget.
  const state = makeState(["a", "b"], 50_000);
  const r = sizeAmmBudget({
    state,
    entryId: "a",
    confidence: 0.9,
    maxBudget: 5,
  });
  assert.equal(r.creditBudget, 5);
});

// ---------------------------------------------------------------------------
// Monotonicity: more confidence (above current price) => more credits
// ---------------------------------------------------------------------------

test("sizeAmmBudget is monotonic non-decreasing in (confidence - currentPrice)", () => {
  const state = makeState(["a", "b"]);
  const c1 = sizeAmmBudget({ state, entryId: "a", confidence: 0.55, maxBudget: 300 });
  const c2 = sizeAmmBudget({ state, entryId: "a", confidence: 0.7, maxBudget: 300 });
  const c3 = sizeAmmBudget({ state, entryId: "a", confidence: 0.95, maxBudget: 300 });
  assert.ok(c1.creditBudget <= c2.creditBudget, `${c1.creditBudget} > ${c2.creditBudget}`);
  assert.ok(c2.creditBudget <= c3.creditBudget, `${c2.creditBudget} > ${c3.creditBudget}`);
});

// ---------------------------------------------------------------------------
// Cap respect
// ---------------------------------------------------------------------------

test("sizeAmmBudget never exceeds maxBudget", () => {
  const state = makeState(["a", "b"]);
  for (const max of [10, 50, 100, 250, 300]) {
    const r = sizeAmmBudget({ state, entryId: "a", confidence: 0.99, maxBudget: max });
    assert.ok(r.creditBudget <= max, `creditBudget=${r.creditBudget} > maxBudget=${max}`);
  }
});

// ---------------------------------------------------------------------------
// Multi-outcome markets — same path, just N>2
// ---------------------------------------------------------------------------

test("sizeAmmBudget works on a 3-way market", () => {
  const state = makeState(["a", "b", "c"]);
  // Fresh: price 1/3 each. Confidence 0.6 has clear edge.
  const r = sizeAmmBudget({ state, entryId: "a", confidence: 0.6, maxBudget: 300 });
  assert.ok(r.creditBudget > 0);
  const q = quoteBuy(state, "a", r.creditBudget);
  const newPrice = q.newPrices.a ?? 0;
  // currentPrice ~= 0.333, edgeBand=0.10 → cap ~= 0.433
  assert.ok(newPrice <= 0.433 + 1e-9, `newPrice=${newPrice}`);
});

// ---------------------------------------------------------------------------
// Sanity: currentPrice in result mirrors actual state
// ---------------------------------------------------------------------------

test("sizeAmmBudget reports the observed currentPrice", () => {
  const state = makeState(["a", "b"]);
  const observed = currentPrices(state).a ?? 0;
  const r = sizeAmmBudget({ state, entryId: "a", confidence: 0.7, maxBudget: 300 });
  assert.equal(r.currentPrice, observed);
});

// ---------------------------------------------------------------------------
// Mid-game state — pre-loaded q vector
// ---------------------------------------------------------------------------

test("sizeAmmBudget on a market that already has shares respects existing price", () => {
  // Pre-load 100 shares on entry A so its current price is well above 0.5.
  const state = makeState(["a", "b"]);
  state.shareQuantities.a = 100;
  const cur = currentPrices(state).a ?? 0;
  assert.ok(cur > 0.5, `expected price >0.5 for loaded entry, got ${cur}`);

  // Confidence still well above current price → should size.
  const r = sizeAmmBudget({ state, entryId: "a", confidence: 0.95, maxBudget: 300 });
  assert.ok(r.creditBudget > 0);

  // The post-trade price must respect the edgeBand cap measured from the
  // EXISTING price, not from 0.5. With edgeBand=0.10 this means
  // newPrice <= cur + 0.10.
  const q = quoteBuy(state, "a", r.creditBudget);
  const newPrice = q.newPrices.a ?? 0;
  assert.ok(
    newPrice <= cur + 0.10 + 1e-9,
    `mid-game newPrice=${newPrice} overshot cur(${cur}) + edgeBand(0.10)`,
  );
});

test("sizeAmmBudget abstains when confidence is below an already-elevated price", () => {
  const state = makeState(["a", "b"]);
  state.shareQuantities.a = 200;
  const cur = currentPrices(state).a ?? 0;
  const r = sizeAmmBudget({
    state,
    entryId: "a",
    confidence: cur - 0.05,
    maxBudget: 300,
  });
  assert.equal(r.creditBudget, 0);
  assert.equal(r.abstainReason, "no_edge");
});

// ---------------------------------------------------------------------------
// Realised charge from executeBuy quote matches what the sizer promised
// ---------------------------------------------------------------------------

test("sizeAmmBudget output: chargeCredits never exceeds the sized budget", () => {
  const state = makeState(["a", "b", "c"]);
  for (const conf of [0.45, 0.6, 0.75, 0.9]) {
    const r = sizeAmmBudget({ state, entryId: "a", confidence: conf, maxBudget: 300 });
    if (r.creditBudget === 0) continue;
    const q = quoteBuy(state, "a", r.creditBudget);
    assert.ok(
      q.chargeCredits <= r.creditBudget,
      `chargeCredits=${q.chargeCredits} > sized=${r.creditBudget} (conf=${conf})`,
    );
  }
});

// ---------------------------------------------------------------------------
// Boundary: maxBudget exactly at MIN_AMM_BUY_CREDITS
// ---------------------------------------------------------------------------

test("sizeAmmBudget allows trades at exactly minBudget when there's edge", () => {
  const state = makeState(["a", "b"], 50_000);
  const r = sizeAmmBudget({ state, entryId: "a", confidence: 0.99, maxBudget: 5, minBudget: 5 });
  // Deep market + high confidence + tiny budget → should hand back the 5.
  assert.equal(r.creditBudget, 5);
});

test("sizeAmmBudget rejects fractional maxBudget defensively", () => {
  const state = makeState(["a", "b"]);
  const r = sizeAmmBudget({
    state,
    entryId: "a",
    confidence: 0.8,
    // Caller bug: forgot to round. Sizer should refuse rather than throw
    // or pass it through to executeBuy (which would also reject).
    maxBudget: 200.5 as unknown as number,
  });
  assert.equal(r.creditBudget, 0);
  assert.equal(r.abstainReason, "below_min_budget");
});

// ---------------------------------------------------------------------------
// Agent v2 — conviction-aware edge band
// ---------------------------------------------------------------------------
//
// `conviction` widens `DEFAULT_AGENT_EDGE_BAND` (0.10) toward
// `MAX_AGENT_EDGE_BAND` (0.20) when the LLM ranker is confident in its
// pick. These tests cover the four edges of that contract:
//   1. conviction <= 0.5 keeps the default band.
//   2. conviction = 1.0 hits the max band exactly.
//   3. midpoint conviction (0.75) lands halfway.
//   4. explicit `edgeBand` override still wins over conviction.

import {
  MAX_AGENT_EDGE_BAND,
  _resolveEdgeBandForTesting as resolveEdgeBand,
} from "../server/agents/sizing";

test("conviction <= 0.5 keeps the default edge band", () => {
  for (const c of [undefined, 0, 0.3, 0.5]) {
    assert.equal(
      resolveEdgeBand(undefined, c as number | undefined),
      DEFAULT_AGENT_EDGE_BAND,
      `conviction=${c}`,
    );
  }
});

test("conviction = 1.0 lands at MAX_AGENT_EDGE_BAND exactly", () => {
  assert.equal(resolveEdgeBand(undefined, 1.0), MAX_AGENT_EDGE_BAND);
});

test("conviction = 0.75 lands at the midpoint between default and max", () => {
  const expected = (DEFAULT_AGENT_EDGE_BAND + MAX_AGENT_EDGE_BAND) / 2;
  assert.ok(
    Math.abs(resolveEdgeBand(undefined, 0.75) - expected) < 1e-9,
    `expected ${expected}, got ${resolveEdgeBand(undefined, 0.75)}`,
  );
});

test("conviction beyond 1.0 still caps at MAX_AGENT_EDGE_BAND", () => {
  // Defensive: shouldn't happen post-clamp, but if a caller bypasses the
  // parser we still bound the band. Rules should be belt-and-suspenders.
  assert.equal(resolveEdgeBand(undefined, 1.5), MAX_AGENT_EDGE_BAND);
});

test("explicit edgeBand override wins over conviction", () => {
  // Test override takes precedence even with high conviction.
  assert.equal(resolveEdgeBand(0.05, 1.0), 0.05);
});

test("non-finite conviction is ignored, falls back to default", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(resolveEdgeBand(undefined, bad), DEFAULT_AGENT_EDGE_BAND);
  }
});

test("sizeAmmBudget uses widened band when high conviction is passed", () => {
  // Same setup as the mid-game test above, but with high conviction.
  // Expect newPrice to be allowed to overshoot the default 0.10 cap.
  const state = makeState(["a", "b"]);
  state.shareQuantities.a = 100;
  const cur = currentPrices(state).a ?? 0;

  const tight = sizeAmmBudget({
    state,
    entryId: "a",
    confidence: 0.95,
    maxBudget: 1000,
  });
  const wide = sizeAmmBudget({
    state,
    entryId: "a",
    confidence: 0.95,
    maxBudget: 1000,
    conviction: 1.0, // -> band 0.20
  });

  // The wide-band sizer should authorise at least as much credit as the
  // tight-band one (often more, when confidence allows).
  assert.ok(
    wide.creditBudget >= tight.creditBudget,
    `wide(${wide.creditBudget}) should be >= tight(${tight.creditBudget})`,
  );
  // And the post-trade price stays at or below cur + 0.20.
  if (wide.creditBudget > 0) {
    const q = quoteBuy(state, "a", wide.creditBudget);
    const newPrice = q.newPrices.a ?? 0;
    assert.ok(
      newPrice <= cur + MAX_AGENT_EDGE_BAND + 1e-9,
      `wide-band newPrice=${newPrice} overshot cur(${cur}) + max(${MAX_AGENT_EDGE_BAND})`,
    );
  }
});
