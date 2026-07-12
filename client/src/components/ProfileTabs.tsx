import type { ComponentType, ReactNode, SVGProps } from "react";
import { Eye, Vote, TrendingUp } from "lucide-react";

export interface ProfileTab {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  accent: string;
  /** Optional small count chip rendered after the label (e.g. live market count). */
  badge?: ReactNode;
}

interface ProfileTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  /** When true (e.g. sticky bar), no bottom margin so content flows flush below */
  noBottomMargin?: boolean;
  /**
   * Optional override for the set of tabs. When omitted the component renders the
   * default "Overview / Vote / Predict" triplet used on celebrity profile pages.
   */
  tabs?: ProfileTab[];
}

export const DEFAULT_TABS: ProfileTab[] = [
  { id: "overview", label: "Overview", icon: Eye, accent: "#3C83F6" },
  { id: "vote", label: "Vote", icon: Vote, accent: "#22D3EE" },
  { id: "predict", label: "Predict", icon: TrendingUp, accent: "#8B5CF6" },
];

export function ProfileTabs({ activeTab, onTabChange, noBottomMargin, tabs }: ProfileTabsProps) {
  const items = tabs ?? DEFAULT_TABS;
  return (
    <div className={noBottomMargin ? "" : "mb-6"} data-testid="profile-tabs">
      <div className="flex items-center rounded-lg bg-muted/50 p-0.5 w-full overflow-hidden">
        {items.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative flex items-center justify-center gap-2 flex-1
                whitespace-nowrap px-2 sm:px-5 py-[13px] rounded-md text-[15px] font-medium transition-all
                ${isActive
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
                }
              `}
              data-testid={`tab-${tab.id}`}
            >
              {isActive && (
                <span
                  className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full"
                  style={{ backgroundColor: tab.accent }}
                />
              )}
              <Icon
                className="h-[18px] w-[18px]"
                style={isActive ? { color: tab.accent } : undefined}
              />
              {tab.label}
              {tab.badge != null && (
                <span
                  className={`ml-0.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
                    isActive ? "" : "bg-muted text-muted-foreground"
                  }`}
                  style={
                    isActive
                      ? { backgroundColor: `${tab.accent}26`, color: tab.accent }
                      : undefined
                  }
                  data-testid={`tab-${tab.id}-badge`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
