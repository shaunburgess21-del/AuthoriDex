import { db } from "../db";
import { trackedPeople, trendSnapshots, trendingPeople, celebrityImages, ingestionRuns, apiCache } from "@shared/schema";
import { desc, eq, sql, gte, and, inArray } from "drizzle-orm";
import { getBaselineDiagnostics } from "../utils/baseline";
import { fetchBatchWikiPageviews } from "../providers/wiki";
import { fetchBatchGdeltNews, GdeltBatchOptions, GdeltBatchStats } from "../providers/gdelt";
import { fetchSerperBatch, fetchSerperNewsBatch, getSerperRunStats, resetSerperRunStats } from "../providers/serper";
import { fetchMediastackBatch, isMediastackConfigured, MediastackBatchStats, shouldRefreshMediastack } from "../providers/mediastack";
import { fetchMultiSourceNewsBatch, type AggregatorStats } from "../providers/news-aggregator";
import { computeTrendScore } from "../scoring/trendScore";
import {
  appendToRecentSeriesMap,
  smoothLastNTicks,
  NEWS_SMOOTHING_WINDOW,
} from "../scoring/smoothing";
import { refreshSourceStats } from "../scoring/sourceStats";
import { evaluateCanaries, CanaryReport, getCanaryNames } from "../scoring/canaryMonitor";
import { checkAndEmitProviderCoverageAlerts } from "../services/ingest-provider-alert-runner";
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
  SCORE_VERSION,
  getNewsAggregationMode,
  isDiagnosticsVerbose,
  computeMomentumLevel,
  MOMENTUM_RATIO_CAP,
} from "../scoring/normalize";
import {
  fetchGoogleTrendsBatch,
  isSerpApiTrendsConfigured,
  getSerpApiTrendsRunStats,
  resetSerpApiTrendsRunStats,
  shouldFetchGoogleTrends,
  TRENDS_DELTA_METHOD,
  TRENDS_SERPAPI_WINDOW,
  type TrendsBatchResult,
} from "../providers/serpapi-trends";

const GDELT_CANDIDATE_COUNT = 25;
// Cutover for Google Trends scale changes. Snapshots persisted before this
// timestamp are filtered out of the rolling baseline so legacy values from
// previous windows don't poison the current scale. Override via env for
// replays. Bumped May 2026 when we switched from `now 7-d` (mean-of-24h) to
// `now 1-d` (mean-of-last-3h) — different normalisation peak, not comparable.
const TRENDS_DAILY_SCALE_CUTOVER = new Date(
  process.env.TRENDS_DAILY_SCALE_CUTOVER ?? "2026-05-26T20:00:00.000Z",
);

// Process-lifetime flag: once we've persisted at least one snapshot on the
// current methodology, every subsequent ingest can skip the DB rollout
// probe. Avoids a JSONB-key scan over `trend_snapshots` every cycle.
let _trendsDayOverDayRolloutComplete = false;

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
  newsProviderUsed: "mediastack" | "gdelt" | "serper_news" | "union";
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
  newsEnglishHeadlineBackfill?: {
    considered: number;
    attempted: number;
    succeeded: number;
    failed: number;
    patched: string[];
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
  skipped?: boolean;
  skippedReason?: string;
}

const HEARTBEAT_STALE_MS = 4 * 60 * 1000; // 4 minutes without heartbeat = stale
const HEARTBEAT_INTERVAL_MS = 60 * 1000; // update heartbeat every 60 seconds

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
      console.warn(`[Ingest Lock] Found stale running lock (id=${run.id}, hourBucket=${run.hourBucket?.toISOString() ?? 'unknown'}, lastHeartbeat=${lastSignOfLife.toISOString()}). Marking as failed.`);
      await db.update(ingestionRuns)
        .set({ status: "failed", finishedAt: now, errorSummary: `Stale lock auto-cleaned (no heartbeat for >${HEARTBEAT_STALE_MS / 60000}min)` })
        .where(eq(ingestionRuns.id, run.id));
    } else {
      console.warn(`[Ingest Lock] Another ingestion is currently running (id=${run.id}, hourBucket=${run.hourBucket?.toISOString() ?? 'unknown'}, started=${run.startedAt.toISOString()}, lastHeartbeat=${lastSignOfLife.toISOString()})`);
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
  status: "completed" | "failed" | "skipped" | "failed_partial",
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
  
  console.log(`[Ingest Lock] Released lock, run ${runId} => ${status} (hourBucket=${details.hourBucket?.toISOString() ?? 'unknown'})`);
}

export async function runDataIngestion(options?: { targetHour?: Date; isBackfill?: boolean }): Promise<IngestResult> {
  const isBackfill = options?.isBackfill ?? false;
  const logPrefix = isBackfill ? `[Ingest BACKFILL]` : `[Ingest]`;

  const lockResult = await acquireIngestionLock();
  
  if (!lockResult.acquired) {
    console.warn(`${logPrefix} SKIPPED: Another ingestion is running (${lockResult.existingRunId}). Cannot overlap.`);
    await db.insert(ingestionRuns)
      .values({ status: "locked_out", errorSummary: `Blocked by existing run ${lockResult.existingRunId}`, finishedAt: new Date(), scoreVersion: SCORE_VERSION });
    return { processed: 0, errors: 0, duration: 0, lockedOut: true };
  }
  
  const runId = lockResult.runId!;
  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let softTimeoutPeopleCount = 0;
  resetSerperRunStats();
  const sourceTimings: Record<string, number> = {};
  const sourceStatuses: Record<string, string> = {};
  const pendingSnapshots: any[] = [];

  if (process.env.REQUIRE_DB_GUARDRAILS === 'true') {
    const { dbGuardrailsVerified } = await import('../guardrails');
    if (!dbGuardrailsVerified) {
      console.error(`${logPrefix} ABORT: REQUIRE_DB_GUARDRAILS=true but DB constraints are missing. Refusing to write to prevent data corruption.`);
      await releaseIngestionLock(runId, "failed", { errorSummary: "DB guardrails not verified" });
      return { processed: 0, errors: 1, duration: Date.now() - startTime, runId };
    }
  }

  // Use targetHour if provided (backfill), otherwise truncate current time to the hour.
  // Truncating to the hour ensures idempotency — multiple runs within the same hour are deduplicated.
  const now = new Date();
  const hourTimestamp = options?.targetHour
    ? new Date(Date.UTC(
        options.targetHour.getUTCFullYear(),
        options.targetHour.getUTCMonth(),
        options.targetHour.getUTCDate(),
        options.targetHour.getUTCHours(),
        0, 0, 0
      ))
    : new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        0, 0, 0
      ));
  console.log(`${logPrefix} Hour timestamp: ${hourTimestamp.toISOString()}${isBackfill ? " (backfill)" : ""}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // IDEMPOTENCY GUARD: Skip if this hour bucket is already fully ingested.
  // Check BEFORE any expensive API calls to prevent retry storms.
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const [completedRunCheck] = await db.select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(and(
        eq(ingestionRuns.status, "completed"),
        eq(ingestionRuns.hourBucket, hourTimestamp),
        eq(ingestionRuns.scoreVersion, SCORE_VERSION),
      ))
      .limit(1);

    if (completedRunCheck) {
      const skipReason = `Hour ${hourTimestamp.toISOString()} already has completed run ${completedRunCheck.id} (score_version=${SCORE_VERSION})`;
      console.log(`${logPrefix} SKIP_ALREADY_INGESTED: ${skipReason}`);
      await releaseIngestionLock(runId, "skipped", {
        errorSummary: skipReason,
        hourBucket: hourTimestamp,
      });
      return { processed: 0, errors: 0, duration: Date.now() - startTime, runId, skipped: true, skippedReason: "already_ingested" };
    }

    const existingSnapshotCount = await db.execute(
      sql`SELECT COUNT(*) as count FROM trend_snapshots WHERE timestamp = ${hourTimestamp} AND snapshot_origin = 'ingest' AND score_version = ${SCORE_VERSION}`
    );
    const snapshotRows = Array.isArray(existingSnapshotCount) ? existingSnapshotCount : (existingSnapshotCount as any).rows ?? [];
    const existingCount = parseInt((snapshotRows[0] as any)?.count || '0', 10);

    const trackedCount = await db.execute(
      sql`SELECT COUNT(*) as count FROM tracked_people WHERE status = 'main_leaderboard'`,
    );
    const trackedRows = Array.isArray(trackedCount) ? trackedCount : (trackedCount as any).rows ?? [];
    const totalTracked = parseInt((trackedRows[0] as any)?.count || '0', 10);

    if (existingCount >= totalTracked && totalTracked > 0) {
      const skipReason = `Hour ${hourTimestamp.toISOString()} already has ${existingCount}/${totalTracked} snapshots (score_version=${SCORE_VERSION})`;
      console.log(`${logPrefix} SKIP_ALREADY_INGESTED: ${skipReason}`);
      await releaseIngestionLock(runId, "skipped", {
        snapshotsWritten: existingCount,
        errorSummary: skipReason,
        hourBucket: hourTimestamp,
      });
      return { processed: 0, errors: 0, duration: Date.now() - startTime, runId, skipped: true, skippedReason: "already_ingested" };
    }
  } catch (idempotencyErr) {
    console.warn(`${logPrefix} Idempotency check failed (proceeding with ingestion): ${idempotencyErr}`);
  }

  console.log(`${logPrefix} Starting data ingestion...`);

  await loadHealthFromDB();
  await loadNewsProviderPref();
  await loadLastRunMetaFromDB();

  try {
    // Only main-leaderboard celebrities belong in fame ingest / trending_people.
    // Shadow rows with status "induction" exist for Curate Profile + voting and must not be scored here.
    const people = await db
      .select()
      .from(trackedPeople)
      .where(eq(trackedPeople.status, "main_leaderboard"));
    console.log(`[Ingest] Found ${people.length} main-leaderboard tracked people`);

    let wikiStart = Date.now();
    const wikiData = await fetchBatchWikiPageviews(
      people.map(p => ({ id: p.id, wikiSlug: p.wikiSlug }))
    );
    sourceTimings.wiki = Date.now() - wikiStart;
    sourceStatuses.wiki = wikiData.size > 0 ? "OK" : "FAILED";

    // ═══════════════════════════════════════════════════════════════════════════
    // NEWS DATA FETCHING
    //
    // Two modes, gated by NEWS_AGGREGATION_MODE env:
    //
    //   "tiered" (default) — Cascading provider chain:
    //     1. Mediastack (primary, paid, every 2 hours)
    //     2. GDELT (secondary, free, fallback)
    //     3. Serper News (emergency, paid, last resort)
    //
    //   "union" — Multi-source parallel aggregation:
    //     All three providers called in parallel every tick. Articles
    //     deduplicated by canonicalised URL. finalCount preserves
    //     Mediastack's uncapped paginationTotal while picking up articles
    //     other providers catch that Mediastack missed.
    // ═══════════════════════════════════════════════════════════════════════════
    const COVERAGE_THRESHOLD = 0.70;
    const SERPER_NEWS_FALLBACK_THRESHOLD = 0.30;
    const GDELT_QUALITY_THRESHOLD = 3;
    const newsAggregationMode = getNewsAggregationMode();
    let newsSource: "mediastack" | "gdelt" | "serper_news" | "union" = "gdelt";
    let newsData = new Map<string, any>();
    let gdeltBatchStats: GdeltBatchStats | null = null;
    let mediastackBatchStats: MediastackBatchStats | null = null;
    let aggregatorStats: AggregatorStats | null = null;

    const mediastackAvailable = isMediastackConfigured();
    let mediastackCadence: { shouldRefresh: boolean; lastFetchAt: Date | null; ageMs: number | null; budgetThrottled: boolean } | null = null;

    if (newsAggregationMode === "union") {
      console.log(`[Ingest] NEWS_AGGREGATION_MODE=union — calling Mediastack + GDELT + Serper News in parallel`);
      const unionStart = Date.now();
      try {
        const leaderboardRanks = await db.select({ name: trendingPeople.name, rank: trendingPeople.rank }).from(trendingPeople);
        const rankMap = new Map(leaderboardRanks.map(r => [r.name, r.rank ?? 9999]));
        const peopleSortedByRank = [...people].sort((a, b) => (rankMap.get(a.name) ?? 9999) - (rankMap.get(b.name) ?? 9999));
        const top25Ids = new Set(peopleSortedByRank.slice(0, 25).map(p => p.id));
        const canaryNames = new Set(getCanaryNames());
        const canaryIds = new Set(people.filter(p => canaryNames.has(p.name)).map(p => p.id));
        const widenCandidateIds = new Set([...Array.from(top25Ids), ...Array.from(canaryIds)]);
        const gdeltCandidates = await computeNewsCandidates(people, wikiData);
        const newsHealth = getCurrentHealthSnapshot().news;
        const gdeltIsDegraded = newsHealth.state === "DEGRADED" || newsHealth.state === "OUTAGE" || newsHealth.state === "RECOVERY";

        const aggResult = await fetchMultiSourceNewsBatch(
          people.map(p => ({
            id: p.id,
            name: p.name,
            newsQueryWidened: p.newsQueryWidened,
            searchQueryOverride: p.searchQueryOverride,
          })),
          {
            gdeltCandidates,
            mediastackWidenCandidateIds: widenCandidateIds,
            gdeltIsDegraded,
            gdeltTimeBudgetMs: 120000,
            peopleSortedByRank: peopleSortedByRank.map(p => ({
              id: p.id,
              name: p.name,
              newsQueryWidened: p.newsQueryWidened,
              searchQueryOverride: p.searchQueryOverride,
            })),
          },
        );

        newsData = aggResult.data as Map<string, any>;
        newsSource = "union";
        mediastackBatchStats = aggResult.mediastackBatchStats;
        gdeltBatchStats = aggResult.gdeltBatchStats;
        mediastackCadence = aggResult.mediastackCadence;
        aggregatorStats = aggResult.stats;

        const ps = aggResult.stats.providers;
        // THROTTLED: budget hard-stop forced cache-only mode and the cache had
        // no fresh entries. Distinct from DEGRADED — this is a self-imposed
        // throttle (budget protection), not an upstream failure.
        sourceStatuses.mediastack = ps.mediastack.budgetThrottled && ps.mediastack.peopleWithData === 0
          ? "THROTTLED"
          : ps.mediastack.succeeded
            ? (ps.mediastack.peopleWithData > 0 ? "OK" : "DEGRADED")
            : (ps.mediastack.attempted ? "FAILED" : "SKIPPED");
        sourceStatuses.gdelt = ps.gdelt.succeeded
          ? (ps.gdelt.peopleWithData > 0 ? "OK" : "DEGRADED")
          : "FAILED";
        sourceStatuses.serper = ps.serper.succeeded
          ? (ps.serper.peopleWithData > 0 ? "OK" : "DEGRADED")
          : "FAILED";

        sourceTimings.mediastack = ps.mediastack.elapsedMs;
        sourceTimings.gdelt = ps.gdelt.elapsedMs;
        sourceTimings.serper = ps.serper.elapsedMs;
      } catch (err) {
        console.error(`[Ingest] Union aggregator failed, aborting news fetch:`, err);
        sourceStatuses.mediastack = "FAILED";
        sourceStatuses.gdelt = "FAILED";
        newsData = new Map();
      }
      console.log(`[Ingest] Union aggregation complete in ${((Date.now() - unionStart) / 1000).toFixed(1)}s — ${newsData.size}/${people.length} people with data`);

      // Baseline drift logging — for each person where union materially beats
      // the legacy tiered count, log it so we can calibrate DEFAULT_SOURCE_STATS
      // after 24h of observation before deciding to retune.
      if (aggregatorStats) {
        const DRIFT_MULTIPLIER_THRESHOLD = 3;
        const DRIFT_ABSOLUTE_THRESHOLD = 5;
        const drifts: Array<{ name: string; legacy: number; final: number; ratio: number }> = [];
        for (const person of people) {
          const entry = newsData.get(person.id);
          if (!entry || entry.source !== "union") continue;
          const legacy = entry.legacyTieredCount ?? 0;
          const final = entry.articleCount24h ?? 0;
          if (final < DRIFT_ABSOLUTE_THRESHOLD) continue;
          const ratio = legacy > 0 ? final / legacy : (final > 0 ? Infinity : 0);
          if (ratio >= DRIFT_MULTIPLIER_THRESHOLD) {
            drifts.push({ name: person.name, legacy, final, ratio });
          }
        }
        drifts.sort((a, b) => b.final - a.final);
        if (drifts.length > 0) {
          const top = drifts.slice(0, 10).map(d =>
            `${d.name}: legacy=${d.legacy} → final=${d.final} (${d.ratio === Infinity ? "∞" : d.ratio.toFixed(1) + "x"})`
          ).join("; ");
          console.log(`[News Aggregator] Baseline drift (${drifts.length} people with >=${DRIFT_MULTIPLIER_THRESHOLD}x gain): ${top}`);
        } else {
          console.log(`[News Aggregator] Baseline drift: 0 people crossed >=${DRIFT_MULTIPLIER_THRESHOLD}x threshold — union counts align with legacy tiered counts`);
        }
      }
    }

    // ── TIER 1: Mediastack (primary) — TIERED MODE ONLY ──────────────────────
    if (newsAggregationMode !== "union" && mediastackAvailable) {
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

    // ── ENGLISH HEADLINES BACKFILL (display-only) ────────────────────────────
    // Mediastack falls back to a no-language query when its English (languages=en)
    // query returns 0 articles. That returns non-English titles we don't want to
    // show in the UI. The Mediastack provider now leaves topHeadlines empty in
    // that case and sets languageRelaxed=true. Here we backfill English headlines
    // via Serper News for the top-N affected people, for display only — counts
    // and provider attribution stay as Mediastack's.
    const englishHeadlineBackfillStats = {
      considered: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      patched: [] as string[],
    };
    if (newsSource === "mediastack" && newsData.size > 0) {
      const ENGLISH_BACKFILL_MAX = 15;
      const relaxedCandidates: Array<{ id: string; name: string; rank: number }> = [];

      const rankRows = await db
        .select({ id: trendingPeople.id, rank: trendingPeople.rank })
        .from(trendingPeople);
      const backfillRankMap = new Map(rankRows.map(r => [r.id, r.rank ?? 9999]));

      for (const [pid, entry] of Array.from(newsData.entries())) {
        const typed = entry as any;
        const isRelaxed = typed?.languageRelaxed === true;
        const headlinesEmpty = !Array.isArray(typed?.topHeadlines) || typed.topHeadlines.length === 0;
        const hasCount = (typed?.articleCount24h ?? 0) > 0;
        if (!isRelaxed || !headlinesEmpty || !hasCount) continue;

        const person = people.find(p => p.id === pid);
        if (!person) continue;
        relaxedCandidates.push({
          id: person.id,
          name: person.name,
          rank: backfillRankMap.get(person.id) ?? 9999,
        });
      }

      englishHeadlineBackfillStats.considered = relaxedCandidates.length;

      if (relaxedCandidates.length > 0) {
        relaxedCandidates.sort((a, b) => a.rank - b.rank);
        const selected = relaxedCandidates.slice(0, ENGLISH_BACKFILL_MAX);
        englishHeadlineBackfillStats.attempted = selected.length;

        console.log(`[English Headlines Backfill] ${relaxedCandidates.length} languageRelaxed people with empty headlines — calling Serper for top ${selected.length}`);

        try {
          const serperHeadlines = await fetchSerperNewsBatch(
            selected.map(c => ({ id: c.id, name: c.name })),
            5,
            300,
          );

          for (const c of selected) {
            const serperResult = serperHeadlines.get(c.id);
            const headlines = serperResult?.topHeadlines ?? [];
            if (headlines.length > 0) {
              const entry = newsData.get(c.id) as any;
              if (entry) {
                entry.topHeadlines = headlines.slice(0, 3);
                englishHeadlineBackfillStats.succeeded++;
                englishHeadlineBackfillStats.patched.push(c.name);
              }
            } else {
              englishHeadlineBackfillStats.failed++;
            }
          }

          console.log(`[English Headlines Backfill] Complete: ${englishHeadlineBackfillStats.succeeded}/${selected.length} patched (${englishHeadlineBackfillStats.failed} had no English headlines)`);
        } catch (err) {
          console.error(`[English Headlines Backfill] Serper batch failed:`, err);
        }
      }
    }

    // ── TIER 2: GDELT (secondary) — TIERED MODE ONLY ─────────────────────────
    if (newsAggregationMode !== "union" && newsSource !== "mediastack") {
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
    let serperData: Map<string, any> = new Map();
    try {
      serperData = await fetchSerperBatch(
        people.map(p => ({ id: p.id, name: p.name, searchQueryOverride: p.searchQueryOverride })),
        2,
        300
      );
    } catch (serperErr) {
      console.error(`[Ingest] Serper batch failed, continuing without search data:`, serperErr);
    }
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
      diagnostics: trendSnapshots.diagnostics,
    }    ).from(trendSnapshots).where(
      and(
        gte(trendSnapshots.timestamp, time7dAgo),
        eq(trendSnapshots.snapshotOrigin, 'ingest')
      )
    );

    historicalSnapshots.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
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
      prevNewsHeadlines: string[];
      prevNewsProvider: string | null;
      prevTopStories: Array<{ title: string; link: string }>;
    }>();
    const lastNonZeroNewsMap = new Map<string, { newsCount: number; newsDelta: number; timestamp: Date }>();
    const lastNonZeroSearchMap = new Map<string, { searchVolume: number; searchDelta: number; timestamp: Date }>();
    // Personal trailing-24h high-water-mark for news and search. Anchors the
    // asymmetric 24h linear decay floor that smooths out the news/search
    // sawtooth caused by provider cache cycling, transient outages, and stale-
    // cache fallbacks. Spikes propagate immediately (raw value wins when above
    // the floor); drops are bounded by linear decay from the most recent high.
    // Wikipedia is intentionally NOT covered — its single-day cadence is
    // inherently smooth, so a floor would just delay legitimate downturns.
    const personalNewsHigh24hMap = new Map<string, { value: number; timestamp: Date }>();
    const personalSearchHigh24hMap = new Map<string, { value: number; timestamp: Date }>();
    const snapshot24hMap = new Map<string, { trendScore: number; fameIndex: number | null; timestamp?: Date; basisHours?: number }>();
    // 7d baseline: matches the 24h logic — picks the snapshot closest to exactly
    // 7 days ago within a +/-18h tolerance window. Previously this just kept the
    // first snapshot seen in the 7d window, which made change7d nondeterministic
    // (depended on DB row order) and systematically biased toward the older end.
    const snapshot7dMap = new Map<string, { trendScore: number; fameIndex: number | null; timestamp?: Date; basisHours?: number }>();
    // Newest snapshot per person that still has Google Trends diagnostics
    // (hourly ticks between 12h SerpApi fetches omit trends unless we carry forward).
    // Last N hourly news_count / news7d values for 3-tick smoothing into
    // computeTrendScore (May 2026 — native-markets calibration).
    const recentNewsCountSeriesMap = new Map<string, number[]>();
    const recentNews7dSeriesMap = new Map<string, number[]>();

    const latestTrendsDiagMap = new Map<string, {
      trendsInterest: number;
      trendsAvg7d: number;
      trendsMomentumRatio: number;
      trendsMomentumLevel: string;
      trendsUsedFallbackName: boolean;
      trendsFetchedAt: string;
      trendsDeltaMethod: string;
      trendsWindow: string;
    }>();

    for (const snap of historicalSnapshots) {
      const snapTime = new Date(snap.timestamp).getTime();
      const diff24h = Math.abs(snapTime - time24hAgo.getTime());
      const diff7d = Math.abs(snapTime - time7dAgo.getTime());
      const diag = snap.diagnostics as Record<string, any> | null;
      const rawDiag = diag?.raw as Record<string, unknown> | undefined;
      if (snap.newsCount != null && Number.isFinite(snap.newsCount)) {
        appendToRecentSeriesMap(recentNewsCountSeriesMap, snap.personId, snap.newsCount);
      }
      const histNews7d = rawDiag?.news7d;
      if (typeof histNews7d === "number" && Number.isFinite(histNews7d) && histNews7d > 0) {
        appendToRecentSeriesMap(recentNews7dSeriesMap, snap.personId, histNews7d);
      }

      // Track most recent snapshot per person (for EMA smoothing continuity + fallback data)
      const existingRecent = mostRecentMap.get(snap.personId);
      if (!existingRecent || new Date(snap.timestamp) > existingRecent.timestamp) {
        const ev = diag?.evidence ?? {};
        mostRecentMap.set(snap.personId, { 
          trendScore: snap.trendScore, 
          fameIndex: snap.fameIndex,
          timestamp: new Date(snap.timestamp),
          newsCount: snap.newsCount,
          searchVolume: snap.searchVolume,
          newsDelta: snap.newsDelta,
          searchDelta: snap.searchDelta,
          prevNewsHeadlines: Array.isArray(ev.newsHeadlines) ? ev.newsHeadlines : [],
          prevNewsProvider: ev.newsProvider ?? null,
          prevTopStories: Array.isArray(ev.topStories) ? ev.topStories : [],
        });
      }

      const raw = diag?.raw;
      const carriedInterest = raw?.trendsInterest;
      const carriedMethod = raw?.trendsDeltaMethod;
      if (
        carriedMethod === TRENDS_DELTA_METHOD
        && carriedInterest != null
        && carriedInterest !== "null"
        && Number(carriedInterest) > 0
      ) {
        const snapAt = new Date(snap.timestamp);
        const existingTrends = latestTrendsDiagMap.get(snap.personId);
        if (!existingTrends || snapAt.getTime() > new Date(existingTrends.trendsFetchedAt).getTime()) {
          latestTrendsDiagMap.set(snap.personId, {
            trendsInterest: Number(carriedInterest),
            trendsAvg7d: Number(raw?.trendsAvg7d ?? 0),
            trendsMomentumRatio: Number(raw?.trendsMomentumRatio ?? 0),
            trendsMomentumLevel: String(raw?.trendsMomentumLevel ?? "none"),
            trendsUsedFallbackName: !!raw?.trendsUsedFallbackName,
            trendsFetchedAt:
              typeof raw?.trendsFetchedAt === "string" && raw.trendsFetchedAt
                ? raw.trendsFetchedAt
                : snapAt.toISOString(),
            trendsDeltaMethod: TRENDS_DELTA_METHOD,
            trendsWindow: String(raw?.trendsWindow ?? TRENDS_SERPAPI_WINDOW),
          });
        }
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

      // Personal trailing-24h high-water-mark for the asymmetric decay-floor.
      // Only consider snapshots within the last 24h so the floor decays out of
      // the window naturally; ties prefer the most recent timestamp so the
      // decay clock starts from the latest occurrence of that high.
      const snapAgeMs = now.getTime() - snapTime;
      if (snapAgeMs <= 24 * 60 * 60 * 1000) {
        const newsValue = snap.newsCount ?? 0;
        if (newsValue > 0) {
          const existing = personalNewsHigh24hMap.get(snap.personId);
          if (!existing || newsValue > existing.value ||
              (newsValue === existing.value && new Date(snap.timestamp) > existing.timestamp)) {
            personalNewsHigh24hMap.set(snap.personId, {
              value: newsValue,
              timestamp: new Date(snap.timestamp),
            });
          }
        }
        const searchValue = snap.searchVolume ?? 0;
        if (searchValue > 0) {
          const existing = personalSearchHigh24hMap.get(snap.personId);
          if (!existing || searchValue > existing.value ||
              (searchValue === existing.value && new Date(snap.timestamp) > existing.timestamp)) {
            personalSearchHigh24hMap.set(snap.personId, {
              value: searchValue,
              timestamp: new Date(snap.timestamp),
            });
          }
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
      
      // Keep closest snapshot to 7d ago (within +/-18h window to survive gaps).
      // Mirrors the 24h logic above: pick the snapshot whose timestamp is closest
      // to time7dAgo, not the first one seen.
      if (diff7d < 18 * 60 * 60 * 1000) {
        const existing = snapshot7dMap.get(snap.personId);
        const existingDiff = existing?.timestamp
          ? Math.abs(existing.timestamp.getTime() - time7dAgo.getTime())
          : Number.POSITIVE_INFINITY;
        if (!existing || diff7d < existingDiff) {
          const snapAgeHours7d = (now.getTime() - snapTime) / (1000 * 60 * 60);
          snapshot7dMap.set(snap.personId, {
            trendScore: snap.trendScore,
            fameIndex: snap.fameIndex,
            timestamp: new Date(snap.timestamp),
            basisHours: Math.round(snapAgeHours7d * 10) / 10,
          });
        }
      }
    }
    
    const newsBaselineMap = new Map<string, number>();
    const searchBaselineMap = new Map<string, number>();
    // Count of non-zero observations per person, used to decide whether the
    // personal median has enough history to be trusted as a spike baseline
    // (vs. falling back to the population p50 for brand-new celebs).
    const newsBaselineCountMap = new Map<string, number>();
    const searchBaselineCountMap = new Map<string, number>();
    // ── News-momentum 7-day average (Apr 2026 — PR4) ─────────────────────
    // Replaces the unreliable provider `news.averageDaily7d` value as the
    // denominator for the news-momentum velocity slot. The provider value
    // is structurally broken in two ways:
    //   • Mediastack (primary for top-tier people) hardcodes 0 — never
    //     supplies 7d totals. Affected ~70% of leaderboard, including
    //     Trump/Modi/Rihanna, who all surfaced as "establishing baseline"
    //     in the UI even with months of tracked history.
    //   • Serper News and GDELT both cap their 7d query at 100/250 raw
    //     results respectively, yielding exactly `~35.71 articles/day`
    //     for any person with enough coverage to hit the cap. This is
    //     why John Ternus, Eion Musk, Javier Milei, and JD Vance all
    //     showed identical "7-day avg: 35.7 articles/day" pre-PR4.
    // Solution: average the persisted `news_count` field across the last
    // 7 days of ingest snapshots — same data the audit script and
    // dry-run already use, so all reading surfaces are now consistent.
    const news7dHistoryAvgMap = new Map<string, number>();
    const news7dHistorySamplesMap = new Map<string, number>();
    {
      const newsValues = new Map<string, number[]>();
      const searchValues = new Map<string, number[]>();
      // Separate "all news_count values incl. zeros" map for the 7d
      // average: zeros are real signal here (a quiet day for someone
      // means their typical week is quieter), unlike the spike-detection
      // baseline below which excludes zeros so single-tick API misses
      // don't drag the personal-p50 to zero.
      const newsAllValues = new Map<string, number[]>();
      for (const snap of historicalSnapshots) {
        if (snap.newsCount !== null && snap.newsCount !== undefined) {
          const all = newsAllValues.get(snap.personId) ?? [];
          all.push(snap.newsCount);
          newsAllValues.set(snap.personId, all);
        }
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
        newsBaselineCountMap.set(pid, vals.length);
      });
      searchValues.forEach((vals, pid) => {
        vals.sort((a: number, b: number) => a - b);
        searchBaselineMap.set(pid, vals[Math.floor(vals.length / 2)]);
        searchBaselineCountMap.set(pid, vals.length);
      });
      newsAllValues.forEach((vals, pid) => {
        const sum = vals.reduce((a, b) => a + b, 0);
        news7dHistoryAvgMap.set(pid, vals.length > 0 ? sum / vals.length : 0);
        news7dHistorySamplesMap.set(pid, vals.length);
      });
    }

    // Minimum non-zero historical observations required before we trust the
    // personal p50 as a spike baseline. ~14 gives us ~2 weeks of daily data
    // at hourly cadence with some gap tolerance.
    const PERSONAL_BASELINE_MIN_OBSERVATIONS = 14;

    console.log(`[Ingest] Bootstrap maps: ${lastNonZeroNewsMap.size} people with non-zero news history, ${lastNonZeroSearchMap.size} with non-zero search history`);

    // PR4 telemetry — how many people are using history-sourced vs
    // provider-sourced news7d. Monitor for: a sudden drop in the history
    // count would indicate a snapshot retention issue; a sudden spike in
    // provider reliance after deploy would indicate the threshold isn't
    // letting enough people through.
    const news7dHistoryEligible = Array.from(news7dHistorySamplesMap.values()).filter(
      (n) => n >= PERSONAL_BASELINE_MIN_OBSERVATIONS,
    ).length;
    console.log(
      `[Ingest] news7d source: ${news7dHistoryEligible}/${news7dHistorySamplesMap.size} people qualify ` +
      `for history-sourced 7d avg (≥${PERSONAL_BASELINE_MIN_OBSERVATIONS} samples); ` +
      `remainder fall back to provider value`,
    );
    console.log(`[Ingest] 24h decay-floor anchors: ${personalNewsHigh24hMap.size} news highs, ${personalSearchHigh24hMap.size} search highs (within 24h window)`);

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

    // In union mode the aggregator already calls Serper News in parallel for
    // every person, so a targeted per-person Serper re-call here would just hit
    // the same (fresh) result — we skip the whole block. The 90-minute cooldown
    // rows (system:pp_fallback_cd:serper_news:*) will simply not tick while in
    // union mode; if you flip back to tiered, the streak starts fresh which is
    // exactly what we want (old cooldowns shouldn't carry a regime switch).
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
      ).orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id));

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

    // Minimal counters retained for the post-ingest health summary.
    // Stabilization/rate-limit/EMA tracking was removed along with the
    // underlying mechanisms — the scorer is now a single raw-math path.
    let totalProcessed = 0;

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
    // Soft-smoothing counter for moderate news drops (Apr 2026 trend-engine
    // tuning). Counts how often the asymmetric EMA inside the Mediastack
    // refresh window kicks in to dampen 40–85% drops that the hard-hold
    // thresholds (`baselineHold`, `floorHold`) don't catch. Used to size
    // post-deployment monitoring of the ~150K Fame Index oscillation.
    let newsSoftHeldCount = 0;
    // Asymmetric 24h decay-floor counters (news / search). Track how often the
    // floor anchors a value above the raw fetch — high counts here indicate
    // upstream provider instability that the floor is actively masking.
    let newsFloorAppliedCount = 0;
    let searchFloorAppliedCount = 0;
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
    const fallbackOverridesOutage = (newsSource === "serper_news" && !gdeltQualityLow) || newsSource === "mediastack" || newsSource === "union";

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

    // ══════════════════════════════════════════════════════════════════════════
    // GOOGLE TRENDS — 12h cadence gate + per-person fetch (May 2026)
    // ══════════════════════════════════════════════════════════════════════════
    // Gate on last *SerpApi* fetch (`raw.trendsFetchedAt`), not snapshot
    // `timestamp`. Carry-forward hourly ticks persist `trendsInterest` but must
    // not reset the 12h clock — see `shouldFetchGoogleTrends`.
    //
    // Per-person (un-batched) fetch — see `serpapi-trends.ts` header for why.
    // Budget math at ~160 people: 160 calls × 2 cycles/day × 30 days ≈ 9.6k
    // calls/month, well within the 15k SerpApi budget and leaves headroom for
    // autocomplete lookups and roster growth.
    const trendsDataMap = new Map<string, TrendsBatchResult>();

    if (isSerpApiTrendsConfigured() && !isBackfill) {
      let shouldFetchTrends = true;
      let lastSerpApiFetchAt: Date | null = null;
      try {
        const lastTrendsRow = await db.execute(
          sql`SELECT GREATEST(
                COALESCE(
                  MAX((diagnostics::jsonb->'raw'->>'trendsFetchedAt')::timestamptz)
                    FILTER (
                      WHERE diagnostics::jsonb->'raw'->>'trendsFetchedAt' IS NOT NULL
                        AND diagnostics::jsonb->'raw'->>'trendsFetchedAt' <> ''
                    ),
                  '-infinity'::timestamptz
                ),
                COALESCE(
                  MAX(timestamp) FILTER (
                    WHERE diagnostics::jsonb->'fresh'->>'trends' = 'true'
                  ),
                  '-infinity'::timestamptz
                )
              ) AS last_fetch_ts
              FROM trend_snapshots
              WHERE snapshot_origin = 'ingest'`,
        );
        const lastFetchRaw = (lastTrendsRow.rows[0] as { last_fetch_ts?: string | Date })?.last_fetch_ts;
        if (lastFetchRaw) {
          const parsed = new Date(lastFetchRaw);
          if (Number.isFinite(parsed.getTime()) && parsed.getTime() > 0) {
            lastSerpApiFetchAt = parsed;
          }
        }
        shouldFetchTrends = shouldFetchGoogleTrends(lastSerpApiFetchAt);
        let forceTrendsDayOverDayRollout = false;
        if (!_trendsDayOverDayRolloutComplete) {
          try {
            const rolloutRow = await db.execute(
              sql`SELECT EXISTS (
                    SELECT 1 FROM trend_snapshots
                    WHERE snapshot_origin = 'ingest'
                      AND diagnostics::jsonb->'raw'->>'trendsDeltaMethod' = ${TRENDS_DELTA_METHOD}
                  ) AS has_new_method`,
            );
            const hasNewMethod = !!(rolloutRow.rows[0] as { has_new_method?: boolean })?.has_new_method;
            if (hasNewMethod) {
              _trendsDayOverDayRolloutComplete = true;
            } else {
              forceTrendsDayOverDayRollout = true;
            }
          } catch (e) {
            console.warn("[Ingest] Google Trends rollout check failed, will fetch:", (e as Error).message);
            forceTrendsDayOverDayRollout = true;
          }
        }
        if (forceTrendsDayOverDayRollout) {
          shouldFetchTrends = true;
          console.log("[Ingest] Google Trends: forcing fetch for day-over-day rollout");
        } else if (!shouldFetchTrends && lastSerpApiFetchAt) {
          const elapsedMin = Math.round((Date.now() - lastSerpApiFetchAt.getTime()) / 60000);
          console.log(
            `[Ingest] Google Trends: skipping — last SerpApi fetch ${elapsedMin}min ago (gate: 12h)`,
          );
        }
      } catch (e) {
        console.warn("[Ingest] Google Trends gate check failed, will fetch:", (e as Error).message);
      }

      if (shouldFetchTrends) {
        resetSerpApiTrendsRunStats();
        const trendsStart = Date.now();
        let trendsFetchOk = false;
        try {
          const batchInput = people.map(p => ({
            personId: p.id,
            name: p.name,
            googleTrendsTopicId: p.googleTrendsTopicId,
          }));
          const results = await fetchGoogleTrendsBatch(batchInput);
          for (const r of results) trendsDataMap.set(r.personId, r);
          const trendsStats = getSerpApiTrendsRunStats();
          console.log(`[Ingest] Google Trends: ${results.length}/${people.length} people, ${trendsStats.callsAttempted} API calls, ${trendsStats.finalFailures} failures, ${Date.now() - trendsStart}ms`);
          trendsFetchOk = true;
          // Coverage-based status (mirrors news/serper). "OK" when most of the
          // roster came back with usable data, "DEGRADED" when partial,
          // "FAILED" when nothing useful returned.
          const coveredCount = results.filter(r => r.timeseries.length > 0).length;
          const coverage = people.length > 0 ? coveredCount / people.length : 0;
          if (coveredCount === 0) sourceStatuses.trends = "FAILED";
          else if (coverage >= 0.7) sourceStatuses.trends = "OK";
          else sourceStatuses.trends = "DEGRADED";
          if (coveredCount > 0) _trendsDayOverDayRolloutComplete = true;
        } catch (e) {
          console.error("[Ingest] Google Trends batch fetch failed:", (e as Error).message);
          if (!trendsFetchOk) sourceStatuses.trends = "FAILED";
        }
        sourceTimings.trends = Date.now() - trendsStart;
      } else {
        // Gate is closed — fetch is intentionally skipped this cycle (12h
        // cadence). Surface as SKIPPED so the System Tools panel renders
        // it as a neutral grey pill rather than disappearing entirely.
        sourceStatuses.trends = "SKIPPED";
      }
    } else if (!isSerpApiTrendsConfigured()) {
      console.log("[Ingest] Google Trends: SERPAPI_API_KEY not set — skipping");
      sourceStatuses.trends = "SKIPPED";
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GOOGLE TRENDS HISTORY — fallback denominator when SerpApi fetch is skipped
    // ══════════════════════════════════════════════════════════════════════════
    // Fresh fetches supply the intra-day baseline directly from the returned
    // `now 1-d` series (`avgWindowInterest` → persisted as trendsAvg7d). On
    // skip cycles between 12h SerpApi gates we don't have that series, so we
    // fall back to a rolling mean of recent persisted `trendsInterest` values
    // for the dormant momentum ratio denominator.
    //
    // Filtered to `timestamp >= TRENDS_DAILY_SCALE_CUTOVER` so legacy values
    // from previous Google Trends windows don't poison the rolling mean.
    // Day 0 will be empty; the system self-heals over ~7 days at the 12h
    // fetch cadence.
    const trendsHistoryMap = new Map<string, { sum: number; n: number }>();
    try {
      const trendsHistoryWindowStart = new Date(
        Math.max(now.getTime() - 7 * 24 * 60 * 60 * 1000, TRENDS_DAILY_SCALE_CUTOVER.getTime()),
      );
      const trendsHistoryRows = await db.execute(
        sql`SELECT person_id,
                   (diagnostics::jsonb->'raw'->>'trendsInterest')::numeric AS interest
            FROM trend_snapshots
            WHERE snapshot_origin = 'ingest'
              AND timestamp >= ${trendsHistoryWindowStart}
              AND diagnostics::jsonb->'raw'->'trendsInterest' IS NOT NULL
              AND diagnostics::jsonb->'raw'->>'trendsInterest' != 'null'
            ORDER BY person_id, timestamp DESC`,
      );
      const accum = new Map<string, { sum: number; n: number }>();
      for (const row of trendsHistoryRows.rows as Array<{ person_id: string; interest: string | number }>) {
        const personId = row.person_id;
        const interest = Number(row.interest);
        if (!Number.isFinite(interest)) continue;
        const cur = accum.get(personId) ?? { sum: 0, n: 0 };
        cur.sum += interest;
        cur.n += 1;
        accum.set(personId, cur);
      }
      for (const [personId, v] of accum) {
        if (v.n > 0) trendsHistoryMap.set(personId, { sum: v.sum, n: v.n });
      }
      console.log(
        `[Ingest] Google Trends history: ${trendsHistoryMap.size} people with post-cutover history (cutover ${TRENDS_DAILY_SCALE_CUTOVER.toISOString()})`,
      );
    } catch (e) {
      console.warn("[Ingest] Google Trends history load failed:", (e as Error).message);
    }

    /**
     * Rolling mean of recent persisted `trendsInterest` values for a person.
     * Used as a fallback denominator for the dormant intra-day momentum ratio
     * on skip cycles when we don't have a fresh `now 1-d` series. Augments
     * stored history with the current cycle's `latest` reading so the average
     * always reflects "this point + recent points". Returns `latest` (or 0 if
     * not yet available) when history is empty.
     */
    const computeTrendsAvg7d = (personId: string, latest: number | null | undefined): number => {
      const h = trendsHistoryMap.get(personId);
      const safeLatest = typeof latest === "number" && Number.isFinite(latest) ? latest : 0;
      if (!h) return safeLatest;
      return (h.sum + safeLatest) / (h.n + 1);
    };

    for (const person of people) {
      try {
        const PER_PERSON_TIMEOUT_MS = 30_000;
        await Promise.race([
          (async () => {

        const wiki = wikiData.get(person.id);
        const news = newsData.get(person.id);
        const serper = serperData.get(person.id);
        const trends = trendsDataMap.get(person.id);
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
        const newsHasGoodFallbackData = (newsSource === "serper_news" || newsSource === "union" || hasPerPersonFallback) && news && newsCount >= 3;
        
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
        // Union mode shares Mediastack's cache-only / refresh cadence because
        // Mediastack is still the uncapped signal; when it's cache-only we
        // want the same sticky-zero protection as in Mediastack-primary mode.
        const isMediastackRefreshTick = (newsSource === "mediastack" || newsSource === "union")
          ? (mediastackCadence?.shouldRefresh ?? true)
          : true;
        const stickyZeroGuard = !isMediastackRefreshTick && newsCount === 0 && (newsBaselineMap.get(person.id) ?? 0) >= 8;
        if (!newsUsedFallback && !newsNeedsOutageFallback && !hasPerPersonFallback && news && (isMediastackRefreshTick || stickyZeroGuard)) {
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
                stickyZeroGuard,
              };
            } else {
              // ── DETERMINISTIC MODERATE-DROP SMOOTHING (Apr 2026) ─────────
              // Phase 2 trend-engine tuning. The hard-hold rules above only
              // catch catastrophic single-tick drops (≤10% of baseline, or
              // <15% of prev). Phase 1 audit showed ~80% of the leaderboard
              // oscillating ±150K Fame Index daily, driven by *moderate*
              // 40–85% news-count drops inside the 3h Mediastack refresh
              // window — query-shape variance, dedup drift in union mode,
              // GDELT/Serper recent-window flicker, etc.
              //
              // Apply an asymmetric EMA: smoothed = 0.7·prev + 0.3·raw.
              // Step-downs are bounded to ~30% per refresh tick so a real
              // news-cycle decline still propagates within ~5 ticks (~15h),
              // but single-tick artifacts are absorbed. Spikes (raw ≥ prev)
              // pass through unchanged because this branch only triggers
              // when raw < prev * 0.6.
              const moderateDropFromBaseline = hasBaseline &&
                rawNewsCount < bp50! * 0.4 &&
                prevNewsCount >= bp50! * 0.6 &&
                rawNewsCount > 0;
              const moderateDropFromPrev = !hasBaseline &&
                prevNewsCount >= 12 &&
                rawNewsCount < prevNewsCount * 0.6 &&
                rawNewsCount > 0;

              if (moderateDropFromBaseline || moderateDropFromPrev) {
                const smoothed = Math.max(
                  rawNewsCount,
                  Math.round(prevNewsCount * 0.7 + rawNewsCount * 0.3),
                );
                const prevDelta = mostRecent?.newsDelta ?? 0;
                const rawDelta = newsDelta;
                newsCount = smoothed;
                newsDelta = +(prevDelta * 0.7 + rawDelta * 0.3).toFixed(4);
                newsSoftHeldCount++;
                newsHoldDiag = {
                  reason: moderateDropFromBaseline
                    ? "moderate_baseline_drop_smoothed"
                    : "moderate_prev_drop_smoothed",
                  prevCount: prevNewsCount,
                  currentCount: rawNewsCount,
                  smoothedCount: smoothed,
                  baselineP50: bp50 ?? null,
                  dropRatio: prevNewsCount > 0 ? +(rawNewsCount / prevNewsCount).toFixed(3) : 0,
                  smoothingAlpha: 0.7,
                  stickyZeroGuard,
                };
              }
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
            // zeroGuard: Serper returned 0 (no data / stale) but we have a prior known value.
            // Prevents 0 from passing through percentile normalization and snapping to the ~40 floor,
            // which causes mass leaderboard churn on search refresh ticks.
            const zeroGuard = rawSearchVolume === 0 && prevSearchVolume >= 5;

            if (baselineHold || floorHold || zeroGuard) {
              searchVolume = prevSearchVolume;
              searchDelta = mostRecent?.searchDelta ?? 0;
              searchEmaHeld = true;
              searchEmaHeldCount++;
              searchHoldDiag = {
                reason: zeroGuard ? "zeroGuard" : baselineHold ? "baseline_artifact" : "floor_artifact",
                prevVolume: prevSearchVolume,
                currentVolume: rawSearchVolume,
                baselineP50: sbp50 ?? null,
                dropRatio: prevSearchVolume > 0 ? +(rawSearchVolume / prevSearchVolume).toFixed(3) : 0,
              };
            }
          }
        }

        // ════════════════════════════════════════════════════════════════════
        // ASYMMETRIC 24h DECAY-FLOOR (news + search)
        // ════════════════════════════════════════════════════════════════════
        // Anchors news/search to a linearly-decayed trailing-24h high-water-mark.
        // Spikes propagate immediately (raw > floor wins). Drops are bounded:
        // if the raw fetch is below the floor (single bad cache cycle, transient
        // provider outage, or stale-cache fallback serving low counts), the
        // floor holds the score until the personal high has aged out of the 24h
        // window. Decay is linear: floor = personalHigh * max(0, 1 - hoursSinceHigh / 24).
        // Wikipedia is intentionally excluded — its single-day cadence makes a
        // floor counterproductive (would just delay legitimate downturns).
        // Sits AFTER the EMA-hold guards so it can stack on top: EMA-hold
        // catches single-tick artifacts vs. prev, the floor catches multi-hour
        // troughs vs. the trailing-24h high.
        let newsFloorApplied = false;
        let newsFloorDetail: Record<string, any> | null = null;
        const newsHigh = personalNewsHigh24hMap.get(person.id);
        if (newsHigh && newsHigh.value > 0) {
          const hoursSinceHigh = (now.getTime() - newsHigh.timestamp.getTime()) / (1000 * 60 * 60);
          const decayFactor = Math.max(0, 1 - hoursSinceHigh / 24);
          const floor = Math.round(newsHigh.value * decayFactor);
          if (floor > newsCount) {
            newsFloorDetail = {
              rawAfterEma: newsCount,
              floorValue: floor,
              personalHigh24h: newsHigh.value,
              hoursSinceHigh: Math.round(hoursSinceHigh * 10) / 10,
              decayFactor: Math.round(decayFactor * 1000) / 1000,
              stackedOverEma: newsEmaHeld,
              stackedOverFallback: newsUsedFallback,
            };
            newsCount = floor;
            // Preserve previously-recorded delta — synthesizing a delta from a
            // floor-derived value would create a misleading spike/drop signal.
            newsDelta = mostRecent?.newsDelta ?? newsDelta;
            newsFloorApplied = true;
            newsFloorAppliedCount++;
          }
        }

        let searchFloorApplied = false;
        let searchFloorDetail: Record<string, any> | null = null;
        const searchHigh = personalSearchHigh24hMap.get(person.id);
        if (searchHigh && searchHigh.value > 0) {
          const hoursSinceHigh = (now.getTime() - searchHigh.timestamp.getTime()) / (1000 * 60 * 60);
          const decayFactor = Math.max(0, 1 - hoursSinceHigh / 24);
          const floor = Math.round(searchHigh.value * decayFactor);
          if (floor > searchVolume) {
            searchFloorDetail = {
              rawAfterEma: searchVolume,
              floorValue: floor,
              personalHigh24h: searchHigh.value,
              hoursSinceHigh: Math.round(hoursSinceHigh * 10) / 10,
              decayFactor: Math.round(decayFactor * 1000) / 1000,
              stackedOverEma: searchEmaHeld,
              stackedOverFallback: searchUsedFallback,
            };
            searchVolume = floor;
            searchDelta = mostRecent?.searchDelta ?? searchDelta;
            searchFloorApplied = true;
            searchFloorAppliedCount++;
          }
        }

        // Get current source health states for weight renormalization
        const currentHealthSnapshot = getCurrentHealthSnapshot();
        
        searchDeltaValues.push(searchDelta);
        if (searchDeltaStale) searchDeltaStaleCount++;

        // Wiki-momentum denominator (May 2026 — display-only signal). The
        // Wikipedia provider returns 8 days of daily pageviews ending
        // yesterday and produces `averageDaily7d` as `sum / 8`, which
        // includes the 24h numerator in the denominator. The audit script
        // uses cleaner "trailing 7 days excluding today" semantics, so we
        // reconstruct that here from the persisted `pageviews7d` sum minus
        // the 24h count, divided by 7. Falls back to the raw provider 7d
        // average when the difference is non-positive (e.g. brand-new
        // article with <2 days of history). This is the value passed as
        // `wikiAverageDaily7d` to `computeTrendScore` so the dormant
        // wiki-momentum velocity score uses calibration-aligned semantics.
        const wikiPageviews7dSum = wiki?.pageviews7d ?? 0;
        const wikiPageviews24h = wiki?.pageviews24h ?? 0;
        const wikiAvg7dExcludingToday = wikiPageviews7dSum > wikiPageviews24h
          ? (wikiPageviews7dSum - wikiPageviews24h) / 7
          : (wiki?.averageDaily7d ?? 0);

        // 3-tick smoothing on news inputs fed to scoring only — persisted
        // trend_snapshots.news_count stays raw for diagnostics.
        const newsCountSeries = [
          ...(recentNewsCountSeriesMap.get(person.id) ?? []),
          newsCount,
        ];
        const newsCountForScoring =
          smoothLastNTicks(newsCountSeries, NEWS_SMOOTHING_WINDOW) ?? newsCount;

        const rawNews7dForScoring =
          (news7dHistorySamplesMap.get(person.id) ?? 0) >= PERSONAL_BASELINE_MIN_OBSERVATIONS
            ? (news7dHistoryAvgMap.get(person.id) ?? 0)
            : (news?.averageDaily7d ?? 0);
        const news7dSeries = [
          ...(recentNews7dSeriesMap.get(person.id) ?? []),
          rawNews7dForScoring,
        ];
        const news7dForScoring =
          smoothLastNTicks(news7dSeries, NEWS_SMOOTHING_WINDOW) ?? rawNews7dForScoring;

        const inputs = {
          wikiPageviews: wiki?.pageviews24h || 0,
          wikiPageviews7dAvg: wiki?.averageDaily7d || 0, // 7-day average for stable mass baseline
          wikiAverageDaily7d: wikiAvg7dExcludingToday,
          trendsInterest: (() => {
            const carried = latestTrendsDiagMap.get(person.id);
            if (trends && (trends.currentInterest > 0 || trends.timeseries.length > 0)) {
              return trends.currentInterest;
            }
            if (carried && carried.trendsInterest > 0) return carried.trendsInterest;
            return 0;
          })(),
          // 24h baseline mean from the same `now 1-d` series. Field name is
          // legacy ("trendsAvg7d") but semantics is now "full-day mean" since
          // we switched windows in May 2026.
          trendsAvg7d: (() => {
            const carriedFwd = latestTrendsDiagMap.get(person.id);
            if (trends && trends.avgWindowInterest > 0) return trends.avgWindowInterest;
            if (carriedFwd != null && carriedFwd.trendsAvg7d > 0) return carriedFwd.trendsAvg7d;
            return computeTrendsAvg7d(person.id, trends?.currentInterest ?? 0);
          })(),
          wikiDelta: wiki?.delta || 0,
          newsDelta: newsDelta,
          searchDelta: searchDelta,
          // Smoothed values for velocity normalization + momentum slot.
          newsCount: newsCountForScoring,
          searchVolume: searchVolume,
          newsAverageDaily7d: news7dForScoring,
          // Previous values for recovery detection (data returning after API failure)
          // Only pass previous values if current data is FRESH (not fallback)
          // This ensures recovery mode triggers when we get fresh data after using fallback
          prevNewsCount: newsUsedFallback ? newsCount : (prevNewsCount),
          prevSearchVolume: searchUsedFallback ? searchVolume : (prevSearchVolume),
          // Flag whether the underlying provider returned fresh data this tick.
          // Decoupled from `newsFloorApplied` on purpose: the floor is a smoothing
          // layer over a (potentially still-fresh) raw fetch, not a freshness
          // verdict. Lumping floor-applied snapshots in as "not fresh" would
          // cause the per-person streak detector below to fire spurious Serper
          // fallbacks for people whose raw signal is fine.
          newsIsFresh: !newsUsedFallback && (news?.articleCount24h ?? 0) > 0,
          searchIsFresh: !searchUsedFallback && (serper?.searchVolume ?? 0) > 0,
          // Baseline medians for spike detection (p50 is more robust than mean).
          // Personal-p50 preferred when we have enough history; falls back to
          // population p50 for brand-new celebs with sparse data. This makes
          // spike detection relative to the individual's own normal rather
          // than a global median, so someone like Tim Cook (usually near zero
          // news) correctly registers as spiking when a story breaks.
          wikiBaseline: wiki?.averageDaily7d || sourceStats.wiki.p50,
          newsBaseline: (
            (newsBaselineCountMap.get(person.id) ?? 0) >= PERSONAL_BASELINE_MIN_OBSERVATIONS
              && (newsBaselineMap.get(person.id) ?? 0) > 0
          )
            ? newsBaselineMap.get(person.id)!
            : sourceStats.news.p50,
          searchBaseline: (
            (searchBaselineCountMap.get(person.id) ?? 0) >= PERSONAL_BASELINE_MIN_OBSERVATIONS
              && (searchBaselineMap.get(person.id) ?? 0) > 0
          )
            ? searchBaselineMap.get(person.id)!
            : sourceStats.search.p50,
          activePlatforms: {
            wiki: !!person.wikiSlug,
            instagram: !!person.instagramHandle,
            youtube: !!person.youtubeId,
          },
          // Staleness factors are still derived here for legacy callers and
          // historical diagnostics; computeTrendScore ignores them now but the
          // values are logged in the health summary and per-snapshot diagnostics
          // for post-hoc debugging.
          newsStalenessFactor: Math.min(newsUsedFallback ? newsDecayFactor : 1.0, newsGovernorFactor),
          searchStalenessFactor: Math.min(searchUsedFallback ? searchDecayFactor : 1.0, searchGovernorFactor),
        };

        // Previous scores for 24h/7d change computation + cross-snapshot EMA.
        // The third positional argument (previousFameIndex) feeds the Apr
        // 2026 cross-snapshot EMA on the final fameIndex (see trendScore.ts).
        // We only pass the previous tick's fameIndex when it's recent enough
        // — otherwise new entrants / people coming back from a gap would be
        // pinned to a stale value. FAME_EMA_MAX_GAP_HOURS is set just above
        // the typical 1h ingest cadence so single-tick gaps from deploys or
        // backfills still smooth.
        const prev24h = snapshot24hMap.get(person.id);
        const prev7d = snapshot7dMap.get(person.id);

        const FAME_EMA_MAX_GAP_HOURS = 3;
        const fameEmaPrev =
          mostRecent && snapshotAgeHours <= FAME_EMA_MAX_GAP_HOURS
            ? mostRecent.fameIndex ?? undefined
            : undefined;

        const scoreResult = computeTrendScore(
          inputs,
          prev24h?.trendScore,
          prev7d?.trendScore,
          fameEmaPrev,
          sourceStats,
          prev24h?.fameIndex ?? undefined,
          prev7d?.fameIndex ?? undefined,
        );

        totalProcessed++;

        // Wiki-momentum diagnostics (May 2026 — display-only). Persisted
        // alongside the news-momentum fields so the future score-impact
        // audit can replay candidate weights against history. `ratio` is
        // capped at MOMENTUM_RATIO_CAP for parity with the velocity-slot
        // computation; the raw uncapped ratio is recoverable as
        // `wiki / max(wikiMomentumAvg7d, 1)` from this same blob.
        const wikiMomentumRatio = wikiAvg7dExcludingToday > 0 && wikiPageviews24h > 0
          ? Math.min(wikiPageviews24h / Math.max(wikiAvg7dExcludingToday, 1), MOMENTUM_RATIO_CAP)
          : 0;
        const wikiMomentumLevel = computeMomentumLevel(wikiMomentumRatio);

        // Google Trends diagnostics (May 2026 — score-only card on `now 1-d`).
        // `trendsInterest` = mean of last ~3h on the now-1-d series.
        // `trendsAvg7d` field name is legacy; it now stores the 24h mean of
        // the same series (intra-day baseline for the dormant momentum ratio).
        const trendsCarried = latestTrendsDiagMap.get(person.id);
        const hasFreshTrendsFetch = !!trends && (trends.currentInterest > 0 || trends.timeseries.length > 0);
        const trendsCarriedForward = !hasFreshTrendsFetch && (trendsCarried?.trendsInterest ?? 0) > 0;
        const trendsFetchedAtIso = hasFreshTrendsFetch
          ? now.toISOString()
          : trendsCarriedForward
            ? trendsCarried!.trendsFetchedAt
            : null;

        let trendsInterestLatest = trends?.currentInterest ?? 0;
        let trendsAvg7d =
          trends && trends.avgWindowInterest > 0
            ? trends.avgWindowInterest
            : computeTrendsAvg7d(person.id, trendsInterestLatest);
        let trendsMomentumRatio = 0;
        let trendsMomentumLevel: ReturnType<typeof computeMomentumLevel> = "none";

        if (trendsCarriedForward && trendsCarried) {
          trendsInterestLatest = trendsCarried.trendsInterest;
          trendsAvg7d = trendsCarried.trendsAvg7d > 0 ? trendsCarried.trendsAvg7d : trendsInterestLatest;
          trendsMomentumRatio = trendsCarried.trendsMomentumRatio;
          trendsMomentumLevel = computeMomentumLevel(trendsMomentumRatio);
        } else if (hasFreshTrendsFetch) {
          trendsMomentumRatio = trendsAvg7d > 0 && trendsInterestLatest > 0
            ? Math.min(trendsInterestLatest / Math.max(trendsAvg7d, 1), MOMENTUM_RATIO_CAP)
            : 0;
          trendsMomentumLevel = computeMomentumLevel(trendsMomentumRatio);
        }

        const trendsAvg90d = 0;
        const hasTrendsDiagnostics = hasFreshTrendsFetch || trendsCarriedForward;

        const diagnosticsData = {
          v: SNAPSHOT_DIAGNOSTICS_VERSION,
          raw: {
            wiki: wiki?.pageviews24h ?? 0,
            // Day-over-day baseline for the Wiki Pulse 24h pill — sourced from
            // Wikimedia's own daily breakdown rather than a 24h-old snapshot.
            // The snapshot-comparison approach was unreliable because the
            // "most-recent published day" only rolls forward once per ~24h,
            // so neighbouring hourly snapshots almost always carried the same
            // daily count and the pill rendered an em-dash. See routes.ts
            // wiki delta computation for how this is consumed.
            wikiPrevDay: wiki?.pageviewsPrevDay ?? null,
            wiki7d: wiki?.averageDaily7d ?? 0,
            wikiMomentumAvg7d: wikiAvg7dExcludingToday,
            wikiMomentumRatio,
            wikiMomentumLevel,
            ...(hasTrendsDiagnostics ? {
              trendsInterest: trendsInterestLatest,
              trendsAvg7d,
              trendsMass90d: trendsAvg90d,
              trendsMomentumRatio,
              trendsMomentumLevel,
              trendsTopicId: person.googleTrendsTopicId ?? null,
              trendsWindow: TRENDS_SERPAPI_WINDOW,
              ...(hasFreshTrendsFetch ? { trendsDeltaMethod: TRENDS_DELTA_METHOD } : trendsCarried?.trendsDeltaMethod
                ? { trendsDeltaMethod: trendsCarried.trendsDeltaMethod }
                : {}),
              trendsUsedFallbackName: hasFreshTrendsFetch
                ? !person.googleTrendsTopicId
                : (trendsCarried?.trendsUsedFallbackName ?? !person.googleTrendsTopicId),
              ...(trendsFetchedAtIso ? { trendsFetchedAt: trendsFetchedAtIso } : {}),
            } : {}),
            news: news?.articleCount24h ?? 0,
            // News 7d daily average — denominator for momentum velocity
            // slot. Mirrors the source priority used for the score
            // input above (Apr 2026 — PR4): historical SQL aggregate
            // when we have enough samples, provider value otherwise.
            // Persisting the same value the engine actually used keeps
            // the API and audit script honest about which baseline
            // shaped the score.
            news7d:
              (news7dHistorySamplesMap.get(person.id) ?? 0) >= PERSONAL_BASELINE_MIN_OBSERVATIONS
                ? (news7dHistoryAvgMap.get(person.id) ?? 0)
                : (news?.averageDaily7d ?? 0),
            news7dSource:
              (news7dHistorySamplesMap.get(person.id) ?? 0) >= PERSONAL_BASELINE_MIN_OBSERVATIONS
                ? "history"
                : "provider",
            news7dSamples: news7dHistorySamplesMap.get(person.id) ?? 0,
            search: serper?.searchVolume ?? 0,
          },
          fresh: {
            wiki: !!wiki,
            // `fresh.news` / `fresh.search` answer "did we get fresh underlying
            // data this tick?", which is what the per-person streak detector
            // (line ~1154) needs. The floor is a separate concern surfaced as
            // `newsFloorApplied` / `searchFloorApplied` below. Conflating them
            // would make streak detection fire for floor-anchored ticks where
            // the raw signal is actually fine.
            news: !newsUsedFallback && !newsEmaHeld && (news?.articleCount24h ?? 0) > 0,
            search: !searchUsedFallback && !searchEmaHeld && (serper?.searchVolume ?? 0) > 0,
            trends: hasFreshTrendsFetch,
            trendsCarriedForward,
            newsSource: hasPerPersonFallback ? "serper_news" : newsSource,
            newsIsRefresh: (newsSource === "mediastack" || newsSource === "union")
              ? (mediastackCadence?.shouldRefresh ?? true)
              : true,
            ...(hasPerPersonFallback ? { fallbackReason: news?._fallbackReason ?? "per_person_zero_streak" } : {}),
            ...(newsSource === "union" && news?.source === "union" && isDiagnosticsVerbose() ? {
              newsUnion: {
                unionCount: news.unionCount ?? 0,
                mediastackTotal: news.mediastackPaginationTotal ?? 0,
                legacyTieredCount: news.legacyTieredCount ?? 0,
                contributingProviders: news.contributingProviders ?? [],
                perSourceCounts: news.perSourceCounts ?? null,
                uniqueContributed: news.uniqueContributed ?? null,
              },
            } : {}),
            newsEmaHeld,
            searchEmaHeld,
            newsFloorApplied,
            searchFloorApplied,
            stickyZeroGuard,
            newsGovernorFactor,
            searchGovernorFactor,
            ...(newsEmaHeld ? { newsRawCount: news?.articleCount24h ?? 0, newsHoldDetail: newsHoldDiag } : {}),
            ...(searchEmaHeld ? { searchRawVolume: serper?.searchVolume ?? 0, searchHoldDetail: searchHoldDiag } : {}),
            ...(newsFloorApplied ? { newsFloorDetail } : {}),
            ...(searchFloorApplied ? { searchFloorDetail } : {}),
            ...(searchDeltaStale ? { searchDeltaStale: true, snapshotAgeHours: Math.round(snapshotAgeHours * 10) / 10 } : {}),
          },
          change: {
            basisHours24h: prev24h?.basisHours ?? null,
            has24hBaseline: !!prev24h,
            has7dBaseline: !!prev7d,
          },
          evidence: (() => {
            const currentHeadlines = (news?.topHeadlines ?? []).slice(0, 3);
            const currentTopStories = (serper?.topStories ?? []).slice(0, 3);
            const currentProvider = hasPerPersonFallback ? "serper_news" : newsSource;
            const shouldCarryForward =
              currentHeadlines.length === 0 && currentTopStories.length === 0 &&
              mostRecent;
            return {
              newsHeadlines: shouldCarryForward ? (mostRecent!.prevNewsHeadlines.length > 0 ? mostRecent!.prevNewsHeadlines : currentHeadlines) : currentHeadlines,
              newsProvider: shouldCarryForward && mostRecent!.prevNewsProvider ? mostRecent!.prevNewsProvider : currentProvider,
              relatedSearches: (serper?.relatedSearches ?? []).slice(0, 5),
              peopleAlsoAsk: (serper?.peopleAlsoAsk ?? []).slice(0, 5),
              topStories: shouldCarryForward ? (mostRecent!.prevTopStories.length > 0 ? mostRecent!.prevTopStories : currentTopStories) : currentTopStories,
              ...(shouldCarryForward ? { headlinesCarriedForward: true } : {}),
            };
          })(),
          velocityComponents: scoreResult.velocityComponents,
          driversModel: "velocity_components_v1",
          driversMethod: scoreResult.velocityComponents ? "exact_velocity_components" : "estimate_signal_change",
          // `stab` retained for backwards-compat diagnostics consumers. All
          // stabilization mechanisms are gone, so rawFame === fameIndex and
          // no cap / alpha was applied.
          stab: {
            limited: false,
            capPct: 1,
            alpha: 1,
            spikes: 0,
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
          diagnostics: { ...diagnosticsData, isBackfill: isBackfill || undefined },
          runId: runId,
          scoreVersion: SCORE_VERSION,
        };
        pendingSnapshots.push(snapshotValues);

        scoreResults.push({ person, score: scoreResult });
        processed++;

          })(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Per-person timeout (${PER_PERSON_TIMEOUT_MS / 1000}s) exceeded`)), PER_PERSON_TIMEOUT_MS)
          ),
        ]);
      } catch (error: any) {
        const isTimeout = error?.message?.includes("Per-person timeout");
        if (isTimeout) {
          softTimeoutPeopleCount++;
          console.warn(`[Ingest] SOFT TIMEOUT for ${person.name}: skipped after 30s (underlying DB writes may still complete). Continuing with next person.`);
        } else {
          console.error(`[Ingest] Error processing ${person.name}:`, error);
        }
        errors++;
      }
    }

    // Gap metrics and catch-up mode were removed along with stabilization.
    // With raw scores there is no "gap" between raw and displayed fame index
    // (they're identical by construction).

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

    // ORDERING NOTE: snapshots are written BEFORE the trending_people update.
    // trend_snapshots is the canonical history; trending_people is a denormalized
    // leaderboard cache that the next ingest tick fully rebuilds from snapshots.
    // If we crash between these two writes, the worst case is "current leaderboard
    // is one tick stale" (next tick will refresh it). The previous order (leaderboard
    // first, then snapshots) left them out of sync on a crash and broke EMA
    // continuity on the next run. Moved here from further down in the function.
    if (pendingSnapshots.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < pendingSnapshots.length; i += BATCH_SIZE) {
        const batch = pendingSnapshots.slice(i, i + BATCH_SIZE);
        await db.insert(trendSnapshots).values(batch)
          .onConflictDoUpdate({
            target: [trendSnapshots.personId, trendSnapshots.timestamp],
            set: {
              trendScore: sql`excluded.trend_score`,
              fameIndex: sql`excluded.fame_index`,
              newsCount: sql`excluded.news_count`,
              searchVolume: sql`excluded.search_volume`,
              wikiPageviews: sql`excluded.wiki_pageviews`,
              wikiDelta: sql`excluded.wiki_delta`,
              newsDelta: sql`excluded.news_delta`,
              searchDelta: sql`excluded.search_delta`,
              massScore: sql`excluded.mass_score`,
              velocityScore: sql`excluded.velocity_score`,
              velocityAdjusted: sql`excluded.velocity_adjusted`,
              confidence: sql`excluded.confidence`,
              diversityMultiplier: sql`excluded.diversity_multiplier`,
              momentum: sql`excluded.momentum`,
              drivers: sql`excluded.drivers`,
              snapshotOrigin: sql`excluded.snapshot_origin`,
              diagnostics: sql`excluded.diagnostics`,
              runId: sql`excluded.run_id`,
              scoreVersion: sql`excluded.score_version`,
            },
          });
      }
      console.log(`[Ingest] Batch-inserted ${pendingSnapshots.length} snapshots (pre-leaderboard)`);
    }

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

    // Stabilization / spike-distribution logs removed alongside the
    // underlying mechanisms. With the simplified scorer every person's
    // rawFameIndex === fameIndex, so there is nothing to summarize here.

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
    if (newsSoftHeldCount > 0) {
      console.log(`[Soft Hold] News moderate-drop smoothed: ${newsSoftHeldCount}/${people.length} (asymmetric EMA, alpha=0.7 over prev — anti-oscillation guard)`);
    }
    if (newsFloorAppliedCount > 0 || searchFloorAppliedCount > 0) {
      console.log(`[24h Decay-Floor] News floor: ${newsFloorAppliedCount}/${people.length}, Search floor: ${searchFloorAppliedCount}/${people.length} (anchored above raw fetch via personal trailing-24h high)`);
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
            fameIndex: r.score.fameIndex,
          };
        })
        .sort((a, b) => Math.abs(b.rankChange) - Math.abs(a.rankChange))
        .slice(0, 5);

      console.warn(`[ANOMALY ALERT] Top 5 movers:`);
      for (const m of movers) {
        const direction = m.rankChange > 0 ? '↑' : m.rankChange < 0 ? '↓' : '→';
        console.warn(`  ${direction} ${m.name}: #${m.oldRank} → #${m.newRank} (fame: ${m.fameIndex})`);
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
      isBackfill,
      duration: `${jobDuration}ms`,
      rows: processed,
      lock: "acquired",
      smoothingMode: "off",
      newsAggregationMode,
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
        softHeld: {
          news: newsSoftHeldCount,
        },
        floorHeld24h: {
          news: newsFloorAppliedCount,
          search: searchFloorAppliedCount,
        },
        perPerson: {
          triggered: perPersonFallbackStats.triggered,
          succeeded: perPersonFallbackStats.succeeded,
          skippedCooldown: perPersonFallbackStats.skippedCooldown,
          skippedNotQualified: perPersonFallbackStats.skippedQualified,
          patched: perPersonFallbackStats.patchedPeople,
          topTriggered: perPersonFallbackStats.topTriggered.slice(0, 5),
        },
        newsEnglishHeadlineBackfill: {
          considered: englishHeadlineBackfillStats.considered,
          attempted: englishHeadlineBackfillStats.attempted,
          succeeded: englishHeadlineBackfillStats.succeeded,
          failed: englishHeadlineBackfillStats.failed,
          patched: englishHeadlineBackfillStats.patched,
        },
      },
      reliability: (() => {
        const ss = getSerperRunStats();
        return {
          serperSearchCallsAttempted: ss.searchCallsAttempted,
          serperFallbackCallsAttempted: ss.fallbackCallsAttempted,
          serperTotalCallsAttempted: ss.callsAttempted,
          serperRetriesUsed: ss.retriesUsed,
          serperRetryRate: ss.callsAttempted > 0 ? `${((ss.retriesUsed / ss.callsAttempted) * 100).toFixed(1)}%` : "0%",
          serperFinalFailures: ss.finalFailures,
          serperTimeoutCount: ss.timeoutCount,
          softTimeoutPeople: softTimeoutPeopleCount,
          peopleProcessed: processed,
          peopleTotal: people.length,
        };
      })(),
      coverage: {
        newsPct: `${newsCoveragePctActual.toFixed(0)}%`,
        searchPct: `${searchCoveragePctActual.toFixed(0)}%`,
        newsFreshnessGovernor: `${(newsGovernorFactor * 100).toFixed(0)}%`,
        searchFreshnessGovernor: `${(searchGovernorFactor * 100).toFixed(0)}%`,
        newsProviderUsed: newsSource,
        newsFreshCoveragePct: `${newsCoveragePctActual.toFixed(0)}%`,
        newsLiveApiFetched: newsSource === "mediastack" || newsSource === "union"
          ? ((mediastackBatchStats?.fetched ?? 0) + (gdeltBatchStats?.liveApiFetched ?? 0))
          : (gdeltBatchStats?.liveApiFetched ?? 0),
        newsCacheReused: newsSource === "mediastack" || newsSource === "union"
          ? ((mediastackBatchStats?.cached ?? 0) + (gdeltBatchStats?.cacheReused ?? 0))
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
        newsAggregator: aggregatorStats ? {
          peopleWithAnyData: aggregatorStats.peopleWithAnyData,
          totalUniqueUrls: aggregatorStats.totalUniqueUrls,
          totalOverlappingUrls: aggregatorStats.totalOverlappingUrls,
          dedupRatePct: aggregatorStats.totalUniqueUrls + aggregatorStats.totalOverlappingUrls > 0
            ? Math.round(100 * aggregatorStats.totalOverlappingUrls / (aggregatorStats.totalUniqueUrls + aggregatorStats.totalOverlappingUrls))
            : 0,
          avgUnionCount: Math.round(aggregatorStats.avgUnionCount * 10) / 10,
          peopleUnionBeatsMediastack: aggregatorStats.peopleUnionBeatsMediastack,
          peopleMediastackBeatsUnion: aggregatorStats.peopleMediastackBeatsUnion,
          biggestGainPerson: aggregatorStats.biggestGainPerson,
          providers: {
            mediastack: {
              succeeded: aggregatorStats.providers.mediastack.succeeded,
              peopleWithData: aggregatorStats.providers.mediastack.peopleWithData,
              peopleWithArticles: aggregatorStats.providers.mediastack.peopleWithArticles,
              elapsedMs: aggregatorStats.providers.mediastack.elapsedMs,
            },
            gdelt: {
              succeeded: aggregatorStats.providers.gdelt.succeeded,
              peopleWithData: aggregatorStats.providers.gdelt.peopleWithData,
              peopleWithArticles: aggregatorStats.providers.gdelt.peopleWithArticles,
              elapsedMs: aggregatorStats.providers.gdelt.elapsedMs,
            },
            serper: {
              succeeded: aggregatorStats.providers.serper.succeeded,
              peopleWithData: aggregatorStats.providers.serper.peopleWithData,
              peopleWithArticles: aggregatorStats.providers.serper.peopleWithArticles,
              elapsedMs: aggregatorStats.providers.serper.elapsedMs,
            },
          },
        } : null,
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
      // Stabilization / convergence / capsUsed / alphaUsed removed — the
      // scorer is a single raw-math path, so those fields have no meaning.
      totalProcessed,
    };

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
      newsEnglishHeadlineBackfill: {
        considered: englishHeadlineBackfillStats.considered,
        attempted: englishHeadlineBackfillStats.attempted,
        succeeded: englishHeadlineBackfillStats.succeeded,
        failed: englishHeadlineBackfillStats.failed,
        patched: englishHeadlineBackfillStats.patched,
      },
    };
    (healthSummary as any).runId = runId;

    // NOTE: Snapshot batch-insert was moved above the trending_people transaction
    // (see ORDERING NOTE earlier in this function) so snapshots land first and a
    // mid-run crash doesn't leave the leaderboard ahead of history.

    const runStatus = processed < people.length && processed > 0 ? "failed_partial" : (errors > 0 ? "failed" : "completed");
    await releaseIngestionLock(runId, runStatus, {
      snapshotsWritten: processed,
      peopleProcessed: processed,
      errorCount: errors,
      sourceTimings,
      sourceStatuses,
      hourBucket: hourTimestamp,
      healthSummary,
    });

    try {
      await checkAndEmitProviderCoverageAlerts(healthSummary as Record<string, unknown>);
    } catch (alertErr) {
      console.warn("[Ingest] Provider coverage alert check failed:", alertErr);
    }

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
    orderBy: [desc(trendSnapshots.timestamp), desc(trendSnapshots.id)],
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
      JOIN tracked_people tp ON tp.id = ts.person_id AND tp.status = 'main_leaderboard'
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

    const trackedCountRaw = await db.execute(
      sql`SELECT COUNT(*) as count FROM tracked_people WHERE status = 'main_leaderboard'`,
    );
    const trackedRows = Array.isArray(trackedCountRaw) ? trackedCountRaw : (trackedCountRaw as any).rows ?? [];
    const trackedCount = parseInt((trackedRows[0] as any)?.count || '0', 10);

    const coveragePct = trackedCount > 0 ? Math.round((rows.length / trackedCount) * 100) : 100;

    if (coveragePct < 90) {
      console.error(
        `[Boot] ABORT hydration: only ${rows.length}/${trackedCount} main-leaderboard rows available (${coveragePct}% coverage, need >=90%). Rolling back to prevent serving incomplete data.`,
      );
      await db.delete(trendingPeople);
      return false;
    }

    if (rows.length < trackedCount) {
      console.warn(
        `[Boot] WARNING: Hydrated ${rows.length}/${trackedCount} main-leaderboard rows (${coveragePct}% coverage). Some people may be missing from the leaderboard.`,
      );
    }

    console.log(
      `[Boot] Successfully hydrated trending_people with ${rows.length}/${trackedCount} main-leaderboard rows from run ${runId}`,
    );
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
