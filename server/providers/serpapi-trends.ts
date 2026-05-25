// ============================================================================
// SerpApi Google Trends Provider (May 2026)
// ============================================================================
// Fetches Google Trends "Interest over time" timeseries via SerpApi's
// google_trends engine. One query per call (no batching) so each person's
// 0-100 score is normalised against THEIR OWN peak, not against the loudest
// person in a shared batch. Uses date=now 7-d so the latest 24h and the
// prior 24h are on one shared peak scale for a true day-over-day delta
// (same mental model as News Activity / Wikipedia Pulse).
//
// Why per-person and not batched? When you submit q=a,b,c,d,e to Google
// Trends, ALL series are normalised against the single highest point across
// all 5 queries combined. Per-person fetches eliminate cross-contamination.
//
// Also provides Topic ID autocomplete lookups for entity disambiguation.

import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  computeTrendsDayOverDayMeans,
  TRENDS_SERPAPI_WINDOW,
  type TrendsTimeseriesPoint,
} from "./trends-window";

export type { TrendsTimeseriesPoint } from "./trends-window";
export {
  computeTrendsDayOverDayMeans,
  shouldFetchGoogleTrends,
  TRENDS_DELTA_METHOD,
  TRENDS_FETCH_INTERVAL_MS,
  TRENDS_SERPAPI_WINDOW,
} from "./trends-window";

const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const SERPAPI_BASE_URL = "https://serpapi.com/search.json";
const REQUEST_TIMEOUT_MS = 25_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
// Cache TTL for the per-person SerpApi response. MUST stay below the ingest
// job's TRENDS_FETCH_INTERVAL_MS (currently 12h).
const TRENDS_DATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const AUTOCOMPLETE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  /** Mean of the latest 24h on the `now 7-d` scale (% of week's peak hour). */
  latestInterest: number;
  /** Mean of the previous 24h on the same scale (day-over-day comparator). */
  prevWindowInterest: number;
  /** Mean over the full returned series (~7d) on the same scale — momentum baseline. */
  avgWindowInterest: number;
}

export interface TopicSuggestion {
  topicId: string;
  title: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Run stats
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
// DB cache helpers
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
// fetchGoogleTrendsBatch — per-person TIMESERIES fetch
// ---------------------------------------------------------------------------

/**
 * Fetch Google Trends TIMESERIES for each person on `now 7-d`. Day-over-day
 * delta uses latest-24h mean vs previous-24h mean on one normalised scale.
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

    const cacheKey = `serpapi_trends:person:${q}:${TRENDS_SERPAPI_WINDOW}`;
    let data = await getCached(cacheKey);

    if (!data) {
      data = await serpApiFetch({
        engine: "google_trends",
        q,
        data_type: "TIMESERIES",
        date: TRENDS_SERPAPI_WINDOW,
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
        const v = point.values?.[0];
        if (v) series.push({ date: ts, interest: v.extracted_value ?? 0 });
      }

      if (series.length > 0) {
        const { latestInterest, prevWindowInterest, avgWindowInterest } =
          computeTrendsDayOverDayMeans(series);
        results.push({
          personId: p.personId,
          timeseries: series,
          latestInterest,
          prevWindowInterest,
          avgWindowInterest,
        });
      } else {
        results.push({ personId: p.personId, timeseries: [], latestInterest: 0, prevWindowInterest: 0, avgWindowInterest: 0 });
      }
    } else if (data) {
      results.push({ personId: p.personId, timeseries: [], latestInterest: 0, prevWindowInterest: 0, avgWindowInterest: 0 });
    }

    if (i < people.length - 1) {
      await new Promise((r) => setTimeout(r, interCallDelayMs));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// fetchTrendsTopicSuggestions
// ---------------------------------------------------------------------------

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

export function isSerpApiTrendsConfigured(): boolean {
  return !!SERPAPI_API_KEY;
}
