/**
 * Reconcile warm-start costs destroyed at AMM settlement.
 *
 * Background: before the Phase 1 settle fix, `returnAmmSeedAtSettlement`
 * computed `creditedToHouse = seed + totalUserCreditsIn − payoutLiability`
 * and omitted the warm-start debit (which deliberately never enters
 * `totalUserCreditsIn`). That money left circulation. The seed-return
 * drift health check correctly expected
 * `seed + warmStart + totalIn − payoutLiability`, so every warm-started
 * market has failed the audit by exactly `−warmStartCost` since week 30.
 *
 * The live settle path is now fixed. Settlement is idempotent on
 * `amm_settle_${marketId}`, so already-settled markets stay short until
 * this script credits the missing amount.
 *
 * For each drifted RESOLVED/VOID AMM market with a warm-start debit:
 *   1. Credit the house wallet +warmStartCost.
 *   2. Write `credit_ledger` txn_type='amm_warmstart_settle_reconciliation'
 *      with idempotency_key='amm_warmstart_settle_recon_${marketId}'.
 *   3. Bump `resolution_notes.creditedToHouse` by warmStartCost so the
 *      drift formula balances without rewriting the original settle row.
 *
 * Safety:
 *   - Idempotent per market (unique on userId + idempotencyKey).
 *   - Only touches markets whose computed drift equals −warmStartCost
 *     (±1 credit) — refuses to "fix" unrelated drift.
 *   - --dry-run prints the plan without writing.
 *
 * Run with:
 *   npx tsx ops/reconcile-warmstart-settle-drift.ts --dry-run
 *   npx tsx ops/reconcile-warmstart-settle-drift.ts
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
const TXN_TYPE = "amm_warmstart_settle_reconciliation";

interface DriftRow {
  id: string;
  title: string;
  status: string;
  creditedToHouse: number;
  houseSeedAmount: number;
  warmStartCost: number;
  totalUserCreditsIn: number;
  payoutLiability: number;
  drift: number;
}

function parseNotes(raw: string | null): Record<string, unknown> | null {
  if (!raw || !/^\s*\{/.test(raw)) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`\n[reconcile:warmstart-settle-drift]`);
  console.log(`  house id          ${HOUSE_PROFILE_ID}`);
  console.log(`  mode              ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE WRITE"}`);

  if (!process.env.DATABASE_URL) {
    console.error("\n[reconcile:warmstart-settle-drift] DATABASE_URL is not set.");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  const { profiles, creditLedger, predictionMarkets } = await import("../shared/schema");
  const { eq, sql } = await import("drizzle-orm");

  const [house] = await db
    .select({
      id: profiles.id,
      predictCredits: profiles.predictCredits,
      isHouse: profiles.isHouse,
    })
    .from(profiles)
    .where(eq(profiles.id, HOUSE_PROFILE_ID))
    .limit(1);

  if (!house || !house.isHouse) {
    console.error(
      `\n[reconcile:warmstart-settle-drift] House profile ${HOUSE_PROFILE_ID} missing or is_house=false. Aborting.\n`,
    );
    process.exit(1);
  }

  // Same residual formula as checkSeedReturnDrift — look for markets
  // short by exactly the warm-start cost.
  const rows = (
    await db.execute(sql`
    WITH warmstart AS (
      SELECT
        cl.metadata->>'marketId' AS market_id,
        COALESCE(SUM(-cl.amount), 0)::numeric AS warm_start_cost
      FROM credit_ledger cl
      WHERE cl.txn_type = 'amm_warmstart_debit'
      GROUP BY cl.metadata->>'marketId'
    ),
    resolved AS (
      SELECT
        pm.id,
        pm.title,
        pm.status,
        pm.resolution_notes,
        (pm.resolution_notes::jsonb->>'creditedToHouse')::numeric  AS credited_to_house,
        (pm.resolution_notes::jsonb->>'payoutLiability')::numeric  AS payout_liability,
        mas.house_seed_amount,
        mas.total_user_credits_in,
        COALESCE(ws.warm_start_cost, 0)::numeric AS warm_start_cost
      FROM prediction_markets pm
      JOIN market_amm_state mas ON mas.market_id = pm.id
      JOIN warmstart ws ON ws.market_id = pm.id
      WHERE pm.status IN ('RESOLVED', 'VOID')
        AND pm.engine = 'amm'
        AND pm.resolution_notes IS NOT NULL
        AND pm.resolution_notes ~ '^\\s*\\{'
        AND pm.resolution_notes::jsonb ? 'creditedToHouse'
        AND pm.resolution_notes::jsonb ? 'payoutLiability'
        AND COALESCE(ws.warm_start_cost, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger r
          WHERE r.user_id = ${HOUSE_PROFILE_ID}
            AND r.idempotency_key = 'amm_warmstart_settle_recon_' || pm.id
        )
    )
    SELECT
      id,
      title,
      status,
      credited_to_house,
      house_seed_amount,
      warm_start_cost,
      total_user_credits_in,
      payout_liability,
      (credited_to_house - house_seed_amount - warm_start_cost - total_user_credits_in + payout_liability) AS drift
    FROM resolved
    WHERE ABS(
      credited_to_house - house_seed_amount - warm_start_cost - total_user_credits_in + payout_liability
        + warm_start_cost
    ) <= 1
      AND ABS(
        credited_to_house - house_seed_amount - warm_start_cost - total_user_credits_in + payout_liability
      ) > 1
    ORDER BY warm_start_cost DESC, id
  `)
  ).rows as unknown as Array<{
    id: string;
    title: string;
    status: string;
    credited_to_house: number | string;
    house_seed_amount: number | string;
    warm_start_cost: number | string;
    total_user_credits_in: number | string;
    payout_liability: number | string;
    drift: number | string;
  }>;

  const targets: DriftRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    creditedToHouse: Number(r.credited_to_house),
    houseSeedAmount: Number(r.house_seed_amount),
    warmStartCost: Number(r.warm_start_cost),
    totalUserCreditsIn: Number(r.total_user_credits_in),
    payoutLiability: Number(r.payout_liability),
    drift: Number(r.drift),
  }));

  if (targets.length === 0) {
    console.log(
      `\n[reconcile:warmstart-settle-drift] No warm-start settle drift rows found. Nothing to do.\n`,
    );
    process.exit(0);
  }

  const totalCredit = targets.reduce((s, t) => s + t.warmStartCost, 0);
  console.log(`\n  markets to repair  ${targets.length}`);
  console.log(`  total credit       +${totalCredit.toLocaleString()} credits`);
  console.log(`  house wallet now   ${Number(house.predictCredits).toLocaleString()}`);
  console.log("");

  for (const t of targets.slice(0, 15)) {
    console.log(
      `  ${t.id.slice(0, 8)}  drift=${t.drift}  warmStart=${t.warmStartCost}  ` +
        `credited=${t.creditedToHouse}  [${t.status}] ${t.title}`,
    );
  }
  if (targets.length > 15) {
    console.log(`  … and ${targets.length - 15} more`);
  }

  if (DRY_RUN) {
    console.log(
      `\n[reconcile:warmstart-settle-drift] DRY RUN complete. Re-run without --dry-run to apply.\n`,
    );
    process.exit(0);
  }

  let credited = 0;
  let notesUpdated = 0;
  let skipped = 0;

  for (const t of targets) {
    const idempotencyKey = `amm_warmstart_settle_recon_${t.id}`;
    const creditAmount = Math.round(t.warmStartCost);
    if (creditAmount <= 0) {
      skipped++;
      continue;
    }

    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(
          sql`${creditLedger.userId} = ${HOUSE_PROFILE_ID} AND ${creditLedger.idempotencyKey} = ${idempotencyKey}`,
        )
        .limit(1);
      if (existing.length > 0) {
        skipped++;
        return;
      }

      const [updatedHouse] = await tx
        .update(profiles)
        .set({
          predictCredits: sql`${profiles.predictCredits} + ${creditAmount}`,
        })
        .where(eq(profiles.id, HOUSE_PROFILE_ID))
        .returning({ predictCredits: profiles.predictCredits });

      if (!updatedHouse) {
        throw new Error(`House profile missing mid-transaction for market ${t.id}`);
      }

      await tx.insert(creditLedger).values({
        userId: HOUSE_PROFILE_ID,
        txnType: TXN_TYPE,
        amount: creditAmount,
        walletType: "VIRTUAL",
        balanceAfter: updatedHouse.predictCredits,
        source: "ops_warmstart_settle_reconciliation",
        idempotencyKey,
        metadata: {
          marketId: t.id,
          warmStartCost: creditAmount,
          previousCreditedToHouse: t.creditedToHouse,
          reason: "restore warm-start cost omitted from pre-fix amm_settle residual",
        },
      });
      credited++;

      const [market] = await tx
        .select({ resolutionNotes: predictionMarkets.resolutionNotes })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, t.id))
        .limit(1);

      const notes = parseNotes(market?.resolutionNotes ?? null);
      if (!notes || typeof notes.creditedToHouse !== "number") {
        console.warn(
          `  [warn] ${t.id}: ledger credited but resolution_notes missing creditedToHouse — audit may still flag until notes are patched`,
        );
        return;
      }

      const nextNotes = {
        ...notes,
        creditedToHouse: Number(notes.creditedToHouse) + creditAmount,
        warmStartCost:
          typeof notes.warmStartCost === "number"
            ? notes.warmStartCost
            : creditAmount,
        warmStartSettleReconciliation: creditAmount,
      };

      await tx
        .update(predictionMarkets)
        .set({
          resolutionNotes: JSON.stringify(nextNotes),
          updatedAt: new Date(),
        })
        .where(eq(predictionMarkets.id, t.id));
      notesUpdated++;
    });
  }

  console.log(`\n[reconcile:warmstart-settle-drift] Done.`);
  console.log(`  ledger credits      ${credited}`);
  console.log(`  notes updated       ${notesUpdated}`);
  console.log(`  skipped             ${skipped}`);
  console.log(
    `  Refresh AMM health — seed-return drift should clear for these markets.\n`,
  );
}

main().catch((err) => {
  console.error("[reconcile:warmstart-settle-drift] Failed:", err);
  process.exit(1);
});
