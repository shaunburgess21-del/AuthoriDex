import {
  buildDeterministicStory,
  isInsightsAiStoryEnabled,
  STORY_AI_KEY,
  STORY_DETERMINISTIC_KEY,
} from "../services/insights/story";
import { generateAiInsightsStory } from "../services/insights/story-ai";
import { setInsightsCache, INSIGHTS_STORY_TTL_MS } from "../services/insights/cache";

export interface InsightsStoryCronResult {
  mode: "deterministic" | "ai" | "skipped";
  headline: string;
  durationMs: number;
}

export async function runInsightsStoryCronRefresh(): Promise<InsightsStoryCronResult> {
  const start = Date.now();

  if (isInsightsAiStoryEnabled()) {
    const aiStory = await generateAiInsightsStory();
    if (aiStory) {
      await setInsightsCache(STORY_AI_KEY, "insights_story", aiStory, INSIGHTS_STORY_TTL_MS);
      return {
        mode: "ai",
        headline: aiStory.headline,
        durationMs: Date.now() - start,
      };
    }

    const deterministic = await buildDeterministicStory({ allowPrefetch: true });
    await setInsightsCache(
      STORY_DETERMINISTIC_KEY,
      "insights_story",
      deterministic,
      INSIGHTS_STORY_TTL_MS,
    );
    return {
      mode: "deterministic",
      headline: deterministic.headline,
      durationMs: Date.now() - start,
    };
  }

  const story = await buildDeterministicStory({ allowPrefetch: true });
  await setInsightsCache(STORY_DETERMINISTIC_KEY, "insights_story", story, INSIGHTS_STORY_TTL_MS);

  return {
    mode: "deterministic",
    headline: story.headline,
    durationMs: Date.now() - start,
  };
}
