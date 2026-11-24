import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DAILY_VOTE_GOAL } from "../client/src/lib/dailyVoteGoal";
import { xpRankProgressLabel } from "../client/src/lib/returningUserStrip";
import {
  GOAL_COUNTS_SENTENCE,
  STRIP_XP_QUERY_KEY,
  XP_EARN_SENTENCE,
  formatStreakResetLocal,
  goalExplainerCopy,
  reduceStripExplainer,
  streakExplainerCopy,
  xpExplainerCopy,
  type StripExplainerId,
} from "../client/src/lib/stripExplainers";

const strip = readFileSync(
  new URL("../client/src/components/vote/ReturningUserStrip.tsx", import.meta.url),
  "utf8",
);
const explainers = readFileSync(
  new URL("../client/src/lib/stripExplainers.ts", import.meta.url),
  "utf8",
);

const NOW = new Date("2026-11-23T21:00:00.000Z");
const JOHANNESBURG = "Africa/Johannesburg";
const LOS_ANGELES = "America/Los_Angeles";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("streak explainer", () => {
  it("converts UTC midnight into the viewer's local time", () => {
    const johannesburg = formatStreakResetLocal(NOW, JOHANNESBURG, "en-US");
    const losAngeles = formatStreakResetLocal(NOW, LOS_ANGELES, "en-US");
    assert.equal(johannesburg, "2:00 AM GMT+2");
    assert.equal(losAngeles, "4:00 PM PST");
    assert.equal(formatStreakResetLocal(NOW, "Not/AZone", "en-US"), "12:00 AM UTC");
    assert.equal(formatStreakResetLocal(NOW, "", "en-US"), "12:00 AM UTC");
  });

  it("says a login keeps the streak alive and names the local reset", () => {
    const resetAt = formatStreakResetLocal(NOW, LOS_ANGELES, "en-US");
    const active = streakExplainerCopy(14, NOW, LOS_ANGELES, "en-US");
    assert.equal(active.title, "Streak");
    assert.equal(active.value, "14 days in a row");
    assert.match(active.body, /Log in each day to keep it going/);
    assert.match(active.body, /starts over at 1/);
    assert.match(active.body, new RegExp(escapeRegExp(resetAt)));
    assert.doesNotMatch(active.body, /vote/i);
    assert.doesNotMatch(active.body, /02:00 your time/);

    const one = streakExplainerCopy(1.9, NOW, LOS_ANGELES, "en-US");
    assert.equal(one.value, "1 day in a row");

    const fresh = streakExplainerCopy(0, NOW, JOHANNESBURG, "en-US");
    assert.equal(fresh.value, "No streak yet");
    assert.match(fresh.body, /Log in to start a streak/);
    assert.match(fresh.body, /2:00 AM GMT\+2/);
    assert.doesNotMatch(fresh.body, /vote/i);
  });
});

describe("xp explainer", () => {
  it("uses the real next rank and the awards the app actually pays", () => {
    const towardExpert = xpExplainerCopy(21_562);
    assert.equal(towardExpert.title, "XP");
    assert.equal(towardExpert.value, "13,438 XP to Expert");
    assert.equal(towardExpert.value, xpRankProgressLabel({ xpToNext: 13438, nextRankName: "Expert", progressPct: 0 }));
    assert.equal(towardExpert.body, XP_EARN_SENTENCE);
    assert.match(towardExpert.body, /voting/);
    assert.match(towardExpert.body, /predicting/);
    assert.match(towardExpert.body, /commenting/);
    assert.match(towardExpert.body, /logging in/);
    assert.doesNotMatch(towardExpert.body, /badge/i);

    const top = xpExplainerCopy(400_000);
    assert.equal(top.value, "Max rank reached");
    assert.equal(top.body, XP_EARN_SENTENCE);
    assert.doesNotMatch(top.body, /badge/i);
  });
});

describe("votes-today explainer", () => {
  it("uses the real goal and counts profile-photo votes", () => {
    assert.equal(DAILY_VOTE_GOAL, 5);
    const progress = goalExplainerCopy(1);
    assert.equal(progress.title, "Votes today");
    assert.equal(progress.value, "1 of 5 votes today");
    assert.match(progress.body, /Hit 5 votes today to complete your goal/);
    assert.match(progress.body, /profile-photo picks/);
    assert.equal(progress.body.endsWith(GOAL_COUNTS_SENTENCE), true);
    assert.doesNotMatch(progress.body, /streak/i);

    const done = goalExplainerCopy(5);
    assert.equal(done.value, "Goal done");
    assert.match(done.body, /today's goal of 5 votes/);
    assert.match(done.body, /profile-photo picks/);

    const over = goalExplainerCopy(8);
    assert.equal(over.value, "Goal done");

    const missing = goalExplainerCopy(null);
    assert.equal(missing.value, "Daily goal unavailable");
    assert.match(missing.body, /couldn't be loaded/);
    assert.equal(goalExplainerCopy(Number.NaN).value, "Daily goal unavailable");
  });
});

describe("explainer toggle", () => {
  const ids: StripExplainerId[] = ["streak", "xp", "goal"];

  it("opens one at a time and closes on a repeat, a dismiss, or Escape", () => {
    assert.equal(reduceStripExplainer(null, { type: "open", id: "streak" }), "streak");
    assert.equal(reduceStripExplainer("streak", { type: "close", id: "streak" }), null);
    assert.equal(reduceStripExplainer("streak", { type: "open", id: "xp" }), "xp");
    assert.equal(reduceStripExplainer("xp", { type: "close", id: "streak" }), "xp");
    assert.equal(reduceStripExplainer("xp", { type: "open", id: "goal" }), "goal");
    assert.equal(reduceStripExplainer("goal", { type: "dismiss" }), null);
    for (const id of ids) {
      assert.equal(reduceStripExplainer(id, { type: "dismiss" }), null);
      assert.equal(reduceStripExplainer(id, { type: "close", id }), null);
    }
  });
});

describe("strip explainer wiring", () => {
  it("renders each segment as a button with the shared toggle and Escape", () => {
    assert.match(strip, /type="button"/);
    assert.match(strip, /aria-expanded=\{open\}/);
    assert.match(strip, /aria-controls=\{contentId\}/);
    assert.match(strip, /event\.key === "Escape"/);
    assert.match(strip, /onEscapeKeyDown=\{onDismiss\}/);
    assert.match(strip, /reduceStripExplainer/);
    assert.match(strip, /h-8 shrink-0/);
    assert.match(strip, /gap-2\.5/);
    assert.match(strip, /overflow-x-auto/);
    assert.match(strip, /z-\[45\]/);
    assert.match(strip, /bottom: 200/);
    assert.equal(strip.includes("02:00 your time"), false);
    assert.equal(explainers.includes("02:00 your time"), false);
    assert.equal(strip.includes("unlock new badges"), false);
  });

  it("refetches the XP stats query after a successful goal vote", () => {
    const start = strip.indexOf("subscribeDailyVoteGoal");
    const end = strip.indexOf("lastSeenRef", start);
    const block = strip.slice(start, end);
    assert.match(block, /invalidateQueries\(\{ queryKey: STRIP_XP_QUERY_KEY \}\)/);
    assert.deepEqual([...STRIP_XP_QUERY_KEY], ["/api/gamification/stats"]);
    assert.match(strip, /useUserStats\(shown && Boolean\(user\)\)/);
    assert.match(strip, /stats\.data\?\.xpPoints \?\? profile\?\.xpPoints/);
    assert.equal(strip.includes("/api/gamification/ranks"), false);
  });
});
