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
