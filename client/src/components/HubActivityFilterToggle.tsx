/**
 * Desktop hub filter, in the row beside the category menu.
 * Same cycle as the floating eye: all → not yet acted → mine only.
 */
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { FILTER_INACTIVE_SECTION_TOGGLE } from "@/lib/filterControlStyles";
import {
  hubActivityFilterFabAriaLabel,
  hubActivityFilterFabLabel,
  hubActivityFilterLongestLabel,
  type HubActivityFilter,
  type HubActivityFilterScope,
} from "@/lib/hub-activity-filter";
import { ActivityFilterCountBadge } from "@/components/VoteActivityFilterFab";

export interface HubActivityFilterToggleProps {
  scope?: HubActivityFilterScope;
  value: HubActivityFilter;
  count: number;
  ownedCount?: number;
  onCycle: () => void;
  /** Predict weekly uses blue; world uses violet. Vote stays cyan. */
  accent?: "vote" | "weekly" | "world";
}

export function HubActivityFilterToggle({
  scope = "vote",
  value,
  count,
  ownedCount,
  onCycle,
  accent = scope === "predict" ? "world" : "vote",
}: HubActivityFilterToggleProps) {
  const label = hubActivityFilterFabLabel(scope, value);
  const longestLabel = hubActivityFilterLongestLabel(scope);
  const testId = scope === "predict" ? "predict-activity-filter-desktop" : "vote-activity-filter-desktop";
  const mineClass =
    accent === "weekly"
      ? "bg-blue-500/25 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/50 dark:border-blue-400/40"
      : accent === "world"
        ? "bg-violet-500/20 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/40"
        : "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50 dark:border-cyan-400/40";

  return (
    <button
      type="button"
      onClick={onCycle}
      className={cn(
        "hidden md:inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        value === "hide-mine"
          ? "border border-amber-500/50 bg-amber-500/15 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400"
          : value === "show-mine"
            ? mineClass
            : FILTER_INACTIVE_SECTION_TOGGLE,
      )}
      aria-label={hubActivityFilterFabAriaLabel(scope, value, count, ownedCount)}
      data-testid={testId}
    >
      {/* Width follows the longest label plus the 999+ badge, so cycling
          All votes / Not voted / Votes only does not shift the chips. */}
      <span className="relative inline-flex items-center">
        <span className="invisible flex items-center gap-2" aria-hidden>
          <span className="h-4 w-4 shrink-0" />
          <span>{longestLabel}</span>
          <span className="inline-flex h-[18px] min-w-[2.75rem] px-1 text-[10px]">999+</span>
        </span>
        <span className="absolute inset-0 flex items-center gap-2">
          {value === "hide-mine" ? (
            <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Eye className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span data-testid={`${testId}-label`}>{label}</span>
          {value !== "all" && count > 0 ? (
            <ActivityFilterCountBadge
              count={count}
              testId={`${testId}-count`}
              className={cn(
                value === "hide-mine"
                  ? "bg-amber-500 text-black"
                  : accent === "vote"
                    ? "bg-cyan-400 text-black"
                    : accent === "weekly"
                      ? "bg-blue-500 text-white"
                      : "bg-violet-400 text-black",
              )}
            />
          ) : null}
        </span>
      </span>
    </button>
  );
}
