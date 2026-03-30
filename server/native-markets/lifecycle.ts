export type NativeMarketLifecycleStatus = "OPEN" | "ENTRIES_CLOSED" | "RESOLVED";

export interface NativeMarketLifecycle {
  status: NativeMarketLifecycleStatus;
  bettingCutoff: Date | null;
  resolutionDeadline: Date | null;
  isCutoffPassed: boolean;
}

/**
 * Weekly betting closes on Friday 23:59:59.999 UTC for a Sunday-end market.
 */
export function getWeeklyBettingCutoff(endAt: Date): Date {
  const cutoff = new Date(endAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  cutoff.setUTCHours(23, 59, 59, 999);
  return cutoff;
}

export function deriveNativeMarketLifecycle(
  endAt: Date | null | undefined,
  now: Date = new Date(),
): NativeMarketLifecycle {
  if (!endAt) {
    return {
      status: "OPEN",
      bettingCutoff: null,
      resolutionDeadline: null,
      isCutoffPassed: false,
    };
  }

  const resolutionDeadline = new Date(endAt);
  const bettingCutoff = getWeeklyBettingCutoff(resolutionDeadline);
  const isCutoffPassed = now > bettingCutoff;

  let status: NativeMarketLifecycleStatus = "OPEN";
  if (now > resolutionDeadline) {
    status = "RESOLVED";
  } else if (isCutoffPassed) {
    status = "ENTRIES_CLOSED";
  }

  return {
    status,
    bettingCutoff,
    resolutionDeadline,
    isCutoffPassed,
  };
}
