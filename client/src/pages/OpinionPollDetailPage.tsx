import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { UserMenu } from "@/components/UserMenu";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";
import {
  ArrowLeft,
  Clock,
  Users,
  Loader2,
  Send,
  ThumbsUp,
  ThumbsDown,
  CheckCircle2,
  MessageSquare,
  ArrowUpDown,
  Share2,
  BarChart3,
  Info,
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

function formatDate(d: string) {
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

export default function OpinionPollDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [commentSort, setCommentSort] = useState<"top" | "newest">("top");
  const [showVoteChange, setShowVoteChange] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

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

  const sortedComments = useMemo(() => {
    if (!comments.length) return [];
    const sorted = [...comments];
    if (commentSort === "top") {
      sorted.sort((a: any, b: any) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
    } else {
      sorted.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [comments, commentSort]);

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      toast({ title: "Link Copied", description: "Poll link copied to clipboard." });
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      toast({ title: "Share", description: url });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (!poll) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <Button variant="ghost" onClick={() => setLocation("/vote")} className="mb-4" data-testid="button-back-to-vote">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Vote
          </Button>
          <Card className="p-8 text-center">
            <h1 className="text-xl font-bold mb-2">Poll Not Found</h1>
            <p className="text-muted-foreground">This poll doesn't exist or has been removed.</p>
          </Card>
        </div>
      </div>
    );
  }

  const hasVoted = !!poll.userVote;
  const options = poll.options || [];
  const votedOption = options.find((o: any) => o.id === poll.userVote);

  return (
    <div className="min-h-screen bg-background" data-testid="opinion-poll-detail-page">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" data-testid="link-logo-home">
              <AuthoriDexLogo size="sm" />
            </Link>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/vote")} data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Vote
            </Button>
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="mb-6" data-testid="section-poll-header">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <CategoryPill category={poll.category} />
            <Badge variant="outline" className="text-xs border-cyan-500/30 text-cyan-400">
              Opinion Poll
            </Badge>
            {poll.featured && (
              <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">
                Featured
              </Badge>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-serif font-bold mb-3 leading-tight" data-testid="text-poll-title">
            {poll.title}
          </h1>

          {poll.description && (
            <p className="text-base text-muted-foreground mb-4" data-testid="text-poll-description">
              {poll.description}
            </p>
          )}

          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formatDate(poll.createdAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              {(poll.totalVotes || 0).toLocaleString("en-US")} votes
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="ml-auto"
              data-testid="button-share"
            >
              {linkCopied ? <CheckCircle2 className="h-4 w-4 mr-1 text-green-400" /> : <Share2 className="h-4 w-4 mr-1" />}
              {linkCopied ? "Copied" : "Share"}
            </Button>
          </div>
        </div>

        <Card className="p-5 mb-6 border-cyan-500/20" data-testid="section-vote-module">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-500" />
            Cast Your Vote
          </h2>

          {(!hasVoted || showVoteChange) ? (
            <div className="flex flex-col gap-3 mb-4">
              {options.map((option: any) => (
                <button
                  key={option.id}
                  onClick={() => {
                    if (!user) {
                      toast({ title: "Sign in required", description: "Please sign in to vote", variant: "destructive" });
                      return;
                    }
                    voteMutation.mutate(option.id);
                    setShowVoteChange(false);
                  }}
                  disabled={voteMutation.isPending}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md bg-cyan-500/10 border border-cyan-500/50 text-sm font-medium transition-all duration-300 hover:border-cyan-500/80 hover:bg-cyan-500/20 ${voteMutation.isPending ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                  data-testid={`button-vote-option-${option.id}`}
                >
                  {option.imageUrl ? (
                    <img src={option.imageUrl} alt="" className="w-8 h-8 rounded-md object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-md bg-cyan-500/20 flex items-center justify-center shrink-0">
                      <span className="text-sm font-medium text-cyan-400">{option.orderIndex + 1}</span>
                    </div>
                  )}
                  <span>{option.name}</span>
                  {option.personName && option.personName !== option.name && (
                    <span className="text-xs text-muted-foreground">({option.personName})</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3 mb-4">
              {options.map((option: any) => {
                const isSelected = poll.userVote === option.id;
                const percent = option.percent || 0;
                return (
                  <div key={option.id} className="flex items-center gap-3">
                    {option.imageUrl ? (
                      <img src={option.imageUrl} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" />
                    ) : (
                      <div className="w-6 h-6 rounded-md bg-cyan-500/20 flex items-center justify-center shrink-0">
                        <span className="text-xs font-medium text-cyan-400">{option.orderIndex + 1}</span>
                      </div>
                    )}
                    <span className={`text-sm w-24 shrink-0 truncate ${isSelected ? "text-cyan-400 font-semibold" : "text-muted-foreground"}`}>
                      {option.name}
                    </span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-10 text-right">{percent}%</span>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" />}
                  </div>
                );
              })}
              <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/10">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>You voted: <span className="font-semibold text-cyan-400">{votedOption?.name || "—"}</span></span>
                </div>
                <button
                  onClick={() => setShowVoteChange(true)}
                  className="text-xs text-slate-400 hover:text-white transition-colors underline-offset-4 hover:underline"
                  data-testid="button-change-vote"
                >
                  Change your vote
                </button>
              </div>
            </div>
          )}
          {!user && (
            <p className="text-xs text-center text-muted-foreground">
              <Button variant="ghost" className="p-0 h-auto text-cyan-400 underline" onClick={() => setLocation("/login")} data-testid="link-login-to-vote">
                Sign in
              </Button>{" "}
              to cast your vote
            </p>
          )}
        </Card>

        <Card className="p-5 mb-6" data-testid="section-results">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-500" />
            Results
          </h2>

          <div className="flex flex-col gap-2 mb-4" data-testid="bar-results">
            {options.map((option: any) => {
              const percent = option.percent || 0;
              return (
                <div
                  key={option.id}
                  className="h-9 rounded-md bg-cyan-500/10 border border-cyan-500/50 flex items-center justify-center transition-all duration-300 cursor-default"
                  style={{ width: `${Math.max(percent, 15)}%` }}
                >
                  <span className="text-xs font-semibold text-cyan-400 truncate px-2">{option.name} {percent}%</span>
                </div>
              );
            })}
          </div>

          <div className="grid gap-2">
            {options.map((option: any) => {
              const percent = option.percent || 0;
              return (
                <div key={option.id} className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-cyan-500 shrink-0" />
                  <span className="text-xs font-medium flex-1 min-w-0 truncate">{option.name}</span>
                  <span className="text-sm font-bold font-mono text-cyan-400" data-testid={`text-percent-${option.id}`}>{percent}%</span>
                  <span className="text-xs text-muted-foreground w-16 text-right">{(option.votes || 0).toLocaleString("en-US")} votes</span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-border/30 text-center">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{(poll.totalVotes || 0).toLocaleString("en-US")}</span> total votes
            </p>
          </div>
        </Card>

        <div className="grid grid-cols-3 gap-3 mb-6" data-testid="section-stats">
          <Card className="p-3 text-center">
            <Users className="h-4 w-4 text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-votes">{(poll.totalVotes || 0).toLocaleString("en-US")}</p>
            <p className="text-xs text-muted-foreground">Total Votes</p>
          </Card>
          <Card className="p-3 text-center">
            <MessageSquare className="h-4 w-4 text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-comment-count">{poll.commentCount || comments.length}</p>
            <p className="text-xs text-muted-foreground">Comments</p>
          </Card>
          <Card className="p-3 text-center">
            <Clock className="h-4 w-4 text-cyan-500 mx-auto mb-1" />
            <p className="text-sm font-semibold" data-testid="text-created-date">{formatDate(poll.createdAt)}</p>
            <p className="text-xs text-muted-foreground">Created</p>
          </Card>
        </div>

        {poll.summary && (
          <Card className="p-5 mb-6" data-testid="section-context">
            <h2 className="text-lg font-serif font-bold mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-cyan-500" />
              Context
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap" data-testid="text-poll-summary">
              {poll.summary}
            </p>
          </Card>
        )}

        <Card className="p-5 mb-6" data-testid="section-comments">
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <h2 className="text-lg font-serif font-bold flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-cyan-500" />
              Discussion ({comments.length})
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant={commentSort === "top" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCommentSort("top")}
                data-testid="button-sort-top"
              >
                <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
                Top
              </Button>
              <Button
                variant={commentSort === "newest" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCommentSort("newest")}
                data-testid="button-sort-newest"
              >
                <Clock className="h-3.5 w-3.5 mr-1" />
                Newest
              </Button>
            </div>
          </div>

          {user ? (
            <div className="mb-5">
              <Textarea
                placeholder="Share your thoughts on this topic..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="mb-2 bg-background/50 resize-none"
                rows={3}
                data-testid="input-comment"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!commentText.trim() || commentMutation.isPending}
                  onClick={() => {
                    if (commentText.trim()) commentMutation.mutate(commentText.trim());
                  }}
                  data-testid="button-submit-comment"
                >
                  {commentMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Post
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-3 mb-4 rounded-lg border border-dashed border-border/50">
              <p className="text-sm text-muted-foreground">
                <Button variant="ghost" className="p-0 h-auto text-cyan-400 underline" onClick={() => setLocation("/login")} data-testid="link-login-to-comment">
                  Sign in
                </Button>{" "}
                to join the discussion
              </p>
            </div>
          )}

          {sortedComments.length > 0 ? (
            <ScrollArea className="max-h-[500px]">
              <div className="space-y-4">
                {sortedComments.map((comment: any, idx: number) => {
                  const netVotes = (comment.upvotes || 0) - (comment.downvotes || 0);
                  const isTopComment = commentSort === "top" && idx === 0 && netVotes > 0;
                  return (
                    <div
                      key={comment.id}
                      className={`flex gap-3 p-3 rounded-lg ${isTopComment ? "bg-cyan-500/5 border border-cyan-500/20" : ""}`}
                      data-testid={`comment-${comment.id}`}
                    >
                      <Avatar className="h-8 w-8 shrink-0 rounded-md">
                        {comment.avatarUrl && <AvatarImage src={comment.avatarUrl} alt={comment.username || ""} className="rounded-md" />}
                        <AvatarFallback className="bg-cyan-500/20 text-cyan-400 text-xs font-semibold rounded-md">
                          {(comment.username || "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold" data-testid={`text-comment-user-${comment.id}`}>
                            {comment.username || "Anonymous"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTimeAgo(comment.createdAt)}
                          </span>
                          {isTopComment && (
                            <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-400 py-0">
                              Top Take
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap" data-testid={`text-comment-body-${comment.id}`}>
                          {comment.body}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "up" })}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-400 transition-colors"
                            data-testid={`button-upvote-${comment.id}`}
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                            {(comment.upvotes || 0) > 0 && <span>{comment.upvotes}</span>}
                          </button>
                          <button
                            onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "down" })}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-400 transition-colors"
                            data-testid={`button-downvote-${comment.id}`}
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                            {(comment.downvotes || 0) > 0 && <span>{comment.downvotes}</span>}
                          </button>
                          {netVotes !== 0 && (
                            <span className={`text-xs font-mono ${netVotes > 0 ? "text-cyan-400" : "text-rose-400"}`}>
                              {netVotes > 0 ? `+${netVotes}` : netVotes}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              No comments yet. Be the first to share your thoughts!
            </p>
          )}
        </Card>

        <div className="text-center pb-8">
          <Button variant="outline" onClick={() => setLocation("/vote")} data-testid="button-back-bottom">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Vote
          </Button>
        </div>
      </div>
    </div>
  );
}
