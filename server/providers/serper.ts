import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import pLimit from "p-limit";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_BASE_URL = "https://google.serper.dev/search";
const SERPER_REQUEST_TIMEOUT_MS = 20_000;

const SERPER_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

let _serperRetryCount = 0;
let _serperTimeoutCount = 0;
let _serperCallsAttempted = 0;
let _serperFinalFailures = 0;
let _serperSearchCallsAttempted = 0;
let _serperFallbackCallsAttempted = 0;
export function getSerperRunStats() {
  return { retriesUsed: _serperRetryCount, timeoutCount: _serperTimeoutCount, callsAttempted: _serperCallsAttempted, finalFailures: _serperFinalFailures, searchCallsAttempted: _serperSearchCallsAttempted, fallbackCallsAttempted: _serperFallbackCallsAttempted };
}
export function resetSerperRunStats() {
  _serperRetryCount = 0;
  _serperTimeoutCount = 0;
  _serperCallsAttempted = 0;
  _serperFinalFailures = 0;
  _serperSearchCallsAttempted = 0;
  _serperFallbackCallsAttempted = 0;
}
export function incrementSerperSearchCalls() { _serperSearchCallsAttempted++; }
export function incrementSerperFallbackCalls() { _serperFallbackCallsAttempted++; }

// Degraded-state tracking: distinguishes provider-side failures (auth/quota/rate-limit)
// from legitimately-empty results. Single source of truth for both the Why Trending
// endpoint and the admin/cron health surfaces.
export type SerperDegradedReason = "auth" | "quota" | "rate_limit";
export interface SerperDegradedState {
  reason: SerperDegradedReason;
  since: string;
  lastStatus: number;
  lastDetail?: string;
}

let _serperDegradedState: SerperDegradedState | null = null;

export function getSerperDegradedState(): SerperDegradedState | null {
  return _serperDegradedState;
}

export function clearSerperDegradedState(): void {
  if (_serperDegradedState) {
    console.info(`[Serper] Degraded state cleared (was ${_serperDegradedState.reason} since ${_serperDegradedState.since})`);
    _serperDegradedState = null;
  }
}

function classifyDegradedStatus(status: number, body?: string): SerperDegradedReason | null {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 429) return "rate_limit";
  // Serper sometimes returns 400/500 with a credits-exhausted body when the plan runs out.
  if (body && /credit|quota|insufficient|balance/i.test(body)) return "quota";
  return null;
}

function markSerperDegraded(reason: SerperDegradedReason, status: number, detail?: string): void {
  const prev = _serperDegradedState;
  if (prev && prev.reason === reason) {
    _serperDegradedState = { ...prev, lastStatus: status, lastDetail: detail };
    return;
  }
  _serperDegradedState = {
    reason,
    since: new Date().toISOString(),
    lastStatus: status,
    lastDetail: detail,
  };
  console.warn(`[Serper] Entering degraded state: reason=${reason} status=${status}${detail ? ` detail=${detail.slice(0, 120)}` : ""}`);
}

async function serperFetch(url: string, options: RequestInit): Promise<Response> {
  _serperCallsAttempted++;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SERPER_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (attempt === 0 && SERPER_RETRYABLE_STATUS.has(response.status)) {
        _serperRetryCount++;
        const jitter = 300 + Math.random() * 600;
        console.warn(`[Serper] Got ${response.status}, retrying in ${jitter.toFixed(0)}ms`);
        await new Promise(r => setTimeout(r, jitter));
        continue;
      }
      if (response.ok) {
        clearSerperDegradedState();
      } else {
        // Peek body for credits/quota hints without consuming it for the caller.
        // We clone so downstream .json()/.text() still works.
        let bodyPeek: string | undefined;
        try {
          bodyPeek = await response.clone().text();
        } catch {}
        const reason = classifyDegradedStatus(response.status, bodyPeek);
        if (reason) {
          markSerperDegraded(reason, response.status, bodyPeek);
        }
      }
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (attempt === 0) {
        _serperRetryCount++;
        if (err?.name === "AbortError") _serperTimeoutCount++;
        const jitter = 300 + Math.random() * 600;
        const reason = err?.name === "AbortError" ? "timeout" : err?.message ?? "network error";
        console.warn(`[Serper] Request failed (${reason}), retrying in ${jitter.toFixed(0)}ms`);
        await new Promise(r => setTimeout(r, jitter));
        continue;
      }
      _serperFinalFailures++;
      throw err;
    }
  }
  throw new Error("[Serper] Unreachable: retry loop exited without return or throw");
}

async function getCachedResponse(cacheKey: string): Promise<{ responseData: string; fetchedAt: Date } | null> {
  const cached = await db.query.apiCache.findFirst({
    where: and(
      eq(apiCache.cacheKey, cacheKey),
      gt(apiCache.expiresAt, new Date())
    ),
  });

  if (!cached) return null;

  if (cached.expiresAt < cached.fetchedAt) {
    console.warn(`[CACHE_INVALID] ${cacheKey}: expiresAt (${cached.expiresAt.toISOString()}) < fetchedAt (${cached.fetchedAt.toISOString()}), treating as stale`);
    return null;
  }

  return { responseData: cached.responseData, fetchedAt: cached.fetchedAt };
}

async function setCachedResponse(
  cacheKey: string,
  provider: string,
  data: string,
  ttlHours: number
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  if (expiresAt <= now) {
    console.error(`[CACHE_GUARD] Refusing to write cache for ${cacheKey}: expiresAt <= now (ttlHours=${ttlHours})`);
    return;
  }

  await db.insert(apiCache).values({
    cacheKey,
    provider,
    responseData: data,
    fetchedAt: now,
    expiresAt,
  }).onConflictDoUpdate({
    target: apiCache.cacheKey,
    set: {
      responseData: data,
      fetchedAt: now,
      expiresAt,
    },
  });
}

export interface SerperResult {
  searchVolume: number;
  newsCount: number;
  delta: number;
  relatedSearches?: string[];
  peopleAlsoAsk?: string[];
  topStories?: Array<{ title: string; link: string }>;
  /** Organic web results count from Serper (for audits; optional on legacy cache rows). */
  organicCount?: number;
  /** First organic title, else first top story title (for audits). */
  topResultTitle?: string | null;
}

interface SerperSearchResponse {
  organic?: Array<{ title: string; link: string; snippet: string; date?: string; position?: number }>;
  news?: Array<{ title: string; link: string; snippet: string; date?: string }>;
  searchInformation?: { totalResults?: string };
  knowledgeGraph?: { title?: string; description?: string; type?: string };
  topStories?: Array<{ title: string; link: string }>;
  relatedSearches?: Array<{ query: string }>;
  peopleAlsoAsk?: Array<{ question: string }>;
  sitelinks?: { inline?: Array<{ title: string; link: string }>; expanded?: Array<{ title: string; link: string }> };
}

function buildSerperResultFromApiData(data: SerperSearchResponse): SerperResult {
  const organicCount = (data.organic || []).length;
  const newsCount = (data.news || []).length;
  const hasKnowledgeGraph = data.knowledgeGraph?.title ? 1 : 0;
  const hasTopStories = (data.topStories || []).length > 0 ? 1 : 0;
  const relatedSearchCount = (data.relatedSearches || []).length;
  const peopleAlsoAskCount = (data.peopleAlsoAsk || []).length;
  const hasSitelinks = (data.sitelinks?.inline?.length || 0) + (data.sitelinks?.expanded?.length || 0) > 0 ? 1 : 0;

  const searchActivityScore =
    Math.min(40, organicCount * 4) +
    hasKnowledgeGraph * 20 +
    Math.min(15, newsCount * 3) +
    Math.min(10, relatedSearchCount) +
    Math.min(10, peopleAlsoAskCount * 2.5) +
    hasSitelinks * 5;

  const recentResults = (data.organic || []).filter((r) => {
    if (!r.date) return false;
    const date = new Date(r.date);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return date > dayAgo;
  }).length;

  const searchVolume = searchActivityScore;
  const delta = recentResults > 3 ? 0.3 : recentResults > 1 ? 0.1 : recentResults > 0 ? 0.05 : 0;

  const rawRelated = (data.relatedSearches || []).map((r) => r.query.trim());
  const rawPAA = (data.peopleAlsoAsk || []).map((r) => r.question.trim());
  const deduped = (arr: string[]) => Array.from(new Set(arr)).slice(0, 5);
  const topStories = (data.topStories || []).slice(0, 3).map((s) => ({ title: s.title, link: s.link }));

  const topResultTitle =
    (data.organic?.[0]?.title) ?? (data.topStories?.[0]?.title) ?? null;

  return {
    searchVolume,
    newsCount,
    delta,
    relatedSearches: deduped(rawRelated),
    peopleAlsoAsk: deduped(rawPAA),
    topStories,
    organicCount,
    topResultTitle,
  };
}

async function fetchSerperLiveResult(query: string): Promise<SerperResult | null> {
  if (!SERPER_API_KEY) {
    return null;
  }

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return null;
  }

  const response = await serperFetch(SERPER_BASE_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: trimmedQuery,
      num: 10,
      gl: "us",
      hl: "en",
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data: SerperSearchResponse = await response.json();
  return buildSerperResultFromApiData(data);
}

/**
 * Live Serper web search for admin diagnostics (does not read or write api_cache).
 */
export async function probeSerperSearchLive(
  personName: string,
  searchQueryOverride?: string | null
): Promise<SerperResult | null> {
  if (!SERPER_API_KEY) {
    return null;
  }

  const trimmed = personName.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const result = await fetchSerperLiveResult(searchQueryOverride?.trim() || trimmed);
    if (!result) {
      console.error(`[Serper] Probe API error for ${trimmed}`);
      return null;
    }
    return result;
  } catch (error) {
    console.error(`[Serper] Probe error for ${trimmed}:`, error);
    return null;
  }
}

/**
 * Force-refresh Serper cache for one person using a live API call.
 * This bypasses stale-cache fallback and suspicious-drop guard intentionally.
 */
export async function refreshSerperCacheForPerson(
  name: string,
  searchQueryOverride?: string | null
): Promise<SerperResult | null> {
  if (!SERPER_API_KEY) {
    return null;
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }

  const query = searchQueryOverride?.trim() || trimmedName;
  try {
    const result = await fetchSerperLiveResult(query);
    if (!result) {
      console.error(`[Serper] Refresh API error for ${trimmedName}`);
      return null;
    }

    const cacheKey = `serper:search:${trimmedName.replace(/\s+/g, "_").toLowerCase()}`;
    await setCachedResponse(cacheKey, "serper", JSON.stringify(result), 12);
    return result;
  } catch (error) {
    console.error(`[Serper] Refresh error for ${trimmedName}:`, error);
    return null;
  }
}

export async function fetchSerperData(name: string, searchQueryOverride?: string | null): Promise<SerperResult | null> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] No API key configured, skipping ${name}`);
    return null;
  }

  const cacheKey = `serper:search:${name.replace(/\s+/g, "_").toLowerCase()}`;
  const CACHE_TTL_HOURS = 12;

  try {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return JSON.parse(cached.responseData);
    }

    const [rawCached] = await db
      .select()
      .from(apiCache)
      .where(eq(apiCache.cacheKey, cacheKey))
      .limit(1);

    // Stale cache fallback: if we have data fetched within the last 24 hours,
    // use it instead of making a live API call. Beyond 24h we always refresh
    // so hourly ingestion keeps Serper freshness within 24h.
    if (rawCached) {
      const staleAgeHours = (Date.now() - new Date(rawCached.fetchedAt).getTime()) / (1000 * 60 * 60);
      if (staleAgeHours <= 24) {
        console.log(`[Serper] Stale cache hit for ${name} (${staleAgeHours.toFixed(1)}h old), skipping live API call`);
        return JSON.parse(rawCached.responseData);
      }
    }

    _serperSearchCallsAttempted++;
    const result = await fetchSerperLiveResult(searchQueryOverride || name);
    if (!result) {
      console.error(`[Serper] API error for ${name}`);
      return null;
    }

    // CACHE VALIDITY GATE
    // Prevent caching garbage data when there's a suspicious drop.
    // If new value drops >70% from cached value, refuse to update cache.
    if (rawCached) {
      const cachedResult = JSON.parse(rawCached.responseData) as SerperResult;
      const dropPercent = cachedResult.searchVolume > 0 
        ? (1 - result.searchVolume / cachedResult.searchVolume) * 100 
        : 0;
      
      // If drop exceeds 70% and we had meaningful data before, keep cached value
      if (dropPercent > 70 && cachedResult.searchVolume >= 20) {
        console.log(`[Serper] Suspicious drop for ${name}: ${cachedResult.searchVolume.toFixed(1)} → ${result.searchVolume.toFixed(1)} (${dropPercent.toFixed(0)}% drop), keeping cached value`);
        // Keep existing value but refresh fetchedAt/expiresAt so audit does not show a false stale.
        await setCachedResponse(cacheKey, "serper", JSON.stringify(cachedResult), CACHE_TTL_HOURS);
        return cachedResult;
      }
    }

    await setCachedResponse(cacheKey, "serper", JSON.stringify(result), CACHE_TTL_HOURS);

    return result;
  } catch (error) {
    console.error(`[Serper] Error fetching data for ${name}:`, error);
    return null;
  }
}

export async function fetchSerperBatch(
  people: Array<{ id: string; name: string; searchQueryOverride?: string | null }>,
  concurrency: number = 2,
  delayMs: number = 500
): Promise<Map<string, SerperResult>> {
  const results = new Map<string, SerperResult>();
  const limit = pLimit(concurrency);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const tasks = people.map((person, index) =>
    limit(async () => {
      if (index > 0) {
        await delay(delayMs);
      }
      if (person.searchQueryOverride) {
        console.log(`[Serper] Using override query for ${person.name}: "${person.searchQueryOverride}"`);
      }
      const result = await fetchSerperData(person.name, person.searchQueryOverride);
      if (result) {
        results.set(person.id, result);
        console.log(`[Serper] Successfully fetched data for ${person.name}`);
      }
    })
  );

  await Promise.all(tasks);
  console.log(`[Serper] Batch complete: ${results.size}/${people.length} successful`);

  return results;
}

// Web search grounding for AI profile generation
// Returns recent news headlines and context about a person
export interface SerperNewsCountData {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
  source: "serper_news";
  // Optional URL list used by the multi-source news aggregator for dedup.
  // Legacy cached entries may not have this field; aggregator falls back to counts.
  articles?: Array<{ url: string; title?: string; publishedAt?: string }>;
}

export async function fetchSerperNewsCount(name: string, personId?: string): Promise<SerperNewsCountData | null> {
  if (!SERPER_API_KEY) return null;

  const cacheKey = `serper:newscount:${name.replace(/\s+/g, "_").toLowerCase()}`;
  const CACHE_TTL_HOURS = 2;

  try {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return JSON.parse(cached.responseData);
    }

    _serperFallbackCallsAttempted++;
    const response24h = await serperFetch("https://google.serper.dev/news", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `"${name}"`,
        num: 100,
        gl: "us",
        hl: "en",
        tbs: "qdr:d",
      }),
    });

    await new Promise(r => setTimeout(r, 300));

    const response7d = await serperFetch("https://google.serper.dev/news", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `"${name}"`,
        num: 100,
        gl: "us",
        hl: "en",
        tbs: "qdr:w",
      }),
    });

    const data24h = response24h.ok ? await response24h.json() : { news: [] };
    const data7d = response7d.ok ? await response7d.json() : { news: [] };

    const articleCount24h = data24h.news?.length || 0;
    const rawArticleCount7d = data7d.news?.length || 0;
    const articleCount7d = Math.round(rawArticleCount7d * 2.5);
    const averageDaily7d = articleCount7d / 7;
    const delta = averageDaily7d > 0
      ? ((articleCount24h - averageDaily7d) / averageDaily7d)
      : (articleCount24h > 0 ? 1 : 0);

    const topHeadlines = (data24h.news || [])
      .slice(0, 3)
      .map((a: any) => a.title || "");

    const articles = (data24h.news || [])
      .filter((a: any) => !!a.link)
      .map((a: any) => ({
        url: a.link as string,
        title: a.title as string | undefined,
        publishedAt: a.date as string | undefined,
      }));

    const result: SerperNewsCountData = {
      query: name,
      articleCount24h,
      articleCount7d,
      averageDaily7d,
      delta,
      topHeadlines,
      source: "serper_news",
      articles,
    };

    await setCachedResponse(cacheKey, "serper_news", JSON.stringify(result), CACHE_TTL_HOURS);

    return result;
  } catch (error) {
    console.error(`[Serper News] Error fetching news count for ${name}:`, error);
    return null;
  }
}

export async function fetchSerperNewsBatch(
  people: Array<{ id: string; name: string }>,
  concurrency: number = 2,
  delayMs: number = 500
): Promise<Map<string, SerperNewsCountData>> {
  const results = new Map<string, SerperNewsCountData>();
  const limit = pLimit(concurrency);

  console.log(`[Serper News] Fetching news counts for ${people.length} people as GDELT fallback`);

  const tasks = people.map((person, index) =>
    limit(async () => {
      if (index > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      const result = await fetchSerperNewsCount(person.name, person.id);
      if (result) {
        results.set(person.id, result);
      }
    })
  );

  await Promise.all(tasks);
  console.log(`[Serper News] Fetched ${results.size}/${people.length} news counts`);
  return results;
}

/**
 * 24h-only variant of fetchSerperNewsCount used by the multi-source news
 * aggregator. Skips the 7d API call (the aggregator already sources 7d from
 * GDELT), which halves Serper News cost in union mode.
 *
 * Uses a separate cache key (`serper:newscount_24h:NAME`) so it can't pollute
 * the full-fat cache consumed by the legacy tiered-mode Serper fallback.
 */
export async function fetchSerperNewsCount24h(name: string, personId?: string): Promise<SerperNewsCountData | null> {
  if (!SERPER_API_KEY) return null;

  const cacheKey = `serper:newscount_24h:${name.replace(/\s+/g, "_").toLowerCase()}`;
  const CACHE_TTL_HOURS = 2;

  try {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return JSON.parse(cached.responseData);
    }

    _serperFallbackCallsAttempted++;
    const response24h = await serperFetch("https://google.serper.dev/news", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `"${name}"`,
        num: 100,
        gl: "us",
        hl: "en",
        tbs: "qdr:d",
      }),
    });

    const data24h = response24h.ok ? await response24h.json() : { news: [] };
    const articleCount24h = data24h.news?.length || 0;

    const topHeadlines = (data24h.news || [])
      .slice(0, 3)
      .map((a: any) => a.title || "");

    const articles = (data24h.news || [])
      .filter((a: any) => !!a.link)
      .map((a: any) => ({
        url: a.link as string,
        title: a.title as string | undefined,
        publishedAt: a.date as string | undefined,
      }));

    const result: SerperNewsCountData = {
      query: name,
      articleCount24h,
      // 7d intentionally zero — the aggregator sources 7d from GDELT.
      articleCount7d: 0,
      averageDaily7d: 0,
      delta: articleCount24h > 0 ? 1 : 0,
      topHeadlines,
      source: "serper_news",
      articles,
    };

    await setCachedResponse(cacheKey, "serper_news", JSON.stringify(result), CACHE_TTL_HOURS);

    return result;
  } catch (error) {
    console.error(`[Serper News 24h] Error fetching news count for ${name}:`, error);
    return null;
  }
}

export async function fetchSerperNewsBatch24h(
  people: Array<{ id: string; name: string }>,
  concurrency: number = 4,
  delayMs: number = 300
): Promise<Map<string, SerperNewsCountData>> {
  const results = new Map<string, SerperNewsCountData>();
  const limit = pLimit(concurrency);

  console.log(`[Serper News 24h] Fetching 24h news counts for ${people.length} people (aggregator mode)`);

  const tasks = people.map((person, index) =>
    limit(async () => {
      if (index > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      const result = await fetchSerperNewsCount24h(person.name, person.id);
      if (result) {
        results.set(person.id, result);
      }
    })
  );

  await Promise.all(tasks);
  console.log(`[Serper News 24h] Fetched ${results.size}/${people.length} news counts`);
  return results;
}

export interface WebSearchContext {
  headlines: string[];
  snippets: string[];
  sources: Array<{ title: string; link: string; date?: string }>;
}

export async function fetchWebSearchContext(name: string): Promise<WebSearchContext | null> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] No API key configured, skipping web search for ${name}`);
    return null;
  }

  try {
    // Search for recent news about the person
    const newsResponse = await serperFetch("https://google.serper.dev/news", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `${name} news`,
        num: 10,
        gl: "us",
        hl: "en",
        tbs: "qdr:m", // Last month
      }),
    });

    // Also search for general info
    const searchResponse = await serperFetch(SERPER_BASE_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `${name} current role position 2025`,
        num: 5,
        gl: "us",
        hl: "en",
      }),
    });

    const newsData = newsResponse.ok ? await newsResponse.json() : { news: [] };
    const searchData = searchResponse.ok ? await searchResponse.json() : { organic: [] };

    const headlines: string[] = [];
    const snippets: string[] = [];
    const sources: Array<{ title: string; link: string; date?: string }> = [];

    // Extract news headlines
    if (newsData.news) {
      for (const item of newsData.news.slice(0, 5)) {
        headlines.push(item.title);
        if (item.snippet) snippets.push(item.snippet);
        sources.push({ title: item.title, link: item.link, date: item.date });
      }
    }

    // Extract search results for context
    if (searchData.organic) {
      for (const item of searchData.organic.slice(0, 3)) {
        if (item.snippet) snippets.push(item.snippet);
        sources.push({ title: item.title, link: item.link });
      }
    }

    console.log(`[Serper] Web search for ${name}: ${headlines.length} headlines, ${snippets.length} snippets`);

    return { headlines, snippets, sources };
  } catch (error) {
    console.error(`[Serper] Error fetching web search context for ${name}:`, error);
    return null;
  }
}

// Search for why someone is trending (recent news and context)
export interface TrendingNewsContext {
  headline: string;
  summary: string;
  category: string;
  sources: Array<{ title: string; link: string; date?: string }>;
  fetchedAt: Date;
}

export async function fetchTrendingNewsContext(name: string): Promise<TrendingNewsContext | null> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] No API key configured, skipping trending news for ${name}`);
    return null;
  }

  const cacheKey = `serper:trending:${name.replace(/\s+/g, "_").toLowerCase()}`;
  const CACHE_TTL_HOURS = 3; // Cache trending context for 3 hours

  try {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return JSON.parse(cached.responseData);
    }

    // Search for recent news about the person (last week)
    const response = await serperFetch("https://google.serper.dev/news", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `${name}`,
        num: 10,
        gl: "us",
        hl: "en",
        tbs: "qdr:3d", // Last 3 days
      }),
    });

    if (!response.ok) {
      console.error(`[Serper] Trending news API error for ${name}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const news = data.news || [];

    if (news.length === 0) {
      return null;
    }

    const sources = news.slice(0, 5).map((item: any) => ({
      title: item.title,
      link: item.link,
      date: item.date,
    }));

    const result: TrendingNewsContext = {
      headline: news[0]?.title || "In the news",
      summary: news[0]?.snippet || "",
      category: categorizeNews(news.map((n: any) => n.title + " " + (n.snippet || "")).join(" ")),
      sources,
      fetchedAt: new Date(),
    };

    await setCachedResponse(cacheKey, "serper", JSON.stringify(result), CACHE_TTL_HOURS);

    return result;
  } catch (error) {
    console.error(`[Serper] Error fetching trending news for ${name}:`, error);
    return null;
  }
}

// Fetch dedicated net worth search results for accurate financial data
export interface NetWorthContext {
  estimate: string | null;
  sources: Array<{ title: string; snippet: string; link: string }>;
}

export async function fetchNetWorthContext(name: string): Promise<NetWorthContext | null> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] No API key configured, skipping net worth search for ${name}`);
    return null;
  }

  try {
    // Search specifically for net worth with current year
    const currentYear = new Date().getFullYear();
    const response = await serperFetch(SERPER_BASE_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `${name} net worth ${currentYear}`,
        num: 8,
        gl: "us",
        hl: "en",
      }),
    });

    if (!response.ok) {
      console.error(`[Serper] Net worth search API error for ${name}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const organic = data.organic || [];

    if (organic.length === 0) {
      return { estimate: null, sources: [] };
    }

    const sources = organic.slice(0, 5).map((item: any) => ({
      title: item.title,
      snippet: item.snippet || "",
      link: item.link,
    }));

    // Try to extract a net worth estimate from snippets
    let estimate: string | null = null;
    for (const source of sources) {
      const match = source.snippet.match(/\$[\d,.]+ (?:billion|million|trillion)/i);
      if (match) {
        estimate = match[0];
        break;
      }
    }

    console.log(`[Serper] Net worth search for ${name}: found ${sources.length} sources, estimate: ${estimate || 'none extracted'}`);

    return { estimate, sources };
  } catch (error) {
    console.error(`[Serper] Error fetching net worth for ${name}:`, error);
    return null;
  }
}

// Simple categorization based on keywords
function categorizeNews(text: string): string {
  const textLower = text.toLowerCase();
  
  const categories: Record<string, string[]> = {
    "Politics": ["president", "senator", "congress", "election", "vote", "policy", "government", "political", "white house", "administration"],
    "Business": ["ceo", "company", "stock", "earnings", "revenue", "investment", "acquisition", "ipo", "market"],
    "Music": ["movie", "film", "album", "song", "concert", "award", "grammy", "oscar", "emmy", "performance"],
    "Sports": ["game", "match", "tournament", "championship", "win", "score", "team", "player", "season"],
    "Technology": ["tech", "ai", "software", "app", "launch", "innovation", "startup"],
    "Legal": ["lawsuit", "court", "trial", "charged", "indicted", "settlement", "legal"],
    "Personal Life": ["married", "divorce", "baby", "relationship", "dating", "family"],
    "Controversy": ["scandal", "controversy", "backlash", "criticism", "fired", "resigned"],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => textLower.includes(keyword))) {
      return category;
    }
  }

  return "In The News";
}
