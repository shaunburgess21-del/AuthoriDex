import {
  getInsightsCache,
  setInsightsCache,
  INSIGHTS_AGGREGATE_TTL_MS,
} from "./cache";

export async function withDiscoverCache<T>(
  cacheKey: string,
  loader: () => Promise<T>,
): Promise<T> {
  const fullKey = `insights:discover:${cacheKey}`;
  const cached = await getInsightsCache<T>(fullKey);
  if (cached) return cached;
  const data = await loader();
  await setInsightsCache(fullKey, "insights_discover", data, INSIGHTS_AGGREGATE_TTL_MS);
  return data;
}
