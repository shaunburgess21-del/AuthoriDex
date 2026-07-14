/**
 * Anchor-based world-market assessments (scouted markets).
 *
 * Scouted markets carry the source market's consensus prices in
 * `metadata.source` (refreshed daily by the source watcher). The engine
 * bets off that anchor directly — per-agent sampled, zero LLM cost, no
 * budget consumption — and only falls back to the LLM for markets without
 * a usable/fresh anchor. This is what generates baseline agent activity
 * on freshly published scouted markets.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL before importing anything that transitively loads
// server/db.ts (worldMarketEngine does). Never actually connected to.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}
// Engine kill switch must be ON or we abstain with "domain" before the
// anchor/budget logic is ever reached. Set BEFORE constants.ts loads.
process.env.WORLD_MARKETS_LLM_ENABLED = "true";
process.env.WORLD_MARKETS_DAILY_BUDGET_USD = "5.00";
process.env.WORLD_MARKETS_PER_CALL_ESTIMATE_USD = "0.40";

const { computeWorldMarketPrediction } = await import(
  "../server/agents/worldMarketEngine"
);
const { tryReserveLlmCall, getBudgetSnapshot, _resetBudgetForTesting } =
  await import("../server/agents/worldMarketBudget");

import type {
  AgentConfigData,
  MarketWithEntries,
  MarketEntryData,
} from "../server/agents/types";

function makeAgent(): AgentConfigData {
  return {
    id: "agent-1",
    userId: "user-1",
    displayName: "Test Agent",
    username: "test_agent",
    bio: "test",
    archetype: "conservative",
    specialties: ["sports"],
    boldness: 0.5,
    contrarianism: 0.2, // below the 0.7 contrarian-flip gate — keeps picks deterministic
    recencyWeight: 0.5,
    prestigeBias: 0.5,
    confidenceCal: 0.8,
    riskAppetite: 0.5,
    consensusSensitivity: 0.5,
    activityRate: 1.0,
    isActive: true,
  };
}

/** 60/40 two-way scouted market with a fresh live anchor. */
function makeAnchoredMarket(opts?: { livePricesAt?: string }): {
  market: MarketWithEntries;
  entries: MarketEntryData[];
} {
  const entries: MarketEntryData[] = [
    { id: "entry-a", label: "Team A", totalStake: 100 },
    { id: "entry-b", label: "Team B", totalStake: 100 },
  ];
  const market: MarketWithEntries = {
    id: "market-anchor",
    marketType: "community",
    status: "OPEN",
    title: "Who will win A vs B?",
    category: "sports",
    personId: null,
    endAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    metadata: {
      source: {
        provider: "polymarket",
        outcomeMapping: [{ entryLabel: "Team A" }, { entryLabel: "Team B" }],
        livePrices: [0.6, 0.4],
        livePricesAt: opts?.livePricesAt ?? new Date().toISOString(),
        pricesAtImport: [0.55, 0.45],
        fetchedAt: opts?.livePricesAt ?? new Date().toISOString(),
      },
    },
    entries,
  };
  return { market, entries };
}

/** RNG that replays a fixed sequence (repeats the last value if exhausted). */
function seqRng(values: number[]) {
  let i = 0;
  return { nextFloat: () => values[Math.min(i++, values.length - 1)] };
}

test("anchor: agent bets off a fresh source anchor without touching the LLM budget", async () => {
  _resetBudgetForTesting();
  const before = getBudgetSnapshot();

  const { market, entries } = makeAnchoredMarket();
  // [domain gate, activity gate, anchor sample] — 0.1 lands inside Team A's
  // 0.60 probability mass, so the agent backs the favourite.
  const decision = await computeWorldMarketPrediction(
    makeAgent(),
    market,
    entries,
    seqRng([0.5, 0.5, 0.1]),
  );

  assert.equal(decision.abstain, false);
  assert.equal(decision.entryId, "entry-a");
  assert.equal(decision.source, "source_anchor");
  assert.ok(Math.abs((decision.rawProbability ?? 0) - 0.6) < 0.01);
  assert.ok(decision.reasoning?.includes("Team A"));

  // Zero budget interaction: nothing reserved, nothing blocked.
  const after = getBudgetSnapshot();
  assert.equal(after.callsReserved, before.callsReserved);
  assert.equal(after.callsBlocked, before.callsBlocked);
});

test("anchor: sampling is proportional — a high roll backs the underdog", async () => {
  _resetBudgetForTesting();
  const { market, entries } = makeAnchoredMarket();
  // Sample roll 0.99 falls past Team A's 0.60 mass into Team B's 0.40.
  const decision = await computeWorldMarketPrediction(
    makeAgent(),
    market,
    entries,
    seqRng([0.5, 0.5, 0.99]),
  );

  assert.equal(decision.abstain, false);
  assert.equal(decision.entryId, "entry-b");
  assert.equal(decision.source, "source_anchor");
  assert.ok(Math.abs((decision.rawProbability ?? 0) - 0.4) < 0.01);
});

test("anchor: anchored market still bets when the LLM budget is exhausted", async () => {
  _resetBudgetForTesting();
  tryReserveLlmCall(5.0); // consume the full cap
  assert.equal(getBudgetSnapshot().exhausted, true);

  const { market, entries } = makeAnchoredMarket();
  const decision = await computeWorldMarketPrediction(
    makeAgent(),
    market,
    entries,
    seqRng([0.5, 0.5, 0.1]),
  );

  assert.equal(decision.abstain, false);
  assert.equal(decision.source, "source_anchor");

  _resetBudgetForTesting();
});

test("anchor: stale anchor falls back to the LLM path", async () => {
  _resetBudgetForTesting();
  tryReserveLlmCall(5.0); // exhaust budget so the LLM fallback is observable

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const { market, entries } = makeAnchoredMarket({ livePricesAt: fiveDaysAgo });
  const decision = await computeWorldMarketPrediction(
    makeAgent(),
    market,
    entries,
    seqRng([0.5, 0.5, 0.1]),
  );

  // Anchor rejected for staleness -> LLM path -> budget refusal. The key
  // assertion is that a stale anchor is NOT bet on.
  assert.equal(decision.abstain, true);
  assert.equal(decision.abstainReason, "budget_exhausted");

  _resetBudgetForTesting();
});

test("anchor: non-scouted market (no source metadata) uses the LLM path", async () => {
  _resetBudgetForTesting();
  tryReserveLlmCall(5.0);

  const entries: MarketEntryData[] = [
    { id: "entry-a", label: "Yes", totalStake: 100 },
    { id: "entry-b", label: "No", totalStake: 100 },
  ];
  const market: MarketWithEntries = {
    id: "market-manual",
    marketType: "community",
    status: "OPEN",
    title: "Manual world market?",
    category: "sports",
    personId: null,
    endAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    metadata: {},
    entries,
  };

  const decision = await computeWorldMarketPrediction(
    makeAgent(),
    market,
    entries,
    seqRng([0.5, 0.5]),
  );
  assert.equal(decision.abstain, true);
  assert.equal(decision.abstainReason, "budget_exhausted");

  _resetBudgetForTesting();
});

test("assessments off: anchored market still bets without LLM budget", async () => {
  const prev = process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED;
  process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED = "false";
  try {
    _resetBudgetForTesting();
    const before = getBudgetSnapshot();
    const { market, entries } = makeAnchoredMarket();
    const decision = await computeWorldMarketPrediction(
      makeAgent(),
      market,
      entries,
      seqRng([0.5, 0.5, 0.1]),
    );

    assert.equal(decision.abstain, false);
    assert.equal(decision.source, "source_anchor");
    assert.equal(decision.entryId, "entry-a");

    const after = getBudgetSnapshot();
    assert.equal(after.callsReserved, before.callsReserved);
    assert.equal(after.callsBlocked, before.callsBlocked);
  } finally {
    if (prev === undefined) delete process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED;
    else process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED = prev;
  }
});

test("assessments off: unanchored / manual market abstains without LLM", async () => {
  const prev = process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED;
  process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED = "false";
  try {
    _resetBudgetForTesting();
    const before = getBudgetSnapshot();

    const entries: MarketEntryData[] = [
      { id: "entry-a", label: "Yes", totalStake: 100 },
      { id: "entry-b", label: "No", totalStake: 100 },
    ];
    // Fresh LLM cache present — must still be ignored when assessments are off.
    const market: MarketWithEntries = {
      id: "market-manual-cached",
      marketType: "community",
      status: "OPEN",
      title: "Manual world market with stale GPT cache?",
      category: "sports",
      personId: null,
      endAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      metadata: {
        worldAssessment: {
          assessment: {
            decision: "bet",
            selectedOutcomeIndex: 1,
            confidence: 0.8,
            probabilities: [
              { outcomeIndex: 1, probability: 0.8 },
              { outcomeIndex: 2, probability: 0.2 },
            ],
            briefReasoning: "cached GPT pick",
          },
          cachedAt: new Date().toISOString(),
        },
      },
      entries,
    };

    const decision = await computeWorldMarketPrediction(
      makeAgent(),
      market,
      entries,
      seqRng([0.5, 0.5]),
    );

    assert.equal(decision.abstain, true);
    assert.equal(decision.abstainReason, "domain");
    // No budget interaction — getOrCreateAssessment must not run.
    const after = getBudgetSnapshot();
    assert.equal(after.callsReserved, before.callsReserved);
    assert.equal(after.callsBlocked, before.callsBlocked);
  } finally {
    if (prev === undefined) delete process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED;
    else process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED = prev;
  }
});

test("assessments off: stale anchor does not fall through to LLM", async () => {
  const prev = process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED;
  process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED = "false";
  try {
    _resetBudgetForTesting();
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { market, entries } = makeAnchoredMarket({ livePricesAt: fiveDaysAgo });
    const decision = await computeWorldMarketPrediction(
      makeAgent(),
      market,
      entries,
      seqRng([0.5, 0.5, 0.1]),
    );

    // Stale anchor → no LLM fallback when assessments are off.
    assert.equal(decision.abstain, true);
    assert.equal(decision.abstainReason, "domain");
  } finally {
    if (prev === undefined) delete process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED;
    else process.env.WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED = prev;
  }
});
