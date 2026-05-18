import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPositionMoveNotification,
  evaluatePositionMove,
  POSITION_MOVE_MIN_NOTIONAL_DEFAULT,
  POSITION_MOVE_PCT_THRESHOLD_DEFAULT,
} from "../server/jobs/position-move-notification";

// Pure helpers — no DB. These tests pin the threshold + dust gates
// and the title/body wording so the position-move-alert deriver
// doesn't accidentally regress when we tune the constants or
// reformat the strings.

test("evaluation: above-threshold up move returns 'up' direction with rounded pctMove", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 500, currentValue: 593 });
  assert.ok(ev, "expected evaluation, got null");
  assert.equal(ev!.direction, "up");
  assert.equal(ev!.pctMove, 18.6);
  assert.equal(ev!.netCreditsIn, 500);
  assert.equal(ev!.currentValue, 593);
});

test("evaluation: above-threshold down move returns 'down' direction with negative pctMove", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 500, currentValue: 390 });
  assert.ok(ev);
  assert.equal(ev!.direction, "down");
  assert.equal(ev!.pctMove, -22.0);
});

test("evaluation: sub-threshold move (±14.9%) is suppressed", () => {
  const ev1 = evaluatePositionMove({ netCreditsIn: 1000, currentValue: 1149 });
  assert.equal(ev1, null);
  const ev2 = evaluatePositionMove({ netCreditsIn: 1000, currentValue: 851 });
  assert.equal(ev2, null);
});

test("evaluation: exactly at threshold (±15.0%) fires", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 1000, currentValue: 1150 });
  assert.ok(ev);
  assert.equal(ev!.pctMove, 15.0);
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

test("evaluation: custom thresholds override defaults", () => {
  // With default 15% threshold, a 10% move is suppressed; with a 5%
  // threshold the same input fires.
  const noFire = evaluatePositionMove({ netCreditsIn: 1000, currentValue: 1100 });
  assert.equal(noFire, null);
  const fire = evaluatePositionMove({
    netCreditsIn: 1000,
    currentValue: 1100,
    pctThreshold: 5,
  });
  assert.ok(fire);
  assert.equal(fire!.pctMove, 10);
});

test("default constants match the deriver's documented thresholds", () => {
  assert.equal(POSITION_MOVE_PCT_THRESHOLD_DEFAULT, 15);
  assert.equal(POSITION_MOVE_MIN_NOTIONAL_DEFAULT, 100);
});

test("notification: up wording includes signed pct, person name, and 'Tap to review' CTA", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 500, currentValue: 593 })!;
  const { title, body } = buildPositionMoveNotification({
    subjectLabel: "Conor McGregor",
    evaluation: ev,
  });
  assert.equal(title, "Conor McGregor is up +18.6% on your position");
  assert.equal(body, "Bought for 500 cr, worth 593 cr now. Tap to review.");
});

test("notification: down wording uses negative sign without double-minus", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 500, currentValue: 390 })!;
  const { title, body } = buildPositionMoveNotification({
    subjectLabel: "Mark Cuban",
    evaluation: ev,
  });
  // The %.toFixed(1) call already includes the minus, so we should
  // see exactly one minus sign (not "--").
  assert.equal(title, "Mark Cuban is down -22.0% on your position");
  assert.equal(body, "Bought for 500 cr, worth 390 cr now. Tap to review.");
});

test("notification: large credit values use en-US thousands separator in body", () => {
  const ev = evaluatePositionMove({ netCreditsIn: 5_000, currentValue: 7_345 })!;
  const { body } = buildPositionMoveNotification({
    subjectLabel: "Jake Paul vs KSI",
    evaluation: ev,
  });
  assert.equal(body, "Bought for 5,000 cr, worth 7,345 cr now. Tap to review.");
});
