import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PredictDetailSectionAccent = "predict" | "live" | "insight";

const ACCENT_ICON_TILE: Record<PredictDetailSectionAccent, string> = {
  predict: "pulse-icon-purple",
  live: "pulse-icon-green",
  insight: "pulse-icon-amber",
};

const ACCENT_ICON_COLOR: Record<PredictDetailSectionAccent, string> = {
  predict: "text-violet-600 dark:text-violet-400",
  live: "text-emerald-600 dark:text-emerald-400",
  insight: "text-amber-600 dark:text-amber-400",
};

export function PredictDetailSectionHeader({
  icon: Icon,
  title,
  subtitle,
  accent = "predict",
  trailing,
  className,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  accent?: PredictDetailSectionAccent;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3", className)}>
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            ACCENT_ICON_TILE[accent],
          )}
        >
          <Icon className={cn("h-4 w-4", ACCENT_ICON_COLOR[accent])} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base sm:text-lg font-serif font-bold">{title}</h2>
            {trailing}
          </div>
          {subtitle ? (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
