/**
 * Parimutuel sunset, Phase 1.2: void every in-flight parimutuel non-jackpot
 * market.
 *
 * Identifies markets where:
 *   - engine = 'parimutuel'
 *   - market_type != 'jackpot'
 *   - status IN ('OPEN', 'CLOSED_PENDING', 'blocked')
 *
 * For each one, calls `voidMarketBets(marketId)` which refunds every
 * active bet (stake-for-stake), credits the refund to the user's wallet,
 * writes a `prediction_refund` ledger row, flips entries to `void`, and
 * sets the market to `VOID`. Notification fanout is best-effort post-tx.
 *
 * Idempotent — re-running after a partial failure only touches markets
 * still in non-final states.
 *
 * Pre-req: run scripts/sunset-pause-agents.ts first so agents don't race
 * the refund operation.
 *
 * Run with:
 *   npx tsx scripts/sunset-void-inflight.ts [--dry-run]
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../server/db";
import { predictionMarkets } from "@shared/schema";
import { voidMarketBets } from "../server/jobs/market-resolver";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  console.log(`\n[sunset:void-inflight] Scanning for parimutuel non-jackpot markets...`);
  if (DRY_RUN) console.log(`  (DRY RUN — no DB writes)`);

  const targets = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      marketType: predictionMarkets.marketType,
      status: predictionMarkets.status,
      slug: predictionMarkets.slug,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.engine, "parimutuel"),
        sql`${predictionMarkets.marketType} != 'jackpot'`,
        inArray(predictionMarkets.status, ["OPEN", "CLOSED_PENDING", "blocked"]),
      ),
    );

  if (targets.length === 0) {
    console.log(`\n[sunset:void-inflight] No in-flight parimutuel non-jackpot markets found. Nothing to do.\n`);
    process.exit(0);
  }

  console.log(`\n[sunset:void-inflight] Found ${targets.length} markets to void:\n`);
  for (const m of targets) {
    console.log(`  ${m.marketType.padEnd(10)} ${m.status.padEnd(16)} ${m.id}  ${m.title}`);
  }

  if (DRY_RUN) {
    console.log(`\n[sunset:void-inflight] DRY RUN complete. Re-run without --dry-run to execute.\n`);
    process.exit(0);
  }

  console.log(`\n[sunset:void-inflight] Voiding...\n`);
  let totalRefunded = 0;
  let voidedMarkets = 0;
  const errors: Array<{ marketId: string; error: string }> = [];

  for (const market of targets) {
    try {
      const refunded = await voidMarketBets(market.id);
      console.log(`  OK   ${market.id}  refunded=${refunded} bets`);
      totalRefunded += refunded;
      voidedMarkets += 1;
    } catch (err: any) {
      console.error(`  FAIL ${market.id}  ${err?.message ?? err}`);
      errors.push({ marketId: market.id, error: err?.message ?? String(err) });
    }
  }

  console.log(`\n[sunset:void-inflight] Done.`);
  console.log(`  markets_voided    ${voidedMarkets} / ${targets.length}`);
  console.log(`  bets_refunded     ${totalRefunded}`);
  if (errors.length > 0) {
    console.log(`  errors            ${errors.length}`);
    for (const e of errors) {
      console.log(`    ${e.marketId}: ${e.error}`);
    }
    process.exit(1);
  }
  console.log(`\nNext step: npx tsx scripts/sunset-wipe-parimutuel.ts\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[sunset:void-inflight] FAILED:", err);
  process.exit(1);
});
