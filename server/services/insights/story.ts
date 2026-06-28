import type { InsightsStoryPayload } from "@shared/insights/types";
import type { TrendingPerson } from "@shared/schema";
import { getMarketCategoryLabel } from "@shared/constants";
import { getCachedTrendingPeople } from "./insights-people-cache";
import { loadLatestSnapshotsByPerson } from "./snapshot-batch";
import {
  getInsightsCache,
  setInsightsCache,
  INSIGHTS_STORY_TTL_MS,
} from "./cache";
import { getCachedWhyTrending, fetchWhyTrendingForPerson } from "../why-trending";
import { selectHotMovers } from "../trending/hot-movers";
import {
  BRIEFING_ANCHOR_COUNT,
  BRIEFING_MOVER_COUNT,
  BRIEFING_PREFETCH_MAX,
  buildDeterministicHeadline,
  buildDeterministicParagraphs,
  nextBriefingRefreshIso,
  selectBriefingAnchorCandidates,
  type BriefingInputs,
  type BriefingPersonInput,
} from "./story-briefing";

export {
  BRIEFING_ANCHOR_COUNT,
  BRIEFING_MOVER_COUNT,
  BRIEFING_PREFETCH_MAX,
  buildDeterministicHeadline,
  buildDeterministicParagraphs,
  nextBriefingRefreshIso,
  selectBriefingAnchorCandidates,
  selectBriefingMovers,
  type BriefingInputs,
  type BriefingPersonInput,
} from "./story-briefing";

export const STORY_AI_KEY = "insights_story:ai";
export const STORY_DETERMINISTIC_KEY = "insights_story:deterministic";

export function isInsightsAiStoryEnabled(): boolean {
  const raw = process.env.INSIGHTS_AI_STORY_ENABLED?.toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

async function enrichPersonForBriefing(
  person: TrendingPerson,
  options: {
    allowPrefetch: boolean;
    prefetchBudget: { remaining: number };
  },
): Promise<BriefingPersonInput> {
  const category = person.category
    ? getMarketCategoryLabel(person.category)
    : "Other";

  let whyTrending: string | undefined;
  let topHeadline: string | undefined;

  const { payload } = await getCachedWhyTrending(person.id);
  if (payload?.hasContext && payload.summary) {
    whyTrending = payload.summary;
    topHeadline = payload.topHeadline;
  } else if (options.allowPrefetch && options.prefetchBudget.remaining > 0) {
    options.prefetchBudget.remaining -= 1;
    const generated = await fetchWhyTrendingForPerson(person, true);
    if (generated.hasContext && generated.summary) {
      whyTrending = generated.summary;
      topHeadline = generated.topHeadline;
    }
  }

  return {
    id: person.id,
    name: person.name,
    rank: person.rank ?? 999,
    change24h: person.change24h ?? 0,
    category,
    avatar: person.avatar ?? null,
    whyTrending,
    topHeadline,
  };
}

/**
 * @param allowPrefetch When true (cron only), cold picks may trigger bounded
 *   why-trending generation (up to BRIEFING_PREFETCH_MAX OpenAI calls). MUST
 *   stay false on the request path so a user's overview never blocks on / pays
 *   for OpenAI.
 */
export async function buildBriefingInputs(
  { allowPrefetch = false }: { allowPrefetch?: boolean } = {},
): Promise<BriefingInputs> {
  const [people, snapshots] = await Promise.all([
    getCachedTrendingPeople(),
    loadLatestSnapshotsByPerson(),
  ]);

  const newsCountByPersonId = new Map<string, number>(
    [...snapshots.entries()].map(([id, snap]) => [id, snap.newsCount ?? 0]),
  );

  const hotMoverPool = selectHotMovers(people);

  const prefetchBudget = { remaining: allowPrefetch ? BRIEFING_PREFETCH_MAX : 0 };
  const enrichOpts = { allowPrefetch, prefetchBudget };

  // Walk the full hot-mover pool (up to 6) so we can backfill when a top-3
  // pick lacks Why Trending context even after prefetch.
  const movers: BriefingPersonInput[] = [];
  for (const person of hotMoverPool) {
    if (movers.length >= BRIEFING_MOVER_COUNT) break;
    const enriched = await enrichPersonForBriefing(person, enrichOpts);
    if (!enriched.whyTrending) continue;
    movers.push(enriched);
  }

  const moverIds = new Set(movers.map((m) => m.id));
  const anchorCandidates = selectBriefingAnchorCandidates(
    people,
    moverIds,
    newsCountByPersonId,
  );

  const anchors: BriefingPersonInput[] = [];
  for (const person of anchorCandidates) {
    if (anchors.length >= BRIEFING_ANCHOR_COUNT) break;
    const enriched = await enrichPersonForBriefing(person, enrichOpts);
    if (!enriched.whyTrending) continue;
    anchors.push(enriched);
  }

  const peopleLinks: Array<{ id: string; name: string; avatar?: string | null }> = [];
  const seenPeople = new Set<string>();
  for (const pick of [...anchors, ...movers]) {
    if (seenPeople.has(pick.id)) continue;
    seenPeople.add(pick.id);
    peopleLinks.push({ id: pick.id, name: pick.name, avatar: pick.avatar ?? null });
  }

  return { anchors, movers, people: peopleLinks };
}

async function enrichStoryPeopleAvatars(story: InsightsStoryPayload): Promise<InsightsStoryPayload> {
  if (!story.people?.length || story.people.every((p) => p.avatar != null)) {
    return story;
  }

  const peopleList = await getCachedTrendingPeople();
  const avatarById = new Map(peopleList.map((p) => [p.id, p.avatar ?? null]));

  return {
    ...story,
    people: story.people.map((p) => ({
      ...p,
      avatar: p.avatar ?? avatarById.get(p.id) ?? null,
    })),
  };
}

export async function buildDeterministicStory(
  options: { allowPrefetch?: boolean } = {},
): Promise<InsightsStoryPayload> {
  const inputs = await buildBriefingInputs(options);
  const paragraphs = buildDeterministicParagraphs(inputs);
  const now = new Date();

  return {
    headline: buildDeterministicHeadline(inputs),
    body: paragraphs.join(" "),
    paragraphs,
    people: inputs.people,
    generatedAt: now.toISOString(),
    refreshesAt: nextBriefingRefreshIso(now),
    mode: "deterministic",
  };
}

export async function getInsightsStory(): Promise<InsightsStoryPayload> {
  if (isInsightsAiStoryEnabled()) {
    const aiCached = await getInsightsCache<InsightsStoryPayload>(STORY_AI_KEY);
    if (aiCached?.mode === "ai") {
      return enrichStoryPeopleAvatars(aiCached);
    }
    // Never call OpenAI on overview requests — cron is the only writer for AI.
  }

  const detCached = await getInsightsCache<InsightsStoryPayload>(STORY_DETERMINISTIC_KEY);
  if (detCached) return enrichStoryPeopleAvatars(detCached);

  // Request path: no prefetch — never block a user's overview on OpenAI.
  // Cron warms the cache (and may prefetch cold movers) via runInsightsStoryCronRefresh.
  const story = await buildDeterministicStory();
  await setInsightsCache(
    STORY_DETERMINISTIC_KEY,
    "insights_story",
    story,
    INSIGHTS_STORY_TTL_MS,
  );
  return enrichStoryPeopleAvatars(story);
}
