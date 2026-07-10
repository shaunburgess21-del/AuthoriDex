/** Lenient env-flag parse (true/1/yes/on, any case). Default off pre-launch. */
function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

/**
 * When enabled, blocks trading on markets the caller created (`created_by`).
 * Off by default so founders can seed liquidity pre-launch; set
 * `SELF_TRADE_GUARD_ENABLED=true` on Railway at public launch.
 */
export const SELF_TRADE_GUARD_ENABLED = envFlag(process.env.SELF_TRADE_GUARD_ENABLED);

/** Pure guard predicate — exported for unit tests and reuse. */
export function isSelfTradeDenied(
  guardEnabled: boolean,
  createdBy: string | null | undefined,
  userId: string,
): boolean {
  return !!(guardEnabled && createdBy && createdBy === userId);
}
