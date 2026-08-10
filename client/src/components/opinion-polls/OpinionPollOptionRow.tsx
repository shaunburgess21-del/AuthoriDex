import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";
import { CheckCircle2, Maximize2 } from "lucide-react";
import { getDisplayImageUrl } from "@/lib/imageTransform";
import { cn } from "@/lib/utils";

export type OpinionPollOptionRowOption = {
  id: string;
  name: string;
  imageUrl?: string | null;
  votes?: number;
  orderIndex?: number;
};

export type OpinionPollOptionRowMode = "vote" | "result-selected" | "result-other";
export type OpinionPollOptionImageInteraction = "lightbox" | "gallery";

/** Movement beyond this (px) marks the gesture as a swipe, not a tap —
 * mirrors SWIPE_CLICK_GUARD_PX used by notification rows. */
const TAP_SLOP_PX = 10;

export const OPTION_ROW_HOVER_CLASSES =
  "touch-manipulation [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#EFEFEF]/50 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/50 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:border-white/40 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/5 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-1 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-inset [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[#EFEFEF]/40 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:ring-white/25 active:border-[#EFEFEF]/40 active:bg-muted/45 dark:active:border-white/35 dark:active:bg-white/[0.07] active:ring-1 active:ring-inset active:ring-[#EFEFEF]/30 dark:active:ring-white/20";

function collectScrollSnapshots(el: HTMLElement): Array<{ node: HTMLElement; top: number }> {
  const snaps: Array<{ node: HTMLElement; top: number }> = [];
  let node: HTMLElement | null = el;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      snaps.push({ node, top: node.scrollTop });
    }
    node = node.parentElement;
  }
  return snaps;
}

/**
 * Distinguishes a genuine tap from a scroll/swipe that started on a button.
 * Without this, vertical swipes over Opinion Poll options in snap/Quick Vote
 * fire onClick and register as votes instead of advancing to the next card.
 *
 * Uses two signals: pointer travel past TAP_SLOP_PX, and any scroll-parent
 * scrollTop change (browsers often stop delivering pointermove once a
 * parent scroller takes the gesture).
 */
function useTapClickGuard() {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const scrollSnapsRef = useRef<Array<{ node: HTMLElement; top: number }>>([]);

  const onPointerDown = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    draggedRef.current = false;
    scrollSnapsRef.current = collectScrollSnapshots(e.currentTarget);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    const start = startRef.current;
    if (!start || draggedRef.current) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) {
      draggedRef.current = true;
    }
  }, []);

  const onPointerUp = useCallback(() => {
    startRef.current = null;
  }, []);

  const onPointerCancel = useCallback(() => {
    startRef.current = null;
    draggedRef.current = false;
    scrollSnapsRef.current = [];
  }, []);

  const guardClick = useCallback((e: MouseEvent<HTMLButtonElement>, action?: (e: MouseEvent) => void) => {
    const scrolled = scrollSnapsRef.current.some(({ node, top }) => node.scrollTop !== top);
    if (draggedRef.current || scrolled) {
      e.preventDefault();
      e.stopPropagation();
      draggedRef.current = false;
      scrollSnapsRef.current = [];
      return;
    }
    action?.(e);
  }, []);

  return {
    pointerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    guardClick,
  };
}

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
  imageInteraction = "lightbox",
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
  imageInteraction?: OpinionPollOptionImageInteraction;
}) {
  const { pointerProps, guardClick } = useTapClickGuard();
  const opensGallery = imageInteraction === "gallery";
  const imageColumn = option.imageUrl ? (
    <button
      type="button"
      aria-label={opensGallery ? "Open image review" : "View larger image"}
      disabled={disabled}
      {...pointerProps}
      onClick={(e) => guardClick(e, () => onExpandImage(option.imageUrl!, option.name))}
      className={cn(
        "group/thumb relative shrink-0 w-14 self-stretch min-h-[2.75rem] overflow-hidden border-0 p-0 disabled:cursor-not-allowed",
        opensGallery ? "cursor-pointer" : "cursor-zoom-in",
      )}
    >
      <img src={getDisplayImageUrl(option.imageUrl!, { width: 200 })} alt={option.name} className="absolute inset-0 h-full w-full object-cover" />
      {opensGallery ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-200 [@media(hover:hover)_and_(pointer:fine)]:group-hover/thumb:opacity-100"
        >
          <Maximize2 className="h-4 w-4 text-white" />
        </span>
      ) : null}
    </button>
  ) : (
    <div className="relative flex shrink-0 w-14 items-center justify-center self-stretch min-h-[2.75rem] bg-cyan-500/15 dark:bg-cyan-500/10">
      <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">{orderLabel}</span>
    </div>
  );

  if (mode === "vote") {
    return (
      <div
        className={cn(
          "w-full flex items-stretch overflow-hidden rounded-lg border border-border/50 bg-muted/30 p-0 text-left transition-all duration-200",
          OPTION_ROW_HOVER_CLASSES,
          disabled && "opacity-60",
        )}
        data-testid={`${testIdPrefix}-${pollId}-${option.id}`}
      >
        {imageColumn}
        <button
          type="button"
          {...pointerProps}
          onClick={(e) => guardClick(e, onVote)}
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
    <div
      className={cn(
        rowClass,
        "w-full",
        !disabled && OPTION_ROW_HOVER_CLASSES,
        disabled && "opacity-60",
      )}
      data-testid={`${testIdPrefix}-${pollId}-${option.id}`}
    >
      {imageColumn}
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "min-w-0 flex-1 text-left rounded-r-md border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EFEFEF]/40 dark:focus-visible:ring-white/30",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
        {...pointerProps}
        onClick={(e) => guardClick(e, onChangeVote)}
      >
        {contentColumn}
      </button>
    </div>
  );
}
