import { db } from "../db";
import { trackedPeople, trendSnapshots, trendingPeople, celebrityImages, ingestionRuns, apiCache } from "@shared/schema";
import { desc, eq, sql, gte, and, inArray } from "drizzle-orm";
import { getBaselineDiagnostics } from "../utils/baseline";
import { fetchBatchWikiPageviews } from "../providers/wiki";
import { fetchBatchGdeltNews, GdeltBatchOptions, GdeltBatchStats } from "../providers/gdelt";
import { fetchSerperBatch, fetchSerperNewsBatch } from "../providers/serper";
import { fetchMediastackBatch, isMediastackConfigured, MediastackBatchStats, shouldRefreshMediastack } from "../providers/mediastack";
import { computeTrendScore } from "../scoring/trendScore";
import { refreshSourceStats } from "../scoring/sourceStats";
import { evaluateCanaries, CanaryReport, getCanaryNames } from "../scoring/canaryMonitor";
import {
  calculateGlobalHealthMetrics,
  updateSourceHealth,
  getStalenessDecayFactor,
  getCurrentHealthSnapshot,
  getHealthSummary,
  hasAnyDegradedSource,
  loadHealthFromDB,
  saveHealthState,
  computeDegradationGovernor,
  updateCanaryStreak,
} from "../scoring/sourceHealth";
import {
  updateCatchUpMode,
  isCatchUpModeActive,
  getCatchUpBand,
  loadCatchUpStateFromDB,
  getCatchUpExitStreak,
  getCatchUpEnteredAtHour,
  getCatchUpCapMultiplier,
  getCatchUpAlphaMultiplier,
  getDynamicRateLimit,
  getDynamicAlpha,
  MAX_HOURLY_CHANGE_PERCENT,
  EMA_ALPHA_DEFAULT,
  EMA_ALPHA_2_SOURCES,
  EMA_ALPHA_3_SOURCES,
  SCORE_VERSION,
} from "../scoring/normalize";

const GDELT_CANDIDATE_COUNT = 25;

async function computeNewsCandidates(
  people: Array<{ id: string; name: string }>,
  wikiData: Map<string, any>,
): Promise<Set<string>> {
  const candidates = new Set<string>();

  const currentRankings = await db
    .select({ id: trendingPeople.id, rank: trendingPeople.rank })
    .from(trendingPeople)
    .orderBy(trendingPeople.rank);
  
  const currentRankMap = new Map<string, number>();
  for (const r of currentRankings) {
    currentRankMap.set(r.id, r.rank ?? 999);
  }

  for (const r of currentRankings.slice(0, GDELT_CANDIDATE_COUNT)) {
    candidates.add(r.id);
  }

  const wikiSorted = people
    .map(p => ({
      id: p.id,
      pageviews: wikiData.get(p.id)?.pageviews24h ?? 0,
    }))
    .sort((a, b) => b.pageviews - a.pageviews);

  for (const entry of wikiSorted.slice(0, GDELT_CANDIDATE_COUNT)) {
    candidates.add(entry.id);
  }

  console.log(`[Ingest] GDELT candidate gating: ${candidates.size} candidates (top ${GDELT_CANDIDATE_COUNT} by rank + top ${GDELT_CANDIDATE_COUNT} by wiki)`);
  return candidates;
}

export const SNAPSHOT_DIAGNOSTICS_VERSION = 1;

export interface LastRunMeta {
  runId: string;
  newsProviderUsed: "mediastack" | "gdelt" | "serper_news";
  newsFreshCoveragePct: number;
  searchFreshCoveragePct: number;
  newsGovernorFactor: number;
  searchGovernorFactor: number;
  newsMedianArticles: number;
  newsMeanArticles: number;
  newsQualityLow: boolean;
  finishedAt: Date;
  mediastackSuccessPct?: number;
  mediastackNonZeroPct?: number;
  mediastackTop25NonZeroPct?: number;
  mediastackIsRefresh?: boolean;
  mediastackLastFetchAt?: string | null;
  perPersonFallback?: {
    triggered: number;
    succeeded: number;
    skippedCooldown: number;
    skippedNotQualified: number;
    patched: string[];
    topTriggered: Array<{ name: string; streak: number; rank: number }>;
  };
}
let _lastRunMeta: LastRunMeta | null = null;
const LAST_RUN_META_KEY = "system:lastRunMeta";
const HEALTH_SUMMARY_KEY = "system:healthSummary";

export function getLastRunMeta(): LastRunMeta | null {
  return _lastRunMeta;
}

async function persistSystemKey(key: string, data: any): Promise<void> {
  try {
    const json = JSON.stringify(data);
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const existing = await db.select({ id: apiCache.id }).from(apiCache).where(eq(apiCache.cacheKey, key));
    if (existing.length > 0) {
      await db.update(apiCache)
        .set({ responseData: json, fetchedAt: new Date(), expiresAt: farFuture })
        .where(eq(apiCache.cacheKey, key));
    } else {
      await db.insert(apiCache).values({
        cacheKey: key,
        provider: "system",
        responseData: json,
        fetchedAt: new Date(),
        expiresAt: farFuture,
      });
    }
  } catch (err) {
    console.error(`[Persist] Failed to save ${key}:`, err);
  }
}

export async function loadLastRunMetaFromDB(): Promise<void> {
  try {
    const rows = await db.select().from(apiCache).where(eq(apiCache.cacheKey, LAST_RUN_META_KEY));
    if (rows.length > 0 && rows[0].responseData) {
      const parsed = JSON.parse(rows[0].responseData);
      if (parsed.finishedAt) parsed.finishedAt = new Date(parsed.finishedAt);
      _lastRunMeta = parsed;
      console.log(`[LastRunMeta] Loaded persisted state from DB (finished ${parsed.finishedAt?.toISOString?.() ?? 'unknown'})`);
    } else {
      console.log(`[LastRunMeta] No persisted state found`);
    }
  } catch (err) {
    console.error(`[LastRunMeta] Failed to load from DB:`, err);
  }
}

const NEWS_PROVIDER_PREF_KEY = "system:news_provider_pref";
const GDELT_RECOVERY_THRESHOLD = 4;
const GDELT_RECOVERY_RUNS_NEEDED = 2;

interface NewsProviderPref {
  preferSerper: boolean;
  consecutiveGoodGdeltRuns: number;
  lastUpdated: string;
}

let _newsProviderPref: NewsProviderPref = {
  preferSerper: false,
  consecutiveGoodGdeltRuns: 0,
  lastUpdated: new Date().toISOString(),
};

export async function loadNewsProviderPref(): Promise<void> {
  try {
    const rows = await db.select({ responseData: apiCache.responseData })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, NEWS_PROVIDER_PREF_KEY));
    if (rows.length > 0 && rows[0].responseData) {
      const parsed = JSON.parse(rows[0].responseData) as NewsProviderPref;
      _newsProviderPref = parsed;
    }
  } catch (err) {
    console.warn("[NewsProviderPref] Failed to load from DB, using defaults");
  }
}

async function saveNewsProviderPref(): Promise<void> {
  try {
    _newsProviderPref.lastUpdated = new Date().toISOString();
    const data = JSON.stringify(_newsProviderPref);
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const existing = await db.select({ id: apiCache.id })
      .from(apiCache)
      .where(eq(apiCache.cacheKey, NEWS_PROVIDER_PREF_KEY));
    if (existing.length > 0) {
      await db.update(apiCache)
        .set({ responseData: data, fetchedAt: new Date(), expiresAt: farFuture })
        .where(eq(apiCache.cacheKey, NEWS_PROVIDER_PREF_KEY));
    } else {
      await db.insert(apiCache).values({
        cacheKey: NEWS_PROVIDER_PREF_KEY,
        provider: "system",
        responseData: data,
        fetchedAt: new Date(),
        expiresAt: farFuture,
      });
    }
  } catch (err) {
    console.error("[NewsProviderPref] Failed to save:", err);
  }
}

function shouldPreferSerper(gdeltMedian: number, gdeltQualityLow: boolean): boolean {
  if (gdeltQualityLow) {
    _newsProviderPref.preferSerper = true;
    _newsProviderPref.consecutiveGoodGdeltRuns = 0;
    return true;
  }

  if (_newsProviderPref.preferSerper) {
    if (gdeltMedian >= GDELT_RECOVERY_THRESHOLD) {
      _newsProviderPref.consecutiveGoodGdeltRuns++;
      if (_newsProviderPref.consecutiveGoodGdeltRuns >= GDELT_RECOVERY_RUNS_NEEDED) {
        console.log(`[NewsProviderPref] GDELT quality recovered (median=${gdeltMedian} >= ${GDELT_RECOVERY_THRESHOLD} for ${_newsProviderPref.consecutiveGoodGdeltRuns} runs). Switching back to GDELT.`);
        _newsProviderPref.preferSerper = false;
        _newsProviderPref.consecutiveGoodGdeltRuns = 0;
        return false;
      }
      console.log(`[NewsProviderPref] GDELT looks better (median=${gdeltMedian}), need ${GDELT_RECOVERY_RUNS_NEEDED - _newsProviderPref.consecutiveGoodGdeltRuns} more good run(s) to switch back.`);
      return true;
    } else {
      _newsProviderPref.consecutiveGoodGdeltRuns = 0;
      return true;
    }
  }

  return false;
}

export function parseSnapshotDiagnostics(diagnostics: unknown): Record<string, any> | null {
  if (!diagnostics || typeof diagnostics !== "object") return null;
  const d = diagnostics as Record<string, any>;
  if (d.v !== SNAPSHOT_DIAGNOSTICS_VERSION) {
    console.warn(`[DIAG_VERSION_MISMATCH] Expected v:${SNAPSHOT_DIAGNOSTICS_VERSION}, got v:${d.v} — treating as absent`);
    return null;
  }
  return d;
}

export interface IngestResult {
  processed: number;
  errors: number;
  duration: number;
  runId?: string;
  lockedOut?: boolean;
}

const HEARTBEAT_STALE_MS = 10 * 60 * 1000; // 10 minutes without heartbeat = stale
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // update heartbeat every 2 minutes

const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

function startHeartbeat(runId: string) {
  stopHeartbeat(runId);
  const timer = setInterval(async () => {
    try {
      await db.update(ingestionRuns)
        .set({ heartbeatAt: new Date() })
        .where(eq(ingestionRuns.id, runId));
    } catch (e) {
      console.error(`[Ingest Heartbeat] Failed to update heartbeat for run ${runId}:`, e);
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimers.set(runId, timer);
}

function stopHeartbeat(runId?: string) {
  if (runId) {
    const timer = heartbeatTimers.get(runId);
    if (timer) {
      clearInterval(timer);
      heartbeatTimers.delete(runId);
    }
  } else {
    heartbeatTimers.forEach((timer) => clearInterval(timer));
    heartbeatTimers.clear();
  }
}

async function acquireIngestionLock(): Promise<{ acquired: boolean; runId?: string; existingRunId?: string }> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - HEARTBEAT_STALE_MS);

  const existingRuns = await db.select()
    .from(ingestionRuns)
    .where(eq(ingestionRuns.status, "running"));

  for (const run of existingRuns) {
    const lastSignOfLife = run.heartbeatAt ?? run.startedAt;
    if (lastSignOfLife < staleThreshold) {
      console.warn(`[Ingest Lock] Found stale running lock (id=${run.id}, lastHeartbeat=${lastSignOfLife.toISOString()}). Marking as failed.`);
      await db.update(ingestionRuns)
        .set({ status: "failed", finishedAt: now, errorSummary: `Stale lock auto-cleaned (no heartbeat for >${HEARTBEAT_STALE_MS / 60000}min)` })
        .where(eq(ingestionRuns.id, run.id));
    } else {
      console.warn(`[Ingest Lock] Another ingestion is currently running (id=${run.id}, started=${run.startedAt.toISOString()}, lastHeartbeat=${lastSignOfLife.toISOString()})`);
      return { acquired: false, existingRunId: run.id };
    }
  }

  try {
    const [newRun] = await db.insert(ingestionRuns)
      .values({ status: "running", lockAcquiredAt: now, heartbeatAt: now, scoreVersion: SCORE_VERSION })
      .returning({ id: ingestionRuns.id });

    console.log(`[Ingest Lock] Acquired lock, run ID: ${newRun.id}`);
    startHeartbeat(newRun.id);
    return { acquired: true, runId: newRun.id };
  } catch (err: any) {
    if (err?.code === '23505' && err?.constraint?.includes('running')) {
      console.warn(`[Ingest Lock] Race detected: unique index prevented duplicate running row.`);
      const [existing] = await db.select({ id: ingestionRuns.id })
        .from(ingestionRuns)
        .where(eq(ingestionRuns.status, "running"))
        .limit(1);
      return { acquired: false, existingRunId: existing?.id ?? 'unknown' };
    }
    throw err;
  }
}

async function releaseIngestionLock(
  runId: string,
  status: "completed" | "failed",
  details: {
    snapshotsWritten?: number;
    peopleProcessed?: number;
    errorCount?: number;
    errorSummary?: string;
    sourceTimings?: Record<string, number>;
    sourceStatuses?: Record<string, string>;
    healthSummary?: Record<string, any>;
    hourBucket?: Date;
  }
) {
  stopHeartbeat(runId);
  await db.update(ingestionRuns)
    .set({
      status,
      finishedAt: new Date(),
      lockReleasedAt: new Date(),
      snapshotsWritten: details.snapshotsWritten ?? 0,
      peopleProcessed: details.peopleProcessed ?? 0,
      errorCount: details.errorCount ?? 0,
      errorSummary: details.errorSummary ?? null,
      sourceTimings: details.sourceTimings ?? null,
      sourceStatuses: details.sourceStatuses ?? null,
      healthSummary: details.healthSummary ?? null,
      hourBucket: details.hourBucket ?? null,
    })
    .where(eq(ingestionRuns.id, runId));
  
  console.log(`[Ingest Lock] Released lock, run ${runId} => ${status}`);
}

export async function runDataIngestion(): Promise<IngestResult> {
  const lockResult = await acquireIngestionLock();
  
  if (!lockResult.acquired) {
    console.warn(`[Ingest] SKIPPED: Another ingestion is running (${lockResult.existingRunId}). Cannot overlap.`);
    await db.insert(ingestionRuns)
      .values({ status: "locked_out", errorSummary: `Blocked by existing run ${lockResult.existingRunId}`, finishedAt: new Date(), scoreVersion: SCORE_VERSION });
    return { processed: 0, errors: 0, duration: 0, lockedOut: true };
  }
  
  const runId = lockResult.runId!;
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  const sourceTimings: Record<string, number> = {};
  const sourceStatuses: Record<string, string> = {};

  if (process.env.REQUIRE_DB_GUARDRAILS === 'true') {
    const { dbGuardrailsVerified } = await import('../guardrails');
    if (!dbGuardrailsVerified) {
      console.error(`[Ingest] ABORT: REQUIRE_DB_GUARDRAILS=true but DB constraints are missing. Refusing to write to prevent data corruption.`);
      await releaseIngestionLock(runId, "failed", { errorSummary: "DB guardrails not verified" });
      return { processed: 0, errors: 1, duration: Date.now() - startTime, runId };
    }
  }

  // Truncate to the hour for idempotency - multiple runs within same hour will be deduplicated
  // Using explicit truncation to prevent any race conditions or serialization issues
  const now = new Date();
  const hourTimestamp = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    0, 0, 0  // minutes, seconds, milliseconds all set to 0
  ));
  console.log(`[Ingest] Hour timestamp: ${hourTimestamp.toISOString()}`);

  console.log("[Ingest] Starting data ingestion...");

  await loadHealthFromDB();
  await loadCatchUpStateFromDB();
  await loadNewsProviderPref();
  await loadLastRunMetaFromDB();

  try {
    const people = await db.select().from(trackedPeople);
    console.log(`[Ingest] Found ${people.length} tracked people`);

    let wikiStart = Date.now();
    const wikiData = await fetchBatchWikiPageviews(
      people.map(p => ({ id: p.id, wikiSlug: p.wikiSlug }))
    );
    sourceTimings.wiki = Date.now() - wikiStart;
    sourceStatuses.wiki = wikiData.size > 0 ? "OK" : "FAILED";

    // ═══════════════════════════════════════════════════════════════════════════
    // NEWS DATA FETCHING — Cascading provider chain:
    //   1. Mediastack (primary, paid, every 2 hours)
    //   2. GDELT (secondary, free, fallback)
    //   3. Serper News (emergency, paid, last resort)
    //
    // On even UTC hours: call Mediastack fresh for all people
    // On odd UTC hours: reuse Mediastack cache (2h TTL) — no API calls
    // If Mediastack fails or isn't configured: fall through to GDELT → Serper
    // ═══════════════════════════════════════════════════════════════════════════
    const COVERAGE_THRESHOLD = 0.70;
    const SERPER_NEWS_FALLBACK_THRESHOLD = 0.30;
    const GDELT_QUALITY_THRESHOLD = 3;
    let newsSource: "mediastack" | "gdelt" | "serper_news" = "gdelt";
    let newsData = new Map<string, any>();
    let gdeltBatchStats: GdeltBatchStats | null = null;
    let mediastackBatchStats: MediastackBatchStats | null = null;

    const mediastackAvailable = isMediastackConfigured();
    let mediastackCadence: { shouldRefresh: boolean; lastFetchAt: Date | null; ageMs: number | null } | null = null;

    // ── TIER 1: Mediastack (primary) ──────────────────────────────────────────
    if (mediastackAvailable) {
      const msStart = Date.now();
      try {
        mediastackCadence = await shouldRefreshMediastack();
        const cacheOnly = !mediastackCadence.shouldRefresh;
        const ageHours = mediastackCadence.ageMs != null ? (mediastackCadence.ageMs / (1000 * 60 * 60)).toFixed(1) : "never";

        if (mediastackCadence.budgetThrottled) {
          console.warn(`[Ingest] Mediastack budget throttled — projected usage exceeds 95% of monthly limit, using cached data`);
        } else if (cacheOnly) {
          console.log(`[Ingest] Mediastack cache mode — last refresh ${ageHours}h ago (< 2h threshold), reusing cached data`);
        } else {
          console.log(`[Ingest] Mediastack refresh mode — last refresh ${ageHours}h ago (>= 2h threshold), fetching fresh news`);
        }

        const leaderboardRanks = await db.select({ name: trendingPeople.name, rank: trendingPeople.rank }).from(trendingPeople);
        const rankMap = new Map(leaderboardRanks.map(r => [r.name, r.rank ?? 9999]));
        const peopleSortedByRank = [...people].sort((a, b) => (rankMap.get(a.name) ?? 9999) - (rankMap.get(b.name) ?? 9999));
        const top25Ids = new Set(peopleSortedByRank.slice(0, 25).map(p => p.id));
        const canaryNames = new Set(getCanaryNames());
        const canaryIds = new Set(people.filter(p => canaryNames.has(p.name)).map(p => p.id));
        const widenCandidateIds = new Set([...Array.from(top25Ids), ...Array.from(canaryIds)]);
        const msResult = await fetchMediastackBatch(
          peopleSortedByRank.map(p => ({ id: p.id, name: p.name, newsQueryWidened: p.newsQueryWidened })),
          3,
          400,
          { cacheOnly, widenCandidateIds: cacheOnly ? undefined : widenCandidateIds },
        );
        mediastackBatchStats = msResult.stats;

        const msSuccessPct = msResult.stats.successCoveragePct;
        const msNonZeroPct = msResult.stats.nonZeroCoveragePct;
        if (msSuccessPct >= COVERAGE_THRESHOLD * 100) {
          newsData = msResult.data as Map<string, any>;
          newsSource = "mediastack";
          sourceStatuses.mediastack = "OK";
          console.log(`[Ingest] Mediastack primary: ${msResult.data.size}/${people.length} (success=${msSuccessPct.toFixed(0)}%, nonZero=${msNonZeroPct.toFixed(0)}%) — ${msResult.stats.fetched} fresh, ${msResult.stats.cached} cached, ${msResult.stats.failed} failed`);
        } else if (msResult.data.size > 0) {
          console.log(`[Coverage Gate] Mediastack partial: success=${msSuccessPct.toFixed(0)}% < ${COVERAGE_THRESHOLD * 100}% (nonZero=${msNonZeroPct.toFixed(0)}%) — falling through to GDELT`);
          sourceStatuses.mediastack = "DEGRADED";
        } else {
          console.log(`[Ingest] Mediastack returned no data — falling through to GDELT`);
          sourceStatuses.mediastack = "FAILED";
        }
      } catch (err) {
        console.error('[Ingest] Mediastack fetch failed:', err);
        sourceStatuses.mediastack = "FAILED";
      }
      sourceTimings.mediastack = Date.now() - msStart;
    }

    // ── TIER 2: GDELT (secondary) ────────────────────────────────────────────
    if (newsSource !== "mediastack") {
      const gdeltCandidates = await computeNewsCandidates(people, wikiData);
      let gdeltStart = Date.now();
      try {
        const newsHealth = getCurrentHealthSnapshot().news;
        const gdeltIsDegraded = newsHealth.state === "DEGRADED" || newsHealth.state === "OUTAGE" || newsHealth.state === "RECOVERY";
        const gdeltOptions: GdeltBatchOptions = {
          candidates: gdeltCandidates,
          timeBudgetMs: 120000,
          isDegraded: gdeltIsDegraded,
        };
        const gdeltResult = await fetchBatchGdeltNews(
          people.map(p => ({ id: p.id, name: p.name, searchQueryOverride: p.searchQueryOverride })),
          gdeltOptions
        );
        newsData = gdeltResult.data;
        gdeltBatchStats = gdeltResult.stats;
      } catch (err) {
        console.log('[Ingest] GDELT fetch failed, continuing with other sources');
        sourceStatuses.gdelt = "FAILED";
      }
      sourceTimings.gdelt = Date.now() - gdeltStart;

      const gdeltCoverage = newsData.size / people.length;
      if (newsData.size > 0 && gdeltCoverage < COVERAGE_THRESHOLD) {
        console.log(`[Coverage Gate] GDELT partial failure: ${newsData.size}/${people.length} (${(gdeltCoverage * 100).toFixed(0)}%) < ${COVERAGE_THRESHOLD * 100}% threshold`);
        console.log(`[Coverage Gate] Treating NEWS as degraded for entire run - using previous values for all celebrities`);
        newsData.clear();
        sourceStatuses.gdelt = "DEGRADED";
      }
      if (!sourceStatuses.gdelt) sourceStatuses.gdelt = newsData.size > 0 ? "OK" : "DEGRADED";
    }

    // Compute news quality metrics (used for GDELT→Serper fallback decision and health summary)
    const newsArticleCounts = Array.from(newsData.values())
      .map((d: any) => d.articleCount24h ?? d.paginationTotal ?? 0)
      .sort((a: number, b: number) => a - b);
    const gdeltMedianArticles = newsArticleCounts.length > 0
      ? newsArticleCounts[Math.floor(newsArticleCounts.length / 2)]
      : 0;
    const gdeltMeanArticles = newsArticleCounts.length > 0
      ? newsArticleCounts.reduce((s: number, v: number) => s + v, 0) / newsArticleCounts.length
      : 0;
    const gdeltQualityLow = newsSource === "gdelt" && newsData.size > 0 && gdeltMedianArticles < GDELT_QUALITY_THRESHOLD;
    const gdeltFreshPct = newsData.size / people.length;

    // ── TIER 3: Serper News (emergency fallback) ─────────────────────────────
    // Only triggers when using GDELT as primary and GDELT quality is poor
    if (newsSource === "gdelt") {
      const useSerperFallback = shouldPreferSerper(gdeltMedianArticles, gdeltQualityLow);

      if (gdeltQualityLow) {
        console.log(`[Ingest] GDELT data quality low: median=${gdeltMedianArticles}, mean=${gdeltMeanArticles.toFixed(1)}, threshold=${GDELT_QUALITY_THRESHOLD}`);
      }
      if (useSerperFallback && !gdeltQualityLow) {
        console.log(`[Ingest] Provider hysteresis: still preferring Serper (GDELT median=${gdeltMedianArticles}, need >=${GDELT_RECOVERY_THRESHOLD} for ${GDELT_RECOVERY_RUNS_NEEDED} runs)`);
      }

      if (gdeltFreshPct < SERPER_NEWS_FALLBACK_THRESHOLD || useSerperFallback) {
        const reason = useSerperFallback
          ? `provider preference (hysteresis: GDELT median=${gdeltMedianArticles})`
          : `freshness ${(gdeltFreshPct * 100).toFixed(0)}% < ${SERPER_NEWS_FALLBACK_THRESHOLD * 100}%`;
        console.log(`[Ingest] ${reason} — activating Serper News fallback`);
        try {
          const serperNewsStart = Date.now();
          const serperNewsData = await fetchSerperNewsBatch(
            people.map(p => ({ id: p.id, name: p.name })),
            2,
            500
          );
          const serperNewsTiming = Date.now() - serperNewsStart;
          const serperNewsCoverage = serperNewsData.size / people.length;

          if (serperNewsCoverage >= SERPER_NEWS_FALLBACK_THRESHOLD) {
            console.log(`[Ingest] Serper News fallback successful: ${serperNewsData.size}/${people.length} (${(serperNewsCoverage * 100).toFixed(0)}%) in ${(serperNewsTiming / 1000).toFixed(1)}s`);
            for (const [id, data] of Array.from(serperNewsData.entries())) {
              newsData.set(id, {
                query: data.query,
                articleCount24h: data.articleCount24h,
                articleCount7d: data.articleCount7d,
                averageDaily7d: data.averageDaily7d,
                delta: data.delta,
                topHeadlines: data.topHeadlines,
              });
            }
            newsSource = "serper_news";
            sourceStatuses.gdelt = "OK_FALLBACK";
          } else {
            console.log(`[Ingest] Serper News fallback also insufficient: ${serperNewsData.size}/${people.length} (${(serperNewsCoverage * 100).toFixed(0)}%)`);
          }
        } catch (err) {
          console.error('[Ingest] Serper News fallback failed:', err);
        }
      }
    }

    const perPersonFallbackStats = {
      triggered: 0,
      succeeded: 0,
      skippedCooldown: 0,
      skippedQualified: 0,
      patchedPeople: [] as string[],
      topTriggered: [] as Array<{ name: string; streak: number; rank: number }>,
    };

    let serperStart = Date.now();
    let serperData = await fetchSerperBatch(
      people.map(p => ({ id: p.id, name: p.name, searchQueryOverride: p.searchQueryOverride })),
      2,
      1000
    );
    sourceTimings.serper = Date.now() - serperStart;

    const serperCoverage = serperData.size / people.length;
    if (serperData.size > 0 && serperCoverage < COVERAGE_THRESHOLD) {
      console.log(`[Coverage Gate] Serper partial failure: ${serperData.size}/${people.length} (${(serperCoverage * 100).toFixed(0)}%) < ${COVERAGE_THRESHOLD * 100}% threshold`);
      console.log(`[Coverage Gate] Treating SEARCH as degraded for entire run - using previous values for all celebrities`);
      serperData = new Map();
      sourceStatuses.serper = "DEGRADED";
    }
    if (!sourceStatuses.serper) sourceStatuses.serper = serperData.size > 0 ? "OK" : "DEGRADED";

    // NOTE (Jan 2026): X API disabled for trend scoring - kept for Platform Insights
    // const xHandles = people.filter(p => p.xHandle).map(p => p.xHandle!);
    // const xData = await fetchXBatch(xHandles, 100);

    // Fetch historical snapshots for change calculations (same logic as quick-score.ts)
    // Also fetch news/search values for graceful degradation when APIs fail
    const now = new Date();
    const time24hAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const time7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const historicalSnapshots = await db.select({
      personId: trendSnapshots.personId,
      timestamp: trendSnapshots.timestamp,
      trendScore: trendSnapshots.trendScore,
      fameIndex: trendSnapshots.fameIndex,
      newsCount: trendSnapshots.newsCount,
      searchVolume: trendSnapshots.searchVolume,
      newsDelta: trendSnapshots.newsDelta,
      searchDelta: trendSnapshots.searchDelta,
    }).from(trendSnapshots).where(
      and(
        gte(trendSnapshots.timestamp, time7dAgo),
        eq(trendSnapshots.snapshotOrigin, 'ingest')
      )
    );
    
    // Create maps for different lookups:
    // - mostRecentMap: Most recent snapshot for EMA continuity (CRITICAL for stabilization)
    //   Also stores news/search values for graceful degradation when APIs fail
    // - lastNonZeroNewsMap: Most recent snapshot with non-zero newsCount per person
    //   Used as bootstrap fallback when GDELT has been down for multiple runs
    // - lastNonZeroSearchMap: Same for search volume
    // - snapshot24hMap: Snapshot from ~24h ago for change24h calculation
    // - snapshot7dMap: Snapshot from ~7d ago for change7d calculation
    const mostRecentMap = new Map<string, { 
      trendScore: number; 
      fameIndex: number | null; 
      timestamp: Date;
      newsCount: number | null;
      searchVolume: number | null;
      newsDelta: number | null;
      searchDelta: number | null;
    }>();
    const lastNonZeroNewsMap = new Map<string, { newsCount: number; newsDelta: number; timestamp: Date }>();
    const lastNonZeroSearchMap = new Map<string, { searchVolume: number; searchDelta: number; timestamp: Date }>();
    const snapshot24hMap = new Map<string, { trendScore: number; fameIndex: number | null; timestamp?: Date; basisHours?: number }>();
    const snapshot7dMap = new Map<string, { trendScore: number; fameIndex: number | null }>();
    
    for (const snap of historicalSnapshots) {
      const snapTime = new Date(snap.timestamp).getTime();
      const diff24h = Math.abs(snapTime - time24hAgo.getTime());
      const diff7d = Math.abs(snapTime - time7dAgo.getTime());
      
      // Track most recent snapshot per person (for EMA smoothing continuity + fallback data)
      const existingRecent = mostRecentMap.get(snap.personId);
      if (!existingRecent || new Date(snap.timestamp) > existingRecent.timestamp) {
        mostRecentMap.set(snap.personId, { 
          trendScore: snap.trendScore, 
          fameIndex: snap.fameIndex,
          timestamp: new Date(snap.timestamp),
          newsCount: snap.newsCount,
          searchVolume: snap.searchVolume,
          newsDelta: snap.newsDelta,
          searchDelta: snap.searchDelta,
        });
      }

      // Track last non-zero news snapshot (for bootstrap recovery from zero-propagation)
      if ((snap.newsCount ?? 0) > 0) {
        const existingNews = lastNonZeroNewsMap.get(snap.personId);
        if (!existingNews || new Date(snap.timestamp) > existingNews.timestamp) {
          lastNonZeroNewsMap.set(snap.personId, {
            newsCount: snap.newsCount!,
            newsDelta: snap.newsDelta ?? 0,
            timestamp: new Date(snap.timestamp),
          });
        }
      }

      // Track last non-zero search snapshot (same bootstrap logic)
      if ((snap.searchVolume ?? 0) > 0) {
        const existingSearch = lastNonZeroSearchMap.get(snap.personId);
        if (!existingSearch || new Date(snap.timestamp) > existingSearch.timestamp) {
          lastNonZeroSearchMap.set(snap.personId, {
            searchVolume: snap.searchVolume!,
            searchDelta: snap.searchDelta ?? 0,
            timestamp: new Date(snap.timestamp),
          });
        }
      }
      
      // Keep closest snapshot to 24h ago (within 18h–30h window to survive overnight gaps)
      // Window: now-30h to now-18h, picks snapshot closest to the 24h mark
      const snapAgeHours = (now.getTime() - snapTime) / (1000 * 60 * 60);
      if (snapAgeHours >= 18 && snapAgeHours <= 30) {
        const existing = snapshot24hMap.get(snap.personId);
        if (!existing || diff24h < Math.abs(new Date(existing.timestamp!).getTime() - time24hAgo.getTime())) {
          snapshot24hMap.set(snap.personId, { 
            trendScore: snap.trendScore, 
            fameIndex: snap.fameIndex, 
            timestamp: snap.timestamp,
            basisHours: Math.round(snapAgeHours * 10) / 10,
          });
        }
      }
      
      // Keep closest snapshot to 7d ago (within 18 hour window to survive gaps)
      if (diff7d < 18 * 60 * 60 * 1000) {
        const existing = snapshot7dMap.get(snap.personId);
        if (!existing) {
          snapshot7dMap.set(snap.personId, { trendScore: snap.trendScore, fameIndex: snap.fameIndex });
        }
      }
    }
    
    const newsBaselineMap = new Map<string, number>();
    const searchBaselineMap = new Map<string, number>();
    {
      const newsValues = new Map<string, number[]>();
      const searchValues = new Map<string, number[]>();
      for (const snap of historicalSnapshots) {
        if ((snap.newsCount ?? 0) > 0) {
          const arr = newsValues.get(snap.personId) ?? [];
          arr.push(snap.newsCount!);
          newsValues.set(snap.personId, arr);
        }
        if ((snap.searchVolume ?? 0) > 0) {
          const arr = searchValues.get(snap.personId) ?? [];
          arr.push(snap.searchVolume!);
          searchValues.set(snap.personId, arr);
        }
      }
      newsValues.forEach((vals, pid) => {
        vals.sort((a: number, b: number) => a - b);
        newsBaselineMap.set(pid, vals[Math.floor(vals.length / 2)]);
      });
      searchValues.forEach((vals, pid) => {
        vals.sort((a: number, b: number) => a - b);
        searchBaselineMap.set(pid, vals[Math.floor(vals.length / 2)]);
      });
    }

    console.log(`[Ingest] Bootstrap maps: ${lastNonZeroNewsMap.size} people with non-zero news history, ${lastNonZeroSearchMap.size} with non-zero search history`);
    
    console.log(`[Ingest] Found ${mostRecentMap.size} recent snapshots (EMA), ${snapshot24hMap.size} 24h snapshots, ${snapshot7dMap.size} 7d snapshots`);

    // ═══════════════════════════════════════════════════════════════════════════
    // PER-PERSON NEWS FALLBACK
    // ═══════════════════════════════════════════════════════════════════════════
    // Even when GDELT works globally, individual people can get zero articles.
    // This catches per-person blind spots (e.g. Elon Musk getting 0 while others
    // are fine) by making targeted Serper calls for affected individuals.
    //
    // Trigger: 2+ (GDELT) or 3+ (Mediastack) consecutive bad-news REFRESHES
    //          with news_count < 2, AND person is top-25 by rank OR wiki/search > p50
    // Safety:  max 15 per run, 90-minute cooldown, priority by rank
    // For Mediastack: only counts refresh-cycle snapshots (not cache-reuse ticks)
    // ═══════════════════════════════════════════════════════════════════════════
    const PER_PERSON_FALLBACK_MAX = 15;
    const PER_PERSON_FALLBACK_STREAK_THRESHOLD = newsSource === "mediastack" ? 3 : 2;
    const PER_PERSON_FALLBACK_COOLDOWN_MS = 90 * 60 * 1000;
    const PER_PERSON_FALLBACK_COOLDOWN_KEY_PREFIX = "system:pp_fallback_cd:serper_news:";
    const PER_PERSON_BAD_NEWS_THRESHOLD = 2;

    if ((newsSource === "gdelt" || newsSource === "mediastack") && newsData.size > 0) {
      const perPersonFallbackStart = Date.now();

      const streakLookbackMs = newsSource === "mediastack" ? 12 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
      const recentSnapsForStreak = await db.select({
        personId: trendSnapshots.personId,
        newsCount: trendSnapshots.newsCount,
        diagnostics: trendSnapshots.diagnostics,
        timestamp: trendSnapshots.timestamp,
      }).from(trendSnapshots).where(
        and(
          gte(trendSnapshots.timestamp, new Date(now.getTime() - streakLookbackMs)),
          eq(trendSnapshots.snapshotOrigin, 'ingest'),
        )
      ).orderBy(desc(trendSnapshots.timestamp));

      const streakMap = new Map<string, number>();
      const snapsByPerson = new Map<string, Array<{ newsCount: number | null; diagnostics: any; timestamp: Date }>>();
      for (const s of recentSnapsForStreak) {
        if (!snapsByPerson.has(s.personId)) snapsByPerson.set(s.personId, []);
        snapsByPerson.get(s.personId)!.push({
          newsCount: s.newsCount,
          diagnostics: s.diagnostics,
          timestamp: s.timestamp,
        });
      }

      for (const [personId, snaps] of Array.from(snapsByPerson.entries())) {
        const sorted = snaps.sort((a: typeof snaps[0], b: typeof snaps[0]) => b.timestamp.getTime() - a.timestamp.getTime());
        let streak = 0;
        let refreshesSeen = 0;
        const maxSnapsToCheck = newsSource === "mediastack" ? 10 : 3;
        for (const s of sorted.slice(0, maxSnapsToCheck)) {
          const diag = parseSnapshotDiagnostics(s.diagnostics);
          if (!diag || diag.fresh === undefined || diag.fresh === null) {
            continue;
          }
          const newsProvider = diag.newsSource ?? diag.provider?.news ?? diag.fresh?.newsSource;
          if (newsProvider && newsProvider === "serper_news") {
            continue;
          }
          if (newsSource === "mediastack" && diag.fresh?.newsIsRefresh === false) {
            continue;
          }
          refreshesSeen++;
          const freshNews = diag.fresh?.news === true;
          const count = s.newsCount ?? 0;
          if (!freshNews || count < PER_PERSON_BAD_NEWS_THRESHOLD) {
            streak++;
          } else {
            break;
          }
        }
        if (streak >= PER_PERSON_FALLBACK_STREAK_THRESHOLD) {
          streakMap.set(personId, streak);
        }
      }

      if (streakMap.size > 0) {
        const currentRankings = await db
          .select({ id: trendingPeople.id, rank: trendingPeople.rank })
          .from(trendingPeople)
          .orderBy(trendingPeople.rank);
        const ppRankMap = new Map(currentRankings.map(r => [r.id, r.rank ?? 999]));

        const wikiValues = Array.from(wikiData.values()).map((w: any) => w?.pageviews24h ?? 0).sort((a: number, b: number) => a - b);
        const wikiP50 = wikiValues.length > 0 ? wikiValues[Math.floor(wikiValues.length / 2)] : 0;
        const searchValues = Array.from(serperData.values()).map((s: any) => s?.searchVolume ?? 0).sort((a: number, b: number) => a - b);
        const searchP50 = searchValues.length > 0 ? searchValues[Math.floor(searchValues.length / 2)] : 0;

        const ppCandidates: Array<{ id: string; name: string; rank: number; streak: number }> = [];
        for (const [personId, streak] of Array.from(streakMap.entries())) {
          const person = people.find(p => p.id === personId);
          if (!person) continue;

          const rank = ppRankMap.get(personId) ?? 999;
          const wikiPv = wikiData.get(personId)?.pageviews24h ?? 0;
          const searchVol = serperData.get(personId)?.searchVolume ?? 0;
          const isTop25 = rank <= 25;
          const isAboveP50 = wikiPv >= wikiP50 || searchVol >= searchP50;

          if (isTop25 || isAboveP50) {
            ppCandidates.push({ id: personId, name: person.name, rank, streak });
          } else {
            perPersonFallbackStats.skippedQualified++;
          }
        }

        ppCandidates.sort((a, b) => a.rank - b.rank);

        const cooldownKeys = ppCandidates.slice(0, PER_PERSON_FALLBACK_MAX + 10).map(c =>
          PER_PERSON_FALLBACK_COOLDOWN_KEY_PREFIX + c.id
        );
        const cooldownRows = cooldownKeys.length > 0
          ? await db.select({ cacheKey: apiCache.cacheKey, fetchedAt: apiCache.fetchedAt })
              .from(apiCache)
              .where(inArray(apiCache.cacheKey, cooldownKeys))
          : [];
        const cooldownMap = new Map(cooldownRows.map(r => [r.cacheKey, r.fetchedAt]));

        const eligibleCandidates: typeof ppCandidates = [];
        for (const c of ppCandidates) {
          const cdKey = PER_PERSON_FALLBACK_COOLDOWN_KEY_PREFIX + c.id;
          const lastFallback = cooldownMap.get(cdKey);
          if (lastFallback && (now.getTime() - lastFallback.getTime()) < PER_PERSON_FALLBACK_COOLDOWN_MS) {
            perPersonFallbackStats.skippedCooldown++;
            continue;
          }
          eligibleCandidates.push(c);
          if (eligibleCandidates.length >= PER_PERSON_FALLBACK_MAX) break;
        }

        perPersonFallbackStats.topTriggered = ppCandidates.slice(0, 5).map(c => ({
          name: c.name,
          streak: c.streak,
          rank: c.rank,
        }));

        if (eligibleCandidates.length > 0) {
          console.log(`[Per-Person Fallback] Triggering for ${eligibleCandidates.length} people (${streakMap.size} with streaks, ${perPersonFallbackStats.skippedCooldown} on cooldown, ${perPersonFallbackStats.skippedQualified} not qualified)`);
          for (const c of eligibleCandidates) {
            console.log(`  → ${c.name} (#${c.rank}, streak=${c.streak})`);
          }

          const perPersonSerperData = await fetchSerperNewsBatch(
            eligibleCandidates.map(c => ({ id: c.id, name: c.name })),
            5,
            300
          );

          for (const c of eligibleCandidates) {
            perPersonFallbackStats.triggered++;
            const serperResult = perPersonSerperData.get(c.id);
            if (serperResult && serperResult.articleCount24h >= 3) {
              newsData.set(c.id, {
                query: serperResult.query,
                articleCount24h: serperResult.articleCount24h,
                articleCount7d: serperResult.articleCount7d,
                averageDaily7d: serperResult.averageDaily7d,
                delta: serperResult.delta,
                topHeadlines: serperResult.topHeadlines,
                _perPersonFallback: true,
                _fallbackReason: "per_person_zero_streak",
              });
              perPersonFallbackStats.succeeded++;
              perPersonFallbackStats.patchedPeople.push(c.name);
              console.log(`[Per-Person Fallback] ${c.name}: ${serperResult.articleCount24h} articles from Serper`);

              const cdKey = PER_PERSON_FALLBACK_COOLDOWN_KEY_PREFIX + c.id;
              const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
              await db.insert(apiCache).values({
                cacheKey: cdKey,
                provider: "system",
                responseData: JSON.stringify({ lastFallback: now.toISOString(), reason: "per_person_zero_streak" }),
                fetchedAt: now,
                expiresAt: farFuture,
              }).onConflictDoUpdate({
                target: apiCache.cacheKey,
                set: { fetchedAt: now, responseData: JSON.stringify({ lastFallback: now.toISOString(), reason: "per_person_zero_streak" }) },
              });
            } else {
              const count = serperResult?.articleCount24h ?? 0;
              console.log(`[Per-Person Fallback] ${c.name}: Serper returned ${count} articles (below threshold of 3)`);
            }
          }
        }

        const perPersonFallbackDuration = Date.now() - perPersonFallbackStart;
        if (perPersonFallbackStats.triggered > 0) {
          console.log(`[Per-Person Fallback] Complete: ${perPersonFallbackStats.succeeded}/${perPersonFallbackStats.triggered} succeeded in ${perPersonFallbackDuration}ms`);
        }
      }
    }

    // Fetch 7-day source statistics for normalization
    const sourceStats = await refreshSourceStats();

    // Stabilization stats tracking for monitoring
    const stabilizationStats = {
      totalProcessed: 0,
      withPreviousScore: 0,  // EMA applied
      rateLimited: 0,        // Hit rate cap
      largeChanges: 0,       // >10% raw change
      maxRawChange: 0,       // Largest raw change %
      avgRawChange: 0,       // Average raw change %
      rawChanges: [] as number[],
      gapPcts: [] as number[], // abs(raw - final) / final for each celebrity
      spikeDistribution: { 0: 0, 1: 0, 2: 0, 3: 0 } as Record<number, number>,
    };

    // Capture old rankings for churn tracking (before we update)
    const oldRankings = await db.select({
      id: trendingPeople.id,
      rank: trendingPeople.rank,
    }).from(trendingPeople);
    const oldRankMap = new Map(oldRankings.map(r => [r.id, r.rank]));
    const oldTop10 = new Set(oldRankings.filter(r => r.rank && r.rank <= 10).map(r => r.id));
    const oldTop20 = new Set(oldRankings.filter(r => r.rank && r.rank <= 20).map(r => r.id));

    const scoreResults: Array<{
      person: typeof people[0];
      score: ReturnType<typeof computeTrendScore>;
    }> = [];

    // Track API failure stats for logging
    let newsApiUsedFallback = 0;
    let searchApiUsedFallback = 0;
    let newsEmaHeldCount = 0;
    let searchEmaHeldCount = 0;
    const searchDeltaValues: number[] = [];
    let searchDeltaStaleCount = 0;
    const newsFailed = newsData.size === 0;
    const serperFailed = serperData.size === 0;
    
    // Build maps of current source values for global-zero detection
    // IMPORTANT: This runs AFTER the Serper News fallback, so newsData may
    // contain Serper-sourced data if fallback was activated. This ensures
    // global_zero detection evaluates the BEST available data, not just GDELT.
    const currentNewsValues = new Map<string, number>();
    const currentSearchValues = new Map<string, number>();
    
    for (const person of people) {
      const news = newsData.get(person.id);
      const serper = serperData.get(person.id);
      currentNewsValues.set(person.id, news?.articleCount24h ?? 0);
      currentSearchValues.set(person.id, serper?.searchVolume ?? 0);
    }
    
    // GLOBAL-ZERO DETECTION: Check if >50% of celebrities have near-zero values
    // This indicates a global outage rather than individual genuine drops
    const globalHealth = calculateGlobalHealthMetrics(
      currentNewsValues,
      currentSearchValues,
      people.length
    );

    // When Serper fallback is active and provided good quality data, override the
    // global_zero signal so the health state can transition out of OUTAGE.
    // Without this, the near-zero threshold (5) in detectGlobalOutage would keep
    // re-triggering OUTAGE even when fallback data is meaningful (median >= 3).
    const fallbackOverridesOutage = (newsSource === "serper_news" && !gdeltQualityLow) || newsSource === "mediastack";

    if (newsSource !== "gdelt") {
      console.log(`[Ingest] Post-news-fetch quality (${newsSource}): globalZero=${globalHealth.isNewsGlobalOutage}, nearZeroPct=${(globalHealth.newsNearZeroPercent * 100).toFixed(0)}%, fallbackOverride=${fallbackOverridesOutage}`);
    }

    const effectiveNewsGlobalOutage = fallbackOverridesOutage ? false : globalHealth.isNewsGlobalOutage;
    
    // Update source health states based on current conditions
    const newsHealth = updateSourceHealth("news", {
      apiFailed: newsFailed,
      isGlobalOutage: effectiveNewsGlobalOutage,
      dataReturned: !newsFailed && !effectiveNewsGlobalOutage,
    });
    
    const searchHealth = updateSourceHealth("search", {
      apiFailed: serperFailed,
      isGlobalOutage: globalHealth.isSearchGlobalOutage,
      dataReturned: !serperFailed && !globalHealth.isSearchGlobalOutage,
    });
    
    // Wiki is generally stable - just track if API returned data
    const wikiApiFailed = wikiData.size === 0;
    updateSourceHealth("wiki", {
      apiFailed: wikiApiFailed,
      isGlobalOutage: false, // Wiki rarely has global-zero issues
      dataReturned: !wikiApiFailed,
    });
    
    // Log health status
    console.log(getHealthSummary());
    
    if (newsFailed) {
      console.log('[Ingest] GDELT API failed completely - using graceful degradation (last known values)');
    } else if (effectiveNewsGlobalOutage) {
      console.log(`[Ingest] News global-zero detected (${Math.round(globalHealth.newsNearZeroPercent * 100)}% near-zero) - treating as OUTAGE`);
    }
    
    if (serperFailed) {
      console.log('[Ingest] Serper API failed completely - using graceful degradation (last known values)');
    } else if (globalHealth.isSearchGlobalOutage) {
      console.log(`[Ingest] Serper global-zero detected (${Math.round(globalHealth.searchNearZeroPercent * 100)}% near-zero) - treating as OUTAGE`);
    }
    
    // Get staleness decay factors for fill-forward values
    const newsDecayFactor = getStalenessDecayFactor(newsHealth.lastHealthyTimestamp);
    const searchDecayFactor = getStalenessDecayFactor(searchHealth.lastHealthyTimestamp);
    
    if (newsDecayFactor < 1.0 || searchDecayFactor < 1.0) {
      console.log(`[Ingest] Staleness decay: News=${(newsDecayFactor * 100).toFixed(0)}%, Search=${(searchDecayFactor * 100).toFixed(0)}%`);
    }

    const newsFreshCount = mediastackBatchStats
      ? mediastackBatchStats.fetched
      : gdeltBatchStats
        ? gdeltBatchStats.liveApiFetched
        : Array.from(newsData.values()).filter(d => (d.articleCount24h ?? 0) > 0).length;
    const newsCoveragePctActual = (newsFreshCount / people.length) * 100;
    const searchFreshCount = Array.from(serperData.values()).filter(d => (d.searchVolume ?? 0) > 0).length;
    const searchCoveragePctActual = (searchFreshCount / people.length) * 100;

    const newsGovernorFactor = computeDegradationGovernor("news", newsCoveragePctActual);
    const searchGovernorFactor = computeDegradationGovernor("search", searchCoveragePctActual);

    if (newsGovernorFactor < 1.0 || searchGovernorFactor < 1.0) {
      console.log(`[Ingest] Degradation governor: News=${(newsGovernorFactor * 100).toFixed(0)}%, Search=${(searchGovernorFactor * 100).toFixed(0)}%`);
    }

    let canaryReport: CanaryReport | null = null;
    try {
      canaryReport = await evaluateCanaries(newsData, serperData);
      console.log(`[Canary] ${canaryReport.resolved}/${canaryReport.canaryCount} resolved | News fails: ${canaryReport.newsFailures}, Search fails: ${canaryReport.searchFailures}${canaryReport.newsAlert ? " | NEWS ALERT" : ""}${canaryReport.searchAlert ? " | SEARCH ALERT" : ""}`);

      const newsCanary = updateCanaryStreak("news", canaryReport.newsAlert);
      const searchCanary = updateCanaryStreak("search", canaryReport.searchAlert);

      if (newsCanary.tripStreak > 0 || searchCanary.tripStreak > 0) {
        console.log(`[Canary] Streaks: News trip=${newsCanary.tripStreak} recover=${newsCanary.recoverStreak} | Search trip=${searchCanary.tripStreak} recover=${searchCanary.recoverStreak}`);
      }

      if (newsCanary.shouldAccelerate) {
        console.warn(`[Canary] Accelerating news health to DEGRADED (${newsCanary.tripStreak} consecutive canary trips, ${canaryReport.newsFailures} canaries failed)`);
        updateSourceHealth("news", { apiFailed: true, isGlobalOutage: false, dataReturned: false });
      }
      if (searchCanary.shouldAccelerate) {
        console.warn(`[Canary] Accelerating search health to DEGRADED (${searchCanary.tripStreak} consecutive canary trips, ${canaryReport.searchFailures} canaries failed)`);
        updateSourceHealth("search", { apiFailed: true, isGlobalOutage: false, dataReturned: false });
      }
    } catch (e) {
      console.warn("[Canary] Failed to evaluate canaries:", e);
    }

    for (const person of people) {
      try {
        const wiki = wikiData.get(person.id);
        const news = newsData.get(person.id);
        const serper = serperData.get(person.id);
        const mostRecent = mostRecentMap.get(person.id);
        // NOTE (Jan 2026): X API disabled for trend scoring - kept for Platform Insights
        // const xMetrics = person.xHandle 
        //   ? xData.get(person.xHandle.toLowerCase().replace("@", ""))
        //   : null;

        // GRACEFUL DEGRADATION: When API is in OUTAGE state (global-zero or complete failure),
        // carry forward last known values with staleness decay to prevent sudden score drops.
        // 
        // Key improvements:
        // 1. Only trigger fallback during GLOBAL OUTAGE (>50% near-zero), not individual drops
        // 2. Apply staleness decay: 100% → 50% → 20% over 6-12 hours
        // 3. Suspicious drops only count if global outage is detected
        let newsCount = news?.articleCount24h ?? 0;
        let newsDelta = news?.delta ?? 0;
        let searchVolume = serper?.searchVolume ?? 0;
        let newsUsedFallback = false;
        let searchUsedFallback = false;
        
        const prevNewsCount = mostRecent?.newsCount ?? 0;
        const prevSearchVolume = mostRecent?.searchVolume ?? 0;

        // Compute searchDelta from snapshot history instead of Serper's broken
        // date-based delta (organic results almost never have dates).
        // Uses bounded normalized change: (curr - prev) / max(prev, 20)
        // Denominator floor of 20 prevents explosions from low volumes.
        // Clamp to ±0.5 keeps it in the wikiDelta range (p95 ~0.58).
        const snapshotAgeHours = mostRecent ? (now.getTime() - mostRecent.timestamp.getTime()) / (1000 * 60 * 60) : Infinity;
        const searchDeltaRaw = (searchVolume - prevSearchVolume) / Math.max(prevSearchVolume, 20);
        let searchDelta = snapshotAgeHours > 6 ? 0 : Math.max(-0.5, Math.min(0.5, searchDeltaRaw));
        const searchDeltaStale = snapshotAgeHours > 6;
        
        // NEWS: Use fallback if source is in OUTAGE state (global-zero or API failed)
        const newsNeedsOutageFallback = newsHealth.state === "OUTAGE" || newsHealth.state === "DEGRADED";
        
        // If the current news data comes from a successful fallback (global Serper OR
        // per-person Serper) and has meaningful article counts, prefer it over decayed
        // fill-forward values. This prevents the system from ignoring good fallback data.
        const hasPerPersonFallback = news?._perPersonFallback === true;
        const newsHasGoodFallbackData = (newsSource === "serper_news" || hasPerPersonFallback) && news && newsCount >= 3;
        
        // Also detect individual suspicious drop, but only activate fallback if global outage
        const suspiciousNewsDrop = news && prevNewsCount >= 5 && 
          newsCount < prevNewsCount * 0.1; // 90%+ drop
        
        // Use fill-forward if: (global outage OR API failed) AND we don't have good fallback data
        // Bootstrap recovery: if prevNewsCount is 0 (from prior zero-propagation), 
        // look back in history for the last non-zero value to prevent permanent zero-lock
        if ((newsNeedsOutageFallback && !newsHasGoodFallbackData) || !news || (suspiciousNewsDrop && effectiveNewsGlobalOutage && !newsHasGoodFallbackData)) {
          let fallbackNewsCount = prevNewsCount;
          let fallbackNewsDelta = mostRecent?.newsDelta ?? 0;
          let fallbackDecay = newsDecayFactor;

          if (fallbackNewsCount <= 0) {
            const lastNonZero = lastNonZeroNewsMap.get(person.id);
            if (lastNonZero) {
              fallbackNewsCount = lastNonZero.newsCount;
              fallbackNewsDelta = lastNonZero.newsDelta;
              const staleHours = (now.getTime() - lastNonZero.timestamp.getTime()) / (1000 * 60 * 60);
              if (staleHours <= 2) fallbackDecay = 1.0;
              else if (staleHours <= 4) fallbackDecay = 1.0 - ((staleHours - 2) / 2) * 0.2;
              else if (staleHours <= 8) fallbackDecay = 0.8 - ((staleHours - 4) / 4) * 0.15;
              else if (staleHours <= 16) fallbackDecay = 0.65 - ((staleHours - 8) / 8) * 0.15;
              else fallbackDecay = 0.5;
            }
          }

          if (fallbackNewsCount > 0) {
            newsCount = Math.round(fallbackNewsCount * fallbackDecay);
            newsDelta = Math.round(fallbackNewsDelta * fallbackDecay);
            newsUsedFallback = true;
            newsApiUsedFallback++;
          }
        }
        
        let newsEmaHeld = false;
        let newsHoldDiag: Record<string, any> | null = null;
        const isMediastackRefreshTick = newsSource === "mediastack" ? (mediastackCadence?.shouldRefresh ?? true) : true;
        if (!newsUsedFallback && !newsNeedsOutageFallback && !hasPerPersonFallback && news && isMediastackRefreshTick) {
          const isProviderHealthy = newsHealth.state === "HEALTHY" || newsHealth.state === "RECOVERY";
          if (isProviderHealthy) {
            const rawNewsCount = newsCount;
            const bp50 = newsBaselineMap.get(person.id);
            const hasBaseline = bp50 !== undefined && bp50 >= 5;
            const baselineHold = hasBaseline &&
              rawNewsCount <= bp50! * 0.1 &&
              prevNewsCount >= bp50! * 0.5;
            const floorHold = !hasBaseline && prevNewsCount >= 12 &&
              rawNewsCount < prevNewsCount * 0.15;

            if (baselineHold || floorHold) {
              newsCount = prevNewsCount;
              newsDelta = mostRecent?.newsDelta ?? 0;
              newsEmaHeld = true;
              newsEmaHeldCount++;
              newsHoldDiag = {
                reason: baselineHold ? "baseline_artifact" : "floor_artifact",
                prevCount: prevNewsCount,
                currentCount: rawNewsCount,
                baselineP50: bp50 ?? null,
                dropRatio: prevNewsCount > 0 ? +(rawNewsCount / prevNewsCount).toFixed(3) : 0,
              };
            }
          }
        }

        // SEARCH: Use fallback if source is in OUTAGE state
        const searchNeedsOutageFallback = searchHealth.state === "OUTAGE" || searchHealth.state === "DEGRADED";
        
        const suspiciousSearchDrop = serper && prevSearchVolume >= 100 &&
          searchVolume < prevSearchVolume * 0.1; // 90%+ drop
        
        // Same bootstrap recovery logic for search
        if (searchNeedsOutageFallback || !serper || (suspiciousSearchDrop && globalHealth.isSearchGlobalOutage)) {
          let fallbackSearchVolume = prevSearchVolume;
          let fallbackDecay = searchDecayFactor;

          if (fallbackSearchVolume <= 0) {
            const lastNonZero = lastNonZeroSearchMap.get(person.id);
            if (lastNonZero) {
              fallbackSearchVolume = lastNonZero.searchVolume;
              const staleHours = (now.getTime() - lastNonZero.timestamp.getTime()) / (1000 * 60 * 60);
              if (staleHours <= 2) fallbackDecay = 1.0;
              else if (staleHours <= 4) fallbackDecay = 1.0 - ((staleHours - 2) / 2) * 0.2;
              else if (staleHours <= 8) fallbackDecay = 0.8 - ((staleHours - 4) / 4) * 0.15;
              else if (staleHours <= 16) fallbackDecay = 0.65 - ((staleHours - 8) / 8) * 0.15;
              else fallbackDecay = 0.5;
            }
          }

          if (fallbackSearchVolume > 0) {
            searchVolume = Math.round(fallbackSearchVolume * fallbackDecay);
            // Recompute searchDelta from fallback volume (don't use stored zero delta)
            const fbDeltaRaw = (searchVolume - prevSearchVolume) / Math.max(prevSearchVolume, 20);
            searchDelta = Math.max(-0.5, Math.min(0.5, fbDeltaRaw));
            searchUsedFallback = true;
            searchApiUsedFallback++;
          }
        }

        let searchEmaHeld = false;
        let searchHoldDiag: Record<string, any> | null = null;
        if (!searchUsedFallback && !searchNeedsOutageFallback && serper) {
          const isSearchHealthy = searchHealth.state === "HEALTHY" || searchHealth.state === "RECOVERY";
          if (isSearchHealthy) {
            const rawSearchVolume = searchVolume;
            const sbp50 = searchBaselineMap.get(person.id);
            const hasSearchBaseline = sbp50 !== undefined && sbp50 >= 50;
            const baselineHold = hasSearchBaseline &&
              rawSearchVolume <= sbp50! * 0.1 &&
              prevSearchVolume >= sbp50! * 0.6;
            const floorHold = !hasSearchBaseline && prevSearchVolume >= 200 &&
              rawSearchVolume < prevSearchVolume * 0.2;

            if (baselineHold || floorHold) {
              searchVolume = prevSearchVolume;
              searchDelta = mostRecent?.searchDelta ?? 0;
              searchEmaHeld = true;
              searchEmaHeldCount++;
              searchHoldDiag = {
                reason: baselineHold ? "baseline_artifact" : "floor_artifact",
                prevVolume: prevSearchVolume,
                currentVolume: rawSearchVolume,
                baselineP50: sbp50 ?? null,
                dropRatio: prevSearchVolume > 0 ? +(rawSearchVolume / prevSearchVolume).toFixed(3) : 0,
              };
            }
          }
        }

        // Get current source health states for weight renormalization
        const currentHealthSnapshot = getCurrentHealthSnapshot();
        
        searchDeltaValues.push(searchDelta);
        if (searchDeltaStale) searchDeltaStaleCount++;

        const inputs = {
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiPageviews7dAvg: wiki?.averageDaily7d || 0, // 7-day average for stable mass baseline
          wikiDelta: wiki?.delta || 0,
          newsDelta: newsDelta,
          searchDelta: searchDelta,
          // Raw values for normalization - use graceful degradation values
          newsCount: newsCount,
          searchVolume: searchVolume,
          // Previous values for recovery detection (data returning after API failure)
          // Only pass previous values if current data is FRESH (not fallback)
          // This ensures recovery mode triggers when we get fresh data after using fallback
          prevNewsCount: newsUsedFallback ? newsCount : (prevNewsCount),
          prevSearchVolume: searchUsedFallback ? searchVolume : (prevSearchVolume),
          // Flag whether current data is fresh (for recovery detection)
          newsIsFresh: !newsUsedFallback && (news?.articleCount24h ?? 0) > 0,
          searchIsFresh: !searchUsedFallback && (serper?.searchVolume ?? 0) > 0,
          // Baseline medians for spike detection (p50 is more robust than mean)
          wikiBaseline: wiki?.averageDaily7d || sourceStats.wiki.p50,
          newsBaseline: sourceStats.news.p50,  // Use median (p50), not mean - more robust
          searchBaseline: sourceStats.search.p50,
          activePlatforms: {
            wiki: !!person.wikiSlug,
            instagram: !!person.instagramHandle,
            youtube: !!person.youtubeId,
          },
          // Source health states for weight renormalization during outages
          sourceHealthStates: {
            newsOutage: currentHealthSnapshot.news.state === 'OUTAGE' || currentHealthSnapshot.news.state === 'DEGRADED',
            searchOutage: currentHealthSnapshot.search.state === 'OUTAGE' || currentHealthSnapshot.search.state === 'DEGRADED',
            wikiOutage: currentHealthSnapshot.wiki.state === 'OUTAGE' || currentHealthSnapshot.wiki.state === 'DEGRADED',
          },
          // Staleness decay for velocity WEIGHT reduction (not just value decay)
          // Governor factor further dampens weight when coverage drops sharply
          newsStalenessFactor: Math.min(newsUsedFallback ? newsDecayFactor : 1.0, newsGovernorFactor),
          searchStalenessFactor: Math.min(searchUsedFallback ? searchDecayFactor : 1.0, searchGovernorFactor),
        };

        // Get previous scores for change calculations and EMA smoothing
        // Note: mostRecent already fetched above for graceful degradation
        const prev24h = snapshot24hMap.get(person.id);
        const prev7d = snapshot7dMap.get(person.id);
        
        // CRITICAL: Use MOST RECENT fameIndex for EMA smoothing (not 24h-ago)
        // This ensures rate limiting and EMA are always applied for smooth transitions
        const previousFameIndex = mostRecent?.fameIndex ?? undefined;
        
        const scoreResult = computeTrendScore(
          inputs,
          prev24h?.trendScore,  // previousScore for change24h calculation (legacy fallback)
          prev7d?.trendScore,   // previousScore7d for change7d calculation (legacy fallback)
          previousFameIndex,    // Most recent fameIndex for EMA smoothing
          sourceStats,          // 7-day stats for normalization
          prev24h?.fameIndex ?? undefined,  // 24h-ago fameIndex for stable change_24h
          prev7d?.fameIndex ?? undefined,   // 7d-ago fameIndex for stable change_7d
        );

        // Track stabilization stats using pre-stabilization rawFameIndex
        stabilizationStats.totalProcessed++;
        // Track spike count distribution (0/1/2/3 sources spiking)
        const spikeCount = Math.min(3, Math.max(0, scoreResult.spikingSourceCount));
        stabilizationStats.spikeDistribution[spikeCount]++;
        
        if (scoreResult.wasStabilized && previousFameIndex !== undefined && previousFameIndex > 0) {
          stabilizationStats.withPreviousScore++;
          const rawChangePct = Math.abs((scoreResult.rawFameIndex - previousFameIndex) / previousFameIndex) * 100;
          stabilizationStats.rawChanges.push(rawChangePct);
          if (rawChangePct >= 8) stabilizationStats.rateLimited++; // 8% cap (raised from 5%)
          if (rawChangePct > 10) stabilizationStats.largeChanges++;
          if (rawChangePct > stabilizationStats.maxRawChange) stabilizationStats.maxRawChange = rawChangePct;
        }

        if (scoreResult.fameIndex > 0) {
          const gapPct = Math.abs(scoreResult.rawFameIndex - scoreResult.fameIndex) / scoreResult.fameIndex;
          stabilizationStats.gapPcts.push(gapPct);
        }

        const wasRateLimited = scoreResult.wasStabilized && previousFameIndex !== undefined && previousFameIndex > 0;
        const appliedCapPct = getDynamicRateLimit(scoreResult.spikingSourceCount);
        const appliedAlpha = getDynamicAlpha(scoreResult.spikingSourceCount);

        const diagnosticsData = {
          v: SNAPSHOT_DIAGNOSTICS_VERSION,
          raw: {
            wiki: wiki?.pageviews24h ?? 0,
            wiki7d: wiki?.averageDaily7d ?? 0,
            news: news?.articleCount24h ?? 0,
            search: serper?.searchVolume ?? 0,
          },
          fresh: {
            wiki: !!wiki,
            news: !newsUsedFallback && !newsEmaHeld && (news?.articleCount24h ?? 0) > 0,
            search: !searchUsedFallback && !searchEmaHeld && (serper?.searchVolume ?? 0) > 0,
            newsSource: hasPerPersonFallback ? "serper_news" : newsSource,
            newsIsRefresh: newsSource === "mediastack" ? (mediastackCadence?.shouldRefresh ?? true) : true,
            ...(hasPerPersonFallback ? { fallbackReason: news?._fallbackReason ?? "per_person_zero_streak" } : {}),
            ...(newsEmaHeld ? { newsEmaHeld: true, newsRawCount: news?.articleCount24h ?? 0, newsHoldDetail: newsHoldDiag } : {}),
            ...(searchEmaHeld ? { searchEmaHeld: true, searchRawVolume: serper?.searchVolume ?? 0, searchHoldDetail: searchHoldDiag } : {}),
            ...(searchDeltaStale ? { searchDeltaStale: true, snapshotAgeHours: Math.round(snapshotAgeHours * 10) / 10 } : {}),
          },
          change: {
            basisHours24h: prev24h?.basisHours ?? null,
            has24hBaseline: !!prev24h,
            has7dBaseline: !!prev7d,
          },
          evidence: {
            newsHeadlines: (news?.topHeadlines ?? []).slice(0, 3),
            newsProvider: hasPerPersonFallback ? "serper_news" : newsSource,
          },
          stab: scoreResult.stabDetail ? {
            ...scoreResult.stabDetail,
            capPct: scoreResult.stabDetail.capUsed,
            alpha: scoreResult.stabDetail.alphaUsed,
            limited: wasRateLimited,
            spikes: scoreResult.spikingSourceCount,
          } : {
            limited: wasRateLimited,
            capPct: Math.round(appliedCapPct * 1000) / 1000,
            alpha: Math.round(appliedAlpha * 1000) / 1000,
            spikes: scoreResult.spikingSourceCount,
            rawFame: scoreResult.rawFameIndex,
          },
        };

        const snapshotValues = {
          personId: person.id,
          timestamp: hourTimestamp,
          trendScore: scoreResult.trendScore,
          fameIndex: scoreResult.fameIndex,
          newsCount: newsCount,
          searchVolume: searchVolume,
          youtubeViews: 0,
          spotifyFollowers: 0,
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiDelta: wiki?.delta || 0,
          newsDelta: newsDelta,
          searchDelta: searchDelta,
          massScore: scoreResult.massScore,
          velocityScore: scoreResult.velocityScore,
          velocityAdjusted: scoreResult.velocityAdjusted,
          confidence: scoreResult.confidence,
          diversityMultiplier: scoreResult.diversityMultiplier,
          momentum: scoreResult.momentum,
          drivers: scoreResult.drivers,
          snapshotOrigin: 'ingest',
          diagnostics: diagnosticsData,
          runId: runId,
          scoreVersion: SCORE_VERSION,
        };
        await db.insert(trendSnapshots).values(snapshotValues)
          .onConflictDoUpdate({
            target: [trendSnapshots.personId, trendSnapshots.timestamp],
            set: {
              trendScore: snapshotValues.trendScore,
              fameIndex: snapshotValues.fameIndex,
              newsCount: snapshotValues.newsCount,
              searchVolume: snapshotValues.searchVolume,
              wikiPageviews: snapshotValues.wikiPageviews,
              wikiDelta: snapshotValues.wikiDelta,
              newsDelta: snapshotValues.newsDelta,
              searchDelta: snapshotValues.searchDelta,
              massScore: snapshotValues.massScore,
              velocityScore: snapshotValues.velocityScore,
              velocityAdjusted: snapshotValues.velocityAdjusted,
              confidence: snapshotValues.confidence,
              diversityMultiplier: snapshotValues.diversityMultiplier,
              momentum: snapshotValues.momentum,
              drivers: snapshotValues.drivers,
              snapshotOrigin: snapshotValues.snapshotOrigin,
              diagnostics: snapshotValues.diagnostics,
              runId: snapshotValues.runId,
            },
          });

        scoreResults.push({ person, score: scoreResult });
        processed++;
      } catch (error) {
        console.error(`[Ingest] Error processing ${person.name}:`, error);
        errors++;
      }
    }

    // Compute gap metrics (raw vs final score divergence) for catch-up mode
    const sortedGaps = [...stabilizationStats.gapPcts].sort((a, b) => a - b);
    const medianGapPct = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0;
    const p90GapPct = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length * 0.9)] : 0;

    await updateCatchUpMode(medianGapPct);
    const catchUpActive = isCatchUpModeActive();
    const catchUpCurrentBand = getCatchUpBand();
    const catchUpExitStreak = getCatchUpExitStreak();
    const catchUpEnteredAt = getCatchUpEnteredAtHour();
    const capMultiplier = getCatchUpCapMultiplier();
    const alphaMultiplier = getCatchUpAlphaMultiplier();
    console.log(`[Gap Metrics] medianGap=${(medianGapPct * 100).toFixed(1)}%, p90Gap=${(p90GapPct * 100).toFixed(1)}%, catchUp=${catchUpCurrentBand}, exitStreak=${catchUpExitStreak}`);

    // Sort by fameIndex (displayed on leaderboard) not trendScore - matches quick-score.ts
    scoreResults.sort((a, b) => b.score.fameIndex - a.score.fameIndex);

    // SAFEGUARD: Validate fameIndex range before writing to database
    // Real fame_index values should be in the 100k-600k range
    // Mock/corrupted data typically has values in the 5k-10k range
    if (scoreResults.length > 0) {
      const avgFameIndex = scoreResults.reduce((sum, r) => sum + (r.score.fameIndex ?? 0), 0) / scoreResults.length;
      if (avgFameIndex < 50000) {
        const errorMsg = `[Ingest] BLOCKED: Computed data has suspicious avg fameIndex (${avgFameIndex.toFixed(0)}). Real data should be > 50,000. Aborting write.`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      console.log(`[Ingest] Validated avg fameIndex: ${avgFameIndex.toFixed(0)} (above 50k threshold)`);
    }

    // Fetch primary images for all celebrities (from celebrity_images table)
    // Order by personId first, then by isPrimary (desc) and vote score (desc)
    // This ensures when we iterate, we see the "best" image for each person first
    const allImages = await db
      .select()
      .from(celebrityImages)
      .orderBy(
        celebrityImages.personId,
        desc(celebrityImages.isPrimary), 
        desc(sql`(${celebrityImages.votesUp} - ${celebrityImages.votesDown})`)
      );
    
    // Build a map of personId -> primary image URL (O(n) - one pass)
    const primaryImageMap = new Map<string, string>();
    for (const img of allImages) {
      // Only set if not already set (first image for each personId is the "best")
      if (!primaryImageMap.has(img.personId)) {
        primaryImageMap.set(img.personId, img.imageUrl);
      }
    }
    console.log(`[Ingest] Loaded ${primaryImageMap.size} primary avatar images from celebrity_images`);

    // Use transaction to ensure atomicity - if any insert fails, rollback the delete
    // This prevents data loss if the server crashes/restarts between delete and inserts
    const expectedRowCount = scoreResults.length;
    const TRENDING_PEOPLE_LOCK_ID = 12345; // Advisory lock ID for trending_people writes
    
    await db.transaction(async (tx) => {
      // Acquire advisory lock to prevent concurrent writes from other ingest jobs
      const lockResult = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${TRENDING_PEOPLE_LOCK_ID})`);
      // Handle both possible Drizzle return formats: array of rows OR object with .rows
      const rows = Array.isArray(lockResult) ? lockResult : (lockResult as any).rows ?? [];
      const lockAcquired = rows[0]?.pg_try_advisory_xact_lock;
      console.log(`[Ingest] Advisory lock result: ${JSON.stringify(rows[0])}, acquired: ${lockAcquired}`);
      if (!lockAcquired) {
        throw new Error("[Ingest] Another job is writing to trending_people. Aborting to prevent conflicts.");
      }
      console.log(`[Ingest] Acquired advisory lock for trending_people writes`);
      
      const upsertedIds: string[] = [];
      let insertedCount = 0;
      for (let i = 0; i < scoreResults.length; i++) {
        const { person, score } = scoreResults[i];
        
        const avatarUrl = primaryImageMap.get(person.id) || person.avatar;

        await tx.insert(trendingPeople).values({
          id: person.id,
          name: person.name,
          avatar: avatarUrl,
          bio: person.bio,
          rank: i + 1,
          trendScore: score.trendScore,
          fameIndex: score.fameIndex,
          change24h: score.change24h,
          change7d: score.change7d,
          category: person.category,
        }).onConflictDoUpdate({
          target: trendingPeople.id,
          set: {
            name: person.name,
            avatar: avatarUrl,
            bio: person.bio,
            rank: i + 1,
            trendScore: score.trendScore,
            fameIndex: score.fameIndex,
            change24h: score.change24h,
            change7d: score.change7d,
            category: person.category,
          },
        });
        upsertedIds.push(person.id);
        insertedCount++;
      }

      if (upsertedIds.length > 0) {
        const staleCountResult = await tx.execute(
          sql`SELECT COUNT(*) as count FROM trending_people WHERE id NOT IN (${sql.join(upsertedIds.map(id => sql`${id}`), sql`, `)})`
        );
        const staleRows = Array.isArray(staleCountResult) ? staleCountResult : (staleCountResult as any).rows ?? [];
        const staleCount = parseInt(staleRows[0]?.count || '0', 10);
        const remainingAfterDelete = upsertedIds.length;
        
        if (remainingAfterDelete < expectedRowCount) {
          throw new Error(`[Ingest] Safety abort: stale cleanup would leave ${remainingAfterDelete} rows (expected ${expectedRowCount}). Rolling back.`);
        }
        
        if (staleCount > 0) {
          await tx.delete(trendingPeople)
            .where(sql`${trendingPeople.id} NOT IN (${sql.join(upsertedIds.map(id => sql`${id}`), sql`, `)})`);
          console.log(`[Ingest] Cleaned up ${staleCount} stale rows not in current batch`);
        }
      }
      
      const countResult = await tx.execute(sql`SELECT COUNT(*) as count FROM trending_people`);
      const countRows = Array.isArray(countResult) ? countResult : (countResult as any).rows ?? [];
      const actualDbCount = parseInt(countRows[0]?.count || '0', 10);
      
      if (actualDbCount !== expectedRowCount) {
        throw new Error(`[Ingest] Row count mismatch: expected ${expectedRowCount}, DB has ${actualDbCount}. Rolling back.`);
      }
      console.log(`[Ingest] Row count validated: ${actualDbCount} rows in DB (matches expected ${expectedRowCount})`);
    });

    console.log(`[Ingest] Updated ${scoreResults.length} trending people records (transaction committed)`);

    // Calculate rank churn (entries entering/exiting top 10 and top 20)
    const newTop10 = new Set(scoreResults.slice(0, 10).map(r => r.person.id));
    const newTop20 = new Set(scoreResults.slice(0, 20).map(r => r.person.id));
    
    const enteredTop10 = Array.from(newTop10).filter(id => !oldTop10.has(id)).length;
    const exitedTop10 = Array.from(oldTop10).filter(id => !newTop10.has(id)).length;
    const enteredTop20 = Array.from(newTop20).filter(id => !oldTop20.has(id)).length;
    const exitedTop20 = Array.from(oldTop20).filter(id => !newTop20.has(id)).length;

    // Log stabilization stats summary
    if (stabilizationStats.rawChanges.length > 0) {
      stabilizationStats.avgRawChange = stabilizationStats.rawChanges.reduce((a, b) => a + b, 0) / stabilizationStats.rawChanges.length;
      console.log(`[Stabilization Stats] EMA applied: ${stabilizationStats.withPreviousScore}/${stabilizationStats.totalProcessed}, ` +
        `Rate limited (>5%): ${stabilizationStats.rateLimited}, Large changes (>10%): ${stabilizationStats.largeChanges}, ` +
        `Avg raw change: ${stabilizationStats.avgRawChange.toFixed(2)}%, Max: ${stabilizationStats.maxRawChange.toFixed(1)}%`);
    }
    
    // Log spike distribution (how many have 0/1/2/3 sources spiking)
    const spikeDist = stabilizationStats.spikeDistribution;
    console.log(`[Spike Distribution] 0 sources: ${spikeDist[0]}, 1 source: ${spikeDist[1]}, 2 sources: ${spikeDist[2]}, 3 sources: ${spikeDist[3]}`);
    
    // Log graceful degradation stats (when APIs fail)
    if (newsApiUsedFallback > 0 || searchApiUsedFallback > 0) {
      const newsBootstrapped = newsApiUsedFallback > 0 && Array.from(lastNonZeroNewsMap.keys()).length > 0 ? 
        ` (${lastNonZeroNewsMap.size} bootstrapped from history)` : '';
      const searchBootstrapped = searchApiUsedFallback > 0 && Array.from(lastNonZeroSearchMap.keys()).length > 0 ? 
        ` (${lastNonZeroSearchMap.size} bootstrapped from history)` : '';
      console.log(`[Graceful Degradation] News fallback: ${newsApiUsedFallback}/${people.length}${newsBootstrapped}, Search fallback: ${searchApiUsedFallback}/${people.length}${searchBootstrapped}`);
    }
    if (newsEmaHeldCount > 0 || searchEmaHeldCount > 0) {
      console.log(`[EMA Hold] News held: ${newsEmaHeldCount}/${people.length}, Search held: ${searchEmaHeldCount}/${people.length} (provider healthy, individual artifact suppressed)`);
    }

    // Search delta instrumentation
    if (searchDeltaValues.length > 0) {
      const nonZero = searchDeltaValues.filter(v => v !== 0);
      const absVals = searchDeltaValues.map(Math.abs);
      const avgAbs = absVals.reduce((a, b) => a + b, 0) / absVals.length;
      const maxAbs = Math.max(...absVals);
      const top5 = [...absVals].sort((a, b) => b - a).slice(0, 5).map(v => v.toFixed(4));
      const staleNote = searchDeltaStaleCount > 0 ? `, stale=${searchDeltaStaleCount} (zeroed, prev snapshot >6h)` : '';
      console.log(`[SearchDelta] avg=${avgAbs.toFixed(4)}, max=${maxAbs.toFixed(4)}, nonZero=${nonZero.length}/${searchDeltaValues.length} (${((nonZero.length / searchDeltaValues.length) * 100).toFixed(0)}%), top5=[${top5.join(', ')}]${staleNote}`);
    }
    
    // Log rank churn
    console.log(`[Rank Churn] Top 10: +${enteredTop10}/-${exitedTop10} | Top 20: +${enteredTop20}/-${exitedTop20}`);
    
    // Churn guardrail: flag possible data anomalies
    const CHURN_THRESHOLD_TOP10 = 4;
    const CHURN_THRESHOLD_TOP20 = 8;
    const top10Churn = Math.max(enteredTop10, exitedTop10);
    const top20Churn = Math.max(enteredTop20, exitedTop20);
    
    if (top10Churn > CHURN_THRESHOLD_TOP10 || top20Churn > CHURN_THRESHOLD_TOP20) {
      console.warn(`[ANOMALY ALERT] Unusual rank churn detected! Top10: ${top10Churn}, Top20: ${top20Churn}`);
      
      // Log top 5 biggest movers (by absolute rank change)
      const movers = scoreResults
        .map((r, newRank) => {
          const oldRank = oldRankMap.get(r.person.id) ?? 999;
          const rankChange = oldRank - (newRank + 1); // Positive = moved up
          return {
            name: r.person.name,
            oldRank,
            newRank: newRank + 1,
            rankChange,
            rawFameIndex: r.score.rawFameIndex,
            finalFameIndex: r.score.fameIndex,
            spikingCount: r.score.spikingSourceCount,
          };
        })
        .sort((a, b) => Math.abs(b.rankChange) - Math.abs(a.rankChange))
        .slice(0, 5);
      
      console.warn(`[ANOMALY ALERT] Top 5 movers:`);
      for (const m of movers) {
        const direction = m.rankChange > 0 ? '↑' : m.rankChange < 0 ? '↓' : '→';
        console.warn(`  ${direction} ${m.name}: #${m.oldRank} → #${m.newRank} (raw: ${m.rawFameIndex}, final: ${m.finalFameIndex}, spikes: ${m.spikingCount})`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // POST-INGEST HEALTH SUMMARY - Single consolidated log for monitoring
    // ═══════════════════════════════════════════════════════════════════════════
    const jobDuration = Date.now() - startTime;
    const hourBucket = new Date().toISOString().slice(0, 13) + ":00:00Z"; // e.g. "2026-02-04T14:00:00Z"
    const healthSummary = {
      job: "ingest",
      hour: hourBucket,
      duration: `${jobDuration}ms`,
      rows: processed,
      lock: "acquired",
      sources: {
        wiki: wikiData.size < people.length * 0.7 ? "DEGRADED" : "OK",
        news: newsApiUsedFallback > people.length * 0.3 ? "DEGRADED" : "OK",
        search: searchApiUsedFallback > people.length * 0.3 ? "DEGRADED" : "OK",
      },
      fresh: {
        wiki: wikiData.size,
        news: people.length - newsApiUsedFallback,
        search: people.length - searchApiUsedFallback,
      },
      fallbacks: {
        news: newsApiUsedFallback,
        search: searchApiUsedFallback,
        emaHeld: {
          news: newsEmaHeldCount,
          search: searchEmaHeldCount,
        },
        perPerson: {
          triggered: perPersonFallbackStats.triggered,
          succeeded: perPersonFallbackStats.succeeded,
          skippedCooldown: perPersonFallbackStats.skippedCooldown,
          skippedNotQualified: perPersonFallbackStats.skippedQualified,
          patched: perPersonFallbackStats.patchedPeople,
          topTriggered: perPersonFallbackStats.topTriggered.slice(0, 5),
        },
      },
      coverage: {
        newsPct: `${newsCoveragePctActual.toFixed(0)}%`,
        searchPct: `${searchCoveragePctActual.toFixed(0)}%`,
        newsGovernor: `${(newsGovernorFactor * 100).toFixed(0)}%`,
        searchGovernor: `${(searchGovernorFactor * 100).toFixed(0)}%`,
        newsProviderUsed: newsSource,
        newsFreshCoveragePct: `${newsCoveragePctActual.toFixed(0)}%`,
        newsLiveApiFetched: newsSource === "mediastack"
          ? (mediastackBatchStats?.fetched ?? 0)
          : (gdeltBatchStats?.liveApiFetched ?? 0),
        newsCacheReused: newsSource === "mediastack"
          ? (mediastackBatchStats?.cached ?? 0)
          : (gdeltBatchStats?.cacheReused ?? 0),
        avgGdeltSpacingMs: gdeltBatchStats?.avgSpacingMs ?? 0,
        mediastackApiCalls: mediastackBatchStats?.apiCallsMade ?? 0,
        mediastackSuccessPct: mediastackBatchStats ? `${mediastackBatchStats.successCoveragePct.toFixed(0)}%` : null,
        mediastackNonZeroPct: mediastackBatchStats ? `${mediastackBatchStats.nonZeroCoveragePct.toFixed(0)}%` : null,
        mediastackTop25NonZeroPct: mediastackBatchStats ? `${mediastackBatchStats.top25NonZeroCoveragePct.toFixed(0)}%` : null,
        mediastackCadence: mediastackCadence ? {
          isRefresh: mediastackCadence.shouldRefresh,
          lastFetchAt: mediastackCadence.lastFetchAt?.toISOString() ?? null,
          ageHours: mediastackCadence.ageMs != null ? Math.round(mediastackCadence.ageMs / (1000 * 60 * 60) * 10) / 10 : null,
        } : null,
        mediastackWidening: mediastackBatchStats?.widening ?? null,
      },
      newsQuality: {
        medianArticles: gdeltMedianArticles,
        meanArticles: Math.round(gdeltMeanArticles * 10) / 10,
        qualityLow: gdeltQualityLow,
        qualityThreshold: GDELT_QUALITY_THRESHOLD,
      },
      providerNormalization: (() => {
        const articleCounts: number[] = [];
        if (newsData) {
          newsData.forEach((entry: any) => {
            const count = entry?.articleCount24h ?? entry?.toneCount ?? entry?.searchResults ?? 0;
            articleCounts.push(count);
          });
        }
        articleCounts.sort((a, b) => a - b);
        const len = articleCounts.length;
        const p25 = len > 0 ? articleCounts[Math.floor(len * 0.25)] : 0;
        const p50 = len > 0 ? articleCounts[Math.floor(len * 0.50)] : 0;
        const p75 = len > 0 ? articleCounts[Math.floor(len * 0.75)] : 0;
        const p90 = len > 0 ? articleCounts[Math.floor(len * 0.90)] : 0;
        const max = len > 0 ? articleCounts[len - 1] : 0;
        const mean = len > 0 ? Math.round(articleCounts.reduce((a, b) => a + b, 0) / len * 10) / 10 : 0;
        const zeroCount = articleCounts.filter(c => c === 0).length;
        return {
          provider: newsSource,
          sampleSize: len,
          zeroCount,
          percentiles: { p25, p50, p75, p90, max },
          mean,
        };
      })(),
      canary: canaryReport ? {
        resolved: canaryReport.resolved,
        newsFailures: canaryReport.newsFailures,
        searchFailures: canaryReport.searchFailures,
        newsAlert: canaryReport.newsAlert,
        searchAlert: canaryReport.searchAlert,
        results: canaryReport.results.map(r => ({
          name: r.name,
          newsCount: r.newsCount,
          searchVolume: r.searchVolume,
          newsOk: r.newsOk,
          searchOk: r.searchOk,
        })),
      } : null,
      sourceHealth: {
        news: newsHealth.state,
        newsReason: newsHealth.reason,
        newsFailures: newsHealth.consecutiveFailures,
        newsStaleHours: newsHealth.lastHealthyTimestamp
          ? Math.round((Date.now() - newsHealth.lastHealthyTimestamp.getTime()) / (1000 * 60 * 60) * 10) / 10
          : null,
        search: searchHealth.state,
        wiki: wikiApiFailed ? "DEGRADED" : "HEALTHY",
        providerPref: {
          preferSerper: _newsProviderPref.preferSerper,
          consecutiveGoodGdeltRuns: _newsProviderPref.consecutiveGoodGdeltRuns,
        },
      },
      bootstrap: {
        newsHistory: lastNonZeroNewsMap.size,
        searchHistory: lastNonZeroSearchMap.size,
        newsDecay: `${(newsDecayFactor * 100).toFixed(0)}%`,
        searchDecay: `${(searchDecayFactor * 100).toFixed(0)}%`,
      },
      churn: {
        top10: `+${enteredTop10}/-${exitedTop10}`,
        top20: `+${enteredTop20}/-${exitedTop20}`,
      },
      rateLimited: stabilizationStats.rateLimited,
      rateLimitedPct: `${((stabilizationStats.rateLimited / stabilizationStats.totalProcessed) * 100).toFixed(1)}%`,
      convergence: {
        medianGapPct: `${(medianGapPct * 100).toFixed(1)}%`,
        p90GapPct: `${(p90GapPct * 100).toFixed(1)}%`,
        catchUpMode: catchUpCurrentBand,
        catchUpExitStreak: catchUpExitStreak,
        catchUpEnteredAt: catchUpEnteredAt,
      },
      capsUsed: {
        base: `${(MAX_HOURLY_CHANGE_PERCENT * capMultiplier * 100).toFixed(1)}%`,
        spike1: `${(0.12 * capMultiplier * 100).toFixed(1)}%`,
        spike2: `${(0.20 * capMultiplier * 100).toFixed(1)}%`,
        spike3: `${(0.35 * capMultiplier * 100).toFixed(1)}%`,
        multiplier: `${capMultiplier}x`,
      },
      alphaUsed: {
        base: `${(EMA_ALPHA_DEFAULT * alphaMultiplier).toFixed(3)}`,
        spike2: `${(EMA_ALPHA_2_SOURCES * alphaMultiplier).toFixed(3)}`,
        spike3: `${Math.min(EMA_ALPHA_3_SOURCES * alphaMultiplier, 0.40).toFixed(3)}`,
        multiplier: `${alphaMultiplier}x`,
      },
    };
    
    const stabilizerGaps = scoreResults.map(r => {
      const raw = r.score.rawFameIndex;
      const displayed = r.score.fameIndex;
      const gapPct = displayed > 0 ? ((raw - displayed) / displayed) * 100 : 0;
      return { name: r.person.name, raw: Math.round(raw), displayed: Math.round(displayed), gapPct };
    });

    const heldBack = stabilizerGaps.filter(g => g.gapPct > 0).sort((a, b) => b.gapPct - a.gapPct).slice(0, 5);
    const proppedUp = stabilizerGaps.filter(g => g.gapPct < 0).sort((a, b) => a.gapPct - b.gapPct).slice(0, 5);

    console.log(`[Stabilizer Gaps] Top ${heldBack.length} held back (raw > displayed):`);
    for (const g of heldBack) {
      console.log(`  ${g.name}: raw=${g.raw.toLocaleString()} displayed=${g.displayed.toLocaleString()} gap=+${g.gapPct.toFixed(1)}%`);
    }
    console.log(`[Stabilizer Gaps] Top ${proppedUp.length} propped up (raw < displayed):`);
    for (const g of proppedUp) {
      console.log(`  ${g.name}: raw=${g.raw.toLocaleString()} displayed=${g.displayed.toLocaleString()} gap=${g.gapPct.toFixed(1)}%`);
    }

    let baselineMeta: Record<string, any> = {};
    try {
      baselineMeta = await getBaselineDiagnostics(processed);
    } catch (e) {
      console.warn("[Ingest] Failed to fetch baseline diagnostics:", e);
    }
    (healthSummary as any).baselineMeta = baselineMeta;

    console.log(`[HEALTH SUMMARY] ${JSON.stringify(healthSummary)}`);

    await saveHealthState();
    await saveNewsProviderPref();

    const successDuration = Date.now() - startTime;
    sourceTimings.total = successDuration;

    _lastRunMeta = {
      runId,
      newsProviderUsed: newsSource,
      newsFreshCoveragePct: newsCoveragePctActual,
      searchFreshCoveragePct: searchCoveragePctActual,
      newsGovernorFactor,
      searchGovernorFactor,
      newsMedianArticles: gdeltMedianArticles,
      newsMeanArticles: Math.round(gdeltMeanArticles * 10) / 10,
      newsQualityLow: gdeltQualityLow,
      finishedAt: new Date(),
      mediastackSuccessPct: mediastackBatchStats?.successCoveragePct,
      mediastackNonZeroPct: mediastackBatchStats?.nonZeroCoveragePct,
      mediastackTop25NonZeroPct: mediastackBatchStats?.top25NonZeroCoveragePct,
      mediastackIsRefresh: mediastackCadence?.shouldRefresh,
      mediastackLastFetchAt: mediastackCadence?.lastFetchAt?.toISOString() ?? null,
      perPersonFallback: {
        triggered: perPersonFallbackStats.triggered,
        succeeded: perPersonFallbackStats.succeeded,
        skippedCooldown: perPersonFallbackStats.skippedCooldown,
        skippedNotQualified: perPersonFallbackStats.skippedQualified,
        patched: perPersonFallbackStats.patchedPeople,
        topTriggered: perPersonFallbackStats.topTriggered.slice(0, 5),
      },
    };
    (healthSummary as any).runId = runId;

    const runStatus = errors > 0 ? "failed" : "completed";
    await releaseIngestionLock(runId, runStatus, {
      snapshotsWritten: processed,
      peopleProcessed: processed,
      errorCount: errors,
      sourceTimings,
      sourceStatuses,
      hourBucket: hourTimestamp,
      healthSummary,
    });

    await persistSystemKey(LAST_RUN_META_KEY, _lastRunMeta);
    await persistSystemKey(HEALTH_SUMMARY_KEY, healthSummary);

  } catch (error) {
    console.error("[Ingest] Fatal error:", error);
    errors++;
    await saveHealthState();
    sourceTimings.total = Date.now() - startTime;
    await releaseIngestionLock(runId, "failed", {
      snapshotsWritten: processed,
      peopleProcessed: processed,
      errorCount: errors,
      errorSummary: String(error),
      sourceTimings,
      sourceStatuses,
      hourBucket: undefined,
    });
    const duration = Date.now() - startTime;
    return { processed, errors, duration, runId };
  }

  const duration = Date.now() - startTime;
  console.log(`[Ingest] Complete: ${processed} processed, ${errors} errors, ${duration}ms`);

  return { processed, errors, duration, runId };
}

export async function getLastIngestionTime(): Promise<Date | null> {
  const lastSnapshot = await db.query.trendSnapshots.findFirst({
    where: eq(trendSnapshots.snapshotOrigin, 'ingest'),
    orderBy: [desc(trendSnapshots.timestamp)],
  });

  return lastSnapshot?.timestamp || null;
}

export async function hydrateTrendingPeopleFromSnapshots(): Promise<boolean> {
  try {
    const countResultRaw = await db.execute(sql`SELECT COUNT(*) as count FROM trending_people`);
    const countRows = Array.isArray(countResultRaw) ? countResultRaw : (countResultRaw as any).rows ?? [];
    const currentCount = parseInt((countRows[0] as any)?.count || '0', 10);
    if (currentCount > 0) {
      console.log(`[Boot] trending_people already has ${currentCount} rows, skipping hydration`);
      return false;
    }

    const runningRuns = await db
      .select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(eq(ingestionRuns.status, "running"))
      .limit(1);

    if (runningRuns.length > 0) {
      console.log(`[Boot] Ingestion run ${runningRuns[0].id} is currently running, skipping hydration to avoid race`);
      return false;
    }

    const latestRun = await db
      .select({ id: ingestionRuns.id, startedAt: ingestionRuns.startedAt, finishedAt: ingestionRuns.finishedAt })
      .from(ingestionRuns)
      .where(and(
        eq(ingestionRuns.status, "completed"),
        eq(ingestionRuns.scoreVersion, SCORE_VERSION),
      ))
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(1);

    if (latestRun.length === 0) {
      console.log("[Boot] No completed ingestion runs found, cannot hydrate trending_people");
      return false;
    }

    const runId = latestRun[0].id;
    console.log(`[Boot] Hydrating trending_people from completed run ${runId}...`);

    const snapshotRows = await db.execute(sql`
      SELECT 
        ts.person_id,
        ts.fame_index,
        ts.trend_score,
        tp.name,
        tp.avatar,
        tp.category,
        tp.bio
      FROM trend_snapshots ts
      JOIN tracked_people tp ON tp.id = ts.person_id
      WHERE ts.run_id = ${runId}
        AND ts.score_version = ${SCORE_VERSION}
      ORDER BY ts.fame_index DESC NULLS LAST
    `);

    const rows = Array.isArray(snapshotRows) ? snapshotRows : (snapshotRows as any).rows ?? [];
    if (rows.length === 0) {
      console.log("[Boot] No snapshots found for latest run, cannot hydrate");
      return false;
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as any;
        await tx.insert(trendingPeople).values({
          id: row.person_id,
          name: row.name,
          avatar: row.avatar,
          bio: row.bio,
          rank: i + 1,
          trendScore: row.trend_score,
          fameIndex: row.fame_index,
          change24h: null,
          change7d: null,
          category: row.category,
        }).onConflictDoUpdate({
          target: trendingPeople.id,
          set: {
            name: row.name,
            avatar: row.avatar,
            bio: row.bio,
            rank: i + 1,
            trendScore: row.trend_score,
            fameIndex: row.fame_index,
            category: row.category,
          },
        });
      }
    });

    const trackedCountRaw = await db.execute(sql`SELECT COUNT(*) as count FROM tracked_people`);
    const trackedRows = Array.isArray(trackedCountRaw) ? trackedCountRaw : (trackedCountRaw as any).rows ?? [];
    const trackedCount = parseInt((trackedRows[0] as any)?.count || '0', 10);

    const coveragePct = trackedCount > 0 ? Math.round(rows.length / trackedCount * 100) : 100;

    if (coveragePct < 90) {
      console.error(`[Boot] ABORT hydration: only ${rows.length}/${trackedCount} rows available (${coveragePct}% coverage, need >=90%). Rolling back to prevent serving incomplete data.`);
      await db.delete(trendingPeople);
      return false;
    }

    if (rows.length < trackedCount) {
      console.warn(`[Boot] WARNING: Hydrated ${rows.length}/${trackedCount} rows (${coveragePct}% coverage). Some people may be missing from the leaderboard.`);
    }

    console.log(`[Boot] Successfully hydrated trending_people with ${rows.length}/${trackedCount} rows from run ${runId}`);
    return true;
  } catch (err) {
    console.error("[Boot] Failed to hydrate trending_people:", err);
    return false;
  }
}

if (process.argv[1]?.endsWith('ingest.ts')) {
  runDataIngestion().then((result) => {
    console.log('[Ingest] Final result:', result);
    process.exit(0);
  }).catch((err) => {
    console.error('[Ingest] Fatal error:', err);
    process.exit(1);
  });
}
