interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const MAX_ENTRIES = 40;

export function readPublicCache<T>(key: string, now = Date.now()): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function writePublicCache<T>(key: string, value: T, ttlMs: number, now = Date.now()): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: now + ttlMs });
}

export function clearPublicCache(): void {
  cache.clear();
}

/** Fame leaderboard pages are the same for every viewer (no per-user fields). */
export function publicFameLeaderboardCacheKey(query: {
  tab: string;
  sortDir: string;
  category?: string | null;
  search?: string | null;
  limit: number;
  offset: number;
}): string | null {
  if (query.tab !== "fame") return null;
  if (query.search && query.search.trim()) return null;
  const category = (query.category || "all").trim().toLowerCase();
  if (category === "favorites") return null;
  const bucket = category === "all" || category === "trending" ? "all" : category;
  return `lb:fame:${query.sortDir}:${bucket}:${query.limit}:${query.offset}`;
}

export const PUBLIC_FAME_LEADERBOARD_CACHE_MS = 20_000;
export const PUBLIC_FAME_LEADERBOARD_CACHE_CONTROL =
  "public, max-age=15, stale-while-revalidate=45";

export const PUBLIC_PREDICTORS_CACHE_CONTROL =
  "public, max-age=30, stale-while-revalidate=120";
