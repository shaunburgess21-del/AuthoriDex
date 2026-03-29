import { useState, useEffect, useCallback, useMemo } from "react";

export type MarketStatus = "OPEN" | "ENTRIES_CLOSED" | "RESOLVED";

export interface MarketCycleState {
  status: MarketStatus;
  timeRemaining: {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    totalSeconds: number;
  };
  deadline: Date;
  /** Which deadline the timer is counting toward */
  activeDeadlineType: "bettingCutoff" | "resolution";
  urgencyLevel: "normal" | "warning" | "critical";
  /** True when no deadline data has been provided yet (queries still loading) */
  isLoading: boolean;
}

export interface MarketCycleOptions {
  bettingCutoff?: string | Date | null;
  resolutionDeadline?: string | Date | null;
}

/**
 * Compute this week's Friday 23:59:59.999 UTC and Sunday 23:59:59.999 UTC.
 * Used as a client-side fallback when API data hasn't loaded yet.
 * Mirrors the server's getWeeklyBettingCutoff + getWeekContext logic.
 */
export function getClientWeekDeadlines(): { friday: Date; sunday: Date } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun .. 6=Sat

  // Find this week's Sunday 23:59:59.999 UTC
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const sunday = new Date(now);
  sunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
  sunday.setUTCHours(23, 59, 59, 999);

  // If we're past this Sunday, advance to next week
  if (now > sunday) {
    sunday.setUTCDate(sunday.getUTCDate() + 7);
  }

  // Friday = Sunday minus 2 days
  const friday = new Date(sunday);
  friday.setUTCDate(friday.getUTCDate() - 2);
  friday.setUTCHours(23, 59, 59, 999);

  return { friday, sunday };
}

function calculateTimeRemaining(deadline: Date): MarketCycleState["timeRemaining"] {
  const now = new Date();
  const diff = Math.max(0, deadline.getTime() - now.getTime());

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds, totalSeconds };
}

function getUrgencyLevel(totalSeconds: number): MarketCycleState["urgencyLevel"] {
  const oneHour = 60 * 60;
  const twentyFourHours = 24 * 60 * 60;

  if (totalSeconds <= oneHour) return "critical";
  if (totalSeconds <= twentyFourHours) return "warning";
  return "normal";
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Accepts either the legacy single-arg form or the new options object.
 *
 * Legacy:  useMarketCycle(bettingCutoff)
 * New:     useMarketCycle({ bettingCutoff, resolutionDeadline })
 *
 * Three-phase lifecycle:
 *   OPEN            – bettingCutoff in the future; timer counts to bettingCutoff
 *   ENTRIES_CLOSED  – bettingCutoff past, resolutionDeadline in the future; timer counts to resolution
 *   RESOLVED        – both deadlines past; timer all zeros
 */
export function useMarketCycle(
  arg?: string | Date | null | MarketCycleOptions,
): MarketCycleState {
  const { cutoff, resolution, hasAnyInput } = useMemo(() => {
    if (arg && typeof arg === "object" && !((arg as any) instanceof Date) && ("bettingCutoff" in arg || "resolutionDeadline" in arg)) {
      const opts = arg as MarketCycleOptions;
      return {
        cutoff: toDate(opts.bettingCutoff),
        resolution: toDate(opts.resolutionDeadline),
        hasAnyInput: !!(opts.bettingCutoff || opts.resolutionDeadline),
      };
    }
    // Legacy single-arg form
    const d = toDate(arg as string | Date | null | undefined);
    return { cutoff: d, resolution: null as Date | null, hasAnyInput: !!d };
  }, [arg]);

  const { bettingDeadline, resolutionDeadline, isLoading } = useMemo(() => {
    if (hasAnyInput) {
      const fallback = getClientWeekDeadlines();
      return {
        bettingDeadline: cutoff ?? fallback.friday,
        resolutionDeadline: resolution ?? fallback.sunday,
        isLoading: false,
      };
    }
    // No data provided — use client-side fallback but flag as loading
    const fallback = getClientWeekDeadlines();
    return {
      bettingDeadline: fallback.friday,
      resolutionDeadline: fallback.sunday,
      isLoading: true,
    };
  }, [cutoff, resolution, hasAnyInput]);

  const computeState = useCallback(() => {
    const now = new Date();
    const cutoffPassed = now > bettingDeadline;
    const resolutionPassed = now > resolutionDeadline;

    let status: MarketStatus;
    let activeDeadline: Date;
    let activeDeadlineType: MarketCycleState["activeDeadlineType"];

    if (!cutoffPassed) {
      status = "OPEN";
      activeDeadline = bettingDeadline;
      activeDeadlineType = "bettingCutoff";
    } else if (!resolutionPassed) {
      status = "ENTRIES_CLOSED";
      activeDeadline = resolutionDeadline;
      activeDeadlineType = "resolution";
    } else {
      status = "RESOLVED";
      activeDeadline = resolutionDeadline;
      activeDeadlineType = "resolution";
    }

    const timeRemaining = calculateTimeRemaining(activeDeadline);
    const urgencyLevel = getUrgencyLevel(
      status === "OPEN" ? timeRemaining.totalSeconds : timeRemaining.totalSeconds,
    );

    return { status, timeRemaining, deadline: activeDeadline, activeDeadlineType, urgencyLevel, isLoading };
  }, [bettingDeadline, resolutionDeadline, isLoading]);

  const [state, setState] = useState(computeState);

  useEffect(() => {
    setState(computeState());
    const interval = setInterval(() => setState(computeState()), 1000);
    return () => clearInterval(interval);
  }, [computeState]);

  return state;
}
