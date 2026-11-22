/**
 * Plain sentences for a settled prediction. Amounts go through
 * formatVox so the glyph stays the app's virtual-credit mark.
 * Vox is not money — these lines name a credit result, not a cash payout.
 */

import { formatVox } from "@shared/currency";

export type SettledBetResult = "won" | "lost" | "refunded" | "pending" | string;

export interface SettledBetAmounts {
  result: SettledBetResult;
  stakeAmount: number;
  payout: number;
}

function whole(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/** One settled row. Pending bets have no sentence yet. */
export function resolvedBetSentence(bet: SettledBetAmounts): string | null {
  const stake = whole(bet.stakeAmount);
  const payout = whole(bet.payout);
  if (bet.result === "won") return `You won ${formatVox(payout)}`;
  if (bet.result === "lost") return `Didn't land · ${formatVox(stake)}`;
  if (bet.result === "refunded") return `Refunded ${formatVox(payout > 0 ? payout : stake)}`;
  return null;
}

/**
 * Credits gained or lost across a batch.
 * A win nets payout minus stake. A loss costs the stake.
 * A refund returns the stake, so it nets zero when payout matches stake.
 */
export function resolvedBatchNet(bets: readonly SettledBetAmounts[]): number {
  let net = 0;
  for (const bet of bets) {
    const stake = whole(bet.stakeAmount);
    const payout = whole(bet.payout);
    if (bet.result === "won") net += payout - stake;
    else if (bet.result === "lost") net -= stake;
    else if (bet.result === "refunded") net += payout - stake;
  }
  return net;
}

/** "Net +mark116" / "Net −mark100" / "Net mark0". Whole credits, not cash. */
export function resolvedBatchNetLabel(net: number): string {
  const amount = Number.isFinite(net) ? Math.round(net) : 0;
  if (amount > 0) return `Net +${formatVox(amount)}`;
  if (amount < 0) return `Net −${formatVox(Math.abs(amount))}`;
  return `Net ${formatVox(0)}`;
}
