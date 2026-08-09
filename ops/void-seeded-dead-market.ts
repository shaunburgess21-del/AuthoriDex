/**
 * Void a seeded World Market that can never trade meaningfully.
 *
 * The draft-retirement path in the source watcher deliberately refuses to
 * touch a market that already has an AMM seed or bets, because unwinding a
 * seeded book is a settlement decision. This script is that decision, made
 * explicitly and one market at a time.
 *
 * Void refunds every position at net cost basis and returns the house seed,
 * so it is credit-safe. With zero user bets it is purely a cleanup.
 *
 * Run:
 *   npx tsx --env-file=.env ops/void-seeded-dead-market.ts --dry-run
 *   npx tsx --env-file=.env ops/void-seeded-dead-market.ts --apply
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

/** admin_audit_log.admin_id is NOT NULL — attribute ops actions to the founder. */
const ADMIN_ID = "035adc7b-6087-421e-b635-b6b9ad2c8cd2"; // Randy_Andy

interface Target {
  marketId: string;
  titleContains: string;
  voidReason: string;
  /** Refuse to run if the market has more than this many bets. */
  maxBets: number;
}

const TARGETS: Target[] = [
  {
    // Published 2026-08-09 for a live test, but Polymarket had already settled
    // the source on 2026-07-27 ("Under $4M"). The AMM seeded at 90.5% on the
    // known winner. Archived immediately; this releases the seed.
    marketId: "61d64295-5200-46ce-ac58-0f85dbfd197a",
    titleContains: "LeBron James's next NBA contract",
    voidReason: "Source resolved before publish",
    maxBets: 0,
  },
];

async function main(): Promise<void> {
  console.log(`\n[void-seeded-dead-market] ${DRY_RUN ? "DRY RUN" : "APPLY"}`);

  const { db, pool } = await import("../server/db");
  const { predictionMarkets, marketBets, adminAuditLog } = await import(
    "../shared/schema"
  );
  const { eq, sql } = await import("drizzle-orm");
  const { resolveAmmMarket } = await import("../server/services/amm-resolver");

  for (const target of TARGETS) {
    console.log(`\n── ${target.titleContains} (${target.marketId.slice(0, 8)}) ──`);

    const [market] = await db
      .select({
        id: predictionMarkets.id,
        title: predictionMarkets.title,
        status: predictionMarkets.status,
        visibility: predictionMarkets.visibility,
        engine: predictionMarkets.engine,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, target.marketId))
      .limit(1);

    if (!market) {
      console.log("  ! not found — skipping");
      continue;
    }
    if (!market.title?.includes(target.titleContains)) {
      console.log(`  ! title mismatch ("${market.title}") — skipping`);
      continue;
    }
    if (market.status === "VOID" || market.status === "RESOLVED") {
      console.log(`  = already ${market.status} — nothing to do`);
      continue;
    }
    if (market.engine !== "amm") {
      console.log(`  ! engine is ${market.engine}, expected amm — skipping`);
      continue;
    }

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(marketBets)
      .where(eq(marketBets.marketId, target.marketId));
    if (n > target.maxBets) {
      console.log(`  ! ${n} bets exceeds maxBets=${target.maxBets} — refusing`);
      continue;
    }

    console.log(`  status     ${market.status} → VOID`);
    console.log(`  visibility ${market.visibility}`);
    console.log(`  bets       ${n}`);
    console.log(`  reason     ${target.voidReason}`);

    if (DRY_RUN) continue;

    const result = await resolveAmmMarket({
      marketId: target.marketId,
      voidMarket: true,
      settledBy: null,
      voidReason: target.voidReason,
    });

    await db.insert(adminAuditLog).values({
      adminId: ADMIN_ID,
      adminEmail: null,
      actionType: "void_seeded_dead_market",
      targetTable: "prediction_markets",
      targetId: target.marketId,
      previousData: { status: market.status, visibility: market.visibility },
      newData: {
        status: "VOID",
        refundedUsers: result?.settledUserCount ?? 0,
      },
      metadata: {
        reason: target.voidReason,
        script: "ops/void-seeded-dead-market.ts",
      },
    });

    console.log(`  ✔ voided (refunded ${result?.settledUserCount ?? 0} user position(s))`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[void-seeded-dead-market] failed:", err);
  process.exit(1);
});
