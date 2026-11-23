/**
 * Votes the card has already shown, before the server list catches up.
 * A refetch that lands one vote behind must not put the eye count back.
 */

export type VoteOverlay = Readonly<Record<string, boolean>>;

export function noteOptimisticVote(
  overlay: VoteOverlay,
  key: string,
  voted: boolean,
): VoteOverlay {
  if (!key || overlay[key] === voted) return overlay;
  return { ...overlay, [key]: voted };
}

export function clearOptimisticVote(overlay: VoteOverlay, key: string): VoteOverlay {
  if (!key || !(key in overlay)) return overlay;
  const next = { ...overlay };
  delete next[key];
  return next;
}

export function votedWithOverlay(key: string, serverVoted: boolean, overlay: VoteOverlay): boolean {
  const forced = overlay[key];
  return forced === undefined ? serverVoted : forced;
}

/** Drop keys the server list now agrees with. */
export function reconcileVoteOverlay(
  overlay: VoteOverlay,
  cards: readonly { key: string; voted: boolean }[],
): VoteOverlay {
  const votedByKey = new Map(cards.map((card) => [card.key, card.voted]));
  let changed = false;
  const next: Record<string, boolean> = {};
  for (const [key, voted] of Object.entries(overlay)) {
    if (votedByKey.get(key) === voted) {
      changed = true;
      continue;
    }
    next[key] = voted;
  }
  return changed ? next : overlay;
}
