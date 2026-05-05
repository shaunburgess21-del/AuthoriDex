import test from "node:test";
import assert from "node:assert/strict";

import { VOTE_TAB_VOTE_TYPES, isVoteTabVoteType } from "../server/utils/vote-actions";

test("VOTE_TAB_VOTE_TYPES covers vote-tab surfaces", () => {
  assert.deepEqual(
    VOTE_TAB_VOTE_TYPES,
    [
      "face_off",
      "sentiment",
      "value_vote",
      "overall_rating",
      "trending_poll",
      "opinion_poll",
      "image_curate",
      "induction",
    ],
  );
});

test("isVoteTabVoteType narrows valid vote-tab types", () => {
  assert.equal(isVoteTabVoteType("value_vote"), true);
  assert.equal(isVoteTabVoteType("opinion_poll"), true);
  assert.equal(isVoteTabVoteType("comment_vote"), false);
  assert.equal(isVoteTabVoteType("insight_vote"), false);
});
