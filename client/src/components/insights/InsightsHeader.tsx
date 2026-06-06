import { useEffect, useRef, type ComponentType, type SVGProps } from "react";
import {
  BarChart3,
  Compass,
  LineChart as LineChartIcon,
  Sparkles,
  Users,
  Vote as VoteIcon,
} from "lucide-react";
import { type InsightsTab, writeInsightsQuery } from "@shared/insights/filters";
import { cn } from "@/lib/utils";

const INSIGHTS_TABS: Array<{
  id: InsightsTab;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  accent: string;
}> = [
  { id: "today", label: "Today", icon: Sparkles, accent: "#94A3B8" },
  { id: "rankings", label: "Rankings", icon: BarChart3, accent: "#3B82F6" },
  { id: "discover", label: "Discover", icon: Compass, accent: "#F97316" },
  { id: "vote", label: "Vote", icon: VoteIcon, accent: "#22D3EE" },
  { id: "predict", label: "Predict", icon: LineChartIcon, accent: "#8B5CF6" },
  { id: "crowd", label: "Crowd", icon: Users, accent: "#22D3EE" },
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
         * 6 tabs is too many for a single row at very narrow widths, so we
         * collapse to icons-only with a horizontally scrollable, snap-aligned
         * row at < sm. Active tab still shows its label so the user always
         * sees where they are. Desktop keeps all labels visible.
         */}
        <div
          className="mx-auto max-w-3xl"
          data-testid="insights-segmented-tabs"
        >
          <div className="flex items-center gap-0 rounded-lg bg-muted/50 p-0.5 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
            {INSIGHTS_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  ref={isActive ? activeBtnRef : undefined}
                  type="button"
                  onClick={() => writeInsightsQuery({ tab: tab.id, clearFilters: true })}
                  className={cn(
                    "relative flex items-center justify-center gap-1.5",
                    "whitespace-nowrap px-2.5 sm:px-4 py-[10px] sm:py-[11px]",
                    "rounded-md text-[12px] sm:text-[14px] font-medium transition-all snap-start",
                    // Mobile: equal-width icon-only tabs (label shows when active).
                    // Desktop: each tab grows to fill the bar and shows its label.
                    "flex-1 min-w-fit",
                    isActive
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`insights-tab-${tab.id}`}
                  aria-label={tab.label}
                  aria-pressed={isActive}
                >
                  {isActive && (
                    <span
                      className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full"
                      style={{ backgroundColor: tab.accent }}
                    />
                  )}
                  <Icon
                    className="h-[16px] w-[16px] sm:h-[18px] sm:w-[18px] shrink-0"
                    style={isActive ? { color: tab.accent } : undefined}
                  />
                  <span className={cn(isActive ? "inline" : "hidden sm:inline")}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
