import type { MouseEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { getDisplayImageUrl } from "@/lib/imageTransform";

export type OpinionPollOptionRowOption = {
  id: string;
  name: string;
  imageUrl?: string | null;
  votes?: number;
  orderIndex?: number;
};

export type OpinionPollOptionRowMode = "vote" | "result-selected" | "result-other";

export function OpinionPollOptionRow({
  pollId,
  option,
  orderLabel,
  mode,
  percent = 0,
  isLeading = false,
  onVote,
  onChangeVote,
  onExpandImage,
  testIdPrefix,
  disabled = false,
}: {
  pollId: string;
  option: OpinionPollOptionRowOption;
  orderLabel: number;
  mode: OpinionPollOptionRowMode;
  percent?: number;
  isLeading?: boolean;
  onVote?: (e: MouseEvent) => void;
  onChangeVote?: (e: MouseEvent) => void;
  onExpandImage: (url: string, alt: string) => void;
  testIdPrefix: string;
  disabled?: boolean;
}) {
  const imageColumn = option.imageUrl ? (
    <button
      type="button"
      aria-label="View larger image"
      disabled={disabled}
      onClick={() => onExpandImage(option.imageUrl!, option.name)}
      className="relative shrink-0 w-14 self-stretch min-h-[2.75rem] cursor-zoom-in border-0 p-0 disabled:cursor-not-allowed"
    >
      <img src={getDisplayImageUrl(option.imageUrl!, { width: 200 })} alt={option.name} className="absolute inset-0 h-full w-full object-cover" />
    </button>
  ) : (
    <div className="relative flex shrink-0 w-14 items-center justify-center self-stretch min-h-[2.75rem] bg-cyan-500/15 dark:bg-cyan-500/10">
      <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">{orderLabel}</span>
    </div>
  );

  if (mode === "vote") {
    return (
      <div
        className={`w-full flex items-stretch overflow-hidden rounded-lg border border-border/50 bg-muted/30 p-0 text-left transition-all duration-200 touch-manipulation [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#EFEFEF]/50 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/50 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:border-white/40 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/5 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-1 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-inset [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[#EFEFEF]/40 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:ring-white/25 active:border-[#EFEFEF]/40 active:bg-muted/45 dark:active:border-white/35 dark:active:bg-white/[0.07] active:ring-1 active:ring-inset active:ring-[#EFEFEF]/30 dark:active:ring-white/20 ${disabled ? "opacity-60" : ""}`}
        data-testid={`${testIdPrefix}-${pollId}-${option.id}`}
      >
        {imageColumn}
        <button
          type="button"
          onClick={onVote}
          disabled={disabled}
          className={`flex min-w-0 flex-1 flex-col items-stretch py-1.5 pl-2.5 pr-2 text-left transition-transform active:scale-[0.99] ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
        >
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm">{option.name}</span>
            <span className="shrink-0 text-xs font-mono font-bold text-slate-600">%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-700/50" />
          <p className="text-[10px] text-slate-600 mt-0.5">Votes</p>
        </button>
      </div>
    );
  }

  const isSelected = mode === "result-selected";
  const rowClass = `flex items-stretch overflow-hidden rounded-lg border transition-all duration-300 ${
    isSelected
      ? "border-white/40 dark:border-white/50 border-l-4 border-l-cyan-500 bg-slate-200/60 dark:bg-black/30 ring-1 ring-cyan-500/20 dark:ring-cyan-400/15 ring-inset"
      : "border-border/30 bg-muted/20"
  }`;
  const contentColumn = (
    <div className="flex-1 min-w-0 py-1.5 pl-2.5 pr-2">
      <div className="flex items-center gap-1.5">
        <span className={`min-w-0 flex-1 truncate text-sm ${isSelected ? "font-semibold" : ""}`}>{option.name}</span>
        {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />}
        <span
          className={`shrink-0 text-xs font-mono font-bold ${
            isLeading ? "text-cyan-600 dark:text-cyan-400" : "text-muted-foreground"
          }`}
        >
          {percent}%
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
        <div
          className="h-full rounded-full bg-cyan-500 transition-all duration-700 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {(option.votes || 0).toLocaleString("en-US")} votes
      </p>
    </div>
  );

  if (isSelected) {
    return (
      <div className={rowClass} data-testid={`${testIdPrefix}-${pollId}-${option.id}`}>
        {imageColumn}
        {contentColumn}
      </div>
    );
  }

  return (
    <div className={`${rowClass} w-full`} data-testid={`${testIdPrefix}-${pollId}-${option.id}`}>
      {imageColumn}
      <button
        type="button"
        disabled={disabled}
        className={`min-w-0 flex-1 text-left cursor-pointer rounded-r-md touch-manipulation [@media(hover:hover)_and_(pointer:fine)]:hover:ring-1 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-inset [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[#EFEFEF]/50 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:ring-white/35 active:ring-1 active:ring-inset active:ring-[#EFEFEF]/45 dark:active:ring-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EFEFEF]/40 dark:focus-visible:ring-white/30 border-0 bg-transparent p-0 ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
        onClick={onChangeVote}
      >
        {contentColumn}
      </button>
    </div>
  );
}
