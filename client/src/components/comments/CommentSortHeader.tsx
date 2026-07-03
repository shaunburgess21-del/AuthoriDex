import type { Ref } from "react";
import { MessageSquare, ArrowUpDown, Clock, ExternalLink, Share2, Maximize2 } from "lucide-react";

export type CommentCountLabel = "Discussion" | "Comments" | "Insights" | "Replies";
export type CommentSort = "top" | "newest";

const COUNT_WORDS: Record<CommentCountLabel, [singular: string, plural: string]> = {
  Discussion: ["discussion", "discussion"],
  Comments: ["comment", "comments"],
  Insights: ["insight", "insights"],
  Replies: ["reply", "replies"],
};

export interface CommentSortHeaderProps {
  count: number;
  countLabel: CommentCountLabel;
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
  variant = "card",
  snapHeader = false,
  sort,
  onSortChange,
  onDetail,
  onShare,
  onOpenFocusMode,
  expandTriggerRef,
}: CommentSortHeaderProps) {
  const [singularCountWord, pluralCountWord] = COUNT_WORDS[countLabel];
  const inlineCountWord = count === 1 ? singularCountWord : pluralCountWord;
  const countText = snapHeader
    ? String(count)
    : variant === "card"
      ? `${countLabel} (${count})`
      : `${count} ${inlineCountWord}`;
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
          <span className="text-sm font-semibold text-foreground">{countText}</span>
        </button>
      ) : (
        <>
          <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500" />
          <span className="text-sm font-semibold">{countText}</span>
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
        onClick={() => onSortChange("top")}
        className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
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
        onClick={() => onSortChange("newest")}
        className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
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
