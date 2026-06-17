import test from "node:test";
import assert from "node:assert/strict";

import { getStreakToastTimeline } from "../shared/streak-config";

test("rolling mode: day 32 shows recent week without gift", () => {
  assert.deepEqual(getStreakToastTimeline(32), {
    start: 26,
    end: 32,
    giftDay: null,
    showGift: false,
    pastTopTier: false,
  });
});

test("milestone sprint: day 94 anchors to day 100 reward", () => {
  assert.deepEqual(getStreakToastTimeline(94), {
    start: 94,
    end: 100,
    giftDay: 100,
    showGift: true,
    pastTopTier: false,
  });
});

test("milestone hit: day 30 celebration row ends on today", () => {
  assert.deepEqual(getStreakToastTimeline(30), {
    start: 24,
    end: 30,
    giftDay: 30,
    showGift: true,
    pastTopTier: false,
  });
});

test("past top tier: rolling week without gift", () => {
  assert.deepEqual(getStreakToastTimeline(105), {
    start: 99,
    end: 105,
    giftDay: null,
    showGift: false,
    pastTopTier: true,
  });
});

test("early streak: day 1 shows sprint toward day 3", () => {
  assert.deepEqual(getStreakToastTimeline(1), {
    start: 1,
    end: 3,
    giftDay: 3,
    showGift: true,
    pastTopTier: false,
  });
});
