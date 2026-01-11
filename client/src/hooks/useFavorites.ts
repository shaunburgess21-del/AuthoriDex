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
  const { user } = useAuth();

  const { data: favorites = [], isLoading, error } = useQuery<FavoriteItem[]>({
    queryKey: ["/api/me/favorites"],
    enabled: !!user,
  });

  const favoriteIds = new Set(favorites.map((f) => f.celebrityId));

  const isFavorite = (celebrityId: string) => favoriteIds.has(celebrityId);

  return {
    favorites,
    favoriteIds,
    isFavorite,
    isLoading,
    error,
    isAuthenticated: !!user,
  };
}
