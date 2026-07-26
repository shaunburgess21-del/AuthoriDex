import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  estimateLlmCostUsd,
  normalizeLlmUsage,
  resolveModelPricing,
  WEB_SEARCH_CALL_COST_USD,
} from "../server/config/ai-cost";
import { getAiModel, getAiProvider, getChatCompletionTokenLimit } from "../server/config/ai-models";

describe("ai-cost helpers", () => {
  it("prices gpt-5.4 at $2.50/$15 per 1M", () => {
    const pricing = resolveModelPricing("gpt-5.4");
    assert.equal(pricing.inputPer1M, 2.5);
    assert.equal(pricing.outputPer1M, 15);
    const cost = estimateLlmCostUsd("gpt-5.4", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    assert.equal(cost, 17.5);
  });

  it("prices gpt-5.4-mini at $0.75/$4.50 per 1M", () => {
    const pricing = resolveModelPricing("gpt-5.4-mini");
    assert.equal(pricing.inputPer1M, 0.75);
    assert.equal(pricing.outputPer1M, 4.5);
    const cost = estimateLlmCostUsd("gpt-5.4-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    assert.equal(cost, 5.25);
  });

  it("prices grok-4.5 at $2/$6 per 1M", () => {
    const pricing = resolveModelPricing("grok-4.5");
    assert.equal(pricing.inputPer1M, 2);
    assert.equal(pricing.outputPer1M, 6);
  });

  it("falls back unknown models to gpt-5.4 rates", () => {
    const pricing = resolveModelPricing("totally-unknown-model");
    assert.equal(pricing.inputPer1M, 2.5);
    assert.equal(pricing.outputPer1M, 15);
  });

  it("adds web_search flat cost", () => {
    const cost = estimateLlmCostUsd("gpt-5.4", {
      inputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 2,
    });
    assert.equal(cost, WEB_SEARCH_CALL_COST_USD * 2);
  });

  it("normalizes chat-completions and Responses usage shapes", () => {
    assert.deepEqual(
      normalizeLlmUsage({ prompt_tokens: 10, completion_tokens: 4 }),
      { inputTokens: 10, outputTokens: 4 },
    );
    assert.deepEqual(
      normalizeLlmUsage({ input_tokens: 12, output_tokens: 6 }),
      { inputTokens: 12, outputTokens: 6 },
    );
    assert.deepEqual(normalizeLlmUsage(null), { inputTokens: 0, outputTokens: 0 });
  });
});

describe("ai-models scope defaults", () => {
  beforeEach(() => {
    delete process.env.WHY_TRENDING_MODEL;
    delete process.env.AGENT_RATIONALE_MODEL;
    delete process.env.AGENT_COMMENTS_MODEL;
    delete process.env.MARKET_RESOLVER_MODEL;
    delete process.env.AGENT_COMMENTS_PROVIDER;
    delete process.env.PROFILE_ABOUT_MODEL;
    delete process.env.SHARP_RANKER_MODEL;
  });

  afterEach(() => {
    delete process.env.AGENT_COMMENTS_PROVIDER;
    delete process.env.AGENT_COMMENTS_MODEL;
    delete process.env.WHY_TRENDING_MODEL;
  });

  it("defaults low-stakes scopes to gpt-5.4-mini when env unset", () => {
    assert.equal(getAiModel("whyTrending"), "gpt-5.4-mini");
    assert.equal(getAiModel("agentRationale"), "gpt-5.4-mini");
    assert.equal(getAiModel("agentComments"), "gpt-5.4-mini");
    assert.equal(getAiModel("marketResolver"), "gpt-5.4-mini");
    assert.equal(getAiProvider("agentComments"), "openai");
  });

  it("routes agent comments to grok-4.5 when provider=xai", () => {
    process.env.AGENT_COMMENTS_PROVIDER = "xai";
    assert.equal(getAiProvider("agentComments"), "xai");
    assert.equal(getAiModel("agentComments"), "grok-4.5");
  });

  it("accepts grok alias for AGENT_COMMENTS_PROVIDER", () => {
    process.env.AGENT_COMMENTS_PROVIDER = "grok";
    assert.equal(getAiProvider("agentComments"), "xai");
  });

  it("honours AGENT_COMMENTS_MODEL over xai default", () => {
    process.env.AGENT_COMMENTS_PROVIDER = "xai";
    process.env.AGENT_COMMENTS_MODEL = "grok-4.3";
    assert.equal(getAiModel("agentComments"), "grok-4.3");
  });

  it("keeps high-stakes scopes on AI_DEFAULT_MODEL when unset", () => {
    const fallback = process.env.AI_DEFAULT_MODEL || "gpt-5.4";
    assert.equal(getAiModel("profileAbout"), fallback);
    assert.equal(getAiModel("sharpRanker"), fallback);
  });

  it("honours env overrides over scope defaults", () => {
    process.env.WHY_TRENDING_MODEL = "gpt-5.4";
    assert.equal(getAiModel("whyTrending"), "gpt-5.4");
  });

  it("uses max_tokens for grok models and max_completion_tokens for gpt-5", () => {
    assert.deepEqual(getChatCompletionTokenLimit("grok-4.5", 100), { max_tokens: 100 });
    assert.deepEqual(getChatCompletionTokenLimit("gpt-5.4-mini", 100), {
      max_completion_tokens: 100,
    });
  });
});
