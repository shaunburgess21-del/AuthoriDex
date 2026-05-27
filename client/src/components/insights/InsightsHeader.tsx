import { INSIGHTS_TAB_VALUES, type InsightsTab, writeInsightsQuery } from "@shared/insights/filters";
import { cn } from "@/lib/utils";

const TAB_LABELS: Record<InsightsTab, string> = {
  overview: "Overview",
  rankings: "Rankings",
  discover: "Discover",
  you: "You",
  compare: "Compare",
  markets: "Markets",
};

interface InsightsHeaderProps {
  activeTab: InsightsTab;
  isLoggedIn: boolean;
}

export function InsightsHeader({ activeTab, isLoggedIn }: InsightsHeaderProps) {
  const tabs = INSIGHTS_TAB_VALUES.filter((t) => {
    if (t === "you") return isLoggedIn;
    return true;
  });

  return (
    <div
      className="sticky top-16 z-40 border-b border-border/50 bg-background/90 backdrop-blur-md"
      data-testid="insights-tab-bar"
    >
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide py-2.5 md:py-3">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => writeInsightsQuery({ tab })}
              className={cn(
                "px-3.5 py-2 rounded-full text-xs md:text-sm font-medium whitespace-nowrap transition-all border",
                activeTab === tab
                  ? "bg-blue-500/25 text-blue-600 dark:text-blue-300 border-blue-500/50 shadow-sm"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70",
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
