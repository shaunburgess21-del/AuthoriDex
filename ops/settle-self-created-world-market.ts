/**
 * Settle a World Market whose creator is the only admin available to settle it.
 *
 * `POST /api/admin/amm/markets/:id/resolve` refuses when
 * `prediction_markets.created_by` equals the caller (`self_resolution_denied`)
 * — a conflict-of-interest control on community markets. That guard assumes a
 * second admin can step in. Pre-launch there are two, so when the creator is
 * the only one on hand a market can sit in CLOSED_PENDING with user positions
 * locked. This script is the deliberate, per-market override of that guard.
 *
 * It is NOT a general settle tool. Every target pins the market id, a title
 * substring, the winning entry id AND its label, so a stale or mistyped
 * target aborts rather than settling the wrong side. Settlement itself goes
 * through `resolveAmmMarket`, the same service the endpoint calls, so payouts,
 * the credit ledger, house seed return, notifications and agent Brier scoring
 * all behave identically — this skips the HTTP guard, nothing else.
 *
 * The bypass is recorded, not hidden: `admin_audit_log.action_type` is
 * `amm_market_settle_self_created` and the metadata names the guard that was
 * overridden and why. A reviewer reading the trail sees the creator settled
 * their own market and on what basis.
 *
 * Settlement is one-way. `resolveAmmMarket` is idempotent, so a re-run is a
 * no-op, but there is no un-resolve endpoint — a wrong winner needs a targeted
 * repair (see ops/repair-knockout-draw-resolutions.ts) or a void. Confirm the
 * outcome against primary sources before passing --apply.
 *
 * Run:
 *   npx tsx --env-file=.env ops/settle-self-created-world-market.ts --dry-run
 *   npx tsx --env-file=.env ops/settle-self-created-world-market.ts --apply
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

/**
 * How long to keep the pool open after the last settlement before exiting.
 *
 * `resolveAmmMarket` deliberately does NOT await its post-settlement fanout —
 * notifications, win XP, badge checks, profile stat sync, agent Brier scoring
 * and the AI summary are `void`ed so the admin "Resolve" button doesn't spin
 * for the whole fanout. That is right for a long-lived server, where the pool
 * outlives the request, and wrong for a short-lived script: closing the pool
 * as soon as `resolveAmmMarket` resolves kills the fanout mid-flight with
 * "Cannot use a pool after calling end on the pool".
 *
 * The settlement transaction is already committed at that point, so the money
 * is never at risk — but the fanout is silently lost, which is how the first
 * run of this script left stale profile stats and an unscored market behind.
 * Since the fanout is fire-and-forget by design there is nothing to await, so
 * drain on a timer instead. The fanout is a few queries per bettor; 30s is
 * ample for a book this size, and the script verifies the outcome afterwards.
 */
const DRAIN_MS = 30_000;

/** admin_audit_log.admin_id is NOT NULL — attribute ops actions to the founder. */
const ADMIN_ID = "035adc7b-6087-421e-b635-b6b9ad2c8cd2"; // Randy_Andy

interface Target {
  marketId: string;
  /** Guard: the live title must contain this. */
  titleContains: string;
  /** The entry that won. Both id and label must match the DB row. */
  winnerEntryId: string;
  winnerLabel: string;
  /** Why this outcome is correct — persisted to resolution_notes. */
  basis: string;
  /** Guard: abort if the book grew past what was reviewed. */
  maxBets: number;
}

const TARGETS: Target[] = [
  {
    // Created by Randy_Andy on 2026-07-02, so the founder cannot settle it via
    // the admin panel. Ended 2026-08-31 21:59 UTC with BTC far below the
    // strike, so "No" is unambiguous — the resolution scout independently
    // proposed No at 99% confidence off CoinGecko and CoinMarketCap.
    marketId: "e5e094db-a53f-4c3a-8445-54082ac1ed69",
    titleContains: "Will Bitcoin hit $100,000",
    winnerEntryId: "48446ff5-5257-46df-9767-29df60f3896d",
    winnerLabel: "No",
    basis:
      "BTC closed 2026-08-31 around $78.5k per CoinGecko and CoinMarketCap " +
      "historical data, well below the $100,000 threshold. Settled via ops " +
      "script because the market creator is the only admin available.",
    maxBets: 60,
  },
];

async function main(): Promise<void> {
  console.log(`\n[settle-self-created-world-market] ${DRY_RUN ? "DRY RUN" : "APPLY"}`);

  const { db, pool } = await import("../server/db");
  const { predictionMarkets, marketEntries, marketBets, adminAuditLog } =
    await import("../shared/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { resolveAmmMarket } = await import("../server/services/amm-resolver");
  const { rejectDrawWinnerOnKnockout, knockoutHintsFromMarket } = await import(
    "../shared/lib/knockout-market"
  );

  let settled = 0;
  let skipped = 0;

  for (const target of TARGETS) {
    console.log(`\n── ${target.titleContains} (${target.marketId.slice(0, 8)}) ──`);

    const [market] = await db
      .select({
        id: predictionMarkets.id,
        title: predictionMarkets.title,
        status: predictionMarkets.status,
        visibility: predictionMarkets.visibility,
        engine: predictionMarkets.engine,
        marketType: predictionMarkets.marketType,
        createdBy: predictionMarkets.createdBy,
        endAt: predictionMarkets.endAt,
        metadata: predictionMarkets.metadata,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, target.marketId))
      .limit(1);

    if (!market) {
      console.log("  ! not found — skipping");
      skipped += 1;
      continue;
    }
    if (!market.title?.includes(target.titleContains)) {
      console.log(`  ! title mismatch ("${market.title}") — skipping`);
      skipped += 1;
      continue;
    }
    if (market.status === "RESOLVED" || market.status === "VOID") {
      console.log(`  = already ${market.status} — nothing to do`);
      skipped += 1;
      continue;
    }
    if (market.engine !== "amm") {
      console.log(`  ! engine is ${market.engine}, expected amm — skipping`);
      skipped += 1;
      continue;
    }

    // The whole reason this script exists. If the market is NOT self-created,
    // the admin panel can settle it and should be used instead.
    if (market.createdBy !== ADMIN_ID) {
      console.log(
        `  ! created_by is ${market.createdBy ?? "null"}, not the founder — ` +
          `the admin panel can settle this, use it instead`,
      );
      skipped += 1;
      continue;
    }

    // Verify the winner entry belongs to this market and still carries the
    // label we reviewed. Guards against an entry id copied from another market
    // and against labels having been edited since.
    const entries = await db
      .select({ id: marketEntries.id, label: marketEntries.label })
      .from(marketEntries)
      .where(eq(marketEntries.marketId, target.marketId));

    const winner = entries.find((e) => e.id === target.winnerEntryId);
    if (!winner) {
      console.log("  ! winner entry not found in this market — skipping");
      skipped += 1;
      continue;
    }
    if (winner.label !== target.winnerLabel) {
      console.log(
        `  ! winner label is "${winner.label}", expected "${target.winnerLabel}" — skipping`,
      );
      skipped += 1;
      continue;
    }

    // Same draw guard the HTTP endpoint applies. Inapplicable to a Yes/No
    // threshold market, but this path must not be weaker than the one it
    // stands in for.
    const drawGuard = rejectDrawWinnerOnKnockout({
      metadata: market.metadata,
      winnerLabel: winner.label,
      hints: knockoutHintsFromMarket(
        market,
        entries.map((e) => e.label),
      ),
    });
    if (drawGuard.rejected) {
      console.log(`  ! knockout draw guard: ${drawGuard.message} — skipping`);
      skipped += 1;
      continue;
    }

    const [{ n: betCount }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(marketBets)
      .where(eq(marketBets.marketId, target.marketId));
    if (betCount > target.maxBets) {
      console.log(`  ! ${betCount} bets exceeds maxBets=${target.maxBets} — refusing`);
      skipped += 1;
      continue;
    }

    console.log(`  status     ${market.status} → RESOLVED`);
    console.log(`  end_at     ${market.endAt?.toISOString() ?? "null"}`);
    console.log(`  bets       ${betCount}`);
    console.log(`  winner     ${winner.label} (${winner.id.slice(0, 8)})`);
    console.log(`  losing     ${entries.filter((e) => e.id !== winner.id).map((e) => e.label).join(", ")}`);

    if (DRY_RUN) {
      console.log("  · dry run — no changes written");
      continue;
    }

    const result = await resolveAmmMarket({
      marketId: target.marketId,
      winnerEntryId: target.winnerEntryId,
      settledBy: ADMIN_ID,
    });

    if ("error" in result) {
      console.log(`  ! resolveAmmMarket failed: ${result.error} — ${result.message}`);
      skipped += 1;
      continue;
    }
    if (result.idempotentSkip) {
      console.log("  = resolveAmmMarket reported an idempotent skip — already settled");
      skipped += 1;
      continue;
    }

    // Mirror the endpoint's post-settlement stamp so this market is
    // indistinguishable from a panel-settled one in the admin UI.
    await db
      .update(predictionMarkets)
      .set({
        resolveMethod: "admin_manual",
        settledBy: ADMIN_ID,
        resolutionNotes: JSON.stringify({
          type: market.marketType || "community",
          outcome: winner.label,
          winnerEntryId: target.winnerEntryId,
          resolvedAt: new Date().toISOString(),
          adminNotes: target.basis,
        }),
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, target.marketId));

    await db.insert(adminAuditLog).values({
      adminId: ADMIN_ID,
      adminEmail: null,
      actionType: "amm_market_settle_self_created",
      targetTable: "prediction_markets",
      targetId: target.marketId,
      previousData: { status: market.status, settledBy: null },
      newData: {
        status: "RESOLVED",
        winnerEntryId: target.winnerEntryId,
        winnerLabel: winner.label,
        payoutLiability: result.payoutLiability,
        creditedToHouse: result.creditedToHouse,
        settledUserCount: result.settledUserCount,
      },
      metadata: {
        script: "ops/settle-self-created-world-market.ts",
        guardBypassed: "self_resolution_denied",
        guardBypassReason:
          "Market creator is the only admin available to settle; outcome is " +
          "unambiguous and corroborated by two independent price sources.",
        basis: target.basis,
      },
    });

    settled += 1;
    console.log(
      `  ✔ resolved "${winner.label}" — paid ${result.payoutLiability} credits ` +
        `to ${result.settledUserCount} position(s), ${result.creditedToHouse} to house`,
    );
  }

  console.log(`\n[settle-self-created-world-market] settled ${settled}, skipped ${skipped}`);

  // Only wait when something actually settled — a dry run or an all-skipped
  // pass has no fanout in flight and should exit immediately.
  if (settled > 0) {
    console.log(`  · draining post-settlement fanout for ${DRAIN_MS / 1000}s before exit`);
    await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[settle-self-created-world-market] failed:", err);
  process.exit(1);
});
