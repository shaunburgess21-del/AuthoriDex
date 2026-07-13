import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { matchLocalBlocklist } from "../server/services/moderation/blocklist";
import {
  AUTO_HIDE_CATEGORIES,
  MODERATION_AUTO_HIDE_THRESHOLD,
  MODERATION_REVIEW_THRESHOLD,
} from "../server/services/moderation/config";
import { decideFromScores } from "../server/services/moderation/text";

describe("moderation blocklist", () => {
  it("auto-hides obvious abuse tokens", () => {
    assert.ok(matchLocalBlocklist("go kys").length > 0);
    assert.ok(matchLocalBlocklist("that is csam material").length > 0);
  });

  it("allows heated debate phrasing", () => {
    assert.equal(
      matchLocalBlocklist("Drake is trending hard this week — curious if the score holds.").length,
      0,
    );
  });
});

describe("moderation score bands", () => {
  it("auto-hides when a severe category clears the auto-hide threshold", () => {
    const scores = Object.fromEntries(
      AUTO_HIDE_CATEGORIES.map((cat) => [cat, 0]),
    ) as Record<string, number>;
    scores["hate/threatening"] = MODERATION_AUTO_HIDE_THRESHOLD;

    const { decision, matchedCategories } = decideFromScores(scores, true);
    assert.equal(decision, "auto_hide");
    assert.deepEqual(matchedCategories, ["hate/threatening"]);
  });

  it("queues review without auto-hiding in the band between thresholds", () => {
    const scores = Object.fromEntries(
      AUTO_HIDE_CATEGORIES.map((cat) => [cat, 0]),
    ) as Record<string, number>;
    scores["harassment/threatening"] = MODERATION_REVIEW_THRESHOLD;

    const { decision, matchedCategories } = decideFromScores(scores, true);
    assert.equal(decision, "review");
    assert.deepEqual(matchedCategories, ["harassment/threatening"]);
  });

  it("allows heated debate even when Omni sets flagged=true", () => {
    const scores = Object.fromEntries(
      AUTO_HIDE_CATEGORIES.map((cat) => [cat, 0.1]),
    ) as Record<string, number>;

    const { decision } = decideFromScores(scores, true);
    assert.equal(decision, "allow");
  });
});
