import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { Button } from "@/components/ui/button";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover";
import { memo, useState, useEffect, useRef } from "react";
import { formatDelta, compactVotes, getApprovalColor } from "@/lib/formatNumber";
import { resolveFameScore } from "@/lib/fameScore";
import { Star, X, Flame, Eye } from "lucide-react";
import { getCategoryTextColor } from "@/components/CategoryPill";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const SEGMENT_COLORS_5 = ['#FF0000', '#FF9100', '#FFC400', '#76FF03', '#00C853'];

const getRatingColor = (rating: number): string => {
  const idx = Math.max(0, Math.min(4, rating - 1));
  return SEGMENT_COLORS_5[idx];
};

type LeaderboardTab = "fame" | "approval";

interface ExtendedPerson extends TrendingPerson {
  approvalPct?: number | null;
  approvalAvgRating?: number | null;
  underratedPct?: number | null;
  overratedPct?: number | null;
  valueScore?: number | null;
  userValueVote?: string | null;
  userApprovalRating?: number | null;
  leaderboardRank?: number;
  approvalVotesCount?: number | null;
  rankChange?: number | null;
  /** Cosmetic: profile views in the current ~10 min window (not a competing score). */
  liveProfileViews?: number | null;
}

interface LeaderboardRowProps {
  person: ExtendedPerson;
  activeTab?: LeaderboardTab;
  isHotMover?: boolean;
  onOpenInsight: () => void;
  onVoteClick?: () => void;
}

const EVER_VOTED_KEY = "authoridex-has-ever-voted";

function getHasEverVoted(): boolean {
  try {
    return localStorage.getItem(EVER_VOTED_KEY) === "1";
  } catch {
    return false;
  }
}

function markEverVoted() {
  try {
    localStorage.setItem(EVER_VOTED_KEY, "1");
    window.dispatchEvent(new CustomEvent("authoridex-ever-voted"));
  } catch {}
}

function RankDeltaPill({
  rankChange,
  size = "desktop",
  className = "",
}: {
  rankChange: number;
  size?: "desktop" | "compact";
  className?: string;
}) {
  const isUp = rankChange > 0;
  const compact = size === "compact";
  const tint = compact
    ? isUp
      ? "bg-green-500/10 text-green-600/90 dark:text-green-400/90"
      : "bg-red-500/10 text-red-600/90 dark:text-red-400/90"
    : isUp
      ? "bg-green-500/[0.12] text-green-600 dark:text-green-400"
      : "bg-red-500/[0.12] text-red-600 dark:text-red-400";
  return (
    <span
      className={`inline-flex items-center justify-center font-mono tabular-nums ${
        compact
          ? "min-w-0 gap-px px-1 py-0.5 rounded-sm text-[10px] font-medium leading-none"
          : "min-w-0 gap-px px-1.5 py-px rounded-sm text-[11px] font-medium leading-none"
      } ${tint} ${className}`}
    >
      {isUp ? "\u25B2" : "\u25BC"}
      {Math.abs(rankChange)}
    </span>
  );
}

function LiveProfileViewsIndicator({
  count,
  size = "desktop",
}: {
  count: number;
  size?: "desktop" | "compact";
}) {
  if (count < 1) return null;
  const compact = size === "compact";
  const box = compact ? "h-3" : "h-3.5";
  const iconSize = compact ? "size-3" : "size-3.5";
  return (
    <TouchTooltip
      content="Live profile views"
      triggerAriaLabel={`Live profile views: ${count}`}
      side={compact ? "bottom" : "top"}
      showCloseButton={compact}
    >
      <span
        className={cn(
          "inline-flex items-center gap-0.5 shrink-0 text-blue-600 dark:text-blue-400 [&_svg]:block",
          box,
        )}
      >
        <Eye className={cn(iconSize, "shrink-0")} strokeWidth={2.25} aria-hidden />
        <span className="text-[10px] font-medium leading-none tabular-nums">
          {count}
        </span>
      </span>
    </TouchTooltip>
  );
}

function LeaderboardYourVoteCell({
  person,
  sentimentScore,
  hasVoted,
  showVotePulse,
  onVoteClick,
}: {
  person: ExtendedPerson;
  sentimentScore: number | null;
  hasVoted: boolean;
  showVotePulse: boolean;
  onVoteClick?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-[88px] shrink-0 flex justify-end">
      {hasVoted && sentimentScore != null ? (
        <Popover modal open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="no-default-hover-elevate no-default-active-elevate font-mono font-bold text-lg sm:text-xl tabular-nums cursor-pointer pr-3"
              aria-label={`Rated ${person.name} ${sentimentScore}/5`}
              onClick={(e) => e.stopPropagation()}
              data-testid={`button-vote-icon-${person.id}`}
            >
              <span>
                <span style={{ color: getRatingColor(sentimentScore) }}>{sentimentScore}</span>
                <span className="text-muted-foreground">/5</span>
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-56 p-3 space-y-2"
            side="left"
            align="center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">
                You rated <span className="font-semibold">{person.name}</span>{" "}
                <span className="font-bold" style={{ color: getRatingColor(sentimentScore) }}>
                  {sentimentScore}/5
                </span>
              </p>
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="no-default-hover-elevate no-default-active-elevate h-5 w-5 shrink-0"
                  aria-label="Close"
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`button-close-popover-${person.id}`}
                >
                  <X style={{ width: 14, height: 14 }} />
                </Button>
              </PopoverClose>
            </div>
            <p className="text-xs text-muted-foreground">
              {person.approvalAvgRating != null ? (
                <>
                  Community:{" "}
                  <span className="font-semibold">
                    <span style={{ color: getApprovalColor(person.approvalAvgRating) }}>
                      {person.approvalAvgRating.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground">/5</span>
                  </span>
                </>
              ) : (
                "No community votes yet"
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onVoteClick?.();
              }}
              data-testid={`button-change-vote-${person.id}`}
            >
              Change Vote
            </Button>
          </PopoverContent>
        </Popover>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className={`no-default-hover-elevate no-default-active-elevate gap-1 text-xs hover:bg-[#22D3EE]/20 hover:border-[#22D3EE]/40 hover:text-[#22D3EE] ${showVotePulse ? "vote-cta-pulse" : ""}`}
          aria-label={`Rate ${person.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onVoteClick?.();
          }}
          data-testid={`button-vote-icon-${person.id}`}
        >
          <Star style={{ width: 14, height: 14 }} strokeWidth={1.5} />
          Rate
        </Button>
      )}
    </div>
  );
}

// memo: the home leaderboard renders 150+ rows and re-renders the whole list
// on every live-tick refetch; unchanged rows now skip reconciliation.
export const LeaderboardRow = memo(function LeaderboardRow({
  person,
  activeTab = "fame",
  isHotMover = false,
  onOpenInsight,
  onVoteClick,
}: LeaderboardRowProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const categoryRegistry = useCategoryRegistry();
  const [sentimentScore, setSentimentScore] = useState<number | null>(null);
  const [hasEverVoted, setHasEverVoted] = useState(getHasEverVoted);

  useEffect(() => {
    const loadSentimentScore = () => {
      try {
        if (
          person.userApprovalRating != null &&
          person.userApprovalRating >= 1 &&
          person.userApprovalRating <= 5
        ) {
          setSentimentScore(person.userApprovalRating);
          if (!getHasEverVoted()) {
            markEverVoted();
          }
          return;
        }
        if (!userId) {
          setSentimentScore(null);
          return;
        }
        const savedVote =
          typeof window !== "undefined"
            ? localStorage.getItem(`sentiment-vote-${person.id}`)
            : null;
        if (savedVote) {
          const parsed = parseInt(savedVote, 10);
          setSentimentScore(Number.isFinite(parsed) ? parsed : null);
          if (!getHasEverVoted()) {
            markEverVoted();
          }
          return;
        }
        setSentimentScore(null);
      } catch {
        setSentimentScore(null);
      }
    };

    loadSentimentScore();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `sentiment-vote-${person.id}`) {
        loadSentimentScore();
      }
    };

    const handleCustomUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.personId === person.id) {
        loadSentimentScore();
        if (!getHasEverVoted()) {
          markEverVoted();
        }
      }
    };

    const handleEverVoted = () => setHasEverVoted(true);

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('sentiment-vote-updated', handleCustomUpdate);
    window.addEventListener('authoridex-ever-voted', handleEverVoted);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('sentiment-vote-updated', handleCustomUpdate);
      window.removeEventListener('authoridex-ever-voted', handleEverVoted);
    };
  }, [person.id, person.userApprovalRating, userId]);

  const fameScore = resolveFameScore(person);
  const delta24h = formatDelta(person.change24h);
  /** Colour the % once |change24h| >= 1; below that stays muted grey. */
  const showPctColor =
    person.change24h != null && Math.abs(person.change24h) >= 1;
  const showRankDelta =
    person.rankChange != null && Math.abs(person.rankChange) >= 2;
  const hasVoted = sentimentScore !== null;
  const showVotePulse = !hasVoted && !hasEverVoted;
  const rank = person.leaderboardRank ?? person.rank;
  const isColdStart = rank == null || rank === 0;
  const liveProfileViews = person.liveProfileViews ?? 0;
  const showLiveProfileViews = liveProfileViews >= 1;

  const prevScoreRef = useRef(fameScore);
  const [scoreFlash, setScoreFlash] = useState(false);
  useEffect(() => {
    if (prevScoreRef.current !== fameScore) {
      prevScoreRef.current = fameScore;
      setScoreFlash(true);
      const t = setTimeout(() => setScoreFlash(false), 300);
      return () => clearTimeout(t);
    }
  }, [fameScore]);

  const pctColorClass =
    person.change24h != null && person.change24h >= 1
      ? "text-emerald-600 dark:text-emerald-400"
      : person.change24h != null && person.change24h <= -1
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  // Show % whenever it exists; colour at |%| >= 1. Rank pill stays |Δ| >= 2.
  const hasPct = person.change24h != null;
  const hasMobileMovement = hasPct || showRankDelta;
  const pctMuted = !showPctColor;

  // Podium accents (ranks 1–3): pulse-style card variant + rank-well tints.
  const podiumRank = !isColdStart && rank != null && rank >= 1 && rank <= 3 ? rank : null;
  const rowVariantClass =
    podiumRank === 1
      ? "lb-row-gold"
      : podiumRank === 2
        ? "lb-row-silver"
        : podiumRank === 3
          ? "lb-row-bronze"
          : "lb-row-neutral";
  const rankWellClass =
    podiumRank === 1
      ? "bg-amber-400/15 dark:bg-amber-400/10"
      : podiumRank === 2
        ? "bg-slate-400/15 dark:bg-slate-300/10"
        : podiumRank === 3
          ? "bg-orange-500/15 dark:bg-orange-400/10"
          : "bg-muted dark:bg-[#101318]";
  const rankNumeralClass =
    podiumRank === 1
      ? "text-amber-600 dark:text-amber-400"
      : podiumRank === 2
        ? "text-slate-600 dark:text-slate-300"
        : podiumRank === 3
          ? "text-orange-600 dark:text-orange-400"
          : "text-muted-foreground dark:text-slate-400";

  // role=button (not a real <button>) because the row contains nested
  // interactive controls (Rate button, popovers) — nested buttons are
  // invalid HTML and break click handling. Keydown only fires for the
  // row itself so nested controls keep their own key behaviour.
  return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`View insights for ${person.name}`}
        className={`lb-row-enter lb-row-card ${rowVariantClass} flex items-center gap-3 sm:gap-4 lg:gap-5 pl-2 pr-2 py-4 sm:pl-3 sm:pr-6 sm:py-5 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        onClick={onOpenInsight}
        // No-op touch handler: iOS Safari only applies :active (the press
        // glow/expand in .lb-row-card) to non-form elements that have a touch
        // listener attached.
        onTouchStart={() => {}}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenInsight();
          }
        }}
        data-testid={`row-person-${person.id}`}
      >
        <div
          className="relative flex items-center rounded-lg overflow-hidden shrink-0"
          data-testid={`rank-avatar-unit-${person.id}`}
        >
          <div className={`flex items-center justify-center min-w-[32px] sm:min-w-[36px] h-12 lg:h-[58px] rounded-l-lg border-r border-border dark:border-transparent ${rankWellClass}`}>
            {isColdStart ? (
              <span className="text-[10px] sm:text-xs font-bold text-cyan-600 dark:text-cyan-400 leading-tight">New</span>
            ) : (
              <span className={`font-mono font-semibold text-[16px] sm:text-[18px] ${rankNumeralClass}`}>
                {rank}
              </span>
            )}
          </div>
          <PersonAvatar
            name={person.name}
            avatar={person.avatar}
            imageSlug={(person as any).imageSlug}
            size="md"
            className="h-12 w-12 lg:h-[58px] lg:w-[58px] rounded-none rounded-r-md"
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className="font-semibold text-sm sm:text-base min-w-0 truncate"
            data-testid={`text-name-${person.id}`}
          >
            {person.name}
          </h3>
          {person.category && (() => {
            const canonicalCategoryId = categoryRegistry.resolveCanonicalId(person.category);
            const displayCategoryLabel = categoryRegistry.getDisplayLabel(person.category);
            return (
              <p className={`hidden md:flex items-center gap-1.5 text-sm truncate ${getCategoryTextColor(person.category, canonicalCategoryId)}`}>
                <span className="truncate">{displayCategoryLabel}</span>
                {isHotMover && (
                  <Flame
                    className="h-3.5 w-3.5 shrink-0 text-orange-600 dark:text-orange-400"
                    aria-label="Hot Mover"
                  />
                )}
                {showLiveProfileViews && (
                  <LiveProfileViewsIndicator count={liveProfileViews} />
                )}
              </p>
            );
          })()}
          {(!person.category && (isHotMover || showLiveProfileViews)) && (
            <p className="hidden md:flex items-center gap-1.5">
              {isHotMover && (
                <Flame
                  className="h-3.5 w-3.5 shrink-0 text-orange-600 dark:text-orange-400"
                  aria-label="Hot Mover"
                />
              )}
              {showLiveProfileViews && (
                <LiveProfileViewsIndicator count={liveProfileViews} />
              )}
            </p>
          )}
          {activeTab === "fame" && (hasMobileMovement || isHotMover || showLiveProfileViews) && (
            <p className="md:hidden text-[11px] leading-tight truncate mt-0.5">
              <span className="inline-flex items-center gap-1">
                {(hasPct || showRankDelta) && (
                  <span className="font-mono inline-flex items-center gap-1">
                    {hasPct ? (
                      <span className={pctColorClass}>{delta24h}</span>
                    ) : null}
                    {showRankDelta && person.rankChange != null ? (
                      <RankDeltaPill rankChange={person.rankChange} size="compact" />
                    ) : null}
                  </span>
                )}
                {isHotMover && (
                  <Flame
                    className="h-3 w-3 shrink-0 text-orange-600 dark:text-orange-400"
                    aria-label="Hot Mover"
                  />
                )}
                {showLiveProfileViews && (
                  <LiveProfileViewsIndicator count={liveProfileViews} size="compact" />
                )}
              </span>
            </p>
          )}
          {activeTab === "approval" && (
            <p className="md:hidden text-[11px] text-muted-foreground leading-tight truncate mt-0.5">
              <span className="text-muted-foreground">
                {person.approvalVotesCount != null
                  ? `${compactVotes(person.approvalVotesCount)} votes`
                  : "No votes yet"}
                {person.approvalAvgRating != null && (
                  <>
                    {" \u00B7 "}
                    <span style={{ color: getApprovalColor(person.approvalAvgRating) }}>
                      {person.approvalAvgRating.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground">/5</span>
                  </>
                )}
              </span>
            </p>
          )}
        </div>

        {activeTab === "fame" && (
          <>
            <div className="text-right min-w-[4.5rem] max-w-[6.5rem] sm:min-w-[5rem] sm:max-w-none sm:w-[120px] lg:w-[140px] shrink-0">
              <p
                className={`font-mono font-bold text-lg sm:text-2xl tabular-nums leading-none tracking-tight text-muted-foreground ${scoreFlash ? 'number-flash' : ''}`}
                data-testid={`text-score-${person.id}`}
              >
                {fameScore.toLocaleString('en-US')}
              </p>
            </div>
            <div className="hidden md:flex justify-end items-center w-[96px] shrink-0">
              <TouchTooltip
                content="Trend score % change and 24h rank move. Rank can climb even if score dips \u2014 when rivals fall faster."
                side="top"
                contentClassName="max-w-[230px]"
              >
                <span
                  className="inline-flex items-center gap-1 cursor-help"
                  data-testid={`text-delta-desktop-${person.id}`}
                >
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      pctMuted
                        ? "text-muted-foreground"
                        : person.change24h! > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {hasPct ? delta24h : "\u2014"}
                  </span>
                  {showRankDelta && person.rankChange != null ? (
                    <RankDeltaPill rankChange={person.rankChange} />
                  ) : null}
                </span>
              </TouchTooltip>
            </div>
            <div className="hidden md:flex">
              <LeaderboardYourVoteCell
                person={person}
                sentimentScore={sentimentScore}
                hasVoted={hasVoted}
                showVotePulse={showVotePulse}
                onVoteClick={onVoteClick}
              />
            </div>
          </>
        )}

        {activeTab === "approval" && (
          <>
            <div className="hidden lg:flex w-[100px] shrink-0 justify-end items-center" data-testid={`text-vote-count-${person.id}`}>
              <p className="font-mono font-semibold text-base tabular-nums text-muted-foreground">
                {person.approvalVotesCount != null ? person.approvalVotesCount.toLocaleString('en-US') : '—'}
              </p>
            </div>
            <div className="text-right hidden sm:block w-[120px] shrink-0">
              <TouchTooltip
                content={`${person.name}'s approval rating from community votes`}
                side="top"
              >
                <p className="font-mono font-bold text-2xl tabular-nums cursor-help">
                  {person.approvalAvgRating != null ? (
                    <span>
                      <span style={{ color: getApprovalColor(person.approvalAvgRating) }}>{person.approvalAvgRating.toFixed(1)}</span><span className="text-muted-foreground">/5</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </p>
              </TouchTooltip>
              <p className="text-xs text-muted-foreground uppercase tracking-wide lg:hidden">
                Approval
              </p>
            </div>
            <div className="hidden md:block text-right w-[120px] shrink-0">
              <p className="font-mono font-bold text-xl tabular-nums text-muted-foreground">
                {fameScore.toLocaleString('en-US')}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide lg:hidden">
                Trend Score
              </p>
            </div>
            <LeaderboardYourVoteCell
              person={person}
              sentimentScore={sentimentScore}
              hasVoted={hasVoted}
              showVotePulse={showVotePulse}
              onVoteClick={onVoteClick}
            />
          </>
        )}
      </div>
  );
});
