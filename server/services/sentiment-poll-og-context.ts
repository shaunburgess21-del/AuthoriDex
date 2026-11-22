import { eq } from "drizzle-orm";
import { sentimentPollIdFallback } from "@shared/lib/sentiment-poll-vote-target";
import { db } from "../db";
import { trackedPeople, trendingPolls } from "@shared/schema";
import {
  resolveSentimentPollImageUrl,
  slugifySentimentPollHeadline,
} from "./sentiment-poll-images";
import { loadSentimentPollResults, type VoicesSentimentResults } from "./sentiment-poll-results";

export { sentimentPollOgDescription } from "./sentiment-poll-og-meta";

export interface SentimentPollOgContext {
  slug: string;
  headline: string;
  subjectText: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  visibleCountries: string[];
  /** Present only once at least one vote (including seeds) exists. */
  results?: VoicesSentimentResults | null;
}

export async function loadSentimentPollOgContext(
  rawSlug: string,
): Promise<SentimentPollOgContext | null> {
  const slug = decodeURIComponent(rawSlug).trim();
  if (!slug) return null;

  const columns = {
    id: trendingPolls.id,
    headline: trendingPolls.headline,
    subjectText: trendingPolls.subjectText,
    description: trendingPolls.description,
    imageUrl: trendingPolls.imageUrl,
    category: trendingPolls.category,
    pollSlug: trendingPolls.slug,
    visibleCountries: trendingPolls.visibleCountries,
    personAvatar: trackedPeople.avatar,
  };
  let [row] = await db
    .select(columns)
    .from(trendingPolls)
    .leftJoin(trackedPeople, eq(trendingPolls.personId, trackedPeople.id))
    .where(eq(trendingPolls.slug, slug))
    .limit(1);
  const idFallback = sentimentPollIdFallback(slug);
  if (!row && idFallback) {
    [row] = await db
      .select(columns)
      .from(trendingPolls)
      .leftJoin(trackedPeople, eq(trendingPolls.personId, trackedPeople.id))
      .where(eq(trendingPolls.id, idFallback))
      .limit(1);
  }

  if (!row) return null;

  const resultsMap = await loadSentimentPollResults([row.id]);
  const loaded = resultsMap.get(row.id);
  const hasResults =
    !!loaded &&
    loaded.agreePercent + loaded.neutralPercent + loaded.disagreePercent > 0;

  const storedSlug = row.pollSlug?.trim() || "";
  // Image files follow the headline slug. The public URL must stay on a key
  // that actually resolves (the stored slug, or the id when slug is blank).
  const effectiveSlug = storedSlug || slugifySentimentPollHeadline(row.headline);
  const publicSlug = storedSlug || slug;
  let imageUrl = resolveSentimentPollImageUrl(row.imageUrl, effectiveSlug);
  if (!imageUrl && row.personAvatar) {
    imageUrl = row.personAvatar;
  }

  return {
    slug: publicSlug,
    headline: row.headline,
    subjectText: row.subjectText,
    description: row.description,
    category: row.category,
    imageUrl,
    visibleCountries: row.visibleCountries ?? [],
    results: hasResults ? loaded : null,
  };
}
