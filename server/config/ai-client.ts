/**
 * Shared AI client factory.
 *
 * Most scopes use OpenAI. Agent comments (and any future scoped pilots) can
 * route to xAI/Grok via AGENT_COMMENTS_PROVIDER=xai + XAI_API_KEY without
 * changing the OpenAI SDK call sites — xAI is OpenAI-compatible at
 * https://api.x.ai/v1.
 */

import OpenAI from "openai";
import { getAiProvider, type AiModelScope, type AiProvider } from "./ai-models";

const XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1";

type ClientCacheKey = `${AiProvider}:${string}`;

const clients = new Map<ClientCacheKey, OpenAI>();

function resolveOpenAiApiKey(): string | undefined {
  return (
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined
  );
}

function resolveXaiApiKey(): string | undefined {
  return (
    process.env.AI_INTEGRATIONS_XAI_API_KEY?.trim() ||
    process.env.XAI_API_KEY?.trim() ||
    undefined
  );
}

function resolveXaiBaseUrl(): string {
  return process.env.XAI_BASE_URL?.trim() || XAI_DEFAULT_BASE_URL;
}

function resolveOpenAiBaseUrl(): string | undefined {
  return process.env.OPENAI_BASE_URL?.trim() || undefined;
}

/**
 * Lazy OpenAI-SDK client for a scope. Cached per provider+baseURL so switching
 * AGENT_COMMENTS_PROVIDER at runtime (tests) still works after cache clear.
 */
export function getAiClient(scope: AiModelScope): OpenAI {
  const provider = getAiProvider(scope);

  if (provider === "xai") {
    const apiKey = resolveXaiApiKey();
    if (!apiKey) {
      throw new Error(
        `XAI_API_KEY (or AI_INTEGRATIONS_XAI_API_KEY) is required when provider=xai for scope=${scope}`,
      );
    }
    const baseURL = resolveXaiBaseUrl();
    const cacheKey: ClientCacheKey = `xai:${baseURL}`;
    let client = clients.get(cacheKey);
    if (!client) {
      client = new OpenAI({ apiKey, baseURL });
      clients.set(cacheKey, client);
    }
    return client;
  }

  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) {
    throw new Error(
      `OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) is required for scope=${scope}`,
    );
  }
  const baseURL = resolveOpenAiBaseUrl();
  const cacheKey: ClientCacheKey = `openai:${baseURL ?? "default"}`;
  let client = clients.get(cacheKey);
  if (!client) {
    client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    clients.set(cacheKey, client);
  }
  return client;
}

/** Test helper — clears the lazy client cache. */
export function resetAiClientsForTests(): void {
  clients.clear();
}
