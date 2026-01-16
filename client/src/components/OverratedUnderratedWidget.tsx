import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThumbsUp, ThumbsDown, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

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

  const { data: userVote, isLoading: isLoadingUserVote } = useQuery<{
    hasVotedToday: boolean;
    voteType: string | null;
  }>({
    queryKey: ["/api/sentiment-votes", personId],
    enabled: !!user,
  });

  const { data: voteCounts, isLoading: isLoadingCounts } = useQuery<{
    overrated: number;
    underrated: number;
  }>({
    queryKey: [`/api/sentiment-votes/${personId}/counts`],
  });

  const voteMutation = useMutation({
    mutationFn: async (voteType: "overrated" | "underrated") => {
      const response = await apiRequest("POST", "/api/sentiment-votes", {
        personId,
        personName,
        voteType,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentiment-votes", personId] });
      queryClient.invalidateQueries({ queryKey: [`/api/sentiment-votes/${personId}/counts`] });
      toast({
        title: "Vote recorded",
        description: "Your sentiment has been recorded. You can change it once per day.",
      });
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
      toast({
        title: "Sign in required",
        description: "Please sign in to vote",
        variant: "destructive",
      });
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

  if (compact) {
    return (
      <div className="flex items-center gap-2" data-testid="widget-overrated-underrated-compact">
        <Button
          variant={userVote?.voteType === "overrated" ? "default" : "outline"}
          size="sm"
          onClick={() => handleVote("overrated")}
          disabled={voteMutation.isPending}
          className={`gap-1 ${userVote?.voteType === "overrated" ? "bg-red-500/20 border-red-500/50 text-red-400" : ""}`}
          data-testid="button-vote-overrated"
        >
          <TrendingDown className="h-3 w-3" />
          <span className="text-xs">{voteCounts?.overrated || 0}</span>
        </Button>
        <Button
          variant={userVote?.voteType === "underrated" ? "default" : "outline"}
          size="sm"
          onClick={() => handleVote("underrated")}
          disabled={voteMutation.isPending}
          className={`gap-1 ${userVote?.voteType === "underrated" ? "bg-green-500/20 border-green-500/50 text-green-400" : ""}`}
          data-testid="button-vote-underrated"
        >
          <TrendingUp className="h-3 w-3" />
          <span className="text-xs">{voteCounts?.underrated || 0}</span>
        </Button>
      </div>
    );
  }

  return (
    <Card className="p-4" data-testid="widget-overrated-underrated">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Is {personName} fairly rated?</h3>
        {userVote?.hasVotedToday && (
          <Badge variant="outline" className="text-xs gap-1">
            <Clock className="h-3 w-3" />
            Voted today
          </Badge>
        )}
      </div>
      
      <div className="flex gap-2 mb-3">
        <Button
          variant={userVote?.voteType === "overrated" ? "default" : "outline"}
          onClick={() => handleVote("overrated")}
          disabled={voteMutation.isPending}
          className={`flex-1 gap-2 ${
            userVote?.voteType === "overrated" 
              ? "bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30" 
              : "hover:border-red-500/30 hover:text-red-400"
          }`}
          data-testid="button-vote-overrated"
        >
          <TrendingDown className="h-4 w-4" />
          Overrated
        </Button>
        <Button
          variant={userVote?.voteType === "underrated" ? "default" : "outline"}
          onClick={() => handleVote("underrated")}
          disabled={voteMutation.isPending}
          className={`flex-1 gap-2 ${
            userVote?.voteType === "underrated" 
              ? "bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30" 
              : "hover:border-green-500/30 hover:text-green-400"
          }`}
          data-testid="button-vote-underrated"
        >
          <TrendingUp className="h-4 w-4" />
          Underrated
        </Button>
      </div>
      
      {totalVotes > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{voteCounts?.overrated || 0} say overrated</span>
            <span>{voteCounts?.underrated || 0} say underrated</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden flex">
            <div 
              className="bg-red-500/60 transition-all duration-300"
              style={{ width: `${overratedPercent}%` }}
            />
            <div 
              className="bg-green-500/60 transition-all duration-300"
              style={{ width: `${underratedPercent}%` }}
            />
          </div>
          <p className="text-xs text-center text-muted-foreground">
            {totalVotes} total votes
          </p>
        </div>
      )}
      
      {!user && (
        <p className="text-xs text-center text-muted-foreground mt-2">
          Sign in to vote (1 vote per person per day)
        </p>
      )}
    </Card>
  );
}
