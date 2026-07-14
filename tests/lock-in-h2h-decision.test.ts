import test from "node:test";
import assert from "node:assert/strict";

import { computePrediction } from "../server/agents/decisionEngine";
import { createPRNG } from "../server/agents/prng";
import { SIMULATION_V2_COHORT_ID } from "../server/agents/simulationProfile";
import type { AgentConfigData, MarketWithEntries, TrendSignals } from "../server/agents/types";

function makeAgent(overrides: Partial<AgentConfigData> = {}): AgentConfigData {
  return {
    id: "agent-1",
    userId: "user-1",
    displayName: "Test Sharp",
    username: "test-sharp",
    bio: "",
    archetype: "analyst",
    specialties: ["trending"],
    boldness: 0.5,
    contrarianism: 0.0,
    recencyWeight: 1.0,
    prestigeBias: 0.3,
    confidenceCal: 0.5,
    riskAppetite: 0.5,
    consensusSensitivity: 0.0,
    activityRate: 1.0,
    simulationProfile: {
      schemaVersion: 2,
      cohortId: SIMULATION_V2_COHORT_ID,
      personaBand: "sharp",
    },
    isActive: true,
    ...overrides,
  };
}

const h2hMarket: MarketWithEntries = {
  id: "h2h-market-1",
  marketType: "h2h",
  status: "OPEN",
  title: "Alice vs Bob",
  category: "trending",
  personId: null,
  endAt: new Date("2026-06-07T23:59:59.999Z"),
  createdAt: new Date("2026-06-01T00:00:00Z"),
  entries: [
    { id: "e-alice", label: "Alice", totalStake: 0, noStake: 0, personId: "p-alice" },
    { id: "e-bob", label: "Bob", totalStake: 0, noStake: 0, personId: "p-bob" },
  ],
};

const entrySignals = new Map<string, TrendSignals>([
  [
    "e-alice",
    {
      trendScore: 800_000,
      fameIndex: 800_000,
      scoreBaseline: 700_000,
      scoreDelta7d: 10_000,
      change24h: 2,
      momentum: "Rising",
      trendDirection: "UP",
    },
  ],
  [
    "e-bob",
    {
      trendScore: 500_000,
      fameIndex: 500_000,
      scoreBaseline: 480_000,
      scoreDelta7d: -5_000,
      change24h: -1,
      momentum: "Falling",
      trendDirection: "DOWN",
    },
  ],
]);

const marketSignals: TrendSignals = entrySignals.get("e-alice")!;
const rng = createPRNG(42);

test("H2H lock-in: no force-pick when flags off", () => {
  const prevEn = process.env.LOCKIN_FAIR_H2H_ENABLED;
  const prevSh = process.env.LOCKIN_FAIR_H2H_SHADOW;
  process.env.LOCKIN_FAIR_H2H_ENABLED = "false";
  delete process.env.LOCKIN_FAIR_H2H_SHADOW;
  try {
    const d = computePrediction(
      makeAgent(),
      h2hMarket,
      marketSignals,
      {},
      rng,
      entrySignals,
      { hoursRemaining: 12 },
    );
    if (!d.abstain) {
      assert.ok(d.confidence != null && d.confidence < 0.85);
    }
  } finally {
    if (prevEn === undefined) delete process.env.LOCKIN_FAIR_H2H_ENABLED;
    else process.env.LOCKIN_FAIR_H2H_ENABLED = prevEn;
    if (prevSh === undefined) delete process.env.LOCKIN_FAIR_H2H_SHADOW;
    else process.env.LOCKIN_FAIR_H2H_SHADOW = prevSh;
  }
});

test("H2H lock-in: force-picks leader when enabled and fair decisive", () => {
  const prevEn = process.env.LOCKIN_FAIR_H2H_ENABLED;
  const prevSh = process.env.LOCKIN_FAIR_H2H_SHADOW;
  process.env.LOCKIN_FAIR_H2H_ENABLED = "true";
  delete process.env.LOCKIN_FAIR_H2H_SHADOW;
  try {
    const d = computePrediction(
      makeAgent({ confidenceCal: 1.0 }),
      h2hMarket,
      marketSignals,
      {},
      createPRNG(99),
      entrySignals,
      { hoursRemaining: 6 },
    );
    assert.equal(d.abstain, false);
    assert.equal(d.entryId, "e-alice");
    assert.ok((d.confidence ?? 0) >= 0.58);
  } finally {
    if (prevEn === undefined) delete process.env.LOCKIN_FAIR_H2H_ENABLED;
    else process.env.LOCKIN_FAIR_H2H_ENABLED = prevEn;
    if (prevSh === undefined) delete process.env.LOCKIN_FAIR_H2H_SHADOW;
    else process.env.LOCKIN_FAIR_H2H_SHADOW = prevSh;
  }
});
