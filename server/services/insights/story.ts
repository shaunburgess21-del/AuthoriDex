import type { InsightsStoryPayload } from "@shared/insights/types";
import type { TrendingPerson } from "@shared/schema";
import { getMarketCategoryLabel } from "@shared/constants";
import { getCachedTrendingPeople } from "./insights-people-cache";
import {
  getInsightsCache,
  setInsightsCache,
  INSIGHTS_STORY_TTL_MS,
} from "./cache";
import { getCachedWhyTrending, fetchWhyTrendingForPerson } from "../why-trending";
import {
  HOT_MOVERS_RANK_MAX,
  selectHotMovers,
} from "../trending/hot-movers";
import {
  BRIEFING_TOP_GAINERS,
  buildDeterministicHeadline,
  buildDeterministicParagraphs,
  nextBriefingRefreshIso,
  type BriefingInputs,
  type BriefingPersonInput,
} from "./story-briefing";

export {
  BRIEFING_TOP_GAINERS,
  buildDeterministicHeadline,
  buildDeterministicParagraphs,
  nextBriefingRefreshIso,
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
  options: { allowPrefetch: boolean },
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
  } else if (options.allowPrefetch) {
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
    change24h: person.change24h!,
    category,
    whyTrending,
    topHeadline,
  };
}

/**
 * @param allowPrefetch When true (cron only), cold top-3 gainers may trigger a
 *   bounded why-trending generation (<=3 OpenAI calls). MUST stay false on the
 *   request path so a user's overview never blocks on / pays for OpenAI.
 */
export async function buildBriefingInputs(
  { allowPrefetch = false }: { allowPrefetch?: boolean } = {},
): Promise<BriefingInputs> {
  const people = await getCachedTrendingPeople();
  const hotMovers = selectHotMovers(people);
  const topGainerCandidates = hotMovers.slice(0, BRIEFING_TOP_GAINERS);

  const topGainers: BriefingPersonInput[] = [];
  for (const person of topGainerCandidates) {
    topGainers.push(
      await enrichPersonForBriefing(person, { allowPrefetch }),
    );
  }

  const dropCandidates = people.filter(
    (p) =>
      (p.rank ?? 999) <= HOT_MOVERS_RANK_MAX &&
      typeof p.change24h === "number" &&
      Number.isFinite(p.change24h) &&
      p.change24h < 0,
  );
  const dropPerson = [...dropCandidates].sort(
    (a, b) => (a.change24h ?? 0) - (b.change24h ?? 0),
  )[0];

  let notableDropper: BriefingPersonInput | null = null;
  if (dropPerson) {
    notableDropper = await enrichPersonForBriefing(dropPerson, {
      allowPrefetch: false,
    });
  }

  const peopleLinks = [
    ...topGainers.map((g) => ({ id: g.id, name: g.name })),
    ...(notableDropper
      ? [{ id: notableDropper.id, name: notableDropper.name }]
      : []),
  ];

  return { topGainers, notableDropper, people: peopleLinks };
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
      return aiCached;
    }
    // Never call OpenAI on overview requests — cron is the only writer for AI.
  }

  const detCached = await getInsightsCache<InsightsStoryPayload>(STORY_DETERMINISTIC_KEY);
  if (detCached) return detCached;

  // Request path: no prefetch — never block a user's overview on OpenAI.
  // Cron warms the cache (and may prefetch cold movers) via runInsightsStoryCronRefresh.
  const story = await buildDeterministicStory();
  await setInsightsCache(
    STORY_DETERMINISTIC_KEY,
    "insights_story",
    story,
    INSIGHTS_STORY_TTL_MS,
  );
  return story;
}
