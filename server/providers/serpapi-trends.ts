// ============================================================================
// SerpApi Google Trends Provider (May 2026)
// ============================================================================
// Fetches Google Trends "Interest over time" timeseries via SerpApi's
// google_trends engine. One query per call (no batching) so each person's
// 0-100 score is normalised against THEIR OWN peak, not against the loudest
// person in a shared batch. Uses date=now 7-d for hourly resolution over the
// past 7 days — this is what users see on the Google Trends UI for "Past 7
// days" and produces the meaningful "current interest" reading.
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

const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const SERPAPI_BASE_URL = "https://serpapi.com/search.json";
const REQUEST_TIMEOUT_MS = 25_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Google Trends date window. "now 7-d" = past 7 days at hourly resolution
// (~168 points). Matches the "Past 7 days" view on the Google Trends UI.
const TRENDS_DATE_WINDOW = "now 7-d";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrendsBatchInput {
  personId: string;
  name: string;
  googleTrendsTopicId?: string | null;
}

export interface TrendsTimeseriesPoint {
  date: string;
  interest: number;
}

export interface TrendsBatchResult {
  personId: string;
  timeseries: TrendsTimeseriesPoint[];
  latestInterest: number;
  avg7d: number;
  avg90d: number;
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

async function setCache(cacheKey: string, data: any, personId?: string): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
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
 * a shared batch. Returns one result per person with the full hourly
 * timeseries (~168 points over 7 days), a "latest" reading (mean of the
 * most recent 24h), and a 7-day baseline average.
 *
 * People with a `googleTrendsTopicId` use the Topic ID (preferred for
 * disambiguation). Others fall back to name search with a warning.
 *
 * Note: `avg90d` is always 0 — the 7-day window does not contain 90 days
 * of data. Trends mass is dormant in the score engine and not rendered in
 * the UI, so this is safe. If we ever wire up a 90-day mass signal we can
 * fetch it on a separate, slower cadence.
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

      const series: TrendsTimeseriesPoint[] = [];
      for (const point of timeline) {
        const ts = new Date(parseInt(point.timestamp, 10) * 1000).toISOString();
        // Only one query per call now, so just take the first value entry.
        const v = point.values?.[0];
        if (v) series.push({ date: ts, interest: v.extracted_value ?? 0 });
      }

      if (series.length > 0) {
        // Mean of the most recent 24 hourly points = "today's average
        // interest". Smoother and more meaningful than a single hourly
        // sample, and matches what the user sees as the rightmost day on
        // the Google Trends "Past 7 days" chart.
        const last24 = series.slice(-24);
        const latestInterest = last24.length > 0
          ? last24.reduce((s, x) => s + x.interest, 0) / last24.length
          : 0;
        // Mean across the full 7-day window — the baseline that "today"
        // is compared against in momentum ratios.
        const avg7d = series.reduce((s, x) => s + x.interest, 0) / series.length;

        results.push({
          personId: p.personId,
          timeseries: series,
          latestInterest,
          avg7d,
          avg90d: 0, // not available in 7-day window; dormant signal
        });
      } else {
        results.push({ personId: p.personId, timeseries: [], latestInterest: 0, avg7d: 0, avg90d: 0 });
      }
    } else if (data) {
      // SerpApi returned success but no timeline — likely below Trends'
      // entity threshold for the queried window.
      results.push({ personId: p.personId, timeseries: [], latestInterest: 0, avg7d: 0, avg90d: 0 });
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
    await setCache(cacheKey, suggestions);
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Utility: check if Trends data is available
// ---------------------------------------------------------------------------

export function isSerpApiTrendsConfigured(): boolean {
  return !!SERPAPI_API_KEY;
}
