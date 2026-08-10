// Signed-in Vote hub ordering: the user's interests first, most-voted
// first inside each bucket.
//
// This runs after the SQL query rather than inside it because vote
// totals aren't columns — each list route assembles them in JS from the
// seed counts on the row plus the aggregated rows from the vote table.
// Same shape as the open-markets volume sort: a post-query pass that is
// skipped for cold-start users so their admin-curated order survives.

import { getCategoryBucketId } from "@shared/constants";

/**
 * Stable sort placing cards whose primary or secondary category matches
 * one of the user's preferred categories ahead of everything else, then
 * most votes first within each bucket.
 *
 * Category comparison goes through `getCategoryBucketId` so aliased
 * spellings (`Food & Drink` / `food-drink`, `media-and-podcast` / `media`)
 * share a bucket — same contract as `matchesCategoryFilter` on the Vote hub.
 *
 * Ties keep the order the SQL query produced (Array#sort is stable), so
 * the personalised recency expression and the `display_order` tiebreak
 * still decide equal-vote cards.
 *
 * `preferred` is null or empty for cold-start users (anonymous, or
 * signed in with no stated interests and no behavioural signal) — the
 * list is returned untouched so the manual order stays intact.
 *
 * Preferred ids should already be bucketed via `getCategoryBucketId`
 * (see `resolvePreferredCategoriesForUser`).
 */
export function sortByInterestThenVotes<T>(
  items: T[],
  preferred: ReadonlySet<string> | null,
  getPrimaryCategory: (item: T) => string | null | undefined,
  getVotes: (item: T) => number,
  getSecondaryCategories?: (item: T) => readonly string[] | null | undefined,
): T[] {
  if (!preferred || preferred.size === 0) return items;

  const matchesInterest = (item: T): boolean => {
    if (preferred.has(getCategoryBucketId(getPrimaryCategory(item)))) return true;
    const secondary = getSecondaryCategories?.(item);
    if (!secondary || secondary.length === 0) return false;
    return secondary.some((s) => preferred.has(getCategoryBucketId(s)));
  };

  return [...items].sort((a, b) => {
    const aInterest = matchesInterest(a);
    const bInterest = matchesInterest(b);
    if (aInterest !== bInterest) return aInterest ? -1 : 1;

    const aVotes = Number(getVotes(a)) || 0;
    const bVotes = Number(getVotes(b)) || 0;
    return bVotes - aVotes;
  });
}
