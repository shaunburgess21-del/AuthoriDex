/**
 * Sentiment polls are voted, opened, and discussed by slug. A live card can
 * still be saved with a blank slug (admin create treats slug as optional).
 * Those cards keep their primary key, so callers fall back to the id and the
 * server resolves either key.
 */

export function sentimentPollVoteKey(poll: {
  id?: string | null;
  slug?: string | null;
}): string {
  const slug = typeof poll.slug === "string" ? poll.slug.trim() : "";
  if (slug) return slug;
  return typeof poll.id === "string" ? poll.id.trim() : "";
}

export function sentimentPollVotePath(poll: {
  id?: string | null;
  slug?: string | null;
}): string {
  return `/api/polls/${encodeURIComponent(sentimentPollVoteKey(poll))}/vote`;
}

/** Same shape as `server/utils/matchup-resolve.ts` `isLikelyMatchupUuid`. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Id to try after a slug miss. Null for ordinary headline slugs. */
export function sentimentPollIdFallback(param: string | null | undefined): string | null {
  const key = typeof param === "string" ? param.trim() : "";
  return UUID_RE.test(key) ? key : null;
}

/**
 * Slug stored on a new or edited sentiment poll. A typed slug is kept;
 * a blank one is generated so the card can be opened and voted.
 */
export function slugOrGenerated(slug: unknown, headline: string, now = Date.now()): string {
  const trimmed = typeof slug === "string" ? slug.trim() : "";
  if (trimmed) return trimmed;
  const base = (headline || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const suffix = now.toString(36);
  return base ? `${base}-${suffix}` : `item-${suffix}`;
}
