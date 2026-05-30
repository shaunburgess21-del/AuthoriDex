/**
 * Pure GDELT artlist URL builder + response parser (no DB/network).
 */

export const GDELT_24H_MAX_RECORDS = 100;

/** URL-bearing GDELT articles available for union merge (honest diagnostics). */
export function gdeltUnionAttributionCount(
  gd: { articles?: Array<{ url: string }> } | undefined,
): number {
  return gd?.articles?.length ?? 0;
}

/**
 * Align stored counts with URL-bearing articles when `articles[]` is present.
 * Legacy cache rows may have articleCount24h > 0 but no articles (phantom counts).
 */
export function normalizeGdeltNewsData(data: GdeltNewsDataLike): GdeltNewsDataLike {
  if (Array.isArray(data.articles)) {
    const urlCount = data.articles.length;
    return {
      ...data,
      articleCount24h: urlCount,
      articleCount7d: 0,
      averageDaily7d: 0,
      delta: urlCount > 0 ? 1 : 0,
    };
  }
  // Legacy cache rows: non-zero count but no URL list cannot join the union.
  if ((data.articleCount24h ?? 0) > 0) {
    return {
      ...data,
      articleCount24h: 0,
      articleCount7d: 0,
      averageDaily7d: 0,
      delta: 0,
      articles: [],
    };
  }
  return data;
}

/** Minimal shape for normalizeGdeltNewsData (avoids circular import with gdelt.ts). */
export interface GdeltNewsDataLike {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
  articles?: Array<{ url: string; title?: string; publishedAt?: string }>;
}

export interface ParsedGdelt24h {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
  articles: Array<{ url: string; title?: string; publishedAt?: string }>;
}

const GDELT_API_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

export function formatGdeltDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "") + "000000";
}

export function buildGdeltQueryText(
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
  return `"${personName}"`;
}

/** Single 24h artlist URL (no 7d companion call). */
export function buildGdelt24hArtlistUrl(
  personName: string,
  now: Date,
  searchQueryOverride?: string | null,
): string {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const queryText = buildGdeltQueryText(personName, searchQueryOverride);
  const query = encodeURIComponent(queryText);
  return `${GDELT_API_BASE}?query=${query}&mode=artlist&maxrecords=${GDELT_24H_MAX_RECORDS}&format=json&startdatetime=${formatGdeltDate(yesterday)}&enddatetime=${formatGdeltDate(now)}`;
}

export interface GdeltArtlistArticle {
  url?: string;
  title?: string;
  seendate?: string;
}

export interface GdeltArtlistResponseBody {
  articles?: GdeltArtlistArticle[];
}

/** Map 24h artlist JSON into ingest fields; 7d stats are always zero (history-sourced in ingest). */
export function parseGdelt24hArtlistResponse(
  body: GdeltArtlistResponseBody | null | undefined,
  queryLabel: string,
): ParsedGdelt24h {
  if (!body?.articles) {
    return {
      query: queryLabel,
      articleCount24h: 0,
      articleCount7d: 0,
      averageDaily7d: 0,
      delta: 0,
      topHeadlines: [],
      articles: [],
    };
  }

  const topHeadlines = body.articles
    .slice(0, 3)
    .map((a) => a.title || "");
  const articles = body.articles
    .filter((a) => !!a.url)
    .map((a) => ({
      url: a.url!,
      title: a.title,
      publishedAt: a.seendate,
    }));
  const articleCount24h = articles.length;

  return {
    query: queryLabel,
    articleCount24h,
    articleCount7d: 0,
    averageDaily7d: 0,
    delta: articleCount24h > 0 ? 1 : 0,
    topHeadlines,
    articles,
  };
}
