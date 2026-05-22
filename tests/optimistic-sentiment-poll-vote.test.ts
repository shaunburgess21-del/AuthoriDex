import assert from "node:assert/strict";
import { optimisticSentimentVotePatch } from "../client/src/lib/optimisticSentimentPollVote";

const base = {
  userVote: null as string | null,
  supportCount: 10,
  neutralCount: 5,
  opposeCount: 5,
  totalVotes: 20,
  approvePercent: 50,
  neutralPercent: 25,
  disapprovePercent: 25,
};

assert.equal(optimisticSentimentVotePatch(base, "support").userVote, "support");
assert.equal(optimisticSentimentVotePatch(base, "support").supportCount, 11);
assert.equal(optimisticSentimentVotePatch(base, "support").totalVotes, 21);

const voted = optimisticSentimentVotePatch({ ...base, userVote: "support" }, "oppose");
assert.equal(voted.userVote, "oppose");
assert.equal(voted.supportCount, 9);
assert.equal(voted.opposeCount, 6);
assert.equal(voted.totalVotes, 20);

console.log("optimistic-sentiment-poll-vote.test.ts: ok");
