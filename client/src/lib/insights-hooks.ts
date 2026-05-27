import { useQuery } from "@tanstack/react-query";
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

export function useInsightsRankings(filters: InsightsFilters) {
  const qs = serializeFilters(filters).toString();
  return useQuery({
    queryKey: ["/api/insights/rankings", qs],
    queryFn: () => fetchInsightsJson<InsightsRankingsResponse>(`/api/insights/rankings?${qs}`),
    staleTime: 90_000,
  });
}

export function useInsightsOverview() {
  return useQuery({
    queryKey: ["/api/insights/overview"],
    queryFn: () => fetchInsightsJson<InsightsOverviewResponse>("/api/insights/overview"),
    staleTime: 90_000,
  });
}

export function useInsightsStory() {
  return useQuery({
    queryKey: ["/api/insights/story"],
    queryFn: () => fetchInsightsJson<InsightsStoryPayload>("/api/insights/story"),
    staleTime: 90_000,
  });
}
