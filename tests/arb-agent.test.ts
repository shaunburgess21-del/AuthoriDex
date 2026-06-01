import test from "node:test";
import assert from "node:assert/strict";

import { computeArbPrediction, computeArbPredictionH2H, computeArbPredictionGainer } from "../server/agents/arbAgent";
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

test("computeArbPredictionH2H abstains when flag off", () => {
  const prev = process.env.LOCKIN_FAIR_H2H_ENABLED;
  delete process.env.LOCKIN_FAIR_H2H_ENABLED;
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
  delete process.env.LOCKIN_FAIR_GAINER_ENABLED;
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
