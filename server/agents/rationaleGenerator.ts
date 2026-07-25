/**
 * LLM wrapper for written rationales. Called only for high-confidence predictions.
 * Try/catch is mandatory — a failed LLM call must never block a prediction write.
 */

import OpenAI from "openai";
import { getRecentMemory } from "./memoryManager";
import type { AgentConfigData, MarketWithEntries, PredictionDecision } from "./types";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";
import { recordLlmUsage } from "../config/ai-cost";

// Lazy-init — see `sharpRanker.getOpenAIClient` for the rationale.
// Importing this module from a key-less context (CI test workers etc.)
// must not crash; only throw if/when an LLM call is actually fired.
let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  _openaiClient = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  });
  return _openaiClient;
}

export async function generateRationale(
  agent: AgentConfigData,
  market: MarketWithEntries,
  decision: PredictionDecision
): Promise<string | undefined> {
  try {
    const memories = await getRecentMemory(agent.id, 3);
    const memoryContext = memories.length
      ? `Recent notes: ${memories.map((m) => m.content).join(" | ")}`
      : "";

    const chosenEntry = market.entries.find((e) => e.id === decision.entryId);
    const confidencePct = Math.round((decision.confidence ?? 0.5) * 100);

    const systemPrompt = `You are ${agent.displayName}, a prediction account on a fame-tracking platform.
Your personality: ${agent.bio}
Your archetype: ${agent.archetype}
${memoryContext}
Write a short rationale for your prediction in your own voice. 1-2 sentences maximum.
Be direct. Use personality. Don't sound like an AI. Do not start with "I think".`;

    const userPrompt = `Market: "${market.title}"
My pick: ${chosenEntry?.label ?? "Unknown"} (confidence: ${confidencePct}%)
Write the rationale.`;

    const model = getAiModel("agentRationale");
    const response = await getOpenAIClient().chat.completions.create({
      model,
      ...getChatCompletionTokenLimit(model, 80),
      temperature: 0.85,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    recordLlmUsage({
      feature: "agent_rationale",
      model,
      usage: response.usage,
      detail: `agent=${agent.displayName} market=${market.id}`,
    });

    return response.choices[0]?.message?.content?.trim() || undefined;
  } catch (err) {
    console.warn(
      `[RationaleGen] Failed for agent=${agent.displayName} market=${market.id}:`,
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}
