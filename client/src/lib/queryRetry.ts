import { getPublishedReachability } from "./networkStatus";

const MAX_QUERY_RETRIES = 3;

/**
 * Retry transient failures (network, 5xx, 408, 429). Skip retries for typical client errors (4xx except 408/429) and 401/403/404.
 * A confirmed Android offline link does not retry; the reconnect path refetches once.
 * Aborted fetches are superseded queries (account switch, removeQueries) and must not be retried.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (getPublishedReachability() === "offline") return false;
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (error instanceof Error && error.name === "AbortError") return false;
  if (!(error instanceof Error)) return true;
  const m = error.message;
  const statusMatch = /^(\d{3}):/.exec(m);
  if (statusMatch) {
    const code = parseInt(statusMatch[1], 10);
    if (code === 401 || code === 403 || code === 404) return false;
    if (code === 408 || code === 429) return true;
    if (code >= 400 && code < 500) return false;
  }
  return true;
}

export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 10_000);
}
