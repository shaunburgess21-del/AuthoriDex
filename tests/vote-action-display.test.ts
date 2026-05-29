import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVoteActionDisplay,
  formatFaceOffChoice,
  labelForVoteActionKind,
  surfaceLabelForVoteType,
} from "../shared/lib/vote-action-display";

test("labelForVoteActionKind maps create update remove", () => {
  assert.equal(labelForVoteActionKind("create"), "New vote");
  assert.equal(labelForVoteActionKind("update"), "Changed vote");
  assert.equal(labelForVoteActionKind("remove"), "Removed vote");
});

test("formatFaceOffChoice maps option keys", () => {
  assert.equal(formatFaceOffChoice("option_a"), "Option A");
  assert.equal(formatFaceOffChoice("option_b"), "Option B");
  assert.equal(formatFaceOffChoice("neutral"), "Neutral");
});

test("buildVoteActionDisplay sentiment with person and choice", () => {
  const result = buildVoteActionDisplay(
    {
      voteType: "sentiment",
      actionKind: "create",
      targetId: "p1",
      nextValue: "overrated",
    },
    { personName: "Taylor Swift", personId: "p1" },
  );
  assert.equal(result.displayTitle, "Rated Taylor Swift overrated");
  assert.match(result.displaySubtitle ?? "", /Sentiment vote/);
  assert.match(result.displaySubtitle ?? "", /New vote/);
  assert.equal(result.href, "/person/p1");
});

test("buildVoteActionDisplay face_off with matchup and pick", () => {
  const result = buildVoteActionDisplay(
    {
      voteType: "face_off",
      actionKind: "create",
      targetId: "m1",
      nextValue: "option_a",
    },
    {
      matchupTitle: "Who wins?",
      matchupSlug: "who-wins",
      optionAText: "Team A",
      optionBText: "Team B",
    },
  );
  assert.equal(result.displayTitle, "Voted Team A on Who wins?");
  assert.equal(result.href, "/vote/matchups/who-wins");
});

test("buildVoteActionDisplay amm-like fallback uses surface label", () => {
  const result = buildVoteActionDisplay({
    voteType: "unknown_type",
    actionKind: "create",
    targetId: "x",
  });
  assert.equal(result.displayTitle, surfaceLabelForVoteType("unknown_type"));
});

test("buildVoteActionDisplay remove uses prevValue for opinion poll option", () => {
  const result = buildVoteActionDisplay(
    {
      voteType: "opinion_poll",
      actionKind: "remove",
      targetId: "poll-1",
      prevValue: "opt-1",
    },
    {
      pollTitle: "Favorite color?",
      optionName: "Blue",
      opinionPollSlug: "favorite-color",
    },
  );
  assert.equal(result.displayTitle, "Favorite color? — Blue");
  assert.match(result.displaySubtitle ?? "", /Removed vote/);
});

test("buildVoteActionDisplay trending poll with choice", () => {
  const result = buildVoteActionDisplay(
    {
      voteType: "trending_poll",
      actionKind: "update",
      targetId: "poll-1",
      prevValue: "oppose",
      nextValue: "support",
    },
    {
      pollHeadline: "Should we expand?",
      trendingPollSlug: "should-we-expand",
    },
  );
  assert.equal(result.displayTitle, "Should we expand? (Support)");
});
