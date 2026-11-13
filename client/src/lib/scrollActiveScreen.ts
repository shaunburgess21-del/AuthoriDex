/**
 * Re-tap of the active bottom tab, iOS only.
 *
 * The tab screens themselves scroll the window:
 *   Home `/`, Vote `/vote`, Predict `/predict`, Voices `/voices`, Insights `/insights`.
 * An open panel scrolls instead, because that is the container the user sees:
 *   Home Compare Momentum — `fixed inset-0 overflow-y-auto`
 *   Predict view-all — `[data-testid="overlay-view-all"]`
 *   Person polls — `[data-testid="overlay-view-all-polls"]`
 *   Vote hub sheets — the `overflow-y-auto` pane inside the open overlay
 * The walker starts at the middle of the screen (clear of the header and the
 * tab bar) and uses the innermost vertical scroller. Website and Android
 * never call this.
 */

export function shouldScrollTabOnReselect(
  native: boolean,
  platform: string,
  tabActive: boolean,
): boolean {
  return tabActive && native && platform === "ios";
}

export interface ScrollMetrics {
  overflowY: string;
  scrollHeight: number;
  clientHeight: number;
}

/** A vertical scroller, not a horizontal chip row that only overflows in x. */
export function boxScrolls(box: ScrollMetrics): boolean {
  const mode = box.overflowY;
  if (mode !== "auto" && mode !== "scroll" && mode !== "overlay") return false;
  return box.scrollHeight > box.clientHeight + 1;
}

/**
 * Index of the innermost scrollable box. The chain is the hit element first,
 * then each ancestor toward the document. `-1` means the window scrolls.
 */
export function innermostScrollableIndex(chainFromHit: ScrollMetrics[]): number {
  return chainFromHit.findIndex(boxScrolls);
}

function elementScrolls(el: HTMLElement, view: Window): boolean {
  const style = view.getComputedStyle(el);
  return boxScrolls({
    overflowY: style.overflowY,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  });
}

/** The panel under the middle of the screen, or null when the window scrolls. */
export function findActiveScrollContainer(doc: Document): HTMLElement | null {
  const view = doc.defaultView;
  if (!view) return null;
  const x = Math.max(0, Math.floor(view.innerWidth / 2));
  const y = Math.min(
    Math.max(0, view.innerHeight - 96),
    Math.max(96, Math.floor(view.innerHeight / 2)),
  );
  let node: Element | null = doc.elementFromPoint(x, y);
  while (node && node !== doc.body && node !== doc.documentElement) {
    if (node instanceof view.HTMLElement && elementScrolls(node, view)) return node;
    node = node.parentElement;
  }
  return null;
}

export function scrollActiveScreenToTop(doc: Document = document): void {
  const view = doc.defaultView;
  if (!view) return;
  const scroller = findActiveScrollContainer(doc);
  const target = scroller ?? view;
  target.scrollTo({ top: 0, left: 0, behavior: "smooth" });
}
