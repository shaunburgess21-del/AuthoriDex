import test from "node:test";
import assert from "node:assert/strict";

import { shouldShowStreakCelebrationToast } from "../client/src/lib/streak-config";

test("milestone day always shows celebration toast", () => {
  assert.equal(
    shouldShowStreakCelebrationToast({
      streak: 7,
      longestStreak: 7,
      isMilestone: true,
    }),
    true,
  );
});

test("streak started or reset (day 1) shows celebration toast", () => {
  assert.equal(
    shouldShowStreakCelebrationToast({
      streak: 1,
      longestStreak: 11,
      isMilestone: false,
    }),
    true,
  );
});

test("new personal best shows celebration toast", () => {
  assert.equal(
    shouldShowStreakCelebrationToast({
      streak: 11,
      longestStreak: 11,
      isMilestone: false,
    }),
    true,
  );
});

test("routine consecutive day suppresses celebration toast", () => {
  assert.equal(
    shouldShowStreakCelebrationToast({
      streak: 5,
      longestStreak: 10,
      isMilestone: false,
    }),
    false,
  );
});
