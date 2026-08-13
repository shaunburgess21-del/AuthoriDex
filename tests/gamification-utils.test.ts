import test from "node:test";
import assert from "node:assert/strict";

import {
  canAccessCapability,
  computeCreditBalance,
  scaleEarnedValue,
  predictionWinIdempotencyKey,
  isXpBookkeepingAction,
  shouldSkipXpAward,
} from "../server/services/gamification-utils";
import { RANKS, getRankByName } from "../shared/rank-config";

test("computeCreditBalance rejects negative balances", () => {
  assert.equal(computeCreditBalance(100, -25), 75);
  assert.equal(computeCreditBalance(100, -100), 0);
  assert.equal(computeCreditBalance(100, -101), null);
});

test("canAccessCapability treats every engagement action as open (rank redesign)", () => {
  // Rank no longer gates engagement — every capability is available to
  // every authenticated user from Tier 1. Higher tiers amplify
  // participation (earn rate, curatorial weight, status), not unlock it.
  assert.equal(canAccessCapability(1, "can_predict"), true);
  assert.equal(canAccessCapability(1, "can_comment"), true);
  assert.equal(canAccessCapability(1, "can_post_insight"), true);
  assert.equal(canAccessCapability(1, "can_vote_curation"), true);
  assert.equal(canAccessCapability(1, "can_vote_induction"), true);
});

test("earn multipliers on the ranks ladder match the redesign curve", () => {
  const expected: Record<string, number> = {
    Citizen: 1.0,
    Aspirant: 1.05,
    Insider: 1.1,
    Analyst: 1.15,
    Expert: 1.2,
    Maven: 1.3,
    "Hall of Famer": 1.4,
    "VoxMax Legend": 1.5,
  };
  for (const rank of RANKS) {
    assert.equal(rank.earnMultiplier, expected[rank.name], `${rank.name} earnMultiplier`);
  }
});

test("scaleEarnedValue rounds half-up and matches the canonical examples", () => {
  const mult = (name: string) => getRankByName(name)!.earnMultiplier;

  // 20 XP sentiment vote across the ladder (prompt acceptance criteria).
  assert.equal(scaleEarnedValue(20, mult("Citizen")), 20);
  assert.equal(scaleEarnedValue(20, mult("Aspirant")), 21);
  assert.equal(scaleEarnedValue(20, mult("Insider")), 22);
  assert.equal(scaleEarnedValue(20, mult("Analyst")), 23);
  assert.equal(scaleEarnedValue(20, mult("Expert")), 24);
  assert.equal(scaleEarnedValue(20, mult("Maven")), 26);
  assert.equal(scaleEarnedValue(20, mult("Hall of Famer")), 28);
  assert.equal(scaleEarnedValue(20, mult("VoxMax Legend")), 30);

  // 50 XP post_insight — half-up rounding (50 * 1.05 = 52.5 -> 53).
  assert.equal(scaleEarnedValue(50, mult("Aspirant")), 53);
  assert.equal(scaleEarnedValue(50, mult("VoxMax Legend")), 75);
});

test("predictionWinIdempotencyKey is one award per user per market", () => {
  const marketId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const userId = "11111111-2222-3333-4444-555555555555";
  const betId = "99999999-8888-7777-6666-555555555555";

  const key = predictionWinIdempotencyKey(marketId, userId);
  assert.equal(key, `prediction_win_${marketId}_${userId}`);

  // Must NOT embed a bet id — that was the historical overcount path.
  assert.equal(key.includes(betId), false);

  // Same user + market always collapses to the same key.
  assert.equal(
    predictionWinIdempotencyKey(marketId, userId),
    predictionWinIdempotencyKey(marketId, userId),
  );

  // Different users on the same market stay distinct.
  assert.notEqual(
    predictionWinIdempotencyKey(marketId, userId),
    predictionWinIdempotencyKey(marketId, "00000000-0000-0000-0000-000000000001"),
  );
});

test("shouldSkipXpAward blocks participation XP for simulation agents only", () => {
  assert.equal(shouldSkipXpAward(false, "prediction_win"), false);
  assert.equal(shouldSkipXpAward(false, "place_prediction"), false);
  assert.equal(shouldSkipXpAward(true, "prediction_win"), true);
  assert.equal(shouldSkipXpAward(true, "place_prediction"), true);
  assert.equal(shouldSkipXpAward(true, "vote_sentiment"), true);
  assert.equal(shouldSkipXpAward(true, "post_comment"), true);
  // Ops parks and legacy seed still write for agents.
  assert.equal(shouldSkipXpAward(true, "admin_adjustment"), false);
  assert.equal(shouldSkipXpAward(true, "legacy_migration"), false);
  assert.equal(isXpBookkeepingAction("admin_adjustment"), true);
  assert.equal(isXpBookkeepingAction("prediction_win"), false);
});
