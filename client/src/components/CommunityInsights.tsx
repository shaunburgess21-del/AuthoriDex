import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ThumbsUp, ThumbsDown, MessageCircle, Plus, X, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { PostOverlayModal } from "./PostOverlayModal";

function getSentimentColor(vote: number): string {
  const colors = [
    "#dc2626", "#e63946", "#f97316", "#fa9c3c", "#fbbf24",
    "#c1d42d", "#84cc16", "#5bca30", "#22c55e", "#22c55e",
  ];
  return colors[vote - 1] || colors[4];
}

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
      borderColor: "rgba(245, 158, 11, 0.6)",
      boxShadow: "0 0 20px rgba(245, 158, 11, 0.15)",
    };
  } else if (rank === 2) {
    return {
      rank: 2,
      label: "2nd",
      borderColor: "rgba(148, 163, 184, 0.6)",
      boxShadow: "0 0 20px rgba(148, 163, 184, 0.15)",
    };
  } else if (rank === 3) {
    return {
      rank: 3,
      label: "3rd",
      borderColor: "rgba(234, 88, 12, 0.6)",
      boxShadow: "0 0 20px rgba(234, 88, 12, 0.15)",
    };
  }
  return null;
}

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
  const [selectedInsight, setSelectedInsight] = useState<CommunityInsight | null>(null);
  const [displayCount, setDisplayCount] = useState(4);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingRef = useRef(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const { data: insights = [], isLoading, refetch } = useQuery<CommunityInsight[]>({
    queryKey: [`/api/community-insights/${personId}`],
  });

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
      setUserVotes(prev => {
        if (prev[variables.insightId] === variables.voteType) {
          const newVotes = { ...prev };
          delete newVotes[variables.insightId];
          return newVotes;
        }
        return { ...prev, [variables.insightId]: variables.voteType };
      });
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

  const openPostOverlay = (insight: CommunityInsight) => {
    setSelectedInsight(insight);
  };

  const loadMore = useCallback(() => {
    if (isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    setIsLoadingMore(true);
    
    setTimeout(() => {
      setDisplayCount(prev => Math.min(prev + 4, insights.length));
      setIsLoadingMore(false);
      isLoadingRef.current = false;
    }, 300);
  }, [insights.length]);

  useEffect(() => {
    const currentRef = loadMoreRef.current;
    if (!currentRef) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingRef.current && displayCount < insights.length) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(currentRef);

    return () => observer.disconnect();
  }, [loadMore, displayCount, insights.length]);

  const rankedInsights = [...insights].sort((a, b) => {
    const aNet = getNetVotes(a);
    const bNet = getNetVotes(b);
    if (aNet !== bNet) return bNet - aNet;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const getInsightRank = (insightId: string): number => {
    return rankedInsights.findIndex(i => i.id === insightId) + 1;
  };

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
                className="p-4 border rounded-md bg-card cursor-pointer hover:bg-muted/30 transition-colors"
                style={rankBadge ? {
                  borderColor: rankBadge.borderColor,
                  boxShadow: rankBadge.boxShadow,
                } : undefined}
                onClick={() => openPostOverlay(insight)}
                data-testid={`card-insight-${insight.id}`}
              >
                <div className="space-y-3">
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

                  <div className="pl-11">
                    <p className="text-sm leading-relaxed break-words" data-testid={`text-content-${insight.id}`}>
                      {isExpanded ? insight.content : preview}
                      {isTruncated && !isExpanded && "..."}
                    </p>
                    {isTruncated && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(insight.id);
                        }}
                        className="text-xs text-primary hover:underline mt-1"
                        data-testid={`button-toggle-${insight.id}`}
                      >
                        {isExpanded ? "Show Less" : "Show More"}
                      </button>
                    )}
                  </div>

                  <div 
                    className="flex items-center gap-1 pl-11"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleVote(insight.id, "up")}
                      disabled={!user}
                      className={`p-1.5 rounded-md transition-all ${
                        userVote === "up" 
                          ? "text-green-500 bg-green-500/10" 
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      data-testid={`button-upvote-${insight.id}`}
                    >
                      <ThumbsUp className={`h-4 w-4 ${userVote === "up" ? "fill-current" : ""}`} />
                    </button>

                    <span 
                      className={`text-sm font-medium min-w-[2.5rem] text-center ${
                        netVotes > 0 ? "text-green-500" : netVotes < 0 ? "text-red-500" : "text-muted-foreground"
                      }`}
                      data-testid={`text-netvotes-${insight.id}`}
                    >
                      {netVotes > 0 ? `+${netVotes}` : netVotes}
                    </span>

                    <button
                      onClick={() => handleVote(insight.id, "down")}
                      disabled={!user}
                      className={`p-1.5 rounded-md transition-all ${
                        userVote === "down" 
                          ? "text-red-500 bg-red-500/10" 
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      data-testid={`button-downvote-${insight.id}`}
                    >
                      <ThumbsDown className={`h-4 w-4 ${userVote === "down" ? "fill-current" : ""}`} />
                    </button>

                    <button
                      onClick={() => openPostOverlay(insight)}
                      className="flex items-center gap-1.5 p-1.5 ml-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                      data-testid={`button-comments-${insight.id}`}
                    >
                      <MessageCircle className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}

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
        
        {!hasMore && insights.length > 0 && (
          <div className="flex justify-center py-6 text-muted-foreground text-sm">
            You've seen all {insights.length} insights
          </div>
        )}
      </div>

      <PostOverlayModal
        insight={selectedInsight}
        isOpen={!!selectedInsight}
        onClose={() => setSelectedInsight(null)}
        userVote={selectedInsight ? userVotes[selectedInsight.id] : undefined}
        onVote={handleVote}
      />
    </div>
  );
}
