/** Canonical hourly Fame Index — single source of truth for all user surfaces. */
export function resolveFameScore(person: {
  fameIndex?: number | null;
  fameIndexLive?: number | null;
  trendScore?: number | null;
}): number {
  if (person.fameIndex != null && person.fameIndex > 0) {
    return person.fameIndex;
  }
  if (person.trendScore != null && person.trendScore > 0) {
    return Math.round(person.trendScore);
  }
  return 0;
}
