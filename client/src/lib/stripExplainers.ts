/**
 * Copy and open/close state for the returning-user strip explainers.
 *
 * The sentences follow the live rules, not the first draft:
 * - Streak: POST /api/gamification/daily-checkin is the only writer.
 *   useDailyCheckin fires it when a signed-in session loads the app.
 *   A vote does not advance last_login_date. Missing a UTC day resets
 *   the next check-in to 1 (gamification-routes.ts). The day boundary
 *   is UTC midnight, shown in the viewer's zone.
 * - XP: voting, predicting, commenting, and the daily login / streak
 *   awards in XP_ACTIONS. Rank thresholds come from shared/rank-config.
 *   Reaching the next rank does not unlock a badge (only tiers 7 and 8
 *   award rank badges, and capability gates are empty).
 * - Votes today: DAILY_VOTE_GOAL ballots on the UTC streak day from
 *   GET /api/me/votes. Image curation is one of those ballots.
 */

import { DAILY_VOTE_GOAL, nextUtcMidnightMs } from "@/lib/dailyVoteGoal";
import { xpRankProgress, xpRankProgressLabel } from "@/lib/returningUserStrip";

export type StripExplainerId = "streak" | "xp" | "goal";

/** Same cache key as useUserStats. Invalidating it refetches the strip's XP. */
export const STRIP_XP_QUERY_KEY = ["/api/gamification/stats"] as const;

export interface StripExplainerCopy {
  id: StripExplainerId;
  title: string;
  /** The viewer's current value, one line. */
  value: string;
  /** One or two sentences. */
  body: string;
}

export type StripExplainerEvent =
  | { type: "open"; id: StripExplainerId }
  | { type: "close"; id: StripExplainerId }
  | { type: "dismiss" };

/**
 * One explainer at a time. Opening one replaces whatever is open.
 * A close for a different id is ignored so a stale close from the
 * previous popover cannot blank the one that just opened.
 */
export function reduceStripExplainer(
  current: StripExplainerId | null,
  event: StripExplainerEvent,
): StripExplainerId | null {
  if (event.type === "dismiss") return null;
  if (event.type === "open") return event.id;
  return current === event.id ? null : current;
}

/** UTC midnight that ends the current streak day, formatted in `timeZone`. */
export function formatStreakResetLocal(
  now: Date,
  timeZone: string,
  locales?: Intl.LocalesArgument,
): string {
  const resetAt = new Date(nextUtcMidnightMs(now));
  const format = (zone: string) =>
    new Intl.DateTimeFormat(locales, {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(resetAt);
  const zone = timeZone.trim();
  try {
    return format(zone.length > 0 ? zone : "UTC");
  } catch {
    return format("UTC");
  }
}

export function streakExplainerCopy(
  streakDays: number,
  now: Date,
  timeZone: string,
  locales?: Intl.LocalesArgument,
): StripExplainerCopy {
  const days = Number.isFinite(streakDays) && streakDays > 0 ? Math.floor(streakDays) : 0;
  const resetAt = formatStreakResetLocal(now, timeZone, locales);
  const value = days <= 0 ? "No streak yet" : days === 1 ? "1 day in a row" : `${days} days in a row`;
  const body =
    days <= 0
      ? `Log in to start a streak, then come back the next day to build it. The day resets at ${resetAt}.`
      : `Log in each day to keep it going — miss a day and it starts over at 1. The day resets at ${resetAt}.`;
  return { id: "streak", title: "Streak", value, body };
}

/** Voting, predicting, commenting, and the daily check-in. No badge unlock. */
export const XP_EARN_SENTENCE =
  "You earn XP by voting, predicting, commenting, and logging in to keep your streak.";

export function xpExplainerCopy(xp: number): StripExplainerCopy {
  const progress = xpRankProgress(xp);
  return {
    id: "xp",
    title: "XP",
    value: xpRankProgressLabel(progress),
    body: XP_EARN_SENTENCE,
  };
}

/**
 * Surfaces that land on GET /api/me/votes and move the daily goal:
 * matchups, sentiment and opinion polls, induction, profile-photo
 * picks, and ratings. Comment votes do not.
 */
export const GOAL_COUNTS_SENTENCE =
  "Matchups, sentiment and opinion polls, induction votes, profile-photo picks, and ratings all count.";

export function goalExplainerCopy(
  count: number | null,
  goal: number = DAILY_VOTE_GOAL,
): StripExplainerCopy {
  if (count == null || !Number.isFinite(count)) {
    return {
      id: "goal",
      title: "Votes today",
      value: "Daily goal unavailable",
      body: "Today's vote count couldn't be loaded.",
    };
  }
  const safe = Math.max(0, Math.floor(count));
  const done = safe >= goal;
  return {
    id: "goal",
    title: "Votes today",
    value: done ? "Goal done" : `${safe} of ${goal} votes today`,
    body: done
      ? `You've hit today's goal of ${goal} votes. ${GOAL_COUNTS_SENTENCE}`
      : `Hit ${goal} votes today to complete your goal. ${GOAL_COUNTS_SENTENCE}`,
  };
}
