/**
 * One-time script: apply migration 0008 (pg_trgm extension + GIN trigram index
 * on tracked_people.name) and record it in drizzle.__drizzle_migrations so
 * future `npm run db:migrate` calls correctly skip it.
 *
 * All DDL is idempotent (CREATE ... IF NOT EXISTS), so this is safe to re-run.
 *
 * Usage: node --env-file=.env scripts/apply-migration-0008.cjs
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const crypto = require("node:crypto");

const MIGRATION_FILE = "0008_people_name_trgm_index.sql";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const { Client } = require("pg");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to database.\n");

  try {
    // ── Step 1: Apply 0008 DDL ────────────────────────────────────────────────
    console.log("── Step 1: Applying 0008 DDL ──");

    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    console.log("  ✓ pg_trgm extension ensured");

    await client.query(`
      CREATE INDEX IF NOT EXISTS "tracked_people_name_trgm_idx"
        ON "tracked_people" USING gin ("name" gin_trgm_ops)
    `);
    console.log("  ✓ tracked_people_name_trgm_idx (GIN trigram) created");

    // ── Step 2: Record in drizzle.__drizzle_migrations ────────────────────────
    console.log("\n── Step 2: Recording migration in drizzle tracking table ──");

    const migrationsDir = join(__dirname, "..", "migrations");
    const rawSql = readFileSync(join(migrationsDir, MIGRATION_FILE), "utf-8");
    const hash = crypto.createHash("sha256").update(rawSql).digest("hex");

    const journal = JSON.parse(
      readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf-8")
    );
    const entry = journal.entries.find((e) => `${e.tag}.sql` === MIGRATION_FILE);
    if (!entry) {
      console.error(`  ✗ No journal entry for ${MIGRATION_FILE} — aborting`);
      process.exit(1);
    }

    const existing = await client.query(
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE hash = $1`,
      [hash]
    );
    if (existing.rows.length > 0) {
      console.log(`  ○ ${MIGRATION_FILE} — already recorded (hash match)`);
    } else {
      await client.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [hash, entry.when]
      );
      console.log(`  ✓ ${MIGRATION_FILE} — marked as applied (when=${entry.when})`);
    }

    // ── Step 3: Verification ──────────────────────────────────────────────────
    console.log("\n── Step 3: Verification ──");

    const extCheck = await client.query(
      `SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm'`
    );
    console.log(
      extCheck.rows.length > 0
        ? `  ✓ pg_trgm enabled (v${extCheck.rows[0].extversion})`
        : "  ✗ pg_trgm NOT enabled"
    );

    const idxCheck = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'tracked_people'
        AND indexname = 'tracked_people_name_trgm_idx'
    `);
    if (idxCheck.rows.length > 0) {
      console.log("  ✓ tracked_people_name_trgm_idx confirmed");
      console.log(`      ${idxCheck.rows[0].indexdef}`);
    } else {
      console.log("  ✗ tracked_people_name_trgm_idx NOT found");
    }

    // Quick smoke test that similarity works.
    const smoke = await client.query(
      `SELECT name, similarity(name, 'trump') AS sim
       FROM tracked_people
       WHERE name % 'trump'
       ORDER BY sim DESC
       LIMIT 5`
    );
    console.log(`\n  Smoke test: name % 'trump' returned ${smoke.rowCount} row(s)`);
    for (const r of smoke.rows) {
      console.log(`      ${r.name.padEnd(30)} sim=${Number(r.sim).toFixed(3)}`);
    }

    console.log("\n✓ Migration 0008 applied successfully.\n");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n✗ Script failed:", err.message ?? err);
  process.exit(1);
});
