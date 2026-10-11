import { Button } from "@/components/ui/button";
import type { HubActivityFilter } from "@/lib/hub-activity-filter";
import {
  positionsFilterEmptyCopy,
  positionsFilterStatusLine,
} from "@/lib/positions-filter-notice";

interface PositionsFilterNoticeProps {
  filter: HubActivityFilter;
  visibleCount: number;
  /** Ready data and nothing left in this view. Replaces the card list. */
  empty: boolean;
  onShowAll: () => void;
}

/**
 * Confirms a positions filter above the market cards, with a one-tap reset.
 * Renders nothing on "Show all".
 */
export function PositionsFilterNotice({
  filter,
  visibleCount,
  empty,
  onShowAll,
}: PositionsFilterNoticeProps) {
  if (empty) {
    const copy = positionsFilterEmptyCopy(filter);
    if (!copy) return null;
    return (
      <div
        className="mb-4 scroll-mt-32 rounded-xl border border-border/60 bg-muted/40 px-4 py-8 text-center"
        role="status"
        data-testid="predict-filter-results"
      >
        <p className="text-sm font-medium text-foreground" data-testid="predict-positions-filter-empty">
          {copy.title}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{copy.detail}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={onShowAll}
          data-testid="predict-positions-filter-show-all"
        >
          Show all
        </Button>
      </div>
    );
  }

  const line = positionsFilterStatusLine(filter, visibleCount);
  if (!line) return null;

  return (
    <div
      className="mb-4 scroll-mt-32 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
      role="status"
      data-testid="predict-filter-results"
    >
      <p className="text-sm text-foreground" data-testid="predict-positions-filter-notice">
        {line}
      </p>
      <button
        type="button"
        onClick={onShowAll}
        className="shrink-0 text-sm font-medium text-blue-600 transition-colors hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:text-blue-400 dark:hover:text-blue-300"
        data-testid="predict-positions-filter-show-all"
      >
        Show all
      </button>
    </div>
  );
}
