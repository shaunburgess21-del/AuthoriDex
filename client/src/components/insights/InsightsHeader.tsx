import type { ComponentType, SVGProps } from "react";
import { BarChart3, Compass, Sparkles, Users } from "lucide-react";
import { type InsightsTab, writeInsightsQuery } from "@shared/insights/filters";

const INSIGHTS_TABS: Array<{
  id: InsightsTab;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  accent: string;
}> = [
  { id: "today", label: "Today", icon: Sparkles, accent: "#3C83F6" },
  { id: "rankings", label: "Rankings", icon: BarChart3, accent: "#6366F1" },
  { id: "discover", label: "Discover", icon: Compass, accent: "#8B5CF6" },
  { id: "crowd", label: "Crowd", icon: Users, accent: "#22D3EE" },
];

interface InsightsHeaderProps {
  activeTab: InsightsTab;
}

export function InsightsHeader({ activeTab }: InsightsHeaderProps) {
  return (
    <div
      className="sticky top-16 z-40 border-b border-border/50 bg-background/90 backdrop-blur-md"
      data-testid="insights-tab-bar"
    >
      <div className="container mx-auto px-4 max-w-7xl py-2.5 md:py-3">
        <div className="max-w-xl mx-auto" data-testid="insights-segmented-tabs">
          <div className="flex items-center gap-0 rounded-lg bg-muted/50 p-0.5 overflow-x-auto scrollbar-hide">
            {INSIGHTS_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => writeInsightsQuery({ tab: tab.id })}
                  className={`
                    relative flex items-center justify-center gap-1.5 flex-1
                    whitespace-nowrap px-2.5 sm:px-4 py-[11px] rounded-md text-[13px] sm:text-[14px] font-medium transition-all
                    min-w-fit
                    ${isActive
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                    }
                  `}
                  data-testid={`insights-tab-${tab.id}`}
                >
                  {isActive && (
                    <span
                      className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full"
                      style={{ backgroundColor: tab.accent }}
                    />
                  )}
                  <Icon
                    className="h-[16px] w-[16px] sm:h-[18px] sm:w-[18px]"
                    style={isActive ? { color: tab.accent } : undefined}
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
