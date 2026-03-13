import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import { log } from "./log";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX || "10", 10);

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: false
  }
});
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
