/**
 * Vote feeds whose JSON depends on the viewer's country (residence, or the
 * IP-country fallback). These must not sit in a shared cache: a ZA response
 * served to a US visitor would either leak a country card or hide one.
 *
 * Detail reads are intentionally absent. A shared link returns the same card
 * to every country, so those responses do not vary by the geo headers.
 */

const COUNTRY_SCOPED_VOTE_FEEDS = new Set([
  "/api/matchups",
  "/api/trending-polls",
  "/api/opinion-polls",
  "/api/vote/starter-mix",
  "/api/insights/vote/top",
  "/api/me/favorites/dashboard",
]);

export function isCountryScopedVoteFeed(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return COUNTRY_SCOPED_VOTE_FEEDS.has(path);
}

/** Direct card-by-slug reads. Country targeting must not 404 these. */
export function isDirectVoteCardRead(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (/^\/api\/matchups\/by-slug\/[^/]+$/.test(path)) return true;
  if (/^\/api\/polls\/[^/]+$/.test(path)) return true;
  if (/^\/api\/opinion-polls\/[^/]+$/.test(path)) return true;
  return false;
}

export const COUNTRY_SCOPED_FEED_VARY =
  "x-vercel-ip-country, x-voxdex-country, cf-ipcountry, Authorization, Cookie";

export interface VoteDiscoveryViewer {
  country: string | null;
  bypass: boolean;
}

/** Discover-cache key for Insights top voted. Staff, each country, and global-only stay apart. */
export function voteDiscoveryCacheKey(viewer: VoteDiscoveryViewer): string {
  if (viewer.bypass) return "vote:top:staff";
  return `vote:top:${viewer.country ?? "global"}`;
}
