import { useEffect, useRef, type ComponentType, type SVGProps } from "react";
import {
  BarChart3,
  LineChart as LineChartIcon,
  Sparkles,
  Users,
  Vote as VoteIcon,
} from "lucide-react";
import { type InsightsTab, writeInsightsQuery } from "@shared/insights/filters";
import { getInsightsTabAccentHex } from "@shared/insights/constants";
import { cn } from "@/lib/utils";

const INSIGHTS_TABS: Array<{
  id: InsightsTab;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { id: "today", label: "Today", icon: Sparkles },
  { id: "rankings", label: "Rankings", icon: BarChart3 },
  { id: "vote", label: "Vote", icon: VoteIcon },
  { id: "predict", label: "Predict", icon: LineChartIcon },
  { id: "crowd", label: "Approval", icon: Users },
];

interface InsightsHeaderProps {
  activeTab: InsightsTab;
}

export function InsightsHeader({ activeTab }: InsightsHeaderProps) {
  const activeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Keep the active tab visible in the horizontally-scrollable row (mobile),
  // so users always see which tab they're on without scrolling manually.
  useEffect(() => {
    activeBtnRef.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeTab]);

  return (
    <div
      className="sticky top-16 z-40 border-b border-border/50 bg-background/90 backdrop-blur-md"
      data-testid="insights-tab-bar"
    >
      <div className="container mx-auto px-3 sm:px-4 max-w-7xl py-2.5 md:py-3">
        {/*
         * Five tabs scroll horizontally on narrow screens (icon + label on
         * every tab), matching the How It Works knowledge tab bar.
         */}
        <div
          className="mx-auto max-w-3xl"
          data-testid="insights-segmented-tabs"
        >
          <div className="flex items-center gap-0 rounded-lg bg-muted/50 p-0.5 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
            {INSIGHTS_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              const accent = getInsightsTabAccentHex(tab.id);
              return (
                <button
                  key={tab.id}
                  ref={isActive ? activeBtnRef : undefined}
                  type="button"
                  onClick={() => writeInsightsQuery({ tab: tab.id, clearFilters: true })}
                  className={cn(
                    "relative flex items-center justify-center gap-1.5",
                    "whitespace-nowrap px-2.5 sm:px-4 py-[11px]",
                    "rounded-md text-[13px] sm:text-[14px] font-medium transition-all snap-start",
                    "flex-1 min-w-fit",
                    isActive
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`insights-tab-${tab.id}`}
                  aria-pressed={isActive}
                >
                  {isActive && (
                    <span
                      className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                  )}
                  <Icon
                    className="h-[16px] w-[16px] sm:h-[18px] sm:w-[18px] shrink-0"
                    style={isActive ? { color: accent } : undefined}
                  />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
