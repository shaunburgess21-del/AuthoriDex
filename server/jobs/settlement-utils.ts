export interface SettlementPreviewBet {
  id: string;
  entryId: string;
  stakeAmount: number;
  direction?: "yes" | "no";
  createdAt?: Date | string | null;
}

/**
 * Early-bird bonus: Monday bettors get up to BONUS_RATE extra weight in the
 * winning pool. The boost decays linearly to ~0 at cutoff. This is purely
 * redistributive — the total pool is unchanged, so correct bettors always
 * profit; early ones just profit more.
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

export interface SettlementTimingContext {
  marketStartAt?: Date | string | null;
  marketCloseAt?: Date | string | null;
}

export function calculateSettlementPayouts(
  bets: SettlementPreviewBet[],
  winnerEntryId: string,
  timing?: SettlementTimingContext,
) {
  const totalPool = bets.reduce((sum, bet) => sum + bet.stakeAmount, 0);

  const winnerBets = bets.filter((bet) => {
    const dir = bet.direction || "yes";
    if (dir === "yes") return bet.entryId === winnerEntryId;
    return bet.entryId !== winnerEntryId;
  });

  const useTimeWeight = !!(timing?.marketStartAt && timing?.marketCloseAt);

  const winnersWithWeight = winnerBets.map((bet) => ({
    ...bet,
    weight: useTimeWeight
      ? bet.stakeAmount * computeEarlyBirdMultiplier(bet.createdAt, timing!.marketStartAt, timing!.marketCloseAt)
      : bet.stakeAmount,
  }));

  const totalWeight = winnersWithWeight.reduce((sum, b) => sum + b.weight, 0);

  const payouts = winnersWithWeight.map((bet) => ({
    betId: bet.id,
    payout: totalWeight > 0
      ? Math.floor((bet.weight / totalWeight) * totalPool)
      : bet.stakeAmount,
  }));

  let payoutsDistributed = payouts.reduce((sum, bet) => sum + bet.payout, 0);
  const dust = totalPool - payoutsDistributed;
  if (dust > 0 && payouts.length > 0) {
    const largestIdx = payouts.reduce((maxIdx, p, i, arr) => p.payout > arr[maxIdx].payout ? i : maxIdx, 0);
    payouts[largestIdx].payout += dust;
    payoutsDistributed += dust;
  }

  return {
    totalPool,
    winnerBets,
    payouts,
    payoutsDistributed,
    remainder: totalPool - payoutsDistributed,
  };
}
