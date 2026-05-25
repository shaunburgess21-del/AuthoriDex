import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { registerRoutes } from "./routes";
import { resolveAuthContextFromHeader, type AuthRequest } from "./auth-middleware";
import { anonIdentityMiddleware } from "./middleware/anonIdentityMiddleware";

import { log, logger, requestIdMiddleware } from "./log";
import { initSentry, sentryErrorHandler, captureBackgroundError } from "./sentry";
import { serveStatic } from "./serve-static";
import { runDataIngestion, hydrateTrendingPeopleFromSnapshots } from "./jobs/ingest";
import { startLiveTickScheduler, setLastFullRefreshAt, applySnapBackDampening } from "./jobs/live-tick";
import { startNotificationsDerivationScheduler } from "./jobs/notifications-derivation";
import { startMarketResolverScheduler } from "./jobs/market-resolver";
import { startAmmPriceSamplerScheduler } from "./jobs/amm-price-sampler";
import { startAgentRunnerScheduler } from "./agents/agentRunner";
import { startActionWorkerScheduler } from "./agents/actionWorker";
import { generateAllWeeklyMarkets, startMarketGeneratorScheduler } from "./jobs/market-generator";
import { resolveExpiredMarkets } from "./jobs/market-resolver";
import { startVoteWorkerScheduler } from "./agents/voteWorker";
import { startCommentWorkerScheduler } from "./agents/commentWorker";
import { startCommentVoteWorkerScheduler } from "./agents/commentVoteWorker";
import { pool, db, startDbPoolMonitor } from "./db";
import { setDbGuardrailsVerified } from "./guardrails";
import { fetchBatchGdeltNews } from "./providers/gdelt";
import { getCanaryNames } from "./scoring/canaryMonitor";
import { celebrityMetrics, approvalSnapshots } from "@shared/schema";

console.log(`[BOOT] started at ${new Date().toISOString()} (env=${process.env.NODE_ENV || "unknown"})`);

// Initialize Sentry as early as possible so any boot-time errors are captured.
// No-op when SENTRY_DSN isn't set.
initSentry();

// ===========================================
// GLOBAL ERROR HANDLERS
// ===========================================
process.on("uncaughtException", (err) => {
  // Uncaught sync exceptions leave the process in an indeterminate state —
  // exit so the supervisor (Railway) can restart us cleanly.
  captureBackgroundError(err, { kind: "uncaughtException" });
  process.stderr.write(`[FATAL] Uncaught exception: ${err?.stack || err}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  // Unhandled promise rejections are usually isolated (one bad await) and
  // exiting on them has repeatedly caused a crash loop when a single
  // background job misbehaved. In production we just log loudly; in dev/test
  // we keep the old exit-on-reject behavior so bad code is noticed during
  // development. Set STRICT_UNHANDLED_REJECTION=true to force exit in prod.
  captureBackgroundError(reason, { kind: "unhandledRejection" });
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  process.stderr.write(`[FATAL] Unhandled promise rejection: ${msg}\n`);
  const forceExit = (process.env.STRICT_UNHANDLED_REJECTION ?? "false").trim().toLowerCase() === "true";
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd || forceExit) {
    process.exit(1);
  }
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
    // Only record "last full refresh" when real work happened — not on skip
    // (already ingested this hour) or lock-out (another worker has it).
    // Otherwise downstream freshness checks can wrongly conclude the stack is
    // up-to-date when the last hour actually did nothing.
    const didRealWork = result.processed > 0 && !(result as any).skipped && !(result as any).lockedOut;
    if (didRealWork) {
      setLastFullRefreshAt(new Date());
      applySnapBackDampening().catch(e => log(`[Ingestion Scheduler] Dampening error: ${e}`));
      // After a successful primary run, automatically fill any gaps in the last 12h
      detectAndBackfillGaps().catch(e => log(`[Backfill] Unexpected error: ${e}`));
    } else if ((result as any).skipped) {
      log(`[Ingestion Scheduler] Skipped: ${(result as any).skippedReason ?? "unknown"} — not bumping last-refresh timestamp.`);
    } else if ((result as any).lockedOut) {
      log(`[Ingestion Scheduler] Locked out by another worker — not bumping last-refresh timestamp.`);
    }
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

  // Cadence is env-driven so we can react faster to breaking news without a
  // redeploy. Valid divisors of 60: 60 (hourly, default), 30, 20, 15, 10, 5.
  const rawInterval = parseInt(process.env.INGEST_INTERVAL_MINUTES ?? "60", 10);
  const ALLOWED_INTERVALS = [5, 10, 15, 20, 30, 60];
  const intervalMinutes = ALLOWED_INTERVALS.includes(rawInterval) ? rawInterval : 60;
  if (intervalMinutes !== rawInterval) {
    log(`[Ingestion Scheduler] INGEST_INTERVAL_MINUTES=${rawInterval} is not one of ${ALLOWED_INTERVALS.join(",")}; falling back to 60`);
  }
  // Keep the original :02 offset so snapshots stay aligned to hour boundaries.
  const OFFSET_MINUTES = 2;

  log(`[Ingestion Scheduler] Starting (every ${intervalMinutes} min, first tick at :${String(OFFSET_MINUTES).padStart(2, "0")} past each ${intervalMinutes === 60 ? "hour" : `${intervalMinutes}-min boundary`})`);

  // Run initial ingestion after 30 second delay (let server fully initialize)
  setTimeout(() => {
    scheduledIngestion();
  }, 30000);

  // Schedule next run at the next interval boundary, then repeat at the
  // configured cadence. The absolute scheduling keeps ticks aligned to the
  // clock (e.g. :02, :32) regardless of when the server started.
  function scheduleNextRun() {
    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);
    const minuteOfHour = next.getMinutes();
    // Find the next minute-offset that satisfies: ((m - OFFSET) % interval) === 0
    // and is strictly in the future.
    const normalizedNow = ((minuteOfHour - OFFSET_MINUTES) % intervalMinutes + intervalMinutes) % intervalMinutes;
    let addMinutes = intervalMinutes - normalizedNow;
    if (addMinutes === 0) addMinutes = intervalMinutes;
    next.setMinutes(minuteOfHour + addMinutes);
    const msUntilNext = Math.max(next.getTime() - now.getTime(), 1000);
    log(`[Ingestion Scheduler] Next scheduled run at ${next.toISOString()} (in ${Math.round(msUntilNext / 1000 / 60)} min)`);
    setTimeout(async () => {
      await scheduledIngestion();
      scheduleNextRun();
    }, msUntilNext);
  }

  scheduleNextRun();
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

// Attach a per-request `x-request-id` and child logger (`req.log`) BEFORE any
// other middleware so even helmet/json-parsing errors can be correlated by ID.
app.use(requestIdMiddleware);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Global body parsers — SKIP for webhook endpoints that need raw bytes.
// The /api/auth/email-hook route verifies a signature over the raw request
// body, so it installs its own express.raw() middleware. If we let
// express.json() run first, the signature check would fail because the
// body would already be parsed into an object.
//
// To add another raw-body webhook in the future, extend the skipList below.
const rawBodyRoutes = ["/api/auth/email-hook"];
const skipIfRawBody = (parser: express.RequestHandler): express.RequestHandler =>
  (req, res, next) =>
    rawBodyRoutes.includes(req.path) ? next() : parser(req, res, next);

app.use(skipIfRawBody(express.json()));
app.use(skipIfRawBody(express.urlencoded({ extended: false })));

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

// Phase 4 — ensure every /api/* request carries an fdx_sid cookie so
// optionalAuth + the anonymous-vote budget can rely on it without
// minting on demand. See server/lib/anonIdentity.ts for rationale.
app.use("/api/", anonIdentityMiddleware);

const skipRateLimit = (req: Request) => {
  const p = req.path;
  return p === "/api/config/supabase" || p === "/api/health" || p.endsWith("/config/supabase");
};

/** IPv6-safe IP key for express-rate-limit (see ERR_ERL_KEY_GEN_IPV6). */
function rateLimitKeyForRequest(req: Request): string {
  const userId = (req as AuthRequest).userId;
  if (userId) return userId;
  const ip = req.ip;
  if (!ip) return "unknown";
  return ipKeyGenerator(ip);
}

function rateLimitKeyIpOnly(req: Request): string {
  const ip = req.ip;
  if (!ip) return "unknown";
  return ipKeyGenerator(ip);
}

const readLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.API_READ_RATE_LIMIT_MAX || "600", 10),
  keyGenerator: rateLimitKeyForRequest,
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
  keyGenerator: rateLimitKeyForRequest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.API_AUTH_RATE_LIMIT_MAX || "10", 10),
  keyGenerator: rateLimitKeyIpOnly,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again in a minute." },
});

// Admin endpoints often involve bulk operations (refreshing stats, running
// audits, triggering backfills) that legitimately hit dozens of requests in a
// short window. The default write limiter (60/min for authenticated users)
// triggers on the admin UI during normal use, so admin calls go through their
// own higher bucket keyed by userId.
const adminLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.API_ADMIN_RATE_LIMIT_MAX || "300", 10),
  keyGenerator: rateLimitKeyForRequest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many admin requests, please slow down." },
});

app.use("/api/auth/", authLimiter);
// Admin routes get their own bucket before the generic /api/ read/write split.
// The requireAdmin middleware on each endpoint still enforces authz — this is
// purely a throughput ceiling.
app.use("/api/admin/", adminLimiter);
app.use("/api/", (req, res, next) => {
  // Skip the generic read/write bucket for /api/admin/* so admin requests only
  // count against the adminLimiter bucket above.
  if (req.path.startsWith("/admin/")) {
    return next();
  }
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

  // Sentry first — so it sees the raw error before our JSON responder swallows
  // it into a 500. No-op when SENTRY_DSN isn't configured.
  app.use(sentryErrorHandler);

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      return;
    }

    const status = err.status || err.statusCode || 500;
    const message = status >= 500 ? "Internal Server Error" : (err.message || "Request failed");

    const reqLog = (req as Request & { log?: typeof logger }).log ?? logger;
    reqLog.error({ err, path: req.path, method: req.method, status }, "Request failed");
    res.status(status).json({ message, requestId: req.id });
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
    runStartupTask("warm AMM settings cache", async () => {
      const { initAmmSettings, getAmmCooldownMs } = await import("./native-markets/amm-settings");
      await initAmmSettings();
      log(`[Startup] AMM pre-resolve cooldown = ${Math.round(getAmmCooldownMs() / 1000)}s`);
    });
    runStartupTask("weekly market reconcile", async () => {
      const generation = await generateAllWeeklyMarkets();
      await resolveExpiredMarkets();
      log(`[Startup] Weekly market reconcile complete for week ${generation.weekNumber}`);
    });

    // ─── Ingest mode announcement ─────────────────────────────────────────
    // The app supports two mutually-exclusive ingest modes:
    //   (a) In-process schedulers — this Node process runs Ingestion /
    //       LiveTick / MarketResolver / etc. itself (DEFAULT).
    //   (b) External cron — a platform scheduler (Railway cron, Vercel cron,
    //       GitHub Actions) hits /api/cron/* with CRON_SECRET. In that case,
    //       DISABLE_SCHEDULERS=true must be set so the in-process timers
    //       don't race with the external ones and spam `locked_out`
    //       ingestion_runs rows.
    //
    // If BOTH appear to be configured (CRON_SECRET present AND
    // DISABLE_SCHEDULERS not set) we warn loudly on boot — the configuration
    // still works, but the dual-trigger risk is real.
    const schedulersDisabled = process.env.DISABLE_SCHEDULERS === "true";
    const cronSecretConfigured = !!(process.env.CRON_SECRET && process.env.CRON_SECRET.trim().length > 0);

    if (schedulersDisabled && !cronSecretConfigured) {
      log("[Schedulers] FATAL MISCONFIG — DISABLE_SCHEDULERS=true but no CRON_SECRET is set. Nothing will drive ingestion. Either unset DISABLE_SCHEDULERS or configure CRON_SECRET + external cron.");
      return;
    } else if (schedulersDisabled) {
      log("[Schedulers] Mode: EXTERNAL CRON. DISABLE_SCHEDULERS=true — skipping all background schedulers. Ingestion, LiveTick, etc. must be triggered via POST /api/cron/* with CRON_SECRET.");
      return;
    } else if (cronSecretConfigured) {
      log("[Schedulers] Mode: IN-PROCESS (with CRON_SECRET also configured). Warning — if you have an external cron hitting /api/cron/*, you will get duplicate runs and `locked_out` ingestion_runs rows. Set DISABLE_SCHEDULERS=true to hand control to external cron.");
    } else {
      log("[Schedulers] Mode: IN-PROCESS. Background schedulers are running inside this Node process.");
    }

    // NOTE: The standalone snapshot scheduler was removed — ingest.ts is now the
    // single writer for trend_snapshots. Historically there was a second hourly
    // job ("startSnapshotScheduler") that wrote snapshots independently, but it
    // caused duplicate/conflicting data points (jagged graphs) and was reduced
    // to a no-op log line long before being deleted.

    // Start data ingestion scheduler (fetches fresh API data every 8 hours)
    startScheduler("Ingestion", startIngestionScheduler);

    // Start live tick scheduler (re-ranks every 10 min using internal signals)
    if (!SERVERLESS_MODE) {
      startScheduler("LiveTick", startLiveTickScheduler);
    }

    // Notifications derivation: rank crossings, hot movers, market_closing_soon,
    // streak milestones, low-credit reminders. Runs alongside LiveTick at the
    // same 10-min cadence; advisory-locked so multiple processes are safe.
    if (!SERVERLESS_MODE) {
      startScheduler("NotificationsDerivation", startNotificationsDerivationScheduler);
    }

    // Start AMM price sampler (records LMSR price snapshots every 5 min
    // on open AMM markets so the price-history chart stays smooth even
    // on quiet markets). Trades themselves also write snapshots inline.
    if (!SERVERLESS_MODE) {
      startScheduler("AmmPriceSampler", startAmmPriceSamplerScheduler);
    }

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

    // Refresh agent simulation profiles on startup so cap/persona tuning
    // changes in agentSeeder.ts apply automatically without requiring an
    // admin to manually click "Refresh simulation profiles". Idempotent —
    // skips rows where the stored profile already matches the seeder.
    // Best-effort: never block boot if it fails.
    void (async () => {
      try {
        const { refreshAgentSimulationProfiles } = await import("./agents/agentSeeder");
        const result = await refreshAgentSimulationProfiles();
        log(`[BOOT] Agent simulation profiles: ${result.refreshed} refreshed, ${result.unchanged} unchanged${result.missingSeed.length ? `, ${result.missingSeed.length} missing seed` : ""}`);
      } catch (err) {
        log(`[BOOT] Agent simulation profile refresh failed (non-fatal): ${err instanceof Error ? err.message : err}`);
      }
    })();

    startScheduler("AgentRunner", startAgentRunnerScheduler);
    startScheduler("ActionWorker", startActionWorkerScheduler);

    // Start agent voting system (daily sweep, max 3 votes/agent/week)
    startScheduler("VoteWorker", startVoteWorkerScheduler);
    startScheduler("CommentWorker", startCommentWorkerScheduler);
    startScheduler("CommentVoteWorker", startCommentVoteWorkerScheduler);

    // Start approval snapshot scheduler (captures approval metrics every 6 hours for pulse chart)
    startScheduler("ApprovalSnapshots", startApprovalSnapshotScheduler);

    // Start AMM operational health check (read-only audit every 15 min:
    // orphan ledger rows, seed-return drift, stuck CLOSED_PENDING markets,
    // negative credits, dup idempotency keys, agent pause state). Logs a
    // single summary line per run; fails are emitted at WARN level so
    // log-based alerts can fire without parsing JSON.
    if (!SERVERLESS_MODE) {
      startScheduler("AmmHealthCheck", startAmmHealthCheckScheduler);
    } else {
      log("[AmmHealthCheck] Skipped - serverless mode. Use POST /api/cron/amm-health-check.");
    }

    // Start drain breaker (auto-pause agents on excessive 24h house
    // loss). Independent of AmmHealthCheck because the breaker has a
    // mutation side-effect; we want it on its own cadence + log line.
    if (!SERVERLESS_MODE) {
      startScheduler("DrainBreaker", startDrainBreakerScheduler);
    } else {
      log("[DrainBreaker] Skipped - serverless mode. Use POST /api/cron/drain-breaker-check.");
    }

    // Start account-deletion sweeper (finalises overdue user-
    // requested deletions). Runs hourly; the 7-day window means
    // a missed tick has plenty of grace before any user-visible
    // issue surfaces.
    if (!SERVERLESS_MODE) {
      startScheduler("AccountDeletionSweeper", startAccountDeletionSweeperScheduler);
    } else {
      log("[AccountDeletionSweeper] Skipped - serverless mode. Use POST /api/cron/process-account-deletions.");
    }

    // Celebrity profile (About section) bio regeneration. Daily sweep:
    // only profiles past their 30-day TTL, on a stale prompt version,
    // or missing source_hash are regenerated. The HTTP endpoint also
    // services this on a stale-while-revalidate path; the cron exists
    // to warm cold long-tail profiles users haven't visited recently.
    if (!SERVERLESS_MODE) {
      startScheduler("CelebrityProfileRefresh", startCelebrityProfileRefreshScheduler);
    } else {
      log("[CelebrityProfileRefresh] Skipped - serverless mode. Use POST /api/cron/refresh-celebrity-profiles.");
    }

    // Net worth refresh (independent of the OpenAI bio regen above).
    // Standard cohort = weekly; high-volatility cohort (business / tech /
    // finance) = every 6h. We run both timers here; each one filters
    // candidates by netWorthUpdatedAt internally so they're cheap no-ops
    // when nothing is due.
    if (!SERVERLESS_MODE) {
      startScheduler("NetWorthRefresh", startNetWorthRefreshScheduler);
    } else {
      log("[NetWorthRefresh] Skipped - serverless mode. Use POST /api/cron/refresh-net-worth.");
    }

    // Why-Trending warmer for top-20 + hot movers. Cadence matches the
    // 4h cache TTL so caches stay fresh without users paying the cold-
    // path OpenAI latency.
    if (!SERVERLESS_MODE) {
      startScheduler("WhyTrendingRefresh", startWhyTrendingRefreshScheduler);
    } else {
      log("[WhyTrendingRefresh] Skipped - serverless mode. Use POST /api/cron/refresh-why-trending.");
    }
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

// Every 15 minutes — frequent enough to surface a freshly-introduced
// regression within one cycle, infrequent enough that the audit's six
// SQL queries don't add meaningful load. Mirrors the recommended Railway
// cron cadence in ops/AMM_MONITORING_RUNBOOK.md.
const AMM_HEALTH_CHECK_INTERVAL_MS = 15 * 60 * 1000;

async function runScheduledAmmHealthCheck(): Promise<void> {
  try {
    const { runAndPersistAmmHealthCheck } = await import("./jobs/amm-health");
    // Persists into amm_health_check_runs so the admin Operations sub-tab
    // can render the 24h trend strip without re-running the audit on every
    // page load. Persist failures are swallowed inside the wrapper.
    const result = await runAndPersistAmmHealthCheck({ source: "scheduler" });

    // Match the log-line shape used by POST /api/cron/amm-health-check so a
    // single saved-search filter (`[AmmHealthCheck] FAIL`) catches both the
    // in-process scheduler AND any future external cron invocation.
    if (!result.ok) {
      const failedNames = result.checks.filter((c) => c.status === "fail").map((c) => c.name);
      log(`[AmmHealthCheck] FAIL — ${result.failed} failed check(s): ${failedNames.join(", ")}`);
    } else if (result.warned > 0) {
      const warnedNames = result.checks.filter((c) => c.status === "warn").map((c) => c.name);
      log(`[AmmHealthCheck] PASS with ${result.warned} warning(s): ${warnedNames.join(", ")}`);
    } else {
      log(`[AmmHealthCheck] PASS — all ${result.total} checks clean (${result.durationMs}ms)`);
    }
  } catch (err: any) {
    // Never let a scheduler tick crash the parent process. The next tick
    // will retry. If the audit itself is broken (e.g. DB unreachable) the
    // upstream error will fire its own alert via the regular Pool error path.
    log(`[AmmHealthCheck] Scheduler tick failed (will retry next interval): ${err?.message ?? err}`);
  }
}

function startAmmHealthCheckScheduler() {
  if (SERVERLESS_MODE) {
    log("[AmmHealthCheck] Skipped - serverless mode.");
    return;
  }
  log("[AmmHealthCheck] Starting (every 15 min)");
  // Stagger initial run by 60s so the audit doesn't pile onto boot-time
  // DB load alongside Ingestion / MarketGenerator / AgentRunner all firing
  // their first ticks in the same window.
  setTimeout(() => {
    void runScheduledAmmHealthCheck();
    setInterval(() => void runScheduledAmmHealthCheck(), AMM_HEALTH_CHECK_INTERVAL_MS);
  }, 60_000);
}

// Drain breaker cadence. 15 minutes matches the AMM-health audit;
// the breaker query (one SUM over 24h credit_ledger rows + one
// singleton SELECT) is fast and the table is well-indexed after
// migration 0064. Faster cadence would be marginal because the 24h
// window itself is the dominant smoothing factor.
const DRAIN_BREAKER_INTERVAL_MS = 15 * 60 * 1000;

async function runScheduledDrainBreaker(): Promise<void> {
  try {
    const { checkAndTripDrainBreaker } = await import("./agents/drainBreaker");
    const result = await checkAndTripDrainBreaker();
    if (result.tripped) {
      // Use a saved-search-friendly prefix matching the AmmHealthCheck
      // shape so on-call can filter `[DrainBreaker] TRIPPED` quickly.
      log(
        `[DrainBreaker] TRIPPED — houseDelta24h=${result.houseDelta24h} ` +
          `threshold=${Math.round(result.thresholdApplied)} ` +
          `houseBalance=${result.houseBalance}`,
      );
    } else if (result.reason === "below_threshold") {
      log(
        `[DrainBreaker] PASS — houseDelta24h=${result.houseDelta24h} ` +
          `threshold=${Math.round(result.thresholdApplied)} ` +
          `houseBalance=${result.houseBalance}`,
      );
    } else {
      log(`[DrainBreaker] No-op (${result.reason})`);
    }
  } catch (err: any) {
    log(
      `[DrainBreaker] Scheduler tick failed (will retry next interval): ${err?.message ?? err}`,
    );
  }
}

function startDrainBreakerScheduler() {
  if (SERVERLESS_MODE) {
    log("[DrainBreaker] Skipped - serverless mode.");
    return;
  }
  log("[DrainBreaker] Starting (every 15 min)");
  // Stagger initial run by 90s so the audit doesn't pile onto boot-
  // time DB load alongside AmmHealthCheck (60s) and the other
  // schedulers firing their first ticks.
  setTimeout(() => {
    void runScheduledDrainBreaker();
    setInterval(() => void runScheduledDrainBreaker(), DRAIN_BREAKER_INTERVAL_MS);
  }, 90_000);
}

// Account-deletion sweeper cadence. Hourly is the right call here:
// the 7-day window means a few minutes of latency on finalisation
// don't matter, and we don't want to bias toward "delete the
// instant the timer hits zero" which feels less safe for a one-
// way operation.
const ACCOUNT_DELETION_SWEEPER_INTERVAL_MS = 60 * 60 * 1000;

async function runScheduledAccountDeletionSweeper(): Promise<void> {
  try {
    const { processOverdueAccountDeletions } = await import("./services/account-deletion");
    const result = await processOverdueAccountDeletions();
    if (result.candidates === 0) {
      // Don't spam logs when there's nothing to do. Hourly silence
      // is the expected steady state.
      return;
    }
    if (result.failed > 0) {
      log(
        `[AccountDeletionSweeper] PARTIAL — processed=${result.processed} failed=${result.failed} candidates=${result.candidates}`,
      );
    } else {
      log(
        `[AccountDeletionSweeper] OK — processed=${result.processed} candidates=${result.candidates}`,
      );
    }
  } catch (err: any) {
    log(
      `[AccountDeletionSweeper] Scheduler tick failed (will retry next interval): ${err?.message ?? err}`,
    );
  }
}

function startAccountDeletionSweeperScheduler() {
  if (SERVERLESS_MODE) {
    log("[AccountDeletionSweeper] Skipped - serverless mode.");
    return;
  }
  log("[AccountDeletionSweeper] Starting (every 60 min)");
  // Stagger initial run by 120s so it doesn't compete with the
  // higher-frequency schedulers in the first boot window.
  setTimeout(() => {
    void runScheduledAccountDeletionSweeper();
    setInterval(
      () => void runScheduledAccountDeletionSweeper(),
      ACCOUNT_DELETION_SWEEPER_INTERVAL_MS,
    );
  }, 120_000);
}

// ─── Celebrity profile (About) bio refresh scheduler ─────────────────────────
const CELEBRITY_PROFILE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

async function runScheduledCelebrityProfileRefresh(): Promise<void> {
  try {
    const { runCelebrityProfileCronRefresh } = await import("./jobs/celebrity-profile-cron");
    const result = await runCelebrityProfileCronRefresh();
    log(
      `[CelebrityProfileRefresh] OK — total=${result.total} refreshed=${result.refreshed} ` +
        `skipped=${result.skipped} errors=${result.errors} duration=${result.durationMs}ms`,
    );
  } catch (err: any) {
    log(`[CelebrityProfileRefresh] Scheduler tick failed (will retry next interval): ${err?.message ?? err}`);
  }
}

function startCelebrityProfileRefreshScheduler() {
  if (SERVERLESS_MODE) return;
  log("[CelebrityProfileRefresh] Starting (every 24h)");
  // Stagger initial run 5 min after boot so it doesn't pile onto the
  // higher-frequency schedulers' first ticks. The work itself is heavy
  // (OpenAI calls per profile) so we don't want to coincide with the
  // ingestion sweep at :02.
  setTimeout(() => {
    void runScheduledCelebrityProfileRefresh();
    setInterval(() => void runScheduledCelebrityProfileRefresh(), CELEBRITY_PROFILE_REFRESH_INTERVAL_MS);
  }, 5 * 60 * 1000);
}

// ─── Net worth refresh scheduler (standard + high-volatility) ────────────────
const NET_WORTH_STANDARD_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h (filters >7d internally)
const NET_WORTH_HIGH_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h for high-volatility

async function runScheduledNetWorthRefresh(volatility: "standard" | "high"): Promise<void> {
  try {
    const { runNetWorthCronRefresh } = await import("./jobs/celebrity-profile-cron");
    const result = await runNetWorthCronRefresh(volatility);
    if (result.candidates === 0) {
      return; // nothing to do, stay quiet
    }
    log(
      `[NetWorthRefresh:${volatility}] OK — candidates=${result.candidates} wrote=${result.wrote} ` +
        `kept=${result.kept} providerUnavailable=${result.providerUnavailable} ` +
        `errors=${result.errors} duration=${result.durationMs}ms`,
    );
  } catch (err: any) {
    log(`[NetWorthRefresh:${volatility}] Scheduler tick failed: ${err?.message ?? err}`);
  }
}

function startNetWorthRefreshScheduler() {
  if (SERVERLESS_MODE) return;
  log("[NetWorthRefresh] Starting (standard: every 24h, high: every 6h)");
  setTimeout(() => {
    void runScheduledNetWorthRefresh("standard");
    setInterval(() => void runScheduledNetWorthRefresh("standard"), NET_WORTH_STANDARD_INTERVAL_MS);
  }, 7 * 60 * 1000);
  setTimeout(() => {
    void runScheduledNetWorthRefresh("high");
    setInterval(() => void runScheduledNetWorthRefresh("high"), NET_WORTH_HIGH_INTERVAL_MS);
  }, 8 * 60 * 1000);
}

// ─── Why-Trending warmer scheduler ───────────────────────────────────────────
const WHY_TRENDING_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h, matches cache TTL

async function runScheduledWhyTrendingRefresh(): Promise<void> {
  try {
    const { runWhyTrendingCronRefresh } = await import("./jobs/why-trending-cron");
    const result = await runWhyTrendingCronRefresh();
    log(
      `[WhyTrendingRefresh] OK — candidates=${result.candidates} regenerated=${result.regenerated} ` +
        `extended=${result.extended} hit=${result.hit} rateLimited=${result.rateLimited} ` +
        `locked=${result.locked} noNews=${result.noNews} providerUnavailable=${result.providerUnavailable} ` +
        `errors=${result.errors} duration=${result.durationMs}ms`,
    );
  } catch (err: any) {
    log(`[WhyTrendingRefresh] Scheduler tick failed (will retry next interval): ${err?.message ?? err}`);
  }
}

function startWhyTrendingRefreshScheduler() {
  if (SERVERLESS_MODE) return;
  log("[WhyTrendingRefresh] Starting (every 4h)");
  // Stagger 3 min in so the first warm-up runs after ingestion has
  // had a chance to populate ranks at :02.
  setTimeout(() => {
    void runScheduledWhyTrendingRefresh();
    setInterval(() => void runScheduledWhyTrendingRefresh(), WHY_TRENDING_REFRESH_INTERVAL_MS);
  }, 3 * 60 * 1000);
}

startServer().catch((error) => {
  process.stderr.write(`[BOOT] Failed to start server: ${error?.stack || error}\n`);
  process.exit(1);
});
