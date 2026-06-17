/**
 * Shared streak configuration — single source of truth for both server
 * and client. Imported by:
 *
 *   - server/route-modules/gamification-routes.ts (the daily-checkin
 *     endpoint that runs the streak state machine and awards milestone
 *     XP)
 *   - server/jobs/notifications-derivation.ts (milestone notifications)
 *   - server/scripts/seed-gamification.ts (xp_actions seeding for the
 *     per-milestone action keys)
 *   - client/src/lib/streak-config.ts (re-exports + UI-only constants)
 *   - client/src/components/StreakToast.tsx (timeline + milestone copy)
 *   - client/src/pages/HowItWorksPage.tsx (rules explainer + ladder)
 *
 * Touching these constants in any other file would let the system drift
 * the way it did pre-overhaul (notifications fired at [3,7,14,30,100]
 * while the toast cycle wrapped at 7). Always import from here.
 */

/**
 * Days at which a streak earns a one-time bonus XP grant. Crossing one
 * of these days fires:
 *   - a `streak_milestone_<n>` xp_ledger entry (idempotent per user
 *     lifetime — only ever awarded once per milestone level, even if
 *     the user resets and climbs back up later)
 *   - a `streak_milestone` notification
 *   - milestone-flavoured copy on the StreakToast
 *
 * Ordered ascending so consumers can binary-search / pick the next
 * upcoming milestone.
 */
export const STREAK_MILESTONES = [3, 7, 14, 30, 100] as const;

export type StreakMilestone = (typeof STREAK_MILESTONES)[number];

/**
 * XP awarded the first time a user reaches each milestone day. These
 * are *additive* on top of the standard daily_login (10 XP) and
 * streak_bonus (25 XP) the user gets on every consecutive day — i.e.
 * day 7 grants 10 + 100 (no streak_bonus on milestone days; the
 * milestone replaces it, see the daily-checkin handler).
 */
export const STREAK_MILESTONE_XP: Record<StreakMilestone, number> = {
  3: 50,
  7: 100,
  14: 150,
  30: 250,
  100: 500,
};

/**
 * Length of the visible dot row on the streak toast. In rolling mode the
 * row shows this many recent streak days ending at today; in milestone
 * sprint mode it spans the final week before the next reward.
 */
export const STREAK_TARGET_DAYS = 7;

/** Dot-row layout returned by {@link getStreakToastTimeline}. */
export interface StreakToastTimeline {
  start: number;
  end: number;
  giftDay: number | null;
  showGift: boolean;
  pastTopTier: boolean;
}

/**
 * Computes the streak-toast dot row. Rolling mode shows recent days ending
 * at today; milestone sprint mode anchors to the next reward in the
 * final STREAK_TARGET_DAYS-day window.
 */
export function getStreakToastTimeline(currentStreak: number): StreakToastTimeline {
  const milestones = STREAK_MILESTONES as readonly number[];
  const pastTopTier = currentStreak > milestones[milestones.length - 1];
  const isOnMilestone = milestones.includes(currentStreak);
  const nextMilestone = getNextMilestone(currentStreak);

  if (isOnMilestone) {
    const end = currentStreak;
    const start = Math.max(1, end - (STREAK_TARGET_DAYS - 1));
    return {
      start,
      end,
      giftDay: currentStreak,
      showGift: true,
      pastTopTier,
    };
  }

  if (pastTopTier) {
    const end = currentStreak;
    const start = Math.max(1, end - (STREAK_TARGET_DAYS - 1));
    return { start, end, giftDay: null, showGift: false, pastTopTier: true };
  }

  const inMilestoneSprint =
    nextMilestone !== null &&
    currentStreak >= nextMilestone - (STREAK_TARGET_DAYS - 1);

  if (inMilestoneSprint) {
    const end = nextMilestone!;
    const start = Math.max(1, end - (STREAK_TARGET_DAYS - 1));
    return {
      start,
      end,
      giftDay: end,
      showGift: true,
      pastTopTier: false,
    };
  }

  const end = currentStreak;
  const start = Math.max(1, end - (STREAK_TARGET_DAYS - 1));
  return { start, end, giftDay: null, showGift: false, pastTopTier: false };
}

/**
 * Pure helper — returns the next upcoming milestone day strictly
 * greater than `streak`, or null if the user is already past the top
 * of the ladder. Used by the toast and HowItWorks to anchor the
 * "X days to go" copy without the consumer having to know the array.
 */
export function getNextMilestone(streak: number): StreakMilestone | null {
  for (const m of STREAK_MILESTONES) {
    if (streak < m) return m;
  }
  return null;
}

/**
 * Per-milestone xp_ledger action key. Centralised so the seed script,
 * the daily-checkin handler, and any future analytics dashboard agree
 * on the canonical key shape. Pattern: streak_milestone_<n>.
 */
export function streakMilestoneActionKey(day: StreakMilestone): string {
  return `streak_milestone_${day}`;
}
