import test from "node:test";
import assert from "node:assert/strict";

import {
  assignActiveTicketScores,
  rescaleDerived,
  rescaleJackpotNotificationBody,
  rescaleResolutionNotes,
  rescaleScore,
  type ActiveTicket,
} from "../ops/score-rescale-lib";
import {
  FAME_INDEX_MAX,
  FAME_INDEX_SCALE,
  MIN_PLAUSIBLE_AVG_FAME_INDEX,
  isLegacyFameScale,
} from "../server/scoring/scale";
import { JACKPOT_MAX_PREDICTED_SCORE as SHARED_JACKPOT_MAX } from "../shared/fame-scale";
import { JACKPOT_MAX_PREDICTED_SCORE } from "../server/config/constants";

// ── scale constants ────────────────────────────────────────────────────────

test("scale: ceiling and sanity floor follow the multiplier", () => {
  assert.equal(FAME_INDEX_SCALE, 1_000);
  assert.equal(FAME_INDEX_MAX, 100_000);
  assert.equal(MIN_PLAUSIBLE_AVG_FAME_INDEX, 5_000);
  assert.equal(JACKPOT_MAX_PREDICTED_SCORE, 200_000);
  assert.equal(JACKPOT_MAX_PREDICTED_SCORE, SHARED_JACKPOT_MAX);
  assert.equal(JACKPOT_MAX_PREDICTED_SCORE, 2 * FAME_INDEX_MAX);
});

test("isLegacyFameScale: only a stored max above the ceiling is legacy", () => {
  assert.equal(isLegacyFameScale(791_349), true);
  assert.equal(isLegacyFameScale(100_001), true);
  assert.equal(isLegacyFameScale(100_000), false);
  assert.equal(isLegacyFameScale(79_135), false);
  assert.equal(isLegacyFameScale(0), false);
  // An empty leaderboard is not evidence of the legacy scale.
  assert.equal(isLegacyFameScale(null), false);
  assert.equal(isLegacyFameScale(undefined), false);
  assert.equal(isLegacyFameScale(Number.NaN), false);
});

// ── rescaleScore ───────────────────────────────────────────────────────────

test("rescaleScore: divides by ten and rounds", () => {
  assert.equal(rescaleScore(791_349), 79_135);
  assert.equal(rescaleScore(791_344), 79_134);
  assert.equal(rescaleScore(100), 10);
  assert.equal(rescaleScore(0), 0);
});

test("rescaleScore: ties round away from zero, matching Postgres round(numeric)", () => {
  assert.equal(rescaleScore(791_345), 79_135);
  assert.equal(rescaleScore(5), 1);
  assert.equal(rescaleScore(4), 0);
  assert.equal(rescaleScore(-791_345), -79_135);
  assert.equal(rescaleScore(-5), -1);
  assert.equal(Object.is(rescaleScore(-4), 0), true, "never returns negative zero");
});

test("rescaleScore: non-integers still round to a whole number", () => {
  assert.equal(rescaleScore(791_349.4), 79_135);
  assert.equal(rescaleScore(12.4), 1);
});

test("rescaleDerived: recomputes from rescaled sources when the stored value is consistent", () => {
  // 512,679 vs 500,000 → off by 12,679. Rescaled: 51,268 vs 50,000 → 1,268.
  assert.equal(rescaleDerived(12_679, 500_000, 512_679, "absDiff"), 1_268);
  // Independent rounding would give 0 here, leaving 12,345 / 12,344 "off by 0".
  assert.equal(rescaleDerived(4, 123_445, 123_441, "absDiff"), 1);
  assert.equal(rescaleDerived(-30_004, 470_001, 500_005, "aMinusB"), 47_000 - 50_001);
});

test("rescaleDerived: falls back to a plain rescale when inconsistent or sources are missing", () => {
  assert.equal(rescaleDerived(999, 500_000, 512_679, "absDiff"), 100);
  assert.equal(rescaleDerived(12_679, undefined, 512_679, "absDiff"), 1_268);
  assert.equal(rescaleDerived(12_679, "500000", 512_679, "absDiff"), 1_268);
});

// ── resolution notes ───────────────────────────────────────────────────────

test("resolution notes: up/down rescales scores, recomputes change, leaves credits and percents", () => {
  const before = JSON.stringify({
    type: "updown",
    engine: "amm",
    outcome: "up",
    personId: "p1",
    openScore: 617_075,
    closeScore: 640_189,
    singleCloseScore: 641_002,
    change: 23_114,
    percentChange: "3.75",
    closeSampleCount: 6,
    creditedToHouse: 123_456,
    payoutLiability: 69_049,
    warmStartCost: 2_792,
    settledUserCount: 31,
  });
  const out = rescaleResolutionNotes("updown", before);
  const after = JSON.parse(out.text);

  assert.equal(after.openScore, 61_708);
  assert.equal(after.closeScore, 64_019);
  assert.equal(after.singleCloseScore, 64_100);
  assert.equal(after.change, 64_019 - 61_708);
  assert.equal(out.changedFields, 4);
  assert.equal(out.reformatted, false);

  // Untouched: credits, counts, percent strings.
  assert.equal(after.creditedToHouse, 123_456);
  assert.equal(after.payoutLiability, 69_049);
  assert.equal(after.warmStartCost, 2_792);
  assert.equal(after.settledUserCount, 31);
  assert.equal(after.closeSampleCount, 6);
  assert.equal(after.percentChange, "3.75");
  assert.deepEqual(Object.keys(after), Object.keys(JSON.parse(before)), "key order preserved");
});

test("resolution notes: the winning side of an up/down market never flips", () => {
  for (const [open, close] of [
    [500_004, 500_005],
    [500_005, 500_004],
    [499_995, 500_004],
  ]) {
    const out = rescaleResolutionNotes("updown", JSON.stringify({ openScore: open, closeScore: close, change: close - open }));
    const after = JSON.parse(out.text);
    // Rounding may collapse a sub-10-point move to 0, but must never reverse its sign.
    assert.ok(Math.sign(after.change) === Math.sign(close - open) || after.change === 0);
  }
});

test("resolution notes: h2h rescales both entries only", () => {
  const out = rescaleResolutionNotes(
    "h2h",
    JSON.stringify({
      type: "h2h",
      entryA: { label: "A", personId: "a", score: 790_918, singleScore: 789_813, sampleCount: 6 },
      entryB: { label: "B", personId: "b", score: 166_309, sampleCount: 6 },
      creditedToHouse: 400_000,
    }),
  );
  const after = JSON.parse(out.text);
  assert.deepEqual(after.entryA, { label: "A", personId: "a", score: 79_092, singleScore: 78_981, sampleCount: 6 });
  assert.deepEqual(after.entryB, { label: "B", personId: "b", score: 16_631, sampleCount: 6 });
  assert.equal(after.creditedToHouse, 400_000);
  assert.equal(out.changedFields, 3);
});

test("resolution notes: gainer rescales every ranking row", () => {
  const out = rescaleResolutionNotes(
    "gainer",
    JSON.stringify({
      type: "gainer",
      rankings: [
        { label: "A", openScore: 126_201, closeScore: 150_023, singleCloseScore: 149_996, pctChange: "18.88", sampleCount: 6 },
        { label: "B", openScore: 789_090, closeScore: 790_918, pctChange: "0.23" },
      ],
      payoutLiability: 250_000,
    }),
  );
  const after = JSON.parse(out.text);
  assert.deepEqual(after.rankings[0], {
    label: "A", openScore: 12_620, closeScore: 15_002, singleCloseScore: 15_000, pctChange: "18.88", sampleCount: 6,
  });
  assert.deepEqual(after.rankings[1], { label: "B", openScore: 78_909, closeScore: 79_092, pctChange: "0.23" });
  assert.equal(after.payoutLiability, 250_000);
  assert.equal(out.changedFields, 5);
});

test("resolution notes: jackpot rescales scores and keeps the margin consistent; pool is untouched", () => {
  const out = rescaleResolutionNotes(
    "jackpot",
    JSON.stringify({
      type: "jackpot", actualScore: 512_679, winningPrediction: 500_000, margin: 12_679,
      totalPool: 570_000, payout: 5_700, totalEntries: 57, tiedWinners: 1,
    }),
  );
  const after = JSON.parse(out.text);
  assert.equal(after.actualScore, 51_268);
  assert.equal(after.winningPrediction, 50_000);
  assert.equal(after.margin, 1_268);
  assert.equal(after.totalPool, 570_000);
  assert.equal(after.payout, 5_700);
  assert.equal(after.totalEntries, 57);
});

test("resolution notes: keys from another market type are not touched", () => {
  // A jackpot-style key on an up/down market is not a score field for that type.
  const text = JSON.stringify({ type: "updown", actualScore: 512_679, voidReason: "x" });
  const out = rescaleResolutionNotes("updown", text);
  assert.equal(out.text, text);
  assert.equal(out.changedFields, 0);
});

test("resolution notes: notes with no scores come back byte-identical", () => {
  const text = '{ "type": "jackpot",  "pendingReason": "no close snapshot" }';
  const out = rescaleResolutionNotes("jackpot", text);
  assert.equal(out.text, text);
  assert.equal(out.changedFields, 0);
  assert.equal(out.reformatted, false);
});

test("resolution notes: pretty-printed input stays pretty-printed", () => {
  const text = JSON.stringify({ actualScore: 512_679 }, null, 2);
  const out = rescaleResolutionNotes("jackpot", text);
  assert.equal(out.text, JSON.stringify({ actualScore: 51_268 }, null, 2));
  assert.equal(out.reformatted, false);
});

test("resolution notes: odd spacing is flagged as reformatted", () => {
  const out = rescaleResolutionNotes("jackpot", '{"actualScore" : 512679}');
  assert.equal(out.text, '{"actualScore":51268}');
  assert.equal(out.reformatted, true);
});

test("resolution notes: non-JSON and non-object text is skipped, never rewritten", () => {
  const prose = "Resolved manually by admin at 512679";
  assert.deepEqual(rescaleResolutionNotes("jackpot", prose), {
    text: prose, changedFields: 0, reformatted: false, skipped: "not_json",
  });
  assert.equal(rescaleResolutionNotes("jackpot", "[512679]").skipped, "not_object");
  assert.equal(rescaleResolutionNotes("jackpot", "512679").skipped, "not_object");
});

// ── notification bodies ────────────────────────────────────────────────────

test("notification body: rewrites the close score and leaves credits alone", () => {
  const out = rescaleJackpotNotificationBody(
    "Bad Bunny: Predict Exact Score closed at 536271. Lost 100 credits.",
    { actualScore: 536_271, payout: 0, stake: 100, status: "lost" },
  );
  assert.equal(out.body, "Bad Bunny: Predict Exact Score closed at 53627. Lost 100 credits.");
  assert.equal(out.replacements, 1);
  assert.deepEqual(out.misses, []);
});

test("notification body: rewrites all three quoted numbers consistently", () => {
  const out = rescaleJackpotNotificationBody(
    "Closed at 512679. You predicted 500000 (off by 12679). Payout Ꝟ5,700 (net +Ꝟ5,600).",
    { actualScore: 512_679, predictedScore: 500_000, margin: 12_679, payout: 5_700 },
  );
  assert.equal(out.body, "Closed at 51268. You predicted 50000 (off by 1268). Payout Ꝟ5,700 (net +Ꝟ5,600).");
  assert.equal(out.replacements, 3);
});

test("notification body: a number is only rewritten when it matches this row's metadata", () => {
  const body = "Closed at 999999. Lost 100 credits.";
  const out = rescaleJackpotNotificationBody(body, { actualScore: 536_271 });
  assert.equal(out.body, body);
  assert.equal(out.replacements, 0);
  assert.deepEqual(out.misses, ["actualScore"]);
});

test("notification body: does not match a longer number that merely starts with the score", () => {
  const body = "Closed at 5362719. Lost 100 credits.";
  assert.equal(rescaleJackpotNotificationBody(body, { actualScore: 536_271 }).body, body);
});

test("notification body: a payout equal to the score is not mistaken for it", () => {
  // The score appears twice as digits; only the one behind "closed at" is a score.
  const out = rescaleJackpotNotificationBody(
    "X closed at 5600. You predicted 5700 (off by 100). Payout 5600 (net +5500).",
    { actualScore: 5_600, predictedScore: 5_700, margin: 100 },
  );
  assert.equal(out.body, "X closed at 560. You predicted 570 (off by 10). Payout 5600 (net +5500).");
});

test("notification body: real-world figures in other notifications are never touched", () => {
  const body = "Will Bitcoin close above $100,000? moved 12 points.";
  assert.equal(rescaleJackpotNotificationBody(body, { currentPrice: 0.62 }).body, body);
  assert.equal(rescaleJackpotNotificationBody(body, null).body, body);
});

// ── active jackpot tickets ─────────────────────────────────────────────────

function ticket(id: string, predictedScore: number, overrides: Partial<ActiveTicket> = {}): ActiveTicket {
  return { id, marketId: "m1", predictedScore, isAgent: true, createdAt: 1_000, ...overrides };
}

function byId(assignments: ReturnType<typeof assignActiveTicketScores>): Record<string, number> {
  return Object.fromEntries(assignments.map((a) => [a.id, a.newScore]));
}

test("active tickets: non-colliding tickets are simply rescaled", () => {
  const out = assignActiveTicketScores([ticket("a", 512_343), ticket("b", 498_000), ticket("c", 512_360)], 200_000);
  assert.deepEqual(byId(out), { a: 51_234, b: 49_800, c: 51_236 });
  assert.ok(out.every((a) => a.nudge === 0));
});

test("active tickets: a rounding collision moves the later ticket to the nearest free number", () => {
  const out = assignActiveTicketScores(
    [ticket("late", 512_338, { createdAt: 2_000 }), ticket("early", 512_343, { createdAt: 1_000 })],
    200_000,
  );
  const scores = byId(out);
  assert.equal(scores.early, 51_234);
  // Its original guess was below the holder's, so it moves down, preserving order.
  assert.equal(scores.late, 51_233);
  assert.equal(out.find((a) => a.id === "late")?.nudge, -1);
});

test("active tickets: a human always keeps their number ahead of an agent", () => {
  const out = assignActiveTicketScores(
    [
      ticket("agent", 512_343, { createdAt: 1_000, isAgent: true }),
      ticket("human", 512_341, { createdAt: 9_000, isAgent: false }),
    ],
    200_000,
  );
  const scores = byId(out);
  assert.equal(scores.human, 51_234);
  assert.equal(scores.agent, 51_235);
});

test("active tickets: the same number on different markets is not a collision", () => {
  const out = assignActiveTicketScores(
    [ticket("a", 512_343, { marketId: "m1" }), ticket("b", 512_341, { marketId: "m2" })],
    200_000,
  );
  assert.deepEqual(byId(out), { a: 51_234, b: 51_234 });
});

test("active tickets: a cluster resolves to distinct numbers within each market", () => {
  const tickets = [
    ticket("a", 512_340, { createdAt: 1 }),
    ticket("b", 512_341, { createdAt: 2 }),
    ticket("c", 512_342, { createdAt: 3 }),
    ticket("d", 512_343, { createdAt: 4 }),
    ticket("e", 512_352, { createdAt: 5 }),
  ];
  const out = assignActiveTicketScores(tickets, 200_000);
  const scores = out.map((a) => a.newScore);
  assert.equal(new Set(scores).size, tickets.length, "all numbers distinct");
  assert.ok(out.every((a) => Math.abs(a.nudge) <= 3), "nobody moves further than the cluster size");
  assert.equal(out.length, tickets.length);
});

test("active tickets: a nudge never leaves the allowed range", () => {
  const out = assignActiveTicketScores(
    [ticket("a", 2_000_000, { createdAt: 1 }), ticket("b", 2_000_004, { createdAt: 2 })],
    200_000,
  );
  const scores = byId(out);
  assert.equal(scores.a, 200_000);
  assert.equal(scores.b, 199_999);
});

test("active tickets: result is independent of input order", () => {
  const tickets = [
    ticket("a", 512_343, { createdAt: 3 }),
    ticket("b", 512_341, { createdAt: 1 }),
    ticket("c", 512_339, { createdAt: 2 }),
  ];
  assert.deepEqual(
    byId(assignActiveTicketScores(tickets, 200_000)),
    byId(assignActiveTicketScores([...tickets].reverse(), 200_000)),
  );
});
