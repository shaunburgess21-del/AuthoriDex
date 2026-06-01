import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";

const WIKI_API_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";
const MEDIAWIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "VoxDex/1.0 (https://voxdex.com; contact@voxdex.com)";

// Network resilience: previously a single hung Wikipedia request would block
// the entire sequential ingest batch (heartbeat keeps the lock alive, run
// became a 57-min zombie writing 0 snapshots). Bound every outbound call.
const WIKI_REQUEST_TIMEOUT_MS = 15_000;
const WIKI_MAX_RETRIES = 2;
const WIKI_RETRY_BACKOFF_MS = [500, 1500];
// Cap on how long we'll honour a 429 `Retry-After` header. Wikimedia can ask
// for long waits; blocking the sequential batch that long would blow the
// ingest heartbeat budget, so we give up fast and let the person fall back to
// their last cached value rather than stalling the whole run.
const WIKI_RETRY_AFTER_CAP_MS = 2000;

// Pageviews data only advances once per day on Wikimedia's side, so a longer
// base TTL costs nothing in freshness. The jitter is the important part: a flat
// TTL makes all ~161 entries expire in the same hour, stampeding Wikimedia in
// one run (→ sustained 429s → 2s backoff per person → run exceeds the 4-min
// heartbeat → stale-lock failure). Spreading expiries over a window keeps each
// run's live-fetch count low.
const WIKI_PAGEVIEWS_TTL_BASE_HOURS = 12;
const WIKI_PAGEVIEWS_TTL_JITTER_HOURS = 6;
// Redirect/canonical mappings for tracked people effectively never change, so
// cache them long-term to avoid 1-2 extra api.php calls per person per fetch.
const WIKI_REDIRECT_TTL_HOURS = 24 * 30;

/**
 * Parse a 429/503 `Retry-After` header into milliseconds. Supports both the
 * delta-seconds form ("5") and the HTTP-date form. Returns null if absent or
 * unparseable.
 */
function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = WIKI_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= WIKI_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const shouldRetry =
        attempt < WIKI_MAX_RETRIES &&
        response.status !== 404 &&
        (response.status === 429 || response.status >= 500);
      if (shouldRetry) {
        let backoff = WIKI_RETRY_BACKOFF_MS[attempt] ?? 2000;
        if (response.status === 429) {
          const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
          if (retryAfter !== null) {
            backoff = Math.min(retryAfter, WIKI_RETRY_AFTER_CAP_MS);
          }
        }
        console.warn(`[Wiki] HTTP ${response.status} on attempt ${attempt + 1}, retrying in ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt >= WIKI_MAX_RETRIES) throw err;
      const isAbort = (err as { name?: string })?.name === "AbortError";
      const backoff = WIKI_RETRY_BACKOFF_MS[attempt] ?? 2000;
      console.warn(
        `[Wiki] Fetch ${isAbort ? "timed out" : "errored"} on attempt ${attempt + 1}: ${(err as Error).message}, retrying in ${backoff}ms`,
      );
      await new Promise(r => setTimeout(r, backoff));
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError ?? new Error("[Wiki] fetch failed after retries");
}

export interface WikiPageviewData {
  article: string;
  pageviews24h: number;
  // Pageviews for the day immediately before `pageviews24h`'s reference day.
  // Used by the Wiki Pulse pill to compute a true day-over-day delta directly
  // from Wikimedia's daily breakdown, instead of comparing two snapshots taken
  // 24h apart. The snapshot-comparison approach was unreliable because the
  // Wikimedia "most-recent published day" only rolls forward ~once per 24h,
  // which often left the 20–28h-ago snapshot carrying the *same* daily count
  // as the latest snapshot — producing a fake "0%" / em-dash for most people.
  // `null` when fewer than 2 days of data are available (very rare).
  pageviewsPrevDay: number | null;
  pageviews7d: number;
  averageDaily7d: number;
  delta: number;
  redirectTitle?: string | null;
  canonicalTitle?: string | null;
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
  // Use ms arithmetic so fractional-hour TTLs (jitter) are honoured exactly;
  // Date.setHours() would truncate the fractional part.
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  
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

/**
 * Resolve a Wikipedia title to its canonical (target) title if it's a redirect.
 * Returns null if the slug is already canonical or if resolution fails.
 */
async function resolveWikiRedirect(slug: string): Promise<string | null> {
  try {
    const url = `${MEDIAWIKI_API}?action=query&titles=${encodeURIComponent(slug)}&redirects&format=json`;
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const redirects = data?.query?.redirects;
    if (Array.isArray(redirects) && redirects.length > 0) {
      return (redirects[redirects.length - 1].to as string).replace(/ /g, "_");
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch 7-day daily pageviews for a single Wikipedia title.
 * Returns per-day array or null on failure/404.
 */
async function fetchPageviewsRaw(
  slug: string,
  range: { start: string; end: string },
): Promise<{ views: number }[] | null> {
  const url = `${WIKI_API_BASE}/en.wikipedia/all-access/all-agents/${encodeURIComponent(slug)}/daily/${range.start}/${range.end}`;
  const response = await fetchWithTimeout(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Wikipedia API error: ${response.status}`);
  }
  const data = await response.json();
  return data.items || [];
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
    const range7d = getDateRange(7);

    const primaryItems = await fetchPageviewsRaw(wikiSlug, range7d);
    if (!primaryItems || primaryItems.length === 0) {
      return null;
    }

    const redirectInfo = await resolveRedirectInfoCached(wikiSlug);
    const redirectTitle = redirectInfo.redirectTitle;
    const canonicalTitle = redirectInfo.canonicalTitle;
    let altItems: { views: number }[] | null = null;

    if (redirectInfo.companionSlug && redirectInfo.companionSlug !== wikiSlug) {
      altItems = await fetchPageviewsRaw(redirectInfo.companionSlug, range7d);
    }

    // Sum per-day views from both titles
    const combinedDailyViews = primaryItems.map((item, i) => {
      const altViews = altItems && altItems[i] ? altItems[i].views : 0;
      return { views: item.views + altViews };
    });

    const pageviews7d = combinedDailyViews.reduce((sum, item) => sum + item.views, 0);
    const averageDaily7d = pageviews7d / combinedDailyViews.length;
    const pageviews24h = combinedDailyViews[combinedDailyViews.length - 1]?.views || 0;
    // The day immediately before `pageviews24h`'s reference day. Powering the
    // Wiki Pulse 24h delta directly from Wikimedia's daily array sidesteps
    // the snapshot-stickiness issue that made the pill em-dash for ~97% of
    // people (the "most-recent published day" only rolls forward once every
    // ~24h, so neighbouring hourly snapshots almost always carry the same
    // daily count).
    const pageviewsPrevDay =
      combinedDailyViews.length >= 2
        ? combinedDailyViews[combinedDailyViews.length - 2]?.views ?? null
        : null;

    const delta = averageDaily7d > 0 
      ? ((pageviews24h - averageDaily7d) / averageDaily7d)
      : 0;

    const result: WikiPageviewData = {
      article: wikiSlug,
      pageviews24h,
      pageviewsPrevDay,
      pageviews7d,
      averageDaily7d,
      delta,
      redirectTitle,
      canonicalTitle,
    };

    const ttlHours =
      WIKI_PAGEVIEWS_TTL_BASE_HOURS + Math.random() * WIKI_PAGEVIEWS_TTL_JITTER_HOURS;
    await setCachedResponse(cacheKey, "wiki", personId || null, JSON.stringify(result), ttlHours);

    return result;
  } catch (error) {
    console.error(`[Wiki] Error fetching ${wikiSlug}:`, error);
    return null;
  }
}

/**
 * For a canonical page, find the most popular redirect title pointing to it.
 * Uses MediaWiki's "what links here" filtered to redirects. Returns the first
 * redirect title found, or null if none exist.
 */
async function findRedirectsTo(canonicalSlug: string): Promise<string | null> {
  try {
    const url = `${MEDIAWIKI_API}?action=query&list=backlinks&bltitle=${encodeURIComponent(canonicalSlug)}&blfilterredir=redirects&bllimit=10&format=json`;
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const backlinks = data?.query?.backlinks;
    if (!Array.isArray(backlinks) || backlinks.length === 0) return null;
    // Return all redirect titles so we can pick the highest-traffic one
    // For efficiency, just return the first one (most common redirect)
    return (backlinks[0].title as string).replace(/ /g, "_");
  } catch {
    return null;
  }
}

interface WikiRedirectInfo {
  redirectTitle: string | null;
  canonicalTitle: string | null;
  // The "other" title whose views should also be summed (companion of the
  // stored slug), or null when the stored slug stands alone.
  companionSlug: string | null;
}

/**
 * Resolve (and long-term cache) the redirect/canonical relationship for a
 * stored wiki slug. These mappings are stable for tracked people, so caching
 * them removes 1-2 api.php calls per person on every ingest run — the main
 * driver of the per-run Wikimedia request volume that triggers 429s.
 */
async function resolveRedirectInfoCached(wikiSlug: string): Promise<WikiRedirectInfo> {
  const cacheKey = `wiki:redirectinfo:${wikiSlug}`;
  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as WikiRedirectInfo;
    } catch {
      /* fall through to re-resolve */
    }
  }

  let info: WikiRedirectInfo;
  const resolvedCanonical = await resolveWikiRedirect(wikiSlug);
  if (resolvedCanonical && resolvedCanonical !== wikiSlug) {
    // Stored slug is itself a redirect → sum the canonical page too.
    info = { redirectTitle: wikiSlug, canonicalTitle: resolvedCanonical, companionSlug: resolvedCanonical };
  } else {
    // Stored slug is canonical → sum the most common redirect pointing to it.
    const altSlug = await findRedirectsTo(wikiSlug);
    info = { redirectTitle: altSlug, canonicalTitle: wikiSlug, companionSlug: altSlug };
  }

  await setCachedResponse(cacheKey, "wiki", null, JSON.stringify(info), WIKI_REDIRECT_TTL_HOURS);
  return info;
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
