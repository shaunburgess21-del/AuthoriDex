/**
 * One-off probe: confirm pg_trgm is installable on the current database.
 * Usage: node --env-file=.env scripts/probe-pg-trgm.cjs
 *
 * Reports three things:
 *   1. Is pg_trgm listed in pg_available_extensions? (installable)
 *   2. Is pg_trgm already in pg_extension?           (already enabled)
 *   3. Row count on tracked_people                    (sanity sizing)
 */

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const { Client } = require("pg");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected.\n");

  try {
    const avail = await client.query(
      `SELECT name, default_version, installed_version, comment
       FROM pg_available_extensions WHERE name = 'pg_trgm'`
    );
    if (avail.rows.length === 0) {
      console.log("✗ pg_trgm NOT listed in pg_available_extensions — cannot install.");
    } else {
      const r = avail.rows[0];
      console.log("✓ pg_trgm available");
      console.log(`    default_version:   ${r.default_version}`);
      console.log(`    installed_version: ${r.installed_version ?? "(not installed)"}`);
      console.log(`    comment:           ${r.comment}`);
    }

    const installed = await client.query(
      `SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm'`
    );
    console.log(
      installed.rows.length > 0
        ? `\n✓ pg_trgm already enabled (v${installed.rows[0].extversion})`
        : "\n○ pg_trgm not currently enabled (migration will install it)"
    );

    const count = await client.query(`SELECT COUNT(*)::int AS n FROM tracked_people`);
    console.log(`\n  tracked_people rows: ${count.rows[0].n}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n✗ Probe failed:", err.message ?? err);
  process.exit(1);
});
