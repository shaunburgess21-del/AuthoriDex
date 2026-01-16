import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import pLimit from "p-limit";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_BASE_URL = "https://google.serper.dev/search";

interface SerperResult {
  searchVolume: number;
  newsCount: number;
  delta: number;
}

interface SerperSearchResponse {
  organic?: Array<{ title: string; link: string; snippet: string; date?: string }>;
  news?: Array<{ title: string; link: string; snippet: string; date?: string }>;
  searchInformation?: { totalResults?: string };
}

export async function fetchSerperData(name: string): Promise<SerperResult | null> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] No API key configured, skipping ${name}`);
    return null;
  }

  const cacheKey = `serper:search:${name.replace(/\s+/g, "_").toLowerCase()}`;
  const CACHE_TTL_HOURS = 12;

  try {
    const [cached] = await db
      .select()
      .from(apiCache)
      .where(eq(apiCache.cacheKey, cacheKey))
      .limit(1);

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.fetchedAt).getTime();
      if (cacheAge < CACHE_TTL_HOURS * 60 * 60 * 1000) {
        return JSON.parse(cached.responseData);
      }
    }

    const response = await fetch(SERPER_BASE_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: name,
        num: 10,
        gl: "us",
        hl: "en",
      }),
    });

    if (!response.ok) {
      console.error(`[Serper] API error for ${name}: ${response.status}`);
      return null;
    }

    const data: SerperSearchResponse = await response.json();

    const totalResults = data.searchInformation?.totalResults
      ? parseInt(data.searchInformation.totalResults, 10)
      : 0;

    const recentResults = (data.organic || []).filter((r) => {
      if (!r.date) return false;
      const date = new Date(r.date);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return date > dayAgo;
    }).length;

    const newsResults = (data.news || []).length;

    const searchVolume = Math.min(totalResults / 1000000, 100);
    const delta = recentResults > 3 ? 0.3 : recentResults > 1 ? 0.1 : recentResults > 0 ? 0.05 : 0;

    const result: SerperResult = {
      searchVolume,
      newsCount: newsResults,
      delta,
    };

    if (cached) {
      await db
        .update(apiCache)
        .set({
          responseData: JSON.stringify(result),
          fetchedAt: new Date(),
        })
        .where(eq(apiCache.cacheKey, cacheKey));
    } else {
      await db.insert(apiCache).values({
        cacheKey,
        provider: "serper",
        responseData: JSON.stringify(result),
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000),
      });
    }

    return result;
  } catch (error) {
    console.error(`[Serper] Error fetching data for ${name}:`, error);
    return null;
  }
}

export async function fetchSerperBatch(
  names: string[],
  concurrency: number = 2,
  delayMs: number = 500
): Promise<Map<string, SerperResult>> {
  const results = new Map<string, SerperResult>();
  const limit = pLimit(concurrency);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const tasks = names.map((name, index) =>
    limit(async () => {
      if (index > 0) {
        await delay(delayMs);
      }
      const result = await fetchSerperData(name);
      if (result) {
        results.set(name.toLowerCase(), result);
        console.log(`[Serper] Successfully fetched data for ${name}`);
      }
    })
  );

  await Promise.all(tasks);
  console.log(`[Serper] Batch complete: ${results.size}/${names.length} successful`);

  return results;
}

// Web search grounding for AI profile generation
// Returns recent news headlines and context about a person
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
    const newsResponse = await fetch("https://google.serper.dev/news", {
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
    const searchResponse = await fetch(SERPER_BASE_URL, {
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
  const CACHE_TTL_HOURS = 6; // Cache trending context for 6 hours

  try {
    // Check cache first
    const [cached] = await db
      .select()
      .from(apiCache)
      .where(eq(apiCache.cacheKey, cacheKey))
      .limit(1);

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.fetchedAt).getTime();
      if (cacheAge < CACHE_TTL_HOURS * 60 * 60 * 1000) {
        return JSON.parse(cached.responseData);
      }
    }

    // Search for recent news about the person (last week)
    const response = await fetch("https://google.serper.dev/news", {
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
        tbs: "qdr:w", // Last week
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

    // Cache the result
    if (cached) {
      await db
        .update(apiCache)
        .set({
          responseData: JSON.stringify(result),
          fetchedAt: new Date(),
        })
        .where(eq(apiCache.cacheKey, cacheKey));
    } else {
      await db.insert(apiCache).values({
        cacheKey,
        provider: "serper",
        responseData: JSON.stringify(result),
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000),
      });
    }

    return result;
  } catch (error) {
    console.error(`[Serper] Error fetching trending news for ${name}:`, error);
    return null;
  }
}

// Simple categorization based on keywords
function categorizeNews(text: string): string {
  const textLower = text.toLowerCase();
  
  const categories: Record<string, string[]> = {
    "Politics": ["president", "senator", "congress", "election", "vote", "policy", "government", "political", "white house", "administration"],
    "Business": ["ceo", "company", "stock", "earnings", "revenue", "investment", "acquisition", "ipo", "market"],
    "Entertainment": ["movie", "film", "album", "song", "concert", "award", "grammy", "oscar", "emmy", "performance"],
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
