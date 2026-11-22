/**
 * This week's Friday 23:59:59.999 UTC and Sunday 23:59:59.999 UTC.
 * Same calendar as `getClientWeekDeadlines` in useMarketCycle — kept
 * here so the panel phase can be tested without loading React.
 */
export function getJackpotWeekDeadlines(now: Date): { friday: Date; sunday: Date } {
  const dayOfWeek = now.getUTCDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const sunday = new Date(now);
  sunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
  sunday.setUTCHours(23, 59, 59, 999);
  if (now > sunday) {
    sunday.setUTCDate(sunday.getUTCDate() + 7);
  }
  const friday = new Date(sunday);
  friday.setUTCDate(friday.getUTCDate() - 2);
  friday.setUTCHours(23, 59, 59, 999);
  return { friday, sunday };
}

/**
 * One phase for the Weekly Jackpot panel.
 *
 * The Predict page sticky bar follows the latest native-market cutoff
 * (Up/Down and H2H stay open until Sunday). Jackpot entries lock on
 * Friday. The panel must not borrow that later clock — badge, status
 * line, and the Enter button all read this result.
 *
 * `prediction_markets.status` stays `OPEN` after the entry cutoff until
 * Sunday resolution. A stale OPEN does not keep the panel open.
 * Dates and the server lifecycle flags win.
 */
export type JackpotPanelPhase = "open" | "closed" | "settled";

export type JackpotStripStatus = "OPEN" | "ENTRIES_CLOSED" | "RESOLVED";

export interface JackpotPanelInput {
  /** DB status: OPEN, CLOSED_PENDING, RESOLVED, VOID. */
  status?: string | null;
  /** Server lifecycle from deriveNativeMarketLifecycle. */
  lifecycleStatus?: string | null;
  isCutoffPassed?: boolean | null;
  bettingCutoff?: string | Date | null;
  resolveAt?: string | Date | null;
  now?: Date;
}

export interface JackpotPanelState {
  phase: JackpotPanelPhase;
  stripStatus: JackpotStripStatus;
  /** Null once the round is settled. Closed counts down to resolution. */
  countdownTo: Date | null;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export function deriveJackpotPanelState(input: JackpotPanelInput = {}): JackpotPanelState {
  const now = input.now ?? new Date();
  const apiStatus = normalize(input.status);
  const lifecycle = normalize(input.lifecycleStatus);
  const fallback = getJackpotWeekDeadlines(now);
  const resolveAt = toDate(input.resolveAt) ?? fallback.sunday;
  const cutoff = toDate(input.bettingCutoff) ?? fallback.friday;

  const settled =
    apiStatus === "RESOLVED" ||
    apiStatus === "VOID" ||
    lifecycle === "RESOLVED" ||
    now.getTime() > resolveAt.getTime();

  if (settled) {
    return { phase: "settled", stripStatus: "RESOLVED", countdownTo: null };
  }

  const closed =
    input.isCutoffPassed === true ||
    lifecycle === "ENTRIES_CLOSED" ||
    apiStatus === "CLOSED_PENDING" ||
    now.getTime() > cutoff.getTime();

  if (closed) {
    return { phase: "closed", stripStatus: "ENTRIES_CLOSED", countdownTo: resolveAt };
  }

  return { phase: "open", stripStatus: "OPEN", countdownTo: cutoff };
}

export function splitCountdown(deadline: Date, now: Date): { days: number; hours: number; minutes: number } {
  const totalSeconds = Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return { days, hours, minutes };
}
