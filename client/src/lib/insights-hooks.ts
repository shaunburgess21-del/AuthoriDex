import { useInfiniteQuery, useQuery, keepPreviousData } from "@tanstack/react-query";
import { getAuthHeaders } from "./queryClient";
import type {
  InsightsOverviewResponse,
  InsightsRankingsResponse,
  InsightsStoryPayload,
} from "@shared/insights/types";
import type { InsightsFilters } from "@shared/insights/filters";
import { serializeFilters } from "@shared/insights/filters";

async function fetchInsightsJson<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(path, { headers, credentials: "include" });
  if (!res.ok) throw new Error(`Insights request failed: ${res.status}`);
  const json = await res.json();
  return json.data as T;
}

/**
 * Paginated rankings via infinite scroll. The server returns `total` so we
 * stop requesting once all rows are loaded. The cache key includes the
 * non-page filter signature so source / window / category / favourites
 * changes start a fresh list.
 */
export function useInsightsRankings(filters: InsightsFilters) {
  // Strip page from the cache signature — pages stack inside one query.
  const baseFilters = { ...filters, page: 1 };
  const baseQs = serializeFilters(baseFilters).toString();

  return useInfiniteQuery<InsightsRankingsResponse>({
    queryKey: ["/api/insights/rankings", baseQs],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const page = (pageParam as number) ?? 1;
      const qs = serializeFilters({ ...baseFilters, page }).toString();
      return fetchInsightsJson<InsightsRankingsResponse>(`/api/insights/rankings?${qs}`);
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.rows.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
    staleTime: 90_000,
    placeholderData: keepPreviousData,
  });
}

export function useInsightsOverview() {
  return useQuery({
    queryKey: ["/api/insights/overview"],
    queryFn: () => fetchInsightsJson<InsightsOverviewResponse>("/api/insights/overview"),
    staleTime: 90_000,
    /** Keep last overview visible while refetching so tab switches feel instant. */
    placeholderData: (prev) => prev,
  });
}

export function useInsightsStory() {
  return useQuery({
    queryKey: ["/api/insights/story"],
    queryFn: () => fetchInsightsJson<InsightsStoryPayload>("/api/insights/story"),
    staleTime: 90_000,
  });
}
