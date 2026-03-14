import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowUp, ArrowDown, BarChart3, LogIn, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface OverratedUnderratedWidgetProps {
  personId: string;
  personName: string;
  compact?: boolean;
}

interface ValueVoteResponse {
  userVote: 'underrated' | 'overrated' | null;
  underratedVotesCount: number;
  overratedVotesCount: number;
}

export function OverratedUnderratedWidget({ 
  personId, 
  personName,
  compact = false 
}: OverratedUnderratedWidgetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [localVote, setLocalVote] = useState<'underrated' | 'overrated' | null>(null);
  const [showChange, setShowChange] = useState(false);

  const { data: voteData } = useQuery<ValueVoteResponse>({
    queryKey: ['/api/celebrity', personId, 'value-vote'],
  });

  const voteMutation = useMutation({
    mutationFn: async (vote: 'underrated' | 'overrated') => {
      return apiRequest('POST', `/api/celebrity/${personId}/value-vote`, { vote });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/celebrity', personId, 'value-vote'] });
      queryClient.invalidateQueries({ queryKey: ['/api/trending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leaderboard?tab=value&limit=20'] });
      setShowChange(false);
    },
    onError: (error: any) => {
      setLocalVote(null);
      toast({
        title: "Vote failed",
        description: error.message?.includes("401") ? "Please sign in to vote" : (error.message || "Failed to submit vote"),
        variant: "destructive",
      });
    },
  });

  const handleVote = (voteType: 'underrated' | 'overrated') => {
    if (!user) {
      setLocation("/login");
      return;
    }
    setLocalVote(voteType);
    voteMutation.mutate(voteType);
  };

  const handleChangeVote = () => {
    setLocalVote(null);
    setShowChange(true);
  };

  const userVote = localVote ?? voteData?.userVote ?? null;
  const hasVoted = userVote !== null && !showChange;
  
  const underratedCount = voteData?.underratedVotesCount || 0;
  const overratedCount = voteData?.overratedVotesCount || 0;
  const totalVotes = underratedCount + overratedCount;
  
  const underratedPct = totalVotes > 0 ? Math.round((underratedCount / totalVotes) * 100) : 50;
  const overratedPct = 100 - underratedPct;

  if (compact) {
    return (
      <div className="flex items-center gap-2" data-testid="widget-overrated-underrated-compact">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleVote("underrated")}
          disabled={voteMutation.isPending}
          className={`${userVote === 'underrated' ? 'bg-[#00C853]/20 border-[#00C853]/50 text-[#00C853]' : ''}`}
          data-testid="button-vote-underrated"
        >
          {voteMutation.isPending && localVote === 'underrated' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )}
          <span className="text-xs ml-1">{underratedCount}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleVote("overrated")}
          disabled={voteMutation.isPending}
          className={`${userVote === 'overrated' ? 'bg-[#FF0000]/20 border-[#FF0000]/50 text-[#FF0000]' : ''}`}
          data-testid="button-vote-overrated"
        >
          {voteMutation.isPending && localVote === 'overrated' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )}
          <span className="text-xs ml-1">{overratedCount}</span>
        </Button>
      </div>
    );
  }

  return (
    <Card 
      className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-slate-700/50"
      data-testid="widget-overrated-underrated"
    >
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5 text-cyan-400" />
            <span>{totalVotes.toLocaleString('en-US')} votes</span>
          </div>
          <h3 className="font-semibold text-sm">Is {personName} fairly rated?</h3>
        </div>
        
        {hasVoted ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <ArrowUp className="h-4 w-4 text-[#00C853] shrink-0" />
              <span className="text-sm text-[#00C853] w-20 shrink-0">Underrated</span>
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                  style={{ width: `${underratedPct}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground w-10 text-right">{underratedPct}%</span>
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
              <span className="text-sm text-muted-foreground w-10 text-right">{overratedPct}%</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <div className="flex items-center gap-2">
                {userVote === 'underrated' ? (
                  <ArrowUp className="h-4 w-4 text-[#00C853]" />
                ) : (
                  <ArrowDown className="h-4 w-4 text-[#FF0000]" />
                )}
                <span className="text-sm text-muted-foreground">
                  You voted <span className={userVote === 'underrated' ? 'text-[#00C853]' : 'text-[#FF0000]'}>
                    {userVote}
                  </span>
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleChangeVote}
                className="text-xs text-muted-foreground"
                data-testid="button-value-change"
              >
                Change
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 bg-[#00C853]/10 border-[#00C853]/50 text-[#00C853]"
              onClick={() => handleVote('underrated')}
              disabled={voteMutation.isPending}
              data-testid="button-vote-underrated"
            >
              {voteMutation.isPending && localVote === 'underrated' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4 mr-1" />
              )}
              Underrated
            </Button>
            <Button
              variant="outline"
              className="flex-1 bg-[#FF0000]/10 border-[#FF0000]/50 text-[#FF0000]"
              onClick={() => handleVote('overrated')}
              disabled={voteMutation.isPending}
              data-testid="button-vote-overrated"
            >
              {voteMutation.isPending && localVote === 'overrated' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <ArrowDown className="h-4 w-4 mr-1" />
              )}
              Overrated
            </Button>
          </div>
        )}
        
        {!user && !hasVoted && (
          <div className="pt-3 mt-3 border-t border-white/10">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/login")}
              className="w-full gap-2 text-muted-foreground"
              data-testid="button-login-to-vote"
            >
              <LogIn className="h-4 w-4" />
              Sign in to cast your vote
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
