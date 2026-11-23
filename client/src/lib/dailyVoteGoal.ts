/**
 * Daily vote goal on the returning-user strip (item 47).
 *
 * Day boundary — the same one the streak uses.
 * `server/route-modules/gamification-routes.ts` stores `profiles.last_login_date`
 * as `utcDateString()`: `toISOString().split("T")[0]`, a UTC calendar date.
 * The streak day closes at the next UTC midnight. `streakDayKey` is that
 * same `YYYY-MM-DD`. A ballot counts as "today" only when its `createdAt`
 * falls on that UTC date, so the goal and the streak cannot disagree about
 * which day is open.
 *
 * Count. The vote cards already on /vote expose the current choice, not when
 * it was cast, so they cannot answer "voted today". Reconciliation reads the
 * existing `GET /api/me/votes` payload (the list My Votes already uses). That
 * route returns the 50 most recent ballots, newest first. Today's rows are
 * the newest, so a goal of 5 is not hidden behind older ballots. A day with
 * more than 50 ballots can under-count; once 5 are visible the ring still
 * reads done. There is no lighter existing payload whose clock matches this
 * UTC day (`/api/gamification/daily-summary` groups XP ledger rows from
 * server-local midnight and skips votes that did not award XP).
 *
 * Amber reminder — exact rule, for the owner to confirm.
 * Show "Streak ends tonight" only when every line below is true:
 *   1. current streak is 1 or more
 *   2. votes on the current UTC streak day is 0
 *   3. now is strictly before the next UTC midnight (`cutoff`)
 *   4. either the cutoff is less than 6 hours away, or now is at or after
 *      the most recent local 18:00, that 18:00 is still before `cutoff`,
 *      and `cutoff` is at most 18 hours after that 18:00 (it falls at or
 *      before the next local noon — tonight or tomorrow morning).
 * At the cutoff the chip turns off. It does not come back at local 18:00
 * when that 18:00 is already after the UTC midnight that ended the day
 * (Los Angeles: cutoff is 16:00 PST, so 18:00 local stays quiet and the
 * warning instead runs for the last 6 hours, from 10:00 local). East of
 * UTC the cutoff is after local midnight (02:00 in South Africa), so the
 * chip stays on from 18:00 local through local midnight until 02:00,
 * including the hours when the clock is no longer 18:00. The first vote
 * on the UTC day clears it. In-app only.
 */

import { streakStripLabel } from "@/lib/returningUserStrip";

export const DAILY_VOTE_GOAL = 5;
export const ME_VOTES_QUERY_KEY = ["/api/me/votes"] as const;
export const STREAK_ENDS_TONIGHT_LABEL = "Streak ends tonight";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Final approach to the UTC cutoff that turns the chip amber even before 18:00 local. */
export const STREAK_REMINDER_LEAD_MS = 6 * HOUR_MS;

/**
 * Local 18:00 counts only when the cutoff is still within this span
 * (18:00 local through the next local noon).
 */
export const STREAK_REMINDER_EVENING_SPAN_MS = 18 * HOUR_MS;

/** UTC `YYYY-MM-DD`, identical to the streak writer's `utcDateString`. */
export function streakDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The UTC midnight that ends the streak day containing `now`. Exact midnight starts the next day. */
export function nextUtcMidnightMs(now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const next = start + DAY_MS;
  return now.getTime() < next ? next : next + DAY_MS;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedDateTimeParts(date: Date, timeZone: string): ZonedParts | null {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const parts = {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
  if (!Object.values(parts).every((n) => Number.isFinite(n))) return null;
  return parts;
}

/** UTC millis of a wall-clock time in `timeZone`. Returns null when the zone is invalid. */
function utcMsForLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number | null {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const parts = zonedDateTimeParts(new Date(utc), timeZone);
    if (!parts) return null;
    const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const want = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = want - got;
    if (diff === 0) return utc;
    utc += diff;
  }
  return utc;
}

/** Most recent `hour:minute` in `timeZone` at or before `now`. */
export function mostRecentLocalClockMs(
  now: Date,
  timeZone: string,
  hour: number,
  minute: number,
): number | null {
  const date = zonedDateTimeParts(now, timeZone);
  if (!date) return null;
  let utc = utcMsForLocal(date.year, date.month, date.day, hour, minute, timeZone);
  if (utc == null) return null;
  if (utc > now.getTime()) {
    const prev = zonedDateTimeParts(new Date(utc - 20 * HOUR_MS), timeZone);
    if (!prev) return null;
    utc = utcMsForLocal(prev.year, prev.month, prev.day, hour, minute, timeZone);
  }
  return utc;
}

export function streakReminderActive(input: {
  now: Date;
  timeZone: string;
  streak: number;
  votesToday: number;
}): boolean {
  const streakDays = Number.isFinite(input.streak) ? Math.floor(input.streak) : 0;
  if (streakDays < 1) return false;
  if (!Number.isFinite(input.votesToday) || input.votesToday > 0) return false;
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) return false;
  const cutoff = nextUtcMidnightMs(input.now);
  const remaining = cutoff - nowMs;
  if (remaining <= 0) return false;
  if (remaining < STREAK_REMINDER_LEAD_MS) return true;
  const local18 = mostRecentLocalClockMs(input.now, input.timeZone, 18, 0);
  if (local18 == null || nowMs < local18) return false;
  const eveningCutoff = nextUtcMidnightMs(new Date(local18));
  if (nowMs >= eveningCutoff) return false;
  if (eveningCutoff - local18 > STREAK_REMINDER_EVENING_SPAN_MS) return false;
  return true;
}

export function streakChipLabel(streak: number, reminder: boolean): string {
  if (reminder) return STREAK_ENDS_TONIGHT_LABEL;
  return streakStripLabel(streak);
}

export interface DailyGoalCopy {
  /** "2 of 5 votes today" / "Goal done, streak safe". */
  full: string;
  /** "2 of 5" / "Goal done". Used when the full sentence does not fit. */
  mid: string;
  /** "2/5" / "Done". Used only when `mid` still overflows the row. */
  tight: string;
  ariaLabel: string;
  done: boolean;
}

export function dailyGoalCopy(count: number, goal: number = DAILY_VOTE_GOAL): DailyGoalCopy {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const done = safe >= goal;
  if (done) {
    return {
      full: "Goal done, streak safe",
      mid: "Goal done",
      tight: "Done",
      ariaLabel: "Daily goal: done, streak safe",
      done: true,
    };
  }
  return {
    full: `${safe} of ${goal} votes today`,
    mid: `${safe} of ${goal}`,
    tight: `${safe}/${goal}`,
    ariaLabel: `Daily goal: ${safe} of ${goal} votes today`,
    done: false,
  };
}

export const DAILY_GOAL_UNAVAILABLE_LABEL = "Daily goal unavailable";

/** `createdAt` strings from a `GET /api/me/votes` JSON array. Non-rows are skipped. */
export function createdAtsFromMeVotes(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || !("createdAt" in item)) continue;
    const value = (item as { createdAt?: unknown }).createdAt;
    if (typeof value === "string" && value.length > 0) {
      out.push(value);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out.push(new Date(value).toISOString());
    }
  }
  return out;
}

/** Ballots whose timestamp falls on the UTC streak day that contains `now`. */
export function countVotesOnStreakDay(createdAts: readonly string[], now: Date): number {
  const day = streakDayKey(now);
  let count = 0;
  for (const at of createdAts) {
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) continue;
    if (streakDayKey(new Date(ms)) === day) count += 1;
  }
  return count;
}

export function countMeVotesOnStreakDay(data: unknown, now: Date): number {
  return countVotesOnStreakDay(createdAtsFromMeVotes(data), now);
}

/** One optimistic ballot so the ring moves before the refetch replaces the cache. */
export function appendOptimisticMeVote(data: unknown, at: Date): unknown[] {
  const rows = Array.isArray(data) ? data.slice() : [];
  rows.push({
    id: `optimistic-${at.getTime()}-${rows.length}`,
    createdAt: at.toISOString(),
    voteType: "optimistic",
  });
  return rows;
}

const DAILY_GOAL_VOTE_PATHS: readonly RegExp[] = [
  /^\/api\/matchups\/[^/]+\/vote$/,
  /^\/api\/opinion-polls\/[^/]+\/vote$/,
  /^\/api\/polls\/[^/]+\/vote$/,
  /^\/api\/people\/[^/]+\/images\/[^/]+\/vote$/,
  /^\/api\/vote\/induction\/[^/]+\/vote$/,
  /^\/api\/celebrity\/[^/]+\/approval-rating$/,
  /^\/api\/celebrity\/[^/]+\/value-vote$/,
  /^\/api\/sentiment-votes$/,
];

function requestPath(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      return new URL(trimmed).pathname;
    } catch {
      return trimmed.split("?")[0] ?? trimmed;
    }
  }
  return trimmed.split("?")[0] ?? trimmed;
}

function bodyRemovesVote(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && "remove" in body && (body as { remove?: unknown }).remove === true);
}

/**
 * A successful signed-in vote POST that should move the goal. Removals,
 * comment upvotes, suggestion votes, and admin routes are not goal votes.
 */
export function isDailyGoalVoteRequest(method: string, url: string, body: unknown): boolean {
  if (method.toUpperCase() !== "POST") return false;
  const path = requestPath(url);
  if (!DAILY_GOAL_VOTE_PATHS.some((pattern) => pattern.test(path))) return false;
  if (bodyRemovesVote(body)) return false;
  return true;
}

const listeners = new Set<() => void>();

/** Notify the strip after the server has accepted a goal vote. Never throws. */
export function noteOptimisticDailyVote(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[daily-vote-goal] listener failed", err);
    }
  }
}

export function subscribeDailyVoteGoal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
