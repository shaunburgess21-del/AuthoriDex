/**
 * Pure parsers for CurrentsAPI search responses. No DB or network imports.
 */

/** Builder default daily limit; used for budget % when header missing. */
export const CURRENTS_DAILY_LIMIT_DEFAULT = 2500;

const BUDGET_HARD_STOP_REMAINING_PCT = 0.05;

export interface CurrentsRateLimitSnapshot {
  limit: number;
  remaining: number;
  resetTime: string | null;
  capturedAt: string;
}

export function parseRateLimitHeaders(headers: Headers): CurrentsRateLimitSnapshot | null {
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const limitRaw = headers.get("x-ratelimit-limit");
  if (remainingRaw == null && limitRaw == null) return null;

  const limit = limitRaw != null ? parseInt(limitRaw, 10) : CURRENTS_DAILY_LIMIT_DEFAULT;
  const remaining = remainingRaw != null ? parseInt(remainingRaw, 10) : NaN;
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return null;

  return {
    limit,
    remaining,
    resetTime: headers.get("x-ratelimit-reset-time"),
    capturedAt: new Date().toISOString(),
  };
}

export function shouldHardStopFromRateLimit(
  snapshot: CurrentsRateLimitSnapshot | null,
): boolean {
  if (!snapshot) return false;
  const floor = Math.max(1, Math.floor(snapshot.limit * BUDGET_HARD_STOP_REMAINING_PCT));
  return snapshot.remaining <= floor;
}

/**
 * Search keywords for /v1/search. Mirrors GDELT disambiguation: honour
 * `searchQueryOverride` OR-clauses when set, else the display name.
 */
export function buildCurrentsKeywords(
  personName: string,
  searchQueryOverride?: string | null,
): string {
  if (searchQueryOverride?.trim()) {
    const parts = searchQueryOverride
      .split(/\s+OR\s+/i)
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" OR ");
  }
  return personName;
}

export interface CurrentsNewsArticleRef {
  url: string;
  title?: string;
  publishedAt?: string;
}

export interface ParsedCurrentsSearch {
  query: string;
  articleCount24h: number;
  topHeadlines: string[];
  articles: CurrentsNewsArticleRef[];
}

export interface CurrentsSearchArticle {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  author?: string | null;
  image?: string | null;
  language?: string;
  category?: string[];
  published?: string;
}

export interface CurrentsSearchResponseBody {
  status?: string;
  news?: CurrentsSearchArticle[];
  page?: number;
  msg?: string;
}

/**
 * Normalise Currents published timestamps to ISO-8601 for storage/display.
 * Input example: "2026-03-24 11:10:00 +0000"
 */
export function normalizeCurrentsPublished(raw: string | undefined): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  let s = trimmed.replace(" ", "T").replace(/\s+([+-]\d{4})$/, "$1");
  const t = Date.parse(s);
  if (Number.isNaN(t)) {
    const fallback = Date.parse(trimmed);
    if (Number.isNaN(fallback)) return trimmed;
    return new Date(fallback).toISOString();
  }
  return new Date(t).toISOString();
}

/**
 * Map a /v1/search JSON body into ingest-friendly news fields.
 */
export function parseCurrentsSearchResponse(
  body: CurrentsSearchResponseBody | null | undefined,
  query: string,
): ParsedCurrentsSearch {
  const articles: CurrentsNewsArticleRef[] = [];
  const topHeadlines: string[] = [];

  if (!body || body.status !== "ok" || !Array.isArray(body.news)) {
    return {
      query,
      articleCount24h: 0,
      topHeadlines: [],
      articles: [],
    };
  }

  for (const item of body.news) {
    if (!item?.url) continue;
    const title = item.title?.trim() || undefined;
    articles.push({
      url: item.url,
      title,
      publishedAt: normalizeCurrentsPublished(item.published),
    });
    if (title && topHeadlines.length < 3) {
      topHeadlines.push(title);
    }
  }

  return {
    query,
    articleCount24h: articles.length,
    topHeadlines,
    articles,
  };
}
