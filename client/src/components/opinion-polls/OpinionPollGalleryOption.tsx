import type { MouseEvent } from "react";
import { CheckCircle2, ImageIcon } from "lucide-react";
import { getDisplayImageUrl } from "@/lib/imageTransform";
import { cn } from "@/lib/utils";
import type { OpinionPollOptionRowMode, OpinionPollOptionRowOption } from "@/components/opinion-polls/OpinionPollOptionRow";

export function OpinionPollGalleryOption({
  pollId,
  option,
  orderLabel,
  mode,
  percent = 0,
  isLeading = false,
  onVote,
  onChangeVote,
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
  testIdPrefix: string;
  disabled?: boolean;
}) {
  const isVoteMode = mode === "vote";
  const isSelected = mode === "result-selected";
  const action = isVoteMode ? onVote : onChangeVote;
  const canAct = !!action && !isSelected && !disabled;
  const actionLabel = isVoteMode ? `Vote for ${option.name}` : `Change vote to ${option.name}`;
  const statusLabel = isVoteMode ? "Tap image to vote" : isSelected ? "Selected" : "Tap image to change";

  const imagePane = option.imageUrl ? (
    <img
      src={getDisplayImageUrl(option.imageUrl, { width: 800 })}
      alt={option.name}
      className="h-full w-full object-contain"
      draggable={false}
      loading="lazy"
    />
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
      <ImageIcon className="h-10 w-10" />
      <span className="text-sm font-medium">No image available</span>
    </div>
  );

  const content = (
    <div
      className={cn(
        "grid h-full min-h-[68dvh] grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-2xl border bg-card/90 text-left shadow-sm transition-all duration-200 md:h-[calc(95dvh-10rem)] md:min-h-0 md:grid-cols-[minmax(0,1fr)_16rem] md:grid-rows-1",
        isSelected
          ? "border-cyan-400/70 ring-2 ring-cyan-400/25"
          : "border-border/60",
        canAct
          ? "cursor-pointer touch-manipulation active:scale-[0.995] [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#EFEFEF]/50 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:border-white/40 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-1 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[#EFEFEF]/40 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:ring-white/25"
          : "cursor-default",
        disabled && "opacity-60",
      )}
    >
      <div className="relative min-h-[50dvh] bg-black/95 md:min-h-0">
        {imagePane}
        <div className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
          #{orderLabel}
        </div>
      </div>

      <div className="flex min-w-0 flex-col justify-between gap-4 border-t border-border/50 bg-background/95 p-4 sm:border-l sm:border-t-0">
        <div className="min-w-0 space-y-2">
          <div className="flex items-start gap-2">
            <h3 className={cn("min-w-0 flex-1 text-base font-semibold leading-snug", isSelected && "text-cyan-600 dark:text-cyan-300")}>
              {option.name}
            </h3>
            {isSelected ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-300" /> : null}
          </div>
          <p className="text-xs text-muted-foreground">{statusLabel}</p>
        </div>

        {isVoteMode ? (
          <div className="rounded-xl border border-border/50 bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">Results stay hidden until you vote.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{(option.votes || 0).toLocaleString("en-US")} votes</span>
              <span
                className={cn(
                  "font-mono text-sm font-bold",
                  isLeading ? "text-cyan-600 dark:text-cyan-300" : "text-muted-foreground",
                )}
              >
                {percent}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-700/50">
              <div className="h-full rounded-full bg-cyan-500 transition-all duration-700 ease-out" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (canAct) {
    return (
      <button
        type="button"
        onClick={action}
        className="block w-full snap-start rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EFEFEF]/40 dark:focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={actionLabel}
        data-testid={`${testIdPrefix}-${pollId}-${option.id}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="w-full snap-start rounded-2xl" data-testid={`${testIdPrefix}-${pollId}-${option.id}`}>
      {content}
    </div>
  );
}
