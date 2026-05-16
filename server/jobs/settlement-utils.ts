/**
 * Early-bird bonus: bettors who get in early on a parimutuel market get
 * up to BONUS_RATE extra weight in the winning pool. The boost decays
 * linearly to ~0 at cutoff. It's purely redistributive — the total pool
 * is unchanged, so correct bettors always profit; early ones just
 * profit more.
 *
 * Parimutuel sunset: the only remaining consumer is `resolveJackpot`
 * (jackpot is the last market type still on the parimutuel engine).
 * The old `calculateSettlementPayouts` helper used by the
 * `settleMarketBets` parimutuel resolver was removed alongside that
 * function — AMM markets settle via `resolveAmmMarket` and don't share
 * any of this math.
 */
export const EARLY_BIRD_BONUS_RATE = 0.5;

export function computeEarlyBirdMultiplier(
  betCreatedAt: Date | string | null | undefined,
  marketStartAt: Date | string | null | undefined,
  marketCloseAt: Date | string | null | undefined,
): number {
  if (!betCreatedAt || !marketStartAt || !marketCloseAt) return 1;
  const created = new Date(betCreatedAt).getTime();
  const start = new Date(marketStartAt).getTime();
  const close = new Date(marketCloseAt).getTime();
  if (isNaN(created) || isNaN(start) || isNaN(close)) return 1;
  const totalWindow = close - start;
  if (totalWindow <= 0) return 1;
  const remaining = Math.min(totalWindow, Math.max(0, close - created));
  return 1 + EARLY_BIRD_BONUS_RATE * (remaining / totalWindow);
}
