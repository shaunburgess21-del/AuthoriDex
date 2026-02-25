import { db } from "../server/db";
import { profiles, creditLedger } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const TEST_USER_ID = `test-ledger-baseline-${Date.now()}`;
const TEST_USERNAME = `testledger${Date.now()}`;

async function cleanup() {
  await db.delete(creditLedger).where(eq(creditLedger.userId, TEST_USER_ID));
  await db.delete(profiles).where(eq(profiles.id, TEST_USER_ID));
}

async function run() {
  console.log("=== LEDGER BASELINE SMOKE TEST ===\n");
  let allPassed = true;

  try {
    await cleanup();

    await db.insert(profiles).values({
      id: TEST_USER_ID,
      username: TEST_USERNAME,
      isPublic: true,
      role: "user",
      rank: "Citizen",
      xpPoints: 0,
      predictCredits: 1000,
      currentStreak: 0,
      totalVotes: 0,
      totalPredictions: 0,
      winRate: 0,
      lastActiveAt: new Date(),
    });

    await db.insert(creditLedger).values({
      userId: TEST_USER_ID,
      txnType: "initial_grant",
      amount: 1000,
      walletType: "VIRTUAL",
      balanceAfter: 1000,
      source: "signup",
      idempotencyKey: `initial_grant_${TEST_USER_ID}`,
      metadata: { reason: "Smoke test signup bonus" },
    }).onConflictDoNothing();

    const [profile] = await db.select({ predictCredits: profiles.predictCredits })
      .from(profiles).where(eq(profiles.id, TEST_USER_ID)).limit(1);

    const [ledger] = await db.select({
      ledgerSum: sql<number>`COALESCE(SUM(${creditLedger.amount}), 0)::int`,
      entryCount: sql<number>`COUNT(*)::int`,
    }).from(creditLedger).where(eq(creditLedger.userId, TEST_USER_ID));

    const drift = profile.predictCredits - ledger.ledgerSum;

    const checks = [
      { name: "profileCredits", pass: profile.predictCredits === 1000, detail: `expected=1000 actual=${profile.predictCredits}` },
      { name: "ledgerSum", pass: ledger.ledgerSum === 1000, detail: `expected=1000 actual=${ledger.ledgerSum}` },
      { name: "ledgerEntryCount", pass: ledger.entryCount === 1, detail: `expected=1 actual=${ledger.entryCount}` },
      { name: "drift", pass: drift === 0, detail: `expected=0 actual=${drift}` },
    ];

    for (const c of checks) {
      const status = c.pass ? "PASS" : "FAIL";
      if (!c.pass) allPassed = false;
      console.log(`  ${status}: ${c.name} — ${c.detail}`);
    }

    const dupInsert = await db.insert(creditLedger).values({
      userId: TEST_USER_ID,
      txnType: "initial_grant",
      amount: 1000,
      walletType: "VIRTUAL",
      balanceAfter: 1000,
      source: "signup",
      idempotencyKey: `initial_grant_${TEST_USER_ID}`,
      metadata: { reason: "Duplicate test" },
    }).onConflictDoNothing();

    const [afterDup] = await db.select({
      entryCount: sql<number>`COUNT(*)::int`,
    }).from(creditLedger).where(eq(creditLedger.userId, TEST_USER_ID));

    const idempotencyPassed = afterDup.entryCount === 1;
    if (!idempotencyPassed) allPassed = false;
    console.log(`  ${idempotencyPassed ? "PASS" : "FAIL"}: idempotency — duplicate insert blocked, count=${afterDup.entryCount}`);

  } finally {
    await cleanup();
    console.log("\n  Cleanup complete (test data removed)");
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`RESULT: ${allPassed ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
  console.log(`${"=".repeat(40)}`);
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => {
  console.error("Fatal error:", err);
  cleanup().finally(() => process.exit(1));
});
