/**
 * Window-sash between a snap-scroll vote card and its comments.
 *
 * Drag down reveals the card; drag up collapses it. Releasing past halfway
 * snaps to that side. A press that stays within the slop is a tap and toggles.
 *
 * The view used to apply this only from React touch handlers and then wait
 * for `click` to toggle. WKWebView drops that click (the handle sits in a
 * mandatory snap scroller, `touch-action: none` cancels the synthetic click,
 * and React's touchmove listener is passive so the scroller steals the drag
 * and cancels the touch). The math lives here; the view performs the toggle
 * on touch end and claims the gesture with a non-passive listener.
 */

/** Movement before a press becomes a drag. Same threshold the view used inline. */
export const SASH_DRAG_SLOP_PX = 6;

/** Apple's minimum control size. The painted grip stays the small U-bracket. */
export const SASH_HANDLE_MIN_PX = 44;

export interface SashSession {
  startY: number;
  fullHeight: number;
  startExpanded: boolean;
  moved: boolean;
}

/**
 * Open cards report scrollHeight. A collapsed card (`max-height: 0`) reports
 * 0 in WebKit, so reuse the height measured while it was open.
 */
export function rememberSashFullHeight(
  measured: number,
  cached: number | undefined,
  startExpanded: boolean,
): number {
  if (!startExpanded && measured > 0) return measured;
  return Math.max(measured, cached ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function applySashMove(
  session: SashSession,
  clientY: number,
): { session: SashSession; height: number | null; opacity: number | null } {
  const deltaY = clientY - session.startY;
  const moved = session.moved || Math.abs(deltaY) > SASH_DRAG_SLOP_PX;
  const next: SashSession = moved === session.moved ? session : { ...session, moved };
  if (!moved || session.fullHeight <= 0) {
    return { session: next, height: null, opacity: null };
  }
  const raw = session.startExpanded ? deltaY : session.fullHeight + deltaY;
  const height = clamp(raw, 0, session.fullHeight);
  return { session: next, height, opacity: height / session.fullHeight };
}

export type SashRelease =
  | { type: "tap" }
  | { type: "cancel" }
  | { type: "settle"; cardOpen: boolean };

export function releaseSash(session: SashSession, clientY: number): SashRelease {
  if (!session.moved) return { type: "tap" };
  if (session.fullHeight <= 0) return { type: "cancel" };
  const deltaY = clientY - session.startY;
  const raw = session.startExpanded ? deltaY : session.fullHeight + deltaY;
  const height = clamp(raw, 0, session.fullHeight);
  // Strictly past halfway — a release exactly on the midpoint stays collapsed.
  return { type: "settle", cardOpen: height > session.fullHeight / 2 };
}
