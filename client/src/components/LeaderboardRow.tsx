import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { RankBadge } from "./RankBadge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";

const SEGMENT_COLORS_5 = [
  '#FF0000',
  '#FF9100',
  '#FFC400',
  '#76FF03',
  '#00C853',
];

const getSentimentColor = (value: number): string => {
  if (value < 1 || value > 5) return '#888888';
  return SEGMENT_COLORS_5[value - 1];
};

// Convert approval percentage (0-100) to a 1-5 rating scale and get corresponding color
const getApprovalColor = (approvalPct: number): string => {
  // Handle both fractional (0.93) and integer (93) inputs
  const normalizedPct = approvalPct <= 1 ? approvalPct * 100 : approvalPct;
  // Convert 0-100% to 1-5 scale: (pct / 100 * 4) + 1
  // 0% → 1, 25% → 2, 50% → 3, 75% → 4, 100% → 5
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
}

interface LeaderboardRowProps {
  person: ExtendedPerson;
  activeTab?: LeaderboardTab;
  onVisitProfile: () => void;
  onVoteClick?: () => void;
}

export function LeaderboardRow({ person, activeTab = "fame", onVisitProfile, onVoteClick }: LeaderboardRowProps) {
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

  return (
    <div className="border-b">
      <div
        className="flex items-center gap-4 p-4 hover-elevate active-elevate-2 cursor-pointer"
        onClick={onVisitProfile}
        data-testid={`row-person-${person.id}`}
      >
        <RankBadge rank={person.leaderboardRank ?? person.rank} />
        <PersonAvatar name={person.name} avatar={person.avatar} size="md" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base truncate" data-testid={`text-name-${person.id}`}>
            {person.name}
          </h3>
          {/* Desktop: Show industry category */}
          {person.category && (
            <p className="hidden md:block text-sm truncate text-[#94A3B8]">
              {person.category}
            </p>
          )}
          {/* Mobile: Show dynamic metric based on active tab */}
          <p className="md:hidden text-xs text-muted-foreground leading-tight line-clamp-1">
            {activeTab === "fame" && (
              <span className="font-mono">
                Score: {(person.fameIndex ?? Math.round(person.trendScore / 100)).toLocaleString()}
              </span>
            )}
            {activeTab === "approval" && (
              <span>
                Approval:{" "}
                {person.approvalPct != null ? (
                  <span 
                    className="font-mono"
                    style={{ color: getApprovalColor(person.approvalPct) }}
                  >
                    {Math.round(person.approvalPct)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            )}
          </p>
        </div>

        {activeTab === "fame" && (
          <>
            <div className="text-right hidden sm:block">
              <p className="font-mono font-bold text-2xl" data-testid={`text-score-${person.id}`}>
                {(person.fameIndex ?? Math.round(person.trendScore / 100)).toLocaleString()}
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
              size="sm"
              className="font-mono font-bold text-sm min-w-14 justify-center"
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
                {(person.fameIndex ?? Math.round(person.trendScore / 100)).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                Fame Score
              </p>
            </div>
            <Button 
              variant="default" 
              size="sm"
              className="font-mono font-bold text-sm min-w-14 justify-center"
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
