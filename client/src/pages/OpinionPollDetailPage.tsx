import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { apiRequest } from "@/lib/queryClient";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";
import {
  ArrowLeft,
  Users,
  Loader2,
  Send,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  MessageSquare,
  ArrowUpDown,
  Share2,
  Vote,
} from "lucide-react";

function formatTimeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function OpinionPollDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [commentSort, setCommentSort] = useState<"top" | "newest">("top");

  const { data: poll, isLoading } = useQuery<any>({
    queryKey: ["/api/opinion-polls", slug],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const token = localStorage.getItem("auth_token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/opinion-polls/${slug}`, { headers });
      if (!res.ok) throw new Error("Poll not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const { data: comments = [] } = useQuery<any[]>({
    queryKey: ["/api/opinion-polls", slug, "comments", commentSort],
    queryFn: async () => {
      const res = await fetch(`/api/opinion-polls/${slug}/comments?sort=${commentSort}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!slug,
  });

  const voteMutation = useMutation({
    mutationFn: async (optionId: string) => {
      const res = await apiRequest("POST", `/api/opinion-polls/${slug}/vote`, { optionId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls", slug] });
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls"] });
      toast({ title: "Vote recorded" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to vote. Please sign in.", variant: "destructive" });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `/api/opinion-polls/${slug}/comments`, { body });
      return res.json();
    },
    onSuccess: () => {
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls", slug, "comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls", slug] });
      toast({ title: "Comment posted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to post comment. Please sign in.", variant: "destructive" });
    },
  });

  const commentVoteMutation = useMutation({
    mutationFn: async ({ commentId, voteType }: { commentId: string; voteType: string }) => {
      const res = await apiRequest("POST", `/api/opinion-polls/comments/${commentId}/vote`, { voteType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls", slug, "comments"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to vote. Please sign in.", variant: "destructive" });
    },
  });

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied to clipboard" });
    } catch {
      toast({ title: "Share", description: url });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!poll) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Poll not found</p>
        <Link href="/vote">
          <Button variant="outline" data-testid="button-back-to-vote">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Vote
          </Button>
        </Link>
      </div>
    );
  }

  const hasVoted = !!poll.userVote;
  const options = poll.options || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/vote">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <AuthoriDexLogo size={24} />
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Badge variant="outline" className="text-xs">{poll.category}</Badge>
            {poll.featured && <Badge className="text-xs bg-cyan-500/20 text-cyan-400 border-cyan-500/30">Featured</Badge>}
          </div>
          <h1 className="text-2xl font-serif font-bold mb-2" data-testid="text-poll-title">{poll.title}</h1>
          {poll.description && (
            <p className="text-muted-foreground" data-testid="text-poll-description">{poll.description}</p>
          )}
          <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {(poll.totalVotes || 0).toLocaleString()} votes
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-4 w-4" />
              {(poll.commentCount || 0)} comments
            </span>
            <Button variant="ghost" size="sm" onClick={handleShare} className="ml-auto" data-testid="button-share-poll">
              <Share2 className="h-4 w-4 mr-1" />
              Share
            </Button>
          </div>
        </div>

        <Card className="mb-8 overflow-visible">
          <div className="p-4 sm:p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Vote className="h-5 w-5 text-cyan-400" />
              {hasVoted ? "Results" : "Cast your vote"}
            </h2>
            <div className="space-y-3">
              {options.map((option: any) => {
                const isSelected = poll.userVote === option.id;
                const percent = option.percent || 0;

                return (
                  <button
                    key={option.id}
                    className={`w-full text-left p-3 rounded-lg border transition-all relative overflow-hidden ${
                      isSelected
                        ? "border-cyan-500/50 bg-cyan-500/10"
                        : hasVoted
                        ? "border-border/50 bg-muted/20"
                        : "border-border/50 hover-elevate cursor-pointer"
                    }`}
                    onClick={() => {
                      if (!user) {
                        toast({ title: "Sign in required", description: "Please sign in to vote", variant: "destructive" });
                        return;
                      }
                      voteMutation.mutate(option.id);
                    }}
                    disabled={voteMutation.isPending}
                    data-testid={`button-vote-option-${option.id}`}
                  >
                    {hasVoted && (
                      <div
                        className="absolute inset-0 bg-cyan-500/10 transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    )}
                    <div className="relative flex items-center gap-3">
                      {option.imageUrl ? (
                        <img src={option.imageUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0">
                          <span className="text-sm font-medium text-cyan-400">{option.orderIndex + 1}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm">{option.name}</span>
                        {option.personName && option.personName !== option.name && (
                          <span className="text-xs text-muted-foreground ml-2">({option.personName})</span>
                        )}
                      </div>
                      {hasVoted && (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-medium">{percent}%</span>
                          <span className="text-xs text-muted-foreground">({option.votes})</span>
                        </div>
                      )}
                      {isSelected && (
                        <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {voteMutation.isPending && (
              <div className="flex items-center justify-center mt-3">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400 mr-2" />
                <span className="text-sm text-muted-foreground">Recording vote...</span>
              </div>
            )}
          </div>
        </Card>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              Comments ({comments.length})
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCommentSort(s => s === "top" ? "newest" : "top")}
              data-testid="button-sort-comments"
            >
              <ArrowUpDown className="h-4 w-4 mr-1" />
              {commentSort === "top" ? "Top" : "Newest"}
            </Button>
          </div>

          {user && (
            <div className="flex gap-3 mb-6">
              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Share your thoughts..."
                className="flex-1 resize-none"
                rows={2}
                data-testid="input-comment"
              />
              <Button
                size="icon"
                onClick={() => {
                  if (commentText.trim()) commentMutation.mutate(commentText.trim());
                }}
                disabled={!commentText.trim() || commentMutation.isPending}
                data-testid="button-submit-comment"
              >
                {commentMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}

          <div className="space-y-4">
            {comments.map((comment: any) => (
              <div key={comment.id} className="flex gap-3" data-testid={`comment-${comment.id}`}>
                <Avatar className="h-8 w-8 shrink-0">
                  {comment.avatarUrl && <AvatarImage src={comment.avatarUrl} />}
                  <AvatarFallback className="text-xs">
                    {(comment.username || "A").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-medium">{comment.username || "Anonymous"}</span>
                    <span className="text-xs text-muted-foreground">{formatTimeAgo(comment.createdAt)}</span>
                  </div>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{comment.body}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "up" })}
                      data-testid={`button-upvote-${comment.id}`}
                    >
                      <ThumbsUp className="h-3 w-3" />
                      <span>{comment.upvotes || 0}</span>
                    </button>
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "down" })}
                      data-testid={`button-downvote-${comment.id}`}
                    >
                      <ThumbsDown className="h-3 w-3" />
                      <span>{comment.downvotes || 0}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {comments.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No comments yet. Be the first to share your thoughts!</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
