/**
 * Pari-mutuel payout helpers shared across prediction-market UI surfaces.
 *
 * For a parimutuel market with a single combined pool, the gross multiplier
 * for a given outcome is `totalPool / sideStake`. We default to 2.0 when no
 * meaningful stake exists yet — matches today's UpDown card behaviour and
 * gives users a sane "starts at evens" reading on brand-new markets.
 */

export const DEFAULT_PAYOUT_MULTIPLIER = 2.0;

/**
 * Standard pari-mutuel gross multiplier for one outcome.
 *
 *   multiplier = totalPool / sideStake   (rounded to 1dp)
 *
 * Returns `DEFAULT_PAYOUT_MULTIPLIER` (2.0) when either input is non-finite,
 * <= 0, or when the side has no stake yet.
 */
export function computePayoutMultiplier(
  totalPool: number,
  sideStake: number,
): number {
  if (!Number.isFinite(totalPool) || totalPool <= 0) return DEFAULT_PAYOUT_MULTIPLIER;
  if (!Number.isFinite(sideStake) || sideStake <= 0) return DEFAULT_PAYOUT_MULTIPLIER;
  return +(totalPool / sideStake).toFixed(1);
}

/**
 * Convenience: derive a side's multiplier from its share of the pool, when
 * we have the percentage but not the raw stakes (e.g. H2H cards expose
 * `person1Percent` only).
 *
 * - `percent <= 0` → no real stake on this side yet, use the default 2.0.
 * - `percent === 100` → the whole pool is on this side, multiplier is 1.0
 *    (winners share the pool with themselves only).
 */
export function multiplierFromPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return DEFAULT_PAYOUT_MULTIPLIER;
  if (percent >= 100) return 1.0;
  return +(100 / percent).toFixed(1);
}

/** Display helper: "1.8x". */
export function formatMultiplier(mx: number): string {
  return `${mx.toFixed(1)}x`;
}

/** Rough payout in credits if the user's stake wins at the current multiplier. */
export function estimateCreditsIfWin(stake: number, multiplier: number): number {
  if (!Number.isFinite(stake) || stake <= 0) return 0;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return Math.round(stake * multiplier);
}

/**
 * Early-bird bonus multiplier. Monday bettors receive up to 50% extra weight
 * in the winning pool; the boost decays linearly to ~1.0x at cutoff.
 *
 * Must stay in sync with the server-side `computeEarlyBirdMultiplier` in
 * `server/jobs/settlement-utils.ts`.
 */
export const EARLY_BIRD_BONUS_RATE = 0.5;

export function computeEarlyBirdMultiplier(
  now: Date | string | number,
  marketStartAt: Date | string | null | undefined,
  marketCloseAt: Date | string | null | undefined,
): number {
  if (!marketStartAt || !marketCloseAt) return 1;
  const t = new Date(now).getTime();
  const start = new Date(marketStartAt).getTime();
  const close = new Date(marketCloseAt).getTime();
  if (isNaN(t) || isNaN(start) || isNaN(close)) return 1;
  const totalWindow = close - start;
  if (totalWindow <= 0) return 1;
  const remaining = Math.min(totalWindow, Math.max(0, close - t));
  return +(1 + EARLY_BIRD_BONUS_RATE * (remaining / totalWindow)).toFixed(2);
}
