import test from "node:test";
import assert from "node:assert/strict";

import {
  formatWeeklyDigestBody,
  isoYearWeek,
  isWeeklyDigestFireWindow,
  WEEKLY_DIGEST_TITLE,
} from "../server/jobs/weekly-digest-utils";

// Pure helpers — no DB. Pins the ISO-week algorithm (which has gnarly
// year-boundary cases), the Sunday-evening fire window, and the
// digest body wording so the deriver and the user-facing copy stay
// in sync.

test("isoYearWeek: mid-year Wednesday returns YYYY-W## with zero-padded week", () => {
  // 2026-05-13 is a Wednesday in ISO week 20.
  const d = new Date(Date.UTC(2026, 4, 13));
  assert.equal(isoYearWeek(d), "2026-W20");
});

test("isoYearWeek: zero-pads single-digit weeks", () => {
  // 2026-01-08 is a Thursday in ISO week 2.
  const d = new Date(Date.UTC(2026, 0, 8));
  assert.equal(isoYearWeek(d), "2026-W02");
});

test("isoYearWeek: Jan 1 belonging to previous ISO year (2027-01-01 → 2026-W53)", () => {
  // 2027-01-01 is a Friday; ISO-8601 says it belongs to 2026-W53.
  const d = new Date(Date.UTC(2027, 0, 1));
  assert.equal(isoYearWeek(d), "2026-W53");
});

test("isoYearWeek: late December belonging to NEXT ISO year (2024-12-30 → 2025-W01)", () => {
  // 2024-12-30 is a Monday; ISO-8601 says it belongs to 2025-W01.
  const d = new Date(Date.UTC(2024, 11, 30));
  assert.equal(isoYearWeek(d), "2025-W01");
});

test("isoYearWeek: same week yields same key across all 7 days", () => {
  // ISO week starts Monday. 2026-W20 spans Mon 2026-05-11 to Sun 2026-05-17.
  const monday = new Date(Date.UTC(2026, 4, 11));
  const sunday = new Date(Date.UTC(2026, 4, 17));
  assert.equal(isoYearWeek(monday), "2026-W20");
  assert.equal(isoYearWeek(sunday), "2026-W20");
});

test("isWeeklyDigestFireWindow: Sunday 18:00 UTC fires", () => {
  // Sunday is JS getUTCDay() === 0. 2026-05-17 is a Sunday.
  const d = new Date(Date.UTC(2026, 4, 17, 18, 0));
  assert.equal(isWeeklyDigestFireWindow(d), true);
});

test("isWeeklyDigestFireWindow: Sunday 18:29 UTC still fires (inside 30-min window)", () => {
  const d = new Date(Date.UTC(2026, 4, 17, 18, 29));
  assert.equal(isWeeklyDigestFireWindow(d), true);
});

test("isWeeklyDigestFireWindow: Sunday 18:30 UTC does NOT fire (half-open interval)", () => {
  const d = new Date(Date.UTC(2026, 4, 17, 18, 30));
  assert.equal(isWeeklyDigestFireWindow(d), false);
});

test("isWeeklyDigestFireWindow: Sunday 17:59 UTC does NOT fire (before window)", () => {
  const d = new Date(Date.UTC(2026, 4, 17, 17, 59));
  assert.equal(isWeeklyDigestFireWindow(d), false);
});

test("isWeeklyDigestFireWindow: Monday 18:00 UTC does NOT fire (wrong day)", () => {
  const d = new Date(Date.UTC(2026, 4, 18, 18, 0));
  assert.equal(isWeeklyDigestFireWindow(d), false);
});

test("formatWeeklyDigestBody: positive net with best pick", () => {
  const body = formatWeeklyDigestBody({
    wins: 8,
    losses: 3,
    netCredits: 1247,
    bestPick: { label: "Jake Paul vs KSI", profit: 470 },
  });
  assert.equal(
    body,
    "This week: +Ꝟ1,247 (8 wins, 3 losses). Best: Jake Paul vs KSI (+Ꝟ470).",
  );
});

test("formatWeeklyDigestBody: negative net without best pick uses Unicode minus", () => {
  const body = formatWeeklyDigestBody({
    wins: 2,
    losses: 4,
    netCredits: -250,
  });
  assert.equal(body, "This week: \u2212Ꝟ250 (2 wins, 4 losses).");
});

test("formatWeeklyDigestBody: zero net uses no sign prefix", () => {
  const body = formatWeeklyDigestBody({
    wins: 1,
    losses: 1,
    netCredits: 0,
  });
  assert.equal(body, "This week: Ꝟ0 (1 win, 1 loss).");
});

test("formatWeeklyDigestBody: singular win/loss labels when count === 1", () => {
  const body = formatWeeklyDigestBody({
    wins: 1,
    losses: 1,
    netCredits: 50,
    bestPick: { label: "Conor McGregor", profit: 100 },
  });
  assert.equal(
    body,
    "This week: +Ꝟ50 (1 win, 1 loss). Best: Conor McGregor (+Ꝟ100).",
  );
});

test("formatWeeklyDigestBody: best pick with profit=0 is suppressed", () => {
  // Defensive: a "best" pick that broke even shouldn't be a call-out.
  const body = formatWeeklyDigestBody({
    wins: 1,
    losses: 0,
    netCredits: 0,
    bestPick: { label: "Edge case", profit: 0 },
  });
  assert.equal(body, "This week: Ꝟ0 (1 win, 0 losses).");
});

test("formatWeeklyDigestBody: best pick with negative profit is suppressed (jackpot edge case)", () => {
  // Defensive double-gate: the deriver itself filters bestPick to
  // profit > 0 now (after the post-ship review), but the formatter
  // must also refuse to render a "Best: <market> (−ꝞN)" body if a
  // future call-site passes one in. Prevents a regression from
  // sneaking back through the formatter layer.
  const body = formatWeeklyDigestBody({
    wins: 1,
    losses: 0,
    netCredits: -50,
    bestPick: { label: "Jackpot underpay", profit: -50 },
  });
  assert.equal(body, "This week: \u2212Ꝟ50 (1 win, 0 losses).");
});

test("title is the documented constant", () => {
  assert.equal(WEEKLY_DIGEST_TITLE, "Your week in predictions");
});
