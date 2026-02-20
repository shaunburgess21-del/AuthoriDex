import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt, sql } from "drizzle-orm";
import pLimit from "p-limit";

const MEDIASTACK_API_KEY = process.env.MEDIASTACK_API_KEY;
const MEDIASTACK_BASE_URL = "http://api.mediastack.com/v1/news";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 15000;

const BUDGET_TRACKER_KEY = "system:mediastack_budget";

export interface MediastackNewsData {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
  source: "mediastack";
  paginationTotal: number;
}

export interface MediastackBatchStats {
  total: number;
  fetched: number;
  cached: number;
  failed: number;
  apiCallsMade: number;
  durationMs: number;
  successCount: number;
  nonZeroCount: number;
  successCoveragePct: number;
  nonZeroCoveragePct: number;
  top25NonZeroCount: number;
  top25Total: number;
  top25NonZeroCoveragePct: number;
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

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface MediastackApiResponse {
  pagination?: {
    limit: number;
    offset: number;
    count: number;
    total: number;
  };
  data?: Array<{
    author: string | null;
    title: string;
    description: string | null;
    url: string;
    source: string;
    image: string | null;
    category: string;
    language: string;
    country: string;
    published_at: string;
  }>;
  error?: {
    code: string;
    message: string;
    context?: any;
  };
}

async function fetchWithRetry(url: string): Promise<MediastackApiResponse | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`[Mediastack] Rate limited (429), attempt ${attempt}/${MAX_RETRIES}`);
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
            continue;
          }
          return null;
        }
        if (response.status >= 500) {
          console.warn(`[Mediastack] Server error (${response.status}), attempt ${attempt}/${MAX_RETRIES}`);
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
            continue;
          }
          return null;
        }
        const body = await response.text();
        console.error(`[Mediastack] HTTP ${response.status}: ${body.substring(0, 200)}`);
        return null;
      }

      const data: MediastackApiResponse = await response.json();

      if (data.error) {
        console.error(`[Mediastack] API error: ${data.error.code} - ${data.error.message}`);
        return null;
      }

      return data;
    } catch (error: any) {
      const errorType = error.name === 'AbortError' ? 'timeout' : 'network';
      if (attempt < MAX_RETRIES) {
        console.warn(`[Mediastack] ${errorType} error, retry ${attempt}/${MAX_RETRIES}`);
        await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
      } else {
        console.error(`[Mediastack] All ${MAX_RETRIES} attempts failed (${errorType})`);
        return null;
      }
    }
  }
  return null;
}

let _apiCallsThisRun = 0;

export function getApiCallsThisRun(): number {
  return _apiCallsThisRun;
}

export function resetApiCallCounter(): void {
  _apiCallsThisRun = 0;
}

export async function trackApiCall(): Promise<void> {
  _apiCallsThisRun++;

  try {
    const today = formatDate(new Date());
    const budgetKey = `${BUDGET_TRACKER_KEY}:${today}`;

    const existing = await db.select({ responseData: apiCache.responseData })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, budgetKey))
      .limit(1);

    const currentCount = existing.length > 0 && existing[0].responseData
      ? JSON.parse(existing[0].responseData).calls ?? 0
      : 0;

    const newData = JSON.stringify({
      calls: currentCount + 1,
      date: today,
      lastCallAt: new Date().toISOString(),
    });

    const farFuture = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (existing.length > 0) {
      await db.update(apiCache)
        .set({ responseData: newData, fetchedAt: new Date(), expiresAt: farFuture })
        .where(eq(apiCache.cacheKey, budgetKey));
    } else {
      await db.insert(apiCache).values({
        cacheKey: budgetKey,
        provider: "system",
        responseData: newData,
        fetchedAt: new Date(),
        expiresAt: farFuture,
      });
    }
  } catch (err) {
    // Budget tracking is non-critical, don't fail the pipeline
  }
}

export async function getDailyCallCount(date?: string): Promise<number> {
  const targetDate = date || formatDate(new Date());
  const budgetKey = `${BUDGET_TRACKER_KEY}:${targetDate}`;

  try {
    const row = await db.select({ responseData: apiCache.responseData })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, budgetKey))
      .limit(1);

    if (row.length > 0 && row[0].responseData) {
      return JSON.parse(row[0].responseData).calls ?? 0;
    }
  } catch (err) {}
  return 0;
}

export async function getMonthlyCallEstimate(): Promise<{ dailyCalls: number[]; totalThisMonth: number; projectedMonthly: number }> {
  const now = new Date();
  const dailyCalls: number[] = [];
  let total = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const count = await getDailyCallCount(formatDate(d));
    dailyCalls.push(count);
    total += count;
  }

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const avgDailyCalls = total / Math.min(7, dayOfMonth);
  const projectedMonthly = Math.round(avgDailyCalls * daysInMonth);

  return {
    dailyCalls,
    totalThisMonth: total,
    projectedMonthly,
  };
}

export async function fetchMediastackNews(
  personName: string,
  personId?: string,
): Promise<MediastackNewsData | null> {
  if (!MEDIASTACK_API_KEY) {
    console.log(`[Mediastack] No API key configured, skipping ${personName}`);
    return null;
  }

  const cacheKey = `mediastack:news:${personName.replace(/\s+/g, "_").toLowerCase()}`;
  const CACHE_TTL_HOURS = 2;

  try {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return JSON.parse(cached.responseData);
    }

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const keywords = encodeURIComponent(personName);
    const dateFrom = formatDate(yesterday);
    const dateTo = formatDate(now);

    const url = `${MEDIASTACK_BASE_URL}?access_key=${MEDIASTACK_API_KEY}&keywords=${keywords}&languages=en&sort=published_desc&limit=100&date=${dateFrom},${dateTo}`;

    const data = await fetchWithRetry(url);
    await trackApiCall();

    if (!data || !data.pagination) {
      return null;
    }

    const articleCount24h = data.pagination.total;
    const topHeadlines = (data.data || [])
      .slice(0, 3)
      .map(a => a.title || "");

    const result: MediastackNewsData = {
      query: personName,
      articleCount24h,
      articleCount7d: 0,
      averageDaily7d: 0,
      delta: 0,
      topHeadlines,
      source: "mediastack",
      paginationTotal: data.pagination.total,
    };

    await setCachedResponse(cacheKey, "mediastack", JSON.stringify(result), CACHE_TTL_HOURS);

    return result;
  } catch (error) {
    console.error(`[Mediastack] Error fetching news for ${personName}:`, error);
    return null;
  }
}

export async function fetchMediastackBatch(
  people: Array<{ id: string; name: string }>,
  concurrency: number = 3,
  delayMs: number = 400,
  options?: { cacheOnly?: boolean }
): Promise<{ data: Map<string, MediastackNewsData>; stats: MediastackBatchStats; isRefresh: boolean }> {
  const results = new Map<string, MediastackNewsData>();
  const startTime = Date.now();
  let fetched = 0;
  let cached = 0;
  let failed = 0;
  let apiCallsMade = 0;
  const cacheOnly = options?.cacheOnly ?? false;
  const limit = pLimit(concurrency);

  if (!MEDIASTACK_API_KEY) {
    console.log(`[Mediastack] No API key configured, skipping batch`);
    return {
      data: results,
      stats: { total: people.length, fetched: 0, cached: 0, failed: people.length, apiCallsMade: 0, durationMs: 0, successCount: 0, nonZeroCount: 0, successCoveragePct: 0, nonZeroCoveragePct: 0, top25NonZeroCount: 0, top25Total: Math.min(25, people.length), top25NonZeroCoveragePct: 0 },
      isRefresh: false,
    };
  }

  resetApiCallCounter();

  if (cacheOnly) {
    console.log(`[Mediastack] Cache-only mode — reusing cached data for ${people.length} people`);
  } else {
    console.log(`[Mediastack] Refresh mode — fetching fresh news for ${people.length} people (concurrency=${concurrency}, delay=${delayMs}ms)`);
  }

  const tasks = people.map((person, index) =>
    limit(async () => {
      if (index > 0 && !cacheOnly) {
        await sleep(delayMs);
      }

      const cacheKey = `mediastack:news:${person.name.replace(/\s+/g, "_").toLowerCase()}`;
      const cachedData = await getCachedResponse(cacheKey);

      if (cachedData) {
        const parsed = JSON.parse(cachedData.responseData) as MediastackNewsData;
        results.set(person.id, parsed);
        cached++;
        return;
      }

      if (cacheOnly) {
        failed++;
        return;
      }

      const result = await fetchMediastackNews(person.name, person.id);
      if (result) {
        results.set(person.id, result);
        fetched++;
        apiCallsMade++;
      } else {
        failed++;
      }
    })
  );

  await Promise.all(tasks);

  if (!cacheOnly && fetched > 0) {
    await setLastMediastackFetchAt(new Date());
  }

  const durationMs = Date.now() - startTime;

  const successCount = results.size;
  let nonZeroCount = 0;
  results.forEach((entry) => {
    if ((entry.articleCount24h ?? 0) > 0) nonZeroCount++;
  });

  const top25Ids = new Set(people.slice(0, 25).map(p => p.id));
  let top25NonZeroCount = 0;
  top25Ids.forEach((pid) => {
    const entry = results.get(pid);
    if (entry && (entry.articleCount24h ?? 0) > 0) top25NonZeroCount++;
  });
  const top25Total = Math.min(25, people.length);

  const stats: MediastackBatchStats = {
    total: people.length,
    fetched,
    cached,
    failed,
    apiCallsMade: getApiCallsThisRun(),
    durationMs,
    successCount,
    nonZeroCount,
    successCoveragePct: people.length > 0 ? (successCount / people.length) * 100 : 0,
    nonZeroCoveragePct: people.length > 0 ? (nonZeroCount / people.length) * 100 : 0,
    top25NonZeroCount,
    top25Total,
    top25NonZeroCoveragePct: top25Total > 0 ? (top25NonZeroCount / top25Total) * 100 : 0,
  };

  console.log(`[Mediastack] Batch complete: ${fetched} fresh + ${cached} cached + ${failed} failed = ${results.size}/${people.length} in ${(durationMs / 1000).toFixed(1)}s (${stats.apiCallsMade} API calls, success=${stats.successCoveragePct.toFixed(0)}%, nonZero=${stats.nonZeroCoveragePct.toFixed(0)}%)`);

  return { data: results, stats, isRefresh: !cacheOnly && fetched > 0 };
}

export function isMediastackConfigured(): boolean {
  return !!MEDIASTACK_API_KEY;
}

const LAST_FETCH_KEY = "system:mediastack:last_fetch_at";
const MEDIASTACK_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;

export async function getLastMediastackFetchAt(): Promise<Date | null> {
  try {
    const row = await db.select({ responseData: apiCache.responseData })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, LAST_FETCH_KEY))
      .limit(1);
    if (row.length > 0 && row[0].responseData) {
      const parsed = JSON.parse(row[0].responseData);
      return parsed.fetchedAt ? new Date(parsed.fetchedAt) : null;
    }
  } catch {}
  return null;
}

export async function setLastMediastackFetchAt(timestamp: Date): Promise<void> {
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

export async function shouldRefreshMediastack(): Promise<{ shouldRefresh: boolean; lastFetchAt: Date | null; ageMs: number | null }> {
  const lastFetch = await getLastMediastackFetchAt();
  if (!lastFetch) {
    return { shouldRefresh: true, lastFetchAt: null, ageMs: null };
  }
  const ageMs = Date.now() - lastFetch.getTime();
  return {
    shouldRefresh: ageMs >= MEDIASTACK_REFRESH_INTERVAL_MS,
    lastFetchAt: lastFetch,
    ageMs,
  };
}
