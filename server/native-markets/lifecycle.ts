export type NativeMarketLifecycleStatus = "OPEN" | "ENTRIES_CLOSED" | "RESOLVED";
export type MarketEngine = "parimutuel" | "amm";

export interface NativeMarketLifecycle {
  status: NativeMarketLifecycleStatus;
  bettingCutoff: Date | null;
  resolutionDeadline: Date | null;
  isCutoffPassed: boolean;
}

/**
 * Pre-resolve cooldown for AMM markets. AMM markets trade right up
 * until 5 minutes before resolution to give the resolver cron a
 * comfortable window to fire and to prevent racing the resolution
 * itself. Mirrors NYSE's closing-auction concept.
 */
export const AMM_PRE_RESOLVE_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Weekly betting closes on Friday 23:59:59.999 UTC for a Sunday-end
 * market. Used by parimutuel (legacy) markets.
 */
export function getWeeklyBettingCutoff(endAt: Date): Date {
  const cutoff = new Date(endAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  cutoff.setUTCHours(23, 59, 59, 999);
  return cutoff;
}

/**
 * AMM trading cutoff is `endAt - 5 minutes`. AMM markets self-correct
 * via price (late traders pay near-fair odds), so the long Friday
 * cutoff is unnecessary. The 5-minute pad protects the resolution
 * cron from a trade that races settlement.
 */
export function getAmmTradingCutoff(endAt: Date): Date {
  return new Date(endAt.getTime() - AMM_PRE_RESOLVE_COOLDOWN_MS);
}

/**
 * Engine-aware cutoff used by the market generator + bet endpoints +
 * notification scheduler. Single source of truth so creation, gating
 * and notifications agree on when a given market closes.
 */
export function getMarketBettingCutoff(
  endAt: Date,
  engine: MarketEngine = "parimutuel",
): Date {
  return engine === "amm" ? getAmmTradingCutoff(endAt) : getWeeklyBettingCutoff(endAt);
}

export function deriveNativeMarketLifecycle(
  endAt: Date | null | undefined,
  now: Date = new Date(),
  engine: MarketEngine = "parimutuel",
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
  const bettingCutoff = getMarketBettingCutoff(resolutionDeadline, engine);
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
