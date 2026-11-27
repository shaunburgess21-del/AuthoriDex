import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  HORIZONTAL_OVERFLOW_SLOP_PX,
  NO_SWIPE_NAV_SELECTOR,
  SWIPE_COMMIT_OFFSET_PX,
  SWIPE_COMMIT_VELOCITY_PX_PER_S,
  SWIPE_EDGE_INSET_PX,
  elementCanScrollHorizontally,
  hasHorizontalOverflow,
  overflowXAllowsPan,
  claimPointerAxis,
  pointerStartsInScreenEdge,
  pointerTargetYieldsSwipeNav,
  swipeCommitDirection,
  swipeNavShouldIgnoreGesture,
  type SwipeGestureNode,
} from "../client/src/components/vote/swipeGesture";

function node(options: {
  selectors?: string[];
  scrollable?: boolean;
  parent?: SwipeGestureNode | null;
}): SwipeGestureNode {
  return {
    matches(selector: string) {
      return (options.selectors ?? []).includes(selector);
    },
    parentElement: options.parent ?? null,
    canScrollHorizontally() {
      return options.scrollable ?? false;
    },
  };
}

test("overflow-x auto, scroll, and overlay can pan; other values cannot", () => {
  assert.equal(overflowXAllowsPan("auto"), true);
  assert.equal(overflowXAllowsPan("scroll"), true);
  assert.equal(overflowXAllowsPan("overlay"), true);
  assert.equal(overflowXAllowsPan("hidden"), false);
  assert.equal(overflowXAllowsPan("clip"), false);
  assert.equal(overflowXAllowsPan("visible"), false);
});

test("subpixel overflow is not a horizontal scroller", () => {
  assert.equal(hasHorizontalOverflow(101, 100), false);
  assert.equal(hasHorizontalOverflow(100 + HORIZONTAL_OVERFLOW_SLOP_PX, 100), false);
  assert.equal(hasHorizontalOverflow(100 + HORIZONTAL_OVERFLOW_SLOP_PX + 1, 100), true);
  assert.equal(hasHorizontalOverflow(100, 120), false);
});

test("a gesture inside data-no-swipe-nav never navigates", () => {
  const boundary = node({});
  const scroller = node({
    selectors: [NO_SWIPE_NAV_SELECTOR],
    parent: boundary,
  });
  const card = node({ parent: scroller });
  assert.equal(swipeNavShouldIgnoreGesture(card, boundary), true);
  assert.equal(swipeNavShouldIgnoreGesture(scroller, boundary), true);
});

test("a marked region outside the swipe surface does not block navigation", () => {
  const outside = node({ selectors: [NO_SWIPE_NAV_SELECTOR] });
  const boundary = node({ parent: outside });
  const body = node({ parent: boundary });
  assert.equal(swipeNavShouldIgnoreGesture(body, boundary), false);
});

test("a horizontally scrollable ancestor inside the surface yields", () => {
  const boundary = node({});
  const row = node({ scrollable: true, parent: boundary });
  const card = node({ parent: row });
  assert.equal(swipeNavShouldIgnoreGesture(card, boundary), true);
  assert.equal(swipeNavShouldIgnoreGesture(row, boundary), true);
});

test("a horizontal scroller outside the surface does not yield", () => {
  const page = node({ scrollable: true });
  const boundary = node({ parent: page });
  const body = node({ parent: boundary });
  assert.equal(swipeNavShouldIgnoreGesture(body, boundary), false);
});

test("vertical content and the swipe surface itself still navigate", () => {
  const boundary = node({ scrollable: false });
  const section = node({ parent: boundary });
  const paragraph = node({ parent: section });
  assert.equal(swipeNavShouldIgnoreGesture(paragraph, boundary), false);
  assert.equal(swipeNavShouldIgnoreGesture(boundary, boundary), false);
  assert.equal(swipeNavShouldIgnoreGesture(null, boundary), false);
});

test("ignoreSelector still opts a region out, including on the target itself", () => {
  const boundary = node({});
  const chips = node({ selectors: ["[data-no-tab-swipe]"], parent: boundary });
  const chip = node({ parent: chips });
  assert.equal(swipeNavShouldIgnoreGesture(chip, boundary, "[data-no-tab-swipe]"), true);
  assert.equal(swipeNavShouldIgnoreGesture(chip, boundary), false);
  assert.equal(swipeNavShouldIgnoreGesture(chip, boundary, "   "), false);
});

test("DOM helpers no-op where Element is unavailable", () => {
  assert.equal(elementCanScrollHorizontally({ nodeType: 1 } as Element), false);
  assert.equal(pointerTargetYieldsSwipeNav(null, { nodeType: 1 } as Element), false);
});

test("the carousel opts out of swipe-nav and pans on both axes", () => {
  const carousel = readFileSync(
    new URL("../client/src/components/shared/RelatedItemsCarousel.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(carousel.match(/data-no-swipe-nav=""/g)?.length, 2);
  assert.match(carousel, /\[touch-action:pan-x_pan-y\]/);
  assert.match(carousel, /overscroll-x-contain/);
  const loading = carousel.indexOf("data-testid={`${testIdPrefix}-loading`}");
  const ready = carousel.indexOf("data-testid={`${testIdPrefix}-scroller`}");
  assert.ok(loading > 0 && ready > loading);
  assert.ok(carousel.slice(loading, ready).includes('data-no-swipe-nav=""'));
  assert.ok(carousel.slice(ready - 180, ready).includes('data-no-swipe-nav=""'));
});

test("a commit needs 80px or a fast flick, and the direction follows the offset", () => {
  assert.equal(swipeCommitDirection(SWIPE_COMMIT_OFFSET_PX - 1, 0), null);
  assert.equal(swipeCommitDirection(-(SWIPE_COMMIT_OFFSET_PX - 1), SWIPE_COMMIT_VELOCITY_PX_PER_S - 1), null);
  assert.equal(swipeCommitDirection(SWIPE_COMMIT_OFFSET_PX, 0), "right");
  assert.equal(swipeCommitDirection(-SWIPE_COMMIT_OFFSET_PX, 0), "left");
  assert.equal(swipeCommitDirection(12, SWIPE_COMMIT_VELOCITY_PX_PER_S), "right");
  assert.equal(swipeCommitDirection(-12, -SWIPE_COMMIT_VELOCITY_PX_PER_S), "left");
  assert.equal(swipeCommitDirection(0, SWIPE_COMMIT_VELOCITY_PX_PER_S), "left");
});

test("screen-edge inset uses viewport CSS pixels and ignores scaled coordinates", () => {
  assert.equal(pointerStartsInScreenEdge(0, 390, SWIPE_EDGE_INSET_PX), true);
  assert.equal(pointerStartsInScreenEdge(SWIPE_EDGE_INSET_PX, 390, SWIPE_EDGE_INSET_PX), true);
  assert.equal(pointerStartsInScreenEdge(SWIPE_EDGE_INSET_PX + 1, 390, SWIPE_EDGE_INSET_PX), false);
  assert.equal(pointerStartsInScreenEdge(390 - SWIPE_EDGE_INSET_PX, 390, SWIPE_EDGE_INSET_PX), true);
  assert.equal(pointerStartsInScreenEdge(200, 390, SWIPE_EDGE_INSET_PX), false);
  assert.equal(pointerStartsInScreenEdge(0, 390, 0), false);
  assert.equal(pointerStartsInScreenEdge(Number.NaN, 390, SWIPE_EDGE_INSET_PX), false);
  // x=550 of a 1280px viewport is inside the card, not the 24px band.
  assert.equal(pointerStartsInScreenEdge(550, 1280, SWIPE_EDGE_INSET_PX), false);
  // A scaled x larger than the CSS viewport must not be treated as the right edge.
  assert.equal(pointerStartsInScreenEdge(550, 390, SWIPE_EDGE_INSET_PX), false);
  assert.equal(pointerStartsInScreenEdge(1270, 1280, SWIPE_EDGE_INSET_PX), true);
});

test("a vertical drag is not claimed, and a sideways drag is", () => {
  assert.equal(claimPointerAxis(0, 150), "vertical");
  assert.equal(claimPointerAxis(4, 80), "vertical");
  assert.equal(claimPointerAxis(80, 10), "horizontal");
  assert.equal(claimPointerAxis(8, 6), "pending");
  assert.equal(claimPointerAxis(12, 12), "vertical");
});

test("swipe navigation yields before starting a drag on every detail pager", () => {
  const navigator = readFileSync(
    new URL("../client/src/components/vote/SwipeNavigator.tsx", import.meta.url),
    "utf8",
  );
  const yieldAt = navigator.indexOf("pointerTargetYieldsSwipeNav");
  const startAt = navigator.indexOf("dragControls.start");
  assert.ok(yieldAt > 0 && startAt > yieldAt);
  assert.match(navigator, /touchAction: "pan-y"/);

  for (const file of ["PollDetailPage.tsx", "MatchupDetailPage.tsx", "OpinionPollDetailPage.tsx"]) {
    const src = readFileSync(new URL(`../client/src/pages/${file}`, import.meta.url), "utf8");
    const open = src.indexOf("<SwipeNavigator");
    const close = src.indexOf("</SwipeNavigator>");
    const related = src.indexOf("<RelatedVoteItems");
    assert.ok(open >= 0 && close > open, `${file} should wrap content in SwipeNavigator`);
    assert.ok(related > open && related < close, `${file} carousel should sit inside the swipe surface`);
  }
});
