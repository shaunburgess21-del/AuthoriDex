// In-process single-flight + TTL memo for Insights hot loaders.
// Collapses parallel page-load bursts (rankings + overview + discover/*)
// into one DB round-trip per key per TTL window.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/** Insights ingest is hourly; 60s is plenty fresh for read-heavy aggregates. */
export const INSIGHTS_REQUEST_MEMO_TTL_MS = 60_000;

/**
 * Run `loader` at most once per `key` while in flight; reuse cached value until TTL expires.
 */
export async function memoizeAsync<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = (async () => {
    try {
      const value = await loader();
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

const inFlightOnly = new Map<string, Promise<unknown>>();

/**
 * Dedupe concurrent in-flight calls for `key` WITHOUT caching the resolved
 * value (unlike `memoizeAsync`). Use when value caching is handled elsewhere
 * (e.g. the DB-backed insights cache) but you still want to collapse a
 * cold-cache stampede into a single compute.
 */
export async function singleFlight<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const pending = inFlightOnly.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    try {
      return await fn();
    } finally {
      inFlightOnly.delete(key);
    }
  })();

  inFlightOnly.set(key, promise);
  return promise;
}

/** Test helper — clear one key or the entire memo. */
export function clearRequestMemo(key?: string): void {
  if (key) {
    cache.delete(key);
    inFlight.delete(key);
    inFlightOnly.delete(key);
  } else {
    cache.clear();
    inFlight.clear();
    inFlightOnly.clear();
  }
}
