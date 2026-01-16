import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Clock, LogIn, Loader2, CheckCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getSupabase } from "@/lib/supabase";

interface OverratedUnderratedWidgetProps {
  personId: string;
  personName: string;
  compact?: boolean;
}

export function OverratedUnderratedWidget({ 
  personId, 
  personName,
  compact = false 
}: OverratedUnderratedWidgetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [justVoted, setJustVoted] = useState<string | null>(null);

  const { data: userVote } = useQuery<{
    hasVotedToday: boolean;
    voteType: string | null;
  }>({
    queryKey: ["/api/sentiment-votes", personId],
    enabled: !!user,
  });

  const { data: voteCounts } = useQuery<{
    overrated: number;
    underrated: number;
  }>({
    queryKey: [`/api/sentiment-votes/${personId}/counts`],
  });

  const voteMutation = useMutation({
    mutationFn: async (voteType: "overrated" | "underrated") => {
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error("Please sign in to vote");
      }
      
      const response = await fetch("/api/sentiment-votes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          personId,
          personName,
          voteType,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to vote" }));
        throw new Error(error.error || "Failed to vote");
      }
      
      return response.json();
    },
    onSuccess: (_, voteType) => {
      setJustVoted(voteType);
      queryClient.invalidateQueries({ queryKey: ["/api/sentiment-votes", personId] });
      queryClient.invalidateQueries({ queryKey: [`/api/sentiment-votes/${personId}/counts`] });
      toast({
        title: "Vote recorded",
        description: "Your sentiment has been recorded. You can change it once per day.",
      });
      setTimeout(() => setJustVoted(null), 2000);
    },
    onError: (error: any) => {
      toast({
        title: "Vote failed",
        description: error.message || "Failed to submit your vote",
        variant: "destructive",
      });
    },
  });

  const handleVote = (voteType: "overrated" | "underrated") => {
    if (!user) {
      setLocation("/login");
      return;
    }
    voteMutation.mutate(voteType);
  };

  const totalVotes = (voteCounts?.overrated || 0) + (voteCounts?.underrated || 0);
  const overratedPercent = totalVotes > 0 
    ? Math.round((voteCounts?.overrated || 0) / totalVotes * 100) 
    : 50;
  const underratedPercent = totalVotes > 0 
    ? Math.round((voteCounts?.underrated || 0) / totalVotes * 100) 
    : 50;

  const isVotedOverrated = userVote?.voteType === "overrated" || justVoted === "overrated";
  const isVotedUnderrated = userVote?.voteType === "underrated" || justVoted === "underrated";

  if (compact) {
    return (
      <div className="flex items-center gap-2" data-testid="widget-overrated-underrated-compact">
        <Button
          variant={isVotedOverrated ? "default" : "outline"}
          size="sm"
          onClick={() => handleVote("overrated")}
          disabled={voteMutation.isPending}
          className={isVotedOverrated ? "toggle-elevate toggle-elevated" : ""}
          data-testid="button-vote-overrated"
        >
          {voteMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          <span className="text-xs ml-1">{voteCounts?.overrated || 0}</span>
        </Button>
        <Button
          variant={isVotedUnderrated ? "default" : "outline"}
          size="sm"
          onClick={() => handleVote("underrated")}
          disabled={voteMutation.isPending}
          className={isVotedUnderrated ? "toggle-elevate toggle-elevated" : ""}
          data-testid="button-vote-underrated"
        >
          {voteMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <TrendingUp className="h-3 w-3" />
          )}
          <span className="text-xs ml-1">{voteCounts?.underrated || 0}</span>
        </Button>
      </div>
    );
  }

  return (
    <Card className="p-4" data-testid="widget-overrated-underrated">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="font-semibold text-sm">Is {personName} fairly rated?</h3>
        {userVote?.hasVotedToday && (
          <Badge variant="outline" className="text-xs gap-1">
            <CheckCircle className="h-3 w-3" />
            Voted today
          </Badge>
        )}
      </div>
      
      <div className="flex gap-3 mb-3">
        <Button
          variant={isVotedOverrated ? "default" : "outline"}
          onClick={() => handleVote("overrated")}
          disabled={voteMutation.isPending}
          className={`flex-1 gap-2 ${isVotedOverrated ? "toggle-elevate toggle-elevated" : ""}`}
          data-testid="button-vote-overrated"
        >
          {voteMutation.isPending && voteMutation.variables === "overrated" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )}
          Overrated
        </Button>
        
        <Button
          variant={isVotedUnderrated ? "default" : "outline"}
          onClick={() => handleVote("underrated")}
          disabled={voteMutation.isPending}
          className={`flex-1 gap-2 ${isVotedUnderrated ? "toggle-elevate toggle-elevated" : ""}`}
          data-testid="button-vote-underrated"
        >
          {voteMutation.isPending && voteMutation.variables === "underrated" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <TrendingUp className="h-4 w-4" />
          )}
          Underrated
        </Button>
      </div>
      
      {totalVotes > 0 ? (
        <div className="space-y-2">
          <div className="h-2.5 bg-muted rounded-full overflow-hidden flex">
            <div 
              className="bg-red-500/70 transition-all duration-500"
              style={{ width: `${overratedPercent}%` }}
            />
            <div 
              className="bg-green-500/70 transition-all duration-500"
              style={{ width: `${underratedPercent}%` }}
            />
          </div>
          
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500/70" />
              <span>
                <span className="font-medium text-foreground">{overratedPercent}%</span> overrated
              </span>
            </div>
            <span className="text-[10px]">
              {totalVotes.toLocaleString()} votes
            </span>
            <div className="flex items-center gap-1.5">
              <span>
                <span className="font-medium text-foreground">{underratedPercent}%</span> underrated
              </span>
              <div className="w-2 h-2 rounded-full bg-green-500/70" />
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-center text-muted-foreground">
          Be the first to share your opinion!
        </p>
      )}
      
      {!user && (
        <div className="pt-3 mt-3 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/login")}
            className="w-full gap-2"
            data-testid="button-login-to-vote"
          >
            <LogIn className="h-4 w-4" />
            Sign in to cast your vote
          </Button>
        </div>
      )}
    </Card>
  );
}
