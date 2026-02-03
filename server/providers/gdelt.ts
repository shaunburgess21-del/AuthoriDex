import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import https from "https";

const GDELT_API_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

// SSL bypass only when explicitly enabled via environment variable
// GDELT sometimes has certificate issues - this allows recovery during outages
const GDELT_RELAX_SSL = process.env.GDELT_RELAX_SSL === "true";

// HTTPS agent with conditional SSL verification
const httpsAgent = new https.Agent({
  rejectUnauthorized: !GDELT_RELAX_SSL, // Only bypass verification if explicitly enabled
  timeout: 15000,
});

if (GDELT_RELAX_SSL) {
  console.warn("[GDELT] SSL certificate verification disabled via GDELT_RELAX_SSL=true");
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // Start with 1 second, exponential backoff

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout per request
      
      const response = await fetch(url, { 
        headers: { "Accept": "application/json" },
        signal: controller.signal,
        // @ts-ignore - Node.js fetch accepts agent
        agent: httpsAgent,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
      // If rate limited or server error, retry
      if (response.status >= 500 || response.status === 429) {
        console.log(`[GDELT] Retry ${attempt}/${retries} for ${url.substring(0, 80)}... (status: ${response.status})`);
        await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1)); // Exponential backoff
        continue;
      }
      
      return response; // Return non-retryable responses as-is
    } catch (error: any) {
      const isLastAttempt = attempt === retries;
      const errorType = error.name === 'AbortError' ? 'timeout' : 
                       error.code === 'CERT_HAS_EXPIRED' ? 'certificate' : 
                       'network';
      
      if (!isLastAttempt) {
        console.log(`[GDELT] Retry ${attempt}/${retries} after ${errorType} error`);
        await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
      } else {
        console.error(`[GDELT] All ${retries} attempts failed (${errorType})`);
      }
    }
  }
  return null;
}

export interface GdeltNewsData {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
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
  ttlHours: number = 2
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

function formatGdeltDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "") + "000000";
}

export async function fetchGdeltNews(
  personName: string,
  personId?: string
): Promise<GdeltNewsData | null> {
  if (!personName) {
    return null;
  }

  const cacheKey = `gdelt:news:${personName.toLowerCase().replace(/\s+/g, "_")}`;
  
  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    console.log(`[GDELT] Cache hit for ${personName}`);
    return JSON.parse(cached);
  }

  console.log(`[GDELT] Fetching news for ${personName}`);
  
  try {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const query = encodeURIComponent(`"${personName}"`);
    
    const url24h = `${GDELT_API_BASE}?query=${query}&mode=artlist&maxrecords=100&format=json&startdatetime=${formatGdeltDate(yesterday)}&enddatetime=${formatGdeltDate(now)}`;
    const url7d = `${GDELT_API_BASE}?query=${query}&mode=artlist&maxrecords=250&format=json&startdatetime=${formatGdeltDate(weekAgo)}&enddatetime=${formatGdeltDate(now)}`;
    
    // Use retry-enabled fetch with relaxed SSL
    const [response24h, response7d] = await Promise.all([
      fetchWithRetry(url24h),
      fetchWithRetry(url7d),
    ]);

    let articleCount24h = 0;
    let articleCount7d = 0;
    let topHeadlines: string[] = [];

    if (response24h?.ok) {
      const text = await response24h.text();
      try {
        const data = JSON.parse(text);
        articleCount24h = data.articles?.length || 0;
        topHeadlines = (data.articles || [])
          .slice(0, 3)
          .map((a: { title?: string }) => a.title || "");
      } catch {
        articleCount24h = 0;
      }
    }

    if (response7d?.ok) {
      const text = await response7d.text();
      try {
        const data = JSON.parse(text);
        articleCount7d = data.articles?.length || 0;
      } catch {
        articleCount7d = 0;
      }
    }

    const averageDaily7d = articleCount7d / 7;
    const delta = averageDaily7d > 0 
      ? ((articleCount24h - averageDaily7d) / averageDaily7d)
      : (articleCount24h > 0 ? 1 : 0);

    const result: GdeltNewsData = {
      query: personName,
      articleCount24h,
      articleCount7d,
      averageDaily7d,
      delta,
      topHeadlines,
    };

    await setCachedResponse(cacheKey, "gdelt", personId || null, JSON.stringify(result), 2);

    return result;
  } catch (error) {
    console.error(`[GDELT] Error fetching ${personName}:`, error);
    return null;
  }
}

export async function fetchBatchGdeltNews(
  people: Array<{ id: string; name: string }>
): Promise<Map<string, GdeltNewsData>> {
  const results = new Map<string, GdeltNewsData>();
  
  console.log(`[GDELT] Fetching news for ${people.length} people...`);
  
  for (const person of people) {
    try {
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const data = await fetchGdeltNews(person.name, person.id);
      if (data) {
        results.set(person.id, data);
      }
    } catch (error) {
      console.error(`[GDELT] Error for ${person.name}:`, error);
    }
  }
  
  console.log(`[GDELT] Successfully fetched ${results.size} news records`);
  return results;
}
