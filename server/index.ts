import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startSnapshotScheduler } from "./jobs/snapshot-scheduler";
import { runDataIngestion } from "./jobs/ingest";
import { pool } from "./db";
import { setDbGuardrailsVerified } from "./guardrails";

// ===========================================
// SERVERLESS MODE DETECTION
// ===========================================
// When SERVERLESS_MODE=true (e.g., on Vercel), background schedulers are disabled.
// Instead, use the /api/cron/* endpoints triggered by external schedulers.
const SERVERLESS_MODE = process.env.SERVERLESS_MODE === "true" || process.env.VERCEL === "1";

// Data ingestion interval: 1 hour (increased frequency for smoother trend curves)
// Since X API was removed, we have budget for more frequent Wiki/GDELT/Serper calls
const INGESTION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour in ms

const REQUIRED_DB_CONSTRAINTS = [
  'chk_snapshot_origin_values',
  'chk_ingest_hour_truncated',
];

const REQUIRE_DB_GUARDRAILS = process.env.REQUIRE_DB_GUARDRAILS === 'true';

async function verifyDbConstraints() {
  try {
    const result = await pool.query(
      `SELECT conname FROM pg_constraint 
       WHERE conrelid = 'trend_snapshots'::regclass 
       AND contype = 'c' 
       AND conname = ANY($1)`,
      [REQUIRED_DB_CONSTRAINTS]
    );
    const found = result.rows.map((r: any) => r.conname);
    const missing = REQUIRED_DB_CONSTRAINTS.filter(c => !found.includes(c));
    if (missing.length > 0) {
      log(`[DB_GUARDRAIL_MISSING] CRITICAL: Missing constraints on trend_snapshots: ${missing.join(', ')}. Data integrity is at risk! Re-apply via SQL.`);
      if (REQUIRE_DB_GUARDRAILS) {
        log(`[DB_GUARDRAIL_MISSING] REQUIRE_DB_GUARDRAILS=true — ingest writes are BLOCKED until constraints are restored.`);
      }
      setDbGuardrailsVerified(false);
    } else {
      log(`[DB Guardrails] All ${REQUIRED_DB_CONSTRAINTS.length} constraints verified on trend_snapshots`);
      setDbGuardrailsVerified(true);
    }
  } catch (err) {
    log(`[DB Guardrails] WARNING: Could not verify constraints: ${err}`);
    setDbGuardrailsVerified(false);
  }
}

async function scheduledIngestion() {
  log("[Ingestion Scheduler] Starting scheduled data ingestion...");
  
  try {
    const result = await runDataIngestion();
    log(`[Ingestion Scheduler] Complete: ${result.processed} processed, ${result.errors} errors, ${result.duration}ms`);
  } catch (error) {
    log(`[Ingestion Scheduler] Error during ingestion: ${error}`);
  }
}

function startIngestionScheduler() {
  if (SERVERLESS_MODE) {
    log("[Ingestion Scheduler] Skipped - serverless mode enabled. Use /api/cron/refresh-data instead.");
    return;
  }
  
  log(`[Ingestion Scheduler] Starting (absolute hourly scheduling at :02 past each hour)`);
  
  // Run initial ingestion after 30 second delay (let server fully initialize)
  setTimeout(() => {
    scheduledIngestion();
  }, 30000);
  
  // Schedule next run at :02 past the next hour, then repeat every hour
  // This ensures consistent timing regardless of when the server started
  function scheduleNextHourlyRun() {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setMinutes(2, 0, 0); // :02:00 past the hour
    if (nextHour <= now) {
      nextHour.setHours(nextHour.getHours() + 1);
    }
    const msUntilNext = nextHour.getTime() - now.getTime();
    log(`[Ingestion Scheduler] Next scheduled run at ${nextHour.toISOString()} (in ${Math.round(msUntilNext / 1000 / 60)} min)`);
    setTimeout(async () => {
      await scheduledIngestion();
      scheduleNextHourlyRun();
    }, msUntilNext);
  }
  
  scheduleNextHourlyRun();
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve attached assets (profile images, etc.)
app.use("/attached_assets", express.static(path.resolve(import.meta.dirname, "..", "attached_assets")));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    verifyDbConstraints();
    
    // Start hourly snapshot scheduler (captures data points for graphs)
    startSnapshotScheduler(60 * 60 * 1000);
    
    // Start data ingestion scheduler (fetches fresh API data every 8 hours)
    startIngestionScheduler();
  });
})();
