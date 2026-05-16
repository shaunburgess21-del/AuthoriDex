/**
 * Parimutuel sunset, Phase 1.3: hard-delete every parimutuel non-jackpot
 * row across the system in a single transaction.
 *
 * Scope (all rows where the parent prediction_markets row has
 * engine='parimutuel' AND market_type != 'jackpot'):
 *
 *   1. notifications referencing those markets
 *      (no FK — matched via entity_id + metadata->>'marketId')
 *   2. credit_ledger entries referencing those markets
 *      (no FK — matched via metadata->>'marketId')
 *   3. prediction_markets row, which cascades to:
 *        - market_entries           (FK CASCADE)
 *        - market_bets              (FK CASCADE)
 *        - market_amm_state         (FK CASCADE; empty for parimutuel)
 *        - amm_price_snapshots      (FK CASCADE; empty for parimutuel)
 *        - scheduled_agent_actions  (FK CASCADE)
 *        - notification_market_mutes (FK CASCADE)
 *
 * Jackpot is preserved untouched — both jackpot OPEN/RESOLVED markets
 * and their full bet/entry/notification/ledger histories stay intact.
 *
 * Pre-reqs:
 *   1. scripts/sunset-pause-agents.ts   (agents off)
 *   2. scripts/sunset-void-inflight.ts  (in-flight parimutuel non-jackpot
 *      markets voided so no user is mid-flight when we wipe)
 *
 * Run with:
 *   npx tsx scripts/sunset-wipe-parimutuel.ts [--dry-run]
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  console.log(`\n[sunset:wipe] Hard-deleting parimutuel non-jackpot rows...`);
  if (DRY_RUN) console.log(`  (DRY RUN — counts only, no DB writes)`);

  // Pre-flight: count what we're about to touch so the op log has a
  // before-state. Cheap because the same predicate runs again inside
  // the transaction.
  const [{ markets }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS markets FROM prediction_markets
    WHERE engine = 'parimutuel' AND market_type != 'jackpot'
  `)).rows as unknown as Array<{ markets: number }>;

  const [{ bets }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS bets FROM market_bets b
    JOIN prediction_markets m ON m.id = b.market_id
    WHERE m.engine = 'parimutuel' AND m.market_type != 'jackpot'
  `)).rows as unknown as Array<{ bets: number }>;

  const [{ entries }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS entries FROM market_entries e
    JOIN prediction_markets m ON m.id = e.market_id
    WHERE m.engine = 'parimutuel' AND m.market_type != 'jackpot'
  `)).rows as unknown as Array<{ entries: number }>;

  const [{ notifs }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS notifs FROM notifications n
    WHERE (n.entity_type = 'market' AND n.entity_id IN (
      SELECT id FROM prediction_markets
      WHERE engine = 'parimutuel' AND market_type != 'jackpot'
    ))
       OR (n.metadata->>'marketId' IN (
      SELECT id FROM prediction_markets
      WHERE engine = 'parimutuel' AND market_type != 'jackpot'
    ))
  `)).rows as unknown as Array<{ notifs: number }>;

  const [{ ledger }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS ledger FROM credit_ledger l
    WHERE l.metadata->>'marketId' IN (
      SELECT id FROM prediction_markets
      WHERE engine = 'parimutuel' AND market_type != 'jackpot'
    )
  `)).rows as unknown as Array<{ ledger: number }>;

  console.log(`\n[sunset:wipe] Pre-flight counts:`);
  console.log(`  prediction_markets    ${markets}`);
  console.log(`  market_entries        ${entries}    (cascade-deleted)`);
  console.log(`  market_bets           ${bets}    (cascade-deleted)`);
  console.log(`  notifications         ${notifs}    (manual)`);
  console.log(`  credit_ledger         ${ledger}    (manual)`);

  if (DRY_RUN) {
    console.log(`\n[sunset:wipe] DRY RUN complete. Re-run without --dry-run to execute.\n`);
    process.exit(0);
  }

  if (markets === 0) {
    console.log(`\n[sunset:wipe] Nothing to delete. Exiting.\n`);
    process.exit(0);
  }

  console.log(`\n[sunset:wipe] Wiping inside one transaction...`);

  const result = await db.transaction(async (tx) => {
    // 1. Notifications — match BOTH entity_id (typed market refs) AND
    //    metadata->>'marketId' (older notifications, jackpot variants).
    //    The double-match is intentional — different kinds historically
    //    used different conventions and we want a clean wipe.
    const notifDel = await tx.execute(sql`
      DELETE FROM notifications
      WHERE (entity_type = 'market' AND entity_id IN (
        SELECT id FROM prediction_markets
        WHERE engine = 'parimutuel' AND market_type != 'jackpot'
      ))
         OR (metadata->>'marketId' IN (
        SELECT id FROM prediction_markets
        WHERE engine = 'parimutuel' AND market_type != 'jackpot'
      ))
    `);

    // 2. Credit ledger — by metadata.marketId. We don't filter by
    //    txn_type because parimutuel touched many: prediction_stake,
    //    prediction_payout, prediction_refund, early_bird_bonus, etc.
    const ledgerDel = await tx.execute(sql`
      DELETE FROM credit_ledger
      WHERE metadata->>'marketId' IN (
        SELECT id FROM prediction_markets
        WHERE engine = 'parimutuel' AND market_type != 'jackpot'
      )
    `);

    // 3. The parent row. Everything with a CASCADE FK to
    //    prediction_markets.id falls with it.
    const marketsDel = await tx.execute(sql`
      DELETE FROM prediction_markets
      WHERE engine = 'parimutuel' AND market_type != 'jackpot'
    `);

    return {
      notifications: Number((notifDel as any).rowCount ?? 0),
      creditLedger: Number((ledgerDel as any).rowCount ?? 0),
      markets: Number((marketsDel as any).rowCount ?? 0),
    };
  });

  console.log(`\n[sunset:wipe] Done. Deleted:`);
  console.log(`  notifications         ${result.notifications}`);
  console.log(`  credit_ledger         ${result.creditLedger}`);
  console.log(`  prediction_markets    ${result.markets}    (+ cascades)`);

  // Post-flight sanity: confirm we left no parimutuel non-jackpot rows.
  const [{ remaining }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS remaining FROM prediction_markets
    WHERE engine = 'parimutuel' AND market_type != 'jackpot'
  `)).rows as unknown as Array<{ remaining: number }>;

  if (remaining > 0) {
    console.error(`\n[sunset:wipe] FAIL: ${remaining} parimutuel non-jackpot markets still exist.`);
    process.exit(1);
  }
  console.log(`\n[sunset:wipe] Verified: 0 parimutuel non-jackpot markets remain.`);
  console.log(`\nNext step: npx tsx scripts/sunset-reset-credits.ts\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[sunset:wipe] FAILED:", err);
  process.exit(1);
});
