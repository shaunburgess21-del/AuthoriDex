export interface SettlementPreviewBet {
  id: string;
  entryId: string;
  stakeAmount: number;
  direction?: "yes" | "no";
}

export function calculateSettlementPayouts(bets: SettlementPreviewBet[], winnerEntryId: string) {
  const totalPool = bets.reduce((sum, bet) => sum + bet.stakeAmount, 0);

  const winnerBets = bets.filter((bet) => {
    const dir = bet.direction || "yes";
    if (dir === "yes") return bet.entryId === winnerEntryId;
    return bet.entryId !== winnerEntryId;
  });

  const winnerPool = winnerBets.reduce((sum, bet) => sum + bet.stakeAmount, 0);

  const payouts = winnerBets.map((bet) => ({
    betId: bet.id,
    payout: winnerPool > 0 ? Math.floor((bet.stakeAmount / winnerPool) * totalPool) : bet.stakeAmount,
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
