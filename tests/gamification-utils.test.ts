import test from "node:test";
import assert from "node:assert/strict";

import { canAccessCapability, computeCreditBalance } from "../server/services/gamification-utils";

test("computeCreditBalance rejects negative balances", () => {
  assert.equal(computeCreditBalance(100, -25), 75);
  assert.equal(computeCreditBalance(100, -100), 0);
  assert.equal(computeCreditBalance(100, -101), null);
});

test("canAccessCapability enforces higher-tier actions", () => {
  assert.equal(canAccessCapability(1, "can_predict"), true);
  assert.equal(canAccessCapability(1, "can_comment"), false);
  assert.equal(canAccessCapability(2, "can_comment"), true);
  assert.equal(canAccessCapability(2, "can_vote_curation"), true);
});
