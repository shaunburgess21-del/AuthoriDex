/**
 * Daily-login streak toast configuration.
 *
 * Single source of truth so tuning the cycle length, milestones, or copy is
 * a one-file change — no JSX edits required. Aligns with the server-side
 * milestone notifications in server/jobs/notifications-derivation.ts which
 * fire at days [3, 7, 14, 30, 100]; the toast cycle currently mirrors the
 * first weekly cadence.
 */

/** Length of the visible dot row on the streak toast (last node is the gift). */
export const STREAK_TARGET_DAYS = 7;

/**
 * Days inside the current cycle that get warmer "celebration" copy. Kept in
 * sync conceptually with `STREAK_MILESTONES` in
 * server/jobs/notifications-derivation.ts.
 */
export const STREAK_MILESTONE_DAYS: readonly number[] = [3, 7];

/** Always-shown line nudging the user toward credit-earning actions. */
export const STREAK_REWARD_TEASE = "Take action on the site to earn Credits.";

/** Shown only while the user is still working toward `STREAK_TARGET_DAYS`. */
export const STREAK_TARGET_REWARD_COPY =
  "Hit a 7-day streak and unlock a milestone reward.";

/** Sonner duration in ms — slightly longer than default so users can read the dots + copy. */
export const STREAK_TOAST_DURATION_MS = 5500;

/**
 * Delay between the XP burst (viewport-center floater) and the toast (top-
 * center card). Lets the eye register the burst first, then read the
 * context, instead of both elements competing for attention at t=0.
 */
export const STREAK_TOAST_DELAY_MS = 400;
