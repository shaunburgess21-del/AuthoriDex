import { inArray, asc } from "drizzle-orm";
import { db } from "../../db";
import {
  matchups,
  trendingPolls,
  opinionPolls,
  opinionPollOptions,
  predictionMarkets,
  trackedPeople,
  cardRelatedPeople,
} from "@shared/schema";
import type { VoicesSurface } from "@shared/constants";
import { resolveMatchupOptionDisplay } from "../matchup-option-images";
import {
  resolveSentimentPollImageUrl,
  slugifySentimentPollHeadline,
} from "../sentiment-poll-images";
import { resolveOpinionPollImageUrl, pickVoicesOpinionPollImages } from "../opinion-poll-images";
import {
  loadPersonProfileStats,
  type VoicesProfileStats,
} from "../person-profile-stats";
import {
  loadSentimentPollResults,
  type VoicesSentimentResults,
} from "../sentiment-poll-results";
import {
  loadOpinionPollPreview,
  type VoicesOpinionPreview,
} from "../opinion-poll-preview";
import {
  loadWorldMarketPreview,
  type VoicesWorldMarketPreview,
} from "../world-market-preview";

/**
 * The card / profile / timeline an aggregated Voices item is attached to.
 * Drives the feed "context chip", deep links, and the celebrity/category
 * filters. Mirrors `resolveUnifiedCommentHref` in server/routes.ts.
 */
export interface VoicesEntity {
  surface: VoicesSurface;
  refType: "matchup" | "trending_poll" | "opinion_poll" | "open_market" | "person" | "timeline";
  refId: string;
  title: string;
  /** Short type label, e.g. "Matchup", "Sentiment Poll". */
  subtitle: string | null;
  /** Client-side deep link to the source card / profile (no hash). */
  href: string;
  /** Card slug for card surfaces (null for person/timeline) — feeds the focus overlay. */
  slug: string | null;
  imageUrl: string | null;
  /** Secondary image when the primary hero fails to load (e.g. first opinion option). */
  fallbackImageUrl: string | null;
  category: string | null;
  /** Linked tracked_people ids (for the celebrity filter). */
  personIds: string[];
  /** Leaderboard stats for profile link cards (person entities only). */
  profileStats?: VoicesProfileStats | null;
  /** Vote distribution for sentiment poll link cards (trending_poll only). */
  sentimentResults?: VoicesSentimentResults | null;
  /** Top leading options for opinion poll link cards (opinion_poll only). */
  opinionPreview?: VoicesOpinionPreview | null;
  /** Live LMSR outcome split for world market link cards (open_market only). */
  worldMarketPreview?: VoicesWorldMarketPreview | null;
  /** Present for matchups only — drives the A/B split preview banner. */
  media?: {
    optionAImage: string | null;
    optionAText: string;
    optionBImage: string | null;
    optionBText: string;
  } | null;
}

function isHttpImageUrl(url: string | null | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url.trim());
}

/** Parent type stored on a unified comment row. */
export type CardParentType = "matchup" | "trending_poll" | "opinion_poll" | "open_market";

const SUBTITLE: Record<VoicesEntity["refType"], string | null> = {
  matchup: "Matchup",
  trending_poll: "Sentiment Poll",
  opinion_poll: "Opinion Poll",
  open_market: "World Market",
  person: "Profile",
  timeline: null,
};

const SURFACE_BY_REF: Record<VoicesEntity["refType"], VoicesSurface> = {
  matchup: "matchup",
  trending_poll: "sentiment_poll",
  opinion_poll: "opinion_poll",
  open_market: "world_market",
  person: "profile",
  timeline: "timeline",
};

/**
 * card_related_people.cardType values keyed by comment parent type. NOTE: open
 * (community/world) markets are stored as "world_market" there — distinct from
 * the "open_market" comment parent type. Mirrors getRelatedPeopleForCards in
 * server/routes.ts.
 */
const CARD_TYPE_BY_PARENT: Record<CardParentType, string> = {
  matchup: "matchup",
  trending_poll: "sentiment_poll",
  opinion_poll: "opinion_poll",
  open_market: "world_market",
};

export function entityKey(parentType: string, parentId: string): string {
  return `${parentType}:${parentId}`;
}

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

/**
 * Batch-resolve linked people (from card_related_people) for a set of cards.
 * Returns a map keyed by `${cardType}:${cardId}` → personId[].
 */
async function loadRelatedPeople(
  pairs: Array<{ parentType: CardParentType; id: string }>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (pairs.length === 0) return out;

  const idsByCardType = new Map<string, Set<string>>();
  for (const p of pairs) {
    const cardType = CARD_TYPE_BY_PARENT[p.parentType];
    if (!idsByCardType.has(cardType)) idsByCardType.set(cardType, new Set());
    idsByCardType.get(cardType)!.add(p.id);
  }

  for (const [cardType, idSet] of idsByCardType) {
    const rows = await db
      .select({
        cardType: cardRelatedPeople.cardType,
        cardId: cardRelatedPeople.cardId,
        personId: cardRelatedPeople.personId,
      })
      .from(cardRelatedPeople)
      .where(
        inArray(cardRelatedPeople.cardId, Array.from(idSet)),
      );
    for (const r of rows) {
      if (r.cardType !== cardType) continue;
      const key = `${r.cardType}:${r.cardId}`;
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(r.personId);
    }
  }
  return out;
}

/**
 * Resolve display metadata for every distinct (parentType, parentId) referenced
 * by a batch of feed candidates. Reuses the same href shapes as
 * `resolveUnifiedCommentHref` so deep links stay canonical.
 */
export async function resolveCommentEntities(
  parents: Array<{ parentType: string; parentId: string }>,
): Promise<Map<string, VoicesEntity>> {
  const result = new Map<string, VoicesEntity>();

  const matchupIds = new Set<string>();
  const trendingPollIds = new Set<string>();
  const opinionPollIds = new Set<string>();
  const openMarketIds = new Set<string>();
  // After the community_insights → comments merge, parent_id on a
  // community_insight comment IS the personId — collect them for a batched
  // tracked_people lookup.
  const personIds = new Set<string>();

  for (const p of parents) {
    if (p.parentType === "matchup") matchupIds.add(p.parentId);
    else if (p.parentType === "trending_poll") trendingPollIds.add(p.parentId);
    else if (p.parentType === "opinion_poll") opinionPollIds.add(p.parentId);
    else if (p.parentType === "open_market") openMarketIds.add(p.parentId);
    else if (p.parentType === "community_insight") personIds.add(p.parentId);
    else if (p.parentType === "voices_post") {
      result.set(entityKey(p.parentType, p.parentId), {
        surface: "timeline",
        refType: "timeline",
        refId: p.parentId,
        title: "Timeline",
        subtitle: null,
        href: "/voices",
        slug: null,
        imageUrl: null,
        fallbackImageUrl: null,
        category: null,
        personIds: [],
      });
    }
  }

  const relatedPairs: Array<{ parentType: CardParentType; id: string }> = [
    ...Array.from(matchupIds).map((id) => ({ parentType: "matchup" as const, id })),
    ...Array.from(trendingPollIds).map((id) => ({ parentType: "trending_poll" as const, id })),
    ...Array.from(opinionPollIds).map((id) => ({ parentType: "opinion_poll" as const, id })),
    ...Array.from(openMarketIds).map((id) => ({ parentType: "open_market" as const, id })),
  ];
  const relatedPeople = await loadRelatedPeople(relatedPairs);

  if (matchupIds.size > 0) {
    const rows = await db
      .select({
        id: matchups.id,
        slug: matchups.slug,
        title: matchups.title,
        category: matchups.category,
        optionAText: matchups.optionAText,
        optionAImage: matchups.optionAImage,
        optionBText: matchups.optionBText,
        optionBImage: matchups.optionBImage,
        personAId: matchups.personAId,
        personBId: matchups.personBId,
      })
      .from(matchups)
      .where(inArray(matchups.id, Array.from(matchupIds)));

    // Resolve option images the same way the public matchups API does
    // (DB URL > linked celebrity avatar > name avatar > bucket convention)
    // so the feed preview banner matches VersusCard imagery.
    const linkedPeople = await loadPeople(
      uniq(rows.flatMap((r) => [r.personAId, r.personBId])),
    );
    const avatarById: Record<string, string | null> = {};
    const avatarByName: Record<string, string | null> = {};
    for (const [id, p] of linkedPeople) {
      avatarById[id] = p.avatar;
      avatarByName[p.name.toLowerCase()] = p.avatar;
    }

    for (const r of rows) {
      const key = entityKey("matchup", r.id);
      const optA = resolveMatchupOptionDisplay(
        r.optionAImage,
        r.personAId,
        r.optionAText,
        r.optionAText,
        r.optionBText,
        avatarById,
        avatarByName,
        r.slug,
      );
      const optB = resolveMatchupOptionDisplay(
        r.optionBImage,
        r.personBId,
        r.optionBText,
        r.optionAText,
        r.optionBText,
        avatarById,
        avatarByName,
        r.slug,
      );
      result.set(key, {
        surface: SURFACE_BY_REF.matchup,
        refType: "matchup",
        refId: r.id,
        title: r.title,
        subtitle: SUBTITLE.matchup,
        href: r.slug ? `/vote/matchups/${r.slug}` : "/vote",
        slug: r.slug ?? null,
        imageUrl: r.optionAImage ?? r.optionBImage ?? null,
        fallbackImageUrl: null,
        category: r.category ?? null,
        personIds: uniq([r.personAId, r.personBId, ...(relatedPeople.get(`matchup:${r.id}`) ?? [])]),
        media: {
          optionAImage: optA.resolved,
          optionAText: r.optionAText,
          optionBImage: optB.resolved,
          optionBText: r.optionBText,
        },
      });
    }
  }

  if (trendingPollIds.size > 0) {
    const ids = Array.from(trendingPollIds);
    const rows = await db
      .select({
        id: trendingPolls.id,
        slug: trendingPolls.slug,
        headline: trendingPolls.headline,
        subjectText: trendingPolls.subjectText,
        category: trendingPolls.category,
        imageUrl: trendingPolls.imageUrl,
        personId: trendingPolls.personId,
      })
      .from(trendingPolls)
      .where(inArray(trendingPolls.id, ids));
    const sentimentResultsByPoll = await loadSentimentPollResults(ids);
    for (const r of rows) {
      const key = entityKey("trending_poll", r.id);
      // Same convention-based resolution as GET /api/polls/:slug so polls
      // without a stored image still get their bucket hero image.
      const effectiveSlug = r.slug || slugifySentimentPollHeadline(r.headline || r.subjectText || "");
      result.set(key, {
        surface: SURFACE_BY_REF.trending_poll,
        refType: "trending_poll",
        refId: r.id,
        title: r.headline || r.subjectText || "Sentiment Poll",
        subtitle: SUBTITLE.trending_poll,
        href: r.slug ? `/polls/${r.slug}` : "/vote",
        slug: r.slug ?? null,
        imageUrl: effectiveSlug
          ? resolveSentimentPollImageUrl(r.imageUrl ?? null, effectiveSlug)
          : r.imageUrl ?? null,
        fallbackImageUrl: null,
        category: r.category ?? null,
        personIds: uniq([r.personId, ...(relatedPeople.get(`sentiment_poll:${r.id}`) ?? [])]),
        sentimentResults: sentimentResultsByPoll.get(r.id) ?? null,
      });
    }
  }

  if (opinionPollIds.size > 0) {
    const ids = Array.from(opinionPollIds);
    const rows = await db
      .select({
        id: opinionPolls.id,
        slug: opinionPolls.slug,
        title: opinionPolls.title,
        category: opinionPolls.category,
        imageUrl: opinionPolls.imageUrl,
      })
      .from(opinionPolls)
      .where(inArray(opinionPolls.id, ids));

    const opinionPreviewByPoll = await loadOpinionPollPreview(ids);

    // Prefer a reachable thumbnail: when convention hero `1.webp` is missing,
    // use the first option image (same recovery as the detail page header).
    const optionRows = await db
      .select({
        pollId: opinionPollOptions.pollId,
        imageUrl: opinionPollOptions.imageUrl,
        orderIndex: opinionPollOptions.orderIndex,
      })
      .from(opinionPollOptions)
      .where(inArray(opinionPollOptions.pollId, ids))
      .orderBy(asc(opinionPollOptions.orderIndex));

    const firstOptionImageByPoll = new Map<string, string>();
    for (const opt of optionRows) {
      if (firstOptionImageByPoll.has(opt.pollId)) continue;
      const url = opt.imageUrl?.trim() ?? null;
      if (isHttpImageUrl(url)) firstOptionImageByPoll.set(opt.pollId, url);
    }

    const pickedByPollId = new Map<
      string,
      { imageUrl: string | null; fallbackImageUrl: string | null }
    >();
    await Promise.all(
      rows.map(async (r) => {
        const hero = resolveOpinionPollImageUrl(r.imageUrl ?? null, r.slug);
        const option = firstOptionImageByPoll.get(r.id) ?? null;
        pickedByPollId.set(r.id, await pickVoicesOpinionPollImages(hero, option));
      }),
    );

    for (const r of rows) {
      const key = entityKey("opinion_poll", r.id);
      const picked = pickedByPollId.get(r.id) ?? {
        imageUrl: null,
        fallbackImageUrl: null,
      };
      result.set(key, {
        surface: SURFACE_BY_REF.opinion_poll,
        refType: "opinion_poll",
        refId: r.id,
        title: r.title,
        subtitle: SUBTITLE.opinion_poll,
        href: r.slug ? `/vote/opinion-polls/${r.slug}` : "/vote",
        slug: r.slug ?? null,
        imageUrl: picked.imageUrl,
        fallbackImageUrl: picked.fallbackImageUrl,
        category: r.category ?? null,
        personIds: uniq(relatedPeople.get(`opinion_poll:${r.id}`) ?? []),
        opinionPreview: opinionPreviewByPoll.get(r.id) ?? null,
      });
    }
  }

  if (openMarketIds.size > 0) {
    const ids = Array.from(openMarketIds);
    const rows = await db
      .select({
        id: predictionMarkets.id,
        slug: predictionMarkets.slug,
        title: predictionMarkets.title,
        category: predictionMarkets.category,
        coverImageUrl: predictionMarkets.coverImageUrl,
        personId: predictionMarkets.personId,
      })
      .from(predictionMarkets)
      .where(inArray(predictionMarkets.id, ids));

    const worldMarketPreviewByMarket = await loadWorldMarketPreview(ids);

    for (const r of rows) {
      const key = entityKey("open_market", r.id);
      result.set(key, {
        surface: SURFACE_BY_REF.open_market,
        refType: "open_market",
        refId: r.id,
        title: r.title,
        subtitle: SUBTITLE.open_market,
        href: r.slug ? `/markets/${r.slug}` : "/predict",
        slug: r.slug ?? null,
        imageUrl: r.coverImageUrl ?? null,
        fallbackImageUrl: null,
        category: r.category ?? null,
        personIds: uniq([r.personId, ...(relatedPeople.get(`world_market:${r.id}`) ?? [])]),
        worldMarketPreview: worldMarketPreviewByMarket.get(r.id) ?? null,
      });
    }
  }

  // community_insight comments: parent_id is the personId. Build person entities
  // directly (mirrors the old resolveInsightEntities shape, but keyed by
  // (parentType, parentId) so it merges seamlessly with the card entities above).
  if (personIds.size > 0) {
    const ids = Array.from(personIds);
    const people = await loadPeople(ids);
    const profileStatsByPerson = await loadPersonProfileStats(ids);
    for (const personId of personIds) {
      const key = entityKey("community_insight", personId);
      const person = people.get(personId);
      result.set(key, {
        surface: SURFACE_BY_REF.person,
        refType: "person",
        refId: personId,
        title: person?.name ?? "Profile",
        subtitle: SUBTITLE.person,
        href: `/person/${personId}`,
        slug: null,
        imageUrl: person?.avatar ?? null,
        fallbackImageUrl: null,
        category: person?.category ?? null,
        personIds: [personId],
        profileStats: profileStatsByPerson.get(personId) ?? null,
      });
    }
  }

  // Backfill card avatars from the primary person when the card has no image.
  await hydratePersonImages(result);

  return result;
}

// ── resolveInsightEntities REMOVED ──────────────────────────────────────
// After the community_insights → comments merge, person entities for
// community_insight comments are built inline by resolveCommentEntities
// above (using parent_id as the personId). The old resolveInsightEntities
// helper that took insightIds is no longer called anywhere; the merge made
// it redundant since the personId is now directly on the comment row.

async function loadPeople(
  personIds: string[],
): Promise<Map<string, { name: string; avatar: string | null; category: string | null }>> {
  const out = new Map<string, { name: string; avatar: string | null; category: string | null }>();
  if (personIds.length === 0) return out;
  const rows = await db
    .select({
      id: trackedPeople.id,
      name: trackedPeople.name,
      avatar: trackedPeople.avatar,
      category: trackedPeople.category,
    })
    .from(trackedPeople)
    .where(inArray(trackedPeople.id, personIds));
  for (const r of rows) {
    out.set(r.id, { name: r.name, avatar: r.avatar ?? null, category: r.category ?? null });
  }
  return out;
}

/**
 * For card entities missing an image, fall back to the primary linked person's
 * avatar. When a hero URL exists but may 404, also set fallbackImageUrl from
 * that avatar so CardImage can recover (same idea as opinion-poll option fallback).
 */
async function hydratePersonImages(entities: Map<string, VoicesEntity>): Promise<void> {
  const needed = new Set<string>();
  for (const e of entities.values()) {
    if (!e.personIds[0]) continue;
    if (!e.imageUrl || !e.fallbackImageUrl) needed.add(e.personIds[0]);
  }
  if (needed.size === 0) return;
  const people = await loadPeople(Array.from(needed));
  for (const e of entities.values()) {
    const avatar = e.personIds[0] ? people.get(e.personIds[0])?.avatar ?? null : null;
    if (!avatar) continue;
    if (!e.imageUrl) {
      e.imageUrl = avatar;
      continue;
    }
    if (!e.fallbackImageUrl && avatar !== e.imageUrl) {
      e.fallbackImageUrl = avatar;
    }
  }
}
