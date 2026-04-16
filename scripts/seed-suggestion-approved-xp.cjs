/**
 * Phase 3a one-time seed: insert the `suggestion_approved` xp_actions row.
 *
 * Called when an admin approves a user-submitted suggestion. Unlike
 * `submit_suggestion` (seeded by migration 0007), this action is admin-gated
 * — no daily cap because users can't farm it themselves.
 *
 * Usage: tsx --env-file=.env scripts/seed-suggestion-approved-xp.cjs
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
  console.log("Connected to database.\n");

  try {
    const result = await client.query(`
      INSERT INTO "xp_actions"
        ("action_key", "display_name", "xp_value", "daily_cap", "description", "is_active")
      VALUES
        ('suggestion_approved', 'Suggestion Approved', 50, NULL,
         'Bonus XP when your suggested content is approved and goes live', true)
      ON CONFLICT ("action_key") DO NOTHING
      RETURNING *
    `);

    if (result.rowCount > 0) {
      console.log("✓ xp_actions row inserted:", JSON.stringify(result.rows[0]));
    } else {
      console.log("✓ xp_actions row already existed — skipped (ON CONFLICT DO NOTHING)");
    }

    const verify = await client.query(
      `SELECT action_key, display_name, xp_value, daily_cap, is_active
         FROM xp_actions WHERE action_key = 'suggestion_approved'`
    );
    if (verify.rows.length > 0) {
      const r = verify.rows[0];
      console.log("\nVerified:");
      console.log(`  action_key:   ${r.action_key}`);
      console.log(`  display_name: ${r.display_name}`);
      console.log(`  xp_value:     ${r.xp_value}`);
      console.log(`  daily_cap:    ${r.daily_cap}`);
      console.log(`  is_active:    ${r.is_active}`);
    } else {
      console.log("✗ Verification failed — row not found");
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n✗ Script failed:", err.message ?? err);
  process.exit(1);
});
