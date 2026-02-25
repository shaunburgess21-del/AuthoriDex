import { db } from "../server/db";
import { predictionMarkets, marketEntries, marketBets, profiles, creditLedger, trackedPeople } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { settleMarketBets } from "../server/jobs/market-resolver";

async function runTest() {
  const testPersonRows = await db.select({ id: trackedPeople.id }).from(trackedPeople).limit(1);
  if (!testPersonRows.length) { console.log("No tracked people"); process.exit(1); }
  const testProfileRows = await db.select({ id: profiles.id, predictCredits: profiles.predictCredits }).from(profiles).limit(2);
  if (testProfileRows.length < 2) { console.log("Need 2+ profiles"); process.exit(1); }

  const userA = testProfileRows[0], userB = testProfileRows[1];
  const credA = userA.predictCredits, credB = userB.predictCredits;
  const stakeA = 100, stakeB = 100, pool = 200;
  console.log("=== PAYOUT PIPELINE E2E TEST ===");
  console.log(`UserA=${userA.id} credits=${credA}, UserB=${userB.id} credits=${credB}`);

  const [m] = await db.insert(predictionMarkets).values({ marketType:"updown", title:"[TEST]", slug:`test-${Date.now()}`, personId:testPersonRows[0].id, category:"test", visibility:"hidden", status:"OPEN", startAt:new Date(Date.now()-7200000), endAt:new Date(Date.now()-60000), weekNumber:0, seedParticipants:0, seedVolume:"0" }).returning();
  const [up] = await db.insert(marketEntries).values({ marketId:m.id, entryType:"custom", label:"Up", displayOrder:0 }).returning();
  const [dn] = await db.insert(marketEntries).values({ marketId:m.id, entryType:"custom", label:"Down", displayOrder:1 }).returning();

  await db.update(profiles).set({ predictCredits: credA - stakeA }).where(eq(profiles.id, userA.id));
  await db.update(profiles).set({ predictCredits: credB - stakeB }).where(eq(profiles.id, userB.id));
  const [bA] = await db.insert(marketBets).values({ marketId:m.id, entryId:up.id, userId:userA.id, stakeAmount:stakeA, status:"active" }).returning();
  const [bB] = await db.insert(marketBets).values({ marketId:m.id, entryId:dn.id, userId:userB.id, stakeAmount:stakeB, status:"active" }).returning();
  await db.insert(creditLedger).values([
    { userId:userA.id, txnType:'prediction_stake', amount:-stakeA, walletType:'VIRTUAL', balanceAfter:credA-stakeA, source:'user_action', idempotencyKey:`stake_${m.id}_${bA.id}`, metadata:{marketId:m.id} },
    { userId:userB.id, txnType:'prediction_stake', amount:-stakeB, walletType:'VIRTUAL', balanceAfter:credB-stakeB, source:'user_action', idempotencyKey:`stake_${m.id}_${bB.id}`, metadata:{marketId:m.id} },
  ]);

  const s1 = await settleMarketBets(m.id, up.id);
  console.log("Settlement:", JSON.stringify(s1));

  const r: Record<string,{p:boolean,d:string}> = {};
  r.poolConservation = { p: Math.abs(s1.remainder)<=1, d:`pool=${s1.totalPool} payouts=${s1.payoutsDistributed} rem=${s1.remainder}` };
  r.winners = { p: s1.winnersCount===1, d:`${s1.winnersCount}` };
  r.losers = { p: s1.losersCount===1, d:`${s1.losersCount}` };

  const bets = await db.select().from(marketBets).where(eq(marketBets.marketId, m.id));
  r.loserPayout = { p: bets.find(b=>b.entryId===dn.id)?.payoutAmount===0, d:`${bets.find(b=>b.entryId===dn.id)?.payoutAmount}` };
  r.winnerPayout = { p: bets.find(b=>b.entryId===up.id)?.payoutAmount===pool, d:`${bets.find(b=>b.entryId===up.id)?.payoutAmount}` };

  const [pA] = await db.select({c:profiles.predictCredits}).from(profiles).where(eq(profiles.id, userA.id));
  const [pB] = await db.select({c:profiles.predictCredits}).from(profiles).where(eq(profiles.id, userB.id));
  r.winnerBalance = { p: pA.c===credA-stakeA+pool, d:`expected=${credA-stakeA+pool} actual=${pA.c}` };
  r.loserBalance = { p: pB.c===credB-stakeB, d:`expected=${credB-stakeB} actual=${pB.c}` };

  const ledger = await db.select().from(creditLedger).where(sql`${creditLedger.idempotencyKey} LIKE ${'%'+m.id+'%'}`);
  r.stakeLedger = { p: ledger.filter(e=>e.txnType==='prediction_stake').length===2, d:`${ledger.filter(e=>e.txnType==='prediction_stake').length}` };
  r.payoutLedger = { p: ledger.filter(e=>e.txnType==='prediction_payout').length===1, d:`${ledger.filter(e=>e.txnType==='prediction_payout').length}` };

  await db.update(predictionMarkets).set({ status:"RESOLVED" as any }).where(eq(predictionMarkets.id, m.id));
  const s2 = await settleMarketBets(m.id, up.id);
  r.idempotency = { p: s2.alreadySettled===true, d:`alreadySettled=${s2.alreadySettled}` };

  console.log("\n=== RESULTS ===");
  let ok = true;
  for (const [k,v] of Object.entries(r)) { const s = v.p?"PASS":"FAIL"; if(!v.p)ok=false; console.log(`  ${s}: ${k} — ${v.d}`); }
  console.log(`\n=== ${ok?"ALL PASSED":"SOME FAILED"} === (${ledger.length} ledger entries)`);

  await db.delete(creditLedger).where(sql`${creditLedger.idempotencyKey} LIKE ${'%'+m.id+'%'}`);
  await db.delete(marketBets).where(eq(marketBets.marketId, m.id));
  await db.delete(marketEntries).where(eq(marketEntries.marketId, m.id));
  await db.delete(predictionMarkets).where(eq(predictionMarkets.id, m.id));
  await db.update(profiles).set({ predictCredits: credA }).where(eq(profiles.id, userA.id));
  await db.update(profiles).set({ predictCredits: credB }).where(eq(profiles.id, userB.id));
  console.log("Cleanup done.");
  process.exit(ok ? 0 : 1);
}
runTest().catch(e=>{ console.error(e); process.exit(1); });
