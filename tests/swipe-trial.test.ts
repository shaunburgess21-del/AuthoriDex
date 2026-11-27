import test from "node:test";
import assert from "node:assert/strict";

import {
  SWIPE_TRIAL_STORAGE_KEY,
  buildSameCategoryMatchupQueue,
  categoryFilterPrimaryId,
  firstSwipableMatchupId,
  isSwipeTrialGateOpen,
  matchupMatchesCanonicalCategory,
  nearbyFeedMatchupIds,
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

test("the queue matches the displayed primary category and ignores secondaries", () => {
  const items = [
    card("solo", "tech"),
    card("sports-media", "sports", ["Media & Podcast"]),
    card("media-a", "media"),
    card("tech", "tech"),
    card("media-b", "Media & Podcast"),
    card("blank", ""),
    card("food-lifestyle", "food", ["lifestyle"]),
    card("lifestyle", "lifestyle"),
  ];

  assert.equal(matchupMatchesCanonicalCategory(items[1]!, "media", resolve), false);
  assert.equal(matchupMatchesCanonicalCategory(items[2]!, "media", resolve), true);
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "media-a", resolve).map((item) => item.id),
    ["media-a", "media-b"],
  );
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "lifestyle", resolve).map((item) => item.id),
    ["lifestyle"],
  );
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "tech", resolve).map((item) => item.id),
    ["solo", "tech"],
  );
});

test("an active category filter keeps only that primary, and a mismatched card does not page", () => {
  const items = [
    card("food", "food", ["dating"]),
    card("date-a", "dating"),
    card("date-b", "Dating"),
    card("sports", "sports", ["dating"]),
  ];
  assert.equal(categoryFilterPrimaryId("all", resolve), null);
  assert.equal(categoryFilterPrimaryId("dating", resolve), "dating");
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "food", resolve, { restrictToPrimaryId: "dating" }).map((item) => item.id),
    ["food"],
  );
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "date-a", resolve, { restrictToPrimaryId: "dating" }).map((item) => item.id),
    ["date-a", "date-b"],
  );
  assert.equal(
    firstSwipableMatchupId(items, resolve, { restrictToPrimaryId: "dating" }),
    "date-a",
  );
  assert.deepEqual(stepSwipeQueueIndex(0, 1, "left"), { type: "edge" });
});

test("nearby feed slots are left out of the queue so a swipe does not repeat the card below", () => {
  const feed = [
    { kind: "matchup", id: "eth" },
    { kind: "sentiment", id: "s1" },
    { kind: "opinion", id: "o1" },
    { kind: "rating", id: "r1" },
    { kind: "matchup", id: "sol" },
    { kind: "sentiment", id: "s2" },
    { kind: "matchup", id: "ada" },
  ];
  const nearby = nearbyFeedMatchupIds(feed, "eth", 4);
  assert.deepEqual([...nearby], ["sol"]);
  const items = [card("eth", "crypto"), card("sol", "crypto"), card("ada", "crypto")];
  assert.deepEqual(
    buildSameCategoryMatchupQueue(items, "eth", resolve, { excludeIds: nearby }).map((item) => item.id),
    ["eth", "ada"],
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
