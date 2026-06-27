type OpinionPollSortOption = {
  id: string;
  votes?: number | null;
  orderIndex?: number | null;
};

export function compareOpinionPollOptionsByVotes(
  a: OpinionPollSortOption,
  b: OpinionPollSortOption,
): number {
  return (b.votes ?? 0) - (a.votes ?? 0) || (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
}

export function sortOpinionPollOptionsByVotes<T extends OpinionPollSortOption>(
  options: T[],
): T[] {
  return [...options].sort(compareOpinionPollOptionsByVotes);
}

/** Card preview: vote order, with the user's pick pinned first when present. */
export function sortOpinionPollOptionsForCard<T extends OpinionPollSortOption>(
  options: T[],
  userVoteId: string | null | undefined,
): T[] {
  if (!userVoteId) return options;
  const sorted = sortOpinionPollOptionsByVotes(options);
  const selectedIdx = sorted.findIndex((o) => o.id === userVoteId);
  if (selectedIdx > 0) {
    const [selected] = sorted.splice(selectedIdx, 1);
    sorted.unshift(selected);
  }
  return sorted;
}
