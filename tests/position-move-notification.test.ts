import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPositionMoveNotification,
  evaluatePositionMove,
  pickPositionMoveMilestone,
  POSITION_MOVE_MILESTONES,
  POSITION_MOVE_MIN_NOTIONAL_DEFAULT,
  POSITION_MOVE_PCT_THRESHOLD_DEFAULT,
  resolvePositionMoveContextLabel,
} from "../server/jobs/position-move-notification";

test("pickPositionMoveMilestone: below smallest milestone", () => {
  assert.equal(pickPositionMoveMilestone(18), null);
  assert.equal(pickPositionMoveMilestone(-19.9), null);
  assert.equal(pickPositionMoveMilestone(NaN), null);
});

test("pickPositionMoveMilestone: maps to highest crossed milestone", () => {
  assert.equal(pickPositionMoveMilestone(20), 20);
  assert.equal(pickPositionMoveMilestone(22), 20);
  assert.equal(pickPositionMoveMilestone(49), 20);
  assert.equal(pickPositionMoveMilestone(55), 50);
  assert.equal(pickPositionMoveMilestone(99), 50);
  assert.equal(pickPositionMoveMilestone(100), 100);
  assert.equal(pickPositionMoveMilestone(250), 100);
  assert.equal(pickPositionMoveMilestone(-22), 20);
  assert.equal(pickPositionMoveMilestone(-75), 50);
});

test("evaluation: above-threshold up move returns milestone 20", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 500, currentValue: 650 });
  assert.ok(ev, "expected evaluation, got null");
  assert.equal(ev!.direction, "up");
  assert.equal(ev!.pctMove, 30);
  assert.equal(ev!.milestone, 20);
  assert.equal(ev!.netCreditsIn, 500);
  assert.equal(ev!.currentValue, 650);
});

test("evaluation: above-threshold down move returns milestone 20", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 500, currentValue: 390 });
  assert.ok(ev);
  assert.equal(ev!.direction, "down");
  assert.equal(ev!.pctMove, -22.0);
  assert.equal(ev!.milestone, 20);
});

test("evaluation: sub-threshold move (±19.9%) is suppressed", () => {
  const ev1 = evaluatePositionMove({ netCreditsIn: 1000, currentValue: 1199 });
  assert.equal(ev1, null);
  const ev2 = evaluatePositionMove({ netCreditsIn: 1000, currentValue: 801 });
  assert.equal(ev2, null);
});

test("evaluation: exactly at 20% milestone fires", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 1000, currentValue: 1200 });
  assert.ok(ev);
  assert.equal(ev!.pctMove, 20.0);
  assert.equal(ev!.milestone, 20);
});

test("evaluation: 55% move maps to milestone 50", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 1000, currentValue: 1550 });
  assert.ok(ev);
  assert.equal(ev!.milestone, 50);
});

test("evaluation: dust position (netCreditsIn < 100) is suppressed even if move is huge", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 50, currentValue: 100 });
  assert.equal(ev, null);
});

test("evaluation: zero/negative netCreditsIn is treated as null (degenerate input)", () => {
  assert.equal(evaluatePositionMove({ netCreditsIn: 0, currentValue: 100 }), null);
  assert.equal(evaluatePositionMove({ netCreditsIn: -50, currentValue: 100 }), null);
});

test("evaluation: non-finite inputs return null", () => {
  assert.equal(evaluatePositionMove({ netCreditsIn: NaN, currentValue: 100 }), null);
  assert.equal(evaluatePositionMove({ netCreditsIn: 500, currentValue: Infinity }), null);
});

test("default constants match the deriver's documented thresholds", () => {
  assert.equal(POSITION_MOVE_PCT_THRESHOLD_DEFAULT, 20);
  assert.deepEqual(POSITION_MOVE_MILESTONES, [20, 50, 100]);
  assert.equal(POSITION_MOVE_MIN_NOTIONAL_DEFAULT, 100);
});

test("notification: up title leads with Your position and signed pct", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 500, currentValue: 650 })!;
  const { title, body } = buildPositionMoveNotification({
    marketTitle: "Conor McGregor: Up or Down?",
    contextLabel: "Conor McGregor",
    evaluation: ev,
  });
  assert.equal(title, "Your position is up +30.0%");
  assert.equal(
    body,
    "Conor McGregor: Up or Down? · Staked Ꝟ500, worth Ꝟ650 now. Tap to review.",
  );
});

test("notification: down title uses abs pct without double minus", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 500, currentValue: 390 })!;
  const { title, body } = buildPositionMoveNotification({
    marketTitle: "Mark Cuban: Up or Down?",
    contextLabel: "Mark Cuban",
    evaluation: ev,
  });
  assert.equal(title, "Your position is down 22.0%");
  assert.equal(
    body,
    "Mark Cuban: Up or Down? · Staked Ꝟ500, worth Ꝟ390 now. Tap to review.",
  );
});

test("notification: context label leads when not redundant with market title", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 500, currentValue: 390 })!;
  const { body } = buildPositionMoveNotification({
    marketTitle: "Who wins the fight?",
    contextLabel: "UP",
    evaluation: ev,
  });
  assert.equal(
    body,
    "UP · Who wins the fight? · Staked Ꝟ500, worth Ꝟ390 now. Tap to review.",
  );
});

test("notification: category race body leads with candidate pick", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 100, currentValue: 75 })!;
  assert.equal(ev.milestone, 20);
  const contextLabel = resolvePositionMoveContextLabel({
    marketType: "gainer",
    candidateName: "Clavicular",
    entryLabel: "Clavicular",
    personName: null,
  });
  assert.equal(contextLabel, "Clavicular");
  const { title, body } = buildPositionMoveNotification({
    marketTitle: "Category Race: Streaming",
    contextLabel,
    evaluation: ev,
  });
  assert.equal(title, "Your position is down 25.0%");
  assert.equal(
    body,
    "Clavicular · Category Race: Streaming · Staked Ꝟ100, worth Ꝟ75 now. Tap to review.",
  );
});

test("resolvePositionMoveContextLabel: gainer prefers candidateName over market person", () => {
  assert.equal(
    resolvePositionMoveContextLabel({
      marketType: "gainer",
      candidateName: "Clavicular",
      entryLabel: "Clavicular",
      personName: null,
    }),
    "Clavicular",
  );
});

test("resolvePositionMoveContextLabel: updown prefers market person", () => {
  assert.equal(
    resolvePositionMoveContextLabel({
      marketType: "updown",
      candidateName: null,
      entryLabel: "UP",
      personName: "Andrew Tate",
    }),
    "Andrew Tate",
  );
});

test("notification: large Vox values use en-US thousands separator in body", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 5_000, currentValue: 7_345 })!;
  assert.equal(ev.milestone, 20);
  assert.equal(ev.pctMove, 46.9);
  const { body } = buildPositionMoveNotification({
    marketTitle: "Jake Paul vs KSI",
    evaluation: ev,
  });
  assert.equal(
    body,
    "Jake Paul vs KSI · Staked Ꝟ5,000, worth Ꝟ7,345 now. Tap to review.",
  );
});
