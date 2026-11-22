import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CURRENCY } from "../shared/currency";
import {
  CROWD_SPLIT_THRESHOLD_PP,
  choiceCrowdLine,
  isCrowdSplit,
  ratingCrowdLine,
} from "../client/src/lib/crowdLine";
import {
  resolvedBatchNet,
  resolvedBatchNetLabel,
  resolvedBetSentence,
} from "../client/src/lib/resolvedBetCopy";
import { myVoteCrowdCopy, myVoteHref } from "../client/src/lib/myVoteCrowd";
import {
  crowdSharesFromCounts,
  crowdSharesFromPercents,
  ratingBucketShare,
} from "../server/services/my-votes-crowd";

const mark = CURRENCY.symbol;

describe("crowd line copy", () => {
  const options = (a: number, b: number, neutral = 0) => [
    { key: "option_a", percent: a },
    { key: "option_b", percent: b },
    { key: "neutral", percent: neutral },
  ];

  it("calls a clear lead the majority", () => {
    const line = choiceCrowdLine(options(61, 39), "option_a");
    assert.equal(line?.kind, "majority");
    assert.equal(line?.text, "You're with the majority (61%)");
  });

  it("calls a clear trail the minority", () => {
    const line = choiceCrowdLine(options(78, 22), "option_b");
    assert.equal(line?.kind, "minority");
    assert.equal(line?.text, "Only 22% agreed with you");
  });

  it("calls a race within 5 points a split, including a tie", () => {
    assert.equal(CROWD_SPLIT_THRESHOLD_PP, 5);
    assert.equal(isCrowdSplit([55, 50]), true);
    assert.equal(isCrowdSplit([50, 50]), true);
    assert.equal(isCrowdSplit([56, 50]), false);
    const split = choiceCrowdLine(options(52, 48), "option_a");
    assert.equal(split?.kind, "split");
    assert.equal(split?.text, "The crowd is split");
    const tie = choiceCrowdLine(options(50, 50), "option_b");
    assert.equal(tie?.text, "The crowd is split");
  });

  it("uses the rating bucket share, and a close distribution is still a split", () => {
    const like = ratingCrowdLine([5, 10, 15, 40, 30], 4);
    assert.equal(like?.kind, "rating");
    assert.equal(like?.text, "40% rated it like you");
    const close = ratingCrowdLine([10, 12, 26, 28, 24], 4);
    assert.equal(close?.kind, "split");
    assert.equal(close?.text, "The crowd is split");
  });

  it("returns null when there is no vote to place", () => {
    assert.equal(choiceCrowdLine(options(60, 40), null), null);
    assert.equal(ratingCrowdLine([0, 0, 0, 0, 0], 4), null);
  });
});

describe("resolved prediction sentences", () => {
  it("names a win, a miss, and a refund in virtual credits", () => {
    assert.equal(
      resolvedBetSentence({ result: "won", stakeAmount: 100, payout: 216 }),
      `You won ${mark}216`,
    );
    assert.equal(
      resolvedBetSentence({ result: "lost", stakeAmount: 100, payout: 0 }),
      `Didn't land · ${mark}100`,
    );
    assert.equal(
      resolvedBetSentence({ result: "refunded", stakeAmount: 100, payout: 100 }),
      `Refunded ${mark}100`,
    );
    assert.equal(
      resolvedBetSentence({ result: "pending", stakeAmount: 100, payout: 0 }),
      null,
    );
  });

  it("nets the batch as credits gained or lost", () => {
    const net = resolvedBatchNet([
      { result: "won", stakeAmount: 100, payout: 216 },
      { result: "lost", stakeAmount: 100, payout: 0 },
      { result: "refunded", stakeAmount: 50, payout: 50 },
    ]);
    assert.equal(net, 16);
    assert.equal(resolvedBatchNetLabel(net), `Net +${mark}16`);
    assert.equal(resolvedBatchNetLabel(-100), `Net −${mark}100`);
    assert.equal(resolvedBatchNetLabel(0), `Net ${mark}0`);
  });
});

describe("my votes crowd fields", () => {
  it("turns a tally into the user's share and per-option percents", () => {
    const share = crowdSharesFromCounts(
      [
        { key: "cats", label: "Cats", count: 61 },
        { key: "dogs", label: "Dogs", count: 39 },
      ],
      "cats",
    );
    assert.equal(share.crowdPercent, 61);
    assert.deepEqual(share.optionPercents, [
      { key: "cats", label: "Cats", percent: 61 },
      { key: "dogs", label: "Dogs", percent: 39 },
    ]);
  });

  it("passes stored sentiment percents through without recomputing them", () => {
    const share = crowdSharesFromPercents(
      [
        { key: "underrated", label: "Underrated", percent: 40 },
        { key: "overrated", label: "Overrated", percent: 60 },
      ],
      "underrated",
    );
    assert.equal(share.crowdPercent, 40);
  });

  it("reads a rating bucket from the 1-5 counts", () => {
    const share = ratingBucketShare([1, 1, 2, 4, 2], 4);
    assert.equal(share.crowdPercent, 40);
    assert.equal(share.optionPercents?.find((option) => option.key === "4")?.label, "Like");
  });

  it("stays empty when the tally has no votes", () => {
    const share = crowdSharesFromCounts(
      [
        { key: "cats", label: "Cats", count: 0 },
        { key: "dogs", label: "Dogs", count: 0 },
      ],
      "cats",
    );
    assert.equal(share.crowdPercent, null);
    assert.equal(share.optionPercents, null);
  });

  it("writes card copy from the new fields and ignores an older payload", () => {
    assert.equal(
      myVoteCrowdCopy({ voteType: "opinion_poll", crowdPercent: 61, choiceLabel: "Cats" }),
      "61% chose Cats",
    );
    assert.equal(
      myVoteCrowdCopy({ voteType: "trending_poll", crowdPercent: 40, choiceLabel: "Agree" }),
      "You and 40% agreed",
    );
    assert.equal(
      myVoteCrowdCopy({ voteType: "overall_rating", crowdPercent: 40, choiceLabel: "Like" }),
      "40% rated it like you",
    );
    assert.equal(myVoteCrowdCopy({ voteType: "opinion_poll", choiceLabel: "Cats" }), null);
    assert.equal(myVoteCrowdCopy({ voteType: "induction" }), null);
  });

  it("builds a route only when the new id or slug is present", () => {
    assert.equal(
      myVoteHref({ voteType: "face_off", slug: "cats-vs-dogs" }),
      "/vote/matchups/cats-vs-dogs",
    );
    assert.equal(
      myVoteHref({ voteType: "opinion_poll", slug: "best-pet" }),
      "/vote/opinion-polls/best-pet",
    );
    assert.equal(
      myVoteHref({ voteType: "trending_poll", slug: "agree-on-this" }),
      "/polls/agree-on-this",
    );
    assert.equal(
      myVoteHref({ voteType: "sentiment", subjectId: "person-1" }),
      "/person/person-1",
    );
    assert.equal(
      myVoteHref({ voteType: "induction", targetId: "cand-9" }),
      "/vote/induction#induction-card-cand-9",
    );
    assert.equal(myVoteHref({ voteType: "face_off" }), null);
    assert.equal(myVoteHref({ voteType: "induction" }), null);
  });
});

describe("past votes wiring", () => {
  const votesRoute = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const voteCard = readFileSync(new URL("../client/src/components/me/MyVoteCard.tsx", import.meta.url), "utf8");
  const strip = readFileSync(
    new URL("../client/src/components/vote/ReturningUserStrip.tsx", import.meta.url),
    "utf8",
  );

  it("adds the crowd fields on GET /api/me/votes without a new table", () => {
    const start = votesRoute.indexOf('app.get("/api/me/votes"');
    const end = votesRoute.indexOf('app.get("/api/me/predictions"', start);
    const handler = votesRoute.slice(start, end);
    assert.match(handler, /crowdPercent/);
    assert.match(handler, /optionPercents/);
    assert.match(handler, /targetId/);
    assert.match(handler, /slug/);
    assert.doesNotMatch(handler, /ALTER TABLE|create table/i);
  });

  it("keeps the vote row usable when the crowd fields are missing", () => {
    assert.match(voteCard, /myVoteCrowdCopy/);
    assert.match(voteCard, /myVoteHref/);
    assert.match(voteCard, /if \(!href\) return <div/);
  });

  it("opens the resolved chip in a sheet and still stamps last-seen", () => {
    assert.match(strip, /ResolvedPredictionsSheet/);
    assert.match(strip, /stampResolvedLastSeenAt/);
    assert.doesNotMatch(strip, /href="\/me\/predictions"/);
  });
});
