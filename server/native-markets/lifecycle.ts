import { DEFAULT_PRE_RESOLVE_COOLDOWN_MS, getAmmCooldownMs } from "./amm-settings";

export type NativeMarketLifecycleStatus = "OPEN" | "ENTRIES_CLOSED" | "RESOLVED";
export type MarketEngine = "parimutuel" | "amm";

export interface NativeMarketLifecycle {
  status: NativeMarketLifecycleStatus;
  bettingCutoff: Date | null;
  resolutionDeadline: Date | null;
  isCutoffPassed: boolean;
}

/**
 * Default pre-resolve cooldown for AMM markets (5 minutes). The live
 * value is admin-tunable via `amm_runtime_settings.pre_resolve_cooldown_ms`
 * and read through `getAmmCooldownMs()`; this constant remains the
 * compiled-in fallback when the cache hasn't yet warmed at boot.
 *
 * Existing imports (tests, etc.) still resolve against this value.
 * For runtime checks, prefer the cached read so a hot fix to the
 * cooldown propagates without a deploy.
 */
export const AMM_PRE_RESOLVE_COOLDOWN_MS = DEFAULT_PRE_RESOLVE_COOLDOWN_MS;

/**
 * Weekly betting cutoff: Friday 23:59:59.999 UTC for a Sunday-end
 * market. Parimutuel sunset: jackpot is the only remaining consumer —
 * non-jackpot markets are AMM and use `getAmmTradingCutoff` instead.
 */
export function getWeeklyBettingCutoff(endAt: Date): Date {
  const cutoff = new Date(endAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  cutoff.setUTCHours(23, 59, 59, 999);
  return cutoff;
}

/**
 * AMM trading cutoff is `endAt - <admin-tunable cooldown>` (default
 * 5 minutes). AMM markets self-correct via price (late traders pay
 * near-fair odds), so the long Friday cutoff is unnecessary. The
 * cooldown pad protects the resolution cron from a trade that races
 * settlement, and is admin-tunable via `amm_runtime_settings` once we
 * have agent-driven volume to observe.
 */
export function getAmmTradingCutoff(endAt: Date): Date {
  return new Date(endAt.getTime() - getAmmCooldownMs());
}

/**
 * Engine-aware cutoff used by the market generator + bet endpoints +
 * notification scheduler. Single source of truth so creation, gating,
 * and notifications agree on when a given market closes.
 *
 * Parimutuel sunset: the default is now `"amm"`. Only jackpot markets
 * should pass `"parimutuel"` explicitly. Every other call site can
 * either omit the engine arg or pass it for documentation.
 */
function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

/**
 * Market types that use Friday 23:59 UTC betting cutoff when
 * `NATIVE_FRIDAY_CUTOFF_ENABLED` is on. H2H and gainer keep the short
 * AMM pre-resolve window (see plan: concentration fix targets thin
 * weekly up/down cards only).
 */
export const NATIVE_FRIDAY_CUTOFF_MARKET_TYPES = ["updown"] as const;

export type NativeFridayCutoffMarketType =
  (typeof NATIVE_FRIDAY_CUTOFF_MARKET_TYPES)[number];

/** True when this market type gets the weekly Friday lock under the flag. */
export function usesNativeFridayBettingCutoff(
  marketType: string | null | undefined,
  engine: MarketEngine = "amm",
): boolean {
  return (
    envFlag(process.env.NATIVE_FRIDAY_CUTOFF_ENABLED) &&
    engine === "amm" &&
    marketType != null &&
    (NATIVE_FRIDAY_CUTOFF_MARKET_TYPES as readonly string[]).includes(
      marketType,
    )
  );
}

/** Friday 23:59 UTC cutoff for weekly up/down when `NATIVE_FRIDAY_CUTOFF_ENABLED`. */
function nativeFridayCutoffForUpdown(
  endAt: Date,
  engine: MarketEngine,
  marketType?: string,
): boolean {
  return usesNativeFridayBettingCutoff(marketType, engine);
}

export function getMarketBettingCutoff(
  endAt: Date,
  engine: MarketEngine = "amm",
  marketType?: string,
): Date {
  if (nativeFridayCutoffForUpdown(endAt, engine, marketType)) {
    return getWeeklyBettingCutoff(endAt);
  }
  return engine === "amm" ? getAmmTradingCutoff(endAt) : getWeeklyBettingCutoff(endAt);
}

/**
 * Effective trading cutoff for agent scheduling / UI.
 *
 * Prefer the earlier of the derived cutoff (`endAt − cooldown` / Friday)
 * and a stored `closeAt` (e.g. World Market auto-lock). Without this,
 * agents queue buys against `endAt` that `executeBuy` later rejects as
 * `amm_market_closed`.
 */
export function getEffectiveBettingCutoff(
  endAt: Date,
  engine: MarketEngine = "amm",
  marketType?: string,
  closeAt?: Date | string | null,
): Date {
  const derived = getMarketBettingCutoff(endAt, engine, marketType);
  if (closeAt == null) return derived;
  const stored = closeAt instanceof Date ? closeAt : new Date(closeAt);
  if (!Number.isNaN(stored.getTime()) && stored < derived) {
    return stored;
  }
  return derived;
}

/** User-facing copy when a buy is rejected past cutoff. */
export function getAmmTradingClosedMessage(marketType?: string): string {
  if (usesNativeFridayBettingCutoff(marketType, "amm")) {
    return "Weekly trading closed — entries locked Friday 23:59 UTC until results Sunday.";
  }
  return "Trading is closed (final minutes before resolution). This market is now locked.";
}

export function deriveNativeMarketLifecycle(
  endAt: Date | null | undefined,
  now: Date = new Date(),
  engine: MarketEngine = "amm",
  marketType?: string,
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
  const bettingCutoff = getMarketBettingCutoff(resolutionDeadline, engine, marketType);
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
