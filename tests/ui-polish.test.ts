import test from "node:test";
import assert from "node:assert/strict";

import { measureScrollEdge, scrollEdgeMaskClass } from "../client/src/lib/scrollEdgeFade";
import { formatTimeAgo, formatUtcCalendarDate } from "../client/src/lib/formatDate";
import { accountWinRateDisplay } from "../client/src/lib/winRateDisplay";
import { shouldOfferHowItWorksTour } from "../client/src/lib/howItWorksTour";
import { inlineCommentCount } from "../client/src/lib/commentCountLabel";
import { shouldHideFooter } from "../client/src/lib/siteFooter";

const NOW = new Date("2026-11-22T12:00:00.000Z");

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

test("comment dates stay relative, and older dates keep the year outside the current UTC year", () => {
  assert.equal(formatTimeAgo("2026-11-22T10:00:00.000Z", NOW), "2h ago");
  assert.equal(formatTimeAgo("2026-11-19T12:00:00.000Z", NOW), "3d ago");
  assert.equal(formatTimeAgo("2026-05-01T00:00:00.000Z", NOW), "May 1");
  assert.equal(formatTimeAgo("2025-08-31T00:00:00.000Z", NOW), "Aug 31, 2025");
  assert.equal(
    formatUtcCalendarDate(new Date("2025-08-31T23:30:00.000Z"), NOW),
    "Aug 31, 2025",
  );
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
