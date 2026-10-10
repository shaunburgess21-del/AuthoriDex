import { useState } from "react";
import { cn } from "@/lib/utils";

/** Options past this count collapse behind "Show all" on detail results. */
export const COMPACT_RESULT_PREVIEW_COUNT = 6;

export type CompactResultRowData = {
  id: string;
  label: string;
  percent: number;
  votes: number;
  labelClassName: string;
  percentClassName: string;
  barClassName: string;
  emphasized?: boolean;
  testId?: string;
  percentTestId?: string;
};

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

export function CompactResultRows({
  rows,
  testId = "bar-results",
}: {
  rows: CompactResultRowData[];
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-3.5" data-testid={testId}>
      {rows.map((row) => {
        const width = clampPercent(row.percent);
        const votesLabel = `${row.votes.toLocaleString("en-US")} ${row.votes === 1 ? "vote" : "votes"}`;
        return (
          <div key={row.id} className="min-w-0" data-testid={row.testId}>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  row.emphasized ? "font-semibold" : "font-medium",
                  row.labelClassName,
                )}
                title={row.label}
              >
                {row.label}
              </span>
              <span
                className={cn("shrink-0 font-mono text-sm font-bold tabular-nums", row.percentClassName)}
                data-testid={row.percentTestId}
              >
                {row.percent}%
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {votesLabel}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div
                className={cn("h-full rounded-full transition-all duration-500", row.barClassName)}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CollapsibleCompactResultRows({
  rows,
  previewCount = COMPACT_RESULT_PREVIEW_COUNT,
  testId = "bar-results",
}: {
  rows: CompactResultRowData[];
  previewCount?: number;
  testId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const canToggle = rows.length > previewCount;
  const visible = canToggle && !expanded ? rows.slice(0, previewCount) : rows;

  return (
    <div>
      <CompactResultRows rows={visible} testId={testId} />
      {canToggle && (
        <button
          type="button"
          className="mt-3 w-full rounded-md py-1.5 text-center text-xs font-medium text-cyan-600 transition-colors hover:text-cyan-500 dark:text-cyan-400 dark:hover:text-cyan-300"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          data-testid="button-toggle-all-results"
        >
          {expanded ? "Show less" : `Show all ${rows.length.toLocaleString("en-US")}`}
        </button>
      )}
    </div>
  );
}
