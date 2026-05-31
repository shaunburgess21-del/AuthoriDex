export const HOT_MOVERS_CAP = 6;
export const HOT_MOVERS_RANK_MAX = 100;

export function selectHotMovers<T extends { rank?: number | null; change24h?: number | null }>(
  people: T[],
): T[] {
  return people
    .filter((p) => (p.rank ?? 999) <= HOT_MOVERS_RANK_MAX)
    .filter((p) => p.change24h != null && p.change24h > 0)
    .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
    .slice(0, HOT_MOVERS_CAP);
}
