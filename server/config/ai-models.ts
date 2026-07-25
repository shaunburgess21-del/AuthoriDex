export const AI_DEFAULT_MODEL = process.env.AI_DEFAULT_MODEL || "gpt-5.4";

const MODEL_ENV_BY_SCOPE = {
  profileAbout: "PROFILE_ABOUT_MODEL",
  whyTrending: "WHY_TRENDING_MODEL",
  agentRationale: "AGENT_RATIONALE_MODEL",
  agentComments: "AGENT_COMMENTS_MODEL",
  marketResolver: "MARKET_RESOLVER_MODEL",
  worldMarkets: "WORLD_MARKETS_MODEL",
  aiDrafts: "AI_DRAFT_MODEL",
  sharpRanker: "SHARP_RANKER_MODEL",
  nativeMarkets: "NATIVE_MARKETS_MODEL",
  resolutionScout: "RESOLUTION_SCOUT_MODEL",
  marketScout: "MARKET_SCOUT_MODEL",
  voteScout: "VOTE_SCOUT_MODEL",
} as const;

export type AiModelScope = keyof typeof MODEL_ENV_BY_SCOPE;

/**
 * Cheaper defaults for short / near-extractive scopes. Override any of these
 * via the matching env var (e.g. WHY_TRENDING_MODEL=gpt-5.4) without a redeploy
 * of the code map. Scopes not listed here fall through to AI_DEFAULT_MODEL.
 */
const SCOPE_DEFAULT_MODEL: Partial<Record<AiModelScope, string>> = {
  whyTrending: "gpt-5.4-mini",
  agentRationale: "gpt-5.4-mini",
  agentComments: "gpt-5.4-mini",
  marketResolver: "gpt-5.4-mini",
};

export function getAiModel(scope: AiModelScope): string {
  const envKey = MODEL_ENV_BY_SCOPE[scope];
  const fromEnv = process.env[envKey]?.trim();
  return fromEnv || SCOPE_DEFAULT_MODEL[scope] || AI_DEFAULT_MODEL;
}

export function getChatCompletionTokenLimit(model: string, tokens: number): { max_completion_tokens: number } | { max_tokens: number } {
  return model.startsWith("gpt-5") || model.startsWith("o")
    ? { max_completion_tokens: tokens }
    : { max_tokens: tokens };
}
