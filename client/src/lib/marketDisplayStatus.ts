/**
 * One display status for a prediction market.
 *
 * The database `status` column lags the trading cutoff on World Markets:
 * a row can stay `OPEN` after `closeAt` until an admin resolves it.
 * Badges, the LIVE chip, countdown copy, and buy controls must all read
 * this helper so they cannot disagree.
 *
 * Phases:
 *   open            — status OPEN and the trading window is still ahead
 *   trading_closed  — CLOSED_PENDING, or OPEN whose closeAt/endAt has passed
 *   resolved        — RESOLVED
 *   void            — VOID
 */

export type MarketDisplayPhase = "open" | "trading_closed" | "resolved" | "void";

export type MarketCyclePhase = "OPEN" | "ENTRIES_CLOSED";

export interface MarketDisplayInput {
  status?: string | null;
  closeAt?: string | Date | null;
  endAt?: string | Date | null;
}

export interface MarketDisplayStatus {
  phase: MarketDisplayPhase;
  /** Badge label and the label on disabled trade controls. */
  label: string;
  badgeClassName: string;
  /** Buy, sell, and cash-out may be offered. */
  canTrade: boolean;
  /** Emerald LIVE chip. False once trading has stopped. */
  showLive: boolean;
  /**
   * Status to feed getCommunityMarketStatusMessage. A time-closed OPEN
   * market is still waiting on an outcome, so it uses the CLOSED_PENDING copy.
   */
  messageStatus: "OPEN" | "CLOSED_PENDING" | "RESOLVED" | "VOID";
  /**
   * Phase for MarketCycleStrip. Null hides the strip — resolved and void
   * markets use the result card, and the strip's resolved line is written
   * for the weekly native cycle.
   */
  cyclePhase: MarketCyclePhase | null;
}

const BADGE_CLASS: Record<MarketDisplayPhase, string> = {
  open:
    "bg-green-500/25 dark:bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/40 dark:border-green-500/30",
  trading_closed:
    "bg-amber-500/25 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40 dark:border-amber-500/30",
  resolved:
    "bg-blue-500/25 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40 dark:border-blue-500/30",
  void:
    "bg-red-500/25 dark:bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40 dark:border-red-500/30",
};

const LABEL: Record<MarketDisplayPhase, string> = {
  open: "Open",
  trading_closed: "Trading closed",
  resolved: "Resolved",
  void: "Void",
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when closeAt (or endAt, if closeAt is missing or still ahead) is at or before now. */
export function isTradingCutoffPassed(
  market: { closeAt?: string | Date | null; endAt?: string | Date | null },
  nowMs: number,
): boolean {
  const closeAt = toDate(market.closeAt);
  if (closeAt && closeAt.getTime() <= nowMs) return true;
  const endAt = toDate(market.endAt);
  return !!endAt && endAt.getTime() <= nowMs;
}

function pack(phase: MarketDisplayPhase): MarketDisplayStatus {
  const canTrade = phase === "open";
  return {
    phase,
    label: LABEL[phase],
    badgeClassName: BADGE_CLASS[phase],
    canTrade,
    showLive: canTrade,
    messageStatus:
      phase === "open"
        ? "OPEN"
        : phase === "resolved"
          ? "RESOLVED"
          : phase === "void"
            ? "VOID"
            : "CLOSED_PENDING",
    cyclePhase:
      phase === "open" ? "OPEN" : phase === "trading_closed" ? "ENTRIES_CLOSED" : null,
  };
}

export function deriveMarketDisplayStatus(
  market: MarketDisplayInput,
  nowMs: number = Date.now(),
): MarketDisplayStatus {
  const status = market.status ?? "";
  if (status === "VOID") return pack("void");
  if (status === "RESOLVED") return pack("resolved");
  if (status === "CLOSED_PENDING") return pack("trading_closed");
  if (status !== "OPEN") return pack("trading_closed");
  if (isTradingCutoffPassed(market, nowMs)) return pack("trading_closed");
  return pack("open");
}
