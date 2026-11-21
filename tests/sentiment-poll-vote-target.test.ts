import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  sentimentPollIdFallback,
  sentimentPollVoteKey,
  sentimentPollVotePath,
  slugOrGenerated,
} from "../shared/lib/sentiment-poll-vote-target";
import { isAlreadyPresentedVoteError } from "../client/src/lib/sentimentVotePresented";
import { VoteGateRedirectError } from "../client/src/lib/voteGate";

const XI_ID = "8a0931e8-8901-466c-9aa4-aab41863e10c";
const XI_HEADLINE = "Was the September 2026 Xi–Trump summit beneficial for both countries?";

test("a sentiment poll with no slug votes and opens by its id", () => {
  const poll = { id: XI_ID, slug: null as string | null };
  assert.equal(sentimentPollVoteKey(poll), XI_ID);
  assert.equal(sentimentPollVotePath(poll), `/api/polls/${XI_ID}/vote`);
  assert.equal(sentimentPollIdFallback(XI_ID), XI_ID);
  assert.equal(sentimentPollVoteKey({ id: XI_ID, slug: "   " }), XI_ID);
});

test("a stored slug still wins over the id", () => {
  const poll = { id: XI_ID, slug: "pineapple-on-pizza" };
  assert.equal(sentimentPollVoteKey(poll), "pineapple-on-pizza");
  assert.equal(
    sentimentPollVotePath({ id: XI_ID, slug: "  pineapple-on-pizza  " }),
    "/api/polls/pineapple-on-pizza/vote",
  );
  assert.equal(sentimentPollIdFallback("pineapple-on-pizza"), null);
  assert.equal(sentimentPollIdFallback("was-the-september-2026-xi-trump-summit"), null);
});

test("a blank slug is generated and an en-dash does not survive into it", () => {
  const now = 1_700_000_000_000;
  const generated = slugOrGenerated("", XI_HEADLINE, now);
  assert.match(
    generated,
    /^was-the-september-2026-xi-trump-summit-beneficial-for-both-countries-[a-z0-9]+$/,
  );
  assert.equal(generated.includes("–"), false);
  assert.equal(slugOrGenerated("  kept-slug  ", XI_HEADLINE, now), "kept-slug");
  assert.equal(slugOrGenerated(null, "", now), `item-${now.toString(36)}`);
});

test("vote cards only toast errors the mutation did not already show", () => {
  assert.equal(isAlreadyPresentedVoteError(new VoteGateRedirectError()), true);
  const apiError = new Error("404: {\"error\":\"Poll not found\"}");
  apiError.name = "ApiError";
  assert.equal(isAlreadyPresentedVoteError(apiError), true);
  assert.equal(
    isAlreadyPresentedVoteError(new Error("This poll is no longer available.")),
    false,
  );
});

test("poll detail and vote routes fall back to the poll id", () => {
  const src = readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");
  const detailAt = src.indexOf('app.get("/api/polls/:slug"');
  const voteAt = src.indexOf('app.post("/api/polls/:slug/vote"');
  assert.ok(detailAt >= 0 && voteAt > detailAt);
  const detail = src.slice(detailAt, voteAt);
  const vote = src.slice(voteAt, voteAt + 4000);
  for (const block of [detail, vote]) {
    assert.equal(block.includes("sentimentPollIdFallback"), true);
    assert.equal(block.includes("trendingPolls.id"), true);
    assert.equal(block.includes("trendingPolls.slug"), true);
  }
});
