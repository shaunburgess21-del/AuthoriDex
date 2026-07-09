import { and, desc, gte, inArray } from "drizzle-orm";
import { ingestionRuns } from "@shared/schema";
import { db } from "../db";
import { captureBackgroundMessage } from "../sentry";
import {
  adminDashboardUrl,
  sendOpsAlert,
} from "./ops-alerts";
import {
  buildIngestProviderOpsAlertPayload,
  buildProviderHistoryFromRuns,
  evaluateProviderCoverageFromRunHistory,
  extractProviderCoverageFromHealthSummary,
  formatIngestAlertLogLine,
} from "./ingest-provider-alert";

export async function checkAndEmitProviderCoverageAlerts(
  healthSummary: Record<string, unknown>,
): Promise<void> {
  const currentSnapshots = extractProviderCoverageFromHealthSummary(healthSummary);
  if (currentSnapshots.length === 0) return;

  // 7-day window so the onset "was healthy" gate survives multi-day outages
  // and short ingest gaps — the alert itself re-fires daily via the confirmed
  // -outage state machine, so the window only needs to cover outage onset.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentRuns = await db
    .select({
      startedAt: ingestionRuns.startedAt,
      healthSummary: ingestionRuns.healthSummary,
    })
    .from(ingestionRuns)
    .where(
      and(
        inArray(ingestionRuns.status, ["completed", "failed_partial"]),
        gte(ingestionRuns.startedAt, since),
      ),
    )
    .orderBy(desc(ingestionRuns.startedAt))
    // ~7d of hourly rows (~168) with headroom for backfills/denser cadence.
    .limit(600);

  const historyByProvider = buildProviderHistoryFromRuns(
    recentRuns
      .filter((r): r is typeof r & { startedAt: Date } => r.startedAt != null)
      .map((r) => ({
        startedAt: r.startedAt,
        healthSummary: r.healthSummary,
      })),
  );

  const now = new Date();
  for (const current of currentSnapshots) {
    const history = historyByProvider.get(current.provider) ?? [];
    const alert = evaluateProviderCoverageFromRunHistory(
      current.provider,
      history,
      current,
      now,
    );
    if (!alert) continue;

    const line = formatIngestAlertLogLine(alert);
    console.error(line);
    captureBackgroundMessage(line, {
      level: "error",
      tags: { surface: "ingest.provider", provider: alert.provider },
      extra: {
        coverageRatio: alert.coverageRatio,
        peopleWithArticles: alert.peopleWithArticles,
        peopleWithData: alert.peopleWithData,
        lastHealthyRunAt: alert.lastHealthyRunAt,
      },
    });

    const payload = buildIngestProviderOpsAlertPayload(alert);
    void sendOpsAlert({
      kind: payload.kind,
      severity: "critical",
      title: payload.title,
      summary: payload.summary,
      sections: [
        {
          heading: "What we detected",
          emoji: "⚠️",
          items: [
            {
              text: `Coverage: ${payload.coveragePct}% of roster`,
              detail: `${payload.peopleWithArticles}/${payload.peopleWithData} people returned articles`,
            },
            {
              text: "Trigger",
              detail:
                "Below 25% article coverage for 3 consecutive hourly ingests after being healthy (re-alerts daily until it recovers)",
            },
            {
              text: `Last healthy ingest: ${payload.lastHealthyRunAt ?? "unknown"}`,
              detail: "UTC",
            },
          ],
        },
        {
          heading: "Suggested checks",
          emoji: "🔧",
          items: [
            { text: payload.checkHint },
            {
              text: "Review Railway ingest logs for THROTTLED / FAILED source status or frozen rate-limit snapshots.",
            },
          ],
        },
      ],
      ctaUrl: adminDashboardUrl(),
      ctaLabel: "Open admin dashboard",
      idempotencyKeyBase: payload.idempotencyKeyBase,
    }).catch((err) => {
      console.error(
        `[IngestAlert] Ops email failed for ${alert.provider}:`,
        err instanceof Error ? err.message : String(err),
      );
    });
  }
}
