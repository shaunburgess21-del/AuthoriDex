import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startSnapshotScheduler } from "./jobs/snapshot-scheduler";
import { runDataIngestion, hydrateTrendingPeopleFromSnapshots } from "./jobs/ingest";
import { startLiveTickScheduler, setLastFullRefreshAt, applySnapBackDampening } from "./jobs/live-tick";
import { startMarketResolverScheduler } from "./jobs/market-resolver";
import { runSeedBatch } from "./jobs/seed-engine";
import { pool } from "./db";
import { setDbGuardrailsVerified } from "./guardrails";
import { fetchBatchGdeltNews } from "./providers/gdelt";
import { getCanaryNames } from "./scoring/canaryMonitor";

console.log(`[BOOT] started at ${new Date().toISOString()} (env=${process.env.NODE_ENV || "unknown"})`);

// ===========================================
// GLOBAL ERROR HANDLERS
// ===========================================
process.on("uncaughtException", (err) => {
  process.stderr.write(`[FATAL] Uncaught exception: ${err?.stack || err}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[FATAL] Unhandled promise rejection: ${reason}\n`);
  process.exit(1);
});
process.on("exit", (code) => {
  process.stderr.write(`[EXIT] Process exiting with code ${code}\n`);
});
process.on("SIGTERM", () => {
  process.stderr.write("[SIGNAL] Received SIGTERM - shutting down\n");
  process.exit(0);
});
process.on("SIGINT", () => {
  process.stderr.write("[SIGNAL] Received SIGINT - interrupted\n");
  process.exit(0);
});
process.on("SIGHUP", () => {
  process.stderr.write("[SIGNAL] Received SIGHUP - ignoring (kept alive)\n");
});

// Catch pg pool errors to prevent uncaught 'error' event crashes
pool.on("error", (err) => {
  process.stderr.write(`[FATAL] pg pool error: ${err?.message || err}\n`);
});

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

// ─── BACKFILL: Gap detection and fill ────────────────────────────────────────
// After each successful hourly run, check for missing hour slots in the last
// 12 hours and fill up to 3 of the oldest gaps. Uses the same cached data as
// a normal run — the goal is to have a reference point for delta calculations,
// not perfect historical accuracy. Backfilled snapshots are tagged isBackfill=true.
const BACKFILL_MAX_SLOTS = 3;
const BACKFILL_LOOKBACK_HOURS = 12;

async function warmGdeltCanaryCache(): Promise<void> {
  try {
    const names = getCanaryNames();
    const people = names.map(name => ({ id: name, name }));
    log(`[GDELT Warm] Refreshing GDELT cache for ${people.length} canaries...`);
    await fetchBatchGdeltNews(people, { timeBudgetMs: 30_000 });
    log(`[GDELT Warm] Canary cache refreshed`);
  } catch (err) {
    log(`[GDELT Warm] Error warming canary cache: ${err}`);
  }
}

async function detectAndBackfillGaps(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - BACKFILL_LOOKBACK_HOURS * 60 * 60 * 1000);
    const currentHourBucket = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
      new Date().getUTCHours(),
      0, 0, 0
    ));

    // Find hour buckets in the last 12h that have no snapshots AND no completed ingestion run
    const result = await pool.query(`
      WITH hour_series AS (
        SELECT generate_series(
          date_trunc('hour', $1::timestamptz),
          date_trunc('hour', NOW() - INTERVAL '1 hour'),
          '1 hour'::interval
        ) AS hour_bucket
      ),
      covered_by_snapshot AS (
        SELECT DISTINCT date_trunc('hour', timestamp) AS hour_bucket
        FROM trend_snapshots
        WHERE timestamp >= $1
      ),
      covered_by_run AS (
        SELECT date_trunc('hour', hour_bucket) AS hour_bucket
        FROM ingestion_runs
        WHERE status IN ('completed')
          AND hour_bucket >= $1
      )
      SELECT h.hour_bucket
      FROM hour_series h
      LEFT JOIN covered_by_snapshot s ON s.hour_bucket = h.hour_bucket
      LEFT JOIN covered_by_run r ON r.hour_bucket = h.hour_bucket
      WHERE s.hour_bucket IS NULL AND r.hour_bucket IS NULL
      ORDER BY h.hour_bucket ASC
      LIMIT $2
    `, [cutoff, BACKFILL_MAX_SLOTS]);

    const gaps: Date[] = result.rows.map((r: any) => new Date(r.hour_bucket));

    if (gaps.length === 0) {
      log(`[Backfill] No gaps found in last ${BACKFILL_LOOKBACK_HOURS}h`);
      return;
    }

    log(`[Backfill] Found ${gaps.length} gap(s) in last ${BACKFILL_LOOKBACK_HOURS}h — filling sequentially`);

    const minutesUntilNextPrimary = (): number => {
      const n = new Date();
      const next = new Date(n);
      next.setMinutes(2, 0, 0);
      if (next <= n) next.setHours(next.getHours() + 1);
      return Math.round((next.getTime() - n.getTime()) / (1000 * 60));
    };

    let filled = 0;
    for (const targetHour of gaps) {
      const minsLeft = minutesUntilNextPrimary();
      if (minsLeft < 15) {
        log(`[Backfill] Stopping — primary run in ${minsLeft}m, skipping remaining gaps`);
        break;
      }
      try {
        log(`[Backfill] Filling ${targetHour.toISOString()}...`);
        const result = await runDataIngestion({ targetHour, isBackfill: true });
        if (!result.lockedOut && result.processed > 0) {
          filled++;
          log(`[Backfill] Filled ${targetHour.toISOString()} (${result.processed} snapshots, ${result.duration}ms)`);
        } else if (result.lockedOut) {
          log(`[Backfill] Skipped ${targetHour.toISOString()} — locked out by another run`);
          break;
        }
      } catch (err) {
        log(`[Backfill] Error filling ${targetHour.toISOString()}: ${err}`);
      }
    }

    log(`[Backfill] Done — filled ${filled}/${gaps.length} gap(s)`);
  } catch (err) {
    log(`[Backfill] Gap detection error: ${err}`);
  }
}

// ─── STALENESS MONITOR ────────────────────────────────────────────────────────
// Runs every 30 minutes. Logs alerts when the latest snapshot is older than
// expected. Exposes state via getStalenessState() for the health endpoint.
// Optionally posts to Discord if DISCORD_WEBHOOK_URL is set.
const STALENESS_WARN_MINUTES = 120;  // 2 hours
const STALENESS_CRIT_MINUTES = 240;  // 4 hours
const STALENESS_CHECK_INTERVAL_MS = 30 * 60 * 1000;

interface StalenessState {
  ageMinutes: number | null;
  isStale: boolean;
  isCritical: boolean;
  latestSnapshotAt: string | null;
  checkedAt: string;
}

let _stalenessState: StalenessState = {
  ageMinutes: null,
  isStale: false,
  isCritical: false,
  latestSnapshotAt: null,
  checkedAt: new Date().toISOString(),
};

export function getStalenessState(): StalenessState {
  return _stalenessState;
}

async function checkStaleness(): Promise<void> {
  try {
    const result = await pool.query(`SELECT MAX(timestamp) as latest FROM trend_snapshots`);
    const latest: string | null = result.rows[0]?.latest ?? null;
    const now = new Date();
    const ageMinutes = latest
      ? Math.round((now.getTime() - new Date(latest).getTime()) / (1000 * 60))
      : null;

    const isStale = ageMinutes !== null && ageMinutes >= STALENESS_WARN_MINUTES;
    const isCritical = ageMinutes !== null && ageMinutes >= STALENESS_CRIT_MINUTES;

    _stalenessState = {
      ageMinutes,
      isStale,
      isCritical,
      latestSnapshotAt: latest ? new Date(latest).toISOString() : null,
      checkedAt: now.toISOString(),
    };

    if (isCritical) {
      const h = Math.floor((ageMinutes ?? 0) / 60);
      const m = (ageMinutes ?? 0) % 60;
      log(`[STALENESS CRITICAL] Latest snapshot is ${h}h ${m}m old — ingestion may be stuck`);
    } else if (isStale) {
      const h = Math.floor((ageMinutes ?? 0) / 60);
      const m = (ageMinutes ?? 0) % 60;
      log(`[STALENESS ALERT] Latest snapshot is ${h}h ${m}m old — ingestion may be delayed`);
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl && isStale && ageMinutes !== null) {
      const level = isCritical ? "🔴 CRITICAL" : "🟡 WARNING";
      const h = Math.floor(ageMinutes / 60);
      const m = ageMinutes % 60;
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `**AuthoriDex Staleness ${level}**\nLatest snapshot is **${h}h ${m}m old**.\nIngestion may be stuck or failing. Latest: ${latest ?? "none"}`,
        }),
      }).catch(() => {});
    }
  } catch (err) {
    log(`[Staleness Monitor] Check failed: ${err}`);
  }
}

function startStalenessMonitor() {
  if (SERVERLESS_MODE) return;
  log("[Staleness Monitor] Starting (checks every 30 min)");
  setTimeout(() => {
    checkStaleness();
    setInterval(checkStaleness, STALENESS_CHECK_INTERVAL_MS);
  }, 5 * 60 * 1000);
}

// ─── SCHEDULED INGESTION ──────────────────────────────────────────────────────
async function scheduledIngestion() {
  log("[Ingestion Scheduler] Starting scheduled data ingestion...");
  
  try {
    const result = await runDataIngestion();
    log(`[Ingestion Scheduler] Complete: ${result.processed} processed, ${result.errors} errors, ${result.duration}ms`);
    setLastFullRefreshAt(new Date());
    applySnapBackDampening().catch(e => log(`[Ingestion Scheduler] Dampening error: ${e}`));
    // After a successful primary run, automatically fill any gaps in the last 12h
    detectAndBackfillGaps().catch(e => log(`[Backfill] Unexpected error: ${e}`));
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

function startSeedEngineScheduler() {
  if (SERVERLESS_MODE) return;
  log("[Seed Engine] Starting scheduler (hourly at :30 past each hour, Mon-Tue only)");

  function scheduleNextSeedRun() {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(30, 0, 0);
    if (next <= now) next.setHours(next.getHours() + 1);
    const ms = next.getTime() - now.getTime();
    log(`[Seed Engine] Next run at ${next.toISOString()} (in ${Math.round(ms / 1000 / 60)} min)`);
    setTimeout(async () => {
      try {
        const result = await runSeedBatch();
        if (result.processed > 0) {
          log(`[Seed Engine] Batch complete: ${result.processed} markets seeded, ${result.totalCreditsDistributed} credits distributed`);
        }
      } catch (e) {
        log(`[Seed Engine] Error: ${e}`);
      }
      scheduleNextSeedRun();
    }, ms);
  }

  scheduleNextSeedRun();
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve attached assets (profile images, etc.)
app.use("/attached_assets", express.static(path.resolve(import.meta.dirname, "..", "attached_assets")));

// Serve public static files (logo downloads, etc.)
app.use(express.static(path.resolve(import.meta.dirname, "..", "public")));

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
  const host = process.env.HOST || "0.0.0.0";

  console.log(`[Server] Binding to host=${host}, port=${port}`);

  server.listen({
    port,
    host,
  }, () => {
    log(`serving on port ${port}`);
    
    hydrateTrendingPeopleFromSnapshots().catch(e => 
      console.error("[Boot] Hydration error:", e)
    );
    
    verifyDbConstraints();

    const schedulersDisabled = process.env.DISABLE_SCHEDULERS === "true";
    if (schedulersDisabled) {
      log("[Schedulers] DISABLE_SCHEDULERS=true — skipping all background schedulers (Ingestion, LiveTick, Seed Engine, MarketResolver, Staleness Monitor, Snapshot).");
      return;
    }
    
    // Start hourly snapshot scheduler (captures data points for graphs)
    startSnapshotScheduler(60 * 60 * 1000);
    
    // Start data ingestion scheduler (fetches fresh API data every 8 hours)
    startIngestionScheduler();

    // Start live tick scheduler (re-ranks every 10 min using internal signals)
    if (!SERVERLESS_MODE) {
      startLiveTickScheduler();
    }

    startSeedEngineScheduler();

    // Start market auto-resolver (resolves expired prediction markets every 5 min)
    if (!SERVERLESS_MODE) {
      startMarketResolverScheduler();
    }

    // Start staleness monitor (alerts when snapshots are >2h old)
    startStalenessMonitor();
  });
})();
