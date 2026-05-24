import { and, desc, gte, inArray } from "drizzle-orm";
import { ingestionRuns } from "@shared/schema";
import { db } from "../db";
import { captureBackgroundMessage } from "../sentry";
import {
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
    .limit(24);

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
  }
}
