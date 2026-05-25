import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";
process.env.NATIVE_MARKETS_DAILY_BUDGET_USD = "2.00";
process.env.NATIVE_MARKETS_PER_CALL_ESTIMATE_USD = "0.012";
process.env.NATIVE_MARKETS_LLM_ENABLED = "true";

const { getOrFetchNativeAssessment } = await import("../server/agents/nativeMarketEngine");
const {
  tryReserveNativeLlmCall,
  getNativeBudgetSnapshot,
  _resetNativeBudgetForTesting,
} = await import("../server/agents/nativeMarketBudget");

const baseMarket = {
  id: "market-test-1",
  marketType: "updown" as const,
  openMarketType: null,
  status: "OPEN" as const,
  title: "Test Person: Up or Down?",
  category: "music",
  personId: "person-1",
  endAt: new Date(),
  createdAt: new Date(),
  metadata: {},
  entries: [
    { id: "e-up", label: "Up", totalStake: 0 },
    { id: "e-down", label: "Down", totalStake: 0 },
  ],
};

const cachedAssessment = {
  expectedDirection: "UP" as const,
  probability: 0.72,
  rationale: "cached",
  fetchedAt: new Date().toISOString(),
  model: "test-model",
  marketType: "updown" as const,
  inputs: {},
};

test("native engine: fresh cache avoids budget reservation", async () => {
  _resetNativeBudgetForTesting();

  const result = await getOrFetchNativeAssessment(
    {
      ...baseMarket,
      metadata: {
        nativeAssessment: {
          cachedAt: new Date().toISOString(),
          assessment: cachedAssessment,
        },
      },
    },
    null,
  );

  assert.equal(result?.probability, 0.72);
  assert.equal(getNativeBudgetSnapshot().callsReserved, 0);
});

test("native engine: budget exhausted returns null without LLM", async () => {
  _resetNativeBudgetForTesting();
  const r = tryReserveNativeLlmCall(2.0);
  if (r.allowed) r.commit();

  const result = await getOrFetchNativeAssessment({ ...baseMarket, metadata: {} }, null);
  assert.equal(result, null);
});
