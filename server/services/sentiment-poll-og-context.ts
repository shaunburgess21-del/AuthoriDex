import { eq } from "drizzle-orm";
import { db } from "../db";
import { trackedPeople, trendingPolls } from "@shared/schema";
import {
  resolveSentimentPollImageUrl,
  slugifySentimentPollHeadline,
} from "./sentiment-poll-images";

export { sentimentPollOgDescription } from "./sentiment-poll-og-meta";

export interface SentimentPollOgContext {
  slug: string;
  headline: string;
  subjectText: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  visibleCountries: string[];
}

export async function loadSentimentPollOgContext(
  rawSlug: string,
): Promise<SentimentPollOgContext | null> {
  const slug = decodeURIComponent(rawSlug).trim();
  if (!slug) return null;

  const [row] = await db
    .select({
      headline: trendingPolls.headline,
      subjectText: trendingPolls.subjectText,
      description: trendingPolls.description,
      imageUrl: trendingPolls.imageUrl,
      category: trendingPolls.category,
      pollSlug: trendingPolls.slug,
      visibleCountries: trendingPolls.visibleCountries,
      personAvatar: trackedPeople.avatar,
    })
    .from(trendingPolls)
    .leftJoin(trackedPeople, eq(trendingPolls.personId, trackedPeople.id))
    .where(eq(trendingPolls.slug, slug))
    .limit(1);

  if (!row) return null;

  const effectiveSlug = row.pollSlug || slugifySentimentPollHeadline(row.headline);
  let imageUrl = resolveSentimentPollImageUrl(row.imageUrl, effectiveSlug);
  if (!imageUrl && row.personAvatar) {
    imageUrl = row.personAvatar;
  }

  return {
    slug: effectiveSlug,
    headline: row.headline,
    subjectText: row.subjectText,
    description: row.description,
    category: row.category,
    imageUrl,
    visibleCountries: row.visibleCountries ?? [],
  };
}
