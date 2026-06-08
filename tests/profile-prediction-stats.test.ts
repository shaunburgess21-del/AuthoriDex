import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPredictionResult,
  roundWinRatePercent,
} from "../shared/lib/profile-prediction-stats";

test("classifyPredictionResult: RESOLVED won", () => {
  const { result, payout } = classifyPredictionResult({
    marketStatus: "RESOLVED",
    betStatus: "won",
    stakeAmount: 100,
    payoutAmount: 180,
    potentialPayout: 200,
  });
  assert.equal(result, "won");
  assert.equal(payout, 180);
});

test("classifyPredictionResult: RESOLVED lost", () => {
  const { result } = classifyPredictionResult({
    marketStatus: "RESOLVED",
    betStatus: "lost",
    stakeAmount: 50,
  });
  assert.equal(result, "lost");
});

test("classifyPredictionResult: RESOLVED active winner entry", () => {
  const { result, payout } = classifyPredictionResult({
    marketStatus: "RESOLVED",
    betStatus: "active",
    entryResolutionStatus: "winner",
    stakeAmount: 40,
    potentialPayout: 80,
  });
  assert.equal(result, "won");
  assert.equal(payout, 80);
});

test("classifyPredictionResult: VOID refunded", () => {
  const { result, payout } = classifyPredictionResult({
    marketStatus: "VOID",
    betStatus: "active",
    stakeAmount: 25,
  });
  assert.equal(result, "refunded");
  assert.equal(payout, 25);
});

test("classifyPredictionResult: open market pending", () => {
  const { result, payout } = classifyPredictionResult({
    marketStatus: "OPEN",
    betStatus: "active",
    stakeAmount: 10,
  });
  assert.equal(result, "pending");
  assert.equal(payout, 0);
});

test("classifyPredictionResult: RESOLVED AMM sell row (settled) on winner entry", () => {
  const { result } = classifyPredictionResult({
    marketStatus: "RESOLVED",
    betStatus: "settled",
    entryResolutionStatus: "winner",
    stakeAmount: -44,
  });
  assert.equal(result, "won");
});

test("classifyPredictionResult: RESOLVED AMM sell row (settled) on loser entry", () => {
  const { result } = classifyPredictionResult({
    marketStatus: "RESOLVED",
    betStatus: "settled",
    entryResolutionStatus: "loser",
    stakeAmount: -109,
  });
  assert.equal(result, "lost");
});

test("roundWinRatePercent: 8/19 -> 42.1", () => {
  assert.equal(roundWinRatePercent(8, 11), 42.1);
});

test("roundWinRatePercent: no settled bets", () => {
  assert.equal(roundWinRatePercent(0, 0), 0);
});
