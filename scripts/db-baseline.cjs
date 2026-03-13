/**
 * One-time script for existing databases that already have all tables.
 * Marks the baseline migration (0000_handy_frightful_four) as applied
 * so that `drizzle-kit migrate` won't try to re-create everything.
 *
 * Usage:  DATABASE_URL=... node scripts/db-baseline.cjs
 *    or:  npx tsx --env-file=.env scripts/db-baseline.cjs
 */
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const crypto = require("node:crypto");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const { Client } = require("pg");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const migrationFile = join(__dirname, "..", "migrations", "0000_handy_frightful_four.sql");
    const sql = readFileSync(migrationFile, "utf-8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");

    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      )
    `);

    const existing = await client.query(
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE hash = $1`,
      [hash]
    );

    if (existing.rows.length > 0) {
      console.log("Baseline migration already recorded — nothing to do.");
    } else {
      await client.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [hash, Date.now()]
      );
      console.log("Baseline migration marked as applied.");
    }

    console.log("Done. You can now safely run: npx drizzle-kit migrate");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
