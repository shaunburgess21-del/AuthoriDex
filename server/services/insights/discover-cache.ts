import {
  getInsightsCache,
  setInsightsCache,
  INSIGHTS_AGGREGATE_TTL_MS,
} from "./cache";
import { singleFlight } from "./request-memo";

export async function withDiscoverCache<T>(
  cacheKey: string,
  loader: () => Promise<T>,
): Promise<T> {
  const fullKey = `insights:discover:${cacheKey}`;
  return withInsightsAggregateCache(fullKey, "insights_discover", loader);
}

/** DB-backed aggregate cache (90s) for any Insights endpoint response. */
export async function withInsightsAggregateCache<T>(
  fullCacheKey: string,
  provider: string,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await getInsightsCache<T>(fullCacheKey);
  if (cached) return cached;

  // Collapse concurrent cold-cache requests for the same key into one compute.
  return singleFlight(fullCacheKey, async () => {
    // Re-check inside the flight: a sibling request may have populated it
    // between our miss above and acquiring the flight.
    const again = await getInsightsCache<T>(fullCacheKey);
    if (again) return again;
    const data = await loader();
    await setInsightsCache(fullCacheKey, provider, data, INSIGHTS_AGGREGATE_TTL_MS);
    return data;
  });
}
