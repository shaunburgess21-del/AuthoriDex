import test from "node:test";
import assert from "node:assert/strict";

import {
  canAccessCapability,
  computeCreditBalance,
  scaleEarnedValue,
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
