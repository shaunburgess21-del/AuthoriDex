// ============================================================================
// DataForSEO Google Ads Search Volume Provider (May 2026)
// ============================================================================
// Returns ABSOLUTE average monthly Google searches for a person's name — a
// cross-person-comparable popularity signal (unlike Google Trends, which is
// self-normalised 0-100 per query). Used as a MASS sub-signal blended into the
// wiki/attention slot in the trend score (see scoring/trendScore.ts).
//
// Why Google Ads search volume and not Trends: Trends only ever told us "this
// person vs their own recent peak". Google Ads keyword volume tells us "X gets
// ~2.2M searches/mo, Y gets ~90k/mo" on one shared absolute scale — which is
// what a fame/mass signal needs.
//
// Cadence: search volume is a MONTHLY metric (Google Ads updates mid-month), so
// a daily refresh is overkill-but-cheap and a once-per-day gate is plenty. One
// request carries up to 1000 keywords for a flat $0.05, so the entire roster is
// a single call. Between fetches, ingest carries the last value forward.
//
// Auth: HTTP Basic with the login/password pair from
// https://app.dataforseo.com/api-access (env: DATAFORSEO_LOGIN / _PASSWORD).
// Inert (returns empty) when credentials are unset, so the feature ships dark.

import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  toApiKeyword,
  isInvalidKeywordTaskError,
  parseSearchVolumeResponse,
  type SearchVolumeDatum,
} from "./search-volume-window";

export {
  SEARCH_VOLUME_FETCH_INTERVAL_MS,
  shouldFetchSearchVolume,
  normalizeKeyword,
  sanitizeKeyword,
  toApiKeyword,
  parseSearchVolumeResponse,
  computeMoMDeltaPct,
  buildSearchVolumeHistory,
  type SearchVolumeDatum,
  type SearchVolumeHistoryPoint,
} from "./search-volume-window";

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
// Location for search volume. Defaults to United States (most complete Google
// Ads data); override to e.g. "United Kingdom" or omit-for-worldwide via env.
const DATAFORSEO_LOCATION = process.env.DATAFORSEO_LOCATION?.trim() || "United States";

const LIVE_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";
const REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_KEYWORDS_PER_TASK = 1000;
// DB cache TTL — must stay below the ingest fetch gate so a same-day re-run
// reuses the cached batch instead of re-billing.
const CACHE_TTL_MS = 20 * 60 * 60 * 1000;

export function isDataForSeoConfigured(): boolean {
  return !!(DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD);
}

export interface SearchVolumeInput {
  personId: string;
  name: string;
  /** Optional per-person keyword override (reuses the existing disambiguation field). */
  keywordOverride?: string | null;
}

// ---------------------------------------------------------------------------
// Run stats
// ---------------------------------------------------------------------------

let _callsAttempted = 0;
let _retryCount = 0;
let _timeoutCount = 0;
let _finalFailures = 0;
let _totalCostUsd = 0;

export function getDataForSeoRunStats() {
  return {
    callsAttempted: _callsAttempted,
    retriesUsed: _retryCount,
    timeoutCount: _timeoutCount,
    finalFailures: _finalFailures,
    totalCostUsd: Math.round(_totalCostUsd * 10000) / 10000,
  };
}
export function resetDataForSeoRunStats() {
  _callsAttempted = 0;
  _retryCount = 0;
  _timeoutCount = 0;
  _finalFailures = 0;
  _totalCostUsd = 0;
}

// ---------------------------------------------------------------------------
// DB cache helpers (shared api_cache table)
// ---------------------------------------------------------------------------

async function getCached(cacheKey: string): Promise<any | null> {
  try {
    const rows = await db
      .select()
      .from(apiCache)
      .where(eq(apiCache.cacheKey, cacheKey))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expiresAt) < new Date()) return null;
    return JSON.parse(row.responseData);
  } catch {
    return null;
  }
}

async function setCache(cacheKey: string, data: any): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    await db
      .insert(apiCache)
      .values({
        cacheKey,
        provider: "dataforseo",
        personId: null,
        responseData: JSON.stringify(data),
        fetchedAt: now,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: apiCache.cacheKey,
        set: {
          responseData: JSON.stringify(data),
          fetchedAt: now,
          expiresAt,
          provider: "dataforseo",
        },
      });
  } catch (e) {
    console.warn(`[DataForSEO] Cache write failed for ${cacheKey}:`, (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Internal fetch with retry
// ---------------------------------------------------------------------------

function authHeader(): string {
  const cred = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString("base64");
  return `Basic ${cred}`;
}

/**
 * Fetch volumes for a keyword chunk, isolating any keyword that triggers a
 * task-level "invalid characters" error (40501) by recursively halving the
 * chunk. Sanitisation should prevent this, but the split keeps one bad keyword
 * from zeroing the whole roster (the original parentheses bug).
 */
async function collectVolumes(
  keywords: string[],
  keywordToPersonId: Map<string, string>,
): Promise<Map<string, SearchVolumeDatum>> {
  if (keywords.length === 0) return new Map();
  const json = await dfsFetch(keywords);
  if (!json) return new Map();

  const task = json?.tasks?.[0];
  if (task && task.status_code !== 20000) {
    console.warn(`[DataForSEO] task error ${task.status_code}: ${task.status_message}`);
    if (isInvalidKeywordTaskError(task) && keywords.length > 1) {
      const mid = Math.floor(keywords.length / 2);
      const left = await collectVolumes(keywords.slice(0, mid), keywordToPersonId);
      const right = await collectVolumes(keywords.slice(mid), keywordToPersonId);
      for (const [k, v] of right) left.set(k, v);
      return left;
    }
    if (keywords.length === 1) {
      console.warn(`[DataForSEO] skipping unprocessable keyword: "${keywords[0]}"`);
    }
    return new Map();
  }

  return parseSearchVolumeResponse(json, keywordToPersonId);
}

async function dfsFetch(keywords: string[]): Promise<any | null> {
  _callsAttempted++;
  const body = JSON.stringify([
    {
      location_name: DATAFORSEO_LOCATION,
      language_code: "en",
      keywords,
    },
  ]);

  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(LIVE_URL, {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const json = await res.json();
        if (typeof json?.cost === "number") _totalCostUsd += json.cost;
        // status_code 20000 = OK; anything else is an API-level error.
        if (json?.status_code && json.status_code !== 20000) {
          console.error(`[DataForSEO] API error ${json.status_code}: ${json.status_message ?? "(no message)"}`);
          _finalFailures++;
          return null;
        }
        return json;
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        _retryCount++;
        const backoff = 2000 + Math.random() * 1000;
        console.warn(`[DataForSEO] HTTP ${res.status} on attempt ${attempt}, retrying in ${Math.round(backoff)}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      console.error(`[DataForSEO] HTTP ${res.status}: ${await res.text().catch(() => "(no body)")}`);
      _finalFailures++;
      return null;
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === "AbortError";
      if (isTimeout) _timeoutCount++;
      console.warn(`[DataForSEO] ${isTimeout ? "Timeout" : "Network error"} on attempt ${attempt}:`, err?.message ?? err);
      if (attempt < MAX_ATTEMPTS) {
        _retryCount++;
        continue;
      }
      _finalFailures++;
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// fetchSearchVolumeBatch — whole-roster monthly search volume
// ---------------------------------------------------------------------------

/**
 * Fetch absolute average monthly Google search volume for each person. Returns
 * personId → { volume, momDeltaPct } (people with no/zero data are simply
 * absent). Batches into ≤1000-keyword requests (each a flat $0.05). A
 * successful merged batch is cached for ~20h so a same-day re-run doesn't
 * re-bill.
 */
export async function fetchSearchVolumeBatch(
  people: SearchVolumeInput[],
): Promise<Map<string, SearchVolumeDatum>> {
  if (!isDataForSeoConfigured()) {
    console.warn("[DataForSEO] DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set — skipping search volume fetch");
    return new Map();
  }
  if (people.length === 0) return new Map();

  // Build keyword → personId map (dedupe keywords; first writer wins). Keywords
  // are sanitised + normalised to the exact form the API echoes back, so the
  // response can be matched to personIds.
  const keywordToPersonId = new Map<string, string>();
  for (const p of people) {
    const kwRaw = (p.keywordOverride && p.keywordOverride.trim()) || p.name;
    const kw = toApiKeyword(kwRaw);
    if (!kw) continue;
    if (!keywordToPersonId.has(kw)) keywordToPersonId.set(kw, p.personId);
  }
  const keywords = Array.from(keywordToPersonId.keys());

  // Cache key bumped on each stored-shape change (sv3 adds `history`). Old-shape
  // entries live under prior keys and simply expire unused.
  const dayKey = new Date().toISOString().slice(0, 10);
  const cacheKey = `dataforseo:sv3:${DATAFORSEO_LOCATION}:${dayKey}:${keywords.length}`;
  const cached = await getCached(cacheKey);
  if (cached && typeof cached === "object") {
    const out = new Map<string, SearchVolumeDatum>();
    for (const [pid, datum] of Object.entries(cached as Record<string, any>)) {
      if (datum && typeof datum.volume === "number" && Number.isFinite(datum.volume)) {
        out.set(pid, {
          volume: datum.volume,
          momDeltaPct: Number(datum.momDeltaPct ?? 0),
          history: Array.isArray(datum.history) ? datum.history : [],
        });
      }
    }
    if (out.size > 0) return out;
  }

  const merged = new Map<string, SearchVolumeDatum>();
  for (let i = 0; i < keywords.length; i += MAX_KEYWORDS_PER_TASK) {
    const chunk = keywords.slice(i, i + MAX_KEYWORDS_PER_TASK);
    const parsed = await collectVolumes(chunk, keywordToPersonId);
    for (const [pid, datum] of parsed) merged.set(pid, datum);
  }

  if (merged.size > 0) {
    await setCache(cacheKey, Object.fromEntries(merged));
  }
  return merged;
}
