/**
 * Source Health State Machine
 * 
 * Tracks the health status of external data sources (GDELT, Serper, Wikipedia)
 * with explicit states and logged transitions.
 * 
 * States:
 * - HEALTHY: Source is returning fresh, valid data
 * - DEGRADED: Source has intermittent issues (some failures, suspicious data)
 * - OUTAGE: Source is down or returning global zeros
 * - RECOVERY: Source just came back after an outage (temporary boosted caps)
 * 
 * State transitions are logged for debugging and monitoring.
 */

export type SourceHealthState = "HEALTHY" | "DEGRADED" | "OUTAGE" | "RECOVERY";

export interface SourceHealthStatus {
  state: SourceHealthState;
  lastHealthyTimestamp: Date | null;
  lastStateChange: Date;
  consecutiveFailures: number;
  recoveryRunsRemaining: number;
  reason: string;
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

const GLOBAL_OUTAGE_THRESHOLD = 0.5; // >50% with near-zero = global outage
const RECOVERY_RUNS = 3; // Number of runs to stay in RECOVERY state
const DEGRADED_FAILURE_THRESHOLD = 2; // Consecutive failures before DEGRADED
const OUTAGE_FAILURE_THRESHOLD = 5; // Consecutive failures before OUTAGE

const createDefaultStatus = (): SourceHealthStatus => ({
  state: "HEALTHY",
  lastHealthyTimestamp: new Date(),
  lastStateChange: new Date(),
  consecutiveFailures: 0,
  recoveryRunsRemaining: 0,
  reason: "initialized",
});

let currentHealth: SourceHealthSnapshot = {
  news: createDefaultStatus(),
  search: createDefaultStatus(),
  wiki: createDefaultStatus(),
};

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

/**
 * Detect if we're in a global outage situation based on how many celebrities
 * have near-zero values for a given source.
 */
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

/**
 * Calculate global health metrics from current ingestion data.
 * Used to determine if we're experiencing a global outage vs individual drops.
 */
export function calculateGlobalHealthMetrics(
  newsValues: Map<string, number>,
  searchValues: Map<string, number>,
  totalCelebrities: number
): GlobalHealthMetrics {
  const newsOutage = detectGlobalOutage(newsValues, 5, totalCelebrities);
  // NOTE: searchVolume is now composite score 0-100, so threshold must be low
  // A score of 10 or below indicates very weak search presence
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
  
  // Check if this run is a failure condition
  const isFailure = conditions.apiFailed || conditions.isGlobalOutage;
  
  if (isFailure) {
    consecutiveFailures++;
    
    if (conditions.isGlobalOutage) {
      newState = "OUTAGE";
      reason = "global_zero";
    } else if (consecutiveFailures >= OUTAGE_FAILURE_THRESHOLD) {
      newState = "OUTAGE";
      reason = `${consecutiveFailures}_consecutive_failures`;
    } else if (consecutiveFailures >= DEGRADED_FAILURE_THRESHOLD) {
      newState = "DEGRADED";
      reason = `${consecutiveFailures}_failures`;
    }
  } else {
    // Successful run - reset failures and update state
    // This handles both: explicit dataReturned=true AND normal steady-state success
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
      // Normal successful run - ensure we're in HEALTHY state
      newState = "HEALTHY";
      consecutiveFailures = 0;
      if (current.state !== "HEALTHY") {
        reason = "normal_operation";
      }
    }
  }
  
  logStateTransition(source, current.state, newState, reason);
  
  const updatedStatus: SourceHealthStatus = {
    state: newState,
    lastHealthyTimestamp: newState === "HEALTHY" ? now : current.lastHealthyTimestamp,
    lastStateChange: newState !== current.state ? now : current.lastStateChange,
    consecutiveFailures,
    recoveryRunsRemaining,
    reason,
  };
  
  currentHealth[source] = updatedStatus;
  return updatedStatus;
}

/**
 * Get staleness decay factor based on how long data has been stale.
 * Returns a multiplier (0.0 to 1.0) for fill-forward values.
 * 
 * Decay curve:
 * - 0-2 hours stale: 100% (no decay)
 * - 2-4 hours stale: 90% → 70%
 * - 4-6 hours stale: 70% → 50%
 * - 6-12 hours stale: 50% → 20%
 * - >12 hours stale: 20% (floor)
 */
export function getStalenessDecayFactor(lastHealthyTimestamp: Date | null): number {
  if (!lastHealthyTimestamp) {
    return 0.2; // Very stale, minimal weight
  }
  
  const now = new Date();
  const staleHours = (now.getTime() - lastHealthyTimestamp.getTime()) / (1000 * 60 * 60);
  
  if (staleHours <= 2) {
    return 1.0;
  } else if (staleHours <= 4) {
    return 1.0 - ((staleHours - 2) / 2) * 0.3; // 1.0 → 0.7
  } else if (staleHours <= 6) {
    return 0.7 - ((staleHours - 4) / 2) * 0.2; // 0.7 → 0.5
  } else if (staleHours <= 12) {
    return 0.5 - ((staleHours - 6) / 6) * 0.3; // 0.5 → 0.2
  } else {
    return 0.2; // Floor - minimal contribution
  }
}

/**
 * Get the current health snapshot for all sources.
 */
export function getCurrentHealthSnapshot(): SourceHealthSnapshot {
  return { ...currentHealth };
}

/**
 * Check if any source is in OUTAGE or DEGRADED state.
 */
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

/**
 * Check if system is in recovery mode for any source.
 */
export function isInRecoveryMode(): boolean {
  return (
    currentHealth.news.state === "RECOVERY" ||
    currentHealth.search.state === "RECOVERY"
  );
}

/**
 * Get a summary string for logging.
 */
export function getHealthSummary(): string {
  const parts: string[] = [];
  
  for (const [source, status] of Object.entries(currentHealth)) {
    if (status.state !== "HEALTHY") {
      parts.push(`${source.toUpperCase()}:${status.state}`);
    }
  }
  
  return parts.length > 0 ? `[Health: ${parts.join(", ")}]` : "[Health: ALL_HEALTHY]";
}

/**
 * Reset health state (useful for testing).
 */
export function resetHealthState(): void {
  currentHealth = {
    news: createDefaultStatus(),
    search: createDefaultStatus(),
    wiki: createDefaultStatus(),
  };
}
