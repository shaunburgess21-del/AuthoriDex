import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { RankBadge } from "./RankBadge";
import { TrendBadge } from "./TrendBadge";
import { AnimatedSentimentVotingWidget } from "./AnimatedSentimentVotingWidget";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

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
  expanded: boolean;
  onToggle: () => void;
  onVisitProfile: () => void;
}

export function LeaderboardRow({ person, expanded, onToggle, onVisitProfile }: LeaderboardRowProps) {
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
          <p className="font-mono font-semibold text-lg" data-testid={`sentiment-score-${person.id}`}>
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
          <p className="text-xs text-muted-foreground uppercase tracking-wide translate-y-[0.5px]">
            Sentiment
          </p>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          data-testid={`button-expand-${person.id}`}
        >
          {expanded ? (
            <ChevronUp className="h-5 w-5" />
          ) : (
            <ChevronDown className="h-5 w-5" />
          )}
        </Button>
      </div>
      {/* Expandable Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-6 pt-2 bg-muted/30">
              {/* Bio and Visit Profile Button */}
              {person.bio && (
                <div className="flex gap-4 mb-6 items-start">
                  <p className="text-sm text-muted-foreground flex-1" data-testid={`text-bio-${person.id}`}>
                    {person.bio}
                  </p>
                  <Button 
                    variant="default" 
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
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
              <div className="mb-6">
                <AnimatedSentimentVotingWidget 
                  personId={person.id} 
                  personName={person.name}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
