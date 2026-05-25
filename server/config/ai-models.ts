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
} as const;

export type AiModelScope = keyof typeof MODEL_ENV_BY_SCOPE;

export function getAiModel(scope: AiModelScope): string {
  const envKey = MODEL_ENV_BY_SCOPE[scope];
  return process.env[envKey] || AI_DEFAULT_MODEL;
}

export function getChatCompletionTokenLimit(model: string, tokens: number): { max_completion_tokens: number } | { max_tokens: number } {
  return model.startsWith("gpt-5") || model.startsWith("o")
    ? { max_completion_tokens: tokens }
    : { max_tokens: tokens };
}
