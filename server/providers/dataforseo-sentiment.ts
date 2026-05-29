// ============================================================================
// DataForSEO Content Analysis Provider (May 2026 — Web Sentiment)
// ============================================================================
// Corpus-wide citation sentiment for a person's name via
// content_analysis/summary/live. One keyword per task; tasks batched per POST.
// Headline = positive / (positive + negative); neutral shown in the 3-segment bar.

import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sanitizeKeyword } from "./search-volume-window";
import {
  parseSentimentSummaryTask,
  webSentimentReadingFromCounts,
  WEB_SENTIMENT_WINDOW,
  type WebSentimentReading,
} from "./sentiment-window";

export {
  SENTIMENT_FETCH_INTERVAL_MS,
  shouldFetchWebSentiment,
  parseSentimentSummaryTask,
  computePositivePct,
  webSentimentLevel,
  webSentimentReadingFromCounts,
  WEB_SENTIMENT_METHOD,
  WEB_SENTIMENT_WINDOW,
  WEB_SENTIMENT_MIN_MENTIONS,
  WEB_SENTIMENT_MIN_OPINIONATED,
  type SentimentCounts,
  type WebSentimentReading,
} from "./sentiment-window";

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;

const LIVE_URL = "https://api.dataforseo.com/v3/content_analysis/summary/live";
const REQUEST_TIMEOUT_MS = 60_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_TASKS_PER_REQUEST = 100;
const CACHE_TTL_MS = 6 * 24 * 60 * 60 * 1000;

const PAGE_TYPES = ["news", "blogs", "message-boards"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebSentimentBatchInput {
  personId: string;
  name: string;
  keywordOverride?: string | null;
}

export interface WebSentimentBatchResult extends WebSentimentReading {
  personId: string;
}

// ---------------------------------------------------------------------------
// Run stats
// ---------------------------------------------------------------------------

let _callsAttempted = 0;
let _retryCount = 0;
let _timeoutCount = 0;
let _finalFailures = 0;
let _totalCostUsd = 0;

export function getWebSentimentRunStats() {
  return {
    callsAttempted: _callsAttempted,
    retriesUsed: _retryCount,
    timeoutCount: _timeoutCount,
    finalFailures: _finalFailures,
    totalCostUsd: Math.round(_totalCostUsd * 10000) / 10000,
  };
}

export function resetWebSentimentRunStats() {
  _callsAttempted = 0;
  _retryCount = 0;
  _timeoutCount = 0;
  _finalFailures = 0;
  _totalCostUsd = 0;
}

export function isWebSentimentConfigured(): boolean {
  return !!(DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD);
}

// ---------------------------------------------------------------------------
// Keyword + cache
// ---------------------------------------------------------------------------

/** Content Analysis keyword: sanitized; multi-word → exact phrase. */
export function toContentAnalysisKeyword(raw: string): string {
  const s = sanitizeKeyword(raw);
  if (!s) return "";
  if (s.includes(" ")) return `"${s}"`;
  return s;
}

function resolveKeyword(p: WebSentimentBatchInput): string {
  const raw = (p.keywordOverride && p.keywordOverride.trim()) || p.name;
  return toContentAnalysisKeyword(raw);
}

async function getCached(cacheKey: string): Promise<WebSentimentReading | null> {
  try {
    const rows = await db
      .select()
      .from(apiCache)
      .where(eq(apiCache.cacheKey, cacheKey))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expiresAt) < new Date()) return null;
    const parsed = JSON.parse(row.responseData);
    if (parsed && typeof parsed === "object" && "positive" in parsed) {
      return parsed as WebSentimentReading;
    }
    return null;
  } catch {
    return null;
  }
}

async function setCache(cacheKey: string, data: WebSentimentReading): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    await db
      .insert(apiCache)
      .values({
        cacheKey,
        provider: "dataforseo_sentiment",
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
          provider: "dataforseo_sentiment",
        },
      });
  } catch (e) {
    console.warn(`[DataForSEO Sentiment] Cache write failed for ${cacheKey}:`, (e as Error).message);
  }
}

function authHeader(): string {
  const cred = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString("base64");
  return `Basic ${cred}`;
}

function buildTaskPayload(personId: string, keyword: string): Record<string, unknown> {
  return {
    keyword,
    tag: personId,
    page_type: [...PAGE_TYPES],
    positive_connotation_threshold: 0.4,
  };
}

function emptyResult(personId: string): WebSentimentBatchResult {
  return {
    personId,
    positive: 0,
    negative: 0,
    neutral: 0,
    total: 0,
    positivePct: null,
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function dfsSentimentFetch(tasks: Array<Record<string, unknown>>): Promise<any | null> {
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
            `[DataForSEO Sentiment] API error ${json.status_code}: ${json.status_message ?? "(no message)"}`,
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
          `[DataForSEO Sentiment] HTTP ${res.status} on attempt ${attempt}, retrying in ${Math.round(backoff)}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      console.error(
        `[DataForSEO Sentiment] HTTP ${res.status}: ${await res.text().catch(() => "(no body)")}`,
      );
      _finalFailures++;
      return null;
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === "AbortError";
      if (isTimeout) _timeoutCount++;
      console.warn(
        `[DataForSEO Sentiment] ${isTimeout ? "Timeout" : "Network error"} on attempt ${attempt}:`,
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

function readingFromTask(task: unknown): WebSentimentReading | null {
  const counts = parseSentimentSummaryTask(task);
  if (!counts) return null;
  return webSentimentReadingFromCounts(counts);
}

// ---------------------------------------------------------------------------
// fetchWebSentimentBatch
// ---------------------------------------------------------------------------

export async function fetchWebSentimentBatch(
  people: WebSentimentBatchInput[],
): Promise<WebSentimentBatchResult[]> {
  if (!isWebSentimentConfigured()) {
    console.warn(
      "[DataForSEO Sentiment] DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set — skipping",
    );
    return [];
  }
  if (people.length === 0) return [];

  const keywordByPerson = new Map<string, string>();
  const uniqueKeywords = new Set<string>();
  for (const p of people) {
    const keyword = resolveKeyword(p);
    keywordByPerson.set(p.personId, keyword);
    if (keyword) uniqueKeywords.add(keyword);
  }

  const readingByKeyword = new Map<string, WebSentimentReading>();
  const toFetch: string[] = [];

  for (const keyword of uniqueKeywords) {
    const cacheKey = `dataforseo_sentiment:person:${keyword}:${WEB_SENTIMENT_WINDOW}`;
    const cached = await getCached(cacheKey);
    if (cached) {
      readingByKeyword.set(keyword, cached);
    } else {
      toFetch.push(keyword);
    }
  }

  const keywordToPersonId = new Map<string, string>();
  for (const p of people) {
    const kw = keywordByPerson.get(p.personId) ?? "";
    if (kw && !keywordToPersonId.has(kw)) keywordToPersonId.set(kw, p.personId);
  }

  for (let i = 0; i < toFetch.length; i += MAX_TASKS_PER_REQUEST) {
    const chunk = toFetch.slice(i, i + MAX_TASKS_PER_REQUEST);
    const tasks = chunk.map((kw) => {
      const personId = keywordToPersonId.get(kw) ?? `kw:${kw}`;
      return buildTaskPayload(personId, kw);
    });

    const json = await dfsSentimentFetch(tasks);
    const taskList: unknown[] = Array.isArray(json?.tasks) ? json.tasks : [];

    const byTag = new Map<string, unknown>();
    for (const task of taskList) {
      const tag = (task as { data?: { tag?: string } })?.data?.tag;
      if (tag) byTag.set(tag, task);
    }

    for (const kw of chunk) {
      const personId = keywordToPersonId.get(kw) ?? "";
      const task = personId ? byTag.get(personId) : taskList[chunk.indexOf(kw)];
      if (task) {
        const statusCode = (task as { status_code?: number }).status_code;
        if (statusCode != null && statusCode !== 20000) {
          const msg = (task as { status_message?: string }).status_message;
          console.warn(
            `[DataForSEO Sentiment] task ${statusCode} for keyword ${kw}: ${msg ?? "(no message)"}`,
          );
        }
      }
      const reading = task ? readingFromTask(task) : null;
      const value: WebSentimentReading = reading ?? {
        positive: 0,
        negative: 0,
        neutral: 0,
        total: 0,
        positivePct: null,
      };
      readingByKeyword.set(kw, value);
      if (reading && (reading.positive + reading.negative + reading.neutral) > 0) {
        const cacheKey = `dataforseo_sentiment:person:${kw}:${WEB_SENTIMENT_WINDOW}`;
        await setCache(cacheKey, value);
      }
    }
  }

  return people.map((p) => {
    const keyword = keywordByPerson.get(p.personId) ?? "";
    const reading = keyword ? readingByKeyword.get(keyword) : undefined;
    if (!reading) return emptyResult(p.personId);
    return { personId: p.personId, ...reading };
  });
}
