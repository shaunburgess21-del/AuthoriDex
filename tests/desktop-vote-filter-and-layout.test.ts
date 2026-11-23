import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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

  it("lets the desktop eye receive the same cycle", () => {
    const desktop = host.indexOf("hidden md:flex");
    assert.ok(desktop > 0);
    assert.match(host.slice(Math.max(0, desktop - 120), desktop + 80), /pointer-events-auto/);
    assert.match(host, /onCycle=\{activityFilter\.onCycle\}/);
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
