import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { opinionPollOptions, opinionPolls } from "@shared/schema";
import { resolveOpinionPollImageUrl } from "./opinion-poll-images";

export { opinionPollOgDescription } from "./opinion-poll-og-meta";

export const OPINION_POLL_OG_MAX_DISPLAY_OPTIONS = 5;

export interface OpinionPollOgOption {
  name: string;
  orderIndex: number;
}

export interface OpinionPollOgContext {
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  category: string;
  imageUrl: string | null;
  displayOptions: OpinionPollOgOption[];
  overflowCount: number;
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
    })
    .from(opinionPolls)
    .where(eq(opinionPolls.slug, slug))
    .limit(1);

  if (!poll) return null;

  const options = await db
    .select({
      name: opinionPollOptions.name,
      orderIndex: opinionPollOptions.orderIndex,
    })
    .from(opinionPollOptions)
    .where(eq(opinionPollOptions.pollId, poll.id))
    .orderBy(asc(opinionPollOptions.orderIndex));

  const effectiveSlug = poll.pollSlug || slug;
  const imageUrl = resolveOpinionPollImageUrl(poll.imageUrl, effectiveSlug);
  const overflowCount = Math.max(
    0,
    options.length - OPINION_POLL_OG_MAX_DISPLAY_OPTIONS,
  );

  return {
    slug: effectiveSlug,
    title: poll.title,
    summary: poll.summary,
    description: poll.description,
    category: poll.category,
    imageUrl,
    displayOptions: options.slice(0, OPINION_POLL_OG_MAX_DISPLAY_OPTIONS),
    overflowCount,
  };
}
