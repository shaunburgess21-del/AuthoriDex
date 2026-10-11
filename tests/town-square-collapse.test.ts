import test from "node:test";
import assert from "node:assert/strict";
import {
  createTownSquareSession,
  PREDICT_FILTER_SCROLL_DELAY_MS,
  readTownSquareCollapsed,
  reduceTownSquareFilterChange,
  reduceTownSquareManualToggle,
  shouldPersistTownSquareCollapse,
  shouldScrollPredictResults,
  townSquareCollapsedHint,
  writeTownSquareCollapsed,
} from "../client/src/lib/town-square-collapse";
import {
  positionsFilterEmptyCopy,
  positionsFilterStatusLine,
  positionsSectionEmptyMessage,
} from "../client/src/lib/positions-filter-notice";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

test("saved collapse preference is read only from the explicit flag", () => {
  assert.equal(readTownSquareCollapsed(memoryStorage({ "voxdex-town-square-collapsed": "1" })), true);
  assert.equal(readTownSquareCollapsed(memoryStorage({ "voxdex-town-square-collapsed": "0" })), false);
  assert.equal(readTownSquareCollapsed(memoryStorage()), false);
  assert.equal(readTownSquareCollapsed(null), false);
});

test("opening on Show all keeps the saved collapse preference", () => {
  assert.deepEqual(createTownSquareSession(false, "all"), {
    collapsed: false,
    manualOverride: false,
    restoreCollapsed: false,
  });
  assert.deepEqual(createTownSquareSession(true, "all"), {
    collapsed: true,
    manualOverride: false,
    restoreCollapsed: true,
  });
});

test("opening already filtered starts collapsed without forgetting the preference", () => {
  assert.deepEqual(createTownSquareSession(false, "show-mine"), {
    collapsed: true,
    manualOverride: false,
    restoreCollapsed: false,
  });
});

test("a non-all filter collapses Town Square and Show all restores the previous state", () => {
  const open = createTownSquareSession(false, "all");
  const filtered = reduceTownSquareFilterChange(open, "show-mine");
  assert.equal(filtered.collapsed, true);
  assert.equal(filtered.manualOverride, false);
  const restored = reduceTownSquareFilterChange(filtered, "all");
  assert.equal(restored.collapsed, false);

  const savedClosed = createTownSquareSession(true, "all");
  const stillClosed = reduceTownSquareFilterChange(savedClosed, "hide-mine");
  assert.equal(stillClosed.collapsed, true);
  assert.equal(reduceTownSquareFilterChange(stillClosed, "all").collapsed, true);
});

test("a manual toggle while filtered is kept for later filter changes", () => {
  const filtered = reduceTownSquareFilterChange(createTownSquareSession(false, "all"), "show-mine");
  const expanded = reduceTownSquareManualToggle(filtered, "show-mine");
  assert.equal(expanded.collapsed, false);
  assert.equal(expanded.manualOverride, true);
  assert.equal(reduceTownSquareFilterChange(expanded, "hide-mine").collapsed, false);
  assert.equal(reduceTownSquareFilterChange(expanded, "all").collapsed, false);
});

test("a manual toggle on Show all updates the preference and still auto-collapses later", () => {
  const closed = reduceTownSquareManualToggle(createTownSquareSession(false, "all"), "all");
  assert.equal(closed.collapsed, true);
  assert.equal(closed.manualOverride, false);
  assert.equal(closed.restoreCollapsed, true);
  const filtered = reduceTownSquareFilterChange(closed, "show-mine");
  assert.equal(filtered.collapsed, true);
  assert.equal(reduceTownSquareFilterChange(filtered, "all").collapsed, true);
});

test("auto-collapse is not persisted; a Show all toggle is", () => {
  assert.equal(shouldPersistTownSquareCollapse("all"), true);
  assert.equal(shouldPersistTownSquareCollapse("show-mine"), false);
  assert.equal(shouldPersistTownSquareCollapse("hide-mine"), false);
  const storage = memoryStorage();
  writeTownSquareCollapsed(storage, true);
  assert.equal(storage.data["voxdex-town-square-collapsed"], "1");
  writeTownSquareCollapsed(null, true);
});

test("results scroll only when a filter is applied, after the collapse transition", () => {
  assert.equal(shouldScrollPredictResults("all", "show-mine"), true);
  assert.equal(shouldScrollPredictResults("show-mine", "hide-mine"), true);
  assert.equal(shouldScrollPredictResults("show-mine", "all"), false);
  assert.equal(shouldScrollPredictResults("all", "all"), false);
  assert.equal(PREDICT_FILTER_SCROLL_DELAY_MS, 220);
});

test("collapsed Town Square hint is one short line", () => {
  assert.equal(
    townSquareCollapsedHint({ pending: true, failed: false, count: 0 }),
    "Loading recent activity",
  );
  assert.equal(
    townSquareCollapsedHint({ pending: false, failed: true, count: 4 }),
    "Couldn't load activity",
  );
  assert.equal(
    townSquareCollapsedHint({ pending: false, failed: false, count: 0 }),
    "No recent activity",
  );
  assert.equal(
    townSquareCollapsedHint({ pending: false, failed: false, count: 1, latestName: "Pixievox" }),
    "1 recent prediction · Pixievox",
  );
  assert.equal(
    townSquareCollapsedHint({ pending: false, failed: false, count: 8, latestName: "  " }),
    "8 recent predictions",
  );
});

test("positions filter status line matches the visible cards", () => {
  assert.equal(positionsFilterStatusLine("all", 3), null);
  assert.equal(positionsFilterStatusLine("show-mine", 3), "Showing your 3 active positions");
  assert.equal(positionsFilterStatusLine("show-mine", 1), "Showing your 1 active position");
  assert.equal(positionsFilterStatusLine("show-mine", 0), "Showing only your active positions");
  assert.equal(
    positionsFilterStatusLine("hide-mine", 12),
    "Hiding markets you've predicted on",
  );
});

test("positions filter empty copy is specific to the active mode", () => {
  assert.equal(positionsFilterEmptyCopy("all"), null);
  assert.match(positionsFilterEmptyCopy("show-mine")?.title ?? "", /active positions/i);
  assert.match(positionsFilterEmptyCopy("hide-mine")?.title ?? "", /every market/i);
  assert.equal(positionsSectionEmptyMessage("all", "updown"), null);
  assert.equal(positionsSectionEmptyMessage("show-mine", "gainer"), "No active Category Race positions");
  assert.equal(
    positionsSectionEmptyMessage("hide-mine", "h2h"),
    "You've predicted on every Head-to-Head market",
  );
});
