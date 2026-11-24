/**
 * Full-screen category browse (VoteSnapScrollView, non-minimal).
 *
 * Snap pages used to be `height: calc(100dvh - 52px)`. The scroller is not
 * the viewport: it is whatever is left of the fixed shell after the category
 * header (safe-area top + tab row, which is not 52px once the notch is in
 * play). On iOS Safari the shell's `position: fixed; inset: 0` box follows
 * the layout viewport, which extends under the collapsing toolbar, while
 * `100dvh` follows the visual viewport. Those two heights disagree by the
 * toolbar (and by the header error).
 *
 * `scroll-snap-align: start` is only a valid snap position when it lies
 * inside `[0, maxScroll]`. For the last child that means the child must be
 * at least as tall as the scrollport. Intermediate cards still snap — their
 * offsets are in range — but the end-of-category section, the final and
 * shorter child, cannot. The scroller rests on the last card with the end
 * section peeking underneath the browser chrome, so its category chips never
 * come fully on screen.
 *
 * Pages are therefore `height: 100%` of the scrollport (same contract as the
 * minimal / Quick Vote column). The shell itself is `100dvh`, overridden with
 * the visual viewport when iOS reports the layout viewport sticking out past
 * the toolbars, so "100%" is the area the user can actually see — under the
 * category header, above the home indicator, and over the app tab bar.
 */

export const SNAP_KEYBOARD_THRESHOLD_PX = 150;

/** CSS height of the full-variant shell. Tracks Safari / Chrome toolbars. */
export const SNAP_SHELL_HEIGHT = "100dvh";

export interface SnapShellFrame {
  /** Offset from the layout viewport's top, in px. */
  top: number;
  /** Visible height, in px. */
  height: number;
}

/**
 * Visual-viewport rectangle for the snap shell, in layout-viewport
 * coordinates. Null means the CSS `100dvh` box is already the visible area
 * (or the difference is the keyboard, which the shell should not dodge).
 */
export function snapShellFrame(metrics: {
  innerHeight: number;
  visualHeight: number;
  offsetTop: number;
  keyboardThreshold?: number;
}): SnapShellFrame | null {
  const threshold = metrics.keyboardThreshold ?? SNAP_KEYBOARD_THRESHOLD_PX;
  if (metrics.visualHeight <= 0 || metrics.innerHeight <= 0) return null;
  const top = Math.max(0, metrics.offsetTop);
  const overlapBelow = metrics.innerHeight - (metrics.offsetTop + metrics.visualHeight);
  // IME, not a toolbar. `100dvh` already shrinks with the keyboard on iOS;
  // jumping the shell by the keyboard height would sit the deck on top of it.
  if (top > threshold || overlapBelow > threshold) return null;
  if (top < 1 && Math.abs(overlapBelow) < 1) return null;
  return {
    top: Math.round(top),
    height: Math.max(0, Math.round(metrics.visualHeight)),
  };
}

export interface SnapPageBox {
  height: string;
  minHeight: string;
  maxHeight: string;
  boxSizing: "border-box";
  scrollSnapAlign: "start";
  scrollSnapStop?: "always";
  overflow: "hidden";
  paddingBottom?: string;
}

/**
 * One snap child. `100%` / `min` / `max` together keep the border box equal
 * to the scrollport even when the card's comments are taller than the
 * screen — the comments scroller inside the page moves, the page does not
 * grow, and the next snap offset stays exactly one viewport away.
 *
 * The end section opts into `scroll-snap-stop: always` so a fling from the
 * last card lands on it. Its box stays `overflow: hidden` (exactly one
 * scrollport, not a second scroller). A taller chip list scrolls in the
 * inner wrapper, so the snap stride of the cards does not change.
 */
export function fullSnapPageBox(role: "card" | "end" = "card"): SnapPageBox {
  return {
    height: "100%",
    minHeight: "100%",
    maxHeight: "100%",
    boxSizing: "border-box",
    scrollSnapAlign: "start",
    overflow: "hidden",
    ...(role === "end"
      ? { scrollSnapStop: "always" as const }
      : { paddingBottom: "env(safe-area-inset-bottom, 16px)" }),
  };
}

/**
 * True when the end section's snap-start can be reached.
 * `endOffset <= maxScroll` iff the end section is at least as tall as the
 * scrollport (spacer included). A shorter end section is what strands the
 * scroller on the last card.
 */
export function endSnapOffsetReachable(args: {
  cardCount: number;
  cardHeight: number;
  endHeight: number;
  scrollport: number;
  /** Extra px after the end section (subpixel safety). */
  trailing?: number;
}): boolean {
  if (args.scrollport <= 0 || args.cardCount < 0) return false;
  const endOffset = args.cardCount * args.cardHeight;
  const scrollHeight = endOffset + args.endHeight + (args.trailing ?? 0);
  const maxScroll = Math.max(0, scrollHeight - args.scrollport);
  return endOffset <= maxScroll + 0.5;
}
