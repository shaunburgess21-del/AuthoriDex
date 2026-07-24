import { Input } from "@/components/ui/input";
import {
  FILTER_INACTIVE_PILL_PREDICT,
  FILTER_INACTIVE_PILL_WEEKLY,
  FILTER_INACTIVE_PILL_VOTE,
  FILTER_ACTIVE_CHIP_WEEKLY,
  FILTER_ACTIVE_CHIP_WORLD,
  FILTER_ROW_SEARCH_INPUT,
  CATEGORY_CHIP_RADIUS,
} from "@/lib/filterControlStyles";
import { cn } from "@/lib/utils";
import { FilterDropdown } from "@/components/FilterDropdown";
import { ScrollMaskedChipRow } from "@/components/ScrollMaskedChipRow";
import { Search } from "lucide-react";
import { getFilterCategoryIcon } from "@/components/interests/categoryIcons";

interface OverlayFilterBarProps {
  value: string;
  onChange: (value: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  categories: { value: string; label: string }[];
  allValue: string;
  placeholder?: string;
  testIdPrefix?: string;
  /** vote = cyan; predict = World violet; predict-weekly = VoxDex blue. */
  variant?: "vote" | "predict" | "predict-weekly";
  user?: any;
  onAuthRequired?: () => void;
}

export function OverlayFilterBar({
  value,
  onChange,
  searchValue,
  onSearchChange,
  categories,
  allValue,
  placeholder = "Search...",
  testIdPrefix = "overlay-filter",
  variant = "vote",
  user,
  onAuthRequired,
}: OverlayFilterBarProps) {
  const activeClasses =
    variant === "vote"
      ? "bg-cyan-500/25 dark:bg-cyan-500/20 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
      : variant === "predict-weekly"
        ? FILTER_ACTIVE_CHIP_WEEKLY
        : FILTER_ACTIVE_CHIP_WORLD;
  const inactiveClasses =
    variant === "vote"
      ? FILTER_INACTIVE_PILL_VOTE
      : variant === "predict-weekly"
        ? FILTER_INACTIVE_PILL_WEEKLY
        : FILTER_INACTIVE_PILL_PREDICT;

  return (
    <div className="sticky top-0 z-10 px-4 py-3 border-b bg-background/95 backdrop-blur-sm">
      {/* Mobile: dropdown + search */}
      <div className="flex items-center gap-2 md:hidden">
        <FilterDropdown
          value={value}
          onChange={onChange}
          categories={categories}
          allValue={allValue}
          testId={`${testIdPrefix}-dropdown`}
        />
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={placeholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className={cn("pl-10 h-9", FILTER_ROW_SEARCH_INPUT)}
            data-testid={`${testIdPrefix}-search`}
          />
        </div>
      </div>

      {/* Desktop: pills + search */}
      <div className="hidden md:flex items-center gap-3">
        <ScrollMaskedChipRow className="flex-1 min-w-0" activeChipKey={value}>
          {categories.map((cat) => {
            const isFavorites = cat.value.toLowerCase() === "favorites";
            const IconComponent = getFilterCategoryIcon(cat.value);
            const isActive = value.toLowerCase() === cat.value.toLowerCase();

            return (
              <button
                type="button"
                key={cat.value}
                data-scroll-chip={cat.value}
                onClick={() => {
                  if (isFavorites && !user && onAuthRequired) {
                    onAuthRequired();
                    return;
                  }
                  onChange(cat.value);
                }}
                className={`${CATEGORY_CHIP_RADIUS} px-3 py-1.5 text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  isActive ? activeClasses : inactiveClasses
                }`}
                data-testid={`${testIdPrefix}-pill-${cat.value.toLowerCase()}`}
              >
                <IconComponent className="h-3.5 w-3.5" />
                {cat.label}
              </button>
            );
          })}
        </ScrollMaskedChipRow>
        <div className="relative w-[184px] flex-none">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={placeholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className={cn("pl-10 h-9", FILTER_ROW_SEARCH_INPUT)}
            data-testid={`${testIdPrefix}-search-desktop`}
          />
        </div>
      </div>
    </div>
  );
}
