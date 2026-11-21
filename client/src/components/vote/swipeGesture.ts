/**
 * Decide when a detail-page swipe-to-navigate gesture should yield so a
 * nested horizontal scroller (the "More like this" row, chip strips, etc.)
 * can pan natively.
 *
 * SwipeNavigator listens on an ancestor and starts a framer-motion drag on
 * pointerdown. That drag turns a horizontal pan into prev/next navigation.
 * The surface uses touch-action: pan-y, so the browser does not pan the
 * carousel itself. Yielding before the drag starts leaves the gesture to
 * the scroller.
 */

/** Mark a subtree that must never start detail-page swipe navigation. */
export const NO_SWIPE_NAV_SELECTOR = "[data-no-swipe-nav]";

/**
 * Layout can report a 1px overflow from subpixel rounding. That is not a
 * row the user can pan.
 */
export const HORIZONTAL_OVERFLOW_SLOP_PX = 1;

export function overflowXAllowsPan(overflowX: string): boolean {
  return overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay";
}

export function hasHorizontalOverflow(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth - clientWidth > HORIZONTAL_OVERFLOW_SLOP_PX;
}

export function elementCanScrollHorizontally(el: Element): boolean {
  if (typeof window === "undefined" || typeof HTMLElement === "undefined") return false;
  if (!(el instanceof HTMLElement)) return false;
  if (el.clientWidth <= 0) return false;
  const overflowX = window.getComputedStyle(el).overflowX;
  if (!overflowXAllowsPan(overflowX)) return false;
  return hasHorizontalOverflow(el.scrollWidth, el.clientWidth);
}

export interface SwipeGestureNode {
  matches(selector: string): boolean;
  parentElement: SwipeGestureNode | null;
  canScrollHorizontally(): boolean;
}

/**
 * True when the gesture should not navigate. `boundary` is the swipe
 * surface; markers and scrollers outside it (the page chrome above the
 * navigator, the document itself) are ignored.
 */
export function swipeNavShouldIgnoreGesture(
  target: SwipeGestureNode | null,
  boundary: SwipeGestureNode | null,
  ignoreSelector?: string,
): boolean {
  if (!target) return false;
  const extraSelector = ignoreSelector?.trim() || "";

  let node: SwipeGestureNode | null = target;
  while (node) {
    if (node.matches(NO_SWIPE_NAV_SELECTOR)) return true;
    if (extraSelector && node.matches(extraSelector)) return true;
    if (node.canScrollHorizontally()) return true;
    if (node === boundary) break;
    node = node.parentElement;
  }
  return false;
}

function adaptElement(el: Element, cache: Map<Element, SwipeGestureNode>): SwipeGestureNode {
  const cached = cache.get(el);
  if (cached) return cached;
  const node: SwipeGestureNode = {
    matches(selector: string) {
      return el.matches(selector);
    },
    get parentElement() {
      const parent = el.parentElement;
      return parent ? adaptElement(parent, cache) : null;
    },
    canScrollHorizontally() {
      return elementCanScrollHorizontally(el);
    },
  };
  cache.set(el, node);
  return node;
}

/**
 * DOM entry point used by SwipeNavigator. Returns false for non-elements
 * (and in non-DOM test runners) so a pointerdown still navigates.
 */
export function pointerTargetYieldsSwipeNav(
  target: EventTarget | null,
  boundary: Element,
  ignoreSelector?: string,
): boolean {
  if (typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  const cache = new Map<Element, SwipeGestureNode>();
  return swipeNavShouldIgnoreGesture(
    adaptElement(target, cache),
    adaptElement(boundary, cache),
    ignoreSelector,
  );
}
