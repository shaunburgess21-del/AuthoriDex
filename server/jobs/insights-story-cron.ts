import type { InsightsStoryPayload } from "@shared/insights/types";
import {
  buildDeterministicStory,
  isInsightsAiStoryEnabled,
  nextBriefingRefreshIso,
  STORY_AI_KEY,
  STORY_DETERMINISTIC_KEY,
} from "../services/insights/story";
import { generateAiInsightsStory } from "../services/insights/story-ai";
import {
  getInsightsCache,
  setInsightsCache,
  INSIGHTS_STORY_TTL_MS,
} from "../services/insights/cache";
import { getCachedTrendingPeople } from "../services/insights/insights-people-cache";
import { selectHotMovers } from "../services/trending/hot-movers";

export interface InsightsStoryCronResult {
  mode: "deterministic" | "ai" | "skipped";
  headline: string;
  durationMs: number;
}

/** Marker key recording the scheduled slot a hard-refresh has already used. */
const HARD_REFRESH_SLOT_KEY = "insights_story:hardRefreshSlot";

export interface InsightsStoryHardRefreshResult {
  refreshed: boolean;
  reason:
    | "no-cached-story"
    | "no-top-gainer"
    | "top-gainer-present"
    | "already-hard-refreshed-this-slot"
    | "refreshed";
  mode?: InsightsStoryCronResult["mode"];
  headline?: string;
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

/** Read the currently-active cached story without generating a new one. */
async function readCachedStory(): Promise<InsightsStoryPayload | null> {
  if (isInsightsAiStoryEnabled()) {
    const ai = await getInsightsCache<InsightsStoryPayload>(STORY_AI_KEY);
    if (ai?.mode === "ai") return ai;
  }
  const det = await getInsightsCache<InsightsStoryPayload>(STORY_DETERMINISTIC_KEY);
  return det ?? null;
}

/**
 * Between scheduled briefing slots, hard-refresh the story if a brand-new top
 * gainer has emerged that the current briefing never mentions (the headline-vs-
 * body drift case). Rate-limited to at most once per scheduled slot so a busy
 * leaderboard can't trigger repeated OpenAI calls.
 *
 * Intended to run from the hourly cache cron (and the serverless cache refresh
 * endpoint), alongside the other warm tasks.
 */
export async function maybeHardRefreshInsightsStory(): Promise<InsightsStoryHardRefreshResult> {
  const story = await readCachedStory();
  if (!story) return { refreshed: false, reason: "no-cached-story" };

  const people = await getCachedTrendingPeople();
  const topGainer = selectHotMovers(people)[0];
  if (!topGainer) return { refreshed: false, reason: "no-top-gainer" };

  // If the live #1 gainer is already named in the briefing, there's no drift —
  // a mere reorder doesn't justify burning a regeneration.
  if ((story.people ?? []).some((p) => p.id === topGainer.id)) {
    return { refreshed: false, reason: "top-gainer-present" };
  }

  // Rate-limit: one hard-refresh per scheduled slot. nextBriefingRefreshIso is
  // constant within a slot window, so it doubles as the slot identity.
  const currentSlot = nextBriefingRefreshIso(new Date());
  const lastSlot = await getInsightsCache<string>(HARD_REFRESH_SLOT_KEY);
  if (lastSlot === currentSlot) {
    return { refreshed: false, reason: "already-hard-refreshed-this-slot" };
  }

  const result = await runInsightsStoryCronRefresh();
  await setInsightsCache(
    HARD_REFRESH_SLOT_KEY,
    "insights_story",
    currentSlot,
    INSIGHTS_STORY_TTL_MS,
  );
  return { refreshed: true, reason: "refreshed", mode: result.mode, headline: result.headline };
}
