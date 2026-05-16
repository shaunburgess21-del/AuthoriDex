/**
 * Parimutuel sunset, Phase 1.4: reset every user's predict_credits balance
 * to a clean baseline so we start AMM history at a sane number.
 *
 * After Phase 1.3 hard-deleted parimutuel non-jackpot rows (including the
 * matching credit_ledger entries), the remaining `profiles.predict_credits`
 * snapshot no longer matches the sum of surviving ledger rows. Rather than
 * spend hours reconciling, we just reset balances to:
 *
 *   - Humans   (is_agent = false): SIGNUP_CREDIT_GRANT      (10,000)
 *   - Agents   (is_agent = true):  AGENT_CREDIT_TOPUP_TARGET (50,000)
 *
 * One audit row per user is written to credit_ledger with txn_type
 * 'sunset_reset' so the new starting balance is traceable. Jackpot
 * balances are preserved implicitly — jackpot ledger rows were not
 * deleted in Phase 1.3, so any jackpot prize money already in a user's
 * wallet is overwritten by this reset. That's intentional: the user
 * confirmed "wipe history" includes pre-sunset jackpot winnings.
 *
 * Pre-reqs:
 *   1. scripts/sunset-pause-agents.ts
 *   2. scripts/sunset-void-inflight.ts
 *   3. scripts/sunset-wipe-parimutuel.ts
 *
 * Run with:
 *   npx tsx scripts/sunset-reset-credits.ts [--dry-run]
 */

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../server/db";
import { creditLedger, profiles } from "@shared/schema";
import { SIGNUP_CREDIT_GRANT } from "@shared/credit-config";
import { AGENT_CREDIT_TOPUP_TARGET } from "../server/agents/constants";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  console.log(`\n[sunset:reset-credits] Resetting predict_credits balances...`);
  console.log(`  humans -> ${SIGNUP_CREDIT_GRANT}`);
  console.log(`  agents -> ${AGENT_CREDIT_TOPUP_TARGET}`);
  if (DRY_RUN) console.log(`  (DRY RUN — no DB writes)`);

  const rows = await db
    .select({
      id: profiles.id,
      handle: profiles.handle,
      isAgent: profiles.isAgent,
      predictCredits: profiles.predictCredits,
    })
    .from(profiles);

  const humans = rows.filter((r) => !r.isAgent);
  const agents = rows.filter((r) => r.isAgent);
  console.log(`\n[sunset:reset-credits] Found:`);
  console.log(`  humans  ${humans.length}`);
  console.log(`  agents  ${agents.length}`);

  if (DRY_RUN) {
    console.log(`\n[sunset:reset-credits] DRY RUN complete. Re-run without --dry-run to execute.\n`);
    process.exit(0);
  }

  const sunsetTimestamp = new Date().toISOString();
  const runId = randomUUID().slice(0, 8);

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const target = row.isAgent ? AGENT_CREDIT_TOPUP_TARGET : SIGNUP_CREDIT_GRANT;
      const delta = target - row.predictCredits;

      // Update the snapshot first so balance_after reflects the new state.
      await tx
        .update(profiles)
        .set({ predictCredits: target })
        .where(eq(profiles.id, row.id));

      // One audit row per user. `prediction_refund` & friends use this
      // pattern; we reuse it so the user wallet history page renders the
      // reset cleanly.
      await tx.insert(creditLedger).values({
        userId: row.id,
        txnType: "sunset_reset",
        amount: delta,
        walletType: "VIRTUAL",
        balanceAfter: target,
        source: "parimutuel_sunset",
        idempotencyKey: `sunset_reset_${runId}_${row.id}`,
        metadata: {
          previousBalance: row.predictCredits,
          newBalance: target,
          reason: "Parimutuel sunset Phase 1.4 — balance reset to baseline",
          runId,
          sunsetTimestamp,
        },
      });
    }
  });

  console.log(`\n[sunset:reset-credits] Done.`);
  console.log(`  resets       ${rows.length}`);
  console.log(`  run_id       ${runId}`);
  console.log(`  ledger_tag   sunset_reset`);

  // Post-flight sanity: every row should be at the target balance now.
  const [{ humansOff }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS "humansOff" FROM profiles
    WHERE is_agent = false AND predict_credits != ${SIGNUP_CREDIT_GRANT}
  `)).rows as unknown as Array<{ humansOff: number }>;

  const [{ agentsOff }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS "agentsOff" FROM profiles
    WHERE is_agent = true AND predict_credits != ${AGENT_CREDIT_TOPUP_TARGET}
  `)).rows as unknown as Array<{ agentsOff: number }>;

  if (humansOff > 0 || agentsOff > 0) {
    console.error(`\n[sunset:reset-credits] FAIL: ${humansOff} humans + ${agentsOff} agents off-target.`);
    process.exit(1);
  }
  console.log(`\n[sunset:reset-credits] Verified: every wallet is at the expected baseline.`);
  console.log(`\nNext step: deploy Phase 1.5 code (creation gates) then run npx tsx scripts/sunset-resume-agents.ts\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[sunset:reset-credits] FAILED:", err);
  process.exit(1);
});
