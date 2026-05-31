/**
 * Pure parsers for DataForSEO Google News SERP live/advanced responses.
 */

export const DATAFORSEO_NEWS_DEFAULT_DEPTH = 50;

export interface DataForSeoNewsArticleRef {
  url: string;
  title?: string;
  publishedAt?: string;
}

export interface ParsedDataForSeoNews {
  query: string;
  articleCount24h: number;
  topHeadlines: string[];
  articles: DataForSeoNewsArticleRef[];
}

export interface DataForSeoNewsSerpItem {
  type?: string;
  url?: string;
  title?: string;
  timestamp?: string;
  time_published?: string;
  items?: DataForSeoNewsSerpItem[];
}

export interface DataForSeoNewsTaskResult {
  keyword?: string;
  items?: DataForSeoNewsSerpItem[];
}

function collectNewsSearchItems(items: DataForSeoNewsSerpItem[] | undefined, out: DataForSeoNewsArticleRef[]): void {
  if (!items) return;
  for (const item of items) {
    if (item.type === "news_search" && item.url) {
      out.push({
        url: item.url,
        title: item.title,
        publishedAt: item.timestamp ?? item.time_published,
      });
    }
    if (item.type === "top_stories" && Array.isArray(item.items)) {
      for (const sub of item.items) {
        if (sub?.url) {
          out.push({
            url: sub.url,
            title: sub.title,
            publishedAt: sub.timestamp ?? sub.time_published,
          });
        }
      }
    }
  }
}

/** Count URL-bearing news_search (+ top_stories nested) items; ignore se_results_count. */
export function parseDataForSeoNewsTaskResult(
  result: DataForSeoNewsTaskResult | null | undefined,
  queryLabel: string,
): ParsedDataForSeoNews {
  const articles: DataForSeoNewsArticleRef[] = [];
  collectNewsSearchItems(result?.items, articles);

  const topHeadlines = articles
    .slice(0, 3)
    .map((a) => a.title?.trim() || "")
    .filter(Boolean);

  return {
    query: queryLabel,
    articleCount24h: articles.length,
    topHeadlines,
    articles,
  };
}
