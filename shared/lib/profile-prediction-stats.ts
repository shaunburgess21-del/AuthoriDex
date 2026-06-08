export type PredictionResult = "won" | "lost" | "refunded" | "pending";

export interface PredictionResultInput {
  marketStatus: string;
  betStatus: string;
  entryResolutionStatus?: string | null;
  stakeAmount?: number | null;
  payoutAmount?: number | null;
  potentialPayout?: number | null;
}

export function classifyPredictionResult(
  row: PredictionResultInput,
): { result: PredictionResult; payout: number } {
  let result: PredictionResult = "pending";
  let payout = 0;

  if (row.marketStatus === "RESOLVED") {
    if (
      row.betStatus === "won" ||
      (row.betStatus === "active" && row.entryResolutionStatus === "winner") ||
      (row.betStatus === "settled" && row.entryResolutionStatus === "winner")
    ) {
      result = "won";
      payout = row.payoutAmount ?? row.potentialPayout ?? 0;
    } else if (
      row.betStatus === "lost" ||
      row.betStatus === "active" ||
      row.betStatus === "settled"
    ) {
      result = "lost";
    }
  } else if (row.marketStatus === "VOID") {
    result = "refunded";
    payout = row.stakeAmount ?? 0;
  }

  return { result, payout };
}

export function roundWinRatePercent(won: number, lost: number): number {
  const settled = won + lost;
  if (settled <= 0) return 0;
  return Math.round((won / settled) * 1000) / 10;
}
