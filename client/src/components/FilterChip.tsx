import { getMarketCategoryLabel } from "@shared/constants";
import { getFilterCategoryIcon } from "@/components/interests/categoryIcons";
import { getCategoryStyle } from "@/components/CategoryPill";
import {
  CATEGORY_CHIP_RADIUS,
  FILTER_ACTIVE_CHIP_VOTE,
  FILTER_ACTIVE_CHIP_WEEKLY,
  FILTER_ACTIVE_CHIP_WORLD,
  FILTER_INACTIVE_PILL_VOTE,
  FILTER_INACTIVE_PILL_WEEKLY,
  FILTER_INACTIVE_PILL_PREDICT,
} from "@/lib/filterControlStyles";

export type FilterChipAccent = "vote" | "weekly" | "world";

const ACTIVE_BY_ACCENT: Record<FilterChipAccent, string> = {
  vote: FILTER_ACTIVE_CHIP_VOTE,
  weekly: FILTER_ACTIVE_CHIP_WEEKLY,
  world: FILTER_ACTIVE_CHIP_WORLD,
};

const INACTIVE_BY_ACCENT: Record<FilterChipAccent, string> = {
  vote: FILTER_INACTIVE_PILL_VOTE,
  weekly: FILTER_INACTIVE_PILL_WEEKLY,
  world: FILTER_INACTIVE_PILL_PREDICT,
};

/**
 * Category filter chip shared by Vote and Predict filter rows.
 * Favorites requires auth — the click is intercepted and `onAuthRequired`
 * fires instead when no user is present.
 */
export function FilterChip({
  category,
  label,
  isActive,
  onClick,
  testIdPrefix,
  user,
  onAuthRequired,
  accent = "vote",
  isCustomTopic = false,
}: {
  category: string;
  /** Registry / builder display label for non-pinned categories. */
  label?: string;
  isActive: boolean;
  onClick: () => void;
  testIdPrefix: string;
  user?: unknown;
  onAuthRequired?: () => void;
  accent?: FilterChipAccent;
  isCustomTopic?: boolean;
}) {
  const isFavorites = category === "favorites";
  const IconComponent = getFilterCategoryIcon(category);

  // Meta chips (All / Favorites / Trending) have no badge color and keep the
  // page accent; real categories take their own theme color when active so the
  // chip matches the category badges on the cards below.
  const isMetaCategory = category === "all" || category === "favorites" || category === "trending";
  const categoryStyle = getCategoryStyle(category);
  const activeClass = isMetaCategory
    ? ACTIVE_BY_ACCENT[accent]
    : `${categoryStyle.bg} ${categoryStyle.border} border ${categoryStyle.text} shadow-sm`;

  const handleClick = () => {
    if (isFavorites && !user) {
      onAuthRequired?.();
      return;
    }
    onClick();
  };

  const getDisplayLabel = () => {
    if (category === "all") {
      return (
        <>
          <span className="hidden md:inline">All Categories</span>
          <span className="md:hidden">All</span>
        </>
      );
    }
    if (category === "favorites") return "Favorites";
    if (category === "trending") return "Trending";
    return label ?? getMarketCategoryLabel(category);
  };

  const getTestId = () => {
    if (isCustomTopic) return `${testIdPrefix}-custom-topic`;
    return `${testIdPrefix}-${category.toLowerCase()}`;
  };

  return (
    <button
      onClick={handleClick}
      data-scroll-chip={category}
      className={`${CATEGORY_CHIP_RADIUS} px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${
        isActive ? activeClass : INACTIVE_BY_ACCENT[accent]
      }`}
      data-testid={getTestId()}
    >
      <IconComponent className="h-3.5 w-3.5" />
      {getDisplayLabel()}
    </button>
  );
}
