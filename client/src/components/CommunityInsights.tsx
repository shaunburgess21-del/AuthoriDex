import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ThumbsUp, ThumbsDown, Plus, X, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ThreadedComments } from "./ThreadedComments";

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
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [displayCount, setDisplayCount] = useState(4); // Show 4 posts initially
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false); // Mutable ref to prevent race conditions
  const loadMoreRef = useRef<HTMLDivElement>(null);

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

  const toggleComments = (insightId: string) => {
    setExpandedComments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(insightId)) {
        newSet.delete(insightId);
      } else {
        newSet.add(insightId);
      }
      return newSet;
    });
  };

  // Infinite scroll: load more when bottom element is visible
  const loadMore = useCallback(() => {
    // Use ref to prevent race conditions from stale closure
    if (isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    setIsLoadingMore(true);
    
    // Simulate a small delay for smooth UX (in production this would be actual API fetch)
    setTimeout(() => {
      setDisplayCount(prev => Math.min(prev + 4, insights.length));
      setIsLoadingMore(false);
      isLoadingRef.current = false;
    }, 300);
  }, [insights.length]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const currentRef = loadMoreRef.current;
    if (!currentRef) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        // Use ref check instead of state to avoid stale closure
        if (entries[0].isIntersecting && !isLoadingRef.current && displayCount < insights.length) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(currentRef);

    return () => observer.disconnect();
  }, [loadMore, displayCount, insights.length]);

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
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-serif font-bold">Community Insights</h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading insights...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pt-6">
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
                {/* Reddit-style layout: Header -> Content -> Actions */}
                <div className="space-y-3">
                  {/* Header: Avatar + Username + Sentiment Pill + Timestamp */}
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarFallback>
                        {insight.username.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="font-semibold text-sm" data-testid={`text-username-${insight.id}`}>
                        {insight.username}
                      </span>
                      {/* Sentiment Glass Pill Badge */}
                      {insight.sentimentVote && (
                        <span 
                          className="text-xs px-2 py-0.5 rounded-full backdrop-blur-sm border"
                          style={{
                            backgroundColor: `${getSentimentColor(insight.sentimentVote)}15`,
                            color: getSentimentColor(insight.sentimentVote),
                            borderColor: `${getSentimentColor(insight.sentimentVote)}40`,
                            boxShadow: `0 0 8px ${getSentimentColor(insight.sentimentVote)}20`,
                          }}
                          data-testid={`badge-sentiment-${insight.id}`}
                        >
                          Voted {insight.sentimentVote}/10
                        </span>
                      )}
                      {rankBadge && (
                        <Badge 
                          variant="secondary" 
                          className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 text-xs"
                          data-testid={`badge-rank-${insight.id}`}
                        >
                          {rankBadge.label}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground" data-testid={`text-timestamp-${insight.id}`}>
                        {formatDistanceToNow(new Date(insight.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="pl-11">
                    <p className="text-sm leading-relaxed break-words" data-testid={`text-content-${insight.id}`}>
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
                  </div>

                  {/* Actions Bar: Voting + Reply (Reddit-style bottom bar) */}
                  <div className="flex items-center gap-4 pl-11">
                    {/* Thumbs Up */}
                    <button
                      onClick={() => handleVote(insight.id, "up")}
                      disabled={!user}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-all ${
                        userVote === "up" 
                          ? "bg-green-500/20 text-green-500" 
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      data-testid={`button-upvote-${insight.id}`}
                    >
                      <ThumbsUp className={`h-4 w-4 ${userVote === "up" ? "fill-current" : ""}`} />
                      <span data-testid={`text-upvotes-${insight.id}`}>{insight.upvotes}</span>
                    </button>

                    {/* Thumbs Down */}
                    <button
                      onClick={() => handleVote(insight.id, "down")}
                      disabled={!user}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-all ${
                        userVote === "down" 
                          ? "bg-red-500/20 text-red-500" 
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      data-testid={`button-downvote-${insight.id}`}
                    >
                      <ThumbsDown className={`h-4 w-4 ${userVote === "down" ? "fill-current" : ""}`} />
                      <span data-testid={`text-downvotes-${insight.id}`}>{insight.downvotes}</span>
                    </button>

                  </div>

                  {/* Threaded Comments Section */}
                  <ThreadedComments
                    insightId={insight.id}
                    isOpen={expandedComments.has(insight.id)}
                    onToggle={() => toggleComments(insight.id)}
                  />
                </div>
              </div>
            );
          })
        )}

        {/* Infinite scroll trigger element */}
        {hasMore && (
          <div 
            ref={loadMoreRef} 
            className="flex justify-center py-6"
            data-testid="infinite-scroll-trigger"
          >
            {isLoadingMore && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading more insights...</span>
              </div>
            )}
          </div>
        )}
        
        {/* End of list indicator */}
        {!hasMore && insights.length > 0 && (
          <div className="flex justify-center py-6 text-muted-foreground text-sm">
            You've seen all {insights.length} insights
          </div>
        )}
      </div>
    </div>
  );
}
