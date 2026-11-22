import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { measureScrollEdge, scrollEdgeMaskClass } from "../client/src/lib/scrollEdgeFade";
import {
  formatCommentAge,
  formatTimeAgo,
  formatUtcCalendarDate,
  formatUtcTimestampTitle,
} from "../client/src/lib/formatDate";
import { accountWinRateDisplay } from "../client/src/lib/winRateDisplay";
import { shouldOfferHowItWorksTour } from "../client/src/lib/howItWorksTour";
import { inlineCommentCount } from "../client/src/lib/commentCountLabel";
import { shouldHideFooter } from "../client/src/lib/siteFooter";

const NOW = new Date("2026-11-22T12:00:00.000Z");

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("scroll edge fade follows which side still has content", () => {
  assert.equal(
    measureScrollEdge({ scrollLeft: 0, scrollWidth: 400, clientWidth: 200 }),
    "start",
  );
  assert.equal(scrollEdgeMaskClass("start"), "scroll-mask-right");

  assert.equal(
    measureScrollEdge({ scrollLeft: 100, scrollWidth: 400, clientWidth: 200 }),
    "both",
  );
  assert.equal(scrollEdgeMaskClass("both"), "scroll-mask-both");

  assert.equal(
    measureScrollEdge({ scrollLeft: 200, scrollWidth: 400, clientWidth: 200 }),
    "end",
  );
  assert.equal(scrollEdgeMaskClass("end"), "scroll-mask-left");

  assert.equal(
    measureScrollEdge({ scrollLeft: 0, scrollWidth: 200, clientWidth: 200 }),
    "none",
  );
  assert.equal(scrollEdgeMaskClass("none"), "");

  assert.equal(
    measureScrollEdge({ scrollLeft: 1, scrollWidth: 320, clientWidth: 200 }),
    "start",
  );
});

test("comment ages stay relative at every age, with the UTC instant for the tooltip", () => {
  assert.equal(formatCommentAge("2026-11-22T11:59:30.000Z", NOW), "just now");
  assert.equal(formatCommentAge("2026-11-22T11:55:00.000Z", NOW), "5m ago");
  assert.equal(formatCommentAge("2026-11-22T10:00:00.000Z", NOW), "2h ago");
  assert.equal(formatCommentAge("2026-11-19T12:00:00.000Z", NOW), "3d ago");
  assert.equal(formatCommentAge("2026-11-08T12:00:00.000Z", NOW), "2w ago");
  assert.equal(formatCommentAge("2026-09-27T12:00:00.000Z", NOW), "1 mo ago");
  assert.equal(formatCommentAge("2026-05-09T12:00:00.000Z", NOW), "6 mo ago");
  assert.equal(formatCommentAge("2026-05-22T12:00:00.000Z", NOW), "6 mo ago");
  assert.equal(formatCommentAge("2025-11-22T12:00:00.000Z", NOW), "1 yr ago");
  for (const sample of ["2026-05-09T12:00:00.000Z", "2026-09-27T12:00:00.000Z"]) {
    assert.equal(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(formatCommentAge(sample, NOW)), false);
  }
  assert.match(formatUtcTimestampTitle("2026-05-09T15:04:00.000Z"), /May 9, 2026/);
  assert.match(formatUtcTimestampTitle("2026-05-09T15:04:00.000Z"), /UTC$/);
  assert.equal(formatTimeAgo("2026-05-01T00:00:00.000Z", NOW), "May 1");
  assert.equal(formatUtcCalendarDate(new Date("2025-08-31T23:30:00.000Z"), NOW), "Aug 31, 2025");
});

test("win rate stays pending until a prediction resolves", () => {
  assert.deepEqual(accountWinRateDisplay({ resolved: null, winRate: 0 }), {
    text: "–",
    pending: true,
  });
  assert.deepEqual(accountWinRateDisplay({ resolved: 0, winRate: 0 }), {
    text: "–",
    pending: true,
  });
  assert.deepEqual(accountWinRateDisplay({ resolved: 2, winRate: 0 }), {
    text: "0%",
    pending: false,
  });
  assert.deepEqual(accountWinRateDisplay({ resolved: 3, winRate: 33.333 }), {
    text: "33.3%",
    pending: false,
  });
});

test("how it works tour hides after a vote or a dismissal", () => {
  const base = {
    now: NOW.getTime(),
    seenRaw: null as string | null,
    reShowAfterDays: Number.POSITIVE_INFINITY,
    totalVotes: 0,
    hasEverVoted: false,
  };
  assert.equal(shouldOfferHowItWorksTour(base), true);
  assert.equal(shouldOfferHowItWorksTour({ ...base, totalVotes: 20 }), false);
  assert.equal(shouldOfferHowItWorksTour({ ...base, hasEverVoted: true }), false);
  assert.equal(
    shouldOfferHowItWorksTour({ ...base, seenRaw: String(NOW.getTime() - 1000) }),
    false,
  );
  assert.equal(shouldOfferHowItWorksTour({ ...base, seenRaw: "true" }), false);
});

test("discussion counts pluralise", () => {
  assert.equal(inlineCommentCount(0, "Discussion"), "0 discussions");
  assert.equal(inlineCommentCount(1, "Discussion"), "1 discussion");
  assert.equal(inlineCommentCount(3, "Discussion"), "3 discussions");
});

test("rankings quick view keeps both signal cards and the trend summary at a fixed height", () => {
  const modal = source("client/src/components/PersonInsightModal.tsx");
  assert.match(modal, /No growth signals/);
  assert.match(modal, /No cooling signals/);
  assert.match(modal, /No trend summary yet/);
  assert.equal(modal.includes("growthSignals.length > 0"), false);
  assert.equal(modal.includes("coolingSignals.length > 0"), false);
  assert.equal(modal.includes("return null"), false);
  assert.match(modal, /flex h-14 min-w-0 flex-wrap content-start gap-2 overflow-x-hidden overflow-y-auto scrollbar-hide/);
  assert.match(modal, /h-\[3\.09375rem\]/);
});

test("win rate surfaces share the pending helper", () => {
  for (const path of [
    "client/src/components/UserMenu.tsx",
    "client/src/pages/MePage.tsx",
    "client/src/pages/PublicProfilePage.tsx",
    "client/src/pages/UserLeaderboardPage.tsx",
    "client/src/pages/me/PredictionsPage.tsx",
    "client/src/components/insights/PredictTab.tsx",
    "client/src/components/share/ShareCard.tsx",
  ]) {
    const text = source(path);
    assert.match(text, /useAccountWinRate|accountWinRateDisplay/, path);
  }
  const menu = source("client/src/components/UserMenu.tsx");
  assert.match(menu, /Win Rate\{winRate\.pending \? " · Pending" : ""\}/);
  assert.match(menu, /data-testid="text-menu-win-rate"/);
  assert.equal(menu.includes("Math.round(profile.winRate)"), false);
  assert.equal(menu.includes("Math.round(profile?.winRate)"), false);
});

test("profile, world markets, and unknown routes keep the shared footer", () => {
  assert.equal(shouldHideFooter("/person/robert-pattinson"), false);
  assert.equal(shouldHideFooter("/u/jaymokoena"), false);
  assert.equal(shouldHideFooter("/profile"), false);
  assert.equal(shouldHideFooter("/me"), false);
  assert.equal(shouldHideFooter("/markets/when-will-a-tesla-spacex-merger-be-officially-announced"), false);
  assert.equal(shouldHideFooter("/xyz"), false);
  assert.equal(shouldHideFooter("/predict/updown/abc"), true);
  assert.equal(shouldHideFooter("/login"), true);
});
