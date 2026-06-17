/**
 * Client-side streak toast configuration. The numeric / behavioural
 * constants (cycle length, milestone days, milestone XP) are owned by `shared/streak-config.ts` so the server, the
 * notifications cron, and the UI cannot drift apart. This module only
 * adds UI-flavoured timing and copy.
 */

export {
  STREAK_MILESTONES,
  STREAK_MILESTONE_XP,
  STREAK_TARGET_DAYS,
  getNextMilestone,
  getStreakToastTimeline,
  streakMilestoneActionKey,
  type StreakMilestone,
  type StreakToastTimeline,
} from "@shared/streak-config";

import { STREAK_MILESTONES } from "@shared/streak-config";

/**
 * Days inside the current cycle that get warmer "celebration" copy.
 * Mirrors the canonical milestone list — re-exported here under the
 * older name so existing imports continue to compile.
 */
export const STREAK_MILESTONE_DAYS: readonly number[] = STREAK_MILESTONES;

/** Always-shown line nudging the user toward Vox-earning actions. */
export const STREAK_REWARD_TEASE = "Take action on the site to earn Vox.";

/** Shown only while the user is still working toward the next milestone. */
export const STREAK_TARGET_REWARD_COPY =
  "Hit your next milestone to unlock bonus XP.";

/** Sonner duration in ms — long enough to read timeline dots + milestone copy. */
export const STREAK_TOAST_DURATION_MS = 8000;

/** Sonner `--width` and StreakToast card width — keep in sync. */
export const STREAK_TOAST_WIDTH_CSS = "min(384px, calc(100vw - 1rem))";

/**
 * Delay between the XP burst (viewport-center floater) and the toast
 * (top-center card). Lets the eye register the burst first, then read
 * the context, instead of both elements competing for attention at t=0.
 */
export const STREAK_TOAST_DELAY_MS = 400;
