import { MessageSquare, ArrowUpDown, Clock, ExternalLink, Share2 } from "lucide-react";

export type CommentCountLabel = "Discussion" | "Comments" | "Insights" | "Replies";
export type CommentSort = "top" | "newest";

export interface CommentSortHeaderProps {
  count: number;
  countLabel: CommentCountLabel;
  variant?: "card" | "inline";
  sort: CommentSort;
  onSortChange: (s: CommentSort) => void;
  onDetail?: () => void;
  onShare?: () => void;
}

export function CommentSortHeader({
  count,
  countLabel,
  variant = "card",
  sort,
  onSortChange,
  onDetail,
  onShare,
}: CommentSortHeaderProps) {
  const inlineCountWord = countLabel === "Comments"
    ? (count === 1 ? "comment" : "comments")
    : count === 1
      ? countLabel.toLowerCase().replace(/s$/, "")
      : countLabel.toLowerCase();

  return (
    <div className="flex items-center gap-2 mb-3 px-1">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500" />
        <span className="text-sm font-semibold">
          {variant === "card" ? `${countLabel} (${count})` : `${count} ${inlineCountWord}`}
        </span>
      </div>
      <div className="inline-flex items-center rounded-lg bg-muted/50 p-0.5">
        <button
          onClick={() => onSortChange("top")}
          className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
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
          className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
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
      {(onDetail || onShare) && (
        <div className="flex items-center gap-3 ml-auto">
          {onDetail && (
            <button onClick={onDetail} className="text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors" data-interactive="true">
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          {onShare && (
            <button onClick={onShare} className="text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors" data-interactive="true">
              <Share2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
