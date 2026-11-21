/**
 * Full-screen discussion (CommentsFocusShell) on a phone.
 *
 * iOS Safari often delivers a tap on a textarea inside a fixed dialog to
 * the page underneath, and focusing that field scrolls the document so the
 * keyboard can "reveal" it. The vote feed follows document scroll and only
 * keeps a window of cards mounted, so that scroll unmounts the card that
 * opened the discussion — the screen closes and the feed is no longer on
 * that card. These helpers decide when to catch the stray tap, when the
 * feed should ignore scroll, and how to keep the composer above the keyboard.
 */

export const DISCUSSION_SHELL_OPEN_ATTR = "data-discussion-shell-open";

/** Mark portaled sheets that sit on top of the discussion (comment ⋮ menu). */
export const ABOVE_DISCUSSION_ATTR = "data-above-discussion";

/**
 * Scrollable regions outside the shell that the keyboard must not move.
 * Tailwind classes used by the vote feed's window and the snap columns.
 */
export const DISCUSSION_SCROLLER_SELECTOR =
  ".overflow-y-auto, .overflow-auto, .overflow-y-scroll, .snap-y";

/** Same band as the keyboard helpers: smaller drops are the browser chrome. */
export const DISCUSSION_KEYBOARD_THRESHOLD_PX = 150;

const NAME_TITLE =
  /^(the|a|an|dj|mc|dr\.?|mr\.?|mrs\.?|ms\.?|sir|lady|lord|st\.?)$/i;

export interface ViewportBox {
  top: number;
  bottom: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * First name for a normal "First Last" (or "First M. Last") person.
 * Single-word names, title-led names (The Weeknd, DJ Khaled), and longer
 * names (bands, "Red Hot Chili Peppers") stay whole. The field also
 * ellipsizes so whatever remains stays on one line.
 */
export function discussionPlaceholderName(fullName: string): string {
  const name = fullName.trim().replace(/\s+/g, " ");
  const parts = name.split(" ").filter(Boolean);
  if (parts.length < 2) return name;
  if (NAME_TITLE.test(parts[0] ?? "")) return name;
  if (!/^[\p{L}]/u.test(parts[0] ?? "")) return name;
  if (parts.length === 2) return parts[0] ?? name;
  if (parts.length === 3 && /^[\p{L}]\.?$/u.test(parts[1] ?? "")) return parts[0] ?? name;
  return name;
}

export function isDiscussionShellOpen(
  root: { documentElement?: { hasAttribute(name: string): boolean } | null } | null | undefined =
    typeof document === "undefined" ? undefined : document,
): boolean {
  return !!root?.documentElement?.hasAttribute(DISCUSSION_SHELL_OPEN_ATTR);
}

/**
 * Pin the shell to the visual viewport while the keyboard (or a large pan)
 * covers the layout viewport. Small URL-bar deltas stay on the normal
 * `inset-0` box so we don't fight the safe-area header.
 */
export function discussionShellViewportBox(metrics: {
  innerHeight: number;
  visualHeight: number;
  offsetTop: number;
  keyboardThreshold?: number;
}): ViewportBox | null {
  const threshold = metrics.keyboardThreshold ?? DISCUSSION_KEYBOARD_THRESHOLD_PX;
  const top = Math.max(0, metrics.offsetTop);
  const overlap = metrics.innerHeight - (metrics.offsetTop + metrics.visualHeight);
  if (overlap <= threshold && top <= threshold) return null;
  return {
    top: Math.round(top),
    bottom: Math.max(0, Math.round(overlap)),
  };
}

export function pointInsideRect(x: number, y: number, rect: Rect, slop = 0): boolean {
  return (
    x >= rect.left - slop &&
    x <= rect.right + slop &&
    y >= rect.top - slop &&
    y <= rect.bottom + slop
  );
}

/**
 * A tap whose hit target is the page behind the shell, but whose coordinates
 * are on the shell. That is the iOS form-control miss: catch it instead of
 * letting the dialog treat it as an outside click.
 * Layers that are meant to sit on top (another dialog, the ⋮ sheet) are not
 * recovered — they own the tap.
 */
export function shouldRecoverDiscussionPointer(args: {
  targetInsideShell: boolean;
  targetAboveShell: boolean;
  clientX: number;
  clientY: number;
  shellRect: Rect;
}): boolean {
  if (args.targetInsideShell || args.targetAboveShell) return false;
  return pointInsideRect(args.clientX, args.clientY, args.shellRect);
}

let pinGeneration = 0;

/** Bump so a shell that just closed cannot restore scroll over a new one. */
export function nextDiscussionPinGeneration(): number {
  pinGeneration += 1;
  return pinGeneration;
}

export function discussionPinStillCurrent(token: number): boolean {
  return token === pinGeneration;
}
