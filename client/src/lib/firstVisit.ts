/**
 * First-visit detection for onboarding surfaces (entry nudge, Quick Vote).
 *
 * `voxdex_first_seen_at` is written once, on the first call in the first
 * session. "Is this the first visit?" is decided when the module is first
 * consulted in a tab session and cached, so the answer stays stable for
 * the whole session even after the key is written.
 */

const FIRST_SEEN_AT_KEY = "voxdex_first_seen_at";

let sessionIsFirstVisit: boolean | null = null;

/** Epoch ms of the visitor's first seen moment, stamping it if absent. */
export function ensureFirstSeenAt(): number {
  try {
    const raw = localStorage.getItem(FIRST_SEEN_AT_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        if (sessionIsFirstVisit === null) sessionIsFirstVisit = false;
        return parsed;
      }
    }
    if (sessionIsFirstVisit === null) sessionIsFirstVisit = true;
    const now = Date.now();
    localStorage.setItem(FIRST_SEEN_AT_KEY, String(now));
    return now;
  } catch {
    // Private mode / quota: treat as returning visitor so we never
    // over-trigger onboarding for users we can't track.
    if (sessionIsFirstVisit === null) sessionIsFirstVisit = false;
    return Date.now();
  }
}

/** True for the visitor's very first session (stable within the tab session). */
export function isFirstVisitSession(): boolean {
  ensureFirstSeenAt();
  return sessionIsFirstVisit === true;
}
