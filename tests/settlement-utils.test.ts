import test from "node:test";
import assert from "node:assert/strict";

import { calculateSettlementPayouts } from "../server/jobs/settlement-utils";

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
