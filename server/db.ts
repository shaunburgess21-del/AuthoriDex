import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import { log } from "./log";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Default 25: app connects via Supavisor pooler (multiplexes client slots onto fewer
// backend connections). Headroom for API traffic + 15+ in-process schedulers.
// Override per environment with DB_POOL_MAX if needed.
//
// Supabase: use the transaction-mode pooler URL (port 6543), not session mode
// (5432). Session mode pins one backend connection per pool slot and exhausts
// `max_connections` under parallel schedulers + API traffic.
const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX || "25", 10);

// Per-statement cap (applied via SET on each physical connection, below) so a
// runaway query is killed by Postgres instead of pinning a pooled connection
// indefinitely. Kept comfortably above the slowest *legitimate* analytics jobs
// (volatility precompute / market opening-scores ~20s) so we never clip real
// work — this is a guard against hung/runaway queries, not the request-path
// fix (that's the api_cache + insights cache-warmer). Set to 0 to disable.
const DB_STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "30000", 10);

/**
 * Default: `rejectUnauthorized: false` (common for Neon/Railway-style TLS without bundling CA).
 * For stricter TLS: set `DATABASE_SSL_REJECT_UNAUTHORIZED=true` and optionally `DATABASE_CA_CERT` (PEM string).
 */
function buildPgSsl():
  | { rejectUnauthorized: false }
  | { rejectUnauthorized: true; ca?: string } {
  const ca = process.env.DATABASE_CA_CERT?.trim();
  const strict = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";
  if (strict || ca) {
    return {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
    };
  }
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: buildPgSsl(),
});

// Apply statement_timeout per physical connection rather than via the libpq
// `options` startup parameter: the Supabase/Supavisor pooler can reject unknown
// startup parameters, which would break every connection at boot. Running it as
// a plain SET after the handshake is pooler-safe (works in session + transaction
// mode) and best-effort — a failure here must never take down the pool.
if (DB_STATEMENT_TIMEOUT_MS > 0) {
  pool.on("connect", (client) => {
    client
      .query(`SET statement_timeout TO ${DB_STATEMENT_TIMEOUT_MS}`)
      .catch((err) => log(`[DB] Failed to set statement_timeout: ${err}`));
  });
}

export const db = drizzle(pool, { schema });

let dbPoolMonitorStarted = false;

export async function withDbAdvisoryLock<T>(
  lockKey: number,
  label: string,
  fn: () => Promise<T>,
): Promise<{ acquired: boolean; result?: T }> {
  const client = await pool.connect();

  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [lockKey],
    );

    if (!result.rows[0]?.locked) {
      return { acquired: false };
    }

    try {
      return { acquired: true, result: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    }
  } catch (error) {
    log(`[DB Lock] ${label} lock error: ${error}`);
    throw error;
  } finally {
    client.release();
  }
}

export function startDbPoolMonitor(intervalMs = 120_000): void {
  if (dbPoolMonitorStarted) return;
  dbPoolMonitorStarted = true;

  const timer = setInterval(() => {
    const waiting = pool.waitingCount;
    const total = pool.totalCount;
    const idle = pool.idleCount;
    const nearCapacity = total >= Math.max(1, DB_POOL_MAX - 2);

    if (waiting > 0 || nearCapacity) {
      log(`[DB Pool] total=${total} idle=${idle} waiting=${waiting} max=${DB_POOL_MAX}`);
    }
  }, intervalMs);

  timer.unref?.();
}
