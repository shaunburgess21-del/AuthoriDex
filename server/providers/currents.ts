/**
 * CurrentsAPI (currentsapi.services) news provider for union-mode ingest.
 *
 * One /v1/search call per person per refresh cycle (24h window, page_size=50 —
 * the API's hard cap; values >50 return HTTP 400 "Max page_size...").
 * Flat full-roster cadence — no rank priority. Budget: ~161 × 12 cycles/day ≈
 * 1,932 calls on Builder's 2,500/day limit.
 */
import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import pLimit from "p-limit";
import {
  buildCurrentsKeywords,
  parseCurrentsSearchResponse,
  parseRateLimitHeaders,
  shouldHardStopFromRateLimit,
  type CurrentsNewsArticleRef,
  type CurrentsRateLimitSnapshot,
  type CurrentsSearchResponseBody,
} from "./currents-parse";
import { resolveCurrentsRefreshIntervalMinutes } from "./news-refresh-intervals";

export type { CurrentsRateLimitSnapshot } from "./currents-parse";
export {
  buildCurrentsKeywords,
  parseRateLimitHeaders,
  shouldHardStopFromRateLimit,
  CURRENTS_DAILY_LIMIT_DEFAULT,
} from "./currents-parse";

const CURRENTS_API_KEY = process.env.CURRENTS_API_KEY;
const CURRENTS_API_BASE = "https://api.currentsapi.services";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 20000;

// Currents /v1/search caps page_size at 50. Larger values are rejected with
// HTTP 400 ("Max page_size ..."), which previously failed the entire batch.
const CURRENTS_PAGE_SIZE = 50;

const LAST_FETCH_KEY = "system:currents:last_fetch_at";
const RATE_LIMIT_KEY = "system:currents:rate_limit";

export interface CurrentsNewsData {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
  source: "currents";
  articles: CurrentsNewsArticleRef[];
}

export interface CurrentsBatchStats {
  total: number;
  fetched: number;
  cached: number;
  failed: number;
  cacheOnlyEmpty: number;
  budgetThrottled: boolean;
  apiCallsMade: number;
  durationMs: number;
  successCount: number;
  nonZeroCount: number;
  successCoveragePct: number;
  nonZeroCoveragePct: number;
}

const CURRENTS_REFRESH_INTERVAL_MINUTES = resolveCurrentsRefreshIntervalMinutes();

const CURRENTS_REFRESH_INTERVAL_MS = CURRENTS_REFRESH_INTERVAL_MINUTES * 60 * 1000;
const CURRENTS_CACHE_TTL_HOURS = CURRENTS_REFRESH_INTERVAL_MINUTES / 60;

export function getCurrentsRefreshIntervalMinutes(): number {
  return CURRENTS_REFRESH_INTERVAL_MINUTES;
}

async function getCachedResponse(cacheKey: string): Promise<{ responseData: string; fetchedAt: Date } | null> {
  const cached = await db.query.apiCache.findFirst({
    where: and(eq(apiCache.cacheKey, cacheKey), gt(apiCache.expiresAt, new Date())),
  });
  if (!cached) return null;
  if (cached.expiresAt < cached.fetchedAt) return null;
  return { responseData: cached.responseData, fetchedAt: cached.fetchedAt };
}

async function setCachedResponse(
  cacheKey: string,
  provider: string,
  data: string,
  ttlHours: number,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  if (expiresAt <= now) return;

  await db.insert(apiCache).values({
    cacheKey,
    provider,
    responseData: data,
    fetchedAt: now,
    expiresAt,
  }).onConflictDoUpdate({
    target: apiCache.cacheKey,
    set: { responseData: data, fetchedAt: now, expiresAt },
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKeyForName(name: string): string {
  return `currents:news:${name.replace(/\s+/g, "_").toLowerCase()}`;
}

function startDate24hIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

export async function setLastCurrentsRateLimit(snapshot: CurrentsRateLimitSnapshot): Promise<void> {
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const data = JSON.stringify(snapshot);
  await db.insert(apiCache).values({
    cacheKey: RATE_LIMIT_KEY,
    provider: "system",
    responseData: data,
    fetchedAt: new Date(),
    expiresAt: farFuture,
  }).onConflictDoUpdate({
    target: apiCache.cacheKey,
    set: { responseData: data, fetchedAt: new Date(), expiresAt: farFuture },
  });
}

export async function getLastCurrentsRateLimit(): Promise<CurrentsRateLimitSnapshot | null> {
  try {
    const row = await db.query.apiCache.findFirst({
      where: eq(apiCache.cacheKey, RATE_LIMIT_KEY),
    });
    if (!row?.responseData) return null;
    return JSON.parse(row.responseData) as CurrentsRateLimitSnapshot;
  } catch {
    return null;
  }
}

export async function getLastCurrentsFetchAt(): Promise<Date | null> {
  try {
    const row = await db.select({ responseData: apiCache.responseData })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, LAST_FETCH_KEY))
      .limit(1);
    if (row.length > 0 && row[0].responseData) {
      const parsed = JSON.parse(row[0].responseData);
      return parsed.fetchedAt ? new Date(parsed.fetchedAt) : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function setLastCurrentsFetchAt(timestamp: Date): Promise<void> {
  const data = JSON.stringify({ fetchedAt: timestamp.toISOString() });
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await db.insert(apiCache).values({
    cacheKey: LAST_FETCH_KEY,
    provider: "system",
    responseData: data,
    fetchedAt: timestamp,
    expiresAt: farFuture,
  }).onConflictDoUpdate({
    target: apiCache.cacheKey,
    set: { responseData: data, fetchedAt: timestamp, expiresAt: farFuture },
  });
}

export async function shouldRefreshCurrents(): Promise<{
  shouldRefresh: boolean;
  lastFetchAt: Date | null;
  ageMs: number | null;
  budgetThrottled: boolean;
}> {
  const lastFetch = await getLastCurrentsFetchAt();
  if (!lastFetch) {
    return { shouldRefresh: true, lastFetchAt: null, ageMs: null, budgetThrottled: false };
  }

  const ageMs = Date.now() - lastFetch.getTime();
  const cadenceDue = ageMs >= CURRENTS_REFRESH_INTERVAL_MS;

  if (cadenceDue) {
    const rate = await getLastCurrentsRateLimit();
    if (shouldHardStopFromRateLimit(rate)) {
      console.warn(
        `[Currents] Budget hard stop: remaining ${rate!.remaining}/${rate!.limit} ` +
          `(<= ${Math.max(1, Math.floor(rate!.limit * 0.05))} floor) — skipping refresh`,
      );
      return { shouldRefresh: false, lastFetchAt: lastFetch, ageMs, budgetThrottled: true };
    }
  }

  return {
    shouldRefresh: cadenceDue,
    lastFetchAt: lastFetch,
    ageMs,
    budgetThrottled: false,
  };
}

async function fetchCurrentsSearchRaw(
  keywords: string,
): Promise<{ body: CurrentsSearchResponseBody | null; ok: boolean }> {
  const params = new URLSearchParams({
    keywords,
    language: "en",
    start_date: startDate24hIso(),
    page_size: String(CURRENTS_PAGE_SIZE),
  });
  const url = `${CURRENTS_API_BASE}/v1/search?${params.toString()}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Authorization: CURRENTS_API_KEY!,
          Accept: "application/json",
        },
      });

      clearTimeout(timeoutId);

      const rateSnap = parseRateLimitHeaders(response.headers);
      if (rateSnap) {
        await setLastCurrentsRateLimit(rateSnap);
      }

      if (!response.ok) {
        if (response.status === 429 && attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        const text = await response.text();
        console.warn(`[Currents] HTTP ${response.status} for "${keywords}": ${text.slice(0, 120)}`);
        return { body: null, ok: false };
      }

      const body = (await response.json()) as CurrentsSearchResponseBody;
      if (body.status !== "ok") {
        console.warn(`[Currents] API status=${body.status} msg=${body.msg ?? "?"}`);
        return { body: null, ok: false };
      }
      return { body, ok: true };
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      console.warn(`[Currents] Fetch failed for "${keywords}":`, err);
      return { body: null, ok: false };
    }
  }
  return { body: null, ok: false };
}

export async function fetchCurrentsNews(
  name: string,
  options?: { searchQueryOverride?: string | null },
): Promise<CurrentsNewsData | null> {
  if (!CURRENTS_API_KEY) return null;

  const keywords = buildCurrentsKeywords(name, options?.searchQueryOverride);
  const cacheKey = cacheKeyForName(name);

  try {
    const { body, ok } = await fetchCurrentsSearchRaw(keywords);
    if (!ok || !body) return null;

    const parsed = parseCurrentsSearchResponse(body, keywords);
    const articleCount24h = parsed.articleCount24h;
    const result: CurrentsNewsData = {
      query: parsed.query,
      articleCount24h,
      articleCount7d: 0,
      averageDaily7d: 0,
      delta: articleCount24h > 0 ? 1 : 0,
      topHeadlines: parsed.topHeadlines,
      source: "currents",
      articles: parsed.articles,
    };

    await setCachedResponse(cacheKey, "currents", JSON.stringify(result), CURRENTS_CACHE_TTL_HOURS);
    return result;
  } catch (error) {
    console.error(`[Currents] Error fetching news for ${name}:`, error);
    return null;
  }
}

export async function fetchCurrentsBatch(
  people: Array<{ id: string; name: string; searchQueryOverride?: string | null }>,
  concurrency: number = 4,
  delayMs: number = 300,
  options?: { cacheOnly?: boolean; budgetThrottled?: boolean },
): Promise<{
  data: Map<string, CurrentsNewsData>;
  stats: CurrentsBatchStats;
  isRefresh: boolean;
}> {
  const results = new Map<string, CurrentsNewsData>();
  const startTime = Date.now();
  let fetched = 0;
  let cached = 0;
  let failed = 0;
  let cacheOnlyEmpty = 0;
  let apiCallsMade = 0;
  const cacheOnly = options?.cacheOnly ?? false;
  const budgetThrottled = options?.budgetThrottled ?? false;
  const limit = pLimit(concurrency);

  if (!CURRENTS_API_KEY) {
    console.log("[Currents] No API key configured, skipping batch");
    return {
      data: results,
      stats: {
        total: people.length,
        fetched: 0,
        cached: 0,
        failed: people.length,
        cacheOnlyEmpty: 0,
        budgetThrottled: false,
        apiCallsMade: 0,
        durationMs: 0,
        successCount: 0,
        nonZeroCount: 0,
        successCoveragePct: 0,
        nonZeroCoveragePct: 0,
      },
      isRefresh: false,
    };
  }

  if (cacheOnly) {
    console.log(`[Currents] Cache-only mode — reusing cached data for ${people.length} people`);
  } else {
    console.log(
      `[Currents] Refresh mode — fetching fresh news for ${people.length} people ` +
        `(concurrency=${concurrency}, delay=${delayMs}ms, interval=${CURRENTS_REFRESH_INTERVAL_MINUTES}min)`,
    );
  }

  const tasks = people.map((person, index) =>
    limit(async () => {
      if (index > 0 && !cacheOnly) {
        await sleep(delayMs);
      }

      const key = cacheKeyForName(person.name);
      const cachedRow = await getCachedResponse(key);
      if (cachedRow) {
        results.set(person.id, JSON.parse(cachedRow.responseData) as CurrentsNewsData);
        cached++;
        return;
      }

      if (cacheOnly) {
        cacheOnlyEmpty++;
        return;
      }

      apiCallsMade++;
      const result = await fetchCurrentsNews(person.name, {
        searchQueryOverride: person.searchQueryOverride,
      });
      if (result) {
        results.set(person.id, result);
        fetched++;
      } else {
        failed++;
      }
    }),
  );

  await Promise.all(tasks);

  if (!cacheOnly && fetched > 0) {
    await setLastCurrentsFetchAt(new Date());
  }

  const durationMs = Date.now() - startTime;
  let nonZeroCount = 0;
  results.forEach((entry) => {
    if ((entry.articleCount24h ?? 0) > 0) nonZeroCount++;
  });
  const successCount = results.size;

  const stats: CurrentsBatchStats = {
    total: people.length,
    fetched,
    cached,
    failed,
    cacheOnlyEmpty,
    budgetThrottled,
    apiCallsMade,
    durationMs,
    successCount,
    nonZeroCount,
    successCoveragePct: people.length > 0 ? (successCount / people.length) * 100 : 0,
    nonZeroCoveragePct: people.length > 0 ? (nonZeroCount / people.length) * 100 : 0,
  };

  const emptySuffix = cacheOnlyEmpty > 0
    ? ` + ${cacheOnlyEmpty} cache-only-empty${budgetThrottled ? " (budget hard stop)" : ""}`
    : "";
  const failedSuffix = failed > 0 ? ` + ${failed} failed` : "";
  console.log(
    `[Currents] Batch complete: ${fetched} fresh + ${cached} cached${emptySuffix}${failedSuffix} ` +
      `= ${results.size}/${people.length} in ${(durationMs / 1000).toFixed(1)}s ` +
      `(${apiCallsMade} API calls, nonZero=${stats.nonZeroCoveragePct.toFixed(0)}%)`,
  );

  return { data: results, stats, isRefresh: !cacheOnly && fetched > 0 };
}

export function isCurrentsConfigured(): boolean {
  return !!CURRENTS_API_KEY;
}
