/**
 * Options the signed-in user still holds on a market page.
 * Signed-out visitors and empty position payloads yield an empty set.
 * Callers must invoke this from a hook that runs on every render.
 */

export interface HeldSharePosition {
  entryId?: string | null;
  netShares?: number | null;
}

export interface HeldStakeSide {
  yesStake?: number;
  noStake?: number;
}

export interface HeldSettledBet {
  entryId?: string | null;
  status?: string | null;
  actionType?: string | null;
}

export function selectHeldEntryIds(input: {
  open: boolean;
  positions: readonly HeldSharePosition[] | null | undefined;
  activeStakes: ReadonlyMap<string, HeldStakeSide> | null | undefined;
  bets: readonly HeldSettledBet[] | null | undefined;
}): Set<string> {
  const ids = new Set<string>();
  const positions = input.positions ?? [];
  const stakes = input.activeStakes ?? new Map<string, HeldStakeSide>();
  const bets = input.bets ?? [];

  if (input.open) {
    for (const position of positions) {
      if (!position?.entryId) continue;
      if (Number(position.netShares) > 1e-6) ids.add(position.entryId);
    }
    if (ids.size === 0) {
      for (const [entryId, side] of stakes) {
        if (!entryId) continue;
        if ((side?.yesStake ?? 0) + (side?.noStake ?? 0) > 0) ids.add(entryId);
      }
    }
    return ids;
  }

  for (const bet of bets) {
    if (!bet?.entryId || bet.actionType === "sell") continue;
    if (bet.status === "won" || bet.status === "lost" || bet.status === "active") {
      ids.add(bet.entryId);
    }
  }
  return ids;
}
