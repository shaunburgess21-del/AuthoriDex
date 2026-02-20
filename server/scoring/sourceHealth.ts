/**
 * Source Health State Machine (DB-Persisted)
 * 
 * Tracks the health status of external data sources (GDELT, Serper, Wikipedia)
 * with explicit states and logged transitions.
 * 
 * CRITICAL: State is persisted to api_cache so it survives server restarts.
 * Previously, in-memory state caused staleness decay to reset on restart,
 * allowing frozen data to keep full influence indefinitely.
 * 
 * States:
 * - HEALTHY: Source is returning fresh, valid data
 * - DEGRADED: Source has intermittent issues (1 consecutive failure)
 * - OUTAGE: Source is down or returning global zeros (2+ failures or global-zero detected)
 * - RECOVERY: Source just came back after an outage (temporary boosted caps)
 */

import { db } from "../db";
import { apiCache } from "@shared/schema";
import { eq } from "drizzle-orm";

export type SourceHealthState = "HEALTHY" | "DEGRADED" | "OUTAGE" | "RECOVERY";

export interface SourceHealthStatus {
  state: SourceHealthState;
  lastHealthyTimestamp: Date | null;
  lastStateChange: Date;
  consecutiveFailures: number;
  recoveryRunsRemaining: number;
  reason: string;
  prevCoveragePct?: number;
  coverageDropRuns?: number;
  consecutiveRecoveryRuns?: number;
  canaryTripStreak?: number;
  canaryRecoverStreak?: number;
}

export interface SourceHealthSnapshot {
  news: SourceHealthStatus;
  search: SourceHealthStatus;
  wiki: SourceHealthStatus;
}

export interface GlobalHealthMetrics {
  totalCelebrities: number;
  newsNearZeroCount: number;
  searchNearZeroCount: number;
  newsNearZeroPercent: number;
  searchNearZeroPercent: number;
  isNewsGlobalOutage: boolean;
  isSearchGlobalOutage: boolean;
}

const GLOBAL_OUTAGE_THRESHOLD = 0.5;
const RECOVERY_RUNS = 3;
const DB_CACHE_KEY = "system:source_health_state";

const createDefaultStatus = (): SourceHealthStatus => ({
  state: "HEALTHY",
  lastHealthyTimestamp: null,
  lastStateChange: new Date(),
  consecutiveFailures: 0,
  recoveryRunsRemaining: 0,
  reason: "initialized_no_data",
});

let currentHealth: SourceHealthSnapshot = {
  news: createDefaultStatus(),
  search: createDefaultStatus(),
  wiki: createDefaultStatus(),
};

let healthLoadedFromDB = false;

function serializeHealth(health: SourceHealthSnapshot): Record<string, any> {
  const serialize = (s: SourceHealthStatus) => ({
    state: s.state,
    lastHealthyTimestamp: s.lastHealthyTimestamp?.toISOString() ?? null,
    lastStateChange: s.lastStateChange.toISOString(),
    consecutiveFailures: s.consecutiveFailures,
    recoveryRunsRemaining: s.recoveryRunsRemaining,
    reason: s.reason,
    prevCoveragePct: s.prevCoveragePct ?? null,
    coverageDropRuns: s.coverageDropRuns ?? 0,
    consecutiveRecoveryRuns: s.consecutiveRecoveryRuns ?? 0,
    canaryTripStreak: s.canaryTripStreak ?? 0,
    canaryRecoverStreak: s.canaryRecoverStreak ?? 0,
  });
  return {
    news: serialize(health.news),
    search: serialize(health.search),
    wiki: serialize(health.wiki),
    persistedAt: new Date().toISOString(),
  };
}

function deserializeHealth(data: Record<string, any>): SourceHealthSnapshot {
  const deserialize = (d: any): SourceHealthStatus => ({
    state: d.state || "HEALTHY",
    lastHealthyTimestamp: d.lastHealthyTimestamp ? new Date(d.lastHealthyTimestamp) : null,
    lastStateChange: d.lastStateChange ? new Date(d.lastStateChange) : new Date(),
    consecutiveFailures: d.consecutiveFailures ?? 0,
    recoveryRunsRemaining: d.recoveryRunsRemaining ?? 0,
    reason: d.reason || "restored_from_db",
    prevCoveragePct: d.prevCoveragePct ?? undefined,
    coverageDropRuns: d.coverageDropRuns ?? 0,
    consecutiveRecoveryRuns: d.consecutiveRecoveryRuns ?? 0,
    canaryTripStreak: d.canaryTripStreak ?? 0,
    canaryRecoverStreak: d.canaryRecoverStreak ?? 0,
  });
  return {
    news: deserialize(data.news || {}),
    search: deserialize(data.search || {}),
    wiki: deserialize(data.wiki || {}),
  };
}

export async function loadHealthFromDB(): Promise<void> {
  try {
    const rows = await db.select().from(apiCache).where(eq(apiCache.cacheKey, DB_CACHE_KEY));
    if (rows.length > 0 && rows[0].responseData) {
      const data = typeof rows[0].responseData === 'string' 
        ? JSON.parse(rows[0].responseData) 
        : rows[0].responseData;
      currentHealth = deserializeHealth(data);
      healthLoadedFromDB = true;
      console.log(`[SourceHealth] Restored from DB: NEWS=${currentHealth.news.state}(fails=${currentHealth.news.consecutiveFailures}), ` +
        `SEARCH=${currentHealth.search.state}(fails=${currentHealth.search.consecutiveFailures}), ` +
        `WIKI=${currentHealth.wiki.state}(fails=${currentHealth.wiki.consecutiveFailures})`);
      
      if (currentHealth.news.lastHealthyTimestamp) {
        const staleHours = (Date.now() - currentHealth.news.lastHealthyTimestamp.getTime()) / (1000 * 60 * 60);
        console.log(`[SourceHealth] NEWS last healthy: ${staleHours.toFixed(1)}h ago (decay=${(getStalenessDecayFactor(currentHealth.news.lastHealthyTimestamp) * 100).toFixed(0)}%)`);
      }
    } else {
      console.log(`[SourceHealth] No persisted state found, starting fresh`);
    }
  } catch (err) {
    console.error(`[SourceHealth] Failed to load from DB:`, err);
  }
}

async function persistHealthToDB(): Promise<void> {
  try {
    const data = JSON.stringify(serializeHealth(currentHealth));
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    
    const existing = await db.select({ id: apiCache.id }).from(apiCache).where(eq(apiCache.cacheKey, DB_CACHE_KEY));
    if (existing.length > 0) {
      await db.update(apiCache)
        .set({ responseData: data, fetchedAt: new Date(), expiresAt: farFuture })
        .where(eq(apiCache.cacheKey, DB_CACHE_KEY));
    } else {
      await db.insert(apiCache).values({
        cacheKey: DB_CACHE_KEY,
        provider: "system",
        responseData: data,
        fetchedAt: new Date(),
        expiresAt: farFuture,
      });
    }
  } catch (err) {
    console.error(`[SourceHealth] Failed to persist to DB:`, err);
  }
}

function logStateTransition(
  source: string,
  oldState: SourceHealthState,
  newState: SourceHealthState,
  reason: string
): void {
  if (oldState !== newState) {
    console.log(`[SOURCE:${source.toUpperCase()}] ${oldState} → ${newState} (reason: ${reason})`);
  }
}

export function detectGlobalOutage(
  sourceValues: Map<string, number>,
  nearZeroThreshold: number,
  totalExpected: number
): { isOutage: boolean; nearZeroCount: number; nearZeroPercent: number } {
  let nearZeroCount = 0;
  
  sourceValues.forEach((value) => {
    if (value < nearZeroThreshold) {
      nearZeroCount++;
    }
  });
  
  const nearZeroPercent = totalExpected > 0 ? nearZeroCount / totalExpected : 0;
  const isOutage = nearZeroPercent > GLOBAL_OUTAGE_THRESHOLD;
  
  return { isOutage, nearZeroCount, nearZeroPercent };
}

export function calculateGlobalHealthMetrics(
  newsValues: Map<string, number>,
  searchValues: Map<string, number>,
  totalCelebrities: number
): GlobalHealthMetrics {
  const newsOutage = detectGlobalOutage(newsValues, 5, totalCelebrities);
  const searchOutage = detectGlobalOutage(searchValues, 10, totalCelebrities);
  
  return {
    totalCelebrities,
    newsNearZeroCount: newsOutage.nearZeroCount,
    searchNearZeroCount: searchOutage.nearZeroCount,
    newsNearZeroPercent: newsOutage.nearZeroPercent,
    searchNearZeroPercent: searchOutage.nearZeroPercent,
    isNewsGlobalOutage: newsOutage.isOutage,
    isSearchGlobalOutage: searchOutage.isOutage,
  };
}

/**
 * Update health state for a source based on current conditions.
 * 
 * KEY CHANGE: Decay starts on FIRST failure (DEGRADED state) instead of
 * waiting for 5 consecutive failures. This ensures stale data loses
 * influence immediately rather than staying at full strength.
 */
export function updateSourceHealth(
  source: "news" | "search" | "wiki",
  conditions: {
    apiFailed: boolean;
    isGlobalOutage: boolean;
    dataReturned: boolean;
  }
): SourceHealthStatus {
  const current = currentHealth[source];
  const now = new Date();
  let newState = current.state;
  let reason = current.reason;
  let consecutiveFailures = current.consecutiveFailures;
  let recoveryRunsRemaining = current.recoveryRunsRemaining;
  let lastHealthyTimestamp = current.lastHealthyTimestamp;
  
  const isFailure = conditions.apiFailed || conditions.isGlobalOutage;
  
  if (isFailure) {
    consecutiveFailures++;
    
    if (conditions.isGlobalOutage) {
      newState = "OUTAGE";
      reason = "global_zero";
    } else if (consecutiveFailures >= 2) {
      newState = "OUTAGE";
      reason = `${consecutiveFailures}_consecutive_failures`;
    } else {
      newState = "DEGRADED";
      reason = `first_failure`;
    }
  } else {
    if (current.state === "OUTAGE" || current.state === "DEGRADED") {
      newState = "RECOVERY";
      reason = "data_returned";
      recoveryRunsRemaining = RECOVERY_RUNS;
      consecutiveFailures = 0;
    } else if (current.state === "RECOVERY") {
      recoveryRunsRemaining--;
      consecutiveFailures = 0;
      if (recoveryRunsRemaining <= 0) {
        newState = "HEALTHY";
        reason = "recovery_complete";
      }
    } else {
      newState = "HEALTHY";
      consecutiveFailures = 0;
      if (current.state !== "HEALTHY") {
        reason = "normal_operation";
      }
    }
    lastHealthyTimestamp = now;
  }
  
  logStateTransition(source, current.state, newState, reason);
  
  const updatedStatus: SourceHealthStatus = {
    state: newState,
    lastHealthyTimestamp: lastHealthyTimestamp,
    lastStateChange: newState !== current.state ? now : current.lastStateChange,
    consecutiveFailures,
    recoveryRunsRemaining,
    reason,
  };
  
  currentHealth[source] = updatedStatus;
  return updatedStatus;
}

/**
 * Persist current health state to DB. Should be called at end of each ingestion run.
 */
export async function saveHealthState(): Promise<void> {
  await persistHealthToDB();
}

/**
 * Get staleness decay factor based on how long data has been stale.
 * Returns a multiplier (0.0 to 1.0) for fill-forward values.
 * 
 * Decay curve (gentler to handle overnight gaps):
 * - 0-2 hours stale: 100% (no decay)
 * - 2-4 hours stale: 100% → 80%
 * - 4-8 hours stale: 80% → 65%
 * - 8-16 hours stale: 65% → 50%
 * - >16 hours stale: 50% (floor — preserves half the signal)
 */
export function getStalenessDecayFactor(lastHealthyTimestamp: Date | null): number {
  if (!lastHealthyTimestamp) {
    return 0.5;
  }
  
  const now = new Date();
  const staleHours = (now.getTime() - lastHealthyTimestamp.getTime()) / (1000 * 60 * 60);
  
  if (staleHours <= 2) {
    return 1.0;
  } else if (staleHours <= 4) {
    return 1.0 - ((staleHours - 2) / 2) * 0.2;
  } else if (staleHours <= 8) {
    return 0.8 - ((staleHours - 4) / 4) * 0.15;
  } else if (staleHours <= 16) {
    return 0.65 - ((staleHours - 8) / 8) * 0.15;
  } else {
    return 0.5;
  }
}

export function getCurrentHealthSnapshot(): SourceHealthSnapshot {
  return { ...currentHealth };
}

export function hasAnyDegradedSource(): boolean {
  return (
    currentHealth.news.state === "OUTAGE" ||
    currentHealth.news.state === "DEGRADED" ||
    currentHealth.search.state === "OUTAGE" ||
    currentHealth.search.state === "DEGRADED" ||
    currentHealth.wiki.state === "OUTAGE" ||
    currentHealth.wiki.state === "DEGRADED"
  );
}

export function isInRecoveryMode(): boolean {
  return (
    currentHealth.news.state === "RECOVERY" ||
    currentHealth.search.state === "RECOVERY"
  );
}

export function getHealthSummary(): string {
  const parts: string[] = [];
  
  for (const [source, status] of Object.entries(currentHealth)) {
    if (status.state !== "HEALTHY") {
      const staleInfo = status.lastHealthyTimestamp 
        ? `, stale=${((Date.now() - status.lastHealthyTimestamp.getTime()) / (1000 * 60 * 60)).toFixed(1)}h`
        : ', stale=unknown';
      parts.push(`${source.toUpperCase()}:${status.state}(fails=${status.consecutiveFailures}${staleInfo})`);
    }
  }
  
  return parts.length > 0 ? `[Health: ${parts.join(", ")}]` : "[Health: ALL_HEALTHY]";
}

/**
 * Degradation Governor: Computes a weight multiplier for a source
 * based on run-over-run coverage changes.
 * 
 * When coverage drops sharply (>50 percentage points in one run),
 * instead of allowing immediate full-weight impact, the governor
 * ramps down the weight over 3 runs:
 *   Run 1 (first drop): 75% weight
 *   Run 2: 50% weight  
 *   Run 3+: 25% weight (floor)
 * 
 * When coverage recovers, weight immediately returns to 100%.
 */
export function computeDegradationGovernor(
  source: "news" | "search" | "wiki",
  currentCoveragePct: number
): number {
  const status = currentHealth[source];
  const prevCoverage = status.prevCoveragePct ?? 100;
  const coverageDrop = prevCoverage - currentCoveragePct;
  
  status.prevCoveragePct = currentCoveragePct;
  
  if (currentCoveragePct >= 70) {
    const RECOVERY_HYSTERESIS = 2;
    status.consecutiveRecoveryRuns = (status.consecutiveRecoveryRuns ?? 0) + 1;
    
    if ((status.coverageDropRuns ?? 0) > 0 && status.consecutiveRecoveryRuns < RECOVERY_HYSTERESIS) {
      console.log(`[DegradationGovernor] ${source.toUpperCase()}: Coverage recovered to ${currentCoveragePct.toFixed(0)}%, but need ${RECOVERY_HYSTERESIS - status.consecutiveRecoveryRuns} more run(s) to confirm stability.`);
      return 0.75;
    }
    
    if ((status.coverageDropRuns ?? 0) > 0 && status.consecutiveRecoveryRuns >= RECOVERY_HYSTERESIS) {
      console.log(`[DegradationGovernor] ${source.toUpperCase()}: Recovery confirmed (${status.consecutiveRecoveryRuns} consecutive runs above 70%). Restoring full weight.`);
    }
    status.coverageDropRuns = 0;
    return 1.0;
  }
  
  status.consecutiveRecoveryRuns = 0;
  
  if (coverageDrop > 50 && (status.coverageDropRuns ?? 0) === 0) {
    status.coverageDropRuns = 1;
    console.log(`[DegradationGovernor] ${source.toUpperCase()}: Sharp coverage drop detected (${prevCoverage.toFixed(0)}% → ${currentCoveragePct.toFixed(0)}%). Starting ramp-down.`);
  } else if (currentCoveragePct < 70) {
    status.coverageDropRuns = Math.max(1, (status.coverageDropRuns ?? 0) + 1);
    if ((status.coverageDropRuns ?? 0) > 1) {
      console.log(`[DegradationGovernor] ${source.toUpperCase()}: Sustained low coverage (${currentCoveragePct.toFixed(0)}%), run ${status.coverageDropRuns} of ramp-down.`);
    }
  }
  
  const dropRuns = status.coverageDropRuns ?? 0;
  if (dropRuns <= 0) return 1.0;
  if (dropRuns === 1) return 0.75;
  if (dropRuns === 2) return 0.50;
  return 0.25;
}

const CANARY_TRIP_THRESHOLD = 2;
const CANARY_RECOVER_THRESHOLD = 3;

export function updateCanaryStreak(
  source: "news" | "search",
  canaryAlert: boolean
): { shouldAccelerate: boolean; tripStreak: number; recoverStreak: number } {
  const status = currentHealth[source];

  if (canaryAlert) {
    status.canaryTripStreak = (status.canaryTripStreak ?? 0) + 1;
    status.canaryRecoverStreak = 0;

    const shouldAccelerate =
      status.canaryTripStreak >= CANARY_TRIP_THRESHOLD &&
      status.state === "HEALTHY";

    return {
      shouldAccelerate,
      tripStreak: status.canaryTripStreak,
      recoverStreak: 0,
    };
  } else {
    status.canaryRecoverStreak = (status.canaryRecoverStreak ?? 0) + 1;

    if (status.canaryRecoverStreak >= CANARY_RECOVER_THRESHOLD) {
      status.canaryTripStreak = 0;
    }

    return {
      shouldAccelerate: false,
      tripStreak: status.canaryTripStreak ?? 0,
      recoverStreak: status.canaryRecoverStreak,
    };
  }
}

export function resetHealthState(): void {
  currentHealth = {
    news: createDefaultStatus(),
    search: createDefaultStatus(),
    wiki: createDefaultStatus(),
  };
}
