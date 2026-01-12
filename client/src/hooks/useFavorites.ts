import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface FavoriteItem {
  id: string;
  celebrityId: string;
  name: string;
  imageUrl: string | null;
  category: string;
  rank: number;
  change: number;
}

export function useFavorites() {
  const { session, loading } = useAuth();

  const { data: favorites = [], isLoading, error } = useQuery<FavoriteItem[]>({
    queryKey: ["/api/me/favorites", session?.access_token],
    queryFn: async () => {
      if (!session?.access_token) return [];
      
      const res = await fetch("/api/me/favorites", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });
      
      if (!res.ok) {
        if (res.status === 401) return [];
        throw new Error(`Failed to fetch favorites: ${res.status}`);
      }
      
      return res.json();
    },
    enabled: !!session?.access_token && !loading,
  });

  const favoriteIds = new Set(favorites.map((f) => f.celebrityId));

  const isFavorite = (celebrityId: string) => favoriteIds.has(celebrityId);

  return {
    favorites,
    favoriteIds,
    isFavorite,
    isLoading,
    error,
    isAuthenticated: !!session,
  };
}
