// ============================================================================
// SerpApi Google Trends Provider (May 2026)
// ============================================================================
// Fetches Google Trends "Interest over time" timeseries via SerpApi's
// google_trends engine. One query per call (no batching) so each person's
// 0-100 score is normalised against THEIR OWN peak, not against the loudest
// person in a shared batch. Uses date=now 1-d (past 24h, ~8-min resolution)
// so the 0-100 scale is rebased against TODAY's peak hour — matching what
// users see on the Google Trends UI "Past 24h" view. Previous versions used
// `now 7-d`, which crushed everyone whose week contained a single viral
// hour (e.g. a cricket match for Kohli) into the low single digits even
// when their current interest was genuinely high. The 7-day baseline is
// reconstructed from snapshot history; the 24h delta uses head/tail slices
// of the same response (see trends-window.ts).
//
// Why per-person and not batched? When you submit q=a,b,c,d,e to Google
// Trends, ALL series are normalised against the single highest point across
// all 5 queries combined. So if Trump is in a batch with Elon, Elon's score
// gets crushed against Trump's biggest day. Per-person fetches eliminate
// this cross-contamination at the cost of 5× more API calls.
//
// Also provides Topic ID autocomplete lookups for entity disambiguation
// (see `fetchTrendsTopicSuggestions`).

import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  computeTrendsWindowMeans,
  type TrendsTimeseriesPoint as TrendsWindowPoint,
} from "./trends-window";

export type { TrendsTimeseriesPoint } from "./trends-window";
export { computeTrendsWindowMeans, trendsWindowSize } from "./trends-window";

const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const SERPAPI_BASE_URL = "https://serpapi.com/search.json";
const REQUEST_TIMEOUT_MS = 25_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
// Cache TTL for the per-person `now 1-d` SerpApi response. MUST stay
// below the ingest job's TRENDS_FETCH_INTERVAL_MS (currently 12h),
// otherwise every other intended fetch silently returns a stale cached
// response and persists the same `latestInterest` across consecutive
// snapshots — which collapses the rolling avg7d and the day-over-day
// delta to "no signal". The cache's purpose is to dedupe near-
// simultaneous re-runs of the ingest job (manual triggers, retries,
// dev work), not to act as a multi-cycle data store.
const TRENDS_DATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Topic ID autocomplete results are essentially static — a celeb's
// Google Trends entity ID doesn't change once minted. Long TTL keeps
// admin "Lookup" clicks free after the first hit, while still allowing
// occasional refresh for new/edge-case entities.
const AUTOCOMPLETE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Google Trends date window. "now 1-d" = past 24 hours at ~8-minute
// resolution (~180 points). Matches the "Past 24 hours" view on the
// Google Trends UI: 100 = the busiest 8-minute slot in the last 24h.
const TRENDS_DATE_WINDOW = "now 1-d";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrendsBatchInput {
  personId: string;
  name: string;
  googleTrendsTopicId?: string | null;
}

export interface TrendsBatchResult {
  personId: string;
  timeseries: TrendsTimeseriesPoint[];
  // Mean of the most recent ~4h slice of the timeseries. With `now 1-d`
  // this is "% of today's peak hour" — directly comparable to the score
  // shown on the Google Trends UI "Past 24h" view.
  latestInterest: number;
  // Mean of the oldest ~4h slice of the SAME timeseries (same 24h window
  // and peak normalisation). Used for the day-over-day delta pill: both
  // ends must share one peak or cross-snapshot comparisons falsely show
  // huge drops after a viral hour rolls out of yesterday's window.
  prevWindowInterest: number;
  // Full-series mean on the same window/peak — baseline for dormant momentum
  // diagnostics (persisted as trendsAvg7d until Option 3 weekly fetch exists).
  avg24hInterest: number;
}

export interface TopicSuggestion {
  topicId: string;
  title: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Run stats (mirrors serper.ts pattern)
// ---------------------------------------------------------------------------

let _callsAttempted = 0;
let _retryCount = 0;
let _timeoutCount = 0;
let _finalFailures = 0;

export function getSerpApiTrendsRunStats() {
  return { callsAttempted: _callsAttempted, retriesUsed: _retryCount, timeoutCount: _timeoutCount, finalFailures: _finalFailures };
}
export function resetSerpApiTrendsRunStats() {
  _callsAttempted = 0;
  _retryCount = 0;
  _timeoutCount = 0;
  _finalFailures = 0;
}

// ---------------------------------------------------------------------------
// Internal fetch with retry
// ---------------------------------------------------------------------------

async function serpApiFetch(params: Record<string, string>): Promise<any | null> {
  if (!SERPAPI_API_KEY) return null;
  _callsAttempted++;

  const url = new URL(SERPAPI_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", SERPAPI_API_KEY);
  url.searchParams.set("output", "json");

  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        return await res.json();
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        _retryCount++;
        const backoff = 2000 + Math.random() * 1000;
        console.warn(`[SerpApi Trends] ${res.status} on attempt ${attempt}, retrying in ${Math.round(backoff)}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      console.error(`[SerpApi Trends] HTTP ${res.status}: ${await res.text().catch(() => "(no body)")}`);
      _finalFailures++;
      return null;
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === "AbortError";
      if (isTimeout) _timeoutCount++;
      console.warn(`[SerpApi Trends] ${isTimeout ? "Timeout" : "Network error"} on attempt ${attempt}:`, err?.message ?? err);
      if (attempt < MAX_ATTEMPTS) { _retryCount++; continue; }
      _finalFailures++;
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// DB cache helpers (api_cache table, same pattern as other providers)
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

async function setCache(
  cacheKey: string,
  data: any,
  personId?: string,
  ttlMs: number = TRENDS_DATA_CACHE_TTL_MS,
): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    await db
      .insert(apiCache)
      .values({
        cacheKey,
        provider: "serpapi_trends",
        personId: personId ?? null,
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
          provider: "serpapi_trends",
        },
      });
  } catch (e) {
    console.warn(`[SerpApi Trends] Cache write failed for ${cacheKey}:`, (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// fetchGoogleTrendsBatch — per-person TIMESERIES fetch (one query per call)
// ---------------------------------------------------------------------------

/**
 * Fetch Google Trends TIMESERIES data for a list of people. Each person is
 * fetched in their own SerpApi call (one query per call) so that the 0-100
 * scaling is normalised per-person rather than against the loudest peak in
 * a shared batch. Returns one result per person with the past-24h
 * timeseries (~180 8-minute points) and a "latest" reading (mean of the
 * most recent ~4h slice, picked for intra-day responsiveness at our 12h
 * cadence).
 *
 * The 0-100 scale is rebased against TODAY's peak hour because we query
 * `now 1-d`. This matches the Google Trends UI "Past 24h" view so a
 * celeb who is genuinely trending right now reads in the 50-100 band
 * regardless of whether they had a bigger spike earlier in the week.
 *
 * People with a `googleTrendsTopicId` use the Topic ID (preferred for
 * disambiguation). Others fall back to name search with a warning.
 *
 * The 24h delta comparator (`prevWindowInterest`) is the mean of the
 * oldest ~4h of this same response (≈24h ago within the window).
 * `avg24hInterest` is the mean of the full series (same peak) for the
 * dormant momentum baseline. True weekly baseline = future Option 3
 * (`now 7-d` once daily) when a Trends Momentum card ships.
 */
export async function fetchGoogleTrendsBatch(
  people: TrendsBatchInput[],
  interCallDelayMs = 250,
): Promise<TrendsBatchResult[]> {
  if (!SERPAPI_API_KEY) {
    console.warn("[SerpApi Trends] SERPAPI_API_KEY not set — skipping Trends fetch");
    return [];
  }
  if (people.length === 0) return [];

  const results: TrendsBatchResult[] = [];

  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const q = p.googleTrendsTopicId || p.name;
    if (!p.googleTrendsTopicId) {
      console.warn(`[SerpApi Trends] No Topic ID for "${p.name}" (${p.personId}) — falling back to name search`);
    }

    const cacheKey = `serpapi_trends:person:${q}:${TRENDS_DATE_WINDOW}`;
    let data = await getCached(cacheKey);

    if (!data) {
      data = await serpApiFetch({
        engine: "google_trends",
        q,
        data_type: "TIMESERIES",
        date: TRENDS_DATE_WINDOW,
        tz: "0",
      });

      if (data) {
        await setCache(cacheKey, data, p.personId);
      }
    }

    if (data?.interest_over_time?.timeline_data) {
      const timeline = data.interest_over_time.timeline_data as Array<{
        date: string;
        timestamp: string;
        values: Array<{ query: string; value: string; extracted_value: number }>;
      }>;

      const series: TrendsWindowPoint[] = [];
      for (const point of timeline) {
        const ts = new Date(parseInt(point.timestamp, 10) * 1000).toISOString();
        // Only one query per call now, so just take the first value entry.
        const v = point.values?.[0];
        if (v) series.push({ date: ts, interest: v.extracted_value ?? 0 });
      }

      if (series.length > 0) {
        const { latestInterest, prevWindowInterest, avg24hInterest } = computeTrendsWindowMeans(series);
        results.push({
          personId: p.personId,
          timeseries: series,
          latestInterest,
          prevWindowInterest,
          avg24hInterest,
        });
      } else {
        results.push({ personId: p.personId, timeseries: [], latestInterest: 0, prevWindowInterest: 0, avg24hInterest: 0 });
      }
    } else if (data) {
      // SerpApi returned success but no timeline — likely below Trends'
      // entity threshold for the queried window.
      results.push({ personId: p.personId, timeseries: [], latestInterest: 0, prevWindowInterest: 0, avg24hInterest: 0 });
    }

    if (i < people.length - 1) {
      await new Promise((r) => setTimeout(r, interCallDelayMs));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// fetchTrendsTopicSuggestions — autocomplete for Topic ID disambiguation
// ---------------------------------------------------------------------------

/**
 * Query SerpApi's Google Trends Autocomplete engine to get entity suggestions
 * for a given person name. Returns Topic IDs (e.g. `/m/0cqt90`) along with
 * their titles and types (e.g. "Person", "Politician", "Company").
 *
 * Used by the admin endpoint and the backfill script.
 */
export async function fetchTrendsTopicSuggestions(
  query: string,
): Promise<TopicSuggestion[]> {
  if (!SERPAPI_API_KEY) {
    console.warn("[SerpApi Trends] SERPAPI_API_KEY not set — cannot lookup Topic IDs");
    return [];
  }

  const cacheKey = `serpapi_trends:autocomplete:${query.toLowerCase().replace(/\s+/g, "_")}`;
  const cached = await getCached(cacheKey);
  if (cached && Array.isArray(cached)) return cached;

  const data = await serpApiFetch({
    engine: "google_trends_autocomplete",
    q: query,
    hl: "en",
  });

  if (!data?.suggestions || !Array.isArray(data.suggestions)) return [];

  const suggestions: TopicSuggestion[] = data.suggestions
    .filter((s: any) => s.q && s.q.startsWith("/"))
    .map((s: any) => ({
      topicId: s.q,
      title: s.title ?? query,
      type: s.type ?? "Unknown",
    }));

  if (suggestions.length > 0) {
    await setCache(cacheKey, suggestions, undefined, AUTOCOMPLETE_CACHE_TTL_MS);
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Utility: check if Trends data is available
// ---------------------------------------------------------------------------

export function isSerpApiTrendsConfigured(): boolean {
  return !!SERPAPI_API_KEY;
}
