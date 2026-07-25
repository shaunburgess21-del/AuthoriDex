/**
 * Shared OpenAI cost estimation + per-feature daily spend logging.
 *
 * Call sites fire-and-forget `recordLlmUsage(...)` after each successful
 * OpenAI response. Counters land in `llm_daily_spend` (same table the
 * world/native market budget rails use) under distinct feature keys so
 * ops can prove savings via GET /api/admin/llm-usage.
 *
 * Never throws into the caller — persistence / pricing failures are logged
 * and swallowed so a billing observability bug cannot break product paths.
 *
 * Persistence is dynamically imported inside `recordLlmUsage` so pure
 * helpers (estimate / normalize / pricing) can be unit-tested without a
 * DATABASE_URL (same pattern as worldMarketBudget).
 */

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
}

/**
 * Per-model rates used for cost estimates (OpenAI list prices, short context).
 * Source: https://developers.openai.com/api/docs/pricing
 *   gpt-5.4      — $2.50 / 1M input, $15.00 / 1M output
 *   gpt-5.4-mini — $0.75 / 1M input,  $4.50 / 1M output
 * Accuracy of the admin rollup depends on these; product behaviour does not.
 */
export const AI_MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.4": { inputPer1M: 2.5, outputPer1M: 15 },
  "gpt-5.4-mini": { inputPer1M: 0.75, outputPer1M: 4.5 },
};

const FALLBACK_PRICING: ModelPricing = AI_MODEL_PRICING["gpt-5.4"];

/**
 * Flat USD adder per Responses API web_search tool invocation. OpenAI
 * bills web_search separately from tokens; this is a documented estimate
 * so profile_about_websearch / world-market-style calls don't under-count.
 * Override via WEB_SEARCH_CALL_COST_USD.
 */
export const WEB_SEARCH_CALL_COST_USD = (() => {
  const raw = Number(process.env.WEB_SEARCH_CALL_COST_USD);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.01;
})();

export type LlmUsageLike = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
} | null | undefined;

export interface EstimateLlmCostInput {
  inputTokens: number;
  outputTokens: number;
  webSearchCalls?: number;
}

export function resolveModelPricing(model: string): ModelPricing {
  return AI_MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

export function estimateLlmCostUsd(
  model: string,
  { inputTokens, outputTokens, webSearchCalls = 0 }: EstimateLlmCostInput,
): number {
  const pricing = resolveModelPricing(model);
  const tokenCost =
    (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPer1M +
    (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPer1M;
  const searchCost = Math.max(0, webSearchCalls) * WEB_SEARCH_CALL_COST_USD;
  return tokenCost + searchCost;
}

/** Normalize chat-completions vs Responses API usage shapes. */
export function normalizeLlmUsage(usage: LlmUsageLike): {
  inputTokens: number;
  outputTokens: number;
} {
  if (!usage) return { inputTokens: 0, outputTokens: 0 };
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  return { inputTokens, outputTokens };
}

function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface RecordLlmUsageArgs {
  /** Feature key written to llm_daily_spend.feature (e.g. why_trending). */
  feature: string;
  model: string;
  usage?: LlmUsageLike;
  webSearchCalls?: number;
  /** Optional extra context for the log line (person name, market id, …). */
  detail?: string;
}

/**
 * Fire-and-forget: estimate cost from usage + model, persist one call to
 * llm_daily_spend, and log a one-liner. Safe to call without awaiting.
 */
export function recordLlmUsage(args: RecordLlmUsageArgs): void {
  void recordLlmUsageAsync(args);
}

async function recordLlmUsageAsync(args: RecordLlmUsageArgs): Promise<void> {
  try {
    const { inputTokens, outputTokens } = normalizeLlmUsage(args.usage);
    const webSearchCalls = args.webSearchCalls ?? 0;
    const costUsd = estimateLlmCostUsd(args.model, {
      inputTokens,
      outputTokens,
      webSearchCalls,
    });
    const day = todayUtcDateString();

    const { persistSpendDelta } = await import("../agents/llmSpendStore");
    await persistSpendDelta(args.feature, day, costUsd, 1);

    const detail = args.detail ? ` ${args.detail}` : "";
    console.log(
      `[AiCost] ${args.feature} model=${args.model} ` +
        `in=${inputTokens} out=${outputTokens}` +
        (webSearchCalls > 0 ? ` web_search=${webSearchCalls}` : "") +
        ` cost≈$${costUsd.toFixed(5)}${detail}`,
    );
  } catch (err) {
    console.warn(
      `[AiCost] Failed to record usage for ${args.feature}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
