import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  boxScrolls,
  innermostScrollableIndex,
  shouldScrollTabOnReselect,
} from "../client/src/lib/scrollActiveScreen";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("only the iOS shell scrolls when the active tab is tapped again", () => {
  assert.equal(shouldScrollTabOnReselect(true, "ios", true), true);
  assert.equal(shouldScrollTabOnReselect(true, "ios", false), false);
  assert.equal(shouldScrollTabOnReselect(true, "android", true), false);
  assert.equal(shouldScrollTabOnReselect(false, "ios", true), false);
  assert.equal(shouldScrollTabOnReselect(false, "web", true), false);
  assert.equal(shouldScrollTabOnReselect(true, "iOS", true), false);
});

test("the innermost vertical scroller wins, otherwise the window", () => {
  const chipRow = { overflowY: "auto", scrollHeight: 40, clientHeight: 40 };
  const overlay = { overflowY: "auto", scrollHeight: 1400, clientHeight: 700 };
  const hidden = { overflowY: "hidden", scrollHeight: 1400, clientHeight: 700 };
  const visible = { overflowY: "visible", scrollHeight: 1400, clientHeight: 700 };

  assert.equal(boxScrolls(chipRow), false);
  assert.equal(boxScrolls(overlay), true);
  assert.equal(boxScrolls(hidden), false);
  assert.equal(boxScrolls({ overflowY: "scroll", scrollHeight: 200, clientHeight: 100 }), true);
  assert.equal(innermostScrollableIndex([chipRow, overlay, visible]), 1);
  assert.equal(innermostScrollableIndex([visible, hidden]), -1);
  assert.equal(innermostScrollableIndex([]), -1);
});

test("tab screens use the window, and the open panels are the real scrollers", () => {
  const home = read("../client/src/pages/HomePage.tsx");
  const vote = read("../client/src/pages/VotePage.tsx");
  const predict = read("../client/src/pages/PredictPage.tsx");
  const voices = read("../client/src/pages/VoicesPage.tsx");
  const insights = read("../client/src/pages/InsightsPage.tsx");
  const nav = read("../client/src/components/BottomNav.tsx");

  assert.match(home, /home-shell min-h-screen/);
  assert.match(home, /fixed inset-0 z-50 bg-background\/95 backdrop-blur-xl overflow-y-auto/);
  assert.match(vote, /min-h-screen pb-20 md:pb-0 overflow-x-clip/);
  assert.match(vote, /flex-1 overflow-y-auto/);
  assert.match(predict, /min-h-screen pb-20 md:pb-0 overflow-x-clip/);
  assert.match(predict, /data-testid="overlay-view-all"/);
  assert.match(predict, /overflow-y-auto premium-scrollbar/);
  assert.match(voices, /min-h-screen bg-background pb-20 md:pb-0/);
  assert.match(insights, /min-h-screen pb-20 md:pb-0 bg-background overflow-x-clip/);
  assert.match(nav, /shouldScrollTabOnReselect/);
  assert.match(nav, /scrollActiveScreenToTop/);
  assert.match(nav, /event\.preventDefault\(\)/);
});
