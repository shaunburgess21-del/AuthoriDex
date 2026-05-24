import assert from "node:assert/strict";
import test from "node:test";

import {
  formatHeroPnl,
  formatMoverLine,
  formatRankDeltaCopy,
  formatWinRatePercent,
  weeklyWrapSubject,
} from "../server/emails/templates/engagement/WeeklyWrapEmail";
import {
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
