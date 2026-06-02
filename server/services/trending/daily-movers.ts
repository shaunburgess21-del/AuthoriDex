export const DAILY_MOVERS_PER_SIDE = 3;
export const DAILY_MOVERS_MAX = 6;

/** Shared cap for weekly gainers/droppers pulse cards (matches DAILY_MOVERS_MAX). */
export const MOVERS_PULSE_TOP_N = DAILY_MOVERS_MAX;

function isSignedChange24h(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

export function selectDailyMovers<T extends { change24h?: number | null }>(
  people: T[],
): T[] {
  const risers = people
    .filter((p) => isSignedChange24h(p.change24h) && p.change24h > 0)
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, DAILY_MOVERS_PER_SIDE);
  const droppers = people
    .filter((p) => isSignedChange24h(p.change24h) && p.change24h < 0)
    .sort((a, b) => a.change24h - b.change24h)
    .slice(0, DAILY_MOVERS_PER_SIDE);
  return [...risers, ...droppers];
}
