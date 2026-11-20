/**
 * GETs whose JSON includes the caller's own ballot. These must not be
 * stored in a shared or heuristic HTTP cache: a later account on the
 * same browser would otherwise replay the previous viewer's `userVote`.
 */
export function isPersonalizedVoteGet(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (path === "/api/trending-polls") return true;
  if (path.startsWith("/api/polls/")) return true;
  if (path === "/api/opinion-polls" || path.startsWith("/api/opinion-polls/")) return true;
  if (path === "/api/vote/overall-ratings") return true;
  if (path === "/api/me/induction-votes") return true;
  if (path === "/api/matchups/user-votes") return true;
  if (path === "/api/me/curate-voted-person-ids") return true;
  if (/^\/api\/celebrity\/[^/]+\/approval-rating$/.test(path)) return true;
  return false;
}
