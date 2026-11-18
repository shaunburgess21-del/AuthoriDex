/**
 * Distinguishes a real "Browse … Full Screen" tap from the ghost pointer
 * release iOS (and mobile Safari) fire after the category drawer closes.
 *
 * Vaul calls `setPointerCapture` on pointerdown. WKWebView then often drops
 * the button `click` and, once the sheet unmounts, retargets the leftover
 * pointerup/click at the overlay. That overlay path is a passive dismiss and
 * used to clear the intent token before the deferred snap open could consume
 * it, so the sheet closed and full-screen browse never opened.
 *
 * A press that starts on the Browse row is held until that gesture commits or
 * is cancelled. A committed browse survives the passive dismiss that follows
 * the sheet closing. Outside taps never begin a press, so they still clear a
 * stray token and cannot open the snap view.
 */

export const BROWSE_INTENT_TOKEN_MS = 1000;
export const PASSIVE_DISMISS_SUPPRESSION_MS = 300;
/** Matches vaul's touch swipe-start threshold so a drag-to-dismiss is not a tap. */
export const BROWSE_TAP_SLOP_PX = 10;

let now = () => Date.now();
let browseIntentExpiresAt = 0;
let browseIntentTimeout: ReturnType<typeof setTimeout> | null = null;
let browsePressActive = false;
let browseCommitted = false;
let passiveDismissSuppressedUntil = 0;
let passiveDismissTimeout: ReturnType<typeof setTimeout> | null = null;

function clearCategoryPillBrowseIntent() {
  browseIntentExpiresAt = 0;
  browsePressActive = false;
  browseCommitted = false;
  if (browseIntentTimeout !== null) {
    clearTimeout(browseIntentTimeout);
    browseIntentTimeout = null;
  }
}

export function markCategoryPillBrowseIntent() {
  browseIntentExpiresAt = now() + BROWSE_INTENT_TOKEN_MS;
  if (browseIntentTimeout !== null) {
    clearTimeout(browseIntentTimeout);
  }
  browseIntentTimeout = setTimeout(clearCategoryPillBrowseIntent, BROWSE_INTENT_TOKEN_MS);
}

/** Pointer/touch went down on the Browse row. Held across the drawer's dismiss events. */
export function beginCategoryPillBrowsePress() {
  browsePressActive = true;
  markCategoryPillBrowseIntent();
}

export function hasCategoryPillBrowseIntent(): boolean {
  if (now() <= browseIntentExpiresAt) return true;
  clearCategoryPillBrowseIntent();
  return false;
}

/**
 * The Browse row accepted the gesture (pointerup/touchend inside the slop, or
 * a click that was not a dragged release). Passive dismiss must not eat it.
 */
export function commitCategoryPillBrowse() {
  browseCommitted = true;
  browsePressActive = false;
  markCategoryPillBrowseIntent();
}

/** Dragged off the row, or the pointer was cancelled. Do not open snap view. */
export function cancelCategoryPillBrowsePress() {
  clearCategoryPillBrowseIntent();
}

export function consumeCategoryPillBrowseIntent(): boolean {
  const hasIntent = hasCategoryPillBrowseIntent();
  clearCategoryPillBrowseIntent();
  return hasIntent;
}

export function isCategoryPillDrawerDismissSuppressed(): boolean {
  return now() < passiveDismissSuppressedUntil;
}

export function markCategoryPillPassiveDismiss() {
  if (!browseCommitted && !browsePressActive) {
    clearCategoryPillBrowseIntent();
  }
  passiveDismissSuppressedUntil = now() + PASSIVE_DISMISS_SUPPRESSION_MS;
  if (passiveDismissTimeout !== null) {
    clearTimeout(passiveDismissTimeout);
  }
  passiveDismissTimeout = setTimeout(() => {
    passiveDismissSuppressedUntil = 0;
    passiveDismissTimeout = null;
  }, PASSIVE_DISMISS_SUPPRESSION_MS);
}

export function isBrowseTapWithinSlop(
  start: { x: number; y: number } | null,
  end: { x: number; y: number },
  slop = BROWSE_TAP_SLOP_PX,
): boolean {
  if (!start) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy <= slop * slop;
}

/** Test-only clock. Pass null to restore Date.now. */
export function setCategoryPillBrowseIntentClockForTests(clock: (() => number) | null) {
  now = clock ?? (() => Date.now());
}

/** Test-only. Drops module state and pending timers so node can exit. */
export function resetCategoryPillBrowseIntentForTests() {
  clearCategoryPillBrowseIntent();
  passiveDismissSuppressedUntil = 0;
  if (passiveDismissTimeout !== null) {
    clearTimeout(passiveDismissTimeout);
    passiveDismissTimeout = null;
  }
  now = () => Date.now();
}
