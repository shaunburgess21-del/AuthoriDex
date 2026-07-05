import { Badge } from "@/components/ui/badge";
import { LeaderboardRankAvatar } from "@/components/LeaderboardRankAvatar";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import type { GainerCandidate } from "@/components/predict/TopGainerCard";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { formatSignedPercent, formatSignedPoints } from "@/lib/predict-display";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronRight, Crown } from "lucide-react";

const INTERACTIVE_ROW_CLASS =
  "[@media(hover:hover)_and_(pointer:fine)]:hover:border-[#EFEFEF]/50 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/50 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:border-white/40 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/5 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-1 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-inset [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[#EFEFEF]/40 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:ring-white/25 active:border-[#EFEFEF]/40 active:bg-muted/45 dark:active:border-white/35 dark:active:bg-white/[0.07] active:ring-1 active:ring-inset active:ring-[#EFEFEF]/30 dark:active:ring-white/20";

const UNSELECTED_VOTE_CLASS = "border border-border/50 bg-muted/30";
const UNSELECTED_RESULT_OTHER_CLASS = "border-border/30 bg-muted/20";
const SELECTED_OPINION_POLL_CLASS =
  "border-white/40 dark:border-white/50 border-l-4 border-l-cyan-500 bg-slate-200/60 dark:bg-black/30 ring-1 ring-cyan-500/20 dark:ring-cyan-400/15 ring-inset";

export function CategoryRaceCandidateRow({
  candidate,
  rankIndex,
  isSelected = false,
  nonInteractive = false,
  isMarketClosed = false,
  closedMessage,
  onSelect,
  size = "card",
  showUserPickBadge = false,
  showDetailAffordance = false,
  marketPct,
  testId,
}: {
  candidate: GainerCandidate;
  rankIndex: number;
  isSelected?: boolean;
  nonInteractive?: boolean;
  isMarketClosed?: boolean;
  closedMessage?: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: () => void;
  size?: "card" | "detail";
  showUserPickBadge?: boolean;
  /** Trailing chevron when row navigates to the race detail page. */
  showDetailAffordance?: boolean;
  marketPct?: number | null;
  testId?: string;
}) {
  const isWeeklyLeader = rankIndex === 0;
  const canInteract = !nonInteractive && !!onSelect;
  const percentClass = size === "detail" ? "text-base" : "text-sm";
  const cardPadding = size === "card" ? "py-1.5 pl-2 pr-2" : "py-2.5 pl-2.5 pr-3 sm:p-3";
  const avatarSize = size === "detail" ? "md" : "sm";
  const crownClass = size === "detail" ? "h-4 w-4" : "h-3.5 w-3.5";

  const rowSurfaceClass = isSelected
    ? SELECTED_OPINION_POLL_CLASS
    : nonInteractive
      ? UNSELECTED_RESULT_OTHER_CLASS
      : UNSELECTED_VOTE_CLASS;

  const rankSlot = isWeeklyLeader ? (
    <Crown className={cn("text-amber-600 dark:text-amber-400", crownClass)} aria-hidden />
  ) : !candidate.rank ? (
    <span className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 leading-none">New</span>
  ) : undefined;

  const row = (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        if (!canInteract) return;
        onSelect?.();
      }}
      className={cn(
        "w-full flex items-center gap-2 overflow-hidden rounded-lg border text-left transition-all duration-200 touch-manipulation",
        rowSurfaceClass,
        cardPadding,
        canInteract && `cursor-pointer ${INTERACTIVE_ROW_CLASS}`,
        !canInteract && "cursor-default",
      )}
    >
      <LeaderboardRankAvatar
        rank={rankSlot ? undefined : candidate.rank}
        rankSlot={rankSlot}
        name={candidate.name}
        avatar={candidate.avatar}
        size={avatarSize}
      />

      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("truncate text-sm text-foreground", isSelected && "font-semibold")}>
            {candidate.name}
          </span>
          {isSelected && (
            <CheckCircle2 className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 shrink-0" aria-hidden />
          )}
          {showUserPickBadge && (
            <Badge className="bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30 text-[9px] px-1.5 py-0">
              Your Pick
            </Badge>
          )}
          {marketPct != null && (
            <Badge variant="outline" className="text-[9px] text-muted-foreground border-border/40 px-1.5 py-0">
              Market · {marketPct}%
            </Badge>
          )}
        </div>
        {size === "detail" && (
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {candidate.rank ? (
              <span className="text-[10px] text-muted-foreground font-mono">#{candidate.rank} on board</span>
            ) : null}
            {candidate.rank ? <span className="text-[10px] text-muted-foreground/40">&middot;</span> : null}
            <span
              className={cn(
                "text-[10px] font-mono",
                candidate.currentGain >= 0 ? "text-muted-foreground" : "text-red-600/80 dark:text-red-400/80",
              )}
            >
              {formatSignedPoints(candidate.currentGain)} pts added
            </span>
          </div>
        )}
        {size === "card" && (
          <p
            className={cn(
              "text-[10px] font-mono",
              candidate.currentGain >= 0 ? "text-muted-foreground" : "text-red-600/80 dark:text-red-400/80",
            )}
          >
            {formatSignedPoints(candidate.currentGain)} pts added
          </p>
        )}
      </div>

      <div className="text-right shrink-0 flex items-center gap-1">
        <p
          className={cn(
            "font-mono font-bold",
            percentClass,
            candidate.percentGain >= 0 ? "text-green-500" : "text-red-500",
          )}
        >
          {formatSignedPercent(candidate.percentGain)}
        </p>
        {showDetailAffordance && (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
        )}
      </div>
    </button>
  );

  if (isMarketClosed && closedMessage && canInteract) {
    return (
      <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
        {row}
      </ClosedMarketActionTrigger>
    );
  }

  return row;
}
