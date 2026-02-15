import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { ArrowUp, ArrowDown, Minus, Users, Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type VoteType = 'underrated' | 'overrated' | 'fairly_rated';

export interface ValueVotePerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  fameIndex: number | null;
  trendScore: number;
  approvalPct?: number | null;
  underratedPct?: number | null;
  overratedPct?: number | null;
  fairlyRatedPct?: number | null;
  underratedCount?: number | null;
  overratedCount?: number | null;
  fairlyRatedCount?: number | null;
  userValueVote?: VoteType | null;
}

export interface UnderratedOverratedCardProps {
  person: ValueVotePerson;
  onVisitProfile?: () => void;
  compact?: boolean;
}

export function UnderratedOverratedCard({ 
  person, 
  onVisitProfile,
  compact = false 
}: UnderratedOverratedCardProps) {
  const [localVote, setLocalVote] = useState<VoteType | null>(
    person.userValueVote ?? null
  );
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const totalVotes = (person.underratedCount ?? 0) + (person.overratedCount ?? 0) + (person.fairlyRatedCount ?? 0);
  const underratedPct = person.underratedPct ?? 33;
  const overratedPct = person.overratedPct ?? 33;
  const fairlyRatedPct = person.fairlyRatedPct ?? 34;

  const valueVoteMutation = useMutation({
    mutationFn: async (voteType: VoteType) => {
      return apiRequest('POST', `/api/celebrity/${person.id}/value-vote`, { vote: voteType });
    },
    onMutate: (voteType) => {
      setLocalVote(voteType);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/celebrity', person.id, 'value-vote'] });
      queryClient.invalidateQueries({ queryKey: ['/api/trending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leaderboard?tab=value&limit=20'] });
    },
    onError: (error: any) => {
      setLocalVote(person.userValueVote ?? null);
      toast({
        title: "Vote failed",
        description: error.message || "Please sign in to vote",
        variant: "destructive",
      });
    },
  });

  const handleVote = (voteType: VoteType) => {
    if (!localVote) {
      valueVoteMutation.mutate(voteType);
    }
  };

  const handleChangeVote = () => {
    setLocalVote(null);
  };

  const isPending = valueVoteMutation.isPending;

  const voteIcon = localVote === 'underrated'
    ? <ArrowUp className="h-4 w-4 text-[#00C853]" />
    : localVote === 'overrated'
      ? <ArrowDown className="h-4 w-4 text-[#FF0000]" />
      : <Minus className="h-4 w-4 text-slate-400" />;

  const voteColor = localVote === 'underrated'
    ? 'text-[#00C853]'
    : localVote === 'overrated'
      ? 'text-[#FF0000]'
      : 'text-slate-400';

  const voteLabel = localVote === 'underrated'
    ? 'underrated'
    : localVote === 'overrated'
      ? 'overrated'
      : 'fairly rated';

  return (
    <Card 
      className="pt-6 px-5 pb-5 transition-all duration-200 bg-card/80 backdrop-blur-sm h-full flex flex-col hover-elevate relative border-border/30"
      data-testid={`card-value-vote-${person.id}`}
    >
      {person.category && (
        <div className="absolute top-3 right-3">
          <CategoryPill category={person.category} data-testid={`badge-category-${person.id}`} />
        </div>
      )}
      
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
        <Users className="h-3.5 w-3.5 text-cyan-400" />
        <span>{totalVotes.toLocaleString()} votes</span>
      </div>
      
      <div 
        className="flex items-start gap-3 mb-4 cursor-pointer group"
        onClick={onVisitProfile}
      >
        <PersonAvatar 
          name={person.name} 
          avatar={person.avatar} 
          size="lg" 
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-serif font-bold text-lg leading-tight group-hover:text-cyan-400 transition-colors">
            {person.name}
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fame Score: <span className="font-mono text-foreground">{(person.fameIndex ?? 0).toLocaleString()}</span>
          </p>
          {person.approvalPct != null && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {Math.round(person.approvalPct)}% approval rating
            </p>
          )}
        </div>
      </div>
      
      {!localVote ? (
        <div className="flex flex-col gap-3 mt-auto">
          <p className="text-sm text-muted-foreground text-center mb-1">
            Is {person.name.split(" ")[0]} underrated or overrated?
          </p>
          <button
            onClick={() => handleVote('underrated')}
            disabled={isPending}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20 disabled:opacity-50"
            data-testid={`button-underrated-${person.id}`}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ArrowUp className="h-4 w-4 shrink-0" />
                <span>Underrated</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleVote('fairly_rated')}
            disabled={isPending}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-white/5 border border-white/40 text-white text-sm font-medium transition-all duration-300 hover:border-white/80 hover:bg-white/15 disabled:opacity-50"
            data-testid={`button-fairly-rated-${person.id}`}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Minus className="h-4 w-4 shrink-0" />
                <span>Fairly Rated</span>
              </>
            )}
          </button>
          <button
            onClick={() => handleVote('overrated')}
            disabled={isPending}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 disabled:opacity-50"
            data-testid={`button-overrated-${person.id}`}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ArrowDown className="h-4 w-4 shrink-0" />
                <span>Overrated</span>
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 mt-auto">
          <div className="flex items-center gap-3">
            <ArrowUp className="h-4 w-4 text-[#00C853] shrink-0" />
            <span className="text-sm text-[#00C853] w-20 shrink-0">Underrated</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                style={{ width: `${underratedPct}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{Math.round(underratedPct)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <Minus className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="text-sm text-slate-400 w-20 shrink-0">Fair</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-slate-500 rounded-full transition-all duration-500"
                style={{ width: `${fairlyRatedPct}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{Math.round(fairlyRatedPct)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <ArrowDown className="h-4 w-4 text-[#FF0000] shrink-0" />
            <span className="text-sm text-[#FF0000] w-20 shrink-0">Overrated</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#FF0000] rounded-full transition-all duration-500"
                style={{ width: `${overratedPct}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground w-10 text-right">{Math.round(overratedPct)}%</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-white/10">
            <div className="flex items-center gap-2">
              {voteIcon}
              <span className="text-sm text-muted-foreground">
                You voted <span className={voteColor}>
                  {voteLabel}
                </span>
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleChangeVote}
              className="text-xs text-muted-foreground"
              data-testid={`button-change-vote-${person.id}`}
            >
              Change
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
