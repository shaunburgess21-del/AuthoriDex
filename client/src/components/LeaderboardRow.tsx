import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { RankBadge } from "./RankBadge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import { voteToApprovalPercent } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

type LeaderboardTab = "fame" | "approval" | "value";

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
  const [localUserVote, setLocalUserVote] = useState<string | null>(person.userValueVote || null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    setLocalUserVote(person.userValueVote || null);
  }, [person.userValueVote]);

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

  const valueVoteMutation = useMutation({
    mutationFn: async (voteType: 'underrated' | 'overrated') => {
      return apiRequest('POST', `/api/celebrity/${person.id}/value-vote`, { vote: voteType });
    },
    onMutate: (voteType) => {
      setLocalUserVote(voteType);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leaderboard'] });
    },
    onError: (error: any) => {
      setLocalUserVote(person.userValueVote || null);
      toast({
        title: "Vote failed",
        description: error.message || "Please sign in to vote",
        variant: "destructive",
      });
    },
  });

  const handleValueVote = (e: React.MouseEvent, voteType: 'underrated' | 'overrated') => {
    e.stopPropagation();
    valueVoteMutation.mutate(voteType);
  };

  const renderValueButtons = () => {
    const isUnderrated = localUserVote === 'underrated';
    const isOverrated = localUserVote === 'overrated';
    const isPending = valueVoteMutation.isPending;

    return (
      <div className="flex items-center gap-2">
        <button
          className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all backdrop-blur-sm border ${
            isUnderrated 
              ? "bg-emerald-500/30 border-emerald-500 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]" 
              : "bg-emerald-500/10 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/20 hover:border-emerald-500/60"
          }`}
          onClick={(e) => handleValueVote(e, 'underrated')}
          disabled={isPending}
          data-testid={`button-underrated-${person.id}`}
        >
          {isPending && localUserVote === 'underrated' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <>
              <ArrowUp className="h-3 w-3" />
              <span>Underrated</span>
            </>
          )}
        </button>
        <button
          className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all backdrop-blur-sm border ${
            isOverrated 
              ? "bg-red-500/30 border-red-500 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.3)]" 
              : "bg-red-500/10 border-red-500/40 text-red-500 hover:bg-red-500/20 hover:border-red-500/60"
          }`}
          onClick={(e) => handleValueVote(e, 'overrated')}
          disabled={isPending}
          data-testid={`button-overrated-${person.id}`}
        >
          {isPending && localUserVote === 'overrated' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <>
              <ArrowDown className="h-3 w-3" />
              <span>Overrated</span>
            </>
          )}
        </button>
      </div>
    );
  };

  const renderValuePercentages = () => {
    const hasVotes = person.underratedPct != null || person.overratedPct != null;
    
    if (!hasVotes) {
      return (
        <div className="text-center min-w-[80px] hidden md:block">
          <p className="text-muted-foreground text-sm">No votes yet</p>
        </div>
      );
    }

    return (
      <div className="hidden md:flex items-center gap-2 min-w-[100px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 cursor-help">
              <ArrowUp className="h-3 w-3 text-emerald-500" />
              <span className="font-mono text-sm text-emerald-500">
                {person.underratedPct ?? 0}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {person.underratedPct ?? 0}% think {person.name} is underrated
          </TooltipContent>
        </Tooltip>
        <span className="text-muted-foreground">/</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 cursor-help">
              <ArrowDown className="h-3 w-3 text-red-500" />
              <span className="font-mono text-sm text-red-500">
                {person.overratedPct ?? 0}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {person.overratedPct ?? 0}% think {person.name} is overrated
          </TooltipContent>
        </Tooltip>
      </div>
    );
  };

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
          {person.category && (
            <p className="text-sm truncate text-[#94A3B8]">
              {person.category}
            </p>
          )}
        </div>

        {activeTab === "fame" && (
          <>
            <div className="text-right hidden sm:block">
              <p className="font-mono font-bold text-2xl" data-testid={`text-score-${person.id}`}>
                {(person.fameIndex ?? Math.round(person.trendScore / 100)).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                Fame Index
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
                Approval
              </p>
            </div>
            <div className="hidden md:block text-center min-w-[80px]">
              <p className="font-mono font-bold text-xl text-muted-foreground">
                {(person.fameIndex ?? Math.round(person.trendScore / 100)).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                Fame Index
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

        {activeTab === "value" && (
          <>
            {renderValuePercentages()}
            {renderValueButtons()}
          </>
        )}
      </div>
    </div>
  );
}
