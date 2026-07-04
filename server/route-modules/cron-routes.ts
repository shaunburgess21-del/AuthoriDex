import type { Express, NextFunction, Request, Response } from "express";
import { generateAllWeeklyMarkets, getWeekContext } from "../jobs/market-generator";
import { resolveExpiredMarkets } from "../jobs/market-resolver";

/**
 * Cron endpoints for external schedulers (Railway, Vercel Cron, GitHub Actions).
 * Bearer auth using CRON_SECRET.
 */
export function registerCronRoutes(app: Express): void {
  const cronCallLog: { endpoint: string; callerIp: string; at: string }[] = [];
  const CRON_CALL_LOG_MAX = 50;

  const verifyCronSecret = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    const callerIp = req.headers["x-forwarded-for"] || req.ip || "unknown";
    const endpoint = req.path;

    cronCallLog.push({ endpoint, callerIp: String(callerIp), at: new Date().toISOString() });
    if (cronCallLog.length > CRON_CALL_LOG_MAX) cronCallLog.shift();

    if (!cronSecret) {
      console.warn("[Cron] CRON_SECRET not set. Rejecting request.");
      return res.status(503).json({ error: "Service unavailable: CRON_SECRET not configured" });
    }

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      console.warn(`[Cron] Unauthorized attempt on ${endpoint} from ${callerIp}`);
      return res.status(401).json({ error: "Unauthorized: Invalid or missing cron secret" });
    }

    console.log(`[Cron] Authenticated call to ${endpoint} from ${callerIp}`);
    next();
  };

  // NOTE: POST /api/cron/capture-snapshots was removed. It called a no-op
  // (captureHourlySnapshots) that always returned zero writes. Snapshots are
  // written exclusively by the ingest job — use /api/cron/refresh-data.

  app.post("/api/cron/refresh-data", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runDataIngestion } = await import("../jobs/ingest");
      const result = await runDataIngestion();

      res.json({
        success: true,
        message: "Data ingestion completed",
        processed: result.processed,
        errors: result.errors,
        duration: result.duration,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Data ingestion error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/generate-weekly-markets", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const result = await generateAllWeeklyMarkets();
      const { monday, sunday, weekNumber } = getWeekContext();
      res.json({
        success: true,
        message: "Weekly market generation completed",
        weekNumber,
        weekWindowUtc: { monday: monday.toISOString(), sunday: sunday.toISOString() },
        result,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Weekly market generation error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/resolve-markets", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      await resolveExpiredMarkets();
      res.json({
        success: true,
        message: "Expired market resolution run completed",
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Market resolution error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/resolve-induction", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runWeeklyInductionCycle } = await import("../jobs/induction-cycle");
      const result = await runWeeklyInductionCycle();
      res.json({
        success: true,
        message: "Weekly induction resolution run completed",
        result,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Induction resolution error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/run-scoring", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runQuickScoring } = await import("../jobs/quick-score");
      const result = await runQuickScoring();

      res.json({
        success: true,
        message: "Scoring PREVIEW complete (NOT written to DB - only ingest.ts writes)",
        processed: result.processed,
        errors: result.errors,
        healthSummary: result.healthSummary,
        topResults: result.results.slice(0, 10).map((r) => ({ name: r.name, fameIndex: r.fameIndex, rank: r.rank })),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Scoring preview error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Notifications derivation: rank crossings, hot movers, market_closing_soon,
  // streak milestones, low-credit reminders. Mirrors the in-process scheduler
  // started in server/index.ts so external cron / SERVERLESS_MODE deployments
  // still get the passive notification stream. Advisory-locked job, so it's
  // safe to call concurrently with the in-process scheduler.
  app.post("/api/cron/notifications-derivation", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runNotificationsDerivation } = await import("../jobs/notifications-derivation");
      const result = await runNotificationsDerivation();
      res.json({
        success: true,
        message: "Notifications derivation completed",
        result,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Notifications derivation error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/retention-cleanup", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runRetentionCleanup } = await import("../jobs/retention-cleanup");
      const result = await runRetentionCleanup();

      res.json({
        success: true,
        message: "Retention cleanup completed",
        snapshotsDeleted: result.snapshotsDeleted,
        cacheEntriesDeleted: result.cacheEntriesDeleted,
        ingestionRunsDeleted: result.ingestionRunsDeleted,
        pageViewsDeleted: result.pageViewsDeleted,
        ammPriceSnapshotsDeleted: result.ammPriceSnapshotsDeleted,
        agentActionsDeleted: result.agentActionsDeleted,
        ammHealthRunsDeleted: result.ammHealthRunsDeleted,
        duration: result.durationMs,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Retention cleanup error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // AMM operational health check. Read-only audit: orphan ledger rows,
  // seed-return drift, stuck CLOSED_PENDING markets, negative credits,
  // duplicate idempotency keys, agent pause state. Returns 200 with
  // `ok: false` on any failed check (so the JSON body is the source of
  // truth for downstream monitors); only uncaught exceptions return 500.
  // Recommended Railway schedule: every 15 minutes.
  // See ops/AMM_MONITORING_RUNBOOK.md for setup + alerting guidance.
  app.post("/api/cron/amm-health-check", verifyCronSecret, async (req, res) => {
    const startTime = Date.now();
    try {
      const { runAndPersistAmmHealthCheck } = await import("../jobs/amm-health");
      const lookbackDaysRaw = req.query.days ?? req.body?.days;
      const lookbackDays =
        lookbackDaysRaw !== undefined && lookbackDaysRaw !== null && lookbackDaysRaw !== ""
          ? Number(lookbackDaysRaw)
          : undefined;

      // Persists each invocation alongside the in-process scheduler runs,
      // so the admin Operations dashboard's 24h trend covers external
      // crons too (Railway / GitHub Actions / wherever this is triggered).
      const result = await runAndPersistAmmHealthCheck({
        lookbackDays: Number.isFinite(lookbackDays as number) ? (lookbackDays as number) : undefined,
        source: "cron",
      });

      // Surface failed checks at log level WARN so Railway / Sentry / Slack
      // log integrations can alert on them without parsing the JSON body.
      if (!result.ok) {
        const failedNames = result.checks.filter((c) => c.status === "fail").map((c) => c.name);
        console.warn(
          `[Cron][amm-health-check] FAIL — ${result.failed} failed check(s): ${failedNames.join(", ")}`,
        );
      } else if (result.warned > 0) {
        const warnedNames = result.checks.filter((c) => c.status === "warn").map((c) => c.name);
        console.log(
          `[Cron][amm-health-check] PASS with ${result.warned} warning(s): ${warnedNames.join(", ")}`,
        );
      } else {
        console.log(`[Cron][amm-health-check] PASS — all ${result.total} checks clean`);
      }

      res.json({
        success: result.ok,
        ok: result.ok,
        message: result.ok ? "AMM health check passed" : "AMM health check found failing audits",
        summary: {
          total: result.total,
          passed: result.passed,
          warned: result.warned,
          failed: result.failed,
        },
        lookbackDays: result.lookbackDays,
        checks: result.checks,
        duration: result.durationMs,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron][amm-health-check] Uncaught error:", error);
      res.status(500).json({
        success: false,
        error: error?.message ?? String(error),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Drain-breaker cron endpoint. Mirrors the in-process scheduler in
  // server/index.ts so external cron (Railway / GitHub Actions) can
  // drive the breaker in serverless mode where setInterval doesn't
  // run. Auth-gated by the shared cron secret so a leaked URL can't
  // pause agents.
  app.post("/api/cron/drain-breaker-check", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { checkAndTripDrainBreaker } = await import("../agents/drainBreaker");
      const result = await checkAndTripDrainBreaker();

      if (result.tripped) {
        console.warn(
          `[Cron][drain-breaker-check] TRIPPED — houseDelta24h=${result.houseDelta24h} ` +
            `threshold=${Math.round(result.thresholdApplied)} ` +
            `houseBalance=${result.houseBalance}`,
        );
      } else {
        console.log(
          `[Cron][drain-breaker-check] PASS (${result.reason}) — houseDelta24h=${result.houseDelta24h} ` +
            `threshold=${Math.round(result.thresholdApplied)} ` +
            `houseBalance=${result.houseBalance}`,
        );
      }

      res.json({
        success: true,
        tripped: result.tripped,
        reason: result.reason,
        houseDelta24h: result.houseDelta24h,
        houseBalance: result.houseBalance,
        thresholdApplied: result.thresholdApplied,
        thresholds: result.thresholds,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron][drain-breaker-check] Uncaught error:", error);
      res.status(500).json({
        success: false,
        error: error?.message ?? String(error),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Account-deletion sweeper cron endpoint. Mirrors the in-process
  // scheduler in server/index.ts so external cron drives the sweeper
  // in serverless mode. Auth-gated by the shared cron secret to
  // prevent a leaked URL triggering finalisations.
  app.post("/api/cron/process-account-deletions", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { processOverdueAccountDeletions } = await import("../services/account-deletion");
      const result = await processOverdueAccountDeletions();

      if (result.failed > 0) {
        console.warn(
          `[Cron][process-account-deletions] PARTIAL — processed=${result.processed} failed=${result.failed} candidates=${result.candidates}`,
        );
      } else if (result.candidates > 0) {
        console.log(
          `[Cron][process-account-deletions] OK — processed=${result.processed} candidates=${result.candidates}`,
        );
      } else {
        console.log("[Cron][process-account-deletions] OK — no overdue deletions");
      }

      res.json({
        success: true,
        processed: result.processed,
        failed: result.failed,
        candidates: result.candidates,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron][process-account-deletions] Uncaught error:", error);
      res.status(500).json({
        success: false,
        error: error?.message ?? String(error),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/refresh-celebrity-profiles", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runCelebrityProfileCronRefresh } = await import("../jobs/celebrity-profile-cron");
      const result = await runCelebrityProfileCronRefresh();
      res.json({
        success: true,
        message: "Celebrity profile refresh completed",
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Celebrity profile refresh error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/refresh-net-worth", verifyCronSecret, async (req, res) => {
    const startTime = Date.now();
    try {
      const volatility = req.query.volatility === "high" ? "high" : "standard";
      const { runNetWorthCronRefresh } = await import("../jobs/celebrity-profile-cron");
      const result = await runNetWorthCronRefresh(volatility);
      res.json({
        success: true,
        message: `Net worth refresh (${volatility}) completed`,
        volatility,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Net worth refresh error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/refresh-insights-story", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runInsightsStoryCronRefresh } = await import("../jobs/insights-story-cron");
      const result = await runInsightsStoryCronRefresh();
      res.json({
        success: true,
        message: "Insights story refresh completed",
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Insights story refresh error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/refresh-insights-cache", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runInsightsCacheCronRefresh } = await import("../jobs/insights-cache-cron");
      const result = await runInsightsCacheCronRefresh();
      res.json({
        success: true,
        message: "Insights cache refresh completed",
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Insights cache refresh error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post("/api/cron/refresh-why-trending", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runWhyTrendingCronRefresh } = await import("../jobs/why-trending-cron");
      const result = await runWhyTrendingCronRefresh();
      res.json({
        success: true,
        message: "Why Trending refresh completed",
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Why Trending refresh error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // One-shot backfill for profiles missing source_hash or on a stale
  // prompt version. Idempotent — re-running after success is a no-op
  // because the predicate then matches zero rows. Heavy (one OpenAI
  // call per candidate, batched 5 at a time) so don't schedule it;
  // trigger manually after a prompt_version bump or schema migration.
  app.post("/api/cron/backfill-profile-metadata", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runProfileMetadataBackfill } = await import("../backfill-profile-metadata");
      const result = await runProfileMetadataBackfill();
      res.json({
        success: true,
        message: "Profile metadata backfill completed",
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Profile metadata backfill error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // World Market ops digest + AI resolution scout. Mirrors the in-process
  // scheduler in server/index.ts so external cron / SERVERLESS_MODE
  // deployments still get the daily digest. Advisory-locked, so it's safe to
  // call concurrently with the in-process scheduler. Read-only on market
  // state. Recommended Railway schedule: daily ~08:00 UTC.
  app.post("/api/cron/market-ops-digest", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runMarketOpsDigest } = await import("../jobs/market-ops-digest");
      const result = await runMarketOpsDigest();
      res.json({
        success: true,
        message: "World Market ops digest completed",
        ...result,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Market ops digest error:", error);
      res.status(500).json({
        success: false,
        error: error?.message ?? String(error),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Market Scout: sources trending World Market drafts from Polymarket via
  // GPT curation. Mirrors the in-process daily scheduler in server/index.ts
  // so external cron / SERVERLESS_MODE deployments can drive it. Advisory-
  // locked + kill-switch-gated (MARKET_SCOUT_ENABLED), so calling it
  // alongside the in-process scheduler is safe. Only ever creates DRAFT
  // markets — nothing goes live without founder review.
  app.post("/api/cron/market-scout", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runMarketScout, runSourceResolutionWatch } = await import("../jobs/market-scout");
      // Source watch first: LLM-free, runs even when the scout kill
      // switch is off. Pre-fills settlement winners for scouted markets
      // whose upstream source market has resolved.
      const sourceWatch = await runSourceResolutionWatch();
      const result = await runMarketScout();
      res.json({
        success: true,
        message: result.enabled
          ? "Market scout completed"
          : "Market scout disabled (MARKET_SCOUT_ENABLED is off)",
        ...result,
        sourceWatch,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Market scout error:", error);
      res.status(500).json({
        success: false,
        error: error?.message ?? String(error),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Standalone AI resolution scout. Writes scout assessments to market
  // metadata and returns actionable findings WITHOUT sending the digest
  // email — useful for manual testing / inspection. The daily digest runs
  // the scout inline, so this endpoint is not needed for normal operation.
  app.post("/api/cron/resolution-scout", verifyCronSecret, async (_req, res) => {
    const startTime = Date.now();
    try {
      const { runResolutionScout } = await import("../jobs/resolution-scout");
      const result = await runResolutionScout();
      res.json({
        success: true,
        message: result.enabled
          ? "Resolution scout completed"
          : "Resolution scout disabled (RESOLUTION_SCOUT_LLM_ENABLED is off)",
        ...result,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Resolution scout error:", error);
      res.status(500).json({
        success: false,
        error: error?.message ?? String(error),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get("/api/cron/health", verifyCronSecret, async (_req, res) => {
    // Include upstream provider state so external monitors can alert on Serper
    // auth/quota/rate-limit outages instead of silently degrading product features.
    const { getSerperDegradedState } = await import("../providers/serper");
    const serperDegraded = getSerperDegradedState();
    res.json({
      status: "ok",
      serverTime: new Date().toISOString(),
      providers: {
        serper: {
          status: serperDegraded ? "degraded" : "ok",
          reason: serperDegraded?.reason ?? null,
          since: serperDegraded?.since ?? null,
        },
      },
    });
  });
}
