import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { REPROMPT_DAYS, shouldOpenInterestsPrompt } from "../client/src/lib/interestsPrompt";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function decide(overrides: Partial<Parameters<typeof shouldOpenInterestsPrompt>[0]> = {}) {
  return shouldOpenInterestsPrompt({
    statedInterests: [],
    dismissedAtMs: null,
    now: NOW,
    shownThisSession: false,
    totalVotes: 0,
    totalPredictions: 0,
    ...overrides,
  });
}

describe("interests prompt snooze", () => {
  it("asks immediately the first time, whatever the vote and prediction counts", () => {
    assert.equal(decide(), true);
    assert.equal(decide({ totalVotes: 100, totalPredictions: 100 }), true);
  });

  it("stays closed after a save, including when the user has never dismissed", () => {
    assert.equal(decide({ statedInterests: ["music"] }), false);
    assert.equal(
      decide({
        statedInterests: ["music"],
        dismissedAtMs: NOW - 10 * DAY,
        totalVotes: 40,
      }),
      false,
    );
  });

  it("does not reopen while the dismissal is under REPROMPT_DAYS old", () => {
    assert.equal(REPROMPT_DAYS, 2);
    const justDismissed = decide({ dismissedAtMs: NOW - 1_000 });
    const almostTwoDays = decide({ dismissedAtMs: NOW - (2 * DAY - 1) });
    assert.equal(justDismissed, false);
    assert.equal(almostTwoDays, false);
  });

  it("does not let 20 or more votes or predictions bypass a fresh dismiss", () => {
    assert.equal(
      decide({
        dismissedAtMs: NOW - 60_000,
        totalVotes: 20,
        totalPredictions: 0,
      }),
      false,
    );
    assert.equal(
      decide({
        dismissedAtMs: NOW - DAY,
        totalVotes: 0,
        totalPredictions: 20,
      }),
      false,
    );
    assert.equal(
      decide({
        dismissedAtMs: NOW - (2 * DAY - 1),
        totalVotes: 500,
        totalPredictions: 500,
      }),
      false,
    );
  });

  it("reopens once the snooze has elapsed, and not again in the same document", () => {
    assert.equal(decide({ dismissedAtMs: NOW - 2 * DAY }), true);
    assert.equal(decide({ dismissedAtMs: NOW - 3 * DAY, totalVotes: 20 }), true);
    assert.equal(
      decide({ dismissedAtMs: NOW - 3 * DAY, shownThisSession: true, totalVotes: 40 }),
      false,
    );
  });

  it("ignores a same-document latch on the never-dismissed prompt", () => {
    assert.equal(decide({ shownThisSession: true, totalVotes: 20 }), true);
  });

  it("routes a drag, swipe, or overlay close through the same dismiss PATCH", () => {
    const picker = readFileSync(
      new URL("../client/src/components/interests/InterestsPicker.tsx", import.meta.url),
      "utf8",
    );
    assert.match(picker, /onOpenChange=\{handleOpenChange\}/);
    assert.match(picker, /void persistDismiss\(\)/);
    assert.match(picker, /dismissed:\s*true/);
    assert.match(picker, /suppressGestureDismiss/);
  });
});
