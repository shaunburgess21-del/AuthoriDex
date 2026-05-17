/**
 * Restore the AMM house wallet to its design baseline.
 *
 * Background: scripts/sunset-reset-credits.ts (Parimutuel sunset Phase 1.4)
 * iterates over every profile and resets predict_credits to a baseline:
 *
 *   humans (is_agent=false): SIGNUP_CREDIT_GRANT      (10,000)
 *   agents (is_agent=true):  AGENT_CREDIT_TOPUP_TARGET (50,000)
 *
 * The house profile (`__house__`, fixed UUID, is_house=true) has
 * is_agent=false so it was caught by the "human" branch and reset
 * to 10,000. After two market seeds (~5k each) drained those final
 * credits, the house is at 0 and seedAmmMarket() now throws
 * "House profile is missing or has insufficient credits".
 *
 * This blocks:
 *   - Restoring World/Community markets after the parimutuel wipe.
 *   - Weekly h2h / updown / gainer regeneration (each new market
 *     calls seedAmmMarket which needs house funds).
 *   - Any admin-created AMM market.
 *
 * Migration 0052_amm_phase_2.sql sets the house baseline at
 * 1,000,000,000 (1B virtual credits) — far more than any per-market
 * seed, lets us monitor for drift trivially. This script tops the
 * house back up to that baseline and writes a `credit_ledger` audit
 * row with txn_type='house_restore' so the recovery is traceable.
 *
 * Idempotent: re-running just no-ops if the house is already at
 * (or above) the baseline.
 *
 * Run with:
 *   npx tsx ops/restore-house-wallet.ts --dry-run
 *   npx tsx ops/restore-house-wallet.ts
 *   npx tsx ops/restore-house-wallet.ts --target 100000000
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const targetIdx = args.indexOf("--target");
const DEFAULT_TARGET = 1_000_000_000;
const TARGET = targetIdx >= 0 && args[targetIdx + 1] != null
  ? Math.max(0, Math.floor(Number(args[targetIdx + 1])))
  : DEFAULT_TARGET;

const HOUSE_PROFILE_ID = "00000000-0000-0000-0000-0000000000aa";

async function main(): Promise<void> {
  console.log(`\n[restore:house-wallet]`);
  console.log(`  house id          ${HOUSE_PROFILE_ID}`);
  console.log(`  target balance    ${TARGET.toLocaleString()}`);
  console.log(`  mode              ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE WRITE"}`);

  if (!process.env.DATABASE_URL) {
    console.error("\n[restore:house-wallet] DATABASE_URL is not set.");
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

  if (!house) {
    console.error(`\n[restore:house-wallet] House profile ${HOUSE_PROFILE_ID} does not exist.`);
    console.error(`  Did migration 0052_amm_phase_2.sql run? Aborting.\n`);
    process.exit(1);
  }
  if (!house.isHouse) {
    console.error(`\n[restore:house-wallet] Profile ${HOUSE_PROFILE_ID} exists but is_house=false.`);
    console.error(`  Refusing to top up a non-house wallet. Aborting.\n`);
    process.exit(1);
  }

  console.log(`\n  current balance   ${house.predictCredits.toLocaleString()}`);
  const delta = TARGET - house.predictCredits;
  console.log(`  delta             ${delta >= 0 ? "+" : ""}${delta.toLocaleString()}`);

  if (delta <= 0) {
    console.log(`\n[restore:house-wallet] House already at or above target. Nothing to do.\n`);
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(`\n[restore:house-wallet] DRY RUN complete. Re-run without --dry-run to apply.\n`);
    process.exit(0);
  }

  const runId = randomUUID().slice(0, 8);

  await db.transaction(async (tx) => {
    // Atomic update guarded by the previous balance to defend against a
    // concurrent write between our read and write (shouldn't happen since
    // the house only moves on AMM seeds/settles, but the cost of being
    // safe here is zero).
    const [updated] = await tx
      .update(profiles)
      .set({ predictCredits: TARGET })
      .where(sql`${profiles.id} = ${HOUSE_PROFILE_ID} AND ${profiles.predictCredits} = ${house.predictCredits}`)
      .returning({ predictCredits: profiles.predictCredits });

    if (!updated) {
      throw new Error(
        `[restore:house-wallet] House balance changed between read and write (concurrent seed?). ` +
        `Re-run the script.`,
      );
    }

    await tx.insert(creditLedger).values({
      userId: HOUSE_PROFILE_ID,
      txnType: "house_restore",
      amount: delta,
      walletType: "VIRTUAL",
      balanceAfter: TARGET,
      source: "ops_house_restore",
      idempotencyKey: `house_restore_${runId}`,
      metadata: {
        previousBalance: house.predictCredits,
        newBalance: TARGET,
        runId,
        reason:
          "Restore house wallet after sunset-reset-credits.ts inadvertently zeroed it " +
          "(treated the house as a regular human profile).",
        appliedAt: new Date().toISOString(),
      },
    });
  });

  console.log(`\n[restore:house-wallet] Done.`);
  console.log(`  delta credited    +${delta.toLocaleString()}`);
  console.log(`  new balance       ${TARGET.toLocaleString()}`);
  console.log(`  ledger tag        house_restore (run_id ${runId})`);
  console.log(`\nNext step:`);
  console.log(`  npx tsx ops/restore-world-markets.ts --dry-run`);
  console.log(``);

  process.exit(0);
}

main().catch((err) => {
  console.error("\n[restore:house-wallet] FAILED:", err);
  process.exit(1);
});
