/**
 * Which edges of a horizontal scroller still have content off-screen.
 * "start" means the user is at the left edge (fade the right).
 * "end" means the user is at the right edge (fade the left).
 * "both" means content is clipped on both sides.
 */
export type ScrollEdge = "none" | "start" | "end" | "both";

export interface ScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export function measureScrollEdge(metrics: ScrollMetrics, epsilon = 2): ScrollEdge {
  const maxScroll = metrics.scrollWidth - metrics.clientWidth;
  if (maxScroll <= epsilon) return "none";
  const atStart = metrics.scrollLeft <= epsilon;
  const atEnd = metrics.scrollLeft >= maxScroll - epsilon;
  if (atStart && atEnd) return "none";
  if (atStart) return "start";
  if (atEnd) return "end";
  return "both";
}

/** CSS mask class from index.css. Empty when nothing is clipped. */
export function scrollEdgeMaskClass(edge: ScrollEdge): string {
  if (edge === "start") return "scroll-mask-right";
  if (edge === "end") return "scroll-mask-left";
  if (edge === "both") return "scroll-mask-both";
  return "";
}
