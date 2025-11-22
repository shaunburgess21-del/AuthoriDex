import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown, Plus, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface CommunityInsight {
  id: string;
  personId: string;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
}

interface CommunityInsightsProps {
  personId: string;
  personName: string;
}

export function CommunityInsights({ personId, personName }: CommunityInsightsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [newInsight, setNewInsight] = useState("");
  const [userVotes, setUserVotes] = useState<Record<string, string>>({});

  // Fetch insights
  const { data: insights = [], isLoading, refetch } = useQuery<CommunityInsight[]>({
    queryKey: [`/api/community-insights/${personId}`],
  });

  // Fetch user's votes
  useEffect(() => {
    if (!user) return;

    async function fetchUserVotes() {
      try {
        const supabase = await import("@/lib/supabase").then(m => m.getSupabase());
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) return;

        const response = await fetch(`/api/community-insights/${personId}/votes`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        
        if (response.ok) {
          const votes = await response.json();
          setUserVotes(votes);
        }
      } catch (error) {
        console.error("Error fetching user votes:", error);
      }
    }

    fetchUserVotes();
  }, [personId, user]);

  // Create insight mutation
  const createInsightMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!user) throw new Error("Must be logged in to post");
      
      const supabase = await import("@/lib/supabase").then(m => m.getSupabase());
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) throw new Error("No active session");

      const response = await fetch("/api/community-insights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        credentials: "include",
        body: JSON.stringify({
          personId,
          username: user.email?.split('@')[0] || user.id.substring(0, 8),
          content,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create insight");
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/community-insights/${personId}`] });
      setNewInsight("");
      setShowForm(false);
      toast({
        title: "Success",
        description: "Your insight has been posted!",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to post insight",
        variant: "destructive",
      });
    },
  });

  // Vote mutation
  const voteMutation = useMutation({
    mutationFn: async ({ insightId, voteType }: { insightId: string; voteType: string }) => {
      if (!user) throw new Error("Must be logged in to vote");

      const supabase = await import("@/lib/supabase").then(m => m.getSupabase());
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) throw new Error("No active session");

      const response = await fetch(`/api/community-insights/${insightId}/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        credentials: "include",
        body: JSON.stringify({ voteType }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to vote");
      }

      return response;
    },
    onSuccess: (_, variables) => {
      // Update local vote state immediately
      setUserVotes(prev => ({
        ...prev,
        [variables.insightId]: variables.voteType,
      }));
      // Refetch insights to get updated vote counts
      queryClient.invalidateQueries({ queryKey: [`/api/community-insights/${personId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to vote",
        variant: "destructive",
      });
    },
  });

  const handleVote = (insightId: string, voteType: "up" | "down") => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in to vote on insights",
        variant: "destructive",
      });
      return;
    }

    voteMutation.mutate({ insightId, voteType });
  };

  const handleSubmit = () => {
    if (!newInsight.trim()) {
      toast({
        title: "Error",
        description: "Please enter some content",
        variant: "destructive",
      });
      return;
    }

    createInsightMutation.mutate(newInsight);
  };

  const getNetVotes = (insight: CommunityInsight) => insight.upvotes - insight.downvotes;

  const getVoteColor = (netVotes: number) => {
    if (netVotes > 0) return "text-green-500";
    if (netVotes < 0) return "text-red-500";
    return "text-muted-foreground";
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-serif font-bold">Community Insights</h2>
        </div>
        <p className="text-muted-foreground">Loading insights...</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-serif font-bold" data-testid="text-community-insights-title">
          Community Insights
        </h2>
        {!showForm && (
          <Button
            onClick={() => setShowForm(true)}
            size="sm"
            className="gap-2"
            data-testid="button-share-insight"
          >
            <Plus className="h-4 w-4" />
            Share Insight
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mb-6 max-w-2xl mx-auto">
          <div className="p-4 border rounded-md bg-card border-border">
            <div className="space-y-3">
              <Textarea
                placeholder={`What are your thoughts on ${personName}?`}
                value={newInsight}
                onChange={(e) => setNewInsight(e.target.value)}
                rows={4}
                className="resize-none"
                data-testid="textarea-new-insight"
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowForm(false);
                    setNewInsight("");
                  }}
                  data-testid="button-cancel-insight"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={createInsightMutation.isPending}
                  data-testid="button-post-insight"
                >
                  {createInsightMutation.isPending ? "Posting..." : "Post"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4 max-w-2xl mx-auto">
        {insights.length === 0 ? (
          <div className="p-8 text-center border rounded-md border-border">
            <p className="text-muted-foreground">
              No insights yet. Be the first to share your thoughts on {personName}!
            </p>
          </div>
        ) : (
          insights.map((insight) => {
            const netVotes = getNetVotes(insight);
            const userVote = userVotes[insight.id];
            const isTopPost = netVotes >= 100;

            return (
              <div
                key={insight.id}
                className={`p-4 border rounded-md bg-card ${
                  isTopPost ? "border-yellow-500 border-2" : "border-border"
                }`}
                data-testid={`card-insight-${insight.id}`}
              >
                <div className="flex gap-4">
                  {/* Voting Column - Avatar-style arrows */}
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={() => handleVote(insight.id, "up")}
                      disabled={!user}
                      className={`flex items-center justify-center w-10 h-10 rounded-md transition-all ${
                        userVote === "up" 
                          ? "bg-green-500/20 text-green-500 border border-green-500/30" 
                          : "bg-muted/50 text-muted-foreground hover-elevate active-elevate-2"
                      } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      data-testid={`button-upvote-${insight.id}`}
                    >
                      <ChevronUp className="h-6 w-6" />
                    </button>
                    <span
                      className={`font-mono font-bold text-base ${getVoteColor(netVotes)}`}
                      data-testid={`text-vote-count-${insight.id}`}
                    >
                      {netVotes}
                    </span>
                    <button
                      onClick={() => handleVote(insight.id, "down")}
                      disabled={!user}
                      className={`flex items-center justify-center w-10 h-10 rounded-md transition-all ${
                        userVote === "down" 
                          ? "bg-red-500/20 text-red-500 border border-red-500/30" 
                          : "bg-muted/50 text-muted-foreground hover-elevate active-elevate-2"
                      } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      data-testid={`button-downvote-${insight.id}`}
                    >
                      <ChevronDown className="h-6 w-6" />
                    </button>
                  </div>

                  {/* Content Column */}
                  <div className="flex-1 space-y-2 min-w-0">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        <AvatarFallback>
                          {insight.username.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm" data-testid={`text-username-${insight.id}`}>
                            {insight.username}
                          </span>
                          <span className="text-xs text-muted-foreground" data-testid={`text-timestamp-${insight.id}`}>
                            {formatDistanceToNow(new Date(insight.createdAt), { addSuffix: true })}
                          </span>
                          {isTopPost && (
                            <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">
                              Top
                            </Badge>
                          )}
                        </div>
                        <p className="mt-2 text-sm leading-relaxed break-words" data-testid={`text-content-${insight.id}`}>
                          {insight.content}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
