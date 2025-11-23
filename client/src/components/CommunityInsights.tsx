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

// Utility: Get sentiment color based on 1-10 vote (matches Cast Your Vote widget)
function getSentimentColor(vote: number): string {
  // Color gradient matching SentimentVotingWidget
  const colors = [
    "#dc2626", // 1 - red
    "#e63946", // 2 - red-orange
    "#f97316", // 3 - orange
    "#fa9c3c", // 4 - orange-yellow
    "#fbbf24", // 5 - yellow
    "#c1d42d", // 6 - yellow-lime
    "#84cc16", // 7 - lime
    "#5bca30", // 8 - lime-green
    "#22c55e", // 9 - green
    "#22c55e", // 10 - green
  ];
  return colors[vote - 1] || colors[4]; // Default to yellow if invalid
}

// Utility: Get rank badge info (gold/silver/bronze)
interface RankBadge {
  rank: number;
  label: string;
  borderColor: string;
  boxShadow: string;
}

function getRankBadge(rank: number): RankBadge | null {
  if (rank === 1) {
    return {
      rank: 1,
      label: "Top",
      borderColor: "rgba(245, 158, 11, 0.6)", // amber-500 with 60% opacity
      boxShadow: "0 0 20px rgba(245, 158, 11, 0.15)",
    };
  } else if (rank === 2) {
    return {
      rank: 2,
      label: "2nd",
      borderColor: "rgba(148, 163, 184, 0.6)", // slate-400 with 60% opacity
      boxShadow: "0 0 20px rgba(148, 163, 184, 0.15)",
    };
  } else if (rank === 3) {
    return {
      rank: 3,
      label: "3rd",
      borderColor: "rgba(234, 88, 12, 0.6)", // orange-600 with 60% opacity
      boxShadow: "0 0 20px rgba(234, 88, 12, 0.15)",
    };
  }
  return null;
}

// Utility: Truncate text to character limit
function truncateText(text: string, limit: number): { preview: string; isTruncated: boolean } {
  if (text.length <= limit) {
    return { preview: text, isTruncated: false };
  }
  return { preview: text.substring(0, limit), isTruncated: true };
}

interface CommunityInsight {
  id: string;
  personId: string;
  userId: string;
  username: string;
  content: string;
  sentimentVote?: number | null;
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
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set());
  const [displayCount, setDisplayCount] = useState(4); // Show 4 posts initially

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

  const toggleExpanded = (insightId: string) => {
    setExpandedPosts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(insightId)) {
        newSet.delete(insightId);
      } else {
        newSet.add(insightId);
      }
      return newSet;
    });
  };

  const loadMore = () => {
    setDisplayCount(15);
  };

  // Rank insights by net votes (for gold/silver/bronze borders)
  const rankedInsights = [...insights].sort((a, b) => {
    const aNet = getNetVotes(a);
    const bNet = getNetVotes(b);
    if (aNet !== bNet) return bNet - aNet; // Sort by net votes descending
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); // Tie-breaker: most recent first
  });

  // Get rank for an insight (1-indexed)
  const getInsightRank = (insightId: string): number => {
    return rankedInsights.findIndex(i => i.id === insightId) + 1;
  };

  // Get display limit for insights
  const displayedInsights = insights.slice(0, displayCount);
  const hasMore = insights.length > displayCount;

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

      <div className="space-y-4 max-w-2xl mx-auto max-h-96 overflow-y-auto">
        {insights.length === 0 ? (
          <div className="p-8 text-center border rounded-md border-border">
            <p className="text-muted-foreground">
              No insights yet. Be the first to share your thoughts on {personName}!
            </p>
          </div>
        ) : (
          displayedInsights.map((insight) => {
            const netVotes = getNetVotes(insight);
            const userVote = userVotes[insight.id];
            const rank = getInsightRank(insight.id);
            const rankBadge = getRankBadge(rank);
            const isExpanded = expandedPosts.has(insight.id);
            const { preview, isTruncated } = truncateText(insight.content, 280);

            return (
              <div
                key={insight.id}
                className="p-4 border rounded-md bg-card"
                style={rankBadge ? {
                  borderColor: rankBadge.borderColor,
                  boxShadow: rankBadge.boxShadow,
                } : undefined}
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
                          {rankBadge && (
                            <Badge 
                              variant="secondary" 
                              className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30"
                              data-testid={`badge-rank-${insight.id}`}
                            >
                              {rankBadge.label}
                            </Badge>
                          )}
                          {insight.sentimentVote && (
                            <Badge 
                              variant="secondary"
                              style={{
                                backgroundColor: `${getSentimentColor(insight.sentimentVote)}20`,
                                color: getSentimentColor(insight.sentimentVote),
                                borderColor: `${getSentimentColor(insight.sentimentVote)}30`,
                              }}
                              data-testid={`badge-sentiment-${insight.id}`}
                            >
                              Voted {insight.sentimentVote}/10
                            </Badge>
                          )}
                        </div>
                        <p className="mt-2 text-sm leading-relaxed break-words" data-testid={`text-content-${insight.id}`}>
                          {isExpanded ? insight.content : preview}
                          {isTruncated && !isExpanded && "..."}
                        </p>
                        {isTruncated && (
                          <button
                            onClick={() => toggleExpanded(insight.id)}
                            className="text-xs text-primary hover:underline mt-1"
                            data-testid={`button-toggle-${insight.id}`}
                          >
                            {isExpanded ? "Show Less" : "Show More"}
                          </button>
                        )}
                        
                        {/* Vote Breakdown */}
                        <div className="flex items-center gap-3 mt-2 text-xs">
                          <span className="text-green-500" data-testid={`text-upvotes-${insight.id}`}>
                            Upvotes - {insight.upvotes}
                          </span>
                          <span className="text-muted-foreground">|</span>
                          <span className="text-red-500" data-testid={`text-downvotes-${insight.id}`}>
                            Downvotes - {insight.downvotes}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Load More / View Less Buttons */}
        <div className="flex justify-center pt-2 gap-2">
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              data-testid="button-load-more"
            >
              Load More
            </Button>
          )}
          {displayCount > 4 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDisplayCount(4)}
              data-testid="button-view-less"
            >
              View Less
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
