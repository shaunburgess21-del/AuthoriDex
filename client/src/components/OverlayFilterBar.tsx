import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterDropdown } from "@/components/FilterDropdown";
import { Search, Star, Flame, LayoutGrid, Cpu, Landmark, Briefcase, Trophy, Music2, Gamepad2, Video, UtensilsCrossed, Heart, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const DEFAULT_ICONS: Record<string, LucideIcon> = {
  all: LayoutGrid,
  All: LayoutGrid,
  favorites: Star,
  Favorites: Star,
  trending: Flame,
  Trending: Flame,
  tech: Cpu,
  Tech: Cpu,
  politics: Landmark,
  Politics: Landmark,
  business: Briefcase,
  Business: Briefcase,
  music: Music2,
  Music: Music2,
  sports: Trophy,
  Sports: Trophy,
  "film-tv": LayoutGrid,
  "Film & TV": LayoutGrid,
  gaming: Gamepad2,
  Gaming: Gamepad2,
  creator: Video,
  Creator: Video,
  "food-drink": UtensilsCrossed,
  "Food & Drink": UtensilsCrossed,
  lifestyle: Heart,
  Lifestyle: Heart,
  misc: Sparkles,
};

interface OverlayFilterBarProps {
  value: string;
  onChange: (value: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  categories: { value: string; label: string }[];
  allValue: string;
  placeholder?: string;
  testIdPrefix?: string;
  variant?: "vote" | "predict";
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
  const isVote = variant === "vote";
  const activeClasses = isVote
    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
    : "bg-violet-500/20 text-violet-300 border border-violet-400/40";
  const inactiveClasses = isVote
    ? "bg-slate-800/30 border-slate-700/40 text-slate-400 hover:border-slate-600"
    : "bg-background/50 border border-border/50 text-muted-foreground hover:bg-muted/80 hover:border-violet-400/20";

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
            className="pl-10 h-9 bg-slate-800/30 border-slate-700/40"
            data-testid={`${testIdPrefix}-search`}
          />
        </div>
      </div>

      {/* Desktop: pills + search */}
      <div className="hidden md:flex items-center gap-3">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1 min-w-0">
          {categories.map((cat) => {
            const isFavorites = cat.value.toLowerCase() === "favorites";
            const IconComponent = DEFAULT_ICONS[cat.value] || DEFAULT_ICONS[cat.value.toLowerCase()] || LayoutGrid;
            const isActive = value.toLowerCase() === cat.value.toLowerCase();

            return (
              <button
                key={cat.value}
                onClick={() => {
                  if (isFavorites && !user && onAuthRequired) {
                    onAuthRequired();
                    return;
                  }
                  onChange(cat.value);
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  isActive ? activeClasses : inactiveClasses
                }`}
                data-testid={`${testIdPrefix}-pill-${cat.value.toLowerCase()}`}
                aria-label={isFavorites ? "Favorites" : undefined}
              >
                <IconComponent className="h-3.5 w-3.5" />
                {isFavorites ? (
                  <span className="hidden lg:inline">{cat.label}</span>
                ) : (
                  cat.label
                )}
              </button>
            );
          })}
        </div>
        <div className="relative w-[184px] flex-none">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={placeholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 h-9 bg-slate-800/30 border-slate-700/40"
            data-testid={`${testIdPrefix}-search-desktop`}
          />
        </div>
      </div>
    </div>
  );
}
