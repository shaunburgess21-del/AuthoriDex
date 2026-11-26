/**
 * Process-local TTL cache for GET /api/og/document-meta.
 *
 * The payload is the public share card (title, description, canonical,
 * image, JSON-LD). It does not vary by viewer, cookie, or country.
 * Read-only: a hit skips the database, and nothing is written back.
 */

import type { OgDocumentMeta } from "@shared/og-document";

export interface OgDocumentMetaCacheEntry {
  meta: OgDocumentMeta;
  cacheControl: string;
}

interface Stored {
  entry: OgDocumentMetaCacheEntry;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 500;
const store = new Map<string, Stored>();
const inflight = new Map<string, Promise<OgDocumentMetaCacheEntry | null>>();

let maxEntries = DEFAULT_MAX_ENTRIES;

export const OG_DOCUMENT_META_TTL_MS = 120_000;
export const OG_DOCUMENT_META_WARN_TTL_MS = 60_000;

export function documentMetaCachePolicy(warningCount: number): {
  cacheControl: string;
  ttlMs: number;
} {
  if (warningCount > 0) {
    return { cacheControl: "public, max-age=60", ttlMs: OG_DOCUMENT_META_WARN_TTL_MS };
  }
  return { cacheControl: "public, max-age=120", ttlMs: OG_DOCUMENT_META_TTL_MS };
}

export function readOgDocumentMetaCache(
  key: string,
  now = Date.now(),
): OgDocumentMetaCacheEntry | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    store.delete(key);
    return undefined;
  }
  return hit.entry;
}

export function writeOgDocumentMetaCache(
  key: string,
  entry: OgDocumentMetaCacheEntry,
  ttlMs: number,
  now = Date.now(),
): void {
  if (ttlMs <= 0 || !entry.meta?.title || !entry.meta.canonicalUrl) return;
  if (store.has(key)) store.delete(key);
  while (store.size >= maxEntries) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  store.set(key, { entry, expiresAt: now + ttlMs });
}

export function clearOgDocumentMetaCache(): void {
  store.clear();
  inflight.clear();
  maxEntries = DEFAULT_MAX_ENTRIES;
}

/** Test hook. Production uses the default cap. */
export function setOgDocumentMetaCacheLimit(limit: number): void {
  maxEntries = limit;
}

/**
 * Return a cached card or run `load` once. Concurrent callers share that
 * load. A thrown load is not stored.
 */
export async function readOrLoadOgDocumentMeta(
  key: string,
  load: () => Promise<{ entry: OgDocumentMetaCacheEntry; ttlMs: number } | null>,
  now = Date.now(),
): Promise<{ entry: OgDocumentMetaCacheEntry; cache: "hit" | "miss" } | null> {
  const hit = readOgDocumentMetaCache(key, now);
  if (hit) return { entry: hit, cache: "hit" };

  const existing = inflight.get(key);
  if (existing) {
    const entry = await existing;
    return entry ? { entry, cache: "hit" } : null;
  }

  let resolvePending!: (value: OgDocumentMetaCacheEntry | null) => void;
  let rejectPending!: (err: unknown) => void;
  const pending = new Promise<OgDocumentMetaCacheEntry | null>((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
  });
  inflight.set(key, pending);
  // The owner awaits `load`, not `pending`. Swallow an unhandled rejection
  // when nobody else is joined; joiners still observe the rejection.
  pending.catch(() => undefined);

  try {
    const loaded = await load();
    if (!loaded) {
      resolvePending(null);
      return null;
    }
    writeOgDocumentMetaCache(key, loaded.entry, loaded.ttlMs, now);
    const stored = readOgDocumentMetaCache(key, now) ?? loaded.entry;
    resolvePending(stored);
    return { entry: stored, cache: "miss" };
  } catch (err) {
    rejectPending(err);
    throw err;
  } finally {
    if (inflight.get(key) === pending) inflight.delete(key);
  }
}
