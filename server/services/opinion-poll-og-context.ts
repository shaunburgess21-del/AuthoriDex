import { asc, count, eq } from "drizzle-orm";
import { db } from "../db";
import {
  opinionPollOptions,
  opinionPollVotes,
  opinionPolls,
  trackedPeople,
  trendingPeople,
} from "@shared/schema";
import {
  resolveOpinionOptionDisplayImageUrl,
  resolveOpinionPollImageUrl,
} from "./opinion-poll-images";

export { opinionPollOgDescription } from "./opinion-poll-og-meta";

export const OPINION_POLL_OG_MAX_DISPLAY_OPTIONS = 5;

export interface OpinionPollOgOption {
  name: string;
  orderIndex: number;
  imageUrl: string | null;
  votes: number;
  percent: number;
}

export interface OpinionPollOgContext {
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  category: string;
  imageUrl: string | null;
  totalVotes: number;
  displayOptions: OpinionPollOgOption[];
  overflowCount: number;
  visibleCountries: string[];
}

export async function loadOpinionPollOgContext(
  rawSlug: string,
): Promise<OpinionPollOgContext | null> {
  const slug = decodeURIComponent(rawSlug).trim();
  if (!slug) return null;

  const [poll] = await db
    .select({
      id: opinionPolls.id,
      title: opinionPolls.title,
      summary: opinionPolls.summary,
      description: opinionPolls.description,
      imageUrl: opinionPolls.imageUrl,
      category: opinionPolls.category,
      pollSlug: opinionPolls.slug,
      visibleCountries: opinionPolls.visibleCountries,
    })
    .from(opinionPolls)
    .where(eq(opinionPolls.slug, slug))
    .limit(1);

  if (!poll) return null;

  const [optionRows, voteCounts] = await Promise.all([
    db
      .select({
        id: opinionPollOptions.id,
        name: opinionPollOptions.name,
        orderIndex: opinionPollOptions.orderIndex,
        imageUrl: opinionPollOptions.imageUrl,
        seedCount: opinionPollOptions.seedCount,
        personAvatar: trendingPeople.avatar,
      })
      .from(opinionPollOptions)
      .leftJoin(trackedPeople, eq(opinionPollOptions.personId, trackedPeople.id))
      .leftJoin(trendingPeople, eq(opinionPollOptions.personId, trendingPeople.id))
      .where(eq(opinionPollOptions.pollId, poll.id))
      .orderBy(asc(opinionPollOptions.orderIndex)),
    db
      .select({
        optionId: opinionPollVotes.optionId,
        cnt: count(),
      })
      .from(opinionPollVotes)
      .where(eq(opinionPollVotes.pollId, poll.id))
      .groupBy(opinionPollVotes.optionId),
  ]);

  const effectiveSlug = poll.pollSlug || slug;
  const voteCountByOptionId = new Map(
    voteCounts.map((v) => [v.optionId, Number(v.cnt)]),
  );

  const enriched = optionRows.map((o) => {
    const realVotes = voteCountByOptionId.get(o.id) || 0;
    const displayVotes = realVotes + (o.seedCount || 0);
    return {
      name: o.name,
      orderIndex: o.orderIndex,
      imageUrl: resolveOpinionOptionDisplayImageUrl(
        o.personAvatar,
        o.imageUrl,
        effectiveSlug,
        o.name,
      ),
      votes: displayVotes,
      orderIndexSort: o.orderIndex,
    };
  });

  const totalVotes = enriched.reduce((sum, o) => sum + o.votes, 0);

  const withPercent = enriched.map((o) => ({
    name: o.name,
    orderIndex: o.orderIndex,
    imageUrl: o.imageUrl,
    votes: o.votes,
    percent:
      totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0,
  }));

  const sorted =
    totalVotes > 0
      ? [...withPercent].sort((a, b) => b.votes - a.votes || a.orderIndex - b.orderIndex)
      : withPercent;

  const overflowCount = Math.max(
    0,
    sorted.length - OPINION_POLL_OG_MAX_DISPLAY_OPTIONS,
  );

  return {
    slug: effectiveSlug,
    title: poll.title,
    summary: poll.summary,
    description: poll.description,
    category: poll.category,
    imageUrl: resolveOpinionPollImageUrl(poll.imageUrl, effectiveSlug),
    totalVotes,
    displayOptions: sorted.slice(0, OPINION_POLL_OG_MAX_DISPLAY_OPTIONS),
    overflowCount,
    visibleCountries: poll.visibleCountries ?? [],
  };
}
