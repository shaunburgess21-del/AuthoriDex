// ============================================================================
// SerpApi Google Trends Provider (May 2026)
// ============================================================================
// Fetches Google Trends "Interest over time" timeseries via SerpApi's
// google_trends engine. Designed for batched ingestion (up to 5 queries per
// call) with a 24h fetch cadence — Google Trends itself only updates daily.
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
const MAX_QUERIES_PER_CALL = 5;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
// fetchGoogleTrendsBatch — batched TIMESERIES fetch (up to 5 people per call)
// ---------------------------------------------------------------------------

/**
 * Fetch Google Trends TIMESERIES data for a batch of people. The batch is
 * automatically chunked into groups of 5 (SerpApi's per-call limit for
 * TIMESERIES). Returns one result per person with the full timeseries,
 * latest interest value, 7d average, and 90d average.
 *
 * People with a `googleTrendsTopicId` use the Topic ID (preferred for
 * disambiguation). Others fall back to name search with a warning.
 */
export async function fetchGoogleTrendsBatch(
  people: TrendsBatchInput[],
  interBatchDelayMs = 500,
): Promise<TrendsBatchResult[]> {
  if (!SERPAPI_API_KEY) {
    console.warn("[SerpApi Trends] SERPAPI_API_KEY not set — skipping Trends fetch");
    return [];
  }
  if (people.length === 0) return [];

  const results: TrendsBatchResult[] = [];
  const chunks: TrendsBatchInput[][] = [];
  for (let i = 0; i < people.length; i += MAX_QUERIES_PER_CALL) {
    chunks.push(people.slice(i, i + MAX_QUERIES_PER_CALL));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const queryParts: string[] = [];
    // Map query string → person IDs (plural: two people can share a name)
    const queryToPersonIds = new Map<string, string[]>();

    for (const p of chunk) {
      const q = p.googleTrendsTopicId || p.name;
      if (!p.googleTrendsTopicId) {
        console.warn(`[SerpApi Trends] No Topic ID for "${p.name}" (${p.personId}) — falling back to name search`);
      }
      const existing = queryToPersonIds.get(q);
      if (existing) {
        existing.push(p.personId);
      } else {
        queryParts.push(q);
        queryToPersonIds.set(q, [p.personId]);
      }
    }

    const cacheKey = `serpapi_trends:batch:${queryParts.join(",")}`;
    let data = await getCached(cacheKey);

    if (!data) {
      data = await serpApiFetch({
        engine: "google_trends",
        q: queryParts.join(","),
        data_type: "TIMESERIES",
        date: "today 3-m",
        tz: "0",
      });

      if (data) {
        await setCache(cacheKey, data);
      }
    }

    if (data?.interest_over_time?.timeline_data) {
      const timeline = data.interest_over_time.timeline_data as Array<{
        date: string;
        timestamp: string;
        values: Array<{ query: string; value: string; extracted_value: number }>;
      }>;

      // Build per-query timeseries
      const perQuery = new Map<string, TrendsTimeseriesPoint[]>();
      for (const q of queryParts) perQuery.set(q, []);

      for (const point of timeline) {
        const ts = new Date(parseInt(point.timestamp, 10) * 1000).toISOString().slice(0, 10);
        for (const v of point.values) {
          const series = perQuery.get(v.query);
          if (series) {
            series.push({ date: ts, interest: v.extracted_value ?? 0 });
          }
        }
      }

      for (const [q, series] of perQuery) {
        const personIds = queryToPersonIds.get(q);
        if (!personIds || personIds.length === 0 || series.length === 0) continue;

        const latestInterest = series[series.length - 1]?.interest ?? 0;
        const last7 = series.slice(-8, -1);
        const avg7d = last7.length > 0
          ? last7.reduce((s, p) => s + p.interest, 0) / last7.length
          : 0;
        const avg90d = series.length > 0
          ? series.reduce((s, p) => s + p.interest, 0) / series.length
          : 0;

        for (const personId of personIds) {
          results.push({ personId, timeseries: series, latestInterest, avg7d, avg90d });
        }
      }
    } else if (data) {
      // SerpApi returned success but no timeline — people may be below Trends threshold
      for (const p of chunk) {
        results.push({
          personId: p.personId,
          timeseries: [],
          latestInterest: 0,
          avg7d: 0,
          avg90d: 0,
        });
      }
    }

    if (ci < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, interBatchDelayMs));
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
