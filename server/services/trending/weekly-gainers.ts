export const WEEKLY_GAINERS_CAP = 3;

export function selectWeeklyGainers<T extends { change7d?: number | null }>(
  people: T[],
): T[] {
  return people
    .filter((p) => typeof p.change7d === "number" && p.change7d > 0)
    .sort((a, b) => (b.change7d as number) - (a.change7d as number))
    .slice(0, WEEKLY_GAINERS_CAP);
}
