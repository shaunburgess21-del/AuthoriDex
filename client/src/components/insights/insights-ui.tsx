import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { InsightsPrimaryDriver } from "@shared/insights/types";
import type { InsightsSource, InsightsTab } from "@shared/insights/filters";
import {
  getInsightsTabCardClass,
  INSIGHTS_DRIVER_LABELS,
  INSIGHTS_SOURCE_LABELS,
} from "@shared/insights/constants";

export const DRIVER_DISPLAY: Record<InsightsPrimaryDriver, string> = INSIGHTS_DRIVER_LABELS;

export const SOURCE_DISPLAY: Record<InsightsSource, string> = INSIGHTS_SOURCE_LABELS;

/** Pulse-card classes for shadcn Card — pulse-card sets border/glow; drop Card shadow only. */
export function insightsTabShadcnCardClass(tab: InsightsTab, ...extra: Parameters<typeof cn>) {
  return cn("shadow-none", getInsightsTabCardClass(tab), ...extra);
}

export function InsightsSection({
  title,
  description,
  action,
  children,
  className,
  tab,
}: {
  /** Section title — strings render in a default heading; ReactNode lets tiles inline icons. */
  title: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tab: InsightsTab;
}) {
  return (
    <section
      className={cn(
        "rounded-xl bg-card/40 overflow-hidden",
        getInsightsTabCardClass(tab),
        className,
      )}
    >
      <div className="px-4 pt-4 pb-2 border-b border-border/30 bg-card/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">{description}</p>
            )}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function InsightsPill({
  active,
  children,
  onClick,
  title,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border",
        active
          ? "bg-blue-500/25 text-blue-600 dark:text-blue-300 border-blue-500/50 shadow-sm"
          : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function InsightsEmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm text-muted-foreground text-center py-10 px-4 rounded-lg bg-muted/20 border border-dashed border-border/50">
      {message}
    </p>
  );
}
