import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CategoryPill } from "@/components/CategoryPill";
import { Vote, Crown, Check, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface InductionCandidate {
  id: string;
  name: string;
  initials: string;
  category: "Tech" | "Entertainment" | "Creator" | "Sports" | "Business" | "Politics";
  votes: number;
}

export const INDUCTION_CANDIDATES: InductionCandidate[] = [
  { id: "i1", name: "Jensen Huang", initials: "JH", category: "Tech", votes: 12406 },
  { id: "i2", name: "Charli XCX", initials: "CX", category: "Entertainment", votes: 11205 },
  { id: "i3", name: "Kai Cenat", initials: "KC", category: "Creator", votes: 10892 },
  { id: "i4", name: "Sabrina Carpenter", initials: "SC", category: "Entertainment", votes: 9847 },
  { id: "i5", name: "Ice Spice", initials: "IS", category: "Entertainment", votes: 8934 },
  { id: "i6", name: "Sam Altman", initials: "SA", category: "Tech", votes: 8421 },
];

function getRankBadgeStyle(rank: number) {
  if (rank === 1) return "bg-yellow-500/10 border-yellow-500/20 text-yellow-300";
  if (rank === 2) return "bg-slate-400/10 border-slate-400/20 text-slate-300";
  if (rank === 3) return "bg-orange-500/10 border-orange-500/20 text-orange-300";
  return "bg-slate-500/10 border-slate-500/20 text-slate-400";
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
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 flex items-center justify-center text-sm font-bold text-cyan-400 border border-cyan-500/30">
          {candidate.initials}
        </div>
        {isVoted && (
          <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center">
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
              <span className="text-yellow-400">{candidate.votes.toLocaleString()}</span>
            ) : (
              <span>-{gap.toLocaleString()}</span>
            )}
          </span>
        </div>
      </div>
      
      <Button 
        size="sm"
        onClick={handleVoteClick}
        className={`shrink-0 ${isVoted 
          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20' 
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
  candidates = INDUCTION_CANDIDATES,
  limit = 3,
  onExplore,
  votedCandidates = new Set(),
  onToggleVote = () => {},
}: InductionLeaderboardSliceProps) {
  const displayCandidates = candidates.slice(0, limit);
  const maxVotes = candidates[0]?.votes || 1;
  const totalVoters = candidates.reduce((sum, c) => sum + c.votes, 0);

  return (
    <Card 
      className="p-4 bg-slate-900/60 border border-slate-700/40 backdrop-blur-sm"
      data-testid="induction-leaderboard-slice"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <Vote className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Induction Queue</h3>
            <p className="text-xs text-muted-foreground">Top {limit} candidates</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-cyan-400" />
          <span>{totalVoters.toLocaleString()} votes</span>
        </div>
      </div>
      
      <div className="space-y-2 mb-4">
        {displayCandidates.map((candidate, idx) => (
          <InductionCandidateRow
            key={candidate.id}
            candidate={candidate}
            rank={idx + 1}
            maxVotes={maxVotes}
            isVoted={votedCandidates.has(candidate.id)}
            onToggleVote={onToggleVote}
          />
        ))}
      </div>
      
      {onExplore && (
        <Button 
          variant="outline" 
          className="w-full border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          onClick={onExplore}
          data-testid="button-explore-induction"
        >
          View All Candidates
        </Button>
      )}
    </Card>
  );
}
