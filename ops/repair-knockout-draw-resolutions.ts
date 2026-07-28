/**
 * Repair knockout World Markets that were incorrectly resolved to Draw
 * using Polymarket's 90-minute moneyline.
 *
 * Background (2026-07-13):
 *   Norway vs England and Switzerland vs Colombia are knockout ties.
 *   Both were level after regulation and decided in ET/penalties, but
 *   VoxDex mirrored Polymarket's regulation-time "Draw" winner. Under
 *   the single-winner knockout model the correct winners are England
 *   and Switzerland respectively.
 *
 * This script (idempotent, transactional per market):
 *   1. Reverses prior amm_payout / amm_warmstart_payout / amm_settle_credit
 *      ledger rows and restores wallets.
 *   2. Reverses prediction_win XP for the prior settlement
 *      (matches both legacy per-bet keys and the canonical
 *      prediction_win_<marketId>_<userId> key via LIKE prefix).
 *   3. Resets market_bets / market_entries / market status to CLOSED_PENDING.
 *   4. Calls resolveAmmMarket with the correct winner.
 *   5. Stamps resolution evidence + admin_audit_log.
 *   6. Backfills metadata.singleWinnerKnockout on the open France vs Spain
 *      semi (Draw outcome kept; settle guard blocks Draw).
 *
 * Run:
 *   npx tsx --env-file=.env ops/repair-knockout-draw-resolutions.ts --dry-run
 *   npx tsx --env-file=.env ops/repair-knockout-draw-resolutions.ts --apply
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DRY_RUN = !APPLY;

const HOUSE_PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";
const ADMIN_ID = "035adc7b-6087-421e-b635-b6b9ad2c8cd2"; // Randy_Andy

interface RepairTarget {
  marketId: string;
  titleContains: string;
  correctWinnerLabel: string;
  expectedWrongWinnerLabel: string;
}

const TARGETS: RepairTarget[] = [
  {
    marketId: "ada06988-98f7-41c7-8680-3147a0d910ce",
    titleContains: "Norway vs England",
    correctWinnerLabel: "England",
    expectedWrongWinnerLabel: "Draw",
  },
  {
    marketId: "82792c41-2b6a-4a51-8f29-c4de945cc6a8",
    titleContains: "Switzerland vs Colombia",
    correctWinnerLabel: "Switzerland",
    expectedWrongWinnerLabel: "Draw",
  },
];

/** Open knockout to flag (do not remove Draw mid-flight). */
const FLAG_OPEN_MARKET_ID = "f6f984bf-6f85-4ad3-8143-f6ec8c8da543"; // France vs Spain

async function main(): Promise<void> {
  console.log(`\n[repair-knockout-draw-resolutions]`);
  console.log(`  mode  ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE APPLY"}`);

  if (!process.env.DATABASE_URL) {
    console.error("\nDATABASE_URL is not set.");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  const {
    profiles,
    creditLedger,
    xpLedger,
    marketBets,
    marketEntries,
    predictionMarkets,
    adminAuditLog,
  } = await import("../shared/schema");
  const { eq, and, sql, like, inArray } = await import("drizzle-orm");
  const { resolveAmmMarket } = await import("../server/services/amm-resolver");
  const { syncProfilePredictionStats } = await import(
    "../server/services/profile-prediction-stats"
  );

  for (const target of TARGETS) {
    console.log(`\n── ${target.titleContains} (${target.marketId.slice(0, 8)}) ──`);

    const [market] = await db
      .select({
        id: predictionMarkets.id,
        title: predictionMarkets.title,
        status: predictionMarkets.status,
        metadata: predictionMarkets.metadata,
        resolutionSummary: predictionMarkets.resolutionSummary,
        resolutionNotes: predictionMarkets.resolutionNotes,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, target.marketId))
      .limit(1);

    if (!market) {
      console.error(`  SKIP: market not found`);
      continue;
    }
    if (!market.title.includes(target.titleContains.split(" ")[0]!)) {
      console.error(`  SKIP: title mismatch "${market.title}"`);
      continue;
    }
    if (market.status !== "RESOLVED") {
      console.error(`  SKIP: status=${market.status} (expected RESOLVED)`);
      continue;
    }

    const entries = await db
      .select({
        id: marketEntries.id,
        label: marketEntries.label,
        resolutionStatus: marketEntries.resolutionStatus,
      })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, target.marketId));

    const wrongWinner = entries.find(
      (e) =>
        e.resolutionStatus === "winner" &&
        e.label.trim().toLowerCase() === target.expectedWrongWinnerLabel.toLowerCase(),
    );
    const correctWinner = entries.find(
      (e) => e.label.trim().toLowerCase() === target.correctWinnerLabel.toLowerCase(),
    );

    if (!wrongWinner) {
      // Already repaired?
      const alreadyCorrect = entries.find(
        (e) =>
          e.resolutionStatus === "winner" &&
          e.label.trim().toLowerCase() === target.correctWinnerLabel.toLowerCase(),
      );
      if (alreadyCorrect) {
        console.log(
          `  OK: already resolved to ${target.correctWinnerLabel} — nothing to do`,
        );
        continue;
      }
      console.error(
        `  SKIP: expected wrong winner "${target.expectedWrongWinnerLabel}" not found`,
      );
      continue;
    }
    if (!correctWinner) {
      console.error(`  SKIP: correct winner entry "${target.correctWinnerLabel}" not found`);
      continue;
    }

    const payoutRows = await db
      .select({
        id: creditLedger.id,
        userId: creditLedger.userId,
        amount: creditLedger.amount,
        txnType: creditLedger.txnType,
        idempotencyKey: creditLedger.idempotencyKey,
      })
      .from(creditLedger)
      .where(
        and(
          inArray(creditLedger.txnType, ["amm_payout", "amm_warmstart_payout"]),
          like(creditLedger.idempotencyKey, `%${target.marketId}%`),
        ),
      );

    const [settleRow] = await db
      .select({
        id: creditLedger.id,
        userId: creditLedger.userId,
        amount: creditLedger.amount,
        idempotencyKey: creditLedger.idempotencyKey,
      })
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, `amm_settle_${target.marketId}`))
      .limit(1);

    const xpRows = await db
      .select({
        id: xpLedger.id,
        userId: xpLedger.userId,
        xpDelta: xpLedger.xpDelta,
        idempotencyKey: xpLedger.idempotencyKey,
      })
      .from(xpLedger)
      .where(like(xpLedger.idempotencyKey, `prediction_win_${target.marketId}_%`));

    const buyCount = (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(marketBets)
        .where(
          and(
            eq(marketBets.marketId, target.marketId),
            eq(marketBets.actionType, "buy"),
          ),
        )
    )[0]?.n ?? 0;

    console.log(`  title            ${market.title}`);
    console.log(`  wrong winner     ${wrongWinner.label} (${wrongWinner.id.slice(0, 8)})`);
    console.log(`  correct winner   ${correctWinner.label} (${correctWinner.id.slice(0, 8)})`);
    console.log(`  payout rows      ${payoutRows.length} (Σ ${payoutRows.reduce((s, r) => s + (r.amount ?? 0), 0)})`);
    console.log(`  settle credit    ${settleRow ? settleRow.amount : 0}`);
    console.log(`  xp rows          ${xpRows.length}`);
    console.log(`  buy bets         ${buyCount}`);

    if (DRY_RUN) {
      console.log(`  → dry-run: would reverse settlement and re-resolve to ${correctWinner.label}`);
      continue;
    }

    // --- LIVE APPLY ---
    await db.transaction(async (tx) => {
      // 1. Reverse user/house payouts
      for (const row of payoutRows) {
        await tx
          .update(profiles)
          .set({
            predictCredits: sql`GREATEST(0, ${profiles.predictCredits} - ${row.amount ?? 0})`,
          })
          .where(eq(profiles.id, row.userId));
        await tx.delete(creditLedger).where(eq(creditLedger.id, row.id));
      }

      // 2. Reverse house settle credit
      if (settleRow) {
        await tx
          .update(profiles)
          .set({
            predictCredits: sql`GREATEST(0, ${profiles.predictCredits} - ${settleRow.amount ?? 0})`,
          })
          .where(eq(profiles.id, settleRow.userId));
        await tx.delete(creditLedger).where(eq(creditLedger.id, settleRow.id));
      }

      // 3. Reverse prediction_win XP
      for (const row of xpRows) {
        await tx
          .update(profiles)
          .set({
            xpPoints: sql`GREATEST(0, ${profiles.xpPoints} - ${row.xpDelta ?? 0})`,
          })
          .where(eq(profiles.id, row.userId));
        await tx.delete(xpLedger).where(eq(xpLedger.id, row.id));
      }

      // 4. Reset bets (buys only — sells already settled at trade time)
      await tx
        .update(marketBets)
        .set({
          status: "active",
          payoutAmount: 0,
          settledAt: null,
        })
        .where(
          and(
            eq(marketBets.marketId, target.marketId),
            eq(marketBets.actionType, "buy"),
          ),
        );

      // 5. Reset entries
      await tx
        .update(marketEntries)
        .set({ resolutionStatus: "pending" })
        .where(eq(marketEntries.marketId, target.marketId));

      // 6. Re-open for resolver (CLOSED_PENDING)
      const meta =
        market.metadata && typeof market.metadata === "object"
          ? { ...(market.metadata as Record<string, unknown>) }
          : {};
      meta.singleWinnerKnockout = true;
      meta.drawEligible = false;
      meta.knockoutRepair = {
        repairedAt: new Date().toISOString(),
        previousWinnerLabel: wrongWinner.label,
        correctWinnerLabel: correctWinner.label,
        reason: "knockout_draw_misresolution",
      };

      await tx
        .update(predictionMarkets)
        .set({
          status: "CLOSED_PENDING",
          resolvedAt: null,
          settledBy: null,
          resolutionSummary: null,
          resolutionNotes: JSON.stringify({
            type: "community",
            pendingReason: "knockout_draw_repair",
          }),
          metadata: meta,
          updatedAt: new Date(),
        })
        .where(eq(predictionMarkets.id, target.marketId));
    });

    // 7. Re-resolve outside the reset tx (resolver opens its own tx)
    const ammResult = await resolveAmmMarket({
      marketId: target.marketId,
      winnerEntryId: correctWinner.id,
      voidMarket: false,
      settledBy: ADMIN_ID,
    });

    if ("error" in ammResult) {
      console.error(`  ERROR re-resolving: ${ammResult.error} — ${ammResult.message}`);
      process.exitCode = 1;
      continue;
    }

    await db
      .update(predictionMarkets)
      .set({
        resolveMethod: "admin_manual",
        settledBy: ADMIN_ID,
        resolutionNotes: JSON.stringify({
          type: "community",
          outcome: correctWinner.label,
          winnerEntryId: correctWinner.id,
          resolvedAt: new Date().toISOString(),
          adminNotes: `Knockout repair: was incorrectly resolved Draw (90-min Polymarket); corrected to ${correctWinner.label} (advancing team).`,
        }),
        resolutionSummary: `${correctWinner.label} advanced (knockout repair — includes extra time / penalties; Draw was the incorrect 90-minute mirror).`,
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, target.marketId));

    await db.insert(adminAuditLog).values({
      adminId: ADMIN_ID,
      adminEmail: null,
      actionType: "repair_knockout_draw_resolution",
      targetTable: "prediction_markets",
      targetId: target.marketId,
      previousData: {
        winner: wrongWinner.label,
        resolutionSummary: market.resolutionSummary,
      },
      newData: {
        winner: correctWinner.label,
        payoutLiability: ammResult.payoutLiability,
        settledUserCount: ammResult.settledUserCount,
      },
      metadata: {
        reason: "knockout_single_winner_model",
        script: "ops/repair-knockout-draw-resolutions.ts",
      },
    });

    // Sync prediction stats for affected human(s)
    const affectedUsers = await db
      .selectDistinct({ userId: marketBets.userId })
      .from(marketBets)
      .where(eq(marketBets.marketId, target.marketId));
    for (const u of affectedUsers) {
      void syncProfilePredictionStats(u.userId);
    }

    console.log(
      `  DONE: re-resolved → ${correctWinner.label} ` +
        `(payoutLiability=${ammResult.payoutLiability}, users=${ammResult.settledUserCount})`,
    );
  }

  // --- Flag open France vs Spain as single-winner knockout ---
  console.log(`\n── Flag open France vs Spain (${FLAG_OPEN_MARKET_ID.slice(0, 8)}) ──`);
  const [openMkt] = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      status: predictionMarkets.status,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(eq(predictionMarkets.id, FLAG_OPEN_MARKET_ID))
    .limit(1);

  if (!openMkt) {
    console.log(`  SKIP: market not found`);
  } else if (openMkt.status !== "OPEN" && openMkt.status !== "CLOSED_PENDING") {
    console.log(`  SKIP: status=${openMkt.status}`);
  } else {
    const meta =
      openMkt.metadata && typeof openMkt.metadata === "object"
        ? { ...(openMkt.metadata as Record<string, unknown>) }
        : {};
    const already =
      meta.singleWinnerKnockout === true || meta.drawEligible === false;
    console.log(`  title  ${openMkt.title}`);
    console.log(`  flag   ${already ? "already set" : "will set singleWinnerKnockout"}`);
    if (!DRY_RUN && !already) {
      meta.singleWinnerKnockout = true;
      meta.drawEligible = false;
      await db
        .update(predictionMarkets)
        .set({ metadata: meta, updatedAt: new Date() })
        .where(eq(predictionMarkets.id, FLAG_OPEN_MARKET_ID));
      console.log(`  DONE: flagged`);
    } else if (DRY_RUN && !already) {
      console.log(`  → dry-run: would flag singleWinnerKnockout`);
    }
  }

  console.log(
    `\n[repair-knockout-draw-resolutions] complete (${DRY_RUN ? "dry-run" : "applied"}).\n`,
  );
  if (DRY_RUN) {
    console.log(`Re-run with --apply to write changes.\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
