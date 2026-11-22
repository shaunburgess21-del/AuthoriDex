import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { accountWinRateDisplay, type WinRateDisplay } from "@/lib/winRateDisplay";

interface PredictionStatsSlice {
  stats?: { won?: number; lost?: number; winRate?: number };
}

/**
 * Same pending rule as /me: "–" until at least one prediction has won or
 * lost. Shares the `/api/me/predictions` cache with the account pages.
 */
export function useAccountWinRate(): WinRateDisplay {
  const { user, profile } = useAuth();
  const { data } = useQuery<PredictionStatsSlice>({
    queryKey: ["/api/me/predictions"],
    enabled: !!user,
  });
  const resolved = data?.stats
    ? (data.stats.won ?? 0) + (data.stats.lost ?? 0)
    : null;
  return accountWinRateDisplay({
    resolved,
    winRate: data?.stats?.winRate ?? profile?.winRate,
  });
}
