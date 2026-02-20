import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import https from "https";

const GDELT_API_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

const GDELT_RELAX_SSL = process.env.GDELT_RELAX_SSL === "true";

const httpsAgent = new https.Agent({
  rejectUnauthorized: !GDELT_RELAX_SSL,
  timeout: 15000,
});

if (GDELT_RELAX_SSL) {
  console.warn("[GDELT] SSL certificate verification disabled via GDELT_RELAX_SSL=true");
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const JITTER_MAX_MS = 1000;

const SPACING_MIN_MS = 4500;
const SPACING_DEFAULT_MS = 5500;
const SPACING_MAX_MS = 30000;
const SPACING_INCREASE_FACTOR = 1.5;
const SPACING_DECREASE_FACTOR = 0.85;
const SPACING_SUCCESS_STREAK_THRESHOLD = 3;

let adaptiveSpacingMs = SPACING_DEFAULT_MS;
let consecutiveSuccesses = 0;

function recordSpacingSuccess(): void {
  consecutiveSuccesses++;
  if (consecutiveSuccesses >= SPACING_SUCCESS_STREAK_THRESHOLD) {
    const prev = adaptiveSpacingMs;
    adaptiveSpacingMs = Math.max(SPACING_MIN_MS, adaptiveSpacingMs * SPACING_DECREASE_FACTOR);
    if (prev !== adaptiveSpacingMs) {
      console.log(`[GDELT] Adaptive spacing decreased: ${Math.round(prev)}ms → ${Math.round(adaptiveSpacingMs)}ms (${consecutiveSuccesses} consecutive successes)`);
    }
  }
}

function recordSpacingFailure(): void {
  consecutiveSuccesses = 0;
  const prev = adaptiveSpacingMs;
  adaptiveSpacingMs = Math.min(SPACING_MAX_MS, adaptiveSpacingMs * SPACING_INCREASE_FACTOR);
  console.log(`[GDELT] Adaptive spacing increased: ${Math.round(prev)}ms → ${Math.round(adaptiveSpacingMs)}ms (failure)`);
}

function resetAdaptiveSpacing(): void {
  adaptiveSpacingMs = SPACING_DEFAULT_MS;
  consecutiveSuccesses = 0;
}

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000;

let circuitBreakerFailures = 0;
let circuitBreakerOpenedAt: number | null = null;

function isCircuitBreakerOpen(): boolean {
  if (circuitBreakerOpenedAt === null) return false;
  if (Date.now() - circuitBreakerOpenedAt > CIRCUIT_BREAKER_RESET_MS) {
    console.log("[GDELT] Circuit breaker reset (cooldown elapsed)");
    circuitBreakerFailures = 0;
    circuitBreakerOpenedAt = null;
    return false;
  }
  return true;
}

function recordCircuitBreakerFailure(): boolean {
  circuitBreakerFailures++;
  if (circuitBreakerFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerOpenedAt = Date.now();
    console.warn(`[GDELT] Circuit breaker OPEN after ${circuitBreakerFailures} consecutive failures. Pausing for ${CIRCUIT_BREAKER_RESET_MS / 1000}s.`);
    return true;
  }
  return false;
}

function recordCircuitBreakerSuccess() {
  circuitBreakerFailures = 0;
  circuitBreakerOpenedAt = null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJitteredDelay(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * JITTER_MAX_MS);
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response | null> {
  if (isCircuitBreakerOpen()) {
    return null;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      
      const response = await fetch(url, { 
        headers: { "Accept": "application/json" },
        signal: controller.signal,
        // @ts-ignore - Node.js fetch accepts agent
        agent: httpsAgent,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        recordCircuitBreakerSuccess();
        return response;
      }
      
      if (response.status === 429) {
        const tripped = recordCircuitBreakerFailure();
        if (tripped) return null;

        const retryAfter = response.headers.get("Retry-After");
        const backoffMs = retryAfter 
          ? parseInt(retryAfter, 10) * 1000 
          : getJitteredDelay(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
        console.log(`[GDELT] Rate limited (429), retry ${attempt}/${retries} in ${backoffMs}ms`);
        await sleep(backoffMs);
        continue;
      }
      
      if (response.status >= 500) {
        const backoffMs = getJitteredDelay(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
        console.log(`[GDELT] Server error (${response.status}), retry ${attempt}/${retries} in ${backoffMs}ms`);
        await sleep(backoffMs);
        continue;
      }
      
      return response;
    } catch (error: any) {
      const isLastAttempt = attempt === retries;
      const errorType = error.name === 'AbortError' ? 'timeout' : 
                       error.code === 'CERT_HAS_EXPIRED' ? 'certificate' : 
                       'network';
      
      if (!isLastAttempt) {
        const backoffMs = getJitteredDelay(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
        console.log(`[GDELT] Retry ${attempt}/${retries} after ${errorType} error (waiting ${backoffMs}ms)`);
        await sleep(backoffMs);
      } else {
        recordCircuitBreakerFailure();
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

const REUSE_TTL_MINUTES_NORMAL = 90;
const REUSE_TTL_MINUTES_DEGRADED = 180;

async function getFreshEnoughCache(cacheKey: string, reuseMinutes: number): Promise<string | null> {
  const cutoff = new Date(Date.now() - reuseMinutes * 60 * 1000);
  const cached = await db.query.apiCache.findFirst({
    where: and(
      eq(apiCache.cacheKey, cacheKey),
      gt(apiCache.fetchedAt, cutoff)
    ),
  });
  return cached?.responseData || null;
}

async function getStaleCache(cacheKey: string): Promise<string | null> {
  const cached = await db.query.apiCache.findFirst({
    where: eq(apiCache.cacheKey, cacheKey),
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
  personId?: string,
  reuseMinutes?: number,
  searchQueryOverride?: string | null,
): Promise<GdeltNewsData | null> {
  if (!personName) {
    return null;
  }

  const cacheKey = `gdelt:news:${personName.toLowerCase().replace(/\s+/g, "_")}`;

  if (reuseMinutes && reuseMinutes > 0) {
    const reusable = await getFreshEnoughCache(cacheKey, reuseMinutes);
    if (reusable) {
      return JSON.parse(reusable);
    }
  }

  if (isCircuitBreakerOpen()) {
    const stale = await getStaleCache(cacheKey);
    if (stale) return JSON.parse(stale);
    return null;
  }

  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const queryText = searchQueryOverride
      ? searchQueryOverride.split(/\s+OR\s+/i).map(t => t.trim()).filter(Boolean).join(" OR ")
      : `"${personName}"`;
    if (searchQueryOverride) {
      console.log(`[GDELT] Using search override for ${personName}: "${queryText}"`);
    }
    const query = encodeURIComponent(queryText);
    
    const url24h = `${GDELT_API_BASE}?query=${query}&mode=artlist&maxrecords=100&format=json&startdatetime=${formatGdeltDate(yesterday)}&enddatetime=${formatGdeltDate(now)}`;
    const url7d = `${GDELT_API_BASE}?query=${query}&mode=artlist&maxrecords=250&format=json&startdatetime=${formatGdeltDate(weekAgo)}&enddatetime=${formatGdeltDate(now)}`;
    
    const response24h = await fetchWithRetry(url24h);
    if (response24h?.ok) {
      recordSpacingSuccess();
    } else if (response24h === null) {
      recordSpacingFailure();
    }
    
    await sleep(getJitteredDelay(adaptiveSpacingMs));
    
    const response7d = await fetchWithRetry(url7d);
    if (response7d?.ok) {
      recordSpacingSuccess();
    } else if (response7d === null) {
      recordSpacingFailure();
    }

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
      query: searchQueryOverride || personName,
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
    const stale = await getStaleCache(cacheKey);
    if (stale) return JSON.parse(stale);
    return null;
  }
}

export interface GdeltBatchOptions {
  candidates?: Set<string>;
  timeBudgetMs?: number;
  isDegraded?: boolean;
}

export interface GdeltBatchStats {
  liveApiFetched: number;
  cacheReused: number;
  staleUsed: number;
  errors: number;
  elapsedMs: number;
  finalSpacingMs: number;
  avgSpacingMs: number;
}

export interface GdeltBatchResult {
  data: Map<string, GdeltNewsData>;
  stats: GdeltBatchStats;
}

export async function fetchBatchGdeltNews(
  people: Array<{ id: string; name: string; searchQueryOverride?: string | null }>,
  options?: GdeltBatchOptions
): Promise<GdeltBatchResult> {
  const results = new Map<string, GdeltNewsData>();
  const timeBudgetMs = options?.timeBudgetMs ?? 180000;
  const candidates = options?.candidates;
  const isDegraded = options?.isDegraded ?? false;
  const reuseMinutes = isDegraded ? REUSE_TTL_MINUTES_DEGRADED : REUSE_TTL_MINUTES_NORMAL;
  const batchStart = Date.now();
  
  const priorityPeople = candidates 
    ? people.filter(p => candidates.has(p.id))
    : people;
  const nonPriorityPeople = candidates
    ? people.filter(p => !candidates.has(p.id))
    : [];

  resetAdaptiveSpacing();
  console.log(`[GDELT] Batch: ${priorityPeople.length} priority candidates, ${nonPriorityPeople.length} non-priority (cache only), spacing=${Math.round(adaptiveSpacingMs)}ms, reuse=${reuseMinutes}min${isDegraded ? " (DEGRADED)" : ""}`);

  let liveApiFetched = 0;
  let cacheReused = 0;
  let staleUsed = 0;
  let errors = 0;
  let spacingSum = 0;
  let spacingCount = 0;

  for (const person of nonPriorityPeople) {
    const cacheKey = `gdelt:news:${person.name.toLowerCase().replace(/\s+/g, "_")}`;
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      results.set(person.id, JSON.parse(cached));
      cacheReused++;
    } else {
      const stale = await getStaleCache(cacheKey);
      if (stale) {
        results.set(person.id, JSON.parse(stale));
        staleUsed++;
      }
    }
  }
  console.log(`[GDELT] Loaded ${results.size} non-priority from cache/stale`);

  let processed = 0;
  
  for (const person of priorityPeople) {
    if (isCircuitBreakerOpen()) {
      console.warn(`[GDELT] Circuit breaker open - aborting remaining ${priorityPeople.length - processed} requests`);
      for (const remaining of priorityPeople.slice(processed)) {
        const cacheKey = `gdelt:news:${remaining.name.toLowerCase().replace(/\s+/g, "_")}`;
        const stale = await getStaleCache(cacheKey);
        if (stale) { results.set(remaining.id, JSON.parse(stale)); staleUsed++; }
      }
      break;
    }

    const elapsed = Date.now() - batchStart;
    if (elapsed > timeBudgetMs) {
      console.warn(`[GDELT] Time budget exhausted (${Math.round(elapsed / 1000)}s > ${Math.round(timeBudgetMs / 1000)}s). Processed ${processed}/${priorityPeople.length} priority.`);
      for (const remaining of priorityPeople.slice(processed)) {
        const cacheKey = `gdelt:news:${remaining.name.toLowerCase().replace(/\s+/g, "_")}`;
        const stale = await getStaleCache(cacheKey);
        if (stale) { results.set(remaining.id, JSON.parse(stale)); staleUsed++; }
      }
      break;
    }

    try {
      if (processed > 0) {
        const delay = getJitteredDelay(adaptiveSpacingMs);
        spacingSum += delay;
        spacingCount++;
        await sleep(delay);
      }
      
      const cacheKey = `gdelt:news:${person.name.toLowerCase().replace(/\s+/g, "_")}`;
      const reusable = reuseMinutes > 0 ? await getFreshEnoughCache(cacheKey, reuseMinutes) : null;
      
      if (reusable) {
        results.set(person.id, JSON.parse(reusable));
        cacheReused++;
      } else {
        const data = await fetchGdeltNews(person.name, person.id, undefined, person.searchQueryOverride);
        if (data) {
          results.set(person.id, data);
          liveApiFetched++;
        }
      }
      processed++;
    } catch (error) {
      console.error(`[GDELT] Error for ${person.name}:`, error);
      errors++;
      processed++;
      recordSpacingFailure();
    }
  }
  
  const avgSpacingMs = spacingCount > 0 ? Math.round(spacingSum / spacingCount) : 0;
  const stats: GdeltBatchStats = {
    liveApiFetched,
    cacheReused,
    staleUsed,
    errors,
    elapsedMs: Date.now() - batchStart,
    finalSpacingMs: Math.round(adaptiveSpacingMs),
    avgSpacingMs,
  };
  
  console.log(`[GDELT] Batch complete: ${liveApiFetched} live API, ${cacheReused} cache reused, ${staleUsed} stale, ${errors} errors, ${results.size} total, ${Math.round(stats.elapsedMs / 1000)}s elapsed, avgSpacing=${avgSpacingMs}ms, finalSpacing=${stats.finalSpacingMs}ms`);
  return { data: results, stats };
}
