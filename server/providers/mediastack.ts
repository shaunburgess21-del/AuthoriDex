import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq, and, gt, sql } from "drizzle-orm";
import pLimit from "p-limit";

const MEDIASTACK_API_KEY = process.env.MEDIASTACK_API_KEY;
const MEDIASTACK_BASE_URL = "https://api.mediastack.com/v1/news";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 15000;

const BUDGET_TRACKER_KEY = "system:mediastack_budget";

export interface NewsArticleRef {
  url: string;
  title?: string;
  publishedAt?: string;
}

export interface MediastackNewsData {
  query: string;
  articleCount24h: number;
  articleCount7d: number;
  averageDaily7d: number;
  delta: number;
  topHeadlines: string[];
  source: "mediastack";
  paginationTotal: number;
  languageRelaxed?: boolean;
  // Used by the multi-source aggregator for URL-level dedup. Legacy cached
  // entries may not have this field; aggregator falls back to counts in that case.
  articles?: NewsArticleRef[];
}

export interface MediastackBatchStats {
  total: number;
  fetched: number;
  cached: number;
  failed: number;
  /**
   * Count of people who got nothing because the batch ran in cache-only mode
   * and had no fresh cache entry. NOT a real failure — distinct from `failed`,
   * which is reserved for actual API errors. Driven primarily by budget
   * throttling at cycle-end.
   */
  cacheOnlyEmpty: number;
  /**
   * True when the batch ran in cache-only mode because the budget hard-stop
   * fired. Lets downstream code distinguish "throttled by us" from "external
   * API failure" when reporting source health.
   */
  budgetThrottled: boolean;
  apiCallsMade: number;
  durationMs: number;
  successCount: number;
  nonZeroCount: number;
  successCoveragePct: number;
  nonZeroCoveragePct: number;
  top25NonZeroCount: number;
  top25Total: number;
  top25NonZeroCoveragePct: number;
  widening?: {
    firedCount: number;
    successCount: number;
    cooldownSkippedCount: number;
  };
}

export interface WidenDiagnostic {
  personId: string;
  personName: string;
  plainCount: number;
  widenedCount: number;
  chosenCount: number;
  keywordsUsed: string;
  widenedApplied: boolean;
  cooldownSkipped?: boolean;
}

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

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface MediastackApiResponse {
  pagination?: {
    limit: number;
    offset: number;
    count: number;
    total: number;
  };
  data?: Array<{
    author: string | null;
    title: string;
    description: string | null;
    url: string;
    source: string;
    image: string | null;
    category: string;
    language: string;
    country: string;
    published_at: string;
  }>;
  error?: {
    code: string;
    message: string;
    context?: any;
  };
}

async function fetchWithRetry(url: string): Promise<MediastackApiResponse | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`[Mediastack] Rate limited (429), attempt ${attempt}/${MAX_RETRIES}`);
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
            continue;
          }
          return null;
        }
        if (response.status >= 500) {
          console.warn(`[Mediastack] Server error (${response.status}), attempt ${attempt}/${MAX_RETRIES}`);
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
            continue;
          }
          return null;
        }
        const body = await response.text();
        console.error(`[Mediastack] HTTP ${response.status}: ${body.substring(0, 200)}`);
        return null;
      }

      const data: MediastackApiResponse = await response.json();

      if (data.error) {
        console.error(`[Mediastack] API error: ${data.error.code} - ${data.error.message}`);
        return null;
      }

      return data;
    } catch (error: any) {
      const errorType = error.name === 'AbortError' ? 'timeout' : 'network';
      if (attempt < MAX_RETRIES) {
        console.warn(`[Mediastack] ${errorType} error, retry ${attempt}/${MAX_RETRIES}`);
        await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
      } else {
        console.error(`[Mediastack] All ${MAX_RETRIES} attempts failed (${errorType})`);
        return null;
      }
    }
  }
  return null;
}

let _apiCallsThisRun = 0;

export function getApiCallsThisRun(): number {
  return _apiCallsThisRun;
}

export function resetApiCallCounter(): void {
  _apiCallsThisRun = 0;
}

export async function trackApiCall(): Promise<void> {
  _apiCallsThisRun++;

  try {
    const today = formatDate(new Date());
    const budgetKey = `${BUDGET_TRACKER_KEY}:${today}`;

    const existing = await db.select({ responseData: apiCache.responseData })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, budgetKey))
      .limit(1);

    const currentCount = existing.length > 0 && existing[0].responseData
      ? JSON.parse(existing[0].responseData).calls ?? 0
      : 0;

    const newData = JSON.stringify({
      calls: currentCount + 1,
      date: today,
      lastCallAt: new Date().toISOString(),
    });

    const farFuture = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (existing.length > 0) {
      await db.update(apiCache)
        .set({ responseData: newData, fetchedAt: new Date(), expiresAt: farFuture })
        .where(eq(apiCache.cacheKey, budgetKey));
    } else {
      await db.insert(apiCache).values({
        cacheKey: budgetKey,
        provider: "system",
        responseData: newData,
        fetchedAt: new Date(),
        expiresAt: farFuture,
      });
    }
  } catch (err) {
    // Budget tracking is non-critical, don't fail the pipeline
  }
}

export async function getDailyCallCount(date?: string): Promise<number> {
  const targetDate = date || formatDate(new Date());
  const budgetKey = `${BUDGET_TRACKER_KEY}:${targetDate}`;

  try {
    const row = await db.select({ responseData: apiCache.responseData })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, budgetKey))
      .limit(1);

    if (row.length > 0 && row[0].responseData) {
      return JSON.parse(row[0].responseData).calls ?? 0;
    }
  } catch (err) {
    console.error("[mediastack] Error fetching daily call count:", err);
  }
  return 0;
}

// Mediastack billing cycle: hardcoded to renew on day 20 of each month
// (cycle e.g. 20 Apr -> 19 May). Previous calendar-month projection extrapolated
// a noisy 7-day average across the whole month, which over-projected by ~5x
// during cache-warmup at cycle start and tripped the budget hard-stop too early.
const BILLING_CYCLE_START_DAY = 20;

function getCurrentCycleStart(now: Date = new Date()): Date {
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), BILLING_CYCLE_START_DAY);
  cycleStart.setHours(0, 0, 0, 0);
  if (now < cycleStart) {
    cycleStart.setMonth(cycleStart.getMonth() - 1);
  }
  return cycleStart;
}

function getNextCycleStart(cycleStart: Date): Date {
  const next = new Date(cycleStart);
  next.setMonth(next.getMonth() + 1);
  return next;
}

export interface MediastackCycleUsage {
  cycleStartDate: string;
  cycleEndDate: string;
  cycleLengthDays: number;
  daysIntoCycle: number;
  daysRemainingInCycle: number;
  usedThisCycle: number;
  paceCallsPerDay: number;
  projectedCycle: number;
  dailyHistory: Array<{ date: string; calls: number }>;
}

export async function getCycleUsage(now: Date = new Date()): Promise<MediastackCycleUsage> {
  const cycleStart = getCurrentCycleStart(now);
  const nextCycleStart = getNextCycleStart(cycleStart);
  const cycleLengthDays = Math.round((nextCycleStart.getTime() - cycleStart.getTime()) / 86_400_000);

  const msSinceStart = now.getTime() - cycleStart.getTime();
  const daysIntoCycle = Math.max(1, Math.floor(msSinceStart / 86_400_000) + 1);
  const daysRemainingInCycle = Math.max(0, cycleLengthDays - daysIntoCycle);

  const dailyHistory: Array<{ date: string; calls: number }> = [];
  let usedThisCycle = 0;
  for (let i = 0; i < daysIntoCycle; i++) {
    const d = new Date(cycleStart);
    d.setDate(d.getDate() + i);
    if (d > now) break;
    const dateStr = formatDate(d);
    const calls = await getDailyCallCount(dateStr);
    usedThisCycle += calls;
    dailyHistory.push({ date: dateStr, calls });
  }

  const paceCallsPerDay = usedThisCycle / Math.max(1, daysIntoCycle);
  const projectedCycle = Math.round(usedThisCycle + paceCallsPerDay * daysRemainingInCycle);

  const cycleEndInclusive = new Date(nextCycleStart);
  cycleEndInclusive.setDate(cycleEndInclusive.getDate() - 1);

  return {
    cycleStartDate: formatDate(cycleStart),
    cycleEndDate: formatDate(cycleEndInclusive),
    cycleLengthDays,
    daysIntoCycle,
    daysRemainingInCycle,
    usedThisCycle,
    paceCallsPerDay: Math.round(paceCallsPerDay),
    projectedCycle,
    dailyHistory,
  };
}

/**
 * Legacy shim: kept so any existing imports continue to compile, now driven
 * by billing-cycle math instead of calendar-month math. Prefer
 * {@link getCycleUsage} for new call sites.
 *
 * `dailyCalls` is the most-recent 7 days, today-first (legacy ordering).
 * `totalThisMonth` is now the running cycle total despite the name.
 */
export async function getMonthlyCallEstimate(): Promise<{ dailyCalls: number[]; totalThisMonth: number; projectedMonthly: number }> {
  const usage = await getCycleUsage();
  const dailyCalls = [...usage.dailyHistory].reverse().slice(0, 7).map(d => d.calls);
  while (dailyCalls.length < 7) dailyCalls.push(0);
  return {
    dailyCalls,
    totalThisMonth: usage.usedThisCycle,
    projectedMonthly: usage.projectedCycle,
  };
}

export async function fetchMediastackNews(
  personName: string,
  personId?: string,
  keywordsOverride?: string | null,
): Promise<MediastackNewsData | null> {
  if (!MEDIASTACK_API_KEY) {
    console.log(`[Mediastack] No API key configured, skipping ${personName}`);
    return null;
  }

  const queryText = keywordsOverride || personName;
  const cacheKey = keywordsOverride
    ? `mediastack:news:${personName.replace(/\s+/g, "_").toLowerCase()}:widened`
    : `mediastack:news:${personName.replace(/\s+/g, "_").toLowerCase()}`;
  // TTL pinned to refresh cadence — see MEDIASTACK_CACHE_TTL_HOURS comment below.
  const CACHE_TTL_HOURS = MEDIASTACK_CACHE_TTL_HOURS;

  try {
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return JSON.parse(cached.responseData);
    }

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const keywords = encodeURIComponent(queryText);
    const dateFrom = formatDate(yesterday);
    const dateTo = formatDate(now);

    if (keywordsOverride) {
      console.log(`[Mediastack] Widened query for ${personName}: "${keywordsOverride}"`);
    }

    const urlWithLang = `${MEDIASTACK_BASE_URL}?access_key=${MEDIASTACK_API_KEY}&keywords=${keywords}&languages=en&sort=published_desc&limit=100&date=${dateFrom},${dateTo}`;

    const data = await fetchWithRetry(urlWithLang);
    await trackApiCall();

    if (!data || !data.pagination) {
      return null;
    }

    let articleCount24h = data.pagination.total;
    let topHeadlines = (data.data || [])
      .slice(0, 3)
      .map(a => a.title || "");
    let articles: NewsArticleRef[] = (data.data || [])
      .filter(a => !!a.url)
      .map(a => ({ url: a.url, title: a.title, publishedAt: a.published_at }));
    let languageRelaxed = false;

    if (articleCount24h === 0) {
      const urlNoLang = `${MEDIASTACK_BASE_URL}?access_key=${MEDIASTACK_API_KEY}&keywords=${keywords}&sort=published_desc&limit=100&date=${dateFrom},${dateTo}`;
      const retryData = await fetchWithRetry(urlNoLang);
      await trackApiCall();

      if (retryData?.pagination && retryData.pagination.total > 0) {
        articleCount24h = retryData.pagination.total;
        // Intentionally leave topHeadlines empty: the relaxed query returns
        // non-English titles which we don't want to display. The ingest
        // pipeline backfills English headlines via Serper for people with
        // languageRelaxed=true.
        languageRelaxed = true;
        articles = (retryData.data || [])
          .filter(a => !!a.url)
          .map(a => ({ url: a.url, title: a.title, publishedAt: a.published_at }));
        console.log(`[Mediastack] Language-relaxed retry for "${queryText}": ${articleCount24h} articles (vs 0 with languages=en); headlines left empty for English backfill`);
      }
    }

    const result: MediastackNewsData = {
      query: queryText,
      articleCount24h,
      articleCount7d: 0,
      averageDaily7d: 0,
      delta: 0,
      topHeadlines,
      source: "mediastack",
      paginationTotal: articleCount24h,
      languageRelaxed,
      articles,
    };

    await setCachedResponse(cacheKey, "mediastack", JSON.stringify(result), CACHE_TTL_HOURS);

    return result;
  } catch (error) {
    console.error(`[Mediastack] Error fetching news for ${personName}:`, error);
    return null;
  }
}

const WIDEN_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const WIDEN_COOLDOWN_KEY_PREFIX = "system:mediastack_widen_cooldown:";

async function getWidenCooldown(personId: string): Promise<Date | null> {
  try {
    const key = `${WIDEN_COOLDOWN_KEY_PREFIX}${personId}`;
    const row = await db.select({ responseData: apiCache.responseData })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, key))
      .limit(1);
    if (row.length > 0 && row[0].responseData) {
      const parsed = JSON.parse(row[0].responseData);
      return parsed.lastWidenedAt ? new Date(parsed.lastWidenedAt) : null;
    }
  } catch {}
  return null;
}

async function setWidenCooldown(personId: string): Promise<void> {
  const key = `${WIDEN_COOLDOWN_KEY_PREFIX}${personId}`;
  const now = new Date();
  const data = JSON.stringify({ lastWidenedAt: now.toISOString() });
  const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(apiCache).values({
    cacheKey: key,
    provider: "system",
    responseData: data,
    fetchedAt: now,
    expiresAt: farFuture,
  }).onConflictDoUpdate({
    target: apiCache.cacheKey,
    set: { responseData: data, fetchedAt: now, expiresAt: farFuture },
  });
}

export async function fetchMediastackBatch(
  people: Array<{ id: string; name: string; newsQueryWidened?: string | null }>,
  concurrency: number = 3,
  delayMs: number = 400,
  options?: { cacheOnly?: boolean; widenCandidateIds?: Set<string>; budgetThrottled?: boolean }
): Promise<{ data: Map<string, MediastackNewsData>; stats: MediastackBatchStats; isRefresh: boolean; widenedCount: number; widenDiagnostics: WidenDiagnostic[] }> {
  const results = new Map<string, MediastackNewsData>();
  const startTime = Date.now();
  let fetched = 0;
  let cached = 0;
  let failed = 0;
  let cacheOnlyEmpty = 0;
  let apiCallsMade = 0;
  let widenedCount = 0;
  let widenFiredCount = 0;
  let widenCooldownSkipped = 0;
  const widenDiagnostics: WidenDiagnostic[] = [];
  const cacheOnly = options?.cacheOnly ?? false;
  const budgetThrottled = options?.budgetThrottled ?? false;
  const widenCandidateIds = options?.widenCandidateIds;
  const WIDEN_THRESHOLD = 3;
  const limit = pLimit(concurrency);

  if (!MEDIASTACK_API_KEY) {
    console.log(`[Mediastack] No API key configured, skipping batch`);
    return {
      data: results,
      stats: { total: people.length, fetched: 0, cached: 0, failed: people.length, cacheOnlyEmpty: 0, budgetThrottled: false, apiCallsMade: 0, durationMs: 0, successCount: 0, nonZeroCount: 0, successCoveragePct: 0, nonZeroCoveragePct: 0, top25NonZeroCount: 0, top25Total: Math.min(25, people.length), top25NonZeroCoveragePct: 0 },
      isRefresh: false,
      widenedCount: 0,
      widenDiagnostics: [],
    };
  }

  resetApiCallCounter();

  if (cacheOnly) {
    console.log(`[Mediastack] Cache-only mode — reusing cached data for ${people.length} people`);
  } else {
    console.log(`[Mediastack] Refresh mode — fetching fresh news for ${people.length} people (concurrency=${concurrency}, delay=${delayMs}ms)`);
  }

  const tasks = people.map((person, index) =>
    limit(async () => {
      if (index > 0 && !cacheOnly) {
        await sleep(delayMs);
      }

      const primaryCacheKey = `mediastack:news:${person.name.replace(/\s+/g, "_").toLowerCase()}`;
      const cachedData = await getCachedResponse(primaryCacheKey);

      if (cachedData) {
        const parsed = JSON.parse(cachedData.responseData) as MediastackNewsData;
        results.set(person.id, parsed);
        cached++;
        return;
      }

      if (cacheOnly) {
        cacheOnlyEmpty++;
        return;
      }

      const result = await fetchMediastackNews(person.name, person.id);
      if (result) {
        results.set(person.id, result);
        fetched++;
        apiCallsMade++;

        if (
          result.articleCount24h < WIDEN_THRESHOLD &&
          person.newsQueryWidened &&
          widenCandidateIds?.has(person.id)
        ) {
          const lastWidened = await getWidenCooldown(person.id);
          const cooldownActive = lastWidened &&
            (Date.now() - lastWidened.getTime()) < WIDEN_COOLDOWN_MS &&
            result.articleCount24h > 0;

          if (cooldownActive) {
            console.log(`[Mediastack] Widen cooldown active for ${person.name} (last widened ${Math.round((Date.now() - lastWidened!.getTime()) / 60000)}min ago), skipping`);
            widenCooldownSkipped++;
            widenDiagnostics.push({
              personId: person.id,
              personName: person.name,
              plainCount: result.articleCount24h,
              widenedCount: 0,
              chosenCount: result.articleCount24h,
              keywordsUsed: person.name,
              widenedApplied: false,
              cooldownSkipped: true,
            });
            return;
          }

          widenFiredCount++;
          await sleep(delayMs);
          const widenedResult = await fetchMediastackNews(person.name, person.id, person.newsQueryWidened);
          apiCallsMade++;

          if (widenedResult && widenedResult.articleCount24h > result.articleCount24h) {
            const chosen: MediastackNewsData = {
              ...widenedResult,
              topHeadlines: widenedResult.topHeadlines.slice(0, 3),
              query: `${person.name} [widened:${person.newsQueryWidened}]`,
            };
            results.set(person.id, chosen);

            await setCachedResponse(primaryCacheKey, "mediastack", JSON.stringify(chosen), MEDIASTACK_CACHE_TTL_HOURS);

            await setWidenCooldown(person.id);
            widenedCount++;

            console.log(`[Mediastack] Widened pick-best for ${person.name}: plain=${result.articleCount24h} < widened=${widenedResult.articleCount24h}, chose widened ("${person.newsQueryWidened}")`);

            widenDiagnostics.push({
              personId: person.id,
              personName: person.name,
              plainCount: result.articleCount24h,
              widenedCount: widenedResult.articleCount24h,
              chosenCount: widenedResult.articleCount24h,
              keywordsUsed: person.newsQueryWidened!,
              widenedApplied: true,
            });
          } else {
            await setWidenCooldown(person.id);
            widenDiagnostics.push({
              personId: person.id,
              personName: person.name,
              plainCount: result.articleCount24h,
              widenedCount: widenedResult?.articleCount24h ?? 0,
              chosenCount: result.articleCount24h,
              keywordsUsed: person.name,
              widenedApplied: false,
            });
          }
        }
      } else {
        failed++;
      }
    })
  );

  await Promise.all(tasks);

  if (!cacheOnly && fetched > 0) {
    await setLastMediastackFetchAt(new Date());
  }

  const durationMs = Date.now() - startTime;

  const successCount = results.size;
  let nonZeroCount = 0;
  results.forEach((entry) => {
    if ((entry.articleCount24h ?? 0) > 0) nonZeroCount++;
  });

  const top25Ids = new Set(people.slice(0, 25).map(p => p.id));
  let top25NonZeroCount = 0;
  top25Ids.forEach((pid) => {
    const entry = results.get(pid);
    if (entry && (entry.articleCount24h ?? 0) > 0) top25NonZeroCount++;
  });
  const top25Total = Math.min(25, people.length);

  const stats: MediastackBatchStats = {
    total: people.length,
    fetched,
    cached,
    failed,
    cacheOnlyEmpty,
    budgetThrottled,
    apiCallsMade: getApiCallsThisRun(),
    durationMs,
    successCount,
    nonZeroCount,
    successCoveragePct: people.length > 0 ? (successCount / people.length) * 100 : 0,
    nonZeroCoveragePct: people.length > 0 ? (nonZeroCount / people.length) * 100 : 0,
    top25NonZeroCount,
    top25Total,
    top25NonZeroCoveragePct: top25Total > 0 ? (top25NonZeroCount / top25Total) * 100 : 0,
    widening: widenFiredCount > 0 || widenCooldownSkipped > 0
      ? { firedCount: widenFiredCount, successCount: widenedCount, cooldownSkippedCount: widenCooldownSkipped }
      : undefined,
  };

  const widenSuffix = widenedCount > 0 ? ` + ${widenedCount} widened` : "";
  const cooldownSuffix = widenCooldownSkipped > 0 ? ` (${widenCooldownSkipped} cooldown-skipped)` : "";
  const cacheOnlyEmptySuffix = cacheOnlyEmpty > 0
    ? ` + ${cacheOnlyEmpty} cache-only-empty${budgetThrottled ? " (budget hard stop)" : ""}`
    : "";
  const failedSuffix = failed > 0 ? ` + ${failed} failed` : "";
  console.log(`[Mediastack] Batch complete: ${fetched} fresh + ${cached} cached${cacheOnlyEmptySuffix}${failedSuffix}${widenSuffix}${cooldownSuffix} = ${results.size}/${people.length} in ${(durationMs / 1000).toFixed(1)}s (${stats.apiCallsMade} API calls, success=${stats.successCoveragePct.toFixed(0)}%, nonZero=${stats.nonZeroCoveragePct.toFixed(0)}%)`);

  return { data: results, stats, isRefresh: !cacheOnly && fetched > 0, widenedCount, widenDiagnostics };
}

export function isMediastackConfigured(): boolean {
  return !!MEDIASTACK_API_KEY;
}

const LAST_FETCH_KEY = "system:mediastack:last_fetch_at";
// Default refresh cadence: 180 minutes (3h) to stay inside the 50k/month plan
// at the current ~159-people roster. Math: 159 people × (24/3) refreshes/day ×
// ~30 days ≈ 38k calls/cycle (~76% of 50k). At 120min it would be ~57k/cycle
// which exceeds the plan limit and trips the budget hard-stop weeks early.
// Drop to MEDIASTACK_REFRESH_INTERVAL_MINUTES=120 only after upgrading to a
// higher tier. The cycle-aware budget check below will throttle automatically
// if projected usage approaches the BUDGET_HARD_STOP_PCT ceiling.
const MEDIASTACK_REFRESH_INTERVAL_MINUTES = (() => {
  const raw = parseInt(process.env.MEDIASTACK_REFRESH_INTERVAL_MINUTES ?? "180", 10);
  if (!Number.isFinite(raw) || raw < 30 || raw > 360) return 180;
  return raw;
})();
const MEDIASTACK_REFRESH_INTERVAL_MS = MEDIASTACK_REFRESH_INTERVAL_MINUTES * 60 * 1000;

// Cache TTL is intentionally pinned to the refresh interval (minus a 5-minute
// safety margin so the cache always expires fractionally BEFORE the next
// refresh becomes due). Previously TTL was hardcoded at 2h while the refresh
// interval defaults to 3h, leaving a ~1h window each cycle where the cache
// was dead and `cacheOnly=true` ticks returned empty results — driving the
// hourly news-count sawtooth (and, downstream, the trend-score sawtooth).
// Pinning it to the refresh cadence closes that gap: every cache-only tick
// hits a warm cache, and every refresh tick hits an expired cache → live fetch.
const MEDIASTACK_CACHE_TTL_HOURS = Math.max(1, MEDIASTACK_REFRESH_INTERVAL_MINUTES - 5) / 60;

/**
 * Canonical refresh cadence (minutes) used by the Mediastack provider.
 * Exposed so admin endpoints can display the same value the runtime is
 * actually using, instead of re-parsing the env var with their own fallback.
 */
export function getMediastackRefreshIntervalMinutes(): number {
  return MEDIASTACK_REFRESH_INTERVAL_MINUTES;
}
const MEDIASTACK_MONTHLY_LIMIT = 50_000;
const BUDGET_WARN_PCT = 85;
// Slightly lower than 95 now that the projection is honest (cycle-aware rather
// than calendar-month). 92% leaves a real safety buffer for the last few days
// of a cycle while still avoiding premature cutoffs.
const BUDGET_HARD_STOP_PCT = 92;

export async function getLastMediastackFetchAt(): Promise<Date | null> {
  try {
    const row = await db.select({ responseData: apiCache.responseData })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, LAST_FETCH_KEY))
      .limit(1);
    if (row.length > 0 && row[0].responseData) {
      const parsed = JSON.parse(row[0].responseData);
      return parsed.fetchedAt ? new Date(parsed.fetchedAt) : null;
    }
  } catch {}
  return null;
}

export async function setLastMediastackFetchAt(timestamp: Date): Promise<void> {
  const data = JSON.stringify({ fetchedAt: timestamp.toISOString() });
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await db.insert(apiCache).values({
    cacheKey: LAST_FETCH_KEY,
    provider: "system",
    responseData: data,
    fetchedAt: timestamp,
    expiresAt: farFuture,
  }).onConflictDoUpdate({
    target: apiCache.cacheKey,
    set: { responseData: data, fetchedAt: timestamp, expiresAt: farFuture },
  });
}

export async function shouldRefreshMediastack(): Promise<{ shouldRefresh: boolean; lastFetchAt: Date | null; ageMs: number | null; budgetThrottled: boolean }> {
  const lastFetch = await getLastMediastackFetchAt();
  if (!lastFetch) {
    return { shouldRefresh: true, lastFetchAt: null, ageMs: null, budgetThrottled: false };
  }
  const ageMs = Date.now() - lastFetch.getTime();
  const cadenceDue = ageMs >= MEDIASTACK_REFRESH_INTERVAL_MS;

  if (cadenceDue) {
    try {
      const usage = await getCycleUsage();
      const projectedPct = (usage.projectedCycle / MEDIASTACK_MONTHLY_LIMIT) * 100;
      const usedPct = (usage.usedThisCycle / MEDIASTACK_MONTHLY_LIMIT) * 100;
      if (projectedPct >= BUDGET_HARD_STOP_PCT) {
        console.warn(
          `[Mediastack] Budget hard stop: cycle ${usage.cycleStartDate}→${usage.cycleEndDate}, ` +
          `used ${usage.usedThisCycle}/${MEDIASTACK_MONTHLY_LIMIT} (${usedPct.toFixed(0)}%), ` +
          `pace ${usage.paceCallsPerDay}/day, projected ${usage.projectedCycle} (${projectedPct.toFixed(0)}%) — skipping refresh`,
        );
        return { shouldRefresh: false, lastFetchAt: lastFetch, ageMs, budgetThrottled: true };
      }
      if (projectedPct >= BUDGET_WARN_PCT) {
        console.warn(
          `[Mediastack] Budget warning: cycle used ${usage.usedThisCycle}/${MEDIASTACK_MONTHLY_LIMIT} ` +
          `(${usedPct.toFixed(0)}%), pace ${usage.paceCallsPerDay}/day, projected ${usage.projectedCycle} ` +
          `(${projectedPct.toFixed(0)}% of limit, ${usage.daysRemainingInCycle}d remaining)`,
        );
      }
    } catch (err) {
      console.warn("[Mediastack] Budget check failed, proceeding with refresh:", err);
    }
  }

  return {
    shouldRefresh: cadenceDue,
    lastFetchAt: lastFetch,
    ageMs,
    budgetThrottled: false,
  };
}

export async function getMediastackBudgetSummary() {
  const usage = await getCycleUsage();
  const now = new Date();
  const projectedPct = Math.round((usage.projectedCycle / MEDIASTACK_MONTHLY_LIMIT) * 100);
  const usedPct = Math.round((usage.usedThisCycle / MEDIASTACK_MONTHLY_LIMIT) * 100);
  const dailyHistory7d = [...usage.dailyHistory].reverse().slice(0, 7).map(d => d.calls);
  while (dailyHistory7d.length < 7) dailyHistory7d.push(0);
  const callsToday = dailyHistory7d[0] ?? 0;
  const totalLast7d = dailyHistory7d.reduce((s, n) => s + n, 0);

  return {
    cycleStartDate: usage.cycleStartDate,
    cycleEndDate: usage.cycleEndDate,
    cycleLengthDays: usage.cycleLengthDays,
    daysIntoCycle: usage.daysIntoCycle,
    daysRemainingInCycle: usage.daysRemainingInCycle,
    usedThisCycle: usage.usedThisCycle,
    usedPct,
    paceCallsPerDay: usage.paceCallsPerDay,
    projectedCycle: usage.projectedCycle,
    cycleLimit: MEDIASTACK_MONTHLY_LIMIT,
    usagePct: projectedPct,
    callsToday,
    dailyHistory7d,
    status: projectedPct >= BUDGET_HARD_STOP_PCT ? "hard_stop" : projectedPct >= BUDGET_WARN_PCT ? "warning" : "ok",
    // Legacy aliases — retained for one release; new callers should use the cycle* fields above.
    totalLast7d,
    projectedMonthly: usage.projectedCycle,
    monthlyLimit: MEDIASTACK_MONTHLY_LIMIT,
    dayOfMonth: now.getDate(),
    daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
  };
}

export interface MediastackProbeResult {
  personName: string;
  withLanguageFilter: { articleCount: number; topHeadlines: string[] };
  withoutLanguageFilter: { articleCount: number; topHeadlines: string[] };
  recommendation: "ok" | "relaxed_helps" | "no_results";
}

export async function probeMediastackLive(personName: string): Promise<MediastackProbeResult | null> {
  if (!MEDIASTACK_API_KEY) return null;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const keywords = encodeURIComponent(personName);
  const dateFrom = formatDate(yesterday);
  const dateTo = formatDate(now);

  const urlWithLang = `${MEDIASTACK_BASE_URL}?access_key=${MEDIASTACK_API_KEY}&keywords=${keywords}&languages=en&sort=published_desc&limit=100&date=${dateFrom},${dateTo}`;
  const dataWithLang = await fetchWithRetry(urlWithLang);
  await trackApiCall();

  const withLangCount = dataWithLang?.pagination?.total ?? 0;
  const withLangHeadlines = (dataWithLang?.data || []).slice(0, 3).map(a => a.title || "");

  const urlNoLang = `${MEDIASTACK_BASE_URL}?access_key=${MEDIASTACK_API_KEY}&keywords=${keywords}&sort=published_desc&limit=100&date=${dateFrom},${dateTo}`;
  const dataNoLang = await fetchWithRetry(urlNoLang);
  await trackApiCall();

  const noLangCount = dataNoLang?.pagination?.total ?? 0;
  const noLangHeadlines = (dataNoLang?.data || []).slice(0, 3).map(a => a.title || "");

  let recommendation: MediastackProbeResult["recommendation"] = "ok";
  if (withLangCount === 0 && noLangCount > 0) {
    recommendation = "relaxed_helps";
  } else if (withLangCount === 0 && noLangCount === 0) {
    recommendation = "no_results";
  }

  return {
    personName,
    withLanguageFilter: { articleCount: withLangCount, topHeadlines: withLangHeadlines },
    withoutLanguageFilter: { articleCount: noLangCount, topHeadlines: noLangHeadlines },
    recommendation,
  };
}
