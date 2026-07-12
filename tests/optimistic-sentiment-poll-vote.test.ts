import assert from "node:assert/strict";
import { optimisticSentimentVotePatch } from "../client/src/lib/optimisticSentimentPollVote";

const base = {
  userVote: null as string | null,
  agreeCount: 10,
  neutralCount: 5,
  disagreeCount: 5,
  totalVotes: 20,
  agreePercent: 50,
  neutralPercent: 25,
  disagreePercent: 25,
};

assert.equal(optimisticSentimentVotePatch(base, "agree").userVote, "agree");
assert.equal(optimisticSentimentVotePatch(base, "agree").agreeCount, 11);
assert.equal(optimisticSentimentVotePatch(base, "agree").totalVotes, 21);

const voted = optimisticSentimentVotePatch({ ...base, userVote: "agree" }, "disagree");
assert.equal(voted.userVote, "disagree");
assert.equal(voted.agreeCount, 9);
assert.equal(voted.disagreeCount, 6);
assert.equal(voted.totalVotes, 20);

console.log("optimistic-sentiment-poll-vote.test.ts: ok");
