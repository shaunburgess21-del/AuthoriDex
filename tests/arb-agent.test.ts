import test from "node:test";
import assert from "node:assert/strict";

import {
  computeArbPrediction,
  computeArbPredictionH2H,
  computeArbPredictionGainer,
  pickArbAgentIndexFromLocks,
} from "../server/agents/arbAgent";
import type { MarketWithEntries, TrendSignals } from "../server/agents/types";

const entries = [
  { id: "up", label: "Up", totalStake: 0, noStake: 0, personId: "p1" },
  { id: "down", label: "Down", totalStake: 0, noStake: 0, personId: "p1" },
];

const market: MarketWithEntries = {
  id: "m1",
  marketType: "updown",
  status: "OPEN",
  title: "Test",
  category: null,
  personId: "p1",
  endAt: new Date("2026-06-07T23:59:59.999Z"),
  createdAt: new Date(),
  entries,
};

test("computeArbPrediction abstains when edge below threshold", () => {
  const signals: TrendSignals = {
    trendScore: 500_000,
    fameIndex: 500_000,
    scoreBaseline: 400_000,
    scoreDelta7d: 50_000,
    change24h: 5,
    momentum: "Breakout",
    trendDirection: "UP",
    pctChangeVsOpen: 0.15,
  };
  const decision = computeArbPrediction(market, signals, 24, {
    up: 0.9,
    down: 0.1,
  });
  assert.equal(decision.abstain, true);
});

test("computeArbPrediction buys UP when underpriced vs fair", () => {
  const signals: TrendSignals = {
    trendScore: 500_000,
    fameIndex: 500_000,
    scoreBaseline: 400_000,
    scoreDelta7d: 50_000,
    change24h: 5,
    momentum: "Breakout",
    trendDirection: "UP",
    pctChangeVsOpen: 0.15,
  };
  const decision = computeArbPrediction(market, signals, 12, {
    up: 0.55,
    down: 0.45,
  });
  assert.equal(decision.abstain, false);
  assert.equal(decision.entryId, "up");
  assert.ok((decision.confidence ?? 0) > 0.7);
});

test("computeArbPrediction legacy path cannot correct an overpriced favorite", () => {
  const signals: TrendSignals = {
    trendScore: 500_000,
    fameIndex: 500_000,
    scoreBaseline: 400_000,
    scoreDelta7d: 50_000,
    change24h: 5,
    momentum: "Breakout",
    trendDirection: "UP",
    pctChangeVsOpen: 0.15,
  };
  // Favored (Up) is overpriced vs fair — legacy favored-side-only abstains.
  const decision = computeArbPrediction(market, signals, 48, {
    up: 0.99,
    down: 0.01,
  });
  assert.equal(decision.abstain, true);
});

test("computeArbPrediction allowUnfavoredSide buys the cheap side of an overpriced favorite", () => {
  const signals: TrendSignals = {
    trendScore: 500_000,
    fameIndex: 500_000,
    scoreBaseline: 400_000,
    scoreDelta7d: 50_000,
    change24h: 5,
    momentum: "Steady",
    trendDirection: "UP",
    pctChangeVsOpen: 0.059,
  };
  // Score +5.9% → fair Up ≈ 0.66 at 48h, but Up priced 0.99. Convergence
  // trade is buying Down at 0.01 (fair ≈ 0.34, edge ≈ 0.33).
  const decision = computeArbPrediction(
    market,
    signals,
    48,
    { up: 0.99, down: 0.01 },
    { minEdgePp: 0.12, allowUnfavoredSide: true, decisivePct: 0.02 },
  );
  assert.equal(decision.abstain, false);
  assert.equal(decision.entryId, "down");
  assert.ok((decision.confidence ?? 0) < 0.5);
});

test("computeArbPrediction decisivePct override trades mispriced near-flat markets", () => {
  const signals: TrendSignals = {
    trendScore: 500_000,
    fameIndex: 500_000,
    scoreBaseline: 490_000,
    scoreDelta7d: 10_000,
    change24h: 1,
    momentum: "Steady",
    trendDirection: "UP",
    pctChangeVsOpen: 0.032,
  };
  const prices = { up: 0.31, down: 0.69 };

  // Legacy gate (10%) blocks the +3.2% market entirely.
  const legacy = computeArbPrediction(market, signals, 48, prices, {
    minEdgePp: 0.12,
  });
  assert.equal(legacy.abstain, true);

  // Midweek options: fair Up ≈ 0.59 vs price 0.31 → edge ≈ 0.28, trades Up.
  const midweek = computeArbPrediction(market, signals, 48, prices, {
    minEdgePp: 0.12,
    allowUnfavoredSide: true,
    decisivePct: 0.02,
  });
  assert.equal(midweek.abstain, false);
  assert.equal(midweek.entryId, "up");
});

test("computeArbPrediction allowUnfavoredSide still enforces the edge bar", () => {
  const signals: TrendSignals = {
    trendScore: 500_000,
    fameIndex: 500_000,
    scoreBaseline: 400_000,
    scoreDelta7d: 50_000,
    change24h: 5,
    momentum: "Steady",
    trendDirection: "UP",
    pctChangeVsOpen: 0.059,
  };
  // Fairly priced both sides (fair Up ≈ 0.66) — no side clears 0.12 edge.
  const decision = computeArbPrediction(
    market,
    signals,
    48,
    { up: 0.65, down: 0.35 },
    { minEdgePp: 0.12, allowUnfavoredSide: true, decisivePct: 0.02 },
  );
  assert.equal(decision.abstain, true);
});

test("computeArbPredictionH2H abstains when flag off", () => {
  const prev = process.env.LOCKIN_FAIR_H2H_ENABLED;
  process.env.LOCKIN_FAIR_H2H_ENABLED = "false";
  try {
    const h2hEntries = [
      { id: "a", label: "Alice", totalStake: 0, noStake: 0, personId: "p1" },
      { id: "b", label: "Bob", totalStake: 0, noStake: 0, personId: "p2" },
    ];
    const d = computeArbPredictionH2H(
      h2hEntries,
      { a: 800_000, b: 500_000 },
      12,
      { a: 0.52, b: 0.48 },
    );
    assert.equal(d.abstain, true);
  } finally {
    if (prev === undefined) delete process.env.LOCKIN_FAIR_H2H_ENABLED;
    else process.env.LOCKIN_FAIR_H2H_ENABLED = prev;
  }
});

test("computeArbPredictionH2H buys leader when underpriced", () => {
  const prev = process.env.LOCKIN_FAIR_H2H_ENABLED;
  process.env.LOCKIN_FAIR_H2H_ENABLED = "true";
  try {
    const h2hEntries = [
      { id: "a", label: "Alice", totalStake: 0, noStake: 0, personId: "p1" },
      { id: "b", label: "Bob", totalStake: 0, noStake: 0, personId: "p2" },
    ];
    const d = computeArbPredictionH2H(
      h2hEntries,
      { a: 800_000, b: 500_000 },
      12,
      { a: 0.52, b: 0.48 },
    );
    assert.equal(d.abstain, false);
    assert.equal(d.entryId, "a");
    assert.ok((d.confidence ?? 0) > 0.6);
  } finally {
    if (prev === undefined) delete process.env.LOCKIN_FAIR_H2H_ENABLED;
    else process.env.LOCKIN_FAIR_H2H_ENABLED = prev;
  }
});

test("computeArbPredictionGainer abstains when flag off", () => {
  const prev = process.env.LOCKIN_FAIR_GAINER_ENABLED;
  process.env.LOCKIN_FAIR_GAINER_ENABLED = "false";
  try {
    const gainerEntries = [
      { id: "a", label: "Alice", totalStake: 0, noStake: 0, personId: "p1" },
      { id: "b", label: "Bob", totalStake: 0, noStake: 0, personId: "p2" },
      { id: "c", label: "Carol", totalStake: 0, noStake: 0, personId: "p3" },
    ];
    const d = computeArbPredictionGainer(
      gainerEntries,
      { a: 0.05, b: 0.25, c: 0.02 },
      12,
      { a: 0.1, b: 0.12, c: 0.1 },
    );
    assert.equal(d.abstain, true);
  } finally {
    if (prev === undefined) delete process.env.LOCKIN_FAIR_GAINER_ENABLED;
    else process.env.LOCKIN_FAIR_GAINER_ENABLED = prev;
  }
});

test("computeArbPredictionGainer buys leader when underpriced", () => {
  const prev = process.env.LOCKIN_FAIR_GAINER_ENABLED;
  process.env.LOCKIN_FAIR_GAINER_ENABLED = "true";
  try {
    const gainerEntries = [
      { id: "a", label: "Alice", totalStake: 0, noStake: 0, personId: "p1" },
      { id: "b", label: "Bob", totalStake: 0, noStake: 0, personId: "p2" },
      { id: "c", label: "Carol", totalStake: 0, noStake: 0, personId: "p3" },
    ];
    const d = computeArbPredictionGainer(
      gainerEntries,
      { a: 0.05, b: 0.25, c: 0.02 },
      12,
      { a: 0.08, b: 0.12, c: 0.08 },
    );
    assert.equal(d.abstain, false);
    assert.equal(d.entryId, "b");
    assert.ok((d.confidence ?? 0) > 0.35);
  } finally {
    if (prev === undefined) delete process.env.LOCKIN_FAIR_GAINER_ENABLED;
    else process.env.LOCKIN_FAIR_GAINER_ENABLED = prev;
  }
});

test("computeArbPredictionGainer minEdgePp override enforces midweek bar", () => {
  const prev = process.env.LOCKIN_FAIR_GAINER_ENABLED;
  process.env.LOCKIN_FAIR_GAINER_ENABLED = "true";
  try {
    const gainerEntries = [
      { id: "a", label: "Alice", totalStake: 0, noStake: 0, personId: "p1" },
      { id: "b", label: "Bob", totalStake: 0, noStake: 0, personId: "p2" },
      { id: "c", label: "Carol", totalStake: 0, noStake: 0, personId: "p3" },
    ];
    // Same inputs as the "buys leader" test (gap clears the 4pp default bar).
    // Raising the bar to 0.95 makes the gap fail — verifies minEdgePp is honored.
    const d = computeArbPredictionGainer(
      gainerEntries,
      { a: 0.05, b: 0.25, c: 0.02 },
      12,
      { a: 0.08, b: 0.12, c: 0.08 },
      { minEdgePp: 0.95 },
    );
    assert.equal(d.abstain, true);
  } finally {
    if (prev === undefined) delete process.env.LOCKIN_FAIR_GAINER_ENABLED;
    else process.env.LOCKIN_FAIR_GAINER_ENABLED = prev;
  }
});

test("computeArbPredictionGainer allowUnfavoredSide buys the most underpriced entry", () => {
  const prev = process.env.LOCKIN_FAIR_GAINER_ENABLED;
  process.env.LOCKIN_FAIR_GAINER_ENABLED = "true";
  try {
    // 5-entry race. Adin Ross is the overpriced early pick (price 0.88,
    // fair ~0.05). Kai is +30% (fair ~0.50) but priced 0.03 — huge edge.
    // Favored-side-only path would still pick Kai here (highest fair),
    // but the test confirms allowUnfavoredSide scans all entries and
    // picks the max-edge one.
    const entries = [
      { id: "adin", label: "Adin Ross", totalStake: 0, noStake: 0, personId: "p1" },
      { id: "kai", label: "Kai Cenat", totalStake: 0, noStake: 0, personId: "p2" },
      { id: "x", label: "X", totalStake: 0, noStake: 0, personId: "p3" },
      { id: "y", label: "Y", totalStake: 0, noStake: 0, personId: "p4" },
      { id: "z", label: "Z", totalStake: 0, noStake: 0, personId: "p5" },
    ];
    const d = computeArbPredictionGainer(
      entries,
      { adin: -0.26, kai: 0.30, x: 0.0, y: 0.0, z: 0.0 },
      96,
      { adin: 0.88, kai: 0.03, x: 0.03, y: 0.03, z: 0.03 },
      { minEdgePp: 0.15, allowUnfavoredSide: true },
    );
    assert.equal(d.abstain, false);
    assert.equal(d.entryId, "kai");
  } finally {
    if (prev === undefined) delete process.env.LOCKIN_FAIR_GAINER_ENABLED;
    else process.env.LOCKIN_FAIR_GAINER_ENABLED = prev;
  }
});

// ---------------------------------------------------------------------------
// pickArbAgentIndexFromLocks — near-close convergence lock candidate walk
// (ARB_NEARCLOSE_DAILY_LOCK_ENABLED). Map semantics: absent = no actions on
// the market, false = has actions but none today, true = has an action today.
// ---------------------------------------------------------------------------

const cohort = ["a1", "a2", "a3", "a4"];

test("lock walk: empty cohort returns null", () => {
  const pick = pickArbAgentIndexFromLocks([], 0, new Map(), true);
  assert.deepEqual(pick, { index: null, wouldUnlock: false });
});

test("lock walk (lifetime scope): unlocked primary is picked", () => {
  const pick = pickArbAgentIndexFromLocks(cohort, 1, new Map(), false);
  assert.deepEqual(pick, { index: 1, wouldUnlock: false });
});

test("lock walk (lifetime scope): stale lock blocks but reports wouldUnlock", () => {
  const locks = new Map([["a1", false]]);
  const pick = pickArbAgentIndexFromLocks(cohort, 0, locks, false);
  assert.deepEqual(pick, { index: null, wouldUnlock: true });
});

test("lock walk (lifetime scope): today's lock blocks without wouldUnlock", () => {
  const locks = new Map([["a1", true]]);
  const pick = pickArbAgentIndexFromLocks(cohort, 0, locks, false);
  assert.deepEqual(pick, { index: null, wouldUnlock: false });
});

test("lock walk (lifetime scope): never falls through to other agents", () => {
  // a1 blocked, a2 free — legacy scope must still block, not pick a2.
  const locks = new Map([["a1", true]]);
  const pick = pickArbAgentIndexFromLocks(cohort, 0, locks, false);
  assert.equal(pick.index, null);
});

test("lock walk (day scope): stale lock no longer blocks the primary", () => {
  const locks = new Map([["a1", false]]);
  const pick = pickArbAgentIndexFromLocks(cohort, 0, locks, true);
  assert.deepEqual(pick, { index: 0, wouldUnlock: false });
});

test("lock walk (day scope): falls through past agents locked today", () => {
  const locks = new Map([
    ["a1", true],
    ["a2", true],
  ]);
  const pick = pickArbAgentIndexFromLocks(cohort, 0, locks, true);
  assert.deepEqual(pick, { index: 2, wouldUnlock: false });
});

test("lock walk (day scope): whole cohort locked today returns null", () => {
  const locks = new Map(cohort.map((id) => [id, true] as const));
  const pick = pickArbAgentIndexFromLocks(cohort, 2, locks, true);
  assert.deepEqual(pick, { index: null, wouldUnlock: false });
});

test("lock walk (day scope): startIdx wraps around the cohort", () => {
  const locks = new Map([["a4", true]]);
  // startIdx 3 → a4 locked today → wraps to a1.
  const pick = pickArbAgentIndexFromLocks(cohort, 3, locks, true);
  assert.deepEqual(pick, { index: 0, wouldUnlock: false });
});

test("lock walk (day scope): startIdx beyond cohort length is modulo'd", () => {
  const pick = pickArbAgentIndexFromLocks(cohort, 9, new Map(), true);
  assert.deepEqual(pick, { index: 1, wouldUnlock: false });
});
