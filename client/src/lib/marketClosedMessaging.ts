import { getClientWeekDeadlines } from "@/hooks/useMarketCycle";

type DateInput = string | Date | null | undefined;

/** Next calendar day at 00:00:00.000 UTC (typical “reopens Monday” messaging anchor). */
function nextUtcMidnightAfter(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

export interface ClosedMarketMessageOptions {
  bettingCutoff?: DateInput;
  resolutionDeadline?: DateInput;
}

export interface ClosedMarketTimes {
  cutoffUtc: string;
  resolveUtc: string;
  reopenUtc: string;
  cutoffLocal: string;
  resolveLocal: string;
  reopenLocal: string;
}

export interface ClosedMarketMessage {
  title: string;
  description: string;
  lines: string[];
  times: ClosedMarketTimes;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDate(value: DateInput): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatUtcShort(date: Date): string {
  const day = WEEKDAY_SHORT[date.getUTCDay()];
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm} UTC`;
}

function formatLocalShort(date: Date): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return formatter.format(date).replace(",", "");
}

/**
 * Client-only fallback when API has not supplied cutoff/deadline yet.
 * Matches getClientWeekDeadlines() (weekly Fri/Sun UTC); prefer passing server times when available.
 */
function getFallbackDates() {
  const { friday, sunday } = getClientWeekDeadlines();
  return {
    cutoff: friday,
    resolve: sunday,
  };
}

export function getClosedMarketTimes(options: ClosedMarketMessageOptions = {}): ClosedMarketTimes {
  const fallback = getFallbackDates();
  const cutoff = toDate(options.bettingCutoff) ?? fallback.cutoff;
  const resolve = toDate(options.resolutionDeadline) ?? fallback.resolve;
  const reopen = nextUtcMidnightAfter(resolve);

  return {
    cutoffUtc: formatUtcShort(cutoff),
    resolveUtc: formatUtcShort(resolve),
    reopenUtc: formatUtcShort(reopen),
    cutoffLocal: formatLocalShort(cutoff),
    resolveLocal: formatLocalShort(resolve),
    reopenLocal: formatLocalShort(reopen),
  };
}

export function getClosedMarketMessage(options: ClosedMarketMessageOptions = {}): ClosedMarketMessage {
  const times = getClosedMarketTimes(options);

  const lines = [
    "This market is in settlement mode right now, so new predictions are temporarily disabled.",
    `Entries close on ${times.cutoffUtc} (${times.cutoffLocal} local), resolve on ${times.resolveUtc} (${times.resolveLocal} local), and reopen Monday (${times.reopenLocal} local / ${times.reopenUtc}).`,
    "Please check back Monday to place your next prediction.",
  ];

  return {
    title: "Predictions are currently closed",
    description: lines.join(" "),
    lines,
    times,
  };
}
