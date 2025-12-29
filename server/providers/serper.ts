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
