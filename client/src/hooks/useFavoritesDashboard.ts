import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { FavoriteItem } from "@/hooks/useFavorites";

export interface WatchlistBiggestMover {
  personId: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number | null;
  change24h: number;
  driver: "NEWS" | "WIKI" | null;
  reasonTag: string | null;
}

export interface WatchlistMarket {
  marketId: string;
  slug: string;
  title: string;
  marketType: string;
  category: string | null;
  endAt: string | null;
  closeAt: string | null;
  coverImageUrl: string | null;
  matchedPersonIds: string[];
  matchedPersonNames: string[];
}

export interface WatchlistPoll {
  id: string;
  kind: "opinion_poll" | "matchup" | "trending_poll";
  slug: string | null;
  title: string;
  category: string | null;
  imageUrl: string | null;
  matchedPersonIds: string[];
  matchedPersonNames: string[];
  createdAt: string;
}

export type WatchlistAlert =
  | {
      kind: "rank_cross_top10" | "rank_cross_top50";
      personId: string;
      personName: string;
      previousRank: number;
      currentRank: number;
    }
  | {
      kind: "prediction_winning";
      betId: string;
      marketId: string;
      marketSlug: string;
      marketTitle: string;
      entryLabel: string;
      personId: string;
      personName: string;
    };

export interface FavoritesDashboardResponse {
  favorites: FavoriteItem[];
  biggestMover: WatchlistBiggestMover | null;
  newMarkets: WatchlistMarket[];
  newPolls: WatchlistPoll[];
  alerts: WatchlistAlert[];
}

/**
 * TanStack Query wrapper for the composite watchlist endpoint.
 *
 * - Cached for 60s to keep the dashboard snappy on navigation.
 * - Gated on the auth token being available so we don't fire a 401.
 * - Returns safe defaults so consumers can render loading + empty states
 *   without null-checking every field.
 */
export function useFavoritesDashboard() {
  const { session, loading } = useAuth();

  const query = useQuery<FavoritesDashboardResponse>({
    queryKey: ["/api/me/favorites/dashboard", session?.access_token],
    queryFn: async () => {
      if (!session?.access_token) {
        return {
          favorites: [],
          biggestMover: null,
          newMarkets: [],
          newPolls: [],
          alerts: [],
        } satisfies FavoritesDashboardResponse;
      }
      const res = await fetch("/api/me/favorites/dashboard", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!res.ok) {
        if (res.status === 401) {
          return {
            favorites: [],
            biggestMover: null,
            newMarkets: [],
            newPolls: [],
            alerts: [],
          } satisfies FavoritesDashboardResponse;
        }
        throw new Error(`Failed to fetch favorites dashboard: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!session?.access_token && !loading,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  return {
    ...query,
    data: query.data ?? {
      favorites: [],
      biggestMover: null,
      newMarkets: [],
      newPolls: [],
      alerts: [],
    },
    isAuthenticated: !!session?.access_token,
  };
}
