import test from "node:test";
import assert from "node:assert/strict";

import {
  SWIPE_TRIAL_STORAGE_KEY,
  buildSameCategoryMatchupQueue,
  firstSwipableMatchupId,
  isSwipeTrialGateOpen,
  matchupMatchesCanonicalCategory,
  readSwipeTrialOverride,
  reconcileSwipeQueueIndex,
  stepSwipeQueueIndex,
  type CategoryIdResolver,
  type SwipeTrialMatchup,
  type SwipeTrialStorage,
} from "../client/src/lib/swipeTrial";

function memoryStorage(initial: Record<string, string> = {}): SwipeTrialStorage & { snapshot(): Record<string, string> } {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
    snapshot() {
      return { ...data };
    },
  };
}

const resolve: CategoryIdResolver = (stored) => {
  const value = (stored ?? "").trim().toLowerCase();
  if (value === "media" || value === "media & podcast" || value === "media-and-podcast") return "media";
  if (!value) return "misc";
  return value;
};

function card(
  id: string,
  category: string | null,
  secondary: string[] = [],
): SwipeTrialMatchup {
  return { id, category, secondaryCategories: secondary };
}

test("preview override stays off until it is explicitly set", () => {
  const storage = memoryStorage();
  assert.equal(readSwipeTrialOverride(storage, ""), false);
  assert.equal(readSwipeTrialOverride(storage, "?ref=abc"), false);
  assert.equal(readSwipeTrialOverride(storage, "?swipeTrial=true"), false);
  assert.deepEqual(storage.snapshot(), {});
});

test("?swipeTrial=1 persists the preview flag and ?swipeTrial=0 clears it", () => {
  const storage = memoryStorage();
  assert.equal(readSwipeTrialOverride(storage, "?section=all&swipeTrial=1"), true);
  assert.equal(storage.snapshot()[SWIPE_TRIAL_STORAGE_KEY], "1");
  assert.equal(readSwipeTrialOverride(storage, ""), true);
  assert.equal(readSwipeTrialOverride(storage, "swipeTrial=0"), false);
  assert.equal(storage.getItem(SWIPE_TRIAL_STORAGE_KEY), null);
  assert.equal(readSwipeTrialOverride(storage, ""), false);
});

test("a storage failure leaves the trial off instead of throwing", () => {
  const broken: SwipeTrialStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readSwipeTrialOverride(broken, ""), false);
  assert.equal(readSwipeTrialOverride(broken, "?swipeTrial=1"), true);
  assert.equal(readSwipeTrialOverride(broken, "?swipeTrial=0"), false);
});

test("the gate opens only for a native shell or an explicit override on the All mixed feed", () => {
  const open = {
    native: true,
    override: false,
    allSelected: true,
    mixedFeed: true,
    snapOrOverlayOpen: false,
  };
  assert.equal(isSwipeTrialGateOpen(open), true);
  assert.equal(isSwipeTrialGateOpen({ ...open, native: false, override: true }), true);
  assert.equal(isSwipeTrialGateOpen({ ...open, native: false }), false);
  assert.equal(isSwipeTrialGateOpen({ ...open, allSelected: false }), false);
  assert.equal(isSwipeTrialGateOpen({ ...open, mixedFeed: false }), false);
  assert.equal(isSwipeTrialGateOpen({ ...open, snapOrOverlayOpen: true }), false);
  assert.equal(
    isSwipeTrialGateOpen({ ...open, native: false, override: true, snapOrOverlayOpen: true }),
    false,
  );
  assert.equal(
    isSwipeTrialGateOpen({ ...open, native: false, override: true, mixedFeed: false }),
    false,
  );
});

test("same-category queue uses the canonical id on the primary or any secondary", () => {
  const items = [
    card("solo", "tech"),
    card("sports-media", "sports", ["Media & Podcast"]),
    card("media-a", "media"),
    card("tech", "tech"),
    card("media-b", "Media & Podcast"),
    card("blank", ""),
    card("media-secondary", "business", ["media"]),
  ];

  assert.equal(matchupMatchesCanonicalCategory(items[1]!, "media", resolve), true);
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "media-a", resolve).map((item) => item.id),
    ["sports-media", "media-a", "media-b", "media-secondary"],
  );
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "media-b", resolve).map((item) => item.id),
    ["sports-media", "media-a", "media-b", "media-secondary"],
  );
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "tech", resolve).map((item) => item.id),
    ["solo", "tech"],
  );
});

test("a card with no primary category is a queue of one, and a missing anchor is empty", () => {
  const items = [card("blank", "  "), card("music", "music"), card("also", null)];
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "blank", resolve).map((item) => item.id),
    ["blank"],
  );
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "also", resolve).map((item) => item.id),
    ["also"],
  );
  assert.deepEqual(buildSameCategoryMatchupQueue(items, "gone", resolve), []);
});

test("a card is not duplicated when its primary and secondary resolve to the same id", () => {
  const items = [card("once", "media", ["Media & Podcast"]), card("other", "media")];
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "once", resolve).map((item) => item.id),
    ["once", "other"],
  );
});

test("the queue is only the list the caller already filtered", () => {
  const visible = [card("a", "music"), card("c", "music")];
  assert.deepEqual(
    buildSameCategoryMatchupQueue(visible, "a", resolve).map((item) => item.id),
    ["a", "c"],
  );
});

test("the first swipable anchor skips a category that cannot page", () => {
  const items = [card("solo", "tech"), card("m1", "music"), card("m2", "music"), card("m3", "music")];
  assert.equal(firstSwipableMatchupId(items, resolve), "m1");
  assert.equal(firstSwipableMatchupId([card("solo", "tech")], resolve), null);
  assert.equal(firstSwipableMatchupId([], resolve), null);
});

test("rebuilding the queue keeps the card under the finger", () => {
  assert.equal(reconcileSwipeQueueIndex(["a", "b", "c"], "b", 0), 1);
  assert.equal(reconcileSwipeQueueIndex(["a", "c"], "b", 1), 1);
  assert.equal(reconcileSwipeQueueIndex(["a"], "b", 4), 0);
  assert.equal(reconcileSwipeQueueIndex([], "b", 2), 0);
});

test("a queue of one does not page, and a queue of two rubber-bands at both ends", () => {
  assert.deepEqual(stepSwipeQueueIndex(0, 1, "left"), { type: "edge" });
  assert.deepEqual(stepSwipeQueueIndex(0, 2, "right"), { type: "edge" });
  assert.deepEqual(stepSwipeQueueIndex(0, 2, "left"), { type: "page", index: 1 });
  assert.deepEqual(stepSwipeQueueIndex(1, 2, "left"), { type: "edge" });
  assert.deepEqual(stepSwipeQueueIndex(1, 2, "right"), { type: "page", index: 0 });
});
