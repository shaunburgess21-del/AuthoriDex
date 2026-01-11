import { Star } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import type { FilterCategory } from "@shared/constants";

interface CategoryFilterBarProps {
  categories?: readonly string[];
  activeFilter: string;
  onFilterChange: (category: string) => void;
  onAuthRequired?: () => void;
  showFavorites?: boolean;
  testIdPrefix?: string;
  variant?: "cyan" | "violet" | "default";
  className?: string;
  showEmptyFavoritesMessage?: boolean;
}

const DEFAULT_CATEGORIES = ["All", "Tech", "Politics", "Business", "Music", "Sports", "Creator"] as const;

export function CategoryFilterBar({
  categories = DEFAULT_CATEGORIES,
  activeFilter,
  onFilterChange,
  onAuthRequired,
  showFavorites = true,
  testIdPrefix = "filter",
  variant = "cyan",
  className = "",
  showEmptyFavoritesMessage = false,
}: CategoryFilterBarProps) {
  const { user } = useAuth();
  const { favorites, isLoading } = useFavorites();

  const variantStyles = {
    cyan: {
      active: "bg-cyan-500/20 border-cyan-500/40 text-cyan-300",
      inactive: "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600",
    },
    violet: {
      active: "bg-violet-500/20 border-violet-500/40 text-violet-300",
      inactive: "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600",
    },
    default: {
      active: "bg-primary/20 border-primary/40 text-primary",
      inactive: "bg-muted/50 border-border text-muted-foreground hover:border-foreground/20",
    },
  };

  const styles = variantStyles[variant];

  const handleFavoritesClick = () => {
    if (!user) {
      onAuthRequired?.();
      return;
    }
    onFilterChange("Favorites");
  };

  const handleCategoryClick = (category: string) => {
    if (category === "Favorites") {
      handleFavoritesClick();
    } else {
      onFilterChange(category);
    }
  };

  const isFavoritesEmpty = !isLoading && favorites.length === 0;
  const showEmptyState = activeFilter === "Favorites" && isFavoritesEmpty && showEmptyFavoritesMessage;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {categories.map((cat, index) => {
          if (showFavorites && index === 1 && cat !== "Favorites") {
            return (
              <div key="favorites-insert" className="contents">
                <button
                  onClick={() => handleCategoryClick("Favorites")}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all flex items-center gap-1.5 ${
                    activeFilter === "Favorites" ? styles.active : styles.inactive
                  }`}
                  data-testid={`${testIdPrefix}-favorites`}
                  aria-label="Favorites"
                >
                  <Star className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Favorites</span>
                </button>
                <button
                  key={cat}
                  onClick={() => handleCategoryClick(cat)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                    activeFilter === cat ? styles.active : styles.inactive
                  }`}
                  data-testid={`${testIdPrefix}-${cat.toLowerCase()}`}
                >
                  {cat}
                </button>
              </div>
            );
          }

          if (cat === "Favorites") {
            return (
              <button
                key={cat}
                onClick={() => handleCategoryClick("Favorites")}
                className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all flex items-center gap-1.5 ${
                  activeFilter === "Favorites" ? styles.active : styles.inactive
                }`}
                data-testid={`${testIdPrefix}-favorites`}
                aria-label="Favorites"
              >
                <Star className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Favorites</span>
              </button>
            );
          }

          return (
            <button
              key={cat}
              onClick={() => handleCategoryClick(cat)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                activeFilter === cat ? styles.active : styles.inactive
              }`}
              data-testid={`${testIdPrefix}-${cat.toLowerCase()}`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {showEmptyState && (
        <div className="mt-4 p-4 text-center text-sm text-muted-foreground bg-muted/30 rounded-lg border border-border">
          <Star className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
          No favorites yet — tap the star icon on a celebrity to add them here.
        </div>
      )}
    </div>
  );
}

export type { FilterCategory };
