export interface WinRateDisplay {
  /** Shown as the stat figure. En dash while nothing has settled. */
  text: string;
  /** True until at least one prediction has won or lost. */
  pending: boolean;
}

/**
 * Win rate is 0 while every prediction is still open. Show a dash
 * and a Pending hint until one of them resolves. A real 0% (losses
 * only) still reads as 0% once `resolved` is at least 1.
 */
export function accountWinRateDisplay(input: {
  /** Wins + losses. Null while the breakdown has not loaded. */
  resolved: number | null;
  winRate: number | null | undefined;
}): WinRateDisplay {
  if (input.resolved == null || input.resolved < 1) {
    return { text: "–", pending: true };
  }
  const rate = input.winRate ?? 0;
  const rounded = Math.round(rate * 10) / 10;
  const text = Number.isInteger(rounded) ? `${rounded}%` : `${rounded}%`;
  return { text, pending: false };
}
