import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { RankBadge } from "./RankBadge";
import { AnimatedSentimentVotingWidget } from "./AnimatedSentimentVotingWidget";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ExternalLink, X } from "lucide-react";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Exact colors from sentiment widget - vivid gradient palette
const SEGMENT_COLORS = [
  '#FF0000', // 1 - Pure vivid red
  '#FF1744', // 2 - Bright crimson
  '#FF6D00', // 3 - Vivid orange
  '#FF9100', // 4 - Bright orange
  '#FFC400', // 5 - Golden amber
  '#FFEA00', // 6 - Brilliant yellow
  '#C6FF00', // 7 - Electric lime
  '#76FF03', // 8 - Neon green
  '#00E676', // 9 - Vibrant emerald
  '#00C853', // 10 - Pure green
];

const getSentimentColor = (value: number): string => {
  if (value < 1 || value > 10) return '#888888'; // Fallback color
  return SEGMENT_COLORS[value - 1];
};

interface LeaderboardRowProps {
  person: TrendingPerson;
  onVisitProfile: () => void;
}

export function LeaderboardRow({ person, onVisitProfile }: LeaderboardRowProps) {
  const [sentimentScore, setSentimentScore] = useState<number | null>(null);
  const [voteModalOpen, setVoteModalOpen] = useState(false);

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
            <p className="text-sm text-muted-foreground truncate">
              {person.category}
            </p>
          )}
        </div>
        <div className="text-right hidden sm:block">
          <p className="font-mono font-bold text-2xl" data-testid={`text-score-${person.id}`}>
            {person.trendScore.toFixed(0)}
          </p>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Trend Score
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
                      {Math.round((sentimentScore / 10) * 100)}
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
                {person.name} has a {Math.round((sentimentScore / 10) * 100)}% approval rating.
              </TooltipContent>
            )}
          </Tooltip>
          <p className="text-xs text-muted-foreground uppercase tracking-wide translate-y-[0.5px]">
            Sentiment
          </p>
        </div>
        <Button 
          variant="default" 
          size="sm"
          className="font-mono font-bold text-sm min-w-14 justify-center"
          onClick={(e) => {
            e.stopPropagation();
            setVoteModalOpen(true);
          }}
          data-testid={`button-expand-${person.id}`}
        >
          Vote
        </Button>
      </div>

      {/* Vote Modal */}
      <Dialog open={voteModalOpen} onOpenChange={setVoteModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <PersonAvatar name={person.name} avatar={person.avatar} size="sm" />
              <span>Rate {person.name}</span>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Bio and Visit Profile Button */}
            {person.bio && (
              <div className="flex gap-4 items-start">
                <p className="text-sm text-muted-foreground flex-1" data-testid={`text-bio-${person.id}`}>
                  {person.bio}
                </p>
                <Button 
                  variant="default" 
                  size="sm"
                  onClick={() => {
                    setVoteModalOpen(false);
                    onVisitProfile();
                  }}
                  data-testid={`button-visit-profile-${person.id}`}
                  className="gap-2 whitespace-nowrap"
                >
                  Visit Profile
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Sentiment Voting Widget */}
            <AnimatedSentimentVotingWidget 
              personId={person.id} 
              personName={person.name}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
