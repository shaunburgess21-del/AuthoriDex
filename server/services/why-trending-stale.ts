/**
 * Stale-grace helpers for Why Trending summaries.
 * Kept dependency-free so unit tests can import without pulling in db / Serper.
 */

/** Max age (from api_cache.fetchedAt) to keep serving expired Why Trending summaries during provider outages. */
export const WHY_TRENDING_MAX_STALE_HOURS = 24;

/** Prefix for summary rows only (`why_trending:{personId}`). Locks/ratelimits use underscores. */
export const WHY_TRENDING_SUMMARY_CACHE_PREFIX = "why_trending:";

/** True when a cached summary is still within the outage grace window. */
export function isWithinWhyTrendingStaleGrace(
  fetchedAt: Date | string,
  now: Date = new Date(),
): boolean {
  const ageMs = now.getTime() - new Date(fetchedAt).getTime();
  return Number.isFinite(ageMs) && ageMs <= WHY_TRENDING_MAX_STALE_HOURS * 60 * 60 * 1000;
}

/**
 * Summary rows use `why_trending:{personId}`.
 * Lock / ratelimit keys use underscores (`why_trending_lock:`, `why_trending_ratelimit:`)
 * and must NOT match this — retention keeps pruning those on normal expiry.
 */
export function isWhyTrendingSummaryCacheKey(cacheKey: string): boolean {
  return cacheKey.startsWith(WHY_TRENDING_SUMMARY_CACHE_PREFIX);
}
