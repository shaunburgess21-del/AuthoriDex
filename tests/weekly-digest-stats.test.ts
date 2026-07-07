import assert from "node:assert/strict";
import test from "node:test";

import {
  formatHeroPnl,
  formatMoverLine,
  formatOpenPositionsLine,
  formatRankDeltaCopy,
  formatWinRatePercent,
  weeklyWrapSubject,
} from "../server/emails/templates/engagement/WeeklyWrapEmail";
import {
  groupSettledBuyResults,
  previousIsoYearWeek,
  rollUpSettledBuys,
  summariseJackpotRows,
} from "../server/jobs/weekly-digest-utils";

test("weeklyWrapSubject: base when no resolved bets", () => {
  assert.equal(weeklyWrapSubject({ wins: 0, losses: 0 }), "Your VoxDex week");
});

test("weeklyWrapSubject: plural variant when resolved", () => {
  assert.equal(
    weeklyWrapSubject({ wins: 12, losses: 8 }),
    "Your VoxDex week: 12 wins, 8 losses",
  );
});

test("weeklyWrapSubject: singular labels when count is 1", () => {
  assert.equal(
    weeklyWrapSubject({ wins: 1, losses: 1 }),
    "Your VoxDex week: 1 win, 1 loss",
  );
});

test("weeklyWrapSubject: handles wins-only", () => {
  assert.equal(
    weeklyWrapSubject({ wins: 3, losses: 0 }),
    "Your VoxDex week: 3 wins, 0 losses",
  );
});

test("formatHeroPnl: uses Vox word not symbol", () => {
  assert.equal(formatHeroPnl(500), "+500 Vox");
  assert.equal(formatHeroPnl(-250), "\u2212250 Vox");
  assert.equal(formatHeroPnl(0), "0 Vox");
});

test("formatWinRatePercent", () => {
  assert.equal(formatWinRatePercent(3, 7), "30%");
  assert.equal(formatWinRatePercent(0, 0), "0%");
});

test("formatRankDeltaCopy: moved up", () => {
  assert.equal(
    formatRankDeltaCopy({ previous: 142, current: 138 }),
    "You moved up 4 places — now ranked #138.",
  );
});

test("formatRankDeltaCopy: slipped", () => {
  assert.equal(
    formatRankDeltaCopy({ previous: 50, current: 53 }),
    "You slipped 3 places — now ranked #53.",
  );
});

test("formatRankDeltaCopy: held", () => {
  assert.equal(
    formatRankDeltaCopy({ previous: 10, current: 10 }),
    "You held your ground at #10.",
  );
});

test("formatMoverLine", () => {
  assert.equal(formatMoverLine("Drake", 9.1), "Drake +9.1%");
  assert.equal(formatMoverLine("Khaby Lame", -12.4), "Khaby Lame -12.4%");
});

test("previousIsoYearWeek: steps back one week", () => {
  assert.equal(previousIsoYearWeek("2026-W21"), "2026-W20");
});

test("previousIsoYearWeek: invalid input", () => {
  assert.equal(previousIsoYearWeek("not-a-week"), null);
});

test("rollUpSettledBuys: empty input", () => {
  const out = rollUpSettledBuys([]);
  assert.deepEqual(out, {
    wins: 0,
    losses: 0,
    netCredits: 0,
    bestPick: null,
    worstPick: null,
  });
});

test("rollUpSettledBuys: picks largest-profit win as best", () => {
  const out = rollUpSettledBuys([
    { status: "won", stakeAmount: 100, payoutAmount: 220, marketTitle: "Small win", pickLabel: "Small win" },
    { status: "won", stakeAmount: 100, payoutAmount: 500, marketTitle: "Big win", pickLabel: "Drake" },
    { status: "lost", stakeAmount: 50, payoutAmount: 0, marketTitle: "Loss", pickLabel: "Khaby Lame" },
  ]);
  assert.equal(out.wins, 2);
  assert.equal(out.losses, 1);
  assert.equal(out.netCredits, 120 + 400 - 50);
  assert.deepEqual(out.bestPick, { label: "Drake", profit: 400 });
  assert.deepEqual(out.worstPick, { label: "Khaby Lame", profit: -50 });
});

test("rollUpSettledBuys: picks largest-stake loss as worst", () => {
  const out = rollUpSettledBuys([
    { status: "lost", stakeAmount: 30, payoutAmount: 0, marketTitle: null, pickLabel: "Small bet" },
    { status: "lost", stakeAmount: 200, payoutAmount: 0, marketTitle: null, pickLabel: "Big bet" },
  ]);
  assert.deepEqual(out.worstPick, { label: "Big bet", profit: -200 });
});

test("rollUpSettledBuys: won-but-zero-payout doesn't count as win", () => {
  const out = rollUpSettledBuys([
    { status: "won", stakeAmount: 100, payoutAmount: 0, marketTitle: "Sold pre-resolution", pickLabel: null },
  ]);
  assert.equal(out.wins, 0);
  assert.equal(out.losses, 0);
  assert.equal(out.netCredits, 0);
  assert.equal(out.bestPick, null);
});

test("rollUpSettledBuys: jackpot pari-mutuel can land status=won with profit<=0 — suppressed", () => {
  const out = rollUpSettledBuys([
    { status: "won", stakeAmount: 100, payoutAmount: 50, marketTitle: "Tiny payout", pickLabel: null },
  ]);
  assert.equal(out.wins, 1);
  assert.equal(out.netCredits, -50);
  assert.equal(out.bestPick, null);
});

test("rollUpSettledBuys: falls back to marketTitle when pickLabel null", () => {
  const out = rollUpSettledBuys([
    { status: "won", stakeAmount: 100, payoutAmount: 300, marketTitle: "Market Title", pickLabel: null },
  ]);
  assert.equal(out.bestPick?.label, "Market Title");
});

test("summariseJackpotRows: no rows returns null", () => {
  assert.equal(summariseJackpotRows([]), null);
});

test("summariseJackpotRows: net win across mixed rows", () => {
  const out = summariseJackpotRows([
    { status: "won", stakeAmount: 100, payoutAmount: 800 },
    { status: "lost", stakeAmount: 100, payoutAmount: 0 },
  ]);
  assert.deepEqual(out, { won: true, profit: 600 });
});

test("summariseJackpotRows: net loss flags won=false even with one win", () => {
  const out = summariseJackpotRows([
    { status: "won", stakeAmount: 100, payoutAmount: 150 },
    { status: "lost", stakeAmount: 100, payoutAmount: 0 },
    { status: "lost", stakeAmount: 100, payoutAmount: 0 },
  ]);
  assert.deepEqual(out, { won: false, profit: -150 });
});

test("summariseJackpotRows: all losses", () => {
  const out = summariseJackpotRows([
    { status: "lost", stakeAmount: 100, payoutAmount: 0 },
    { status: "lost", stakeAmount: 100, payoutAmount: 0 },
  ]);
  assert.deepEqual(out, { won: false, profit: -200 });
});

test("groupSettledBuyResults: empty input", () => {
  assert.deepEqual(groupSettledBuyResults([]), []);
});

test("groupSettledBuyResults: groups same-position buys into one row", () => {
  const settledAt = new Date("2026-07-05T12:00:00Z");
  const out = groupSettledBuyResults([
    {
      status: "won",
      stakeAmount: 100,
      payoutAmount: 200,
      marketTitle: "Cardi B: up or down?",
      marketId: "m1",
      marketSlug: "cardi-b-updown",
      entryId: "e1",
      entryLabel: "Down",
      settledAt,
    },
    {
      status: "won",
      stakeAmount: 50,
      payoutAmount: 90,
      marketTitle: "Cardi B: up or down?",
      marketId: "m1",
      marketSlug: "cardi-b-updown",
      entryId: "e1",
      entryLabel: "Down",
      settledAt,
    },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].marketTitle, "Cardi B: up or down?");
  assert.equal(out[0].pickLabel, "Down");
  assert.equal(out[0].outcome, "won");
  assert.equal(out[0].stake, 150);
  assert.equal(out[0].payout, 290);
  assert.equal(out[0].net, 140);
  assert.equal(out[0].marketSlug, "cardi-b-updown");
});

test("groupSettledBuyResults: separates opposing picks on the same market", () => {
  // User bought "Up" and "Down" on the same market — two distinct
  // positions, should not be merged.
  const out = groupSettledBuyResults([
    {
      status: "won",
      stakeAmount: 100,
      payoutAmount: 200,
      marketTitle: "Cardi B: up or down?",
      marketId: "m1",
      marketSlug: "cardi-b-updown",
      entryId: "e1",
      entryLabel: "Up",
      settledAt: new Date("2026-07-05T12:00:00Z"),
    },
    {
      status: "lost",
      stakeAmount: 80,
      payoutAmount: 0,
      marketTitle: "Cardi B: up or down?",
      marketId: "m1",
      marketSlug: "cardi-b-updown",
      entryId: "e2",
      entryLabel: "Down",
      settledAt: new Date("2026-07-05T12:00:00Z"),
    },
  ]);
  assert.equal(out.length, 2);
  // Biggest |net| first: +100 win, then -80 loss.
  assert.equal(out[0].outcome, "won");
  assert.equal(out[0].net, 100);
  assert.equal(out[1].outcome, "lost");
  assert.equal(out[1].net, -80);
});

test("groupSettledBuyResults: sorts by |net| desc so biggest movers come first", () => {
  const out = groupSettledBuyResults([
    { status: "won", stakeAmount: 50, payoutAmount: 90, marketTitle: "Small win", marketId: "m1", marketSlug: "s1", entryId: "e1", entryLabel: "Up", settledAt: new Date() },
    { status: "lost", stakeAmount: 300, payoutAmount: 0, marketTitle: "Big loss", marketId: "m2", marketSlug: "s2", entryId: "e2", entryLabel: "Above", settledAt: new Date() },
    { status: "won", stakeAmount: 100, payoutAmount: 480, marketTitle: "Biggest win", marketId: "m3", marketSlug: "s3", entryId: "e3", entryLabel: "Drake", settledAt: new Date() },
  ]);
  assert.equal(out[0].marketTitle, "Biggest win");
  assert.equal(out[1].marketTitle, "Big loss");
  assert.equal(out[2].marketTitle, "Small win");
});

test("groupSettledBuyResults: falls back to pickLabel when entryLabel missing", () => {
  const out = groupSettledBuyResults([
    { status: "won", stakeAmount: 100, payoutAmount: 200, marketTitle: "Title", pickLabel: "Fallback", marketId: "m1", marketSlug: "s1", entryId: "e1", settledAt: new Date() },
  ]);
  assert.equal(out[0].pickLabel, "Fallback");
});

test("groupSettledBuyResults: skips rows missing marketId/entryId", () => {
  const out = groupSettledBuyResults([
    { status: "won", stakeAmount: 100, payoutAmount: 200, marketTitle: "No keys", marketId: "", entryId: "", entryLabel: "Up", settledAt: new Date() },
  ]);
  assert.equal(out.length, 0);
});

test("groupSettledBuyResults: skips won+zero-payout rows (sold pre-resolution)", () => {
  // Mirrors rollUpSettledBuys: a "won" row with zero payout is a buy
  // the user sold before resolution — proceeds already credited via
  // the sell row. Including it here would show a "WON" badge on a
  // negative-net row and double-count the stake.
  const out = groupSettledBuyResults([
    { status: "won", stakeAmount: 100, payoutAmount: 0, marketTitle: "Sold early", marketId: "m1", marketSlug: "s1", entryId: "e1", entryLabel: "Up", settledAt: new Date() },
    { status: "lost", stakeAmount: 80, payoutAmount: 0, marketTitle: "Real loss", marketId: "m2", marketSlug: "s2", entryId: "e2", entryLabel: "Down", settledAt: new Date() },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].marketTitle, "Real loss");
});

test("groupSettledBuyResults: empty-string entryLabel falls back to pickLabel", () => {
  const out = groupSettledBuyResults([
    { status: "won", stakeAmount: 100, payoutAmount: 200, marketTitle: "Title", entryLabel: "", pickLabel: "Fallback", marketId: "m1", marketSlug: "s1", entryId: "e1", settledAt: new Date() },
  ]);
  assert.equal(out[0].pickLabel, "Fallback");
});

test("formatOpenPositionsLine: plural with settling-soon count", () => {
  const line = formatOpenPositionsLine({ count: 3, totalStake: 240, settlingNext7d: 2 });
  assert.equal(
    line,
    "You have 3 open positions (240 Vox at stake) — 2 settle this week.",
  );
});

test("formatOpenPositionsLine: singular position", () => {
  const line = formatOpenPositionsLine({ count: 1, totalStake: 80, settlingNext7d: 1 });
  assert.equal(
    line,
    "You have 1 open position (80 Vox at stake) — 1 settles this week.",
  );
});

test("formatOpenPositionsLine: no settling-soon drops the clause", () => {
  const line = formatOpenPositionsLine({ count: 5, totalStake: 1000, settlingNext7d: 0 });
  assert.equal(line, "You have 5 open positions — 1,000 Vox at stake.");
});
