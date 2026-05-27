import { buildDeterministicStory, isInsightsAiStoryEnabled } from "../services/insights/story";
import { generateAiInsightsStory } from "../services/insights/story-ai";
import { setInsightsCache, INSIGHTS_STORY_TTL_MS } from "../services/insights/cache";

const STORY_CACHE_KEY = "insights_story:daily";

export interface InsightsStoryCronResult {
  mode: "deterministic" | "ai" | "skipped";
  headline: string;
  durationMs: number;
}

export async function runInsightsStoryCronRefresh(): Promise<InsightsStoryCronResult> {
  const start = Date.now();
  let story;

  if (isInsightsAiStoryEnabled()) {
    story = (await generateAiInsightsStory()) ?? (await buildDeterministicStory());
    await setInsightsCache(STORY_CACHE_KEY, "insights_story", story, INSIGHTS_STORY_TTL_MS);
    return {
      mode: story.mode,
      headline: story.headline,
      durationMs: Date.now() - start,
    };
  }

  story = await buildDeterministicStory();
  await setInsightsCache(`${STORY_CACHE_KEY}:deterministic`, "insights_story", story, INSIGHTS_STORY_TTL_MS);

  return {
    mode: "deterministic",
    headline: story.headline,
    durationMs: Date.now() - start,
  };
}
