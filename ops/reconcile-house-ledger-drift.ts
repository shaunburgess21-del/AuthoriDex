/**
 * Reconcile house wallet vs credit_ledger sum (ledger-only adjustment).
 *
 * Background: `repair-amm-outcomes.ts` wipe-reseed wrote `amm_seed_refund`
 * ledger rows (+seed) while deleting the original `amm_seed_debit` and
 * re-seeding. The house wallet nets to zero per market, but the ledger
 * gains +seed per market because the refund row survives after the old
 * debit is deleted.
 *
 * Detection: AMM admin invariants `house_ledger_reconciliation` — profile
 * predict_credits != SUM(credit_ledger.amount) for HOUSE_PROFILE_ID.
 *
 * Fix: append a single compensating ledger row (wallet unchanged). Uses
 * `computeDriftDelta` from server/services/credit-drift.ts:
 *   delta = wallet - ledgerSum  (negative when ledger is overstated).
 *
 * Run with:
 *   npx tsx ops/reconcile-house-ledger-drift.ts --dry-run
 *   npx tsx ops/reconcile-house-ledger-drift.ts
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const HOUSE_PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";

interface RepairRefundRow {
  id: string;
  amount: number;
  marketId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

async function main(): Promise<void> {
  console.log(`\n[reconcile:house-ledger-drift]`);
  console.log(`  house id          ${HOUSE_PROFILE_ID}`);
  console.log(`  mode              ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE WRITE"}`);

  if (!process.env.DATABASE_URL) {
    console.error("\n[reconcile:house-ledger-drift] DATABASE_URL is not set.");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  const { profiles, creditLedger } = await import("../shared/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { computeDriftDelta } = await import("../server/services/credit-drift");

  const [house] = await db
    .select({
      id: profiles.id,
      predictCredits: profiles.predictCredits,
      isHouse: profiles.isHouse,
    })
    .from(profiles)
    .where(eq(profiles.id, HOUSE_PROFILE_ID))
    .limit(1);

  if (!house) {
    console.error(`\n[reconcile:house-ledger-drift] House profile ${HOUSE_PROFILE_ID} does not exist. Aborting.\n`);
    process.exit(1);
  }
  if (!house.isHouse) {
    console.error(`\n[reconcile:house-ledger-drift] Profile exists but is_house=false. Aborting.\n`);
    process.exit(1);
  }

  const ledgerAgg = await db
    .select({ total: sql<string>`COALESCE(SUM(${creditLedger.amount}), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, HOUSE_PROFILE_ID));

  const wallet = Number(house.predictCredits);
  const ledgerSum = Number(ledgerAgg[0]?.total ?? 0);
  const drift = computeDriftDelta({ wallet, ledgerSum });

  console.log(`\n  wallet (profile)    ${wallet.toLocaleString()}`);
  console.log(`  ledger sum          ${ledgerSum.toLocaleString()}`);
  console.log(`  drift (wallet-ledger) ${drift >= 0 ? "+" : ""}${drift.toLocaleString()}`);

  if (Math.abs(drift) < 1) {
    console.log(`\n[reconcile:house-ledger-drift] Already reconciled (|drift| < 1). Nothing to do.\n`);
    process.exit(0);
  }

  const repairRefunds = (await db.execute(sql`
    SELECT cl.id,
           cl.amount,
           cl.metadata->>'marketId' AS market_id,
           cl.idempotency_key       AS idempotency_key,
           cl.created_at            AS created_at
    FROM credit_ledger cl
    WHERE cl.user_id = ${HOUSE_PROFILE_ID}
      AND cl.txn_type = 'amm_seed_refund'
      AND cl.metadata->>'reason' = 'repair-amm-outcomes wipe-and-reseed'
    ORDER BY cl.created_at ASC
  `)).rows as unknown as Array<{
    id: string;
    amount: number;
    market_id: string | null;
    idempotency_key: string | null;
    created_at: Date;
  }>;

  const refundRows: RepairRefundRow[] = repairRefunds.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    marketId: r.market_id,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at,
  }));

  const refundLedgerSum = refundRows.reduce((s, r) => s + r.amount, 0);
  console.log(`\n  repair refund rows  ${refundRows.length} (ledger +${refundLedgerSum.toLocaleString()} cr)`);
  for (const row of refundRows) {
    console.log(`    ${row.id}  +${row.amount}  market=${row.marketId ?? "?"}`);
  }

  if (refundRows.length > 0 && refundLedgerSum !== -drift) {
    console.warn(
      `\n  WARNING: drift (${drift}) does not equal -SUM(repair refunds) (${-refundLedgerSum}). ` +
        `Proceeding with wallet-based delta anyway — review before live run.`,
    );
  }

  const idempotencyKey = `house_ledger_recon_${wallet}`;

  const existing = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(
      sql`${creditLedger.userId} = ${HOUSE_PROFILE_ID} AND ${creditLedger.idempotencyKey} = ${idempotencyKey}`,
    )
    .limit(1);

  if (existing.length > 0) {
    console.log(
      `\n[reconcile:house-ledger-drift] Reconciliation row already exists (ledger id=${existing[0].id}). Nothing to do.\n`,
    );
    process.exit(0);
  }

  console.log(`\n  would insert        ${deltaLabel(drift)} cr (txn_type=house_ledger_reconciliation)`);
  console.log(`  idempotency_key     ${idempotencyKey}`);
  console.log(`  wallet change       none`);

  if (DRY_RUN) {
    console.log(`\n[reconcile:house-ledger-drift] DRY RUN complete. Re-run without --dry-run to apply.\n`);
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    const existingInTx = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(
        sql`${creditLedger.userId} = ${HOUSE_PROFILE_ID} AND ${creditLedger.idempotencyKey} = ${idempotencyKey}`,
      )
      .limit(1);
    if (existingInTx.length > 0) {
      throw new Error(`Reconciliation row appeared mid-flight (id=${existingInTx[0].id}). Aborting.`);
    }

    const [lockedHouse] = await tx
      .select({ predictCredits: profiles.predictCredits })
      .from(profiles)
      .where(eq(profiles.id, HOUSE_PROFILE_ID))
      .limit(1);

    if (!lockedHouse) {
      throw new Error(`House profile ${HOUSE_PROFILE_ID} missing in transaction.`);
    }

    const [ledgerRow] = (await tx.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::bigint AS total
      FROM credit_ledger
      WHERE user_id = ${HOUSE_PROFILE_ID}
    `)).rows as unknown as Array<{ total: number }>;

    const liveWallet = Number(lockedHouse.predictCredits);
    const liveLedgerSum = Number(ledgerRow?.total ?? 0);
    const liveDelta = computeDriftDelta({ wallet: liveWallet, ledgerSum: liveLedgerSum });

    if (Math.abs(liveDelta) < 1) {
      throw new Error("Drift closed between preflight and write — another process reconciled?");
    }

    if (liveDelta !== drift) {
      throw new Error(
        `House balances changed during run (preflight drift=${drift}, live=${liveDelta}). Re-run.`,
      );
    }

    await tx.insert(creditLedger).values({
      userId: HOUSE_PROFILE_ID,
      txnType: "house_ledger_reconciliation",
      amount: liveDelta,
      walletType: "VIRTUAL",
      balanceAfter: liveWallet,
      source: "ops_house_ledger_reconciliation",
      idempotencyKey,
      metadata: {
        wallet: liveWallet,
        ledgerSumBefore: liveLedgerSum,
        ledgerSumAfter: liveLedgerSum + liveDelta,
        driftBefore: liveDelta,
        repairRefundLedgerIds: refundRows.map((r) => r.id),
        repairRefundMarketIds: refundRows.map((r) => r.marketId).filter(Boolean),
        reason:
          "Align house credit_ledger sum with predict_credits after repair-amm-outcomes " +
          "wipe-reseed left orphan amm_seed_refund rows. Wallet unchanged.",
        appliedAt: new Date().toISOString(),
      },
    });
  });

  const afterAgg = await db
    .select({ total: sql<string>`COALESCE(SUM(${creditLedger.amount}), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, HOUSE_PROFILE_ID));

  const afterLedger = Number(afterAgg[0]?.total ?? 0);
  const afterDrift = computeDriftDelta({ wallet, ledgerSum: afterLedger });

  console.log(`\n[reconcile:house-ledger-drift] Done.`);
  console.log(`  ledger adjustment   ${deltaLabel(drift)} cr`);
  console.log(`  new ledger sum      ${afterLedger.toLocaleString()}`);
  console.log(`  residual drift      ${afterDrift}`);
  console.log(`\nNext step:`);
  console.log(`  Refresh AMM Invariants in admin — house_ledger_reconciliation should be green.\n`);

  process.exit(0);
}

function deltaLabel(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toLocaleString()}`;
}

main().catch((err) => {
  console.error("\n[reconcile:house-ledger-drift] FAILED:", err);
  process.exit(1);
});
