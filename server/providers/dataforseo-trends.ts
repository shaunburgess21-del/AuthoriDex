// ============================================================================
// DataForSEO Google Trends Provider (May 2026 — Search Momentum)
// ============================================================================
// Fetches relative Google search interest (0–100, self-normalised per keyword)
// via DataForSEO `dataforseo_trends/explore/live`. One keyword per task so each
// person's score is normalised against their own peak, not the loudest person
// in a shared batch. Multiple tasks are packed into a single POST (faster than
// SerpApi's per-person HTTP + 250ms delay).
//
// Window: `past_day` (24 hourly points). Headline "current interest" = mean of
// the last ~3 hourly points; baseline = full-series mean — same math as the
// retired SerpApi provider via `computeTrendsCurrentInterest()`.

import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import { toApiKeyword } from "./search-volume-window";
import { TRENDS_DFS_WINDOW, type TrendsTimeseriesPoint } from "./trends-window";
import {
  parseDataForSeoTrendsExploreTask,
  trendsBatchResultFromSeries,
  type TrendsBatchResult,
} from "./dataforseo-trends-parse";

export {
  parseDataForSeoTrendsExploreTask,
  trendsBatchResultFromSeries,
} from "./dataforseo-trends-parse";

export type { TrendsTimeseriesPoint } from "./trends-window";
export {
  computeTrendsCurrentInterest,
  computeTrendsMomentumDeltaPct,
  shouldFetchGoogleTrends,
  TRENDS_DELTA_METHOD,
  TRENDS_DFS_WINDOW,
  TRENDS_FETCH_INTERVAL_MS,
  TRENDS_MOMENTUM_DEAD_ZONE_PCT,
} from "./trends-window";

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const DATAFORSEO_LOCATION_CODE = Number(process.env.DATAFORSEO_LOCATION_CODE) || 2840;

const LIVE_URL =
  "https://api.dataforseo.com/v3/keywords_data/dataforseo_trends/explore/live";
const REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_TASKS_PER_REQUEST = 100;
// Cache TTL — must stay below ingest TRENDS_FETCH_INTERVAL_MS (12h).
const TRENDS_DATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrendsBatchInput {
  personId: string;
  name: string;
  /** Optional per-person keyword override (same field as search volume / Serper). */
  keywordOverride?: string | null;
}

export type { TrendsBatchResult } from "./dataforseo-trends-parse";

// ---------------------------------------------------------------------------
// Run stats
// ---------------------------------------------------------------------------

let _callsAttempted = 0;
let _retryCount = 0;
let _timeoutCount = 0;
let _finalFailures = 0;
let _totalCostUsd = 0;

export function getDataForSeoTrendsRunStats() {
  return {
    callsAttempted: _callsAttempted,
    retriesUsed: _retryCount,
    timeoutCount: _timeoutCount,
    finalFailures: _finalFailures,
    totalCostUsd: Math.round(_totalCostUsd * 10000) / 10000,
  };
}

export function resetDataForSeoTrendsRunStats() {
  _callsAttempted = 0;
  _retryCount = 0;
  _timeoutCount = 0;
  _finalFailures = 0;
  _totalCostUsd = 0;
}

export function isDataForSeoTrendsConfigured(): boolean {
  return !!(DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD);
}

// ---------------------------------------------------------------------------
// DB cache
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

async function setCache(cacheKey: string, data: unknown, personId?: string): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TRENDS_DATA_CACHE_TTL_MS);
    await db
      .insert(apiCache)
      .values({
        cacheKey,
        provider: "dataforseo_trends",
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
          provider: "dataforseo_trends",
        },
      });
  } catch (e) {
    console.warn(`[DataForSEO Trends] Cache write failed for ${cacheKey}:`, (e as Error).message);
  }
}

function authHeader(): string {
  const cred = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString("base64");
  return `Basic ${cred}`;
}

function resolveKeyword(p: TrendsBatchInput): string {
  const raw = (p.keywordOverride && p.keywordOverride.trim()) || p.name;
  return toApiKeyword(raw);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function dfsTrendsFetch(tasks: Array<Record<string, unknown>>): Promise<any | null> {
  _callsAttempted++;
  const body = JSON.stringify(tasks);

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
        if (json?.status_code && json.status_code !== 20000) {
          console.error(
            `[DataForSEO Trends] API error ${json.status_code}: ${json.status_message ?? "(no message)"}`,
          );
          _finalFailures++;
          return null;
        }
        return json;
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        _retryCount++;
        const backoff = 2000 + Math.random() * 1000;
        console.warn(
          `[DataForSEO Trends] HTTP ${res.status} on attempt ${attempt}, retrying in ${Math.round(backoff)}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      console.error(
        `[DataForSEO Trends] HTTP ${res.status}: ${await res.text().catch(() => "(no body)")}`,
      );
      _finalFailures++;
      return null;
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === "AbortError";
      if (isTimeout) _timeoutCount++;
      console.warn(
        `[DataForSEO Trends] ${isTimeout ? "Timeout" : "Network error"} on attempt ${attempt}:`,
        err?.message ?? err,
      );
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

function buildTaskPayload(keyword: string): Record<string, unknown> {
  return {
    keywords: [keyword],
    location_code: DATAFORSEO_LOCATION_CODE,
    type: "web",
    time_range: TRENDS_DFS_WINDOW,
  };
}

// ---------------------------------------------------------------------------
// fetchDataForSeoTrendsBatch
// ---------------------------------------------------------------------------

/**
 * Fetch Google Trends-style relative interest for each person. Returns the same
 * shape SerpApi produced so ingest persistence stays unchanged.
 */
export async function fetchDataForSeoTrendsBatch(
  people: TrendsBatchInput[],
): Promise<TrendsBatchResult[]> {
  if (!isDataForSeoTrendsConfigured()) {
    console.warn(
      "[DataForSEO Trends] DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set — skipping Trends fetch",
    );
    return [];
  }
  if (people.length === 0) return [];

  // Resolve each person → keyword. People that resolve to the same keyword
  // (e.g. via an identical override) share one task/cache entry — Trends data
  // for a keyword is identical regardless of who asked, so this avoids paying
  // for duplicate work. `seriesByKeyword` is the single source of truth that
  // every person is mapped back from at the end.
  const keywordByPerson = new Map<string, string>();
  const uniqueKeywords = new Set<string>();
  for (const p of people) {
    const keyword = resolveKeyword(p);
    keywordByPerson.set(p.personId, keyword);
    if (keyword) uniqueKeywords.add(keyword);
  }

  const seriesByKeyword = new Map<string, TrendsTimeseriesPoint[]>();
  const toFetch: string[] = [];
  for (const keyword of uniqueKeywords) {
    const cacheKey = `dataforseo_trends:person:${keyword}:${TRENDS_DFS_WINDOW}`;
    const cached = await getCached(cacheKey);
    if (cached && Array.isArray(cached.series)) {
      seriesByKeyword.set(keyword, cached.series as TrendsTimeseriesPoint[]);
    } else {
      toFetch.push(keyword);
    }
  }

  for (let i = 0; i < toFetch.length; i += MAX_TASKS_PER_REQUEST) {
    const chunk = toFetch.slice(i, i + MAX_TASKS_PER_REQUEST);
    const json = await dfsTrendsFetch(chunk.map((kw) => buildTaskPayload(kw)));
    const tasks: unknown[] = Array.isArray(json?.tasks) ? json.tasks : [];

    for (let j = 0; j < chunk.length; j++) {
      const keyword = chunk[j];
      const series = parseDataForSeoTrendsExploreTask(tasks[j]);
      seriesByKeyword.set(keyword, series);
      if (series.length > 0) {
        const cacheKey = `dataforseo_trends:person:${keyword}:${TRENDS_DFS_WINDOW}`;
        await setCache(cacheKey, { series });
      }
    }
  }

  return people.map((p) => {
    const keyword = keywordByPerson.get(p.personId) ?? "";
    const series = keyword ? seriesByKeyword.get(keyword) ?? [] : [];
    return trendsBatchResultFromSeries(p.personId, series);
  });
}
