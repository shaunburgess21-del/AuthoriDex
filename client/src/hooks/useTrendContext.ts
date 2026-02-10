import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type TrendDriver = "NEWS" | "SEARCH" | "SOCIAL" | "WIKI";

export interface TrendContext {
  primaryDriver: TrendDriver | null;
  secondaryDriver: TrendDriver | null;
  reasonTag: string;
  driverStrength: number;
  headlineSnippet: string | null;
  lastScoredAt: string | null;
  sourceTimestamps: {
    wiki: string | null;
    news: string | null;
    search: string | null;
    x: string | null;
  };
  isHeated: boolean;
  lastScoredAtFormatted: string;
  sourceTimestampsFormatted: {
    wiki: string;
    news: string;
    search: string;
    x: string;
  };
}

export interface SystemFreshness {
  freshness: Record<string, {
    lastUpdated: string;
    count: number;
    status: "live" | "stale" | "cached";
  }>;
  systemStatus: "healthy" | "degraded";
}

export function useTrendContext(personId: string | null) {
  return useQuery<TrendContext>({
    queryKey: [`/api/trending/${personId}/context`],
    enabled: !!personId,
  });
}

export function useTrendContextBatch(personIds: string[]) {
  return useQuery<Record<string, TrendContext>>({
    queryKey: ["/api/trending/context/batch", personIds.join(",")],
    queryFn: async () => {
      if (personIds.length === 0) return {};
      const response = await apiRequest("POST", "/api/trending/context/batch", { personIds });
      return response.json();
    },
    enabled: personIds.length > 0,
    staleTime: 60 * 1000,
  });
}

export function useSystemFreshness() {
  return useQuery<SystemFreshness>({
    queryKey: ["/api/system/freshness"],
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

export function getDriverLabel(driver: TrendDriver | null): string {
  switch (driver) {
    case "NEWS": return "News surge";
    case "SEARCH": return "Search spiking";
    case "SOCIAL": return "Social buzz";
    case "WIKI": return "Wiki views up";
    default: return "Steady";
  }
}
