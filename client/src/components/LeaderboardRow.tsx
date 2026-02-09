import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { RankBadge } from "./RankBadge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import { compactNumber, formatDelta, compactVotes } from "@/lib/formatNumber";
import { ThumbsUp, Flame, Snowflake, Zap } from "lucide-react";

const SEGMENT_COLORS_5 = [
  '#FF0000',
  '#FF9100',
  '#FFC400',
  '#76FF03',
  '#00C853',
];

const getApprovalColor = (approvalPct: number): string => {
  const normalizedPct = approvalPct <= 1 ? approvalPct * 100 : approvalPct;
  const rating = Math.round((normalizedPct / 100) * 4) + 1;
  const clampedRating = Math.max(1, Math.min(5, rating));
  return SEGMENT_COLORS_5[clampedRating - 1];
};

type LeaderboardTab = "fame" | "approval";

interface ExtendedPerson extends TrendingPerson {
  approvalPct?: number | null;
  underratedPct?: number | null;
  overratedPct?: number | null;
  valueScore?: number | null;
  userValueVote?: string | null;
  leaderboardRank?: number;
  approvalVotesCount?: number | null;
  rankChange?: number | null;
}

interface LeaderboardRowProps {
  person: ExtendedPerson;
  activeTab?: LeaderboardTab;
  onVisitProfile: () => void;
  onVoteClick?: () => void;
  showExceptional?: boolean;
}

function getExceptionalIndicator(person: ExtendedPerson): { icon: typeof Flame; color: string; label: string } | null {
  const delta = person.change24h;
  const rankChange = person.rankChange;

  if (rankChange != null && rankChange >= 3 && delta != null && delta >= 15) {
    return { icon: Flame, color: "text-orange-400", label: "Breakout" };
  }
  if (delta != null && delta >= 25) {
    return { icon: Zap, color: "text-yellow-400", label: "Spiking" };
  }
  if (rankChange != null && rankChange >= 5) {
    return { icon: Flame, color: "text-orange-400", label: "Rising fast" };
  }
  if (rankChange != null && rankChange <= -3 && delta != null && delta <= -15) {
    return { icon: Snowflake, color: "text-blue-400", label: "Cooling" };
  }

  return null;
}

export { getExceptionalIndicator };

export function LeaderboardRow({ person, activeTab = "fame", onVisitProfile, onVoteClick, showExceptional = true }: LeaderboardRowProps) {
  const [sentimentScore, setSentimentScore] = useState<number | null>(null);

  useEffect(() => {
    const loadSentimentScore = () => {
      const savedVote = localStorage.getItem(`sentiment-vote-${person.id}`);
      if (savedVote) {
        setSentimentScore(parseInt(savedVote, 10));
      } else {
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
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('sentiment-vote-updated', handleCustomUpdate);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('sentiment-vote-updated', handleCustomUpdate);
    };
  }, [person.id]);

  const fameScore = person.fameIndex ?? Math.round(person.trendScore / 100);
  const delta24h = formatDelta(person.change24h);
  const showDelta = person.change24h != null && Math.abs(person.change24h) >= 2;
  const exceptional = showExceptional ? getExceptionalIndicator(person) : null;
  const ExceptionalIcon = exceptional?.icon;

  return (
    <div className="border-b">
      <div
        className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 hover-elevate active-elevate-2 cursor-pointer"
        onClick={onVisitProfile}
        data-testid={`row-person-${person.id}`}
      >
        <RankBadge rank={person.leaderboardRank ?? person.rank} rankChange={person.rankChange} />
        <PersonAvatar name={person.name} avatar={person.avatar} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-semibold text-base truncate" data-testid={`text-name-${person.id}`}>
              {person.name}
            </h3>
            {exceptional && ExceptionalIcon && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <ExceptionalIcon className={`h-3.5 w-3.5 shrink-0 ${exceptional.color}`} data-testid={`indicator-${person.id}`} />
                </TooltipTrigger>
                <TooltipContent>{exceptional.label}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {person.category && (
            <p className="hidden md:block text-sm truncate text-[#94A3B8]">
              {person.category}
            </p>
          )}
          <p className="md:hidden text-xs text-muted-foreground leading-tight line-clamp-1">
            {activeTab === "fame" && (
              <span className="font-mono">
                {compactNumber(fameScore)}
                {showDelta && (
                  <span className={person.change24h! > 0 ? "text-emerald-400" : "text-red-400"}>
                    {' '}{delta24h}
                  </span>
                )}
              </span>
            )}
            {activeTab === "approval" && (
              <span>
                {person.approvalPct != null ? (
                  <>
                    <span
                      className="font-mono"
                      style={{ color: getApprovalColor(person.approvalPct) }}
                    >
                      {Math.round(person.approvalPct)}%
                    </span>
                    {person.approvalVotesCount != null && (
                      <span className="text-muted-foreground">
                        {' '}&middot; {compactVotes(person.approvalVotesCount)} votes
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">No votes yet</span>
                )}
              </span>
            )}
          </p>
        </div>

        {activeTab === "fame" && (
          <>
            <div className="text-right hidden sm:block">
              <p className="font-mono font-bold text-2xl" data-testid={`text-score-${person.id}`}>
                {fameScore.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                Fame Score
              </p>
            </div>
            <div className="hidden md:block text-center min-w-[80px]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="font-mono font-semibold text-lg cursor-help" data-testid={`sentiment-score-${person.id}`}>
                    {person.approvalPct != null ? (
                      <>
                        <span
                          className="text-[22px]"
                          style={{ color: getApprovalColor(person.approvalPct) }}
                        >
                          {Math.round(person.approvalPct)}
                        </span>
                        <span className="text-muted-foreground text-[22px] translate-y-[0.5px]">%</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </p>
                </TooltipTrigger>
                {person.approvalPct != null && (
                  <TooltipContent>
                    {person.name} has a {Math.round(person.approvalPct)}% approval rating from community votes
                  </TooltipContent>
                )}
              </Tooltip>
              <p className="text-xs text-muted-foreground uppercase tracking-wide translate-y-[0.5px]">
                Approval Rating
              </p>
            </div>
            <Button
              variant="default"
              size="icon"
              className="md:hidden"
              onClick={(e) => {
                e.stopPropagation();
                onVoteClick?.();
              }}
              data-testid={`button-vote-icon-${person.id}`}
            >
              <ThumbsUp className="h-4 w-4" />
            </Button>
            <Button
              variant="default"
              size="sm"
              className="font-mono font-bold text-sm min-w-14 justify-center hidden md:inline-flex"
              onClick={(e) => {
                e.stopPropagation();
                onVoteClick?.();
              }}
              data-testid={`button-expand-${person.id}`}
            >
              Vote
            </Button>
          </>
        )}

        {activeTab === "approval" && (
          <>
            <div className="text-right hidden sm:block">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="font-mono font-semibold text-lg cursor-help">
                    {person.approvalPct != null ? (
                      <>
                        <span
                          className="font-bold text-[22px]"
                          style={{ color: getApprovalColor(person.approvalPct) }}
                        >
                          {Math.round(person.approvalPct)}
                        </span>
                        <span className="text-muted-foreground text-[22px]">%</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </p>
                </TooltipTrigger>
                <TooltipContent>
                  {person.name}'s approval rating from community votes
                </TooltipContent>
              </Tooltip>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                Approval Rating
              </p>
            </div>
            <div className="hidden md:block text-center min-w-[80px]">
              <p className="font-mono font-bold text-xl text-muted-foreground">
                {fameScore.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                Fame Score
              </p>
            </div>
            <Button
              variant="default"
              size="icon"
              className="md:hidden"
              onClick={(e) => {
                e.stopPropagation();
                onVoteClick?.();
              }}
              data-testid={`button-vote-icon-${person.id}`}
            >
              <ThumbsUp className="h-4 w-4" />
            </Button>
            <Button
              variant="default"
              size="sm"
              className="font-mono font-bold text-sm min-w-14 justify-center hidden md:inline-flex"
              onClick={(e) => {
                e.stopPropagation();
                onVoteClick?.();
              }}
              data-testid={`button-expand-${person.id}`}
            >
              Vote
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
