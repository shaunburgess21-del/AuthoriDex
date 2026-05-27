import type { InsightsStoryPayload } from "@shared/insights/types";
import { storage } from "../../storage";
import { loadDriversSummary } from "./drivers";
import {
  getInsightsCache,
  setInsightsCache,
  INSIGHTS_AGGREGATE_TTL_MS,
  INSIGHTS_STORY_TTL_MS,
} from "./cache";
import { generateAiInsightsStory } from "./story-ai";

const DETERMINISTIC_STORY_KEY = "insights_story:daily";

export function isInsightsAiStoryEnabled(): boolean {
  const raw = process.env.INSIGHTS_AI_STORY_ENABLED?.toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export async function buildDeterministicStory(): Promise<InsightsStoryPayload> {
  const people = await storage.getTrendingPeople();
  const driverMix = await loadDriversSummary(20);

  const topMover = [...people]
    .filter((p) => (p.change7d ?? 0) !== 0)
    .sort((a, b) => Math.abs(b.change7d ?? 0) - Math.abs(a.change7d ?? 0))[0];

  const topDriver = driverMix.segments[0];
  const categoryCounts = new Map<string, number>();
  const top20 = [...people].sort((a, b) => a.rank - b.rank).slice(0, 20);
  for (const p of top20) {
    const cat = p.category ?? "Other";
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }
  const leadingCategory = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const now = new Date();
  const refreshesAt = new Date(now);
  refreshesAt.setUTCHours(6, 0, 0, 0);
  if (refreshesAt <= now) {
    refreshesAt.setUTCDate(refreshesAt.getUTCDate() + 1);
  }

  const moverLine = topMover
    ? `Top mover this week: ${topMover.name} (${topMover.change7d! > 0 ? "+" : ""}${(topMover.change7d ?? 0).toFixed(1)}% over 7d).`
    : "The board is steady this week with no standout movers.";

  const driverLine = topDriver
    ? `${topDriver.driver.replace("_", " ")} led ${topDriver.pct}% of the top 20.`
    : "Signals are mixed across the top 20.";

  const categoryLine = leadingCategory
    ? `${leadingCategory[0]} accounts for ${Math.round((leadingCategory[1] / 20) * 100)}% of the top 20.`
    : "";

  return {
    headline: topMover ? `${topMover.name} leads the movers board` : "Today's influence snapshot",
    body: [moverLine, driverLine, categoryLine].filter(Boolean).join(" "),
    generatedAt: now.toISOString(),
    refreshesAt: refreshesAt.toISOString(),
    mode: "deterministic",
  };
}

export async function getInsightsStory(): Promise<InsightsStoryPayload> {
  if (isInsightsAiStoryEnabled()) {
    const cached = await getInsightsCache<InsightsStoryPayload>(DETERMINISTIC_STORY_KEY);
    if (cached?.mode === "ai") {
      return cached;
    }
    const ai = await generateAiInsightsStory();
    if (ai) {
      await setInsightsCache(DETERMINISTIC_STORY_KEY, "insights_story", ai, INSIGHTS_STORY_TTL_MS);
      return ai;
    }
  }

  const cached = await getInsightsCache<InsightsStoryPayload>(`${DETERMINISTIC_STORY_KEY}:deterministic`);
  if (cached) return cached;

  const story = await buildDeterministicStory();
  await setInsightsCache(
    `${DETERMINISTIC_STORY_KEY}:deterministic`,
    "insights_story",
    story,
    INSIGHTS_AGGREGATE_TTL_MS,
  );
  return story;
}
