import OpenAI from "openai";
import type { InsightsStoryPayload } from "@shared/insights/types";
import { buildDeterministicStory } from "./story";
import { loadDriversSummary } from "./drivers";
import { storage } from "../../storage";
import { getAiModel, getChatCompletionTokenLimit } from "../../config/ai-models";

export async function generateAiInsightsStory(): Promise<InsightsStoryPayload | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const people = await storage.getTrendingPeople();
  const driverMix = await loadDriversSummary(20);
  const topMovers = [...people]
    .filter((p) => (p.change7d ?? 0) > 0)
    .sort((a, b) => (b.change7d ?? 0) - (a.change7d ?? 0))
    .slice(0, 5)
    .map((p) => ({ name: p.name, change7d: p.change7d, rank: p.rank }));

  const fallback = await buildDeterministicStory();

  try {
    const openai = new OpenAI({ apiKey });
    const model = getAiModel("whyTrending");
    const response = await openai.chat.completions.create({
      model,
      ...getChatCompletionTokenLimit(model, 200),
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You write a short daily influence digest. Use ONLY facts from the JSON input. Two sentences max in the body. No speculation.",
        },
        {
          role: "user",
          content: JSON.stringify({
            topMovers,
            driverMix: driverMix.segments,
            fallbackHeadline: fallback.headline,
          }),
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) return null;

    const lines = text.split("\n").filter(Boolean);
    const headline = lines[0]?.replace(/^#+\s*/, "").slice(0, 120) || fallback.headline;
    const body = lines.slice(1).join(" ").slice(0, 500) || fallback.body;

    const now = new Date();
    const refreshesAt = new Date(now);
    refreshesAt.setUTCHours(6, 0, 0, 0);
    if (refreshesAt <= now) refreshesAt.setUTCDate(refreshesAt.getUTCDate() + 1);

    return {
      headline,
      body,
      generatedAt: now.toISOString(),
      refreshesAt: refreshesAt.toISOString(),
      mode: "ai",
    };
  } catch (err) {
    console.error("[insights-story-ai]", err);
    return null;
  }
}
