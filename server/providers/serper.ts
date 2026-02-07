import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import pLimit from "p-limit";

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_BASE_URL = "https://google.serper.dev/search";

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

interface SerperResult {
  searchVolume: number;
  newsCount: number;
  delta: number;
}

interface SerperSearchResponse {
  organic?: Array<{ title: string; link: string; snippet: string; date?: string; position?: number }>;
  news?: Array<{ title: string; link: string; snippet: string; date?: string }>;
  searchInformation?: { totalResults?: string };
  knowledgeGraph?: { title?: string; description?: string; type?: string };
  topStories?: Array<{ title: string; link: string }>;
  relatedSearches?: Array<{ query: string }>;
  peopleAlsoAsk?: Array<{ question: string }>;
  sitelinks?: { inline?: Array<{ title: string; link: string }>; expanded?: Array<{ title: string; link: string }> };
}

export async function fetchSerperData(name: string, searchQueryOverride?: string | null): Promise<SerperResult | null> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] No API key configured, skipping ${name}`);
    return null;
  }

  const cacheKey = `serper:search:${name.replace(/\s+/g, "_").toLowerCase()}`;
  const CACHE_TTL_HOURS = 12;

  try {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return JSON.parse(cached.responseData);
    }

    const [rawCached] = await db
      .select()
      .from(apiCache)
      .where(eq(apiCache.cacheKey, cacheKey))
      .limit(1);

    const response = await fetch(SERPER_BASE_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: searchQueryOverride || name,
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

    // =========================================================================
    // COMPOSITE SEARCH ACTIVITY SCORE
    // =========================================================================
    // Don't rely on totalResults - it's often 0 or unreliable.
    // Instead, compute a composite score from multiple stable signals.
    
    const organicCount = (data.organic || []).length;
    const newsCount = (data.news || []).length;
    const hasKnowledgeGraph = data.knowledgeGraph?.title ? 1 : 0;
    const hasTopStories = (data.topStories || []).length > 0 ? 1 : 0;
    const relatedSearchCount = (data.relatedSearches || []).length;
    const peopleAlsoAskCount = (data.peopleAlsoAsk || []).length;
    const hasSitelinks = (data.sitelinks?.inline?.length || 0) + (data.sitelinks?.expanded?.length || 0) > 0 ? 1 : 0;
    
    // Composite search activity score (0-100 scale)
    // Weights: organic results (40), knowledge graph (20), news presence (15), 
    //          related searches (10), people also ask (10), sitelinks (5)
    const searchActivityScore = 
      Math.min(40, organicCount * 4) +              // Up to 40 points (10 results = 40)
      hasKnowledgeGraph * 20 +                       // 20 points if KG present
      Math.min(15, newsCount * 3) +                  // Up to 15 points (5 news = 15)
      Math.min(10, relatedSearchCount) +             // Up to 10 points
      Math.min(10, peopleAlsoAskCount * 2.5) +       // Up to 10 points (4 questions = 10)
      hasSitelinks * 5;                              // 5 points if sitelinks present
    
    // Recent results for delta calculation
    const recentResults = (data.organic || []).filter((r) => {
      if (!r.date) return false;
      const date = new Date(r.date);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return date > dayAgo;
    }).length;

    // searchVolume is now the composite score (0-100)
    const searchVolume = searchActivityScore;
    const delta = recentResults > 3 ? 0.3 : recentResults > 1 ? 0.1 : recentResults > 0 ? 0.05 : 0;

    const result: SerperResult = {
      searchVolume,
      newsCount,
      delta,
    };

    // CACHE VALIDITY GATE
    // Prevent caching garbage data when there's a suspicious drop.
    // If new value drops >70% from cached value, refuse to update cache.
    if (rawCached) {
      const cachedResult = JSON.parse(rawCached.responseData) as SerperResult;
      const dropPercent = cachedResult.searchVolume > 0 
        ? (1 - searchVolume / cachedResult.searchVolume) * 100 
        : 0;
      
      // If drop exceeds 70% and we had meaningful data before, keep cached value
      if (dropPercent > 70 && cachedResult.searchVolume >= 20) {
        console.log(`[Serper] Suspicious drop for ${name}: ${cachedResult.searchVolume.toFixed(1)} → ${searchVolume.toFixed(1)} (${dropPercent.toFixed(0)}% drop), keeping cached value`);
        return cachedResult;
      }
    }

    await setCachedResponse(cacheKey, "serper", JSON.stringify(result), CACHE_TTL_HOURS);

    return result;
  } catch (error) {
    console.error(`[Serper] Error fetching data for ${name}:`, error);
    return null;
  }
}

export async function fetchSerperBatch(
  people: Array<{ name: string; searchQueryOverride?: string | null }>,
  concurrency: number = 2,
  delayMs: number = 500
): Promise<Map<string, SerperResult>> {
  const results = new Map<string, SerperResult>();
  const limit = pLimit(concurrency);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const tasks = people.map((person, index) =>
    limit(async () => {
      if (index > 0) {
        await delay(delayMs);
      }
      const result = await fetchSerperData(person.name, person.searchQueryOverride);
      if (result) {
        results.set(person.name.toLowerCase(), result);
        console.log(`[Serper] Successfully fetched data for ${person.name}`);
      }
    })
  );

  await Promise.all(tasks);
  console.log(`[Serper] Batch complete: ${results.size}/${people.length} successful`);

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
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return JSON.parse(cached.responseData);
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

    await setCachedResponse(cacheKey, "serper", JSON.stringify(result), CACHE_TTL_HOURS);

    return result;
  } catch (error) {
    console.error(`[Serper] Error fetching trending news for ${name}:`, error);
    return null;
  }
}

// Fetch dedicated net worth search results for accurate financial data
export interface NetWorthContext {
  estimate: string | null;
  sources: Array<{ title: string; snippet: string; link: string }>;
}

export async function fetchNetWorthContext(name: string): Promise<NetWorthContext | null> {
  if (!SERPER_API_KEY) {
    console.log(`[Serper] No API key configured, skipping net worth search for ${name}`);
    return null;
  }

  try {
    // Search specifically for net worth with current year
    const currentYear = new Date().getFullYear();
    const response = await fetch(SERPER_BASE_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `${name} net worth ${currentYear}`,
        num: 8,
        gl: "us",
        hl: "en",
      }),
    });

    if (!response.ok) {
      console.error(`[Serper] Net worth search API error for ${name}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const organic = data.organic || [];

    if (organic.length === 0) {
      return { estimate: null, sources: [] };
    }

    const sources = organic.slice(0, 5).map((item: any) => ({
      title: item.title,
      snippet: item.snippet || "",
      link: item.link,
    }));

    // Try to extract a net worth estimate from snippets
    let estimate: string | null = null;
    for (const source of sources) {
      const match = source.snippet.match(/\$[\d,.]+ (?:billion|million|trillion)/i);
      if (match) {
        estimate = match[0];
        break;
      }
    }

    console.log(`[Serper] Net worth search for ${name}: found ${sources.length} sources, estimate: ${estimate || 'none extracted'}`);

    return { estimate, sources };
  } catch (error) {
    console.error(`[Serper] Error fetching net worth for ${name}:`, error);
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
