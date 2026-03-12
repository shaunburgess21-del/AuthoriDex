export interface RankThreshold {
  name: string;
  minXp: number;
  maxXp: number | null;
}

export function resolveRankForXp(ranks: RankThreshold[], xp: number): RankThreshold | null {
  for (const rank of ranks) {
    if (xp >= rank.minXp && (rank.maxXp === null || xp <= rank.maxXp)) {
      return rank;
    }
  }

  return null;
}
