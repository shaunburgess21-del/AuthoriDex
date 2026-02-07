import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import pLimit from "p-limit";

const X_API_KEY = process.env.X_API_KEY;
const X_API_SECRET = process.env.X_API_SECRET;
const X_API_BASE = "https://api.twitter.com/2";

interface XMetrics {
  quoteVelocity: number;
  replyVelocity: number;
  mentionCount: number;
  delta: number;
}

let bearerToken: string | null = null;

async function getBearerToken(): Promise<string | null> {
  if (bearerToken) return bearerToken;
  
  if (!X_API_KEY || !X_API_SECRET) {
    console.log("[X API] No API credentials configured");
    return null;
  }

  try {
    const credentials = Buffer.from(`${X_API_KEY}:${X_API_SECRET}`).toString("base64");
    
    const response = await fetch("https://api.twitter.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      console.error("[X API] Failed to get bearer token:", response.status);
      return null;
    }

    const data = await response.json();
    bearerToken = data.access_token;
    return bearerToken;
  } catch (error) {
    console.error("[X API] Error getting bearer token:", error);
    return null;
  }
}

export async function fetchXData(handle: string): Promise<XMetrics | null> {
  const token = await getBearerToken();
  if (!token) return null;

  const cleanHandle = handle.replace("@", "");
  const cacheKey = `x:metrics:${cleanHandle.toLowerCase()}`;
  const CACHE_TTL_HOURS = 2; // 2 hours = 12 fetches per day (Basic tier: 100K+ tweets/month)

  try {
    const [cached] = await db
      .select()
      .from(apiCache)
      .where(and(
        eq(apiCache.cacheKey, cacheKey),
        gt(apiCache.expiresAt, new Date())
      ))
      .limit(1);

    if (cached && cached.expiresAt >= cached.fetchedAt) {
      return JSON.parse(cached.responseData);
    }

    const query = encodeURIComponent(`@${cleanHandle} -is:retweet`);
    const response = await fetch(
      `${X_API_BASE}/tweets/search/recent?query=${query}&max_results=10&tweet.fields=public_metrics,created_at`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.status === 429) {
      console.warn("[X API] Rate limit hit, using cached/fallback data");
      return cached ? JSON.parse(cached.responseData) : null;
    }

    if (!response.ok) {
      console.error(`[X API] Error for @${cleanHandle}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const tweets = data.data || [];

    let totalQuotes = 0;
    let totalReplies = 0;
    let recentTweets = 0;

    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    for (const tweet of tweets) {
      const metrics = tweet.public_metrics || {};
      totalQuotes += metrics.quote_count || 0;
      totalReplies += metrics.reply_count || 0;

      if (tweet.created_at) {
        const tweetTime = new Date(tweet.created_at).getTime();
        if (tweetTime > dayAgo) {
          recentTweets++;
        }
      }
    }

    const quoteVelocity = tweets.length > 0 ? totalQuotes / tweets.length : 0;
    const replyVelocity = tweets.length > 0 ? totalReplies / tweets.length : 0;

    const delta = recentTweets > 5 ? 0.4 : recentTweets > 2 ? 0.2 : recentTweets > 0 ? 0.1 : 0;

    const result: XMetrics = {
      quoteVelocity,
      replyVelocity,
      mentionCount: tweets.length,
      delta,
    };

    const cacheNow = new Date();
    const cacheExpiresAt = new Date(cacheNow.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000);

    await db.insert(apiCache).values({
      cacheKey,
      provider: "x",
      responseData: JSON.stringify(result),
      fetchedAt: cacheNow,
      expiresAt: cacheExpiresAt,
    }).onConflictDoUpdate({
      target: apiCache.cacheKey,
      set: {
        responseData: JSON.stringify(result),
        fetchedAt: cacheNow,
        expiresAt: cacheExpiresAt,
      },
    });

    return result;
  } catch (error) {
    console.error(`[X API] Error fetching data for @${handle}:`, error);
    return null;
  }
}

export async function fetchXBatch(
  handles: string[],
  maxRequests: number = 100
): Promise<Map<string, XMetrics>> {
  const results = new Map<string, XMetrics>();
  const limit = pLimit(1);

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const validHandles = handles.filter((h) => h && h.trim());
  const limitedHandles = validHandles.slice(0, maxRequests);

  console.log(`[X API] Processing ${limitedHandles.length} handles (max ${maxRequests} to conserve rate limit)`);

  let requestCount = 0;

  for (const handle of limitedHandles) {
    if (requestCount >= maxRequests) {
      console.log(`[X API] Reached max requests (${maxRequests}), stopping batch`);
      break;
    }

    await delay(2000);

    const result = await fetchXData(handle);
    if (result) {
      results.set(handle.toLowerCase().replace("@", ""), result);
      console.log(`[X API] Successfully fetched data for @${handle}`);
    }
    requestCount++;
  }

  console.log(`[X API] Batch complete: ${results.size}/${limitedHandles.length} successful (${requestCount} API calls)`);

  return results;
}
