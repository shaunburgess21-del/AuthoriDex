import assert from "node:assert/strict";
import {
  applyLocalRating,
  projectRatingDistribution,
  ratingDistributionStats,
} from "../client/src/lib/overallRatingDistribution";
import {
  mergeInductionVotedIds,
  withInductionVote,
} from "../client/src/lib/inductionVotedState";
import {
  USER_BALLOT_SOURCES,
  badgeKeysForVoteTotal,
  sumBallotCounts,
} from "../shared/lib/user-ballots";
import { isPersonalizedVoteGet } from "../server/lib/personalVoteCache";
import { shouldRetryQuery } from "../client/src/lib/queryRetry";

const loveOnly = [0, 0, 0, 0, 2];

// Harry Kane case: two Love votes already on the book, tester rates Neutral (3).
{
  const counts = projectRatingDistribution(loveOnly, null, 3);
  const stats = ratingDistributionStats(counts);
  assert.deepEqual(counts, [0, 0, 1, 0, 2]);
  assert.equal(stats.total, 3);
  assert.equal(stats.average, (5 + 5 + 3) / 3);
  const pct = counts.map((c) => Math.round((c / stats.total) * 100));
  assert.equal(pct[2], 33);
  assert.equal(pct[4], 67);
}

// After the list refetch, the payload already includes the Neutral vote.
{
  const confirmed = projectRatingDistribution([0, 0, 1, 0, 2], 3, 3);
  assert.deepEqual(confirmed, [0, 0, 1, 0, 2]);
}

// Changing Love to Neutral removes the viewer's previous 5 and adds the 3.
{
  const changed = projectRatingDistribution(loveOnly, 5, 3);
  assert.deepEqual(changed, [0, 0, 1, 0, 1]);
  assert.equal(ratingDistributionStats(changed).total, 2);
}

// No local vote leaves the server book alone, including when the server
// already recorded this viewer.
{
  assert.deepEqual(projectRatingDistribution(loveOnly, 5, null), loveOnly);
  assert.deepEqual(projectRatingDistribution(loveOnly, null, null), loveOnly);
}

{
  const patched = applyLocalRating(
    { id: "kane", ratingDistribution: loveOnly, userApprovalRating: null, approvalVotesCount: 2, approvalAvgRating: 5 },
    3,
  );
  assert.equal(patched.userApprovalRating, 3);
  assert.deepEqual(patched.ratingDistribution, [0, 0, 1, 0, 2]);
  assert.equal(patched.approvalVotesCount, 3);
  assert.equal(patched.approvalAvgRating, (5 + 5 + 3) / 3);
  const again = applyLocalRating(patched, 3);
  assert.deepEqual(again.ratingDistribution, patched.ratingDistribution);
  assert.equal(again.approvalVotesCount, 3);
}

{
  const pending = new Set(["ryan"]);
  assert.equal(mergeInductionVotedIds([], pending).has("ryan"), true);
  assert.equal(mergeInductionVotedIds(undefined, pending).has("ryan"), true);
  assert.equal(mergeInductionVotedIds(["ryan"], pending).size, 1);
  assert.deepEqual(withInductionVote(["other"], "ryan"), ["other", "ryan"]);
  assert.deepEqual(withInductionVote(["ryan"], "ryan"), ["ryan"]);
}

{
  const ids = USER_BALLOT_SOURCES.map((source) => source.id);
  for (const required of ["sentiment", "matchup", "opinion", "overall_rating", "induction", "curate"] as const) {
    assert.equal(ids.includes(required), true, required);
  }
  assert.equal(sumBallotCounts([1, 2, 3]), 6);
  assert.deepEqual(badgeKeysForVoteTotal(0), []);
  assert.deepEqual(badgeKeysForVoteTotal(1), ["first_vote"]);
  assert.equal(badgeKeysForVoteTotal(4).includes("first_vote"), true);
  assert.equal(badgeKeysForVoteTotal(4).includes("quarter_century"), false);
  assert.equal(badgeKeysForVoteTotal(25).includes("quarter_century"), true);
}

{
  assert.equal(isPersonalizedVoteGet("GET", "/api/trending-polls"), true);
  assert.equal(isPersonalizedVoteGet("GET", "/api/vote/overall-ratings"), true);
  assert.equal(isPersonalizedVoteGet("GET", "/api/me/induction-votes"), true);
  assert.equal(isPersonalizedVoteGet("GET", "/api/polls/pineapple-on-pizza"), true);
  assert.equal(isPersonalizedVoteGet("GET", "/api/trending"), false);
  assert.equal(isPersonalizedVoteGet("POST", "/api/trending-polls"), false);
}

{
  const aborted = new Error("The operation was aborted");
  aborted.name = "AbortError";
  assert.equal(shouldRetryQuery(0, aborted), false);
}

console.log("vote-state-fixes.test.ts: ok");
