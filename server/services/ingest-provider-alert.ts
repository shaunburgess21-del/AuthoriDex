/**
 * Per-provider news coverage drop detection (pure logic; no DB).
 *
 * Fires when a provider's article coverage collapses for 3 consecutive
 * completed runs after having been healthy (>= 50%) within the prior 24h.
 */

export const INGEST_ALERT_PROVIDERS = ["mediastack", "serper", "gdelt"] as const;
export type IngestAlertProvider = (typeof INGEST_ALERT_PROVIDERS)[number];

export const COVERAGE_LOW_THRESHOLD = 0.25;
export const COVERAGE_HEALTHY_THRESHOLD = 0.5;
export const CONSECUTIVE_LOW_RUNS = 3;

export interface ProviderCoverageSnapshot {
  provider: IngestAlertProvider;
  peopleWithArticles: number;
  peopleWithData: number;
  coverageRatio: number;
}

export interface ProviderCoverageHistoryEntry {
  startedAt: Date;
  coverageRatio: number;
}

export interface ProviderCoverageAlert {
  provider: IngestAlertProvider;
  coverageRatio: number;
  peopleWithArticles: number;
  peopleWithData: number;
  lastHealthyRunAt: string | null;
}

/** In-process de-dup: don't re-fire until coverage recovers. */
const outageAlerted = new Set<IngestAlertProvider>();

export function extractProviderCoverageFromHealthSummary(
  healthSummary: Record<string, unknown> | null | undefined,
): ProviderCoverageSnapshot[] {
  if (!healthSummary || typeof healthSummary !== "object") return [];

  const agg = (healthSummary as Record<string, unknown>).coverage as
    | Record<string, unknown>
    | undefined;
  const providers = agg?.newsAggregator as Record<string, unknown> | undefined;
  const providerBlock = providers?.providers as Record<string, unknown> | undefined;
  if (!providerBlock) return [];

  const out: ProviderCoverageSnapshot[] = [];
  for (const provider of INGEST_ALERT_PROVIDERS) {
    const row = providerBlock[provider] as Record<string, unknown> | undefined;
    if (!row) continue;
    const peopleWithArticles = Number(row.peopleWithArticles ?? 0);
    const peopleWithData = Number(row.peopleWithData ?? 0);
    const coverageRatio =
      peopleWithData > 0 ? peopleWithArticles / peopleWithData : 0;
    out.push({ provider, peopleWithArticles, peopleWithData, coverageRatio });
  }
  return out;
}

export function buildProviderHistoryFromRuns(
  runs: Array<{ startedAt: Date; healthSummary: unknown }>,
): Map<IngestAlertProvider, ProviderCoverageHistoryEntry[]> {
  const byProvider = new Map<IngestAlertProvider, ProviderCoverageHistoryEntry[]>();
  for (const p of INGEST_ALERT_PROVIDERS) {
    byProvider.set(p, []);
  }

  for (const run of runs) {
    const snapshots = extractProviderCoverageFromHealthSummary(
      run.healthSummary as Record<string, unknown>,
    );
    for (const snap of snapshots) {
      byProvider.get(snap.provider)!.push({
        startedAt: run.startedAt,
        coverageRatio: snap.coverageRatio,
      });
    }
  }
  return byProvider;
}

/**
 * Evaluate alert from completed-run history (newest first, includes current run).
 */
export function evaluateProviderCoverageFromRunHistory(
  provider: IngestAlertProvider,
  runsNewestFirst: ProviderCoverageHistoryEntry[],
  currentSnapshot: ProviderCoverageSnapshot,
): ProviderCoverageAlert | null {
  if (currentSnapshot.coverageRatio >= COVERAGE_HEALTHY_THRESHOLD) {
    outageAlerted.delete(provider);
    return null;
  }

  if (outageAlerted.has(provider)) {
    return null;
  }

  if (runsNewestFirst.length < CONSECUTIVE_LOW_RUNS) {
    return null;
  }

  const last3 = runsNewestFirst.slice(0, CONSECUTIVE_LOW_RUNS);
  if (!last3.every((r) => r.coverageRatio < COVERAGE_LOW_THRESHOLD)) {
    return null;
  }

  const hadHealthyIn24h = runsNewestFirst.some(
    (r) => r.coverageRatio >= COVERAGE_HEALTHY_THRESHOLD,
  );
  if (!hadHealthyIn24h) {
    return null;
  }

  const lastHealthy = runsNewestFirst.find(
    (r) => r.coverageRatio >= COVERAGE_HEALTHY_THRESHOLD,
  );

  outageAlerted.add(provider);

  return {
    provider,
    coverageRatio: currentSnapshot.coverageRatio,
    peopleWithArticles: currentSnapshot.peopleWithArticles,
    peopleWithData: currentSnapshot.peopleWithData,
    lastHealthyRunAt: lastHealthy?.startedAt.toISOString() ?? null,
  };
}

export function formatIngestAlertLogLine(alert: ProviderCoverageAlert): string {
  return (
    `[IngestAlert] provider=${alert.provider} coverageRatio=${alert.coverageRatio.toFixed(3)} ` +
    `peopleWithArticles=${alert.peopleWithArticles} peopleWithData=${alert.peopleWithData} ` +
    `lastHealthyRunAt=${alert.lastHealthyRunAt ?? "unknown"}`
  );
}

/** Reset in-process de-dup state (for tests). */
export function resetIngestAlertDedupState(): void {
  outageAlerted.clear();
}
