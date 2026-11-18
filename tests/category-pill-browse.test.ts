import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BROWSE_INTENT_TOKEN_MS,
  BROWSE_TAP_SLOP_PX,
  beginCategoryPillBrowsePress,
  cancelCategoryPillBrowsePress,
  commitCategoryPillBrowse,
  consumeCategoryPillBrowseIntent,
  hasCategoryPillBrowseIntent,
  isBrowseTapWithinSlop,
  markCategoryPillPassiveDismiss,
  resetCategoryPillBrowseIntentForTests,
  setCategoryPillBrowseIntentClockForTests,
} from "../client/src/lib/categoryPillBrowseIntent";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("browse full screen is an in-app snap overlay, and a committed tap survives the iOS sheet-close dismiss", () => {
  try {
    beginCategoryPillBrowsePress();
    // Overlay can see a pointer event before touchend while the finger is still down.
    markCategoryPillPassiveDismiss();
    assert.equal(hasCategoryPillBrowseIntent(), true);

    commitCategoryPillBrowse();
    // After the drawer closes, WKWebView retargets pointerup/click onto the overlay.
    markCategoryPillPassiveDismiss();
    assert.equal(consumeCategoryPillBrowseIntent(), true);
    assert.equal(consumeCategoryPillBrowseIntent(), false);
  } finally {
    resetCategoryPillBrowseIntentForTests();
  }
});

test("an outside dismiss never opens browse, and a dragged or expired press is dropped", () => {
  try {
    markCategoryPillPassiveDismiss();
    assert.equal(consumeCategoryPillBrowseIntent(), false);

    beginCategoryPillBrowsePress();
    cancelCategoryPillBrowsePress();
    markCategoryPillPassiveDismiss();
    assert.equal(consumeCategoryPillBrowseIntent(), false);

    let t = 1_000_000;
    setCategoryPillBrowseIntentClockForTests(() => t);
    beginCategoryPillBrowsePress();
    commitCategoryPillBrowse();
    t += BROWSE_INTENT_TOKEN_MS + 1;
    assert.equal(consumeCategoryPillBrowseIntent(), false);

    assert.equal(isBrowseTapWithinSlop(null, { x: 0, y: 0 }), false);
    assert.equal(isBrowseTapWithinSlop({ x: 0, y: 0 }, { x: 0, y: BROWSE_TAP_SLOP_PX }), true);
    assert.equal(isBrowseTapWithinSlop({ x: 3, y: 4 }, { x: 0, y: 0 }), true);
    assert.equal(isBrowseTapWithinSlop({ x: 0, y: 0 }, { x: 0, y: BROWSE_TAP_SLOP_PX + 1 }), false);
  } finally {
    resetCategoryPillBrowseIntentForTests();
  }
});

test("the category menu opens snap view from touchend, not the Fullscreen API", () => {
  const pill = read("../client/src/components/InteractiveCategoryPill.tsx");
  const vote = read("../client/src/pages/VotePage.tsx");
  const predict = read("../client/src/pages/PredictPage.tsx");

  assert.match(pill, /onTouchEnd=\{onBrowseTouchEnd\}/);
  assert.match(pill, /onPointerUp=\{onBrowsePointerUp\}/);
  assert.match(pill, /commitCategoryPillBrowse\(\)/);
  assert.match(pill, /if \(isMobile\) flushPendingBrowseFullScreenRef\.current\(\)/);
  assert.equal(pill.includes("requestFullscreen"), false);
  assert.equal(vote.includes("requestFullscreen"), false);
  assert.equal(predict.includes("requestFullscreen"), false);

  assert.match(vote, /source === "browse-button"\) \{\s*if \(!consumeCategoryPillBrowseIntent\(\)\) return;/);
  assert.match(predict, /source === "browse-button"\) \{\s*if \(!consumeCategoryPillBrowseIntent\(\)\) return;/);
  assert.match(vote, /onBrowseFullScreen=\{isMobile \? /);
  assert.match(predict, /isMobile \? \(\) => openSnapScroll\(/);

  const browseLabelAt = pill.lastIndexOf("Browse {label} Full Screen");
  const browseButton = pill.slice(browseLabelAt - 700, browseLabelAt);
  assert.match(browseButton, /onPointerDown=\{onBrowseIntentStart\}/);
  assert.match(browseButton, /onTouchStart=\{onBrowseIntentStart\}/);
  assert.match(browseButton, /onClick=\{onBrowseFullScreen\}/);
});

test("sentiment and matchup cards use their own detail labels", () => {
  const discourse = read("../client/src/components/sentiment/DiscourseCard.tsx");
  const versus = read("../client/src/components/matchups/VersusCard.tsx");
  assert.match(discourse, /detailLabel="View Poll Details"/);
  assert.equal(discourse.includes("View Matchup Details"), false);
  assert.match(versus, /detailLabel="View Matchup Details"/);
  assert.equal(versus.includes("View Poll Details"), false);
});
