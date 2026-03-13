/**
 * LLM wrapper for written rationales. Called only for high-confidence predictions.
 * Try/catch is mandatory — a failed LLM call must never block a prediction write.
 */

import OpenAI from "openai";
import { getRecentMemory } from "./memoryManager";
import type { AgentConfigData, MarketWithEntries, PredictionDecision } from "./types";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
});

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

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 80,
      temperature: 0.85,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
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
