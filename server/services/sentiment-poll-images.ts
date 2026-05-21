/** Resolve sentiment poll hero image URLs (same rules as GET /api/polls/:slug). */

export function slugifySentimentPollHeadline(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isConventionImageUrl(url: string | null): boolean {
  return url != null && url.includes("/sentiment-polls/") && url.endsWith("/1.webp");
}

export function sentimentPollConventionImageUrl(slug: string): string | null {
  if (!process.env.SUPABASE_URL) return null;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/sentiment-polls/${slug}/1.webp`;
}

export function resolveSentimentPollImageUrl(
  stored: string | null,
  effectiveSlug: string,
): string | null {
  const derived = sentimentPollConventionImageUrl(effectiveSlug);
  if (!stored) return derived;
  if (isConventionImageUrl(stored)) {
    try {
      if (
        !new URL(stored).pathname.includes(
          `/sentiment-polls/${effectiveSlug}/`,
        )
      ) {
        return derived;
      }
    } catch {
      /* keep stored */
    }
  }
  return stored;
}
