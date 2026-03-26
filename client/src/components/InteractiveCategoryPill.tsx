import { useState } from "react";
import { Link } from "wouter";
import { Filter, Trophy, Users, ExternalLink } from "lucide-react";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { getCategoryStyle } from "@/components/CategoryPill";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerClose,
  DrawerTitle,
} from "@/components/ui/drawer";

const SIZE_CLASSES = {
  default: "px-2 py-0.5 text-[10px]",
  sm: "px-1 py-0.5 text-[9px] leading-none font-medium",
} as const;

interface InteractiveCategoryPillProps {
  category: string;
  onFilter: () => void;
  raceMarketId?: string | null;
  leaderboardCategories?: Set<string>;
  detailHref?: string;
  detailLabel?: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
  "data-testid"?: string;
}

function MenuItems({
  label,
  category,
  raceMarketId,
  leaderboardCategories,
  detailHref,
  detailLabel,
  onFilter,
  CloseWrapper,
}: {
  label: string;
  category: string;
  raceMarketId?: string | null;
  leaderboardCategories?: Set<string>;
  detailHref?: string;
  detailLabel?: string;
  onFilter: () => void;
  CloseWrapper: React.ComponentType<{ children: React.ReactNode; asChild?: boolean }>;
}) {
  const showLeaderboard = !leaderboardCategories || leaderboardCategories.has(normalizeMarketCategory(category));

  return (
    <div className="flex flex-col gap-1 py-1">
      <CloseWrapper asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/60 transition-colors"
          onClick={onFilter}
        >
          <Filter className="h-4 w-4 opacity-60 shrink-0" />
          Filter by {label}
        </button>
      </CloseWrapper>

      {raceMarketId && (
        <CloseWrapper asChild>
          <Link
            href={`/predict/race/${raceMarketId}`}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm rounded-md hover:bg-muted/60 transition-colors no-underline text-foreground"
          >
            <Trophy className="h-4 w-4 opacity-60 shrink-0" />
            View {label} Race
          </Link>
        </CloseWrapper>
      )}

      {detailHref && (
        <CloseWrapper asChild>
          <Link
            href={detailHref}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm rounded-md hover:bg-muted/60 transition-colors no-underline text-foreground"
          >
            <ExternalLink className="h-4 w-4 opacity-60 shrink-0" />
            {detailLabel || "View Details"}
          </Link>
        </CloseWrapper>
      )}

      {showLeaderboard && (
        <CloseWrapper asChild>
          <Link
            href={`/?category=${encodeURIComponent(label)}#leaderboard`}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm rounded-md hover:bg-muted/60 transition-colors no-underline text-foreground"
          >
            <Users className="h-4 w-4 opacity-60 shrink-0" />
            View {label} on Leaderboard
          </Link>
        </CloseWrapper>
      )}
    </div>
  );
}

export function InteractiveCategoryPill({
  category,
  onFilter,
  raceMarketId,
  leaderboardCategories,
  detailHref,
  detailLabel,
  size = "default",
  className = "",
  "data-testid": testId,
}: InteractiveCategoryPillProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const style = getCategoryStyle(category);
  const sizeClass = SIZE_CLASSES[size];
  const label = getMarketCategoryLabel(category);

  const pillButton = (
    <button
      type="button"
      className={`inline-flex items-center rounded-full border w-fit whitespace-nowrap transition-all duration-200 hover:opacity-80 cursor-pointer bg-transparent ${sizeClass} ${style.bg} ${style.border} ${style.text} ${className}`}
      data-testid={testId}
    >
      {label}
    </button>
  );

  const menuProps = {
    label,
    category,
    raceMarketId,
    leaderboardCategories,
    detailHref,
    detailLabel,
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{pillButton}</DrawerTrigger>
        <DrawerContent>
          <div className="px-2 pb-4">
            <DrawerTitle className="sr-only">{label} actions</DrawerTitle>
            <MenuItems
              {...menuProps}
              onFilter={() => {
                onFilter();
                setOpen(false);
              }}
              CloseWrapper={DrawerClose}
            />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{pillButton}</PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <MenuItems
          {...menuProps}
          onFilter={() => {
            onFilter();
            setOpen(false);
          }}
          CloseWrapper={PopoverClose}
        />
      </PopoverContent>
    </Popover>
  );
}
