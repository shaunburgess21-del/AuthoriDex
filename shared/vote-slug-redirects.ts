/**
 * Typo slug → corrected slug for Vote detail URLs.
 *
 * These slugs are stored on the CMS rows. A code redirect keeps old links
 * working; the stored slug still needs a one-time admin edit to the
 * corrected value (do not apply that as a production SQL update from this PR).
 *
 *   Opinion poll title is already "The Most Powerful Person on Earth"
 *     the-most-poweful-person-on-earth → the-most-powerful-person-on-earth
 *   Sentiment headline is already "Superhero fatigue is real"
 *     perhero-fatigue-is-real → superhero-fatigue-is-real
 */

export type VoteSlugRedirect = {
  /** Full client path including the typo slug. */
  fromPath: string;
  /** Full client path with the corrected slug. */
  toPath: string;
  /** Typo slug as stored (or previously stored) in the CMS. */
  fromSlug: string;
  /** Corrected slug to use in URLs after the CMS edit. */
  toSlug: string;
};

export const VOTE_SLUG_REDIRECTS: readonly VoteSlugRedirect[] = [
  {
    fromPath: "/vote/opinion-polls/the-most-poweful-person-on-earth",
    toPath: "/vote/opinion-polls/the-most-powerful-person-on-earth",
    fromSlug: "the-most-poweful-person-on-earth",
    toSlug: "the-most-powerful-person-on-earth",
  },
  {
    fromPath: "/polls/perhero-fatigue-is-real",
    toPath: "/polls/superhero-fatigue-is-real",
    fromSlug: "perhero-fatigue-is-real",
    toSlug: "superhero-fatigue-is-real",
  },
] as const;

const SLUG_TO_CANONICAL: Readonly<Record<string, string>> = Object.fromEntries(
  VOTE_SLUG_REDIRECTS.map((row) => [row.fromSlug, row.toSlug]),
);

export function canonicalVoteSlug(slug: string): string {
  return SLUG_TO_CANONICAL[slug] ?? slug;
}

/**
 * Values to use in a slug lookup so both the typo and the corrected slug
 * resolve the same row (until the CMS slug is edited, and after).
 */
export function voteSlugLookupValues(slug: string): string[] {
  const trimmed = slug.trim();
  if (!trimmed) return [];
  const canonical = canonicalVoteSlug(trimmed);
  const aliases = VOTE_SLUG_REDIRECTS
    .filter((row) => row.toSlug === canonical || row.fromSlug === trimmed)
    .flatMap((row) => [row.fromSlug, row.toSlug]);
  return [...new Set([trimmed, canonical, ...aliases])];
}
