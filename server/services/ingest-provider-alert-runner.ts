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

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
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
    // 24h window typically has ~24 hourly rows; allow headroom for backfills
    // so the prior-healthy gate doesn't silently drop the oldest healthy run.
    .limit(72);

  const historyByProvider = buildProviderHistoryFromRuns(
    recentRuns
      .filter((r): r is typeof r & { startedAt: Date } => r.startedAt != null)
      .map((r) => ({
        startedAt: r.startedAt,
        healthSummary: r.healthSummary,
      })),
  );

  for (const current of currentSnapshots) {
    const history = historyByProvider.get(current.provider) ?? [];
    const alert = evaluateProviderCoverageFromRunHistory(
      current.provider,
      history,
      current,
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
                "Below 25% for 3 consecutive hourly ingests after being healthy in the prior 24h",
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
