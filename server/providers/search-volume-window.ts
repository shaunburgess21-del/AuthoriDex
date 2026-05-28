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
 * Per-person search-volume reading. `volume` is the trailing-12-month average
 * monthly searches (Google Ads `search_volume`) — the stable headline + score
 * input. `momDeltaPct` is the most recent completed month vs the prior month,
 * derived from the same response's `monthly_searches` series (0 when unknown).
 */
export interface SearchVolumeDatum {
  volume: number;
  momDeltaPct: number;
}

/**
 * Month-over-month % change from a DataForSEO `monthly_searches` array (latest
 * completed month vs the prior one). Returns 0 when there aren't two usable
 * months or the prior month is zero. Note: Google Ads volumes are quantised
 * into tiers, so real moves tend to be chunky (~±20%) — callers should apply a
 * dead zone before display.
 */
export function computeMoMDeltaPct(
  monthlySearches: Array<{ year?: number; month?: number; search_volume?: number | null }> | null | undefined,
): number {
  if (!Array.isArray(monthlySearches)) return 0;
  const usable = monthlySearches
    .filter(
      (m) =>
        m != null &&
        typeof m.year === "number" &&
        typeof m.month === "number" &&
        typeof m.search_volume === "number" &&
        Number.isFinite(m.search_volume),
    )
    .sort((a, b) => (b.year! - a.year!) || (b.month! - a.month!));
  if (usable.length < 2) return 0;
  const latest = usable[0].search_volume as number;
  const prev = usable[1].search_volume as number;
  if (!(prev > 0)) return 0;
  return ((latest - prev) / prev) * 100;
}

/**
 * Parse a `search_volume/live` response into personId → monthly search volume.
 * Tolerant of nulls/missing fields; unknown keywords are ignored. Exported for
 * unit testing against fixture payloads.
 */
export function parseSearchVolumeResponse(
  json: any,
  keywordToPersonId: Map<string, string>,
): Map<string, SearchVolumeDatum> {
  const out = new Map<string, SearchVolumeDatum>();
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
      const volume = typeof sv === "number" && Number.isFinite(sv) && sv > 0 ? sv : 0;
      const momDeltaPct = computeMoMDeltaPct(item?.monthly_searches);
      // Keep the higher-volume datum if two inputs collapse to one keyword.
      const existing = out.get(personId);
      if (!existing || volume > existing.volume) {
        out.set(personId, { volume, momDeltaPct });
      }
    }
  }
  return out;
}
