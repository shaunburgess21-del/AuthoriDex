import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_snapshots (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        person_id VARCHAR NOT NULL REFERENCES tracked_people(id) ON DELETE CASCADE,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        approval_avg_rating REAL,
        approval_votes_count INTEGER DEFAULT 0,
        approval_pct REAL
      );
    `);
    console.log("Table approval_snapshots created (or already exists).");

    await client.query(`
      CREATE INDEX IF NOT EXISTS approval_snapshots_person_ts_idx
        ON approval_snapshots (person_id, timestamp);
    `);
    console.log("Index created.");

    console.log("\nMigration complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
