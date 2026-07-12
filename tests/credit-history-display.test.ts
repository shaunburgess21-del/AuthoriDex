import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAmmTradeDisplay,
  buildVoteDisplay,
  buildLedgerDisplayFallback,
  buildPostInsightDisplay,
  buildCommentInsightDisplay,
  truncateLedgerLabel,
} from "../shared/lib/credit-history-display";
import { labelForTxnType } from "../shared/credit-config";

test("buildAmmTradeDisplay formats buy with market and outcome", () => {
  const result = buildAmmTradeDisplay(
    "amm_buy",
    { shares: 100, marketId: "m1", entryId: "e1" },
    { id: "m1", title: "Will rates drop?", slug: "rates", marketType: "community" },
    { label: "Yes" },
  );
  assert.equal(
    result.displayTitle,
    "Bought 100 shares of Yes on Will rates drop?",
  );
  assert.equal(result.displaySubtitle, undefined);
  assert.equal(result.href, "/markets/rates");
});

test("buildAmmTradeDisplay never exposes AMM in fallback label", () => {
  const result = buildAmmTradeDisplay("amm_buy", null, null, null);
  assert.equal(result.displayTitle, labelForTxnType("amm_buy"));
  assert.equal(result.displayTitle, "Prediction purchase");
  assert.equal(result.displaySubtitle, "Prediction purchase");
  assert.doesNotMatch(result.displayTitle, /amm/i);
});

test("buildAmmTradeDisplay with shares only omits redundant subtitle", () => {
  const result = buildAmmTradeDisplay("amm_buy", { shares: 25 }, null, null);
  assert.equal(result.displayTitle, "Bought 25 shares");
  assert.equal(result.displaySubtitle, undefined);
});

test("buildAmmTradeDisplay formats sell", () => {
  const result = buildAmmTradeDisplay(
    "amm_sell",
    { shares: 50 },
    { id: "m2", title: "BTC up?", slug: null, marketType: "updown" },
    { label: "Up" },
  );
  assert.equal(result.displayTitle, "Sold 50 shares of Up on BTC up?");
  assert.equal(result.displaySubtitle, undefined);
  assert.equal(result.href, "/predict/updown/m2");
});

test("buildVoteDisplay shows person name for sentiment", () => {
  const result = buildVoteDisplay(
    { voteType: "sentiment", entityId: "p1", personId: "p1" },
    { personName: "Taylor Swift" },
  );
  assert.equal(result.displayTitle, "Taylor Swift");
  assert.equal(result.displaySubtitle, "Sentiment vote");
  assert.equal(result.href, "/person/p1");
});

test("buildVoteDisplay links sentiment poll to poll detail page", () => {
  const result = buildVoteDisplay(
    { voteType: "trending_poll", entityId: "poll-1", choice: "agree" },
    {
      pollHeadline: "Should the USA defend Taiwan if China invades?",
      trendingPollSlug: "should-the-usa-defend-taiwan-if-china-invades",
    },
  );
  assert.match(result.displayTitle, /Taiwan/);
  assert.equal(result.displaySubtitle, "Sentiment poll vote");
  assert.equal(
    result.href,
    "/polls/should-the-usa-defend-taiwan-if-china-invades",
  );
});

test("buildVoteDisplay shows matchup with choice", () => {
  const result = buildVoteDisplay(
    { voteType: "matchup", entityId: "f1", votedOption: "A" },
    { matchupTitle: "Who wins?", matchupSlug: "who-wins" },
  );
  assert.equal(result.displayTitle, "Who wins? (A)");
  assert.equal(result.href, "/vote/matchups/who-wins");
});

test("buildVoteDisplay falls back to surface label without context", () => {
  const result = buildVoteDisplay({ voteType: "curation", entityId: "img1" });
  assert.equal(result.displayTitle, "Image curation vote");
  assert.equal(result.displaySubtitle, "Vote reward");
});

test("buildLedgerDisplayFallback uses friendly vote label", () => {
  const result = buildLedgerDisplayFallback("vote_any", 2, { voteType: "value" });
  assert.equal(result.displayTitle, "Value rating");
  assert.equal(labelForTxnType("vote_any"), "Vote");
});

test("labelForTxnType maps amm types without AMM wording", () => {
  assert.equal(labelForTxnType("amm_buy"), "Prediction purchase");
  assert.equal(labelForTxnType("amm_sell"), "Prediction sale");
});

test("truncateLedgerLabel shortens long insight text", () => {
  const long = "a".repeat(100);
  assert.equal(truncateLedgerLabel(long).length, 80);
  assert.ok(truncateLedgerLabel(long).endsWith("…"));
});

test("buildPostInsightDisplay uses content and person link", () => {
  const result = buildPostInsightDisplay(
    "Elon should focus on fixing X before buying more companies.",
    "Elon Musk",
    "person-42",
  );
  assert.match(result.displayTitle, /Elon should focus/);
  assert.equal(result.displaySubtitle, "Posted insight · Elon Musk");
  assert.equal(result.href, "/person/person-42");
});

test("buildCommentInsightDisplay uses comment body and person link", () => {
  const result = buildCommentInsightDisplay(
    "Great take — the margin story is underrated.",
    "Taylor Swift",
    "person-7",
  );
  assert.match(result.displayTitle, /margin story/);
  assert.equal(result.displaySubtitle, "Comment on insight · Taylor Swift");
  assert.equal(result.href, "/person/person-7");
});
