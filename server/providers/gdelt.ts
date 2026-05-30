import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import https from "https";
import {
  buildGdelt24hArtlistUrl,
  buildGdeltQueryText,
  normalizeGdeltNewsData,
  parseGdelt24hArtlistResponse,
} from "./gdelt-parse";

// GDELT_RELAX_SSL is an escape hatch for environments that can't validate the
// GDELT certificate chain (corporate MITM proxies, older Node/OpenSSL builds).
// It must NEVER be left on in production — disabling TLS verification opens
// the door to on-path tampering with the news-volume data we ingest.
const GDELT_RELAX_SSL_RAW = (process.env.GDELT_RELAX_SSL ?? "").trim().toLowerCase();
const GDELT_RELAX_SSL_REQUESTED = GDELT_RELAX_SSL_RAW === "true" || GDELT_RELAX_SSL_RAW === "1";
const IS_PROD = process.env.NODE_ENV === "production";

// Hard-gate: in production we refuse to relax TLS verification even if the env
// var is set. This stops a stray Railway/Heroku config from silently weakening
// our news ingest. To override (emergency only), set GDELT_RELAX_SSL_FORCE=true.
const GDELT_RELAX_SSL_FORCE = (process.env.GDELT_RELAX_SSL_FORCE ?? "").trim().toLowerCase() === "true";
const GDELT_RELAX_SSL = GDELT_RELAX_SSL_REQUESTED && (!IS_PROD || GDELT_RELAX_SSL_FORCE);

const httpsAgent = new https.Agent({
  rejectUnauthorized: !GDELT_RELAX_SSL,
  timeout: 15000,
});

if (GDELT_RELAX_SSL_REQUESTED && !GDELT_RELAX_SSL) {
  console.warn(
    "[GDELT] GDELT_RELAX_SSL=true is ignored in production. Set GDELT_RELAX_SSL_FORCE=true only as an emergency override — disabling TLS verification lets news counts be tampered with in transit."
  );
}
if (GDELT_RELAX_SSL) {
  const warning = IS_PROD
    ? "[GDELT] DANGER — SSL certificate verification disabled in PRODUCTION via GDELT_RELAX_SSL_FORCE=true. News-volume data is no longer authenticated. Remove this flag as soon as the underlying issue is resolved."
    : "[GDELT] SSL certificate verification disabled via GDELT_RELAX_SSL=true (non-production environment).";
  console.warn(warning);
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
  // Optional URL list used by the multi-source news aggregator for dedup.
  // Legacy cached entries may not have this field; aggregator falls back to counts.
  articles?: Array<{ url: string; title?: string; publishedAt?: string }>;
}

function parseGdeltCachedJson(raw: string): GdeltNewsData {
  return normalizeGdeltNewsData(JSON.parse(raw)) as GdeltNewsData;
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
      return parseGdeltCachedJson(reusable);
    }
  }

  if (isCircuitBreakerOpen()) {
    const stale = await getStaleCache(cacheKey);
    if (stale) return parseGdeltCachedJson(stale);
    return null;
  }

  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    return parseGdeltCachedJson(cached);
  }

  try {
    const now = new Date();
    const queryText = buildGdeltQueryText(personName, searchQueryOverride);
    if (searchQueryOverride) {
      console.log(`[GDELT] Using search override for ${personName}: "${queryText}"`);
    }

    const url24h = buildGdelt24hArtlistUrl(personName, now, searchQueryOverride);

    const response24h = await fetchWithRetry(url24h);
    if (response24h?.ok) {
      recordSpacingSuccess();
    } else if (response24h === null) {
      recordSpacingFailure();
    }

    let parsed = parseGdelt24hArtlistResponse(null, searchQueryOverride || personName);
    if (response24h?.ok) {
      const text = await response24h.text();
      try {
        parsed = parseGdelt24hArtlistResponse(JSON.parse(text), searchQueryOverride || personName);
      } catch {
        parsed = parseGdelt24hArtlistResponse(null, searchQueryOverride || personName);
      }
    }

    const result: GdeltNewsData = { ...parsed };

    await setCachedResponse(cacheKey, "gdelt", personId || null, JSON.stringify(result), 2);

    return result;
  } catch (error) {
    console.error(`[GDELT] Error fetching ${personName}:`, error);
    const stale = await getStaleCache(cacheKey);
    if (stale) return parseGdeltCachedJson(stale);
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
      results.set(person.id, parseGdeltCachedJson(cached));
      cacheReused++;
    } else {
      const stale = await getStaleCache(cacheKey);
      if (stale) {
        results.set(person.id, parseGdeltCachedJson(stale));
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
        if (stale) { results.set(remaining.id, parseGdeltCachedJson(stale)); staleUsed++; }
      }
      break;
    }

    const elapsed = Date.now() - batchStart;
    if (elapsed > timeBudgetMs) {
      console.warn(`[GDELT] Time budget exhausted (${Math.round(elapsed / 1000)}s > ${Math.round(timeBudgetMs / 1000)}s). Processed ${processed}/${priorityPeople.length} priority.`);
      for (const remaining of priorityPeople.slice(processed)) {
        const cacheKey = `gdelt:news:${remaining.name.toLowerCase().replace(/\s+/g, "_")}`;
        const stale = await getStaleCache(cacheKey);
        if (stale) { results.set(remaining.id, parseGdeltCachedJson(stale)); staleUsed++; }
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
        results.set(person.id, parseGdeltCachedJson(reusable));
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
