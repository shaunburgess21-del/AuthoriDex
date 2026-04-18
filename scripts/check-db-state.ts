import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  // Q1
  const descCol = await db.execute(sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'ranks' AND column_name = 'description'
  `);
  console.log("Q1 — ranks.description:", descCol.rows);

  // Q2
  const idx = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'xp_ledger' AND indexname = 'idx_xp_ledger_user_action_date'
  `);
  console.log("Q2 — xp_ledger index:", idx.rows);

  // Q3
  const con = await db.execute(sql`
    SELECT conname FROM pg_constraint WHERE conname = 'opinion_poll_votes_user_poll_unique'
  `);
  console.log("Q3 — opinion poll constraint:", con.rows);

  // Q4 (safe — only select description if column exists)
  const baseRanks = await db.execute(sql`SELECT tier, name, min_xp, max_xp FROM ranks ORDER BY tier`);
  console.log("Q4a — ranks (base):");
  console.table(baseRanks.rows);
  if (descCol.rows.length > 0) {
    const descs = await db.execute(sql`SELECT tier, description FROM ranks ORDER BY tier`);
    console.log("Q4b — descriptions:");
    console.table(descs.rows);
  }

  // Q5
  const pc = await db.execute(sql`
    SELECT action_key, xp_value, daily_cap FROM xp_actions WHERE action_key = 'post_comment'
  `);
  console.log("Q5 — post_comment:", pc.rows);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
