/**
 * Toasts paint above sticky chrome and clear it vertically.
 *
 * Site header and the bottom tab bar are z-50. Vote / Predict / Voices
 * sub-bars are z-40. A toast at z-40 was covered by both, which cut off
 * the description ("Your Sentiment Poll vote has been…"). Dialogs sit at
 * z-70 so a card still cannot cover the 1–5 Rate dialog.
 */
export const TOAST_Z_INDEX = 55;

/** Shared dialogs, sheets, and drawers. Toasts stay under this. */
export const DIALOG_Z_INDEX = 70;

/**
 * Fallback top offset (header height + a gap) before the live sticky
 * stack is measured. The toaster adds the safe-area inset in CSS.
 */
export const TOAST_TOP_OFFSET = "4.75rem";

/** 4.75rem at the default 16px root. Measurement never sits higher than this. */
export const TOAST_TOP_MIN_CLEARANCE_PX = 76;

/** Gap between the lowest sticky bar and the toast. */
export const TOAST_TOP_GAP_PX = 8;

/**
 * Wide layouts shift the centered toast left by this amount so the
 * leaderboard Rate column (right edge) stays clickable.
 */
export const TOAST_RATE_COLUMN_SHIFT = "4.25rem";

export interface StickyRect {
  top: number;
  bottom: number;
  height: number;
}

/**
 * Lowest edge of sticky chrome that is actually in the top of the viewport.
 * A bar further down the page (not stuck) does not push the toast.
 */
export function clearanceBelowSticky(rects: StickyRect[]): number {
  let bottom = 0;
  for (const rect of rects) {
    if (rect.height <= 0 || rect.height > 180) continue;
    if (rect.top > 160) continue;
    if (rect.bottom <= 0) continue;
    if (rect.bottom > bottom) bottom = rect.bottom;
  }
  return bottom;
}

function safeAreaTopPx(): number {
  if (typeof document === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--safe-area-inset-top")
    .trim();
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

/** Sticky header, sub-bars, and the site banner, in viewport coordinates. */
export function readStickyRects(): StickyRect[] {
  if (typeof document === "undefined") return [];
  const nodes = document.querySelectorAll(
    "header.sticky, .sticky.top-16, [data-testid='site-banner']",
  );
  const rects: StickyRect[] = [];
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return;
    const box = node.getBoundingClientRect();
    if (box.width < 8) return;
    rects.push({ top: box.top, bottom: box.bottom, height: box.height });
  });
  return rects;
}

/**
 * Pixel `top` for a desktop toast, with the safe-area inset removed
 * because index.css adds that inset back. Always at least the header gap.
 */
export function measuredToastTopClearance(): number {
  const covered = clearanceBelowSticky(readStickyRects());
  const inset = safeAreaTopPx();
  const cleared = Math.max(0, covered - inset) + TOAST_TOP_GAP_PX;
  return Math.round(Math.max(TOAST_TOP_MIN_CLEARANCE_PX, cleared));
}
