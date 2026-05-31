/**
 * DataForSEO Google News SERP — cascade fallback after Currents (tail only).
 * One live/advanced task per person; counts actual news_search items returned.
 */
import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import { toApiKeyword } from "./search-volume-window";
import {
  DATAFORSEO_NEWS_DEFAULT_DEPTH,
  parseDataForSeoNewsTaskResult,
  type ParsedDataForSeoNews,
} from "./dataforseo-news-parse";

export type { ParsedDataForSeoNews, DataForSeoNewsArticleRef } from "./dataforseo-news-parse";
export { parseDataForSeoNewsTaskResult, DATAFORSEO_NEWS_DEFAULT_DEPTH } from "./dataforseo-news-parse";

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const DATAFORSEO_LOCATION_CODE = Number(process.env.DATAFORSEO_LOCATION_CODE) || 2840;

const LIVE_URL = "https://api.dataforseo.com/v3/serp/google/news/live/advanced";
const REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const FETCH_CONCURRENCY = 6;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

const NEWS_DEPTH = (() => {
  const raw = parseInt(process.env.DATAFORSEO_NEWS_DEPTH ?? String(DATAFORSEO_NEWS_DEFAULT_DEPTH), 10);
  if (!Number.isFinite(raw) || raw < 10) return DATAFORSEO_NEWS_DEFAULT_DEPTH;
  return Math.min(200, raw);
})();

const DAILY_CALL_CAP = (() => {
  const raw = parseInt(process.env.DATAFORSEO_NEWS_DAILY_CALL_CAP ?? "700", 10);
  if (!Number.isFinite(raw) || raw < 1) return 700;
  return raw;
})();

export interface DataForSeoNewsInput {
  personId: string;
  name: string;
  keywordOverride?: string | null;
}

export interface DataForSeoNewsData {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
  source: "dataforseo_news";
  articles: Array<{ url: string; title?: string; publishedAt?: string }>;
}

export interface DataForSeoNewsBatchStats {
  total: number;
  fetched: number;
  cached: number;
  failed: number;
  cacheOnly: boolean;
  budgetThrottled: boolean;
  apiCallsMade: number;
  durationMs: number;
  successCount: number;
  nonZeroCount: number;
}

let _callsAttempted = 0;
let _retryCount = 0;
let _timeoutCount = 0;
let _finalFailures = 0;
let _totalCostUsd = 0;
let _dailyCalls = 0;
let _dailyCallsDayKey = "";

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function resetDailyCounterIfNeeded(): void {
  const key = dayKey();
  if (key !== _dailyCallsDayKey) {
    _dailyCallsDayKey = key;
    _dailyCalls = 0;
  }
}

function canMakeLiveCall(): boolean {
  resetDailyCounterIfNeeded();
  return _dailyCalls < DAILY_CALL_CAP;
}

function recordLiveCall(): void {
  resetDailyCounterIfNeeded();
  _dailyCalls++;
}

export function getDataForSeoNewsRunStats() {
  resetDailyCounterIfNeeded();
  return {
    callsAttempted: _callsAttempted,
    retriesUsed: _retryCount,
    timeoutCount: _timeoutCount,
    finalFailures: _finalFailures,
    totalCostUsd: Math.round(_totalCostUsd * 10000) / 10000,
    dailyCalls: _dailyCalls,
    dailyCallCap: DAILY_CALL_CAP,
  };
}

export function resetDataForSeoNewsRunStats() {
  _callsAttempted = 0;
  _retryCount = 0;
  _timeoutCount = 0;
  _finalFailures = 0;
  _totalCostUsd = 0;
}

export function isDataForSeoNewsConfigured(): boolean {
  return !!(DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD);
}

function authHeader(): string {
  const cred = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString("base64");
  return `Basic ${cred}`;
}

function resolveKeyword(p: DataForSeoNewsInput): string {
  const raw = (p.keywordOverride && p.keywordOverride.trim()) || p.name;
  return toApiKeyword(raw);
}

function cacheKeyFor(keyword: string): string {
  return `dataforseo_news:${DATAFORSEO_LOCATION_CODE}:${keyword.replace(/\s+/g, "_")}`;
}

async function getCached(cacheKey: string): Promise<ParsedDataForSeoNews | null> {
  try {
    const rows = await db.select().from(apiCache).where(eq(apiCache.cacheKey, cacheKey)).limit(1);
    const row = rows[0];
    if (!row || new Date(row.expiresAt) < new Date()) return null;
    return JSON.parse(row.responseData) as ParsedDataForSeoNews;
  } catch {
    return null;
  }
}

async function setCache(cacheKey: string, data: ParsedDataForSeoNews, personId: string): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    await db
      .insert(apiCache)
      .values({
        cacheKey,
        provider: "dataforseo_news",
        personId,
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
          provider: "dataforseo_news",
        },
      });
  } catch (e) {
    console.warn(`[DataForSEO News] Cache write failed:`, (e as Error).message);
  }
}

function toNewsData(parsed: ParsedDataForSeoNews): DataForSeoNewsData {
  const n = parsed.articleCount24h;
  return {
    query: parsed.query,
    articleCount24h: n,
    articleCount7d: 0,
    averageDaily7d: 0,
    delta: n > 0 ? 1 : 0,
    topHeadlines: parsed.topHeadlines,
    source: "dataforseo_news",
    articles: parsed.articles,
  };
}

async function dfsNewsFetch(task: Record<string, unknown>): Promise<any | null> {
  _callsAttempted++;
  const body = JSON.stringify([task]);

  for (let attempt = 1; attempt <= 2; attempt++) {
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
        if (json?.status_code && json.status_code !== 20000) {
          console.error(
            `[DataForSEO News] API error ${json.status_code}: ${json.status_message ?? "?"}`,
          );
          _finalFailures++;
          return null;
        }
        const taskStatus = json?.tasks?.[0]?.status_code;
        if (taskStatus && taskStatus !== 20000) {
          console.warn(`[DataForSEO News] Task error ${taskStatus}: ${json?.tasks?.[0]?.status_message ?? "?"}`);
          _finalFailures++;
          return null;
        }
        return json;
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < 2) {
        _retryCount++;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      _finalFailures++;
      return null;
    } catch (err: unknown) {
      clearTimeout(timer);
      if ((err as Error)?.name === "AbortError") _timeoutCount++;
      if (attempt < 2) {
        _retryCount++;
        continue;
      }
      _finalFailures++;
      return null;
    }
  }
  return null;
}

function buildTaskPayload(keyword: string): Record<string, unknown> {
  return {
    keyword,
    location_code: DATAFORSEO_LOCATION_CODE,
    language_code: "en",
    depth: NEWS_DEPTH,
  };
}

async function fetchOnePerson(
  p: DataForSeoNewsInput,
  options: { cacheOnly?: boolean },
): Promise<DataForSeoNewsData | null> {
  const keyword = resolveKeyword(p);
  const cacheKey = cacheKeyFor(keyword);
  const cached = await getCached(cacheKey);
  if (cached) return toNewsData(cached);

  if (options.cacheOnly || !canMakeLiveCall()) {
    return null;
  }

  recordLiveCall();
  const json = await dfsNewsFetch(buildTaskPayload(keyword));
  if (!json) return null;

  const result = json?.tasks?.[0]?.result?.[0];
  const parsed = parseDataForSeoNewsTaskResult(result, p.name);
  await setCache(cacheKey, parsed, p.personId);
  return toNewsData(parsed);
}

export async function fetchDataForSeoNewsBatch(
  people: DataForSeoNewsInput[],
  options?: { cacheOnly?: boolean; budgetThrottled?: boolean },
): Promise<{ data: Map<string, DataForSeoNewsData>; stats: DataForSeoNewsBatchStats }> {
  const start = Date.now();
  const data = new Map<string, DataForSeoNewsData>();
  const cacheOnly = options?.cacheOnly ?? options?.budgetThrottled ?? !canMakeLiveCall();

  if (!isDataForSeoNewsConfigured()) {
    console.warn("[DataForSEO News] Not configured — skipping batch");
    return {
      data,
      stats: {
        total: people.length,
        fetched: 0,
        cached: 0,
        failed: people.length,
        cacheOnly: true,
        budgetThrottled: false,
        apiCallsMade: 0,
        durationMs: 0,
        successCount: 0,
        nonZeroCount: 0,
      },
    };
  }

  if (people.length === 0) {
    return {
      data,
      stats: {
        total: 0,
        fetched: 0,
        cached: 0,
        failed: 0,
        cacheOnly,
        budgetThrottled: !canMakeLiveCall(),
        apiCallsMade: 0,
        durationMs: 0,
        successCount: 0,
        nonZeroCount: 0,
      },
    };
  }

  console.log(
    `[DataForSEO News] Batch: ${people.length} people, depth=${NEWS_DEPTH}, ` +
      `cacheOnly=${cacheOnly}, cap=${DAILY_CALL_CAP}/day`,
  );

  let fetched = 0;
  let cached = 0;
  let failed = 0;
  let apiCallsMade = 0;

  const toFetch = [...people];
  let cursor = 0;

  const worker = async () => {
    while (cursor < toFetch.length) {
      const person = toFetch[cursor++];
      const keyword = resolveKeyword(person);
      const cacheKey = cacheKeyFor(keyword);
      const hit = await getCached(cacheKey);
      if (hit) {
        data.set(person.personId, toNewsData(hit));
        cached++;
        continue;
      }
      if (cacheOnly) {
        failed++;
        continue;
      }
      apiCallsMade++;
      const result = await fetchOnePerson(person, { cacheOnly: false });
      if (result) {
        data.set(person.personId, result);
        if (result.articleCount24h > 0) fetched++;
        else cached++;
      } else {
        failed++;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, toFetch.length) }, () => worker()),
  );

  let nonZeroCount = 0;
  data.forEach((v) => {
    if (v.articleCount24h > 0) nonZeroCount++;
  });

  const stats: DataForSeoNewsBatchStats = {
    total: people.length,
    fetched,
    cached,
    failed,
    cacheOnly,
    budgetThrottled: !canMakeLiveCall(),
    apiCallsMade,
    durationMs: Date.now() - start,
    successCount: data.size,
    nonZeroCount,
  };

  console.log(
    `[DataForSEO News] Batch complete: ${data.size}/${people.length} with data, ` +
      `${fetched} non-zero fresh, ${cached} cached, ${failed} empty, ` +
      `${apiCallsMade} API calls, $${_totalCostUsd.toFixed(4)}, ${(stats.durationMs / 1000).toFixed(1)}s`,
  );

  return { data, stats };
}
