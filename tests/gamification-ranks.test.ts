import test from "node:test";
import assert from "node:assert/strict";

import { resolveRankForXp } from "../server/services/gamification-ranks";

const ranks = [
  { name: "Citizen", minXp: 0, maxXp: 99 },
  { name: "Contributor", minXp: 100, maxXp: 499 },
  { name: "Icon", minXp: 500, maxXp: null },
];

test("resolveRankForXp honors inclusive rank boundaries", () => {
  assert.equal(resolveRankForXp(ranks, 0)?.name, "Citizen");
  assert.equal(resolveRankForXp(ranks, 99)?.name, "Citizen");
  assert.equal(resolveRankForXp(ranks, 100)?.name, "Contributor");
  assert.equal(resolveRankForXp(ranks, 499)?.name, "Contributor");
  assert.equal(resolveRankForXp(ranks, 500)?.name, "Icon");
});

test("resolveRankForXp returns null when no rank matches", () => {
  assert.equal(resolveRankForXp([], 250), null);
});
