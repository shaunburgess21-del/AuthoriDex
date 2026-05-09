import test from "node:test";
import assert from "node:assert/strict";

import { calculateSettlementPayouts, computeEarlyBirdMultiplier } from "../server/jobs/settlement-utils";

const WEEK_START = "2026-05-04T00:00:00.000Z"; // Mon 00:00 UTC
const WEEK_CLOSE = "2026-05-08T23:59:00.000Z"; // Fri 23:59 UTC
const MID_WEEK = "2026-05-06T12:00:00.000Z";   // Wed noon
const NEAR_CLOSE = "2026-05-08T22:00:00.000Z"; // Fri ~close

test("calculateSettlementPayouts splits the full pool across winners", () => {
  const result = calculateSettlementPayouts([
    { id: "bet-1", entryId: "winner", stakeAmount: 40 },
    { id: "bet-2", entryId: "winner", stakeAmount: 60 },
    { id: "bet-3", entryId: "loser", stakeAmount: 100 },
  ], "winner");

  assert.equal(result.totalPool, 200);
  assert.equal(result.winnerBets.length, 2);
  assert.equal(result.payoutsDistributed, 200);
  assert.equal(result.remainder, 0);
  assert.deepEqual(result.payouts, [
    { betId: "bet-1", payout: 80 },
    { betId: "bet-2", payout: 120 },
  ]);
});

test("calculateSettlementPayouts handles empty pools", () => {
  const result = calculateSettlementPayouts([], "winner");

  assert.equal(result.totalPool, 0);
  assert.equal(result.winnerBets.length, 0);
  assert.equal(result.payoutsDistributed, 0);
  assert.equal(result.remainder, 0);
});

test("calculateSettlementPayouts single winner gets full pool", () => {
  const result = calculateSettlementPayouts([
    { id: "bet-1", entryId: "winner", stakeAmount: 50 },
    { id: "bet-2", entryId: "loser", stakeAmount: 150 },
  ], "winner");

  assert.equal(result.totalPool, 200);
  assert.equal(result.winnerBets.length, 1);
  assert.equal(result.payouts[0].payout, 200);
  assert.equal(result.remainder, 0);
});

test("calculateSettlementPayouts all losers produces empty payouts", () => {
  const result = calculateSettlementPayouts([
    { id: "bet-1", entryId: "loser-a", stakeAmount: 100 },
    { id: "bet-2", entryId: "loser-b", stakeAmount: 100 },
  ], "winner");

  assert.equal(result.totalPool, 200);
  assert.equal(result.winnerBets.length, 0);
  assert.equal(result.payouts.length, 0);
  assert.equal(result.payoutsDistributed, 0);
});

test("calculateSettlementPayouts distributes rounding dust to largest winner", () => {
  const result = calculateSettlementPayouts([
    { id: "bet-1", entryId: "winner", stakeAmount: 33 },
    { id: "bet-2", entryId: "winner", stakeAmount: 34 },
    { id: "bet-3", entryId: "winner", stakeAmount: 33 },
    { id: "bet-4", entryId: "loser", stakeAmount: 100 },
  ], "winner");

  assert.equal(result.totalPool, 200);
  assert.equal(result.payoutsDistributed, 200);
  assert.equal(result.remainder, 0);
  const totalPaid = result.payouts.reduce((s, p) => s + p.payout, 0);
  assert.equal(totalPaid, 200);
});

// ---- Direction support ----

test("calculateSettlementPayouts treats NO bets as winners when entry loses", () => {
  const result = calculateSettlementPayouts([
    { id: "yes-on-winner", entryId: "winner", direction: "yes", stakeAmount: 100 },
    { id: "no-on-loser", entryId: "loser", direction: "no", stakeAmount: 100 },
    { id: "yes-on-loser", entryId: "loser", direction: "yes", stakeAmount: 100 },
  ], "winner");

  assert.equal(result.winnerBets.length, 2);
  const ids = result.winnerBets.map(b => b.id).sort();
  assert.deepEqual(ids, ["no-on-loser", "yes-on-winner"]);
});

// ---- Early bird boost: critical "no winner ever loses" guarantees ----

test("boost: all-winners pool — no winner loses credits", () => {
  // 2 winners, both correct, no losers. Without the loser-pool fix this
  // case would force the late winner to receive less than their stake.
  const result = calculateSettlementPayouts([
    { id: "early", entryId: "winner", stakeAmount: 100, createdAt: WEEK_START },
    { id: "late", entryId: "winner", stakeAmount: 100, createdAt: NEAR_CLOSE },
  ], "winner", { marketStartAt: WEEK_START, marketCloseAt: WEEK_CLOSE });

  assert.equal(result.totalPool, 200);
  for (const p of result.payouts) {
    assert.ok(p.payout >= 100, `winner ${p.betId} got ${p.payout}, less than stake 100`);
  }
  assert.equal(result.payoutsDistributed, 200);
});

test("boost: redistributes only the loser pool (early bettor profits more)", () => {
  const result = calculateSettlementPayouts([
    { id: "early", entryId: "winner", stakeAmount: 100, createdAt: WEEK_START },
    { id: "late", entryId: "winner", stakeAmount: 100, createdAt: NEAR_CLOSE },
    { id: "loser-1", entryId: "loser", stakeAmount: 100 },
    { id: "loser-2", entryId: "loser", stakeAmount: 100 },
  ], "winner", { marketStartAt: WEEK_START, marketCloseAt: WEEK_CLOSE });

  const earlyPayout = result.payouts.find(p => p.betId === "early")!.payout;
  const latePayout = result.payouts.find(p => p.betId === "late")!.payout;

  assert.ok(earlyPayout > latePayout, "early bettor should out-earn late bettor");
  assert.ok(latePayout >= 100, "late bettor should never lose stake");
  assert.equal(result.payoutsDistributed, 400);
});

test("boost: equal createdAt times yields equal payouts (parity with no-boost)", () => {
  const result = calculateSettlementPayouts([
    { id: "a", entryId: "winner", stakeAmount: 100, createdAt: MID_WEEK },
    { id: "b", entryId: "winner", stakeAmount: 100, createdAt: MID_WEEK },
    { id: "loser", entryId: "loser", stakeAmount: 200 },
  ], "winner", { marketStartAt: WEEK_START, marketCloseAt: WEEK_CLOSE });

  const a = result.payouts.find(p => p.betId === "a")!.payout;
  const b = result.payouts.find(p => p.betId === "b")!.payout;
  assert.equal(a, b);
  assert.equal(result.payoutsDistributed, 400);
});

test("boost: missing timing context falls back to plain pari-mutuel", () => {
  const withTiming = calculateSettlementPayouts([
    { id: "a", entryId: "winner", stakeAmount: 50, createdAt: WEEK_START },
    { id: "b", entryId: "winner", stakeAmount: 150, createdAt: WEEK_START },
    { id: "loser", entryId: "loser", stakeAmount: 200 },
  ], "winner");

  // Without timing → identical to legacy proportional split
  assert.equal(withTiming.payouts.find(p => p.betId === "a")!.payout, 100);
  assert.equal(withTiming.payouts.find(p => p.betId === "b")!.payout, 300);
});

test("boost: missing createdAt on a winner defaults to no-boost (multiplier=1)", () => {
  const result = calculateSettlementPayouts([
    { id: "early", entryId: "winner", stakeAmount: 100, createdAt: WEEK_START },
    { id: "no-ts", entryId: "winner", stakeAmount: 100 /* createdAt missing */ },
    { id: "loser", entryId: "loser", stakeAmount: 200 },
  ], "winner", { marketStartAt: WEEK_START, marketCloseAt: WEEK_CLOSE });

  const early = result.payouts.find(p => p.betId === "early")!.payout;
  const noTs = result.payouts.find(p => p.betId === "no-ts")!.payout;
  assert.ok(early > noTs);
  assert.ok(noTs >= 100);
  assert.equal(result.payoutsDistributed, 400);
});

test("boost: bet placed before start clamps to max boost (1.5x)", () => {
  // Should not produce a multiplier above 1.5 even if createdAt is before start.
  const before = computeEarlyBirdMultiplier(
    "2026-05-01T00:00:00.000Z", // 3 days before window
    WEEK_START,
    WEEK_CLOSE,
  );
  assert.equal(before, 1.5);
});

test("boost: bet placed after close clamps to 1.0", () => {
  const after = computeEarlyBirdMultiplier(
    "2026-05-09T00:00:00.000Z", // after close
    WEEK_START,
    WEEK_CLOSE,
  );
  assert.equal(after, 1);
});

test("boost: zero/negative window returns multiplier 1", () => {
  const same = computeEarlyBirdMultiplier(MID_WEEK, WEEK_CLOSE, WEEK_CLOSE);
  assert.equal(same, 1);
  const inverted = computeEarlyBirdMultiplier(MID_WEEK, WEEK_CLOSE, WEEK_START);
  assert.equal(inverted, 1);
});

test("boost: total payout never exceeds totalPool, no remainder", () => {
  // Random-ish stakes & timestamps to catch dust handling edge cases
  const result = calculateSettlementPayouts([
    { id: "w1", entryId: "winner", stakeAmount: 73, createdAt: WEEK_START },
    { id: "w2", entryId: "winner", stakeAmount: 47, createdAt: MID_WEEK },
    { id: "w3", entryId: "winner", stakeAmount: 31, createdAt: NEAR_CLOSE },
    { id: "l1", entryId: "loser", stakeAmount: 89 },
    { id: "l2", entryId: "loser", stakeAmount: 17 },
  ], "winner", { marketStartAt: WEEK_START, marketCloseAt: WEEK_CLOSE });

  assert.equal(result.payoutsDistributed, result.totalPool);
  assert.equal(result.remainder, 0);
  for (const p of result.payouts) {
    const stake = result.winnerBets.find(b => b.id === p.betId)!.stakeAmount;
    assert.ok(p.payout >= stake, `winner ${p.betId} got ${p.payout} below stake ${stake}`);
  }
});
