import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";

const WIKI_API_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";
const USER_AGENT = "AuthoriDex/1.0 (https://authoridex.com; contact@authoridex.com)";

export interface WikiPageviewData {
  article: string;
  pageviews24h: number;
  pageviews7d: number;
  averageDaily7d: number;
  delta: number;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0].replace(/-/g, "");
}

function getDateRange(daysBack: number): { start: string; end: string } {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  
  const start = new Date(end);
  start.setDate(start.getDate() - daysBack);
  
  return {
    start: formatDate(start),
    end: formatDate(end),
  };
}

async function getCachedResponse(cacheKey: string): Promise<string | null> {
  const cached = await db.query.apiCache.findFirst({
    where: and(
      eq(apiCache.cacheKey, cacheKey),
      gt(apiCache.expiresAt, new Date())
    ),
  });
  
  return cached?.responseData || null;
}

async function setCachedResponse(
  cacheKey: string,
  provider: string,
  personId: string | null,
  data: string,
  ttlHours: number = 6
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + ttlHours);
  
  await db.insert(apiCache).values({
    cacheKey,
    provider,
    personId,
    responseData: data,
    expiresAt,
  }).onConflictDoUpdate({
    target: apiCache.cacheKey,
    set: {
      responseData: data,
      fetchedAt: new Date(),
      expiresAt,
    },
  });
}

export async function fetchWikiPageviews(
  wikiSlug: string,
  personId?: string
): Promise<WikiPageviewData | null> {
  if (!wikiSlug) {
    return null;
  }

  const cacheKey = `wiki:pageviews:${wikiSlug}`;
  
  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    console.log(`[Wiki] Cache hit for ${wikiSlug}`);
    return JSON.parse(cached);
  }

  console.log(`[Wiki] Fetching pageviews for ${wikiSlug}`);
  
  try {
    const range24h = getDateRange(1);
    const range7d = getDateRange(7);
    
    const url7d = `${WIKI_API_BASE}/en.wikipedia/all-access/all-agents/${encodeURIComponent(wikiSlug)}/daily/${range7d.start}/${range7d.end}`;
    
    const response = await fetch(url7d, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[Wiki] Article not found: ${wikiSlug}`);
        return null;
      }
      throw new Error(`Wikipedia API error: ${response.status}`);
    }

    const data = await response.json();
    const items = data.items || [];
    
    if (items.length === 0) {
      return null;
    }

    const pageviews7d = items.reduce((sum: number, item: { views: number }) => sum + item.views, 0);
    const averageDaily7d = pageviews7d / items.length;
    
    const mostRecentDay = items[items.length - 1]?.views || 0;
    const pageviews24h = mostRecentDay;
    
    const delta = averageDaily7d > 0 
      ? ((pageviews24h - averageDaily7d) / averageDaily7d)
      : 0;

    const result: WikiPageviewData = {
      article: wikiSlug,
      pageviews24h,
      pageviews7d,
      averageDaily7d,
      delta,
    };

    await setCachedResponse(cacheKey, "wiki", personId || null, JSON.stringify(result), 6);

    return result;
  } catch (error) {
    console.error(`[Wiki] Error fetching ${wikiSlug}:`, error);
    return null;
  }
}

export async function fetchBatchWikiPageviews(
  people: Array<{ id: string; wikiSlug: string | null }>
): Promise<Map<string, WikiPageviewData>> {
  const results = new Map<string, WikiPageviewData>();
  
  const validPeople = people.filter(p => p.wikiSlug);
  
  console.log(`[Wiki] Fetching pageviews for ${validPeople.length} people...`);
  
  for (const person of validPeople) {
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const data = await fetchWikiPageviews(person.wikiSlug!, person.id);
      if (data) {
        results.set(person.id, data);
      }
    } catch (error) {
      console.error(`[Wiki] Error for ${person.wikiSlug}:`, error);
    }
  }
  
  console.log(`[Wiki] Successfully fetched ${results.size} pageview records`);
  return results;
}
