const OVERLAY_DISMISS_SUPPRESSION_MS = 300;

let suppressedUntil = 0;
let suppressTimeout: number | null = null;

/** Arm a short window where snap/card-tap handlers should ignore ghost clicks after dialog dismiss. */
export function markOverlayDismissSuppress() {
  suppressedUntil = Date.now() + OVERLAY_DISMISS_SUPPRESSION_MS;
  if (suppressTimeout !== null) {
    window.clearTimeout(suppressTimeout);
  }
  suppressTimeout = window.setTimeout(() => {
    suppressedUntil = 0;
    suppressTimeout = null;
  }, OVERLAY_DISMISS_SUPPRESSION_MS);
}

export function isOverlayDismissSuppressed(): boolean {
  return Date.now() < suppressedUntil;
}
