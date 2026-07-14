/**
 * Repair Drake Up/Down AMM state drift + house over-settle.
 *
 * Background (2026-07-11 investigation):
 *   Market 06e7faa0-1407-4d8a-9d53-ed48ede5f1c0 ("Drake: Up or Down?")
 *   resolved with inflated `market_amm_state`:
 *     total_user_credits_in = 7753  (bets+ledger net = 7253, Δ +500)
 *     one outcome's share_quantities drifted +~1083 vs SUM(market_bets)
 *   Settlement used the inflated credits-in, so house received
 *   amm_settle_credit 3521 instead of the correct 3021 (Δ +500).
 *
 * This script (idempotent, transactional):
 *   1. Replays buy/sell bets to recompute share_quantities + credits-in.
 *   2. Writes those values onto market_amm_state.
 *   3. Reduces the existing amm_settle_credit from 3521 → 3021 and
 *      patches resolution_notes so seed-return arithmetic stays clean.
 *   4. Debits the house wallet by 500 so profile ↔ ledger stay matched.
 *
 * Run:
 *   npx tsx ops/repair-drake-state-drift.ts --dry-run
 *   npx tsx ops/repair-drake-state-drift.ts
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const MARKET_ID = "06e7faa0-1407-4d8a-9d53-ed48ede5f1c0";
const HOUSE_PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";
const EXPECTED_CREDIT_DRIFT = 500;
const SETTLE_IDEMPOTENCY_KEY = `amm_settle_${MARKET_ID}`;

async function main(): Promise<void> {
  console.log(`\n[repair-drake-state-drift]`);
  console.log(`  market   ${MARKET_ID}`);
  console.log(`  house    ${HOUSE_PROFILE_ID}`);
  console.log(`  mode     ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE WRITE"}`);

  if (!process.env.DATABASE_URL) {
    console.error("\n[repair-drake-state-drift] DATABASE_URL is not set.");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  const { profiles, creditLedger, marketAmmState, predictionMarkets } =
    await import("../shared/schema");
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

  if (!house?.isHouse) {
    console.error(`\n[repair-drake-state-drift] House profile missing or is_house=false.`);
    process.exit(1);
  }

  const [market] = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      status: predictionMarkets.status,
      resolutionNotes: predictionMarkets.resolutionNotes,
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, MARKET_ID))
    .limit(1);

  if (!market) {
    console.error(`\n[repair-drake-state-drift] Market ${MARKET_ID} not found.`);
    process.exit(1);
  }
  if (market.status !== "RESOLVED") {
    console.error(
      `\n[repair-drake-state-drift] Refusing: market status is ${market.status}, expected RESOLVED.`,
    );
    process.exit(1);
  }

  const [state] = await db
    .select({
      shareQuantities: marketAmmState.shareQuantities,
      totalUserCreditsIn: marketAmmState.totalUserCreditsIn,
      outcomeOrder: marketAmmState.outcomeOrder,
      houseSeedAmount: marketAmmState.houseSeedAmount,
    })
    .from(marketAmmState)
    .where(eq(marketAmmState.marketId, MARKET_ID))
    .limit(1);

  if (!state?.outcomeOrder) {
    console.error(`\n[repair-drake-state-drift] No market_amm_state row.`);
    process.exit(1);
  }

  const bets = (
    await db.execute(sql`
      SELECT action_type, entry_id, share_count::float8 AS shares, stake_amount
      FROM market_bets
      WHERE market_id = ${MARKET_ID}
        AND action_type IN ('buy', 'sell')
      ORDER BY created_at, id
    `)
  ).rows as Array<{
    action_type: string;
    entry_id: string;
    shares: number;
    stake_amount: number;
  }>;

  const replayQ: Record<string, number> = {};
  for (const id of state.outcomeOrder) replayQ[id] = 0;
  let replayCredits = 0;
  for (const b of bets) {
    if (b.action_type === "buy") {
      replayQ[b.entry_id] = (replayQ[b.entry_id] ?? 0) + Number(b.shares);
      replayCredits += Number(b.stake_amount);
    } else {
      replayQ[b.entry_id] = (replayQ[b.entry_id] ?? 0) - Number(b.shares);
      replayCredits += Number(b.stake_amount);
    }
  }

  const stateCredits = Number(state.totalUserCreditsIn);
  const creditDrift = stateCredits - replayCredits;
  const shareQuantities = (state.shareQuantities ?? {}) as Record<string, number>;

  console.log(`\n  title              ${market.title}`);
  console.log(`  bets               ${bets.length}`);
  console.log(`  state credits-in   ${stateCredits}`);
  console.log(`  replay credits-in  ${replayCredits}`);
  console.log(`  credits drift      ${creditDrift >= 0 ? "+" : ""}${creditDrift}`);

  for (const id of state.outcomeOrder) {
    const sq = Number(shareQuantities[id] ?? 0);
    const rq = replayQ[id] ?? 0;
    console.log(
      `  entry ${id.slice(0, 8)}  state=${sq.toFixed(6)}  replay=${rq.toFixed(6)}  drift=${(sq - rq).toFixed(6)}`,
    );
  }

  const [settle] = await db
    .select({
      id: creditLedger.id,
      amount: creditLedger.amount,
      metadata: creditLedger.metadata,
      idempotencyKey: creditLedger.idempotencyKey,
    })
    .from(creditLedger)
    .where(
      sql`${creditLedger.userId} = ${HOUSE_PROFILE_ID}
        AND ${creditLedger.idempotencyKey} = ${SETTLE_IDEMPOTENCY_KEY}`,
    )
    .limit(1);

  if (!settle) {
    console.error(`\n[repair-drake-state-drift] Missing amm_settle_credit ${SETTLE_IDEMPOTENCY_KEY}.`);
    process.exit(1);
  }

  // Prefer payoutLiability from resolution_notes (same source the
  // seed-return drift audit uses); fall back to settle metadata.
  let notes: Record<string, unknown> = {};
  if (market.resolutionNotes && /^\s*\{/.test(market.resolutionNotes)) {
    notes = JSON.parse(market.resolutionNotes) as Record<string, unknown>;
  }
  const settleMeta = (settle.metadata ?? {}) as Record<string, unknown>;
  const payoutLiability = Number(notes.payoutLiability ?? settleMeta.payoutLiability);
  if (!Number.isFinite(payoutLiability)) {
    console.error(`\n[repair-drake-state-drift] Cannot resolve payoutLiability.`);
    process.exit(1);
  }

  const expectedSettle = Math.round(state.houseSeedAmount + replayCredits - payoutLiability);
  const settleClawback = settle.amount - expectedSettle;

  console.log(`\n  house seed         ${state.houseSeedAmount}`);
  console.log(`  payout liability   ${payoutLiability}`);
  console.log(`  settle amount now  ${settle.amount}`);
  console.log(`  settle expected    ${expectedSettle}`);
  console.log(`  settle clawback    ${settleClawback >= 0 ? "+" : ""}${settleClawback}`);
  console.log(`  house wallet now   ${house.predictCredits.toLocaleString()}`);

  // Already repaired?
  if (Math.abs(creditDrift) < 0.5 && settle.amount === expectedSettle) {
    console.log(`\n[repair-drake-state-drift] Already repaired. Nothing to do.\n`);
    process.exit(0);
  }

  // Safety rails — refuse surprises.
  if (Math.abs(creditDrift - EXPECTED_CREDIT_DRIFT) > 0.5 && Math.abs(creditDrift) > 0.5) {
    console.error(
      `\n[repair-drake-state-drift] Refusing: credit drift is ${creditDrift}, expected ~${EXPECTED_CREDIT_DRIFT}.`,
    );
    process.exit(1);
  }
  if (settleClawback !== EXPECTED_CREDIT_DRIFT && settle.amount !== expectedSettle) {
    console.error(
      `\n[repair-drake-state-drift] Refusing: settle clawback is ${settleClawback}, expected ${EXPECTED_CREDIT_DRIFT}.`,
    );
    process.exit(1);
  }
  if (expectedSettle !== 3021 && settle.amount !== expectedSettle) {
    console.error(
      `\n[repair-drake-state-drift] Refusing: expected settle ${expectedSettle} != 3021 (investigation constant).`,
    );
    process.exit(1);
  }

  console.log(`\n  [plan] rebase share_quantities + total_user_credits_in → replay`);
  console.log(`  [plan] amm_settle_credit ${settle.amount} → ${expectedSettle}`);
  console.log(`  [plan] resolution_notes.creditedToHouse → ${expectedSettle}`);
  console.log(`  [plan] house predict_credits ${house.predictCredits} → ${house.predictCredits - settleClawback}`);

  if (DRY_RUN) {
    console.log(`\n[repair-drake-state-drift] DRY RUN complete. Re-run without --dry-run to apply.\n`);
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    const [liveHouse] = await tx
      .select({ predictCredits: profiles.predictCredits, isHouse: profiles.isHouse })
      .from(profiles)
      .where(eq(profiles.id, HOUSE_PROFILE_ID))
      .limit(1);
    if (!liveHouse?.isHouse) throw new Error("House disappeared mid-run");

    const [liveSettle] = await tx
      .select({ id: creditLedger.id, amount: creditLedger.amount, metadata: creditLedger.metadata })
      .from(creditLedger)
      .where(
        sql`${creditLedger.userId} = ${HOUSE_PROFILE_ID}
          AND ${creditLedger.idempotencyKey} = ${SETTLE_IDEMPOTENCY_KEY}`,
      )
      .limit(1);
    if (!liveSettle) throw new Error("Settle row disappeared mid-run");
    if (liveSettle.amount === expectedSettle) {
      throw new Error("Settle already corrected between preflight and write — re-run.");
    }
    if (liveSettle.amount - expectedSettle !== settleClawback) {
      throw new Error(
        `Settle amount changed (was ${settle.amount}, live ${liveSettle.amount}). Re-run.`,
      );
    }

    await tx
      .update(marketAmmState)
      .set({
        shareQuantities: replayQ,
        totalUserCreditsIn: String(replayCredits),
        updatedAt: new Date(),
      })
      .where(eq(marketAmmState.marketId, MARKET_ID));

    const newNotes = {
      ...notes,
      creditedToHouse: expectedSettle,
      totalUserCreditsIn: replayCredits,
      payoutLiability,
      stateDriftRepair: {
        repairedAt: new Date().toISOString(),
        previousCreditsIn: stateCredits,
        previousCreditedToHouse: notes.creditedToHouse ?? settle.amount,
        previousSettleAmount: liveSettle.amount,
        reason:
          "Rebased market_amm_state to bet replay and clawed back house over-settle of 500. See ops/repair-drake-state-drift.ts.",
      },
    };

    await tx
      .update(predictionMarkets)
      .set({ resolutionNotes: JSON.stringify(newNotes) })
      .where(eq(predictionMarkets.id, MARKET_ID));

    const prevMeta = (liveSettle.metadata ?? {}) as Record<string, unknown>;
    await tx
      .update(creditLedger)
      .set({
        amount: expectedSettle,
        metadata: {
          ...prevMeta,
          marketId: MARKET_ID,
          houseSeedAmount: state.houseSeedAmount,
          payoutLiability,
          totalUserCreditsIn: replayCredits,
          correctedFromAmount: liveSettle.amount,
          correctionReason:
            "Drake state drift repair: settle used inflated totalUserCreditsIn (7753→7253). See ops/repair-drake-state-drift.ts.",
          correctedAt: new Date().toISOString(),
        },
      })
      .where(eq(creditLedger.id, liveSettle.id));

    const [updatedHouse] = await tx
      .update(profiles)
      .set({ predictCredits: sql`${profiles.predictCredits} - ${settleClawback}` })
      .where(
        sql`${profiles.id} = ${HOUSE_PROFILE_ID} AND ${profiles.predictCredits} >= ${settleClawback}`,
      )
      .returning({ predictCredits: profiles.predictCredits });

    if (!updatedHouse) {
      throw new Error(`House wallet too low to claw back ${settleClawback}`);
    }

    // Append-only audit crumb (amount 0) so the correction is visible in
    // ledger history without double-counting the settle amount change.
    await tx.insert(creditLedger).values({
      userId: HOUSE_PROFILE_ID,
      txnType: "amm_settle_correction_marker",
      amount: 0,
      walletType: "VIRTUAL",
      balanceAfter: updatedHouse.predictCredits,
      source: "ops_drake_state_drift_repair",
      idempotencyKey: `amm_settle_correction_${MARKET_ID}`,
      metadata: {
        marketId: MARKET_ID,
        clawbackAmount: settleClawback,
        settleLedgerId: liveSettle.id,
        previousSettleAmount: liveSettle.amount,
        newSettleAmount: expectedSettle,
        previousCreditsIn: stateCredits,
        newCreditsIn: replayCredits,
        reason:
          "Marker for Drake AMM state/settle repair. Economic clawback is the " +
          "amm_settle_credit amount edit + house wallet debit in the same txn.",
        appliedAt: new Date().toISOString(),
      },
    });
  });

  const [afterHouse] = await db
    .select({ predictCredits: profiles.predictCredits })
    .from(profiles)
    .where(eq(profiles.id, HOUSE_PROFILE_ID))
    .limit(1);
  const afterLedger = await db
    .select({ total: sql<string>`COALESCE(SUM(${creditLedger.amount}), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, HOUSE_PROFILE_ID));
  const [afterState] = await db
    .select({
      totalUserCreditsIn: marketAmmState.totalUserCreditsIn,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(eq(marketAmmState.marketId, MARKET_ID))
    .limit(1);

  console.log(`\n[repair-drake-state-drift] Done.`);
  console.log(`  state credits-in   ${afterState?.totalUserCreditsIn}`);
  console.log(`  house wallet       ${Number(afterHouse?.predictCredits ?? 0).toLocaleString()}`);
  console.log(`  house ledger sum   ${Number(afterLedger[0]?.total ?? 0).toLocaleString()}`);
  console.log(
    `  wallet−ledger      ${Number(afterHouse?.predictCredits ?? 0) - Number(afterLedger[0]?.total ?? 0)}`,
  );
  console.log(`\nNext: refresh AMM Health — state_vs_bets_* for Drake should clear.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[repair-drake-state-drift] FAILED:", err);
  process.exit(1);
});
