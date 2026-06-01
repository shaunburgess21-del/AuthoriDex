import test from "node:test";
import assert from "node:assert/strict";

import { computeArbPrediction } from "../server/agents/arbAgent";
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
