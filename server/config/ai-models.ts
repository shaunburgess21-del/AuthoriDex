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

export type AiProvider = "openai" | "xai";

const PROVIDER_ENV_BY_SCOPE: Partial<Record<AiModelScope, string>> = {
  agentComments: "AGENT_COMMENTS_PROVIDER",
};

/**
 * Cheaper OpenAI defaults for short / near-extractive scopes. Override any of
 * these via the matching env var (e.g. WHY_TRENDING_MODEL=gpt-5.4) without a
 * redeploy of the code map. Scopes not listed here fall through to
 * AI_DEFAULT_MODEL. When a scope's provider is xai, XAI_SCOPE_DEFAULT_MODEL
 * wins instead (unless the model env override is set).
 */
const SCOPE_DEFAULT_MODEL: Partial<Record<AiModelScope, string>> = {
  whyTrending: "gpt-5.4-mini",
  agentRationale: "gpt-5.4-mini",
  agentComments: "gpt-5.4-mini",
  marketResolver: "gpt-5.4-mini",
};

/** Defaults when a scope is routed to xAI/Grok. */
const XAI_SCOPE_DEFAULT_MODEL: Partial<Record<AiModelScope, string>> = {
  // Flagship voice for edgy agent chatter; override with AGENT_COMMENTS_MODEL
  // (e.g. grok-4.3) if you want cheaper / less frontier.
  agentComments: "grok-4.5",
};

function parseProvider(raw: string | undefined): AiProvider | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "xai" || v === "grok") return "xai";
  if (v === "openai" || v === "oai") return "openai";
  return null;
}

/**
 * Provider for a scope. Default openai. Only agentComments currently supports
 * an override (AGENT_COMMENTS_PROVIDER=xai|openai).
 */
export function getAiProvider(scope: AiModelScope): AiProvider {
  const envKey = PROVIDER_ENV_BY_SCOPE[scope];
  if (!envKey) return "openai";
  return parseProvider(process.env[envKey]) ?? "openai";
}

export function getAiModel(scope: AiModelScope): string {
  const envKey = MODEL_ENV_BY_SCOPE[scope];
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;

  const provider = getAiProvider(scope);
  if (provider === "xai") {
    return XAI_SCOPE_DEFAULT_MODEL[scope] || "grok-4.5";
  }
  return SCOPE_DEFAULT_MODEL[scope] || AI_DEFAULT_MODEL;
}

/**
 * Token-limit field differs by family:
 * - OpenAI gpt-5 / o-series → max_completion_tokens
 * - Grok / classic OpenAI → max_tokens (xAI chat completions)
 */
export function getChatCompletionTokenLimit(
  model: string,
  tokens: number,
): { max_completion_tokens: number } | { max_tokens: number } {
  if (model.startsWith("gpt-5") || model.startsWith("o")) {
    return { max_completion_tokens: tokens };
  }
  return { max_tokens: tokens };
}
