import { db } from "../server/db";
import { predictionMarkets, marketEntries, marketBets, profiles, creditLedger, trackedPeople } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { settleMarketBets } from "../server/jobs/market-resolver";

type Check = { p: boolean; d: string };

async function cleanup(marketId: string, userIds: string[], originalCredits: number[]) {
  await db.delete(creditLedger).where(sql`${creditLedger.idempotencyKey} LIKE ${'%' + marketId + '%'}`);
  await db.delete(marketBets).where(eq(marketBets.marketId, marketId));
  await db.delete(marketEntries).where(eq(marketEntries.marketId, marketId));
  await db.delete(predictionMarkets).where(eq(predictionMarkets.id, marketId));
  for (let i = 0; i < userIds.length; i++) {
    await db.update(profiles).set({ predictCredits: originalCredits[i] }).where(eq(profiles.id, userIds[i]));
  }
}

function printResults(name: string, r: Record<string, Check>): boolean {
  console.log(`\n=== ${name} ===`);
  let ok = true;
  for (const [k, v] of Object.entries(r)) {
    const s = v.p ? "PASS" : "FAIL";
    if (!v.p) ok = false;
    console.log(`  ${s}: ${k} — ${v.d}`);
  }
  return ok;
}

async function getTestUsers(count: number) {
  const testProfileRows = await db.select({ id: profiles.id, predictCredits: profiles.predictCredits }).from(profiles).limit(count);
  if (testProfileRows.length < count) throw new Error(`Need ${count}+ profiles, found ${testProfileRows.length}`);
  return testProfileRows;
}

async function createTestMarket(personId: string) {
  const [m] = await db.insert(predictionMarkets).values({
    marketType: "updown", title: "[TEST]", slug: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    personId, category: "test", visibility: "hidden", status: "OPEN",
    startAt: new Date(Date.now() - 7200000), endAt: new Date(Date.now() - 60000),
    weekNumber: 0, seedParticipants: 0, seedVolume: "0",
  }).returning();
  const [up] = await db.insert(marketEntries).values({ marketId: m.id, entryType: "custom", label: "Up", displayOrder: 0 }).returning();
  const [dn] = await db.insert(marketEntries).values({ marketId: m.id, entryType: "custom", label: "Down", displayOrder: 1 }).returning();
  return { market: m, upEntry: up, downEntry: dn };
}

async function scenario1_singleWinner() {
  console.log("\n========== SCENARIO 1: Single Winner Takes All ==========");
  const testPerson = (await db.select({ id: trackedPeople.id }).from(trackedPeople).limit(1))[0];
  const users = await getTestUsers(2);
  const [userA, userB] = users;
  const origCreds = users.map(u => u.predictCredits);
  const stakeA = 100, stakeB = 100, pool = 200;

  const { market: m, upEntry: up, downEntry: dn } = await createTestMarket(testPerson.id);

  await db.update(profiles).set({ predictCredits: origCreds[0] - stakeA }).where(eq(profiles.id, userA.id));
  await db.update(profiles).set({ predictCredits: origCreds[1] - stakeB }).where(eq(profiles.id, userB.id));
  const [bA] = await db.insert(marketBets).values({ marketId: m.id, entryId: up.id, userId: userA.id, stakeAmount: stakeA, status: "active" }).returning();
  const [bB] = await db.insert(marketBets).values({ marketId: m.id, entryId: dn.id, userId: userB.id, stakeAmount: stakeB, status: "active" }).returning();
  await db.insert(creditLedger).values([
    { userId: userA.id, txnType: 'prediction_stake', amount: -stakeA, walletType: 'VIRTUAL', balanceAfter: origCreds[0] - stakeA, source: 'user_action', idempotencyKey: `stake_${m.id}_${bA.id}`, metadata: { marketId: m.id } },
    { userId: userB.id, txnType: 'prediction_stake', amount: -stakeB, walletType: 'VIRTUAL', balanceAfter: origCreds[1] - stakeB, source: 'user_action', idempotencyKey: `stake_${m.id}_${bB.id}`, metadata: { marketId: m.id } },
  ]);

  const s = await settleMarketBets(m.id, up.id);
  console.log("Settlement:", JSON.stringify(s));

  const r: Record<string, Check> = {};
  r.poolConservation = { p: Math.abs(s.remainder) <= 1, d: `pool=${s.totalPool} payouts=${s.payoutsDistributed} rem=${s.remainder}` };
  r.winners = { p: s.winnersCount === 1, d: `${s.winnersCount}` };
  r.losers = { p: s.losersCount === 1, d: `${s.losersCount}` };
  r.remainderPolicy = { p: s.remainderPolicy === 'burned', d: `${s.remainderPolicy}` };

  const bets = await db.select().from(marketBets).where(eq(marketBets.marketId, m.id));
  r.loserPayout = { p: bets.find(b => b.entryId === dn.id)?.payoutAmount === 0, d: `${bets.find(b => b.entryId === dn.id)?.payoutAmount}` };
  r.winnerPayout = { p: bets.find(b => b.entryId === up.id)?.payoutAmount === pool, d: `${bets.find(b => b.entryId === up.id)?.payoutAmount}` };

  const [pA] = await db.select({ c: profiles.predictCredits }).from(profiles).where(eq(profiles.id, userA.id));
  const [pB] = await db.select({ c: profiles.predictCredits }).from(profiles).where(eq(profiles.id, userB.id));
  r.winnerBalance = { p: pA.c === origCreds[0] - stakeA + pool, d: `expected=${origCreds[0] - stakeA + pool} actual=${pA.c}` };
  r.loserBalance = { p: pB.c === origCreds[1] - stakeB, d: `expected=${origCreds[1] - stakeB} actual=${pB.c}` };

  const ledger = await db.select().from(creditLedger).where(sql`${creditLedger.idempotencyKey} LIKE ${'%' + m.id + '%'}`);
  r.stakeLedger = { p: ledger.filter(e => e.txnType === 'prediction_stake').length === 2, d: `${ledger.filter(e => e.txnType === 'prediction_stake').length}` };
  r.payoutLedger = { p: ledger.filter(e => e.txnType === 'prediction_payout').length === 1, d: `${ledger.filter(e => e.txnType === 'prediction_payout').length}` };

  await db.update(predictionMarkets).set({ status: "RESOLVED" as any }).where(eq(predictionMarkets.id, m.id));
  const s2 = await settleMarketBets(m.id, up.id);
  r.idempotency = { p: s2.alreadySettled === true, d: `alreadySettled=${s2.alreadySettled}` };

  const ok = printResults("Scenario 1: Single Winner", r);
  await cleanup(m.id, users.map(u => u.id), origCreds);
  return ok;
}

async function scenario2_multipleWinners() {
  console.log("\n========== SCENARIO 2: Multiple Winners (proportional) ==========");
  console.log("  UserA: 100 on Up, UserA: 50 on Up (2nd bet), UserB: 150 on Down");
  const testPerson = (await db.select({ id: trackedPeople.id }).from(trackedPeople).limit(1))[0];
  const users = await getTestUsers(2);
  const [userA, userB] = users;
  const origCreds = users.map(u => u.predictCredits);
  const stakeA1 = 100, stakeA2 = 50, stakeB = 150;
  const pool = stakeA1 + stakeA2 + stakeB;
  const winnerPool = stakeA1 + stakeA2;

  const { market: m, upEntry: up, downEntry: dn } = await createTestMarket(testPerson.id);

  await db.update(profiles).set({ predictCredits: origCreds[0] - stakeA1 - stakeA2 }).where(eq(profiles.id, userA.id));
  await db.update(profiles).set({ predictCredits: origCreds[1] - stakeB }).where(eq(profiles.id, userB.id));

  const [bA1] = await db.insert(marketBets).values({ marketId: m.id, entryId: up.id, userId: userA.id, stakeAmount: stakeA1, status: "active" }).returning();
  const [bA2] = await db.insert(marketBets).values({ marketId: m.id, entryId: up.id, userId: userA.id, stakeAmount: stakeA2, status: "active" }).returning();
  const [bB] = await db.insert(marketBets).values({ marketId: m.id, entryId: dn.id, userId: userB.id, stakeAmount: stakeB, status: "active" }).returning();

  await db.insert(creditLedger).values([
    { userId: userA.id, txnType: 'prediction_stake', amount: -stakeA1, walletType: 'VIRTUAL', balanceAfter: origCreds[0] - stakeA1, source: 'user_action', idempotencyKey: `stake_${m.id}_${bA1.id}`, metadata: { marketId: m.id } },
    { userId: userA.id, txnType: 'prediction_stake', amount: -stakeA2, walletType: 'VIRTUAL', balanceAfter: origCreds[0] - stakeA1 - stakeA2, source: 'user_action', idempotencyKey: `stake_${m.id}_${bA2.id}`, metadata: { marketId: m.id } },
    { userId: userB.id, txnType: 'prediction_stake', amount: -stakeB, walletType: 'VIRTUAL', balanceAfter: origCreds[1] - stakeB, source: 'user_action', idempotencyKey: `stake_${m.id}_${bB.id}`, metadata: { marketId: m.id } },
  ]);

  const s = await settleMarketBets(m.id, up.id);
  console.log("Settlement:", JSON.stringify(s));

  const expectedPayoutA1 = Math.round((stakeA1 / winnerPool) * pool);
  const expectedPayoutA2 = Math.round((stakeA2 / winnerPool) * pool);

  const r: Record<string, Check> = {};
  r.poolConservation = { p: Math.abs(s.remainder) <= 1, d: `pool=${s.totalPool} payouts=${s.payoutsDistributed} rem=${s.remainder}` };
  r.winners = { p: s.winnersCount === 2, d: `expected=2 actual=${s.winnersCount}` };
  r.losers = { p: s.losersCount === 1, d: `expected=1 actual=${s.losersCount}` };

  const bets = await db.select().from(marketBets).where(eq(marketBets.marketId, m.id));
  const betA1 = bets.find(b => b.id === bA1.id);
  const betA2 = bets.find(b => b.id === bA2.id);
  const betBr = bets.find(b => b.id === bB.id);

  r.winnerA1_payout = { p: betA1?.payoutAmount === expectedPayoutA1, d: `expected=${expectedPayoutA1} actual=${betA1?.payoutAmount}` };
  r.winnerA2_payout = { p: betA2?.payoutAmount === expectedPayoutA2, d: `expected=${expectedPayoutA2} actual=${betA2?.payoutAmount}` };
  r.loserB_payout = { p: betBr?.payoutAmount === 0, d: `actual=${betBr?.payoutAmount}` };

  const [pA] = await db.select({ c: profiles.predictCredits }).from(profiles).where(eq(profiles.id, userA.id));
  const [pB] = await db.select({ c: profiles.predictCredits }).from(profiles).where(eq(profiles.id, userB.id));
  r.balanceA = { p: pA.c === origCreds[0] - stakeA1 - stakeA2 + expectedPayoutA1 + expectedPayoutA2, d: `expected=${origCreds[0] - stakeA1 - stakeA2 + expectedPayoutA1 + expectedPayoutA2} actual=${pA.c}` };
  r.balanceB = { p: pB.c === origCreds[1] - stakeB, d: `expected=${origCreds[1] - stakeB} actual=${pB.c}` };

  const ledger = await db.select().from(creditLedger).where(sql`${creditLedger.idempotencyKey} LIKE ${'%' + m.id + '%'}`);
  r.stakeLedger = { p: ledger.filter(e => e.txnType === 'prediction_stake').length === 3, d: `${ledger.filter(e => e.txnType === 'prediction_stake').length}` };
  r.payoutLedger = { p: ledger.filter(e => e.txnType === 'prediction_payout').length === 2, d: `${ledger.filter(e => e.txnType === 'prediction_payout').length}` };

  const ok = printResults("Scenario 2: Multiple Winners", r);
  await cleanup(m.id, users.map(u => u.id), origCreds);
  return ok;
}

async function scenario3_roundingRemainder() {
  console.log("\n========== SCENARIO 3: Uneven Stakes (rounding test) ==========");
  console.log("  UserA: 100 on Up, UserA: 70 on Up (2nd bet), UserB: 130 on Down");
  const testPerson = (await db.select({ id: trackedPeople.id }).from(trackedPeople).limit(1))[0];
  const users = await getTestUsers(2);
  const [userA, userB] = users;
  const origCreds = users.map(u => u.predictCredits);
  const stakeA1 = 100, stakeA2 = 70, stakeB = 130;
  const pool = stakeA1 + stakeA2 + stakeB;
  const winnerPool = stakeA1 + stakeA2;

  const { market: m, upEntry: up, downEntry: dn } = await createTestMarket(testPerson.id);

  await db.update(profiles).set({ predictCredits: origCreds[0] - stakeA1 - stakeA2 }).where(eq(profiles.id, userA.id));
  await db.update(profiles).set({ predictCredits: origCreds[1] - stakeB }).where(eq(profiles.id, userB.id));

  const [bA1] = await db.insert(marketBets).values({ marketId: m.id, entryId: up.id, userId: userA.id, stakeAmount: stakeA1, status: "active" }).returning();
  const [bA2] = await db.insert(marketBets).values({ marketId: m.id, entryId: up.id, userId: userA.id, stakeAmount: stakeA2, status: "active" }).returning();
  const [bB] = await db.insert(marketBets).values({ marketId: m.id, entryId: dn.id, userId: userB.id, stakeAmount: stakeB, status: "active" }).returning();

  await db.insert(creditLedger).values([
    { userId: userA.id, txnType: 'prediction_stake', amount: -stakeA1, walletType: 'VIRTUAL', balanceAfter: origCreds[0] - stakeA1, source: 'user_action', idempotencyKey: `stake_${m.id}_${bA1.id}`, metadata: { marketId: m.id } },
    { userId: userA.id, txnType: 'prediction_stake', amount: -stakeA2, walletType: 'VIRTUAL', balanceAfter: origCreds[0] - stakeA1 - stakeA2, source: 'user_action', idempotencyKey: `stake_${m.id}_${bA2.id}`, metadata: { marketId: m.id } },
    { userId: userB.id, txnType: 'prediction_stake', amount: -stakeB, walletType: 'VIRTUAL', balanceAfter: origCreds[1] - stakeB, source: 'user_action', idempotencyKey: `stake_${m.id}_${bB.id}`, metadata: { marketId: m.id } },
  ]);

  const s = await settleMarketBets(m.id, up.id);
  console.log("Settlement:", JSON.stringify(s));

  const expectedPayoutA1 = Math.round((stakeA1 / winnerPool) * pool);
  const expectedPayoutA2 = Math.round((stakeA2 / winnerPool) * pool);

  const r: Record<string, Check> = {};
  r.poolConservation = { p: Math.abs(s.remainder) <= 2, d: `pool=${s.totalPool} payouts=${s.payoutsDistributed} rem=${s.remainder}` };
  r.winners = { p: s.winnersCount === 2, d: `expected=2 actual=${s.winnersCount}` };
  r.losers = { p: s.losersCount === 1, d: `expected=1 actual=${s.losersCount}` };

  const bets = await db.select().from(marketBets).where(eq(marketBets.marketId, m.id));
  const betA1 = bets.find(b => b.id === bA1.id);
  const betA2 = bets.find(b => b.id === bA2.id);
  const betBr = bets.find(b => b.id === bB.id);

  r.winnerA1_payout = { p: betA1?.payoutAmount === expectedPayoutA1, d: `expected=${expectedPayoutA1} actual=${betA1?.payoutAmount}` };
  r.winnerA2_payout = { p: betA2?.payoutAmount === expectedPayoutA2, d: `expected=${expectedPayoutA2} actual=${betA2?.payoutAmount}` };
  r.loserB_payout = { p: betBr?.payoutAmount === 0, d: `actual=${betBr?.payoutAmount}` };
  r.roundingSmall = { p: Math.abs(s.remainder) <= 2, d: `remainder=${s.remainder} (should be ≤2 for 2 winners with rounding)` };

  const ok = printResults("Scenario 3: Rounding Remainder", r);
  await cleanup(m.id, users.map(u => u.id), origCreds);
  return ok;
}

async function runAllTests() {
  console.log("=== PAYOUT PIPELINE E2E TEST SUITE ===\n");

  const testPerson = (await db.select({ id: trackedPeople.id }).from(trackedPeople).limit(1));
  if (!testPerson.length) { console.log("No tracked people found"); process.exit(1); }

  const results: boolean[] = [];
  results.push(await scenario1_singleWinner());
  results.push(await scenario2_multipleWinners());
  results.push(await scenario3_roundingRemainder());

  const allPassed = results.every(r => r);
  console.log(`\n${"=".repeat(50)}`);
  console.log(`OVERALL: ${allPassed ? "ALL SCENARIOS PASSED" : "SOME SCENARIOS FAILED"}`);
  console.log(`Scenarios: ${results.filter(r => r).length}/${results.length} passed`);
  console.log(`${"=".repeat(50)}`);

  process.exit(allPassed ? 0 : 1);
}

runAllTests().catch(e => { console.error(e); process.exit(1); });
