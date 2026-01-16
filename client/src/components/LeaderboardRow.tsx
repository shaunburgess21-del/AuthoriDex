import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { RankBadge } from "./RankBadge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import { voteToApprovalPercent } from "@/lib/utils";

// 1-5 scale colors: vivid gradient from red (1) to green (5)
const SEGMENT_COLORS_5 = [
  '#FF0000', // 1 - Pure red (0%)
  '#FF9100', // 2 - Orange (25%)
  '#FFC400', // 3 - Golden amber (50% - Neutral)
  '#76FF03', // 4 - Neon green (75%)
  '#00C853', // 5 - Pure green (100%)
];

const getSentimentColor = (value: number): string => {
  if (value < 1 || value > 5) return '#888888'; // Fallback color
  return SEGMENT_COLORS_5[value - 1];
};

interface LeaderboardRowProps {
  person: TrendingPerson;
  onVisitProfile: () => void;
  onVoteClick?: () => void;
}

export function LeaderboardRow({ person, onVisitProfile, onVoteClick }: LeaderboardRowProps) {
  const [sentimentScore, setSentimentScore] = useState<number | null>(null);

  // Load sentiment score from localStorage
  useEffect(() => {
    const loadSentimentScore = () => {
      const savedVote = localStorage.getItem(`sentiment-vote-${person.id}`);
      if (savedVote) {
        setSentimentScore(parseInt(savedVote, 10));
      } else {
        setSentimentScore(null);
      }
    };

    // Initial load
    loadSentimentScore();

    // Listen for storage changes (works across tabs and within same page via custom events)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `sentiment-vote-${person.id}`) {
        loadSentimentScore();
      }
    };

    // Also listen for custom events within the same page
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
      {/* Main Row */}
      <div
        className="flex items-center gap-4 p-4 hover-elevate active-elevate-2 cursor-pointer"
        onClick={onVisitProfile}
        data-testid={`row-person-${person.id}`}
      >
        <RankBadge rank={person.rank} />
        <PersonAvatar name={person.name} avatar={person.avatar} size="md" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base truncate" data-testid={`text-name-${person.id}`}>
            {person.name}
          </h3>
          {person.category && (
            <p className="text-sm truncate text-[#94A3B8]">
              {person.category}
            </p>
          )}
        </div>
        <div className="text-right hidden sm:block">
          <p className="font-mono font-bold text-2xl" data-testid={`text-score-${person.id}`}>
            {(person.fameIndex ?? Math.round(person.trendScore / 100)).toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Fame Index
          </p>
        </div>
        {/* Sentiment Score replacing 24h/7d badges */}
        <div className="hidden md:block text-center min-w-[80px]">
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="font-mono font-semibold text-lg cursor-help" data-testid={`sentiment-score-${person.id}`}>
                {sentimentScore ? (
                  <>
                    <span
                      style={{ color: getSentimentColor(sentimentScore) }}
                      className="text-[22px]">
                      {voteToApprovalPercent(sentimentScore)}
                    </span>
                    <span className="text-muted-foreground text-[22px] translate-y-[0.5px]">%</span>
                  </>
                ) : (
                  '—'
                )}
              </p>
            </TooltipTrigger>
            {sentimentScore && (
              <TooltipContent>
                {person.name} has a {voteToApprovalPercent(sentimentScore)}% approval rating.
              </TooltipContent>
            )}
          </Tooltip>
          <p className="text-xs text-muted-foreground uppercase tracking-wide translate-y-[0.5px]">
            Approval
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
      </div>
    </div>
  );
}
