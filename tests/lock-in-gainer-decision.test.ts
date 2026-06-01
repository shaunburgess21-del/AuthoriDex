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
    confidenceCal: 1.0,
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

const gainerMarket: MarketWithEntries = {
  id: "gainer-market-1",
  marketType: "gainer",
  status: "OPEN",
  title: "Weekly top gainer",
  category: "trending",
  personId: null,
  endAt: new Date("2026-06-07T23:59:59.999Z"),
  createdAt: new Date("2026-06-01T00:00:00Z"),
  entries: [
    { id: "e-lead", label: "Leader", totalStake: 0, noStake: 0, personId: "p-lead" },
    { id: "e-mid", label: "Mid", totalStake: 0, noStake: 0, personId: "p-mid" },
    { id: "e-trail", label: "Trail", totalStake: 0, noStake: 0, personId: "p-trail" },
  ],
};

const entrySignals = new Map<string, TrendSignals>([
  [
    "e-lead",
    {
      trendScore: 900_000,
      fameIndex: 900_000,
      scoreBaseline: 700_000,
      scoreDelta7d: 20_000,
      change24h: 5,
      momentum: "Breakout",
      trendDirection: "UP",
      pctChangeVsOpen: 0.22,
    },
  ],
  [
    "e-mid",
    {
      trendScore: 600_000,
      fameIndex: 600_000,
      scoreBaseline: 580_000,
      scoreDelta7d: 2_000,
      change24h: 0.5,
      momentum: "Stable",
      trendDirection: "FLAT",
      pctChangeVsOpen: 0.04,
    },
  ],
  [
    "e-trail",
    {
      trendScore: 500_000,
      fameIndex: 500_000,
      scoreBaseline: 510_000,
      scoreDelta7d: -3_000,
      change24h: -1,
      momentum: "Cooling",
      trendDirection: "DOWN",
      pctChangeVsOpen: -0.02,
    },
  ],
]);

const marketSignals: TrendSignals = entrySignals.get("e-lead")!;

test("Gainer lock-in: force-picks leader when enabled and fair decisive", () => {
  const prevEn = process.env.LOCKIN_FAIR_GAINER_ENABLED;
  const prevSh = process.env.LOCKIN_FAIR_GAINER_SHADOW;
  process.env.LOCKIN_FAIR_GAINER_ENABLED = "true";
  delete process.env.LOCKIN_FAIR_GAINER_SHADOW;
  try {
    const d = computePrediction(
      makeAgent({ confidenceCal: 1.0 }),
      gainerMarket,
      marketSignals,
      {},
      createPRNG(99),
      entrySignals,
      { hoursRemaining: 6 },
    );
    assert.equal(d.abstain, false);
    assert.equal(d.entryId, "e-lead");
    assert.ok((d.confidence ?? 0) >= 0.45);
  } finally {
    if (prevEn === undefined) delete process.env.LOCKIN_FAIR_GAINER_ENABLED;
    else process.env.LOCKIN_FAIR_GAINER_ENABLED = prevEn;
    if (prevSh === undefined) delete process.env.LOCKIN_FAIR_GAINER_SHADOW;
    else process.env.LOCKIN_FAIR_GAINER_SHADOW = prevSh;
  }
});
