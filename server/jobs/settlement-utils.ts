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
    payout: winnerPool > 0 ? Math.round((bet.stakeAmount / winnerPool) * totalPool) : bet.stakeAmount,
  }));

  const payoutsDistributed = payouts.reduce((sum, bet) => sum + bet.payout, 0);

  return {
    totalPool,
    winnerBets,
    payouts,
    payoutsDistributed,
    remainder: totalPool - payoutsDistributed,
  };
}
