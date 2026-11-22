import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const header = read("../client/src/components/vote/VoteCardHeader.tsx");
const versus = read("../client/src/components/matchups/VersusCard.tsx");
const discourse = read("../client/src/components/sentiment/DiscourseCard.tsx");
const opinion = read("../client/src/components/opinion-polls/OpinionPollCard.tsx");
const rating = read("../client/src/components/OverallRatingCard.tsx");

describe("vote card type header", () => {
  it("centres the cue on equal side tracks so the ends cannot pull it off centre", () => {
    assert.match(
      header,
      /grid grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\] items-center gap-x-2/,
    );
    assert.match(header, /min-w-max/);
    assert.match(header, /overflow-hidden \[&_button\]:max-w-full \[&_button\]:min-w-0/);
    const cueAt = header.indexOf("<VoteTypeCue");
    const leadingAt = header.lastIndexOf("{leading}", cueAt);
    const trailingAt = header.indexOf("{trailing}", cueAt);
    assert.ok(leadingAt > 0 && cueAt > leadingAt && trailingAt > cueAt);

    assert.match(header, /flex items-center justify-between gap-2/);
    assert.equal(header.includes("ml-auto"), false);
    assert.equal(header.includes("pr-28"), false);
    assert.equal(header.includes("flex-1 justify-center"), false);
  });

  it("puts Head-to-head on the same centred header as Agree?, Pick one, and Rate", () => {
    assert.match(versus, /<VoteCardHeader[\s\S]*kind="matchup"/);
    assert.match(discourse, /kind=\{showTypeCue \? "sentiment" : null\}/);
    assert.match(opinion, /kind=\{showTypeCue \? "opinion" : null\}/);
    assert.match(rating, /kind=\{showTypeCue \? "rating" : null\}/);

    for (const source of [versus, discourse, opinion, rating]) {
      assert.equal(source.includes("ml-auto"), false);
      assert.equal(source.includes("pr-28"), false);
      assert.equal(source.includes("<VoteTypeCue"), false);
    }

    assert.match(versus, /className="px-4"/);
    assert.match(versus, /absolute top-3 right-3 z-10/);
    const cueStart = versus.indexOf("{showTypeCue ? (");
    const cueEnd = versus.indexOf(") : (", cueStart);
    const cueBranch = versus.slice(cueStart, cueEnd);
    assert.ok(cueStart > 0 && cueEnd > cueStart);
    assert.match(cueBranch, /VoteCardHeader/);
    assert.equal(cueBranch.includes("absolute"), false);
  });

  it("does not draw a divider between the Agree? crowd line and the footer", () => {
    const openingDivAfter = (source: string, marker: string) => {
      const at = source.indexOf(marker);
      const start = source.indexOf("<div", at);
      return source.slice(start, source.indexOf(">", start) + 1);
    };
    const sentimentFooter = openingDivAfter(discourse, "crowd-line-poll-");
    const versusFooter = openingDivAfter(versus, "crowd-line-matchup-");
    const opinionFooter = openingDivAfter(opinion, "crowd-line-opinion-");
    assert.equal(sentimentFooter.includes("border-t"), false);
    assert.match(sentimentFooter, /mt-auto flex min-h-7 items-center gap-2 pt-2 md:mt-2 md:pt-0/);
    assert.equal(versusFooter.includes("border-t"), false);
    assert.equal(opinionFooter.includes("border-t"), false);
    assert.match(versusFooter, /mt-2 min-h-7/);
  });
});
