export type RecencySort = "default" | "newest" | "oldest";

/**
 * Client-side newest/oldest sort shared by the Voting CMS tabs.
 *
 * `default` returns the list untouched (preserves the server's ordering, e.g.
 * manual display order, vote count, or fit score). `newest`/`oldest` sort by
 * the timestamp returned from `getTimestamp` (missing values sort as oldest).
 */
function toMillis(raw: string | number | Date | null | undefined): number {
  if (raw == null) return 0;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function sortByRecency<T>(
  items: T[],
  order: RecencySort,
  getTimestamp: (item: T) => string | number | Date | null | undefined,
): T[] {
  if (order === "default") return items;
  return [...items].sort((a, b) => {
    const aTime = toMillis(getTimestamp(a));
    const bTime = toMillis(getTimestamp(b));
    return order === "newest" ? bTime - aTime : aTime - bTime;
  });
}
