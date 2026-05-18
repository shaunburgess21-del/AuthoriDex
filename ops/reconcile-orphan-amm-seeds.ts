/**
 * Reconcile orphan AMM house-seed debits.
 *
 * Background: when a draft AMM market is hard-deleted via the admin UI
 * AFTER its `amm_seed_debit` row was written to `credit_ledger`, the
 * `market_amm_state` row cascades away with the market — but the
 * ledger row survives (it's an audit log, NO cascade). The seed
 * credits that were debited from the house at create time are now
 * permanently down with no offsetting `amm_settle_credit` row, since
 * the resolver never ran on the deleted market.
 *
 * Detection: `server/jobs/amm-health.ts::checkOrphanLedger` flags
 * these as "Orphan credit_ledger rows" — rows whose
 * `metadata.marketId` no longer exists in `prediction_markets`.
 *
 * This script writes a one-shot reconciliation: for each orphan
 * `amm_seed_debit` row, credits the house +abs(amount) and writes a
 * matching `credit_ledger` row with txn_type='amm_orphan_seed_reconciliation'.
 * The health check (after Phase 2 of this change-set) ignores orphans
 * that have a matching reconciliation row, so the failing audit flips
 * green on the next run.
 *
 * Safety:
 *   - Idempotent per orphan via idempotency_key='amm_orphan_recon_<marketId>'.
 *     A repeat run is a no-op (unique constraint on (userId, idempotencyKey)).
 *   - Aborts loudly if any orphan row has txn_type != 'amm_seed_debit'.
 *     We do NOT want to retroactively "fix" a payout or buy that was
 *     orphaned in a different way — that needs a human eye.
 *   - --dry-run prints what it would do without writing.
 *
 * Run with:
 *   npx tsx ops/reconcile-orphan-amm-seeds.ts --dry-run
 *   npx tsx ops/reconcile-orphan-amm-seeds.ts
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

interface OrphanRow {
  id: string;
  marketId: string;
  txnType: string;
  amount: number;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

async function main(): Promise<void> {
  console.log(`\n[reconcile:orphan-amm-seeds]`);
  console.log(`  house id          ${HOUSE_PROFILE_ID}`);
  console.log(`  mode              ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE WRITE"}`);

  if (!process.env.DATABASE_URL) {
    console.error("\n[reconcile:orphan-amm-seeds] DATABASE_URL is not set.");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  const { profiles, creditLedger } = await import("../shared/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { randomUUID } = await import("node:crypto");

  // Find orphan ledger rows: metadata.marketId is set, but no prediction_markets
  // row exists for it. Filter to amm_seed_debit only — the script refuses to
  // touch other txn types (see "Safety" in the header comment).
  const orphans = (await db.execute(sql`
    SELECT cl.id,
           cl.metadata->>'marketId' AS market_id,
           cl.txn_type              AS txn_type,
           cl.amount                AS amount,
           cl.created_at            AS created_at,
           cl.metadata              AS metadata
    FROM credit_ledger cl
    WHERE cl.metadata->>'marketId' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM prediction_markets pm
        WHERE pm.id = cl.metadata->>'marketId'
      )
    ORDER BY cl.created_at ASC
  `)).rows as unknown as Array<{
    id: string;
    market_id: string;
    txn_type: string;
    amount: number;
    created_at: Date;
    metadata: Record<string, unknown> | null;
  }>;

  if (orphans.length === 0) {
    console.log(`\n[reconcile:orphan-amm-seeds] No orphan ledger rows found. Nothing to do.\n`);
    process.exit(0);
  }

  // Refuse to act if anything other than a seed-debit is in the orphan set.
  // Anything else (a stranded payout / buy / sell) needs human review, not
  // a blind house top-up.
  const unsafe = orphans.filter((o) => o.txn_type !== "amm_seed_debit");
  if (unsafe.length > 0) {
    console.error(
      `\n[reconcile:orphan-amm-seeds] Refusing to run: ${unsafe.length} orphan row(s) ` +
      `have txn_type != 'amm_seed_debit'. This script only handles seed-debit orphans.\n`,
    );
    for (const row of unsafe.slice(0, 5)) {
      console.error(
        `  - id=${row.id} marketId=${row.market_id} txn_type=${row.txn_type} amount=${row.amount}`,
      );
    }
    process.exit(1);
  }

  // Group by marketId and sum abs(amount). In practice each market has
  // exactly one seed-debit row, but the loop is general so a bizarre
  // future case (two seeds per market) still reconciles correctly.
  const byMarket = new Map<string, OrphanRow[]>();
  for (const row of orphans) {
    const list = byMarket.get(row.market_id) ?? [];
    list.push({
      id: row.id,
      marketId: row.market_id,
      txnType: row.txn_type,
      amount: row.amount,
      createdAt: row.created_at,
      metadata: row.metadata,
    });
    byMarket.set(row.market_id, list);
  }

  console.log(`\n  orphan markets    ${byMarket.size}`);
  console.log(`  orphan rows       ${orphans.length}`);
  const totalDelta = orphans.reduce((sum, o) => sum + Math.abs(o.amount), 0);
  console.log(`  total to refund   +${totalDelta.toLocaleString()} cr to house`);

  console.log(`\n  per-market breakdown:`);
  for (const [marketId, rows] of byMarket) {
    const sum = rows.reduce((s, r) => s + Math.abs(r.amount), 0);
    const marketType = (rows[0].metadata?.marketType as string | undefined) ?? "?";
    console.log(`    ${marketId}  +${sum.toLocaleString().padStart(6)} cr  (${marketType}, ${rows.length} row${rows.length === 1 ? "" : "s"})`);
  }

  if (DRY_RUN) {
    console.log(`\n[reconcile:orphan-amm-seeds] DRY RUN complete. Re-run without --dry-run to apply.\n`);
    process.exit(0);
  }

  const [house] = await db
    .select({ id: profiles.id, predictCredits: profiles.predictCredits, isHouse: profiles.isHouse })
    .from(profiles)
    .where(eq(profiles.id, HOUSE_PROFILE_ID))
    .limit(1);

  if (!house) {
    console.error(`\n[reconcile:orphan-amm-seeds] House profile ${HOUSE_PROFILE_ID} does not exist. Aborting.\n`);
    process.exit(1);
  }
  if (!house.isHouse) {
    console.error(`\n[reconcile:orphan-amm-seeds] Profile ${HOUSE_PROFILE_ID} exists but is_house=false. Aborting.\n`);
    process.exit(1);
  }

  const runId = randomUUID().slice(0, 8);
  let appliedCount = 0;
  let skippedCount = 0;
  let appliedDelta = 0;

  // One transaction per market, so a unique-key violation on one
  // already-reconciled row (re-run safety) skips that row without
  // rolling back the whole batch.
  for (const [marketId, rows] of byMarket) {
    const sum = rows.reduce((s, r) => s + Math.abs(r.amount), 0);
    const idempotencyKey = `amm_orphan_recon_${marketId}`;
    const marketType = (rows[0].metadata?.marketType as string | undefined) ?? null;
    const numOutcomes = (rows[0].metadata?.numOutcomes as number | undefined) ?? null;

    try {
      await db.transaction(async (tx) => {
        // Pre-check: if a reconciliation row already exists for this
        // marketId, skip cleanly (the unique constraint would also
        // catch it, but this avoids spurious tx aborts in the log).
        const existing = await tx
          .select({ id: creditLedger.id })
          .from(creditLedger)
          .where(
            sql`${creditLedger.userId} = ${HOUSE_PROFILE_ID} AND ${creditLedger.idempotencyKey} = ${idempotencyKey}`,
          )
          .limit(1);
        if (existing.length > 0) {
          throw new SkipMarketError(`already reconciled (ledger id=${existing[0].id})`);
        }

        const [updatedHouse] = await tx
          .update(profiles)
          .set({ predictCredits: sql`${profiles.predictCredits} + ${sum}` })
          .where(eq(profiles.id, HOUSE_PROFILE_ID))
          .returning({ predictCredits: profiles.predictCredits });

        if (!updatedHouse) {
          throw new Error(`House profile ${HOUSE_PROFILE_ID} disappeared mid-transaction.`);
        }

        await tx.insert(creditLedger).values({
          userId: HOUSE_PROFILE_ID,
          txnType: "amm_orphan_seed_reconciliation",
          amount: sum,
          walletType: "VIRTUAL",
          balanceAfter: updatedHouse.predictCredits,
          source: "ops_orphan_reconciliation",
          idempotencyKey,
          metadata: {
            originalMarketId: marketId,
            originalLedgerIds: rows.map((r) => r.id),
            originalMarketType: marketType,
            originalNumOutcomes: numOutcomes,
            originalSeedTotal: sum,
            runId,
            reason:
              "Refund house for seed debit on a hard-deleted AMM market. " +
              "Market was removed from prediction_markets before the AMM resolver " +
              "could write the matching amm_settle_credit, leaving the seed " +
              "permanently down. See ops/reconcile-orphan-amm-seeds.ts.",
            appliedAt: new Date().toISOString(),
          },
        });
      });

      appliedCount += 1;
      appliedDelta += sum;
      console.log(`    [ok]   ${marketId}  +${sum.toLocaleString()} cr`);
    } catch (err) {
      if (err instanceof SkipMarketError) {
        skippedCount += 1;
        console.log(`    [skip] ${marketId}  ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  console.log(`\n[reconcile:orphan-amm-seeds] Done.`);
  console.log(`  markets reconciled  ${appliedCount}`);
  console.log(`  markets skipped     ${skippedCount} (already reconciled)`);
  console.log(`  delta credited      +${appliedDelta.toLocaleString()} cr`);
  console.log(`  ledger tag          amm_orphan_seed_reconciliation (run_id ${runId})`);
  console.log(`\nNext step:`);
  console.log(`  POST /api/cron/amm-health-check (or hit "Run now" in the admin Operations tab)`);
  console.log(`  to confirm the orphan check flips green.\n`);

  process.exit(0);
}

class SkipMarketError extends Error {}

main().catch((err) => {
  console.error("\n[reconcile:orphan-amm-seeds] FAILED:", err);
  process.exit(1);
});
