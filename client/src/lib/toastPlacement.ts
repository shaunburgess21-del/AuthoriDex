/** Sit below the sticky site header (h-16) so a toast is not painted on the nav. */
export const TOAST_TOP_OFFSET = "4.75rem";

/**
 * Wide layouts shift the centered toast left by this amount so the
 * leaderboard Rate column (right edge) stays clickable.
 */
export const TOAST_RATE_COLUMN_SHIFT = "4.25rem";

/** Dialogs use z-50. Toasts stay under them so a streak card cannot cover Rate. */
export const TOAST_Z_INDEX = 40;
