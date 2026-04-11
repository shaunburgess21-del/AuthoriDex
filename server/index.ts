import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { resolveAuthContextFromHeader, type AuthRequest } from "./auth-middleware";

import { log } from "./log";
import { serveStatic } from "./serve-static";
import { startSnapshotScheduler } from "./jobs/snapshot-scheduler";
import { runDataIngestion, hydrateTrendingPeopleFromSnapshots } from "./jobs/ingest";
import { startLiveTickScheduler, setLastFullRefreshAt, applySnapBackDampening } from "./jobs/live-tick";
import { startMarketResolverScheduler } from "./jobs/market-resolver";
import { runSeedBatch } from "./jobs/seed-engine";
import { startAgentRunnerScheduler } from "./agents/agentRunner";
import { startActionWorkerScheduler } from "./agents/actionWorker";
import { generateAllWeeklyMarkets, startMarketGeneratorScheduler } from "./jobs/market-generator";
import { resolveExpiredMarkets } from "./jobs/market-resolver";
import { startVoteWorkerScheduler } from "./agents/voteWorker";
import { pool, db, startDbPoolMonitor } from "./db";
import { setDbGuardrailsVerified } from "./guardrails";
import { fetchBatchGdeltNews } from "./providers/gdelt";
import { getCanaryNames } from "./scoring/canaryMonitor";
import { celebrityMetrics, approvalSnapshots } from "@shared/schema";

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

const CONSTRAINT_DDL: Record<string, string> = {
  chk_snapshot_origin_values:
    `ALTER TABLE trend_snapshots ADD CONSTRAINT chk_snapshot_origin_values CHECK (snapshot_origin IN ('ingest'))`,
  chk_ingest_hour_truncated:
    `ALTER TABLE trend_snapshots ADD CONSTRAINT chk_ingest_hour_truncated CHECK (timestamp = date_trunc('hour', timestamp))`,
};

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
      log(`[DB Guardrails] Missing constraints: ${missing.join(', ')} — attempting auto-create`);
      for (const name of missing) {
        const ddl = CONSTRAINT_DDL[name];
        if (!ddl) { log(`[DB Guardrails] No DDL for ${name}, skipping`); continue; }
        try {
          await pool.query(ddl);
          log(`[DB Guardrails] Created ${name}`);
        } catch (ddlErr: any) {
          if (ddlErr?.code === '23514') {
            log(`[DB Guardrails] Cannot add ${name} — existing rows violate it. Manual cleanup required.`);
          } else {
            log(`[DB Guardrails] Failed to create ${name}: ${ddlErr?.message ?? ddlErr}`);
          }
        }
      }

      const recheck = await pool.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'trend_snapshots'::regclass AND contype = 'c' AND conname = ANY($1)`,
        [REQUIRED_DB_CONSTRAINTS]
      );
      const nowFound = recheck.rows.map((r: any) => r.conname);
      const stillMissing = REQUIRED_DB_CONSTRAINTS.filter(c => !nowFound.includes(c));
      if (stillMissing.length > 0) {
        log(`[DB_GUARDRAIL_MISSING] Still missing after auto-create: ${stillMissing.join(', ')}. Data integrity is at risk!`);
        if (REQUIRE_DB_GUARDRAILS) {
          log(`[DB_GUARDRAIL_MISSING] REQUIRE_DB_GUARDRAILS=true — ingest writes are BLOCKED until constraints are restored.`);
        }
        setDbGuardrailsVerified(false);
      } else {
        log(`[DB Guardrails] All ${REQUIRED_DB_CONSTRAINTS.length} constraints now verified on trend_snapshots`);
        setDbGuardrailsVerified(true);
      }
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
          content: `**VoxDex Staleness ${level}**\nLatest snapshot is **${h}h ${m}m old**.\nIngestion may be stuck or failing. Latest: ${latest ?? "none"}`,
        }),
      }).catch((err) => log(`[Staleness Monitor] Discord webhook failed: ${err?.message ?? err}`));
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
  
  // Single source of ingestion: use EITHER this scheduler OR external cron (POST /api/cron/refresh-data), not both.
  // If both run, the second trigger will be locked_out or skipped (0s/0 snap) and gdelt/wiki cache may not refresh as often as expected.
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function runStartupTask(name: string, task: () => Promise<unknown>) {
  task().catch((error: unknown) => {
    process.stderr.write(`[STARTUP TASK ERROR] ${name}: ${formatError(error)}\n`);
  });
}

function startScheduler(name: string, start: () => void) {
  try {
    start();
  } catch (error: unknown) {
    process.stderr.write(`[SCHEDULER START ERROR] ${name}: ${formatError(error)}\n`);
  }
}

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Lightweight global auth resolution so rate limiters can key on userId.
// Only does work when a Bearer token is present; per-route requireAuth/optionalAuth
// still enforce access control on individual endpoints.
app.use("/api/", async (req: AuthRequest, _res, next) => {
  try {
    const auth = await resolveAuthContextFromHeader(req.headers.authorization);
    if (auth) {
      req.userId = auth.userId;
      req.userEmail = auth.userEmail;
      req.userRole = auth.userRole;
    }
  } catch { /* auth resolution is best-effort here */ }
  next();
});

const skipRateLimit = (req: Request) => {
  const p = req.path;
  return p === "/api/config/supabase" || p === "/api/health" || p.endsWith("/config/supabase");
};

const readLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.API_READ_RATE_LIMIT_MAX || "600", 10),
  keyGenerator: (req) => (req as AuthRequest).userId ?? req.ip ?? "unknown",
  skip: skipRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: (req) =>
    (req as AuthRequest).userId
      ? parseInt(process.env.API_WRITE_RATE_LIMIT_AUTH_MAX || "60", 10)
      : parseInt(process.env.API_WRITE_RATE_LIMIT_ANON_MAX || "15", 10),
  keyGenerator: (req) => (req as AuthRequest).userId ?? req.ip ?? "unknown",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.API_AUTH_RATE_LIMIT_MAX || "10", 10),
  keyGenerator: (req) => req.ip ?? "unknown",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again in a minute." },
});

app.use("/api/auth/", authLimiter);
app.use("/api/", (req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return readLimiter(req, res, next);
  }
  return writeLimiter(req, res, next);
});

// Serve attached assets (profile images, etc.)
app.use("/attached_assets", express.static(path.resolve(import.meta.dirname, "..", "attached_assets")));

// Serve public static files (logo downloads, etc.)
app.use(express.static(path.resolve(import.meta.dirname, "..", "public")));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

async function startServer() {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      return;
    }

    const status = err.status || err.statusCode || 500;
    const message = status >= 500 ? "Internal Server Error" : (err.message || "Request failed");

    process.stderr.write(`[ERROR] Request failed: ${err?.stack || err}\n`);
    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite");
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
    startDbPoolMonitor();

    runStartupTask("hydrate trending people", hydrateTrendingPeopleFromSnapshots);
    runStartupTask("verify database constraints", verifyDbConstraints);
    runStartupTask("weekly market reconcile", async () => {
      const generation = await generateAllWeeklyMarkets();
      await resolveExpiredMarkets();
      log(`[Startup] Weekly market reconcile complete for week ${generation.weekNumber}`);
    });

    const schedulersDisabled = process.env.DISABLE_SCHEDULERS === "true";
    if (schedulersDisabled) {
      log("[Schedulers] DISABLE_SCHEDULERS=true — skipping all background schedulers (Ingestion, LiveTick, Seed Engine, MarketResolver, MarketGenerator, VoteWorker, Staleness Monitor, Snapshot).");
      return;
    }
    
    // Start hourly snapshot scheduler (captures data points for graphs)
    startScheduler("Snapshot", () => startSnapshotScheduler(60 * 60 * 1000));
    
    // Start data ingestion scheduler (fetches fresh API data every 8 hours)
    startScheduler("Ingestion", startIngestionScheduler);

    // Start live tick scheduler (re-ranks every 10 min using internal signals)
    if (!SERVERLESS_MODE) {
      startScheduler("LiveTick", startLiveTickScheduler);
    }

    startScheduler("Seed Engine", startSeedEngineScheduler);

    // Start market auto-resolver (resolves expired prediction markets every 5 min)
    if (!SERVERLESS_MODE) {
      startScheduler("MarketResolver", startMarketResolverScheduler);
    }

    // Start staleness monitor (alerts when snapshots are >2h old)
    startScheduler("Staleness Monitor", startStalenessMonitor);

    // Start weekly market generation (updown, jackpot, h2h, gainer)
    // In serverless, prefer external CRON (/api/cron/generate-weekly-markets).
    if (!SERVERLESS_MODE) {
      startScheduler("MarketGenerator", startMarketGeneratorScheduler);
    } else {
      log("[MarketGenerator] Skipped - serverless mode enabled. Use /api/cron/generate-weekly-markets.");
    }

    // Start AI agent prediction system
    startScheduler("AgentRunner", startAgentRunnerScheduler);
    startScheduler("ActionWorker", startActionWorkerScheduler);

    // Start agent voting system (daily sweep, max 3 votes/agent/week)
    startScheduler("VoteWorker", startVoteWorkerScheduler);

    // Start approval snapshot scheduler (captures approval metrics every 6 hours for pulse chart)
    startScheduler("ApprovalSnapshots", startApprovalSnapshotScheduler);
  });
}

const APPROVAL_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function captureApprovalSnapshots(): Promise<void> {
  try {
    const metrics = await db
      .select({
        celebrityId: celebrityMetrics.celebrityId,
        approvalAvgRating: celebrityMetrics.approvalAvgRating,
        approvalVotesCount: celebrityMetrics.approvalVotesCount,
        approvalPct: celebrityMetrics.approvalPct,
      })
      .from(celebrityMetrics);

    if (metrics.length === 0) {
      log("[ApprovalSnapshots] No celebrity metrics found, skipping.");
      return;
    }

    const now = new Date();
    const rows = metrics.map((m) => ({
      personId: m.celebrityId,
      timestamp: now,
      approvalAvgRating: m.approvalAvgRating,
      approvalVotesCount: m.approvalVotesCount ?? 0,
      approvalPct: m.approvalPct,
    }));

    await db.insert(approvalSnapshots).values(rows);
    log(`[ApprovalSnapshots] Captured ${rows.length} snapshots at ${now.toISOString()}`);
  } catch (err: any) {
    log(`[ApprovalSnapshots] Error: ${err?.message ?? err}`);
  }
}

function startApprovalSnapshotScheduler() {
  if (SERVERLESS_MODE) {
    log("[ApprovalSnapshots] Skipped - serverless mode.");
    return;
  }
  log("[ApprovalSnapshots] Starting (every 6 hours)");
  setTimeout(() => {
    captureApprovalSnapshots();
    setInterval(captureApprovalSnapshots, APPROVAL_SNAPSHOT_INTERVAL_MS);
  }, 30_000);
}

startServer().catch((error) => {
  process.stderr.write(`[BOOT] Failed to start server: ${error?.stack || error}\n`);
  process.exit(1);
});
