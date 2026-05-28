// Pure DataForSEO search-volume helpers (no DB / API / env-throwing deps).
// Kept separate from dataforseo.ts so unit tests can import the pure logic
// without pulling in the db module (which throws when DATABASE_URL is unset).

/**
 * Ingest cadence gate. Search volume is a monthly figure; refreshing once per
 * day keeps the score current without spending on redundant calls.
 */
export const SEARCH_VOLUME_FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Whether ingest should call DataForSEO this cycle. `lastFetchAt` is the latest
 * real fetch time (persisted as `raw.googleSearchVolumeFetchedAt`), not a
 * carry-forward snapshot time.
 */
export function shouldFetchSearchVolume(
  lastFetchAt: Date | null,
  nowMs = Date.now(),
  intervalMs = SEARCH_VOLUME_FETCH_INTERVAL_MS,
): boolean {
  if (lastFetchAt == null) return true;
  const lastMs = lastFetchAt.getTime();
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalMs;
}

/**
 * DataForSEO lowercases keywords and collapses whitespace. Normalise the same
 * way on both the request-side map and the response-side lookup so keyword →
 * personId matching is robust.
 */
export function normalizeKeyword(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Strip characters Google Ads rejects in keywords (error 40501) — e.g.
 * parentheses/brackets in "Lisa (Blackpink)". Keeps unicode letters (incl.
 * accents — folding "rosé"→"rose" changes meaning: 33k vs 1M searches),
 * digits, spaces, and safe punctuation (- ' . &). Disallowed chars become
 * spaces, then whitespace is collapsed.
 */
export function sanitizeKeyword(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}\s\-'.&]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical keyword form actually sent to / matched from the API. */
export function toApiKeyword(s: string): string {
  return normalizeKeyword(sanitizeKeyword(s));
}

/** DataForSEO task-level "invalid keyword characters" error code. */
export function isInvalidKeywordTaskError(task: any): boolean {
  return task?.status_code === 40501;
}

/**
 * Parse a `search_volume/live` response into personId → monthly search volume.
 * Tolerant of nulls/missing fields; unknown keywords are ignored. Exported for
 * unit testing against fixture payloads.
 */
export function parseSearchVolumeResponse(
  json: any,
  keywordToPersonId: Map<string, string>,
): Map<string, number> {
  const out = new Map<string, number>();
  const tasks = json?.tasks;
  if (!Array.isArray(tasks)) return out;
  for (const task of tasks) {
    const result = task?.result;
    if (!Array.isArray(result)) continue;
    for (const item of result) {
      const kw = item?.keyword;
      if (typeof kw !== "string") continue;
      const personId = keywordToPersonId.get(normalizeKeyword(kw));
      if (!personId) continue;
      const sv = item?.search_volume;
      const vol = typeof sv === "number" && Number.isFinite(sv) && sv > 0 ? sv : 0;
      // Keep the max if two inputs collapse to the same normalised keyword.
      out.set(personId, Math.max(out.get(personId) ?? 0, vol));
    }
  }
  return out;
}
