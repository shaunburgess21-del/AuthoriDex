import type { QueryClient } from "@tanstack/react-query";

export type OptimisticPredictionBet = {
  marketId: string;
  entryId: string;
  entryLabel: string;
  stakeAmount: number;
  /** World/community markets carry yes/no; native markets omit or null. */
  direction?: "yes" | "no" | null;
};

const SEEDED_STATS = {
  total: 1,
  won: 0,
  lost: 0,
  refunded: 0,
  pending: 1,
  netCredits: 0,
  winRate: 0,
  bestCategory: null,
  currentStreak: 0,
};

/**
 * Seed `/api/me/predictions` so Predict cards flip to "Your pick" /
 * Predicted in the same tick as modal close — before background
 * invalidate/refetch finishes.
 *
 * Skips when a pending row already exists for the same market+entry
 * (top-ups already show Predicted). Appends for a new entry on the
 * same market (multi-outcome World).
 */
export function appendOptimisticPrediction(
  queryClient: QueryClient,
  bet: OptimisticPredictionBet,
): void {
  const marketId = String(bet.marketId);
  const entryId = String(bet.entryId);
  const newBet = {
    betId: `optimistic-${Date.now()}`,
    marketId,
    entryId,
    entryLabel: bet.entryLabel,
    stakeAmount: bet.stakeAmount,
    result: "pending" as const,
    payout: 0,
    direction: bet.direction ?? null,
  };

  const alreadyHasEntry = (preds: any[]) =>
    preds.some(
      (b: any) =>
        String(b.marketId) === marketId && String(b.entryId) === entryId,
    );

  queryClient.setQueryData(["/api/me/predictions"], (old: any) => {
    if (old == null) {
      return { predictions: [newBet], stats: SEEDED_STATS };
    }
    if (Array.isArray(old)) {
      return alreadyHasEntry(old) ? old : [...old, newBet];
    }
    const preds = old.predictions ?? [];
    if (alreadyHasEntry(preds)) return old;
    return { ...old, predictions: [...preds, newBet] };
  });
}
