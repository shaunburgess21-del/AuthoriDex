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
  const cutoffDate = toDate(options.bettingCutoff) ?? getFallbackDates().cutoff;
  const now = new Date();
  const entriesClosed = now > cutoffDate;

  const closeVerb = entriesClosed ? "Entries closed" : "Entries close";
  const lines = [
    entriesClosed
      ? "Trading is closed for this week — new predictions are disabled until the next cycle."
      : "This market is in settlement mode right now, so new predictions are temporarily disabled.",
    `${closeVerb} ${times.cutoffUtc} (${times.cutoffLocal} local), resolve ${times.resolveUtc} (${times.resolveLocal} local), reopen Monday (${times.reopenLocal} local / ${times.reopenUtc}).`,
    "Please check back Monday to place your next prediction.",
  ];

  return {
    title: "Predictions are currently closed",
    description: lines.join(" "),
    lines,
    times,
  };
}

/**
 * Status-driven copy for community / jackpot detail pages. Lives next
 * to getClosedMarketMessage so every "this market isn't open" surface
 * — weekly natives, community, jackpot, popovers, banners — pulls from
 * the same module and stays in tone.
 *
 * Community markets don't follow the weekly Fri-cutoff / Sun-resolve
 * cycle, so we don't pretend they do; the messaging is anchored on
 * lifecycle status (CLOSED_PENDING / RESOLVED / VOID) instead of
 * calendar deadlines.
 */
export interface CommunityMarketStatusOptions {
  /** "OPEN" | "CLOSED_PENDING" | "RESOLVED" | "VOID" — anything else falls to the closed default. */
  status: string;
  /** Outcome label for resolved markets ("Yes", "Up", "Person A"). */
  outcomeLabel?: string | null;
  /** Reason supplied by admin / auto-resolver when status === "VOID". */
  voidReason?: string | null;
  /** Jackpot detail picks a slightly different RESOLVED line. */
  isJackpotMarket?: boolean;
}

export interface CommunityMarketStatusMessage {
  title: string;
  description: string;
}

export function getCommunityMarketStatusMessage({
  status,
  outcomeLabel,
  voidReason,
  isJackpotMarket,
}: CommunityMarketStatusOptions): CommunityMarketStatusMessage {
  if (status === "CLOSED_PENDING") {
    return {
      title: "Predictions are currently closed",
      description:
        "Predictions are closed and we're waiting for the final outcome to be confirmed.",
    };
  }
  if (status === "RESOLVED") {
    return {
      title: "Official Result",
      description: outcomeLabel
        ? `${outcomeLabel} was the final outcome.`
        : isJackpotMarket
          ? "This jackpot market has been resolved."
          : "This market has been officially resolved.",
    };
  }
  if (status === "VOID") {
    return {
      title: "Market Voided",
      description:
        voidReason ||
        "This market was cancelled and any affected positions were voided or refunded.",
    };
  }
  return {
    title: "Market Closed",
    description: "Predictions have ended for this market.",
  };
}

/**
 * True when a World Market should show as trading-closed in the UI.
 * Combines DB status with the authoritative `closeAt` gate (same field
 * `amm-trades` enforces) so an auto-lock freezes Buy buttons without
 * waiting for status to flip away from OPEN.
 */
export function isCommunityTradingClosed(market: {
  status?: string | null;
  closeAt?: string | Date | null;
}): boolean {
  if (market.status !== "OPEN") return true;
  const closeAt = toDate(market.closeAt);
  return !!closeAt && closeAt.getTime() <= Date.now();
}
