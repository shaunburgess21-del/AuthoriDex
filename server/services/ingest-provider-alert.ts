/**
 * Per-provider news coverage drop detection (pure logic; no DB).
 *
 * An outage is CONFIRMED when a provider's article coverage collapses for 3
 * consecutive completed runs after having been healthy (>= 50%) somewhere in
 * the provided history (onset gate). Once confirmed, the alert RE-FIRES once
 * per UTC day until coverage recovers to the healthy threshold — so a
 * multi-day outage (e.g. a Serper credit lapse) stays visible instead of
 * emitting a single email at onset and then going silent.
 *
 * Providers that were not attempted this run (e.g. GDELT while excluded from
 * the union) are skipped so intentional exclusions never alarm.
 */

export const INGEST_ALERT_PROVIDERS = ["currents", "mediastack", "serper", "gdelt"] as const;
export type IngestAlertProvider = (typeof INGEST_ALERT_PROVIDERS)[number];

export const COVERAGE_LOW_THRESHOLD = 0.25;
export const COVERAGE_HEALTHY_THRESHOLD = 0.5;
export const CONSECUTIVE_LOW_RUNS = 3;

export interface ProviderCoverageSnapshot {
  provider: IngestAlertProvider;
  peopleWithArticles: number;
  peopleWithData: number;
  coverageRatio: number;
  /** False only when the provider was deliberately not called this run. */
  attempted?: boolean;
  /** Whole-roster size this run (for the email's share detail). */
  rosterSize?: number;
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

/**
 * In-process de-dup state:
 *  - `outageConfirmed` — providers whose outage passed the onset gate and are
 *    still dark (cleared on recovery to the healthy threshold).
 *  - `lastAlertedUtcDay` — last UTC day (YYYY-MM-DD) we emailed for a provider,
 *    so a confirmed outage re-alerts at most once per day.
 */
const outageConfirmed = new Set<IngestAlertProvider>();
const lastAlertedUtcDay = new Map<IngestAlertProvider, string>();

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

  const rosterSize = Number((providers as Record<string, unknown>)?.rosterSize ?? 0);

  const out: ProviderCoverageSnapshot[] = [];
  for (const provider of INGEST_ALERT_PROVIDERS) {
    const row = providerBlock[provider] as Record<string, unknown> | undefined;
    if (!row) continue;
    const peopleWithArticles = Number(row.peopleWithArticles ?? 0);
    const peopleWithData = Number(row.peopleWithData ?? 0);
    const coverageRatio =
      peopleWithData > 0 ? peopleWithArticles / peopleWithData : 0;
    // Default true when absent so historical rows (persisted before `attempted`
    // was recorded) and test fixtures aren't treated as intentional skips.
    const attempted = row.attempted !== false;
    out.push({
      provider,
      peopleWithArticles,
      peopleWithData,
      coverageRatio,
      attempted,
      ...(rosterSize > 0 ? { rosterSize } : {}),
    });
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
 * Evaluate alert from completed-run history (newest first; the current,
 * still-running ingest is NOT included). Returns an alert to emit, or null.
 *
 * Behavior:
 *  - Recovery (coverage >= healthy) or a not-attempted provider clears state.
 *  - Onset: a not-yet-confirmed provider must have 3 consecutive low runs AND
 *    a healthy run somewhere in history before it is confirmed.
 *  - Once confirmed, re-fire at most once per UTC day (keyed on `now`) until
 *    recovery — so sustained multi-day outages keep alerting.
 */
export function evaluateProviderCoverageFromRunHistory(
  provider: IngestAlertProvider,
  runsNewestFirst: ProviderCoverageHistoryEntry[],
  currentSnapshot: ProviderCoverageSnapshot,
  now: Date = new Date(),
): ProviderCoverageAlert | null {
  // Intentionally-skipped providers (e.g. GDELT excluded from the union) never
  // alarm — their "zero coverage" is by design, not an outage.
  if (currentSnapshot.attempted === false) {
    outageConfirmed.delete(provider);
    lastAlertedUtcDay.delete(provider);
    return null;
  }

  if (currentSnapshot.coverageRatio >= COVERAGE_HEALTHY_THRESHOLD) {
    outageConfirmed.delete(provider);
    lastAlertedUtcDay.delete(provider);
    return null;
  }

  // Still dark. Confirm the outage on first detection (onset gate), then allow
  // one alert per UTC day while it persists.
  if (!outageConfirmed.has(provider)) {
    if (currentSnapshot.coverageRatio >= COVERAGE_LOW_THRESHOLD) {
      // In the ambiguous band (low..healthy): not dark enough to confirm, not
      // recovered enough to clear. Wait.
      return null;
    }
    if (runsNewestFirst.length < CONSECUTIVE_LOW_RUNS) {
      return null;
    }
    const last3 = runsNewestFirst.slice(0, CONSECUTIVE_LOW_RUNS);
    if (!last3.every((r) => r.coverageRatio < COVERAGE_LOW_THRESHOLD)) {
      return null;
    }
    const hadHealthy = runsNewestFirst.some(
      (r) => r.coverageRatio >= COVERAGE_HEALTHY_THRESHOLD,
    );
    if (!hadHealthy) {
      return null;
    }
    outageConfirmed.add(provider);
  }

  // Confirmed (or just confirmed) and still below healthy: at most one alert
  // per UTC day.
  const utcDay = now.toISOString().slice(0, 10);
  if (lastAlertedUtcDay.get(provider) === utcDay) {
    return null;
  }
  lastAlertedUtcDay.set(provider, utcDay);

  const lastHealthy = runsNewestFirst.find(
    (r) => r.coverageRatio >= COVERAGE_HEALTHY_THRESHOLD,
  );

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

/** Operator checklist shown in the ops email for each provider. */
export const INGEST_PROVIDER_CHECK_HINTS: Record<IngestAlertProvider, string> = {
  currents:
    "Check Currents Builder billing, daily quota (2,500/day), and API keys at currentsapi.services.",
  serper: "Check Serper account credits/billing and that SERPER_API_KEY is valid in Railway.",
  mediastack: "Check Mediastack monthly call limit and MEDIASTACK_API_KEY in Railway.",
  gdelt:
    "GDELT is a free cascade fallback — sustained zero coverage may indicate network or parsing issues.",
};

export interface IngestProviderOpsAlertPayload {
  kind: "ingest_provider_outage";
  provider: IngestAlertProvider;
  title: string;
  summary: string;
  coveragePct: number;
  peopleWithArticles: number;
  peopleWithData: number;
  lastHealthyRunAt: string | null;
  checkHint: string;
  idempotencyKeyBase: string;
}

/** Build the ops-email payload for a fired coverage alert (pure; no send). */
export function buildIngestProviderOpsAlertPayload(
  alert: ProviderCoverageAlert,
  now: Date = new Date(),
): IngestProviderOpsAlertPayload {
  const coveragePct = Math.round(alert.coverageRatio * 100);
  const label = alert.provider.charAt(0).toUpperCase() + alert.provider.slice(1);
  const utcDay = now.toISOString().slice(0, 10);

  return {
    kind: "ingest_provider_outage",
    provider: alert.provider,
    title: `News provider outage: ${label}`,
    summary:
      `${label} article coverage collapsed to ${coveragePct}% ` +
      `(${alert.peopleWithArticles}/${alert.peopleWithData} people with news). ` +
      `Trend scores and prediction markets may be distorted until this is fixed.`,
    coveragePct,
    peopleWithArticles: alert.peopleWithArticles,
    peopleWithData: alert.peopleWithData,
    lastHealthyRunAt: alert.lastHealthyRunAt,
    checkHint: INGEST_PROVIDER_CHECK_HINTS[alert.provider],
    idempotencyKeyBase: `ingest_provider_outage:${alert.provider}:${utcDay}`,
  };
}

/** Reset in-process de-dup state (for tests). */
export function resetIngestAlertDedupState(): void {
  outageConfirmed.clear();
  lastAlertedUtcDay.clear();
}
