import { db } from "../db";
import { ingestionRuns, trendSnapshots } from "@shared/schema";
import { eq, and, gt, lt, desc, sql } from "drizzle-orm";

export interface BaselineDiagnostics {
  currentRunId: string | null;
  baseline24hRunId: string | null;
  baseline24hAgeHours: number | null;
  baseline24hStatus: "normal" | "degraded";
  baseline24hCoveragePct: number;
  baseline7dRunId: string | null;
  baseline7dAgeHours: number | null;
  baseline7dStatus: "normal" | "degraded";
}

const BASELINE_24H_WINDOW_MS = 6 * 60 * 60 * 1000;
const BASELINE_7D_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getBaselineDiagnostics(totalPeopleCount?: number): Promise<BaselineDiagnostics> {
  const now = new Date();
  const time24hAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const time7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [latestRun] = await db
    .select({ id: ingestionRuns.id })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.status, "completed"))
    .orderBy(desc(ingestionRuns.finishedAt))
    .limit(1);

  const [baselineRun24h] = await db
    .select({ id: ingestionRuns.id, finishedAt: ingestionRuns.finishedAt })
    .from(ingestionRuns)
    .where(and(
      eq(ingestionRuns.status, "completed"),
      gt(ingestionRuns.finishedAt, new Date(time24hAgo.getTime() - BASELINE_24H_WINDOW_MS)),
      lt(ingestionRuns.finishedAt, new Date(time24hAgo.getTime() + BASELINE_24H_WINDOW_MS))
    ))
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${time24hAgo}::timestamp))`)
    .limit(1);

  const [baselineRun7d] = await db
    .select({ id: ingestionRuns.id, finishedAt: ingestionRuns.finishedAt })
    .from(ingestionRuns)
    .where(and(
      eq(ingestionRuns.status, "completed"),
      gt(ingestionRuns.finishedAt, new Date(time7dAgo.getTime() - BASELINE_7D_WINDOW_MS)),
      lt(ingestionRuns.finishedAt, new Date(time7dAgo.getTime() + BASELINE_7D_WINDOW_MS))
    ))
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${time7dAgo}::timestamp))`)
    .limit(1);

  let coveragePct = 0;
  if (baselineRun24h && totalPeopleCount && totalPeopleCount > 0) {
    const [coverageRow] = await db
      .select({ cnt: sql<number>`COUNT(DISTINCT ${trendSnapshots.personId})` })
      .from(trendSnapshots)
      .where(eq(trendSnapshots.runId, baselineRun24h.id));
    coveragePct = Math.round((Number(coverageRow?.cnt ?? 0) / totalPeopleCount) * 100);
  }

  const ageHours = (run: { finishedAt: Date | string | null } | undefined) =>
    run?.finishedAt
      ? Math.round((now.getTime() - new Date(run.finishedAt).getTime()) / (1000 * 60 * 60) * 10) / 10
      : null;

  return {
    currentRunId: latestRun?.id ?? null,
    baseline24hRunId: baselineRun24h?.id ?? null,
    baseline24hAgeHours: ageHours(baselineRun24h),
    baseline24hStatus: baselineRun24h ? "normal" : "degraded",
    baseline24hCoveragePct: coveragePct,
    baseline7dRunId: baselineRun7d?.id ?? null,
    baseline7dAgeHours: ageHours(baselineRun7d),
    baseline7dStatus: baselineRun7d ? "normal" : "degraded",
  };
}
