export function resolveFameScore(person: {
  fameIndex?: number | null;
  fameIndexLive?: number | null;
  trendScore?: number | null;
}): number {
  return (
    person.fameIndexLive ??
    person.fameIndex ??
    Math.round((person.trendScore ?? 0) / 100)
  );
}
