/**
 * Close out orphan ledger rows for AMM markets that were fully settled,
 * then hard-deleted (e.g. smoke / test markets).
 *
 * Unlike `reconcile-orphan-amm-seeds.ts`, this does NOT refund the house:
 * `amm_settle_credit` already returned the seed at resolution. We only write
 * a zero-amount `amm_orphan_seed_reconciliation` marker so
 * `checkOrphanLedger` ignores the surviving audit-trail rows.
 *
 * Safety:
 *   - Refuses markets that still exist in prediction_markets.
 *   - Refuses unless an orphan `amm_settle_credit` exists for the market.
 *   - Refuses if `amm_orphan_seed_reconciliation` already exists.
 *   - Idempotent via idempotency_key=`amm_orphan_recon_<marketId>`.
 *   - Default targets the two Jun-2026 AMM smoke markets; pass explicit IDs
 *     as CLI args to close out others after manual review.
 *
 * Run:
 *   npx tsx ops/mark-settled-orphan-markets.ts --dry-run
 *   npx tsx ops/mark-settled-orphan-markets.ts
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const marketIdArgs = args.filter((a) => !a.startsWith("--"));

const DEFAULT_MARKET_IDS = [
  "a792287b-fa00-41f7-a4d1-626e37d55b15", // [AMM smoke] 3-outcome test market
  "141d4419-65f5-40d1-a5dd-a7a05c720c3d", // [Phase 10] Agent smoke market (2-outcome)
];

const HOUSE_PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";

async function main(): Promise<void> {
  const marketIds = marketIdArgs.length > 0 ? marketIdArgs : DEFAULT_MARKET_IDS;

  console.log(`\n[mark-settled-orphans]`);
  console.log(`  house id     ${HOUSE_PROFILE_ID}`);
  console.log(`  markets      ${marketIds.length}`);
  console.log(`  mode         ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE WRITE"}`);

  if (!process.env.DATABASE_URL) {
    console.error("\n[mark-settled-orphans] DATABASE_URL is not set.");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  const { profiles, creditLedger } = await import("../shared/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { randomUUID } = await import("node:crypto");

  const [house] = await db
    .select({ id: profiles.id, predictCredits: profiles.predictCredits, isHouse: profiles.isHouse })
    .from(profiles)
    .where(eq(profiles.id, HOUSE_PROFILE_ID))
    .limit(1);

  if (!house?.isHouse) {
    console.error(`\n[mark-settled-orphans] House profile ${HOUSE_PROFILE_ID} missing or is_house=false.`);
    process.exit(1);
  }

  const runId = randomUUID().slice(0, 8);
  let applied = 0;
  let skipped = 0;

  for (const marketId of marketIds) {
    const [marketRow] = (await db.execute(sql`
      SELECT id FROM prediction_markets WHERE id = ${marketId} LIMIT 1
    `)).rows as Array<{ id: string }>;
    if (marketRow) {
      console.error(`\n[mark-settled-orphans] Refusing ${marketId}: market still exists.`);
      process.exit(1);
    }

    const orphanRows = (await db.execute(sql`
      SELECT cl.id, cl.txn_type, cl.amount, cl.created_at
      FROM credit_ledger cl
      WHERE cl.metadata->>'marketId' = ${marketId}
      ORDER BY cl.created_at ASC
    `)).rows as Array<{ id: string; txn_type: string; amount: number; created_at: Date }>;

    if (orphanRows.length === 0) {
      console.log(`  [skip] ${marketId}  no orphan ledger rows`);
      skipped += 1;
      continue;
    }

    const hasSettleCredit = orphanRows.some((r) => r.txn_type === "amm_settle_credit");
    if (!hasSettleCredit) {
      console.error(
        `\n[mark-settled-orphans] Refusing ${marketId}: no orphan amm_settle_credit — ` +
          `seed may not have been returned; use reconcile-orphan-amm-seeds instead.`,
      );
      process.exit(1);
    }

    const idempotencyKey = `amm_orphan_recon_${marketId}`;
    const [existing] = await db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(
        sql`${creditLedger.userId} = ${HOUSE_PROFILE_ID} AND ${creditLedger.idempotencyKey} = ${idempotencyKey}`,
      )
      .limit(1);

    if (existing) {
      console.log(`  [skip] ${marketId}  already has reconciliation marker`);
      skipped += 1;
      continue;
    }

    const txnSummary = orphanRows.map((r) => `${r.txn_type}(${r.amount})`).join(", ");
    console.log(`  [plan] ${marketId}  ${orphanRows.length} orphan row(s): ${txnSummary}`);

    if (DRY_RUN) {
      continue;
    }

    await db.insert(creditLedger).values({
      userId: HOUSE_PROFILE_ID,
      txnType: "amm_orphan_seed_reconciliation",
      amount: 0,
      walletType: "VIRTUAL",
      balanceAfter: house.predictCredits,
      source: "ops_settled_orphan_closeout",
      idempotencyKey,
      metadata: {
        originalMarketId: marketId,
        originalLedgerIds: orphanRows.map((r) => r.id),
        originalTxnTypes: [...new Set(orphanRows.map((r) => r.txn_type))],
        refundAmount: 0,
        runId,
        reason:
          "Close-out marker for a hard-deleted AMM market that already settled " +
          "(amm_settle_credit present). No house refund — seed was returned at settlement. " +
          "See ops/mark-settled-orphan-markets.ts.",
        appliedAt: new Date().toISOString(),
      },
    });

    applied += 1;
    console.log(`  [ok]   ${marketId}  marker written (amount=0)`);
  }

  console.log(`\n[mark-settled-orphans] Done. applied=${applied} skipped=${skipped}`);
  if (DRY_RUN) {
    console.log(`Re-run without --dry-run to apply.\n`);
  } else {
    console.log(`Next: confirm orphan check passes on the next amm-health run.\n`);
  }
}

main().catch((err) => {
  console.error("\n[mark-settled-orphans] FAILED:", err);
  process.exit(1);
});
