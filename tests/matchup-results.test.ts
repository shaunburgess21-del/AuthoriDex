import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { matchupResultsVisible } from "../client/src/lib/matchupResults";

describe("matchupResultsVisible", () => {
  it("hides percentages until the viewer votes", () => {
    assert.equal(matchupResultsVisible({ userVote: null }), false);
    assert.equal(matchupResultsVisible({ userVote: "" }), false);
    assert.equal(matchupResultsVisible({ userVote: "option_a" }), true);
    assert.equal(matchupResultsVisible({ userVote: "neutral" }), true);
  });

  it("shows results on a closed matchup even with no vote", () => {
    assert.equal(matchupResultsVisible({ userVote: null, isActive: false }), true);
    assert.equal(matchupResultsVisible({ userVote: null, visibility: "inactive" }), true);
    assert.equal(matchupResultsVisible({ userVote: null, isActive: true, visibility: "live" }), false);
  });
});

describe("desktop section cards hide results until a vote", () => {
  it("gates the Versus result bar on the shared helper and ends an unvoted card under the names", () => {
    const source = readFileSync(
      new URL("../client/src/components/matchups/VersusCard.tsx", import.meta.url),
      "utf8",
    );
    assert.match(source, /matchupResultsVisible\(\{/);
    assert.match(source, /\{showResults \? \(/);
    assert.equal(source.includes(': "%"'), false);
    assert.equal(source.includes("bg-slate-700/40"), false);
    const footerAt = source.indexOf("min-h-7");
    const votedGuard = source.lastIndexOf("{hasVoted ? (", footerAt);
    assert.ok(votedGuard > 0 && footerAt - votedGuard < 180, "the action row is only rendered after a vote");
    assert.match(source, /showResults \? "h-full" : "h-auto"/);
  });

  it("keeps Opinion percents and vote counts off the unvoted card", () => {
    const source = readFileSync(
      new URL("../client/src/components/opinion-polls/OpinionPollCard.tsx", import.meta.url),
      "utf8",
    );
    const unvotedStart = source.indexOf("{!hasVoted ? (");
    const unvotedEnd = source.indexOf(") : (", unvotedStart);
    const unvoted = source.slice(unvotedStart, unvotedEnd);
    assert.ok(unvotedStart > 0 && unvotedEnd > unvotedStart);
    assert.equal(unvoted.includes("percent"), false);
    assert.equal(unvoted.includes("votes"), false);
    const countAt = source.indexOf("<CardVoteCount");
    const countGuard = source.lastIndexOf("{hasVoted && (", countAt);
    assert.ok(countGuard > 0 && countAt > countGuard, "the vote count renders only after a vote");
  });
});
