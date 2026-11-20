import type { VoicesSurface } from "@shared/constants";
import type { VoicesFeedItem, VoicesFeedMode } from "./ranking";

interface CachedFeed {
  items: VoicesFeedItem[];
  expires: number;
}

const FEED_CACHE = new Map<string, CachedFeed>();
const FEED_CACHE_TTL_MS = 60_000;
const FEED_CACHE_MAX_ENTRIES = 200;

export function voicesFeedCacheSignature(opts: {
  mode: VoicesFeedMode;
  surfaces: VoicesSurface[] | null;
  personIds: string[] | null;
  categories: string[] | null;
  userId: string | null;
}): string {
  return JSON.stringify({
    m: opts.mode,
    s: opts.surfaces ? [...opts.surfaces].sort() : null,
    p: opts.personIds ? [...opts.personIds].sort() : null,
    c: opts.categories ? [...opts.categories].sort() : null,
    u: opts.userId ?? null,
  });
}

export function readVoicesFeedCache(sig: string, now = Date.now()): VoicesFeedItem[] | null {
  const cached = FEED_CACHE.get(sig);
  if (!cached || cached.expires <= now) {
    if (cached) FEED_CACHE.delete(sig);
    return null;
  }
  return cached.items;
}

export function writeVoicesFeedCache(sig: string, items: VoicesFeedItem[], now = Date.now()): void {
  if (FEED_CACHE.size >= FEED_CACHE_MAX_ENTRIES && !FEED_CACHE.has(sig)) {
    const sorted = [...FEED_CACHE.entries()].sort((a, b) => a[1].expires - b[1].expires);
    for (let i = 0; i < Math.ceil(FEED_CACHE_MAX_ENTRIES / 4); i++) {
      const entry = sorted[i];
      if (entry) FEED_CACHE.delete(entry[0]);
    }
  }
  FEED_CACHE.set(sig, { items, expires: now + FEED_CACHE_TTL_MS });
}

/** Drop every cached page so a post just written shows up on the next read. */
export function invalidateVoicesFeedCache(): void {
  FEED_CACHE.clear();
}

export function voicesFeedCacheSize(): number {
  return FEED_CACHE.size;
}
