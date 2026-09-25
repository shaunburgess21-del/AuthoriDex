/**
 * Cadence vs TTL lookup plan for paid news providers (Currents / Mediastack).
 *
 * Refresh ticks used to reuse any still-valid row and then bump
 * `last_fetch_at`. Rows whose TTL started earlier in the previous batch
 * then expire mid-cycle while cadence thinks the roster is fresh — the
 * union silently drops those people (Trump 75 → 16, score sawtooth).
 *
 * Plan:
 *   cache-only → valid row, else expired row (stale fill), else empty
 *   refresh    → live fetch; on failure, expired/valid row as fallback
 */

export type NewsCacheAction = "use_valid" | "use_stale" | "live_fetch" | "empty";

export function planNewsCacheRead(opts: {
  cacheOnly: boolean;
  hasValidCache: boolean;
  hasExpiredCache: boolean;
}): NewsCacheAction {
  if (opts.cacheOnly) {
    if (opts.hasValidCache) return "use_valid";
    if (opts.hasExpiredCache) return "use_stale";
    return "empty";
  }
  return "live_fetch";
}

export function planNewsCacheAfterLiveFail(opts: {
  hasValidCache: boolean;
  hasExpiredCache: boolean;
}): NewsCacheAction {
  if (opts.hasValidCache) return "use_valid";
  if (opts.hasExpiredCache) return "use_stale";
  return "empty";
}
