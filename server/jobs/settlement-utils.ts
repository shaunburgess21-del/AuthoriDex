export interface SettlementPreviewBet {
  id: string;
  entryId: string;
  stakeAmount: number;
}

export function calculateSettlementPayouts(bets: SettlementPreviewBet[], winnerEntryId: string) {
  const totalPool = bets.reduce((sum, bet) => sum + bet.stakeAmount, 0);
  const winnerBets = bets.filter((bet) => bet.entryId === winnerEntryId);
  const winnerPool = winnerBets.reduce((sum, bet) => sum + bet.stakeAmount, 0);

  const payouts = winnerBets.map((bet) => ({
    betId: bet.id,
    payout: winnerPool > 0 ? Math.floor((bet.stakeAmount / winnerPool) * totalPool) : bet.stakeAmount,
  }));

  // Distribute remaining dust (caused by floor rounding) to the largest winner
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
