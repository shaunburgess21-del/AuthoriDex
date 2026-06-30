import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CategoryPill } from "@/components/CategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Vote, Crown, Check, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { navigateToLogin } from "@/lib/authReturn";
import {
  SENTIMENT_POLL_SUPPORT_BUTTON_COMPACT_CLASS,
  SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS,
} from "@/lib/sentimentPollVoteDisplay";

export interface InductionCandidate {
  id: string;
  name: string;
  initials: string;
  imageSlug?: string | null;
  avatar?: string | null;
  category: string;
  votes: number;
}

function getRankBadgeStyle(rank: number) {
  if (rank === 1) return "bg-yellow-500/15 dark:bg-yellow-500/10 border-yellow-500/20 text-yellow-500 dark:text-yellow-300";
  if (rank === 2) return "bg-slate-400/10 border-slate-400/20 text-slate-500 dark:text-slate-300";
  if (rank === 3) return "bg-orange-500/15 dark:bg-orange-500/10 border-orange-500/20 text-orange-500 dark:text-orange-300";
  return "bg-slate-500/15 dark:bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400";
}

interface InductionCandidateRowProps {
  candidate: InductionCandidate;
  rank: number;
  maxVotes: number;
  isVoted: boolean;
  onToggleVote: (id: string) => void;
}

function InductionCandidateRow({ 
  candidate,
  rank,
  maxVotes,
  isVoted,
  onToggleVote,
}: InductionCandidateRowProps) {
  const [showVoteAnimation, setShowVoteAnimation] = useState(false);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressPercent = rank === 1 ? 100 : (candidate.votes / maxVotes) * 100;
  const gap = maxVotes - candidate.votes;

  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  const handleVoteClick = () => {
    if (!isVoted) {
      setShowVoteAnimation(true);
      animationTimeoutRef.current = setTimeout(() => setShowVoteAnimation(false), 800);
    }
    onToggleVote(candidate.id);
  };

  return (
    <div 
      className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/40 relative overflow-hidden"
      data-testid={`induction-row-${candidate.id}`}
    >
      <AnimatePresence>
        {showVoteAnimation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 pointer-events-none"
          >
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '200%' }}
              transition={{ duration: 0.6, ease: 'easeInOut' }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent skew-x-12"
            />
          </motion.div>
        )}
      </AnimatePresence>
      
      <div className={`rounded-full px-2 py-0.5 text-xs font-medium flex items-center gap-1 border shrink-0 ${getRankBadgeStyle(rank)}`}>
        {rank === 1 && <Crown className="h-3 w-3" />}
        #{rank}
      </div>
      
      <div className="relative shrink-0">
        <PersonAvatar name={candidate.name} avatar={candidate.avatar} imageSlug={candidate.imageSlug} imageContext="induction" size="sm" />
        {isVoted && (
          <div className={`absolute -top-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center ${SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS}`}>
            <Check className="h-2.5 w-2.5 text-white" />
          </div>
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-semibold text-sm truncate">{candidate.name}</p>
          <CategoryPill category={candidate.category} />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {rank === 1 ? (
              <span className="text-yellow-600 dark:text-yellow-400">{candidate.votes.toLocaleString('en-US')}</span>
            ) : (
              <span>-{gap.toLocaleString('en-US')}</span>
            )}
          </span>
        </div>
      </div>
      
      <Button 
        size="sm"
        onClick={handleVoteClick}
        className={`shrink-0 ${isVoted 
          ? SENTIMENT_POLL_SUPPORT_BUTTON_COMPACT_CLASS
          : 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white'
        }`}
        data-testid={`button-vote-${candidate.id}`}
      >
        {isVoted ? <Check className="h-4 w-4" /> : <Vote className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export interface InductionLeaderboardSliceProps {
  candidates?: InductionCandidate[];
  limit?: number;
  onExplore?: () => void;
  votedCandidates?: Set<string>;
  onToggleVote?: (id: string) => void;
}

export function InductionLeaderboardSlice({ 
  candidates,
  limit = 3,
  onExplore,
  votedCandidates = new Set(),
  onToggleVote,
}: InductionLeaderboardSliceProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: inductionData } = useQuery<any>({
    queryKey: ['/api/vote/induction'],
    staleTime: 60 * 1000,
    enabled: !candidates,
  });

  const { data: myInductionVoteIds } = useQuery<string[]>({
    queryKey: ["/api/me/induction-votes"],
    enabled: !!user && !onToggleVote,
  });

  const [localVotedIds, setLocalVotedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (onToggleVote) return;
    if (!user) {
      setLocalVotedIds(new Set());
      return;
    }
    if (Array.isArray(myInductionVoteIds)) {
      setLocalVotedIds(new Set(myInductionVoteIds));
    }
  }, [onToggleVote, user, myInductionVoteIds]);

  const inductionVoteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/vote/induction/${id}/vote`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vote/induction'] });
      queryClient.invalidateQueries({ queryKey: ['/api/me/induction-votes'] });
    },
    onError: (err, id) => {
      setLocalVotedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (isUnauthorizedApiError(err)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation)));
      } else {
        toast.error("Vote failed", { description: err instanceof Error ? err.message : "Something went wrong" });
      }
    },
  });

  const dbCandidates: InductionCandidate[] = (inductionData?.data || []).map((c: any) => ({
    id: c.id,
    name: c.displayName,
    initials: c.displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase(),
    imageSlug: c.imageSlug,
    avatar: c.avatar ?? null,
    category: c.category as InductionCandidate['category'],
    votes: c.seedVotes,
  }));

  const resolvedCandidates = candidates || dbCandidates;
  const displayCandidates = resolvedCandidates.slice(0, limit);
  const maxVotes = resolvedCandidates[0]?.votes || 1;
  const totalVoters = resolvedCandidates.reduce((sum, c) => sum + c.votes, 0);
  const resolvedVotedIds = onToggleVote ? votedCandidates : localVotedIds;

  const handleVote = onToggleVote || ((id: string) => {
    if (!user) {
      toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation)));
      return;
    }
    if (localVotedIds.has(id)) return;
    setLocalVotedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    inductionVoteMutation.mutate(id);
  });

  return (
    <Card 
      className="p-4 bg-slate-900/60 dark:bg-[#11151D] border border-slate-700/40 backdrop-blur-sm"
      data-testid="induction-leaderboard-slice"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-cyan-500/15 dark:bg-cyan-500/10 flex items-center justify-center">
            <Vote className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Induction Queue</h3>
            <p className="text-xs text-muted-foreground">Top {limit} candidates</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
          <span>{totalVoters.toLocaleString('en-US')} votes</span>
        </div>
      </div>
      
      <div className="space-y-2 mb-4">
        {displayCandidates.map((candidate, idx) => (
          <InductionCandidateRow
            key={candidate.id}
            candidate={candidate}
            rank={idx + 1}
            maxVotes={maxVotes}
            isVoted={resolvedVotedIds.has(candidate.id)}
            onToggleVote={handleVote}
          />
        ))}
      </div>
      
      {onExplore && (
        <Button 
          variant="outline" 
          className="w-full border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/15 dark:hover:bg-cyan-500/15 dark:bg-cyan-500/10"
          onClick={onExplore}
          data-testid="button-explore-induction"
        >
          View All Candidates
        </Button>
      )}
    </Card>
  );
}
