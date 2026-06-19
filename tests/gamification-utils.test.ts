import test from "node:test";
import assert from "node:assert/strict";

import { canAccessCapability, computeCreditBalance } from "../server/services/gamification-utils";

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
