import { useQuery } from "@tanstack/react-query";
import { normalizeMarketCategory } from "@shared/constants";

export function useLeaderboardCategories(): Set<string> | undefined {
  const { data } = useQuery<string[]>({
    queryKey: ["/api/leaderboard/categories"],
    staleTime: 5 * 60 * 1000,
  });

  if (!data) return undefined;
  return new Set(data.map((c) => normalizeMarketCategory(c)));
}
