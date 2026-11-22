import type { Ref } from "react";
import { MessageSquare, ArrowUpDown, Clock, ExternalLink, Share2, Maximize2 } from "lucide-react";
import { hapticSelection } from "@/lib/haptic";
import { Skeleton } from "@/components/ui/skeleton";
import { inlineCommentCount, type CommentCountLabel } from "@/lib/commentCountLabel";

export type { CommentCountLabel };
export type CommentSort = "top" | "newest";

export interface CommentSortHeaderProps {
  count: number;
  countLabel: CommentCountLabel;
  /** Hide the number until the thread has loaded, so it does not flash "0 discussion". */
  countPending?: boolean;
  variant?: "card" | "inline";
  /** Snap scroll toolbar: number-only count + centered sort toggles. */
  snapHeader?: boolean;
  sort: CommentSort;
  onSortChange: (s: CommentSort) => void;
  onDetail?: () => void;
  onShare?: () => void;
  /** Opens full-screen discussion focus layer (card detail / profile). */
  onOpenFocusMode?: () => void;
  expandTriggerRef?: Ref<HTMLButtonElement>;
}

export function CommentSortHeader({
  count,
  countLabel,
  countPending = false,
  variant = "card",
  snapHeader = false,
  sort,
  onSortChange,
  onDetail,
  onShare,
  onOpenFocusMode,
  expandTriggerRef,
}: CommentSortHeaderProps) {
  const countText = snapHeader
    ? String(count)
    : variant === "card"
      ? `${countLabel} (${count})`
      : inlineCommentCount(count, countLabel);
  const countNode = countPending ? (
    <Skeleton className="h-4 w-16" role="status" data-testid="discussion-count-loading" aria-label="Loading discussion count" />
  ) : (
    <span className={`text-sm font-semibold ${onOpenFocusMode ? "text-foreground" : ""}`}>{countText}</span>
  );
  const focusButtonClass =
    "inline-flex items-center gap-2 rounded-lg text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  const countCluster = (
    <div className="flex items-center gap-2">
      {onOpenFocusMode ? (
        <button
          type="button"
          onClick={onOpenFocusMode}
          className={`${focusButtonClass} -ml-1 px-1 py-1`}
          aria-label="Open discussion in full screen"
          data-interactive="true"
          data-testid="button-discussion-label-expand"
        >
          <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500" />
          {countNode}
        </button>
      ) : (
        <>
          <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500" />
          {countNode}
        </>
      )}
      {onOpenFocusMode && (
        <button
          ref={expandTriggerRef}
          type="button"
          onClick={onOpenFocusMode}
          className={`${focusButtonClass} h-10 w-10 shrink-0 justify-center`}
          data-interactive="true"
          aria-label="Open discussion in full screen"
          data-testid="button-discussion-expand"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const sortToggles = (
    <div className="inline-flex items-center rounded-lg bg-muted/50 p-0.5">
      <button
        onClick={() => {
          hapticSelection();
          onSortChange("top");
        }}
        className={`tap-44 relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
          sort === "top" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
        }`}
        data-testid="button-sort-top"
      >
        <ArrowUpDown className="h-3 w-3" />
        Top
        {sort === "top" && (
          <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#3C83F6]" />
        )}
      </button>
      <button
        onClick={() => {
          hapticSelection();
          onSortChange("newest");
        }}
        className={`tap-44 relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
          sort === "newest" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
        }`}
        data-testid="button-sort-newest"
      >
        <Clock className="h-3 w-3" />
        Newest
        {sort === "newest" && (
          <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#3C83F6]" />
        )}
      </button>
    </div>
  );

  const actionButtons = (onDetail || onShare) && (
    <div className={`flex items-center gap-3 ${snapHeader ? "" : "ml-auto"}`}>
      {onDetail && (
        <button onClick={onDetail} className="text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" data-interactive="true">
          <ExternalLink className="h-4 w-4" />
        </button>
      )}
      {onShare && (
        <button onClick={onShare} className="text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" data-interactive="true">
          <Share2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  if (snapHeader) {
    return (
      <div className="grid grid-cols-3 items-center mb-3 px-1">
        <div className="justify-self-start">{countCluster}</div>
        <div className="justify-self-center">{sortToggles}</div>
        <div className="justify-self-end">{actionButtons}</div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mb-3 px-1">
      {countCluster}
      {sortToggles}
      {actionButtons}
    </div>
  );
}
