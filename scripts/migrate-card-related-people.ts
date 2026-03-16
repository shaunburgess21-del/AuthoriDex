import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS card_related_people (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        card_type TEXT NOT NULL,
        card_id VARCHAR NOT NULL,
        person_id VARCHAR NOT NULL REFERENCES tracked_people(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log("Table card_related_people created (or already exists).");

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS card_related_people_unique_idx
        ON card_related_people (card_type, card_id, person_id);
    `);
    console.log("Unique index created.");

    await client.query(`
      CREATE INDEX IF NOT EXISTS card_related_people_person_idx
        ON card_related_people (person_id);
    `);
    console.log("Person index created.");

    await client.query(`
      CREATE INDEX IF NOT EXISTS card_related_people_card_idx
        ON card_related_people (card_type, card_id);
    `);
    console.log("Card index created.");

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
