// One-off applier for migration 0063_onboarding_progress.
// Reads .env, runs the migration SQL inside a transaction, then
// inserts the row into drizzle.__drizzle_migrations so the journal
// state matches the file system.
//
// Safe to re-run: ADD COLUMN IF NOT EXISTS + a hash-uniqueness check
// against drizzle.__drizzle_migrations. The hash matches what
// drizzle-kit would compute for an idx=63 entry.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/i);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

(async () => {
  loadDotEnv();
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const sqlPath = path.join(
    __dirname,
    "..",
    "migrations",
    "0063_onboarding_progress.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8");
  const hash = crypto.createHash("sha256").update(sql).digest("hex");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check if already applied (by hash).
    const existing = await client.query(
      "SELECT id FROM drizzle.__drizzle_migrations WHERE hash = $1 LIMIT 1",
      [hash],
    );
    if (existing.rows.length > 0) {
      console.log("Already applied (hash match). Skipping.");
      await client.query("ROLLBACK");
      return;
    }

    console.log("Applying migration 0063_onboarding_progress.sql ...");
    await client.query(sql);

    const beforeCount = await client.query(
      "SELECT COUNT(*)::int AS n FROM profiles WHERE onboarding_completed_at IS NOT NULL",
    );
    console.log(
      `profiles.onboarding_completed_at now non-null on ${beforeCount.rows[0].n} rows.`,
    );

    await client.query(
      "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
      [hash, Date.now()],
    );
    await client.query("COMMIT");
    console.log("Done.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("FAILED:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
