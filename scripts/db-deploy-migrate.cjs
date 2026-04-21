#!/usr/bin/env node
/**
 * Deploy-time migration runner.
 *
 * Runs before the server starts. Reads migrations/meta/_journal.json, applies
 * any migration SQL files that haven't been applied yet, and records them in a
 * `schema_migrations` tracking table so we never re-apply the same one twice.
 *
 * Why this exists:
 * We had a prod incident where shared/schema.ts referenced tables and columns
 * that had never been created in Supabase because the Railway deploy pipeline
 * didn't run any migrations. This script closes that gap.
 *
 * Design:
 *   - Pure CJS, uses only `pg` (a production dependency) so it works after
 *     `npm ci --omit=dev` strips drizzle-kit.
 *   - On first run against an existing DB (users table present, tracker empty),
 *     it auto-baselines all journal entries up to BASELINE_TAG as "already
 *     applied". This avoids re-running 0000-0011 against prod, which would
 *     fail because those weren't authored idempotently.
 *   - Migrations >= 0012 are authored idempotently (IF [NOT] EXISTS,
 *     DO $$ IF NOT EXISTS $$), so re-running them against an env that was
 *     patched by hand is a safe no-op.
 *   - Each migration runs in its own transaction. Failure of any migration
 *     aborts the deploy so the server never starts against a broken schema.
 *   - Set SKIP_DB_MIGRATE=1 to bypass (e.g. for emergency rollbacks).
 */

const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");

// Anything in the journal up to and including this tag is considered "pre-existing"
// prod state and is marked as applied during first-run baselining. Any migration
// AFTER this tag runs normally.
const BASELINE_TAG = "0011_xp_ledger_user_action_date_idx";

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

function log(msg) {
  process.stdout.write(`[db-deploy-migrate] ${msg}\n`);
}

function logErr(msg) {
  process.stderr.write(`[db-deploy-migrate] ${msg}\n`);
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName],
  );
  return rows[0]?.exists === true;
}

async function ensureTrackerTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      tag         text        PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedTags(client) {
  const { rows } = await client.query("SELECT tag FROM schema_migrations");
  return new Set(rows.map((r) => r.tag));
}

async function baselineIfNeeded(client, entries, appliedTags) {
  if (appliedTags.size > 0) return;

  const hasUsers = await tableExists(client, "users");
  if (!hasUsers) {
    log("Fresh database detected (no `users` table) — no baseline, will apply all migrations.");
    return;
  }

  const cutoffIdx = entries.findIndex((e) => e.tag === BASELINE_TAG);
  if (cutoffIdx === -1) {
    logErr(
      `WARN: BASELINE_TAG "${BASELINE_TAG}" not found in journal; skipping baseline.`,
    );
    return;
  }

  log(
    `Pre-existing database detected — baselining entries 0..${cutoffIdx} (through ${BASELINE_TAG}) as already applied.`,
  );
  for (let i = 0; i <= cutoffIdx; i++) {
    const { tag } = entries[i];
    await client.query(
      "INSERT INTO schema_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING",
      [tag],
    );
    appliedTags.add(tag);
  }
}

function splitStatements(sql) {
  return sql
    .split(/-->\s*statement-breakpoint/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applyMigration(client, entry) {
  const file = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
  if (!fs.existsSync(file)) {
    throw new Error(`Migration file missing: ${entry.tag}.sql`);
  }

  const sql = fs.readFileSync(file, "utf8");
  const statements = splitStatements(sql);

  log(`Applying ${entry.tag} (${statements.length} statement${statements.length === 1 ? "" : "s"})`);

  await client.query("BEGIN");
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    await client.query(
      "INSERT INTO schema_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING",
      [entry.tag],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

async function main() {
  if (process.env.SKIP_DB_MIGRATE === "1") {
    log("SKIP_DB_MIGRATE=1 is set — skipping migration step.");
    return;
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logErr("DATABASE_URL is not set — cannot run migrations. Failing fast.");
    process.exit(1);
  }

  if (!fs.existsSync(JOURNAL_PATH)) {
    logErr(`Journal not found at ${JOURNAL_PATH} — nothing to apply.`);
    return;
  }

  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));
  const entries = journal.entries ?? [];
  if (entries.length === 0) {
    log("Journal has no entries — nothing to apply.");
    return;
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes("sslmode=require") || process.env.PGSSLMODE === "require"
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await client.connect();
  const startedAt = Date.now();

  try {
    await ensureTrackerTable(client);
    const appliedTags = await getAppliedTags(client);
    await baselineIfNeeded(client, entries, appliedTags);

    const pending = entries.filter((e) => !appliedTags.has(e.tag));
    if (pending.length === 0) {
      log(`No pending migrations. (${entries.length} total, all applied.)`);
      return;
    }

    log(`${pending.length} pending migration(s): ${pending.map((p) => p.tag).join(", ")}`);
    for (const entry of pending) {
      await applyMigration(client, entry);
    }

    const elapsed = Date.now() - startedAt;
    log(`Applied ${pending.length} migration(s) in ${elapsed}ms.`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  logErr(`FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
