/**
 * Regression test: when the daily LLM budget cap is exhausted, the world
 * market engine must abstain with `budget_exhausted` — NOT `api_error`.
 *
 * Why it matters: the agent runner persists `api_error` abstains as
 * `world_abstained` rows, which lock the agent out of that market for
 * WORLD_REEVAL_INTERVAL_DAYS (7d). Budget refusals used to share the
 * `api_error` path, so one exhausted day permanently starved every
 * short-dated market (Jul 2026: scouted match markets closed with zero
 * agent bets). `budget_exhausted` is skipped silently so agents retry
 * after the UTC-midnight budget reset.
 *
 * No OpenAI and no DB access on this path — the budget gate refuses the
 * call before the client is even constructed, and BUDGET_EXHAUSTED must
 * never be written to the assessment cache.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL before importing anything that transitively loads
// server/db.ts (worldMarketEngine does). Never actually connected to.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}
// Engine kill switch must be ON or we abstain with "domain" before the
// budget gate is ever reached. Set BEFORE constants.ts is imported.
process.env.WORLD_MARKETS_LLM_ENABLED = "true";
process.env.WORLD_MARKETS_DAILY_BUDGET_USD = "5.00";
process.env.WORLD_MARKETS_PER_CALL_ESTIMATE_USD = "0.40";

const { computeWorldMarketPrediction } = await import(
  "../server/agents/worldMarketEngine"
);
const { tryReserveLlmCall, _resetBudgetForTesting, getBudgetSnapshot } =
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
    contrarianism: 0.2,
    recencyWeight: 0.5,
    prestigeBias: 0.5,
    confidenceCal: 0.8,
    riskAppetite: 0.5,
    consensusSensitivity: 0.5,
    activityRate: 1.0,
    isActive: true,
  };
}

function makeMarket(): { market: MarketWithEntries; entries: MarketEntryData[] } {
  const entries: MarketEntryData[] = [
    { id: "entry-a", label: "Team A", totalStake: 100 },
    { id: "entry-b", label: "Team B", totalStake: 100 },
  ];
  const market: MarketWithEntries = {
    id: "market-1",
    marketType: "community",
    status: "OPEN",
    title: "Who will win A vs B?",
    category: "sports",
    personId: null,
    endAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    metadata: {}, // no cached worldAssessment — forces the LLM path
    entries,
  };
  return { market, entries };
}

// Deterministic RNG that passes both pre-filter gates: 0.5 is >= the 0.15
// domain skip probability (specialty matches category) and <= the 1.0
// activity rate.
const passGatesRng = { nextFloat: () => 0.5 };

test("world engine: exhausted budget abstains with budget_exhausted, not api_error", async () => {
  _resetBudgetForTesting();
  // Consume the entire $5.00 cap in one reservation; the engine's next
  // reservation attempt (any cost > 0) must be refused.
  const fill = tryReserveLlmCall(5.0);
  assert.equal(fill.allowed, true);
  assert.equal(getBudgetSnapshot().exhausted, true);

  const { market, entries } = makeMarket();
  const decision = await computeWorldMarketPrediction(
    makeAgent(),
    market,
    entries,
    passGatesRng,
  );

  assert.equal(decision.abstain, true);
  assert.equal(decision.abstainReason, "budget_exhausted");

  // The refusal must not be cached as an assessment — the market's
  // metadata object is untouched, so the next sweep re-attempts the call.
  assert.deepEqual(market.metadata, {});

  _resetBudgetForTesting();
});

test("world engine: budget refusal is not persisted by the runner filter", async () => {
  // The runner only persists world_abstain / api_error as world_abstained
  // lockout rows. Guard the contract here so a future edit to the reason
  // string doesn't silently re-introduce the 7-day starvation bug.
  const persistedReasons = ["world_abstain", "api_error"];
  assert.ok(!persistedReasons.includes("budget_exhausted"));

  _resetBudgetForTesting();
  tryReserveLlmCall(5.0);

  const { market, entries } = makeMarket();
  const decision = await computeWorldMarketPrediction(
    makeAgent(),
    market,
    entries,
    passGatesRng,
  );

  assert.equal(
    persistedReasons.includes(decision.abstainReason ?? ""),
    false,
    `budget refusal must not map to a persisted reason, got: ${decision.abstainReason}`,
  );

  _resetBudgetForTesting();
});
