import assert from "node:assert/strict";
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
