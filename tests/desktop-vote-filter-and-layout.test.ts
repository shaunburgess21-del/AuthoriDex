import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lockedVoteCardBox } from "../client/src/hooks/useLockedVoteCardHeight";
import {
  hubActivityFilterFabLabel,
  hubActivityFilterLongestLabel,
} from "../client/src/lib/hub-activity-filter";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("desktop activity filter", () => {
  const vote = read("../client/src/pages/VotePage.tsx");
  const predict = read("../client/src/pages/PredictPage.tsx");
  const toggle = read("../client/src/components/HubActivityFilterToggle.tsx");
  const host = read("../client/src/components/quick-vote/QuickVoteHost.tsx");

  it("puts a real cycle button beside the category menu on desktop", () => {
    assert.match(toggle, /hidden md:inline-flex/);
    assert.match(toggle, /onClick=\{onCycle\}/);
    assert.match(toggle, /type="button"/);
    assert.match(vote, /<HubActivityFilterToggle[\s\S]*onCycle=\{cycleMyVotesFilter\}/);
    assert.match(predict, /<HubActivityFilterToggle[\s\S]*onCycle=\{cycleMyPositionsFilter\}/);
    const voteToggle = vote.indexOf("<HubActivityFilterToggle");
    const voteMenu = vote.indexOf("<VoteCategoryMenu");
    assert.ok(voteMenu > 0 && voteToggle > voteMenu);
  });

  it("holds a fixed width that fits the longest label and the 999+ badge", () => {
    assert.equal(hubActivityFilterLongestLabel("vote"), "Votes only");
    for (const value of ["all", "hide-mine", "show-mine"] as const) {
      assert.ok(hubActivityFilterFabLabel("vote", value).length <= "Votes only".length);
    }
    assert.match(toggle, /hubActivityFilterLongestLabel/);
    assert.match(toggle, /invisible flex items-center gap-2/);
    assert.match(toggle, /999\+/);
    assert.match(vote, /count=\{eyeBadge\.count\}/);
    assert.match(vote, /count: eyeBadge\.count/);
  });

  it("lets the desktop eye receive the same cycle", () => {
    const desktop = host.indexOf("hidden md:flex");
    assert.ok(desktop > 0);
    assert.match(host.slice(Math.max(0, desktop - 120), desktop + 80), /pointer-events-auto/);
    assert.match(host, /onCycle=\{activityFilter\.onCycle\}/);
  });
});

describe("locked vote card height", () => {
  it("pins a desktop card to the height measured before the vote", () => {
    assert.equal(lockedVoteCardBox(false, true, 420), null);
    assert.equal(lockedVoteCardBox(true, false, 420), null);
    assert.equal(lockedVoteCardBox(true, true, null), null);
    assert.equal(lockedVoteCardBox(true, true, 0), null);
    assert.deepEqual(lockedVoteCardBox(true, true, 420.4), {
      height: "420px",
      minHeight: "420px",
      maxHeight: "420px",
      overflow: "hidden",
    });
  });

  it("locks the hub cards that gain a post-vote footer", () => {
    for (const path of [
      "../client/src/components/sentiment/DiscourseCard.tsx",
      "../client/src/components/opinion-polls/OpinionPollCard.tsx",
      "../client/src/components/matchups/VersusCard.tsx",
      "../client/src/components/OverallRatingCard.tsx",
    ]) {
      const source = read(path);
      assert.match(source, /useLockedVoteCardHeight\(/);
    }
    const agree = read("../client/src/components/sentiment/DiscourseCard.tsx");
    assert.match(agree, /md:hidden/);
    assert.equal(agree.includes("md:pb-[14px]"), false);
  });
});

describe("referral prompt close", () => {
  it("paints the dialog X above the pulse-card layers that were swallowing the click", () => {
    const dialog = read("../client/src/components/ui/dialog.tsx");
    const closeAt = dialog.indexOf("<DialogPrimitive.Close");
    const closeTag = dialog.slice(closeAt, dialog.indexOf(">", closeAt));
    assert.match(closeTag, /absolute/);
    assert.match(closeTag, /z-20/);
    const modal = read("../client/src/components/referral/ReferralPromptModal.tsx");
    assert.match(modal, /<Dialog /);
    assert.match(modal, /onOpenChange=\{onOpenChange\}/);
  });
});
