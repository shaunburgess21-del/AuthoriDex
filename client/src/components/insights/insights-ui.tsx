import type { ReactNode } from "react";
import {
  FILTER_ACTIVE_PILL_RANKINGS,
  FILTER_INACTIVE_SECTION_TOGGLE,
} from "@/lib/filterControlStyles";
import { cn } from "@/lib/utils";
import type { InsightsPrimaryDriver } from "@shared/insights/types";
import type { InsightsSource, InsightsTab, InsightsWindow } from "@shared/insights/filters";
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

export function InsightsWindowToggle({
  value,
  onChange,
  ariaLabel = "Time window",
}: {
  value: InsightsWindow;
  onChange: (window: InsightsWindow) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-border/50 bg-muted/40 p-0.5 text-[11px] font-medium"
      role="group"
      aria-label={ariaLabel}
    >
      {(["24h", "7d"] as const).map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={value === w}
          onClick={() => onChange(w)}
          className={cn(
            "rounded-md px-3 py-1.5 transition-colors tabular-nums",
            value === w
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {w}
        </button>
      ))}
    </div>
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
      aria-pressed={active}
      className={cn(
        "flex min-w-fit items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all sm:px-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active ? FILTER_ACTIVE_PILL_RANKINGS : FILTER_INACTIVE_SECTION_TOGGLE,
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
