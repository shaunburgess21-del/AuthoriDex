/**
 * One-time script: apply migration 0007 and baseline the drizzle migration
 * tracking table so future `npm run db:migrate` calls work correctly.
 *
 * Background: the production DB was built entirely via `db:push` (schema sync),
 * which does not write to drizzle.__drizzle_migrations. This script:
 *   1. Creates the `suggestions` table and its indexes (0007 DDL, idempotent).
 *   2. Inserts the `submit_suggestion` xp_actions row (0007 DML, ON CONFLICT DO NOTHING).
 *   3. Creates drizzle.__drizzle_migrations if absent.
 *   4. Marks all 8 migrations (0000–0007) as applied, using hash=sha256(rawContent)
 *      and created_at=journalEntry.when — the exact values drizzle-orm would have
 *      written, so future `npm run db:migrate` correctly skips all 8.
 *   5. Prints verification output for each check.
 *
 * Usage: tsx --env-file=.env scripts/apply-migration-0007.cjs
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const crypto = require("node:crypto");

const MIGRATION_FILES = [
  "0000_handy_frightful_four.sql",
  "0001_clever_franklin_storm.sql",
  "0002_stale_crystal.sql",
  "0003_famous_skaar.sql",
  "0004_induction_candidate_social_status.sql",
  "0005_matchup_neutral_votes.sql",
  "0006_reduce_face_offs_seed_votes.sql",
  "0007_add_suggestions_table.sql",
];

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
    // ── Step 1: Apply 0007 DDL ────────────────────────────────────────────────
    console.log("── Step 1: Applying 0007 DDL ──");

    await client.query(`
      CREATE TABLE IF NOT EXISTS "suggestions" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "type" text NOT NULL,
        "payload" jsonb NOT NULL,
        "submitted_by" varchar NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "admin_notes" text,
        "approved_as_id" text,
        "approved_as_type" text,
        "reviewed_by" varchar,
        "reviewed_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "suggestions_submitted_by_fkey"
          FOREIGN KEY ("submitted_by") REFERENCES "profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "suggestions_reviewed_by_fkey"
          FOREIGN KEY ("reviewed_by") REFERENCES "profiles"("id") ON DELETE SET NULL
      )
    `);
    console.log("  ✓ suggestions table created (or already existed)");

    await client.query(`
      CREATE INDEX IF NOT EXISTS "suggestions_submitter_idx"
        ON "suggestions" ("submitted_by", "created_at" DESC)
    `);
    console.log("  ✓ index suggestions_submitter_idx");

    await client.query(`
      CREATE INDEX IF NOT EXISTS "suggestions_status_idx"
        ON "suggestions" ("status", "created_at" DESC)
    `);
    console.log("  ✓ index suggestions_status_idx");

    await client.query(`
      CREATE INDEX IF NOT EXISTS "suggestions_type_status_idx"
        ON "suggestions" ("type", "status")
    `);
    console.log("  ✓ index suggestions_type_status_idx");

    // ── Step 2: Seed xp_actions row ───────────────────────────────────────────
    console.log("\n── Step 2: Seeding xp_actions row ──");

    const xpResult = await client.query(`
      INSERT INTO "xp_actions"
        ("action_key", "display_name", "xp_value", "daily_cap", "description", "is_active")
      VALUES
        ('submit_suggestion', 'Submit Suggestion', 5, 3,
         'Earn XP for submitting content suggestions for admin review', true)
      ON CONFLICT ("action_key") DO NOTHING
      RETURNING *
    `);
    if (xpResult.rowCount > 0) {
      console.log("  ✓ xp_actions row inserted:", JSON.stringify(xpResult.rows[0]));
    } else {
      console.log("  ✓ xp_actions row already existed — skipped (ON CONFLICT DO NOTHING)");
    }

    // ── Step 3: Ensure drizzle.__drizzle_migrations tracking table ────────────
    console.log("\n── Step 3: Ensuring drizzle migration tracking table ──");

    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      )
    `);
    console.log("  ✓ drizzle.__drizzle_migrations exists");

    // ── Step 4: Mark all 8 migrations as applied ──────────────────────────────
    // created_at = journalEntry.when (NOT Date.now()), matching exactly what
    // drizzle-orm writes when it applies a migration itself.
    console.log("\n── Step 4: Marking all migrations as applied ──");

    const migrationsDir = join(__dirname, "..", "migrations");
    const journal = JSON.parse(
      readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf-8")
    );
    const whenByFilename = Object.fromEntries(
      journal.entries.map((e) => [`${e.tag}.sql`, e.when])
    );

    let alreadyApplied = 0;
    let newlyMarked = 0;

    for (const filename of MIGRATION_FILES) {
      const rawSql = readFileSync(join(migrationsDir, filename), "utf-8");
      const hash = crypto.createHash("sha256").update(rawSql).digest("hex");
      const createdAt = whenByFilename[filename];

      if (createdAt === undefined) {
        console.error(`  ✗ No journal entry found for ${filename} — aborting`);
        process.exit(1);
      }

      const existing = await client.query(
        `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE hash = $1`,
        [hash]
      );

      if (existing.rows.length > 0) {
        console.log(`  ○ ${filename} — already recorded (hash match)`);
        alreadyApplied++;
      } else {
        await client.query(
          `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
          [hash, createdAt]
        );
        console.log(`  ✓ ${filename} — marked as applied (when=${createdAt})`);
        newlyMarked++;
      }
    }

    console.log(`\n  Summary: ${newlyMarked} newly recorded, ${alreadyApplied} already present`);

    // ── Step 5: Verification ──────────────────────────────────────────────────
    console.log("\n── Step 5: Verification ──");

    // 5a. suggestions table in information_schema
    const tableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'suggestions'
    `);
    console.log(
      tableCheck.rows.length > 0
        ? "  ✓ suggestions table confirmed in information_schema"
        : "  ✗ suggestions table NOT found"
    );

    // 5b. Column list
    const colCheck = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'suggestions'
      ORDER BY ordinal_position
    `);
    console.log(`  ✓ ${colCheck.rows.length} columns:`);
    for (const r of colCheck.rows) {
      const def = r.column_default ? ` DEFAULT ${r.column_default}` : "";
      console.log(`      ${r.column_name.padEnd(18)} ${r.data_type}${def}`);
    }

    // 5c. xp_actions row
    const xpCheck = await client.query(
      `SELECT * FROM xp_actions WHERE action_key = 'submit_suggestion'`
    );
    if (xpCheck.rows.length > 0) {
      const r = xpCheck.rows[0];
      console.log(`\n  ✓ xp_actions row confirmed:`);
      console.log(`      action_key:   ${r.action_key}`);
      console.log(`      display_name: ${r.display_name}`);
      console.log(`      xp_value:     ${r.xp_value}`);
      console.log(`      daily_cap:    ${r.daily_cap}`);
      console.log(`      is_active:    ${r.is_active}`);
    } else {
      console.log("  ✗ xp_actions row NOT found");
    }

    // 5d. __drizzle_migrations row count and most-recent entry
    const journalCheck = await client.query(`
      SELECT id, hash, created_at
      FROM "drizzle"."__drizzle_migrations"
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const totalCheck = await client.query(
      `SELECT COUNT(*) AS count FROM "drizzle"."__drizzle_migrations"`
    );
    console.log(`\n  ✓ drizzle.__drizzle_migrations: ${totalCheck.rows[0].count} total row(s)`);
    if (journalCheck.rows.length > 0) {
      const r = journalCheck.rows[0];
      console.log(`  ✓ Most recent entry: id=${r.id}, created_at=${r.created_at}, hash=${r.hash.slice(0, 16)}…`);
    }

    console.log("\n✓ All steps complete. Production database is up to date.");
    console.log("  Future `npm run db:migrate` calls will skip all 8 migrations correctly.\n");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n✗ Script failed:", err.message ?? err);
  process.exit(1);
});
