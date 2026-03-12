import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sharePage } from "@/lib/share";
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
  Minus,
  BarChart3,
  Info,
  Share2,
  MessageSquare,
  ArrowUpDown,
  Copy,
} from "lucide-react";

interface PollData {
  id: string;
  headline: string;
  subjectText: string;
  description: string | null;
  category: string;
  personId: string | null;
  personName: string | null;
  personAvatar: string | null;
  imageUrl: string | null;
  slug: string | null;
  featured: boolean | null;
  visibility: string | null;
  status: string;
  timeline: string | null;
  deadlineAt: string | null;
  createdAt: string;
  supportCount: number;
  neutralCount: number;
  opposeCount: number;
  totalVotes: number;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  userVote: string | null;
}

interface PollComment {
  id: string;
  pollId: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  body: string;
  parentId: string | null;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

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

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function PollDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { user, isLoggedIn } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [commentBody, setCommentBody] = useState("");
  const [commentSort, setCommentSort] = useState<"top" | "newest">("top");
  const [showVoteChange, setShowVoteChange] = useState(false);

  const { data: poll, isLoading: pollLoading, error: pollError } = useQuery<PollData>({
    queryKey: ["/api/polls", slug],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const { getSupabase } = await import("@/lib/supabase");
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/polls/${slug}`, { headers });
      if (!res.ok) throw new Error("Poll not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const { data: comments = [] } = useQuery<PollComment[]>({
    queryKey: ["/api/polls", slug, "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/polls/${slug}/comments`);
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
    enabled: !!slug,
  });

  const voteMutation = useMutation({
    mutationFn: async (choice: string) => {
      const res = await apiRequest("POST", `/api/polls/${slug}/vote`, { choice });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/polls", slug] });
      toast({ title: "Vote Recorded", description: "Your vote has been counted." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cast vote. Please sign in.", variant: "destructive" });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `/api/polls/${slug}/comments`, { body });
      return res.json();
    },
    onSuccess: () => {
      setCommentBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/polls", slug, "comments"] });
      toast({ title: "Comment Posted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to post comment. Please sign in.", variant: "destructive" });
    },
  });

  const commentVoteMutation = useMutation({
    mutationFn: async ({ commentId, voteType }: { commentId: string; voteType: "up" | "down" }) => {
      const res = await apiRequest("POST", `/api/polls/comments/${commentId}/vote`, { voteType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/polls", slug, "comments"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to vote. Please sign in.", variant: "destructive" });
    },
  });

  const sortedComments = useMemo(() => {
    if (!comments.length) return [];
    const sorted = [...comments];
    if (commentSort === "top") {
      sorted.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
    } else {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [comments, commentSort]);

  const handleVote = (choice: string) => {
    if (!isLoggedIn) {
      toast({ title: "Sign in Required", description: "Please sign in to vote.", variant: "destructive" });
      return;
    }
    voteMutation.mutate(choice);
  };

  const handlePostComment = () => {
    if (!commentBody.trim()) return;
    commentMutation.mutate(commentBody.trim());
  };

  const handleShare = () => {
    sharePage(poll ? `${poll.headline} on AuthoriDex` : "AuthoriDex");
  };

  if (pollLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (pollError || !poll) {
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

  return (
    <div className="min-h-screen bg-background" data-testid="poll-detail-page">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" data-testid="link-logo-home">
              <AuthoriDexLogo size={28} />
            </Link>
            <Button variant="ghost" size="sm" onClick={() => { window.history.length > 1 ? window.history.back() : setLocation("/vote"); }} data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Vote
            </Button>
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header Block */}
        <div className="mb-6" data-testid="section-poll-header">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <CategoryPill category={poll.category} />
            <Badge variant="outline" className="text-xs border-cyan-500/30 text-cyan-400">
              Sentiment Poll
            </Badge>
            {poll.featured && (
              <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">
                Featured
              </Badge>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-serif font-bold mb-3 leading-tight" data-testid="text-poll-title">
            {poll.headline}
          </h1>

          <p className="text-base text-muted-foreground mb-4" data-testid="text-poll-question">
            {poll.subjectText}
          </p>

          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formatDate(poll.createdAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              {poll.totalVotes.toLocaleString('en-US')} votes
            </span>
            {poll.deadlineAt && (
              <span className="flex items-center gap-1.5 text-amber-400">
                <Clock className="h-4 w-4" />
                Ends {formatDate(poll.deadlineAt)}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="ml-auto"
              data-testid="button-share"
            >
              <Share2 className="h-4 w-4 mr-1" />
              Share
            </Button>
          </div>
        </div>

        {poll.personAvatar && (
          <div className="flex items-center gap-3 mb-6 p-3 rounded-lg border border-border/40 bg-muted/20">
            <Avatar className="h-10 w-10">
              <AvatarImage src={poll.personAvatar} alt={poll.personName || ""} />
              <AvatarFallback className="bg-cyan-500/20 text-cyan-400 text-xs">{(poll.personName || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              {poll.personId ? (
                <Link href={`/person/${poll.personId}`} className="text-sm font-semibold text-cyan-400 hover:text-cyan-300 hover:underline">
                  {poll.personName}
                </Link>
              ) : (
                <p className="text-sm font-semibold">{poll.personName}</p>
              )}
              <p className="text-xs text-muted-foreground">Linked Celebrity</p>
            </div>
          </div>
        )}

        {/* Vote Module */}
        <Card className="p-5 mb-6 border-cyan-500/20" data-testid="section-vote-module">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-500" />
            Cast Your Vote
          </h2>

          {(!poll.userVote || showVoteChange) ? (
            <div className="flex flex-col gap-3 mb-4">
              <button
                onClick={(e) => { e.stopPropagation(); handleVote("support"); setShowVoteChange(false); }}
                disabled={voteMutation.isPending}
                className={`w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20 ${voteMutation.isPending ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                data-testid="button-vote-support"
              >
                <ThumbsUp className="h-4 w-4 shrink-0" />
                <span>Support</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleVote("neutral"); setShowVoteChange(false); }}
                disabled={voteMutation.isPending}
                className={`w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-white/5 border border-white/40 text-white text-sm font-medium transition-all duration-300 hover:border-white/80 hover:bg-white/15 ${voteMutation.isPending ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                data-testid="button-vote-neutral"
              >
                <Minus className="h-4 w-4 shrink-0" />
                <span>Neutral</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleVote("oppose"); setShowVoteChange(false); }}
                disabled={voteMutation.isPending}
                className={`w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 ${voteMutation.isPending ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                data-testid="button-vote-oppose"
              >
                <ThumbsDown className="h-4 w-4 shrink-0" />
                <span>Oppose</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center gap-3">
                <ThumbsUp className="h-4 w-4 text-[#00C853] shrink-0" />
                <span className="text-sm text-[#00C853] w-16 shrink-0">Support</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                    style={{ width: `${poll.approvePercent}%` }}
                  />
                </div>
                <span className="text-sm text-muted-foreground w-10 text-right">{poll.approvePercent}%</span>
              </div>
              <div className="flex items-center gap-3">
                <Minus className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="text-sm text-slate-400 w-16 shrink-0">Neutral</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-400 rounded-full transition-all duration-500"
                    style={{ width: `${poll.neutralPercent}%` }}
                  />
                </div>
                <span className="text-sm text-muted-foreground w-10 text-right">{poll.neutralPercent}%</span>
              </div>
              <div className="flex items-center gap-3">
                <ThumbsDown className="h-4 w-4 text-[#FF0000] shrink-0" />
                <span className="text-sm text-[#FF0000] w-16 shrink-0">Oppose</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#FF0000] rounded-full transition-all duration-500"
                    style={{ width: `${poll.disapprovePercent}%` }}
                  />
                </div>
                <span className="text-sm text-muted-foreground w-10 text-right">{poll.disapprovePercent}%</span>
              </div>
              <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/10">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>You voted: <span className="font-semibold capitalize text-[#00C853]">{poll.userVote}</span></span>
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
          {!isLoggedIn && (
            <p className="text-xs text-center text-muted-foreground">
              <Button variant="ghost" className="p-0 h-auto text-cyan-400 underline" onClick={() => setLocation("/login")} data-testid="link-login-to-vote">
                Sign in
              </Button>{" "}
              to cast your vote
            </p>
          )}
        </Card>

        {/* Results Bar */}
        <Card className="p-5 mb-6" data-testid="section-results">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-500" />
            Results
          </h2>

          <div className="flex flex-col gap-2 mb-4" data-testid="bar-results">
            <div
              className="h-9 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 flex items-center justify-center transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20 cursor-default"
              style={{ width: `${Math.max(poll.approvePercent, 15)}%` }}
            >
              <span className="text-xs font-semibold text-[#00C853]">{poll.approvePercent}%</span>
            </div>
            <div
              className="h-9 rounded-md bg-white/5 border border-white/40 flex items-center justify-center transition-all duration-300 hover:border-white/80 hover:bg-white/15 cursor-default"
              style={{ width: `${Math.max(poll.neutralPercent, 15)}%` }}
            >
              <span className="text-xs font-semibold text-white">{poll.neutralPercent}%</span>
            </div>
            <div
              className="h-9 rounded-md bg-[#FF0000]/10 border border-[#FF0000]/50 flex items-center justify-center transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 cursor-default"
              style={{ width: `${Math.max(poll.disapprovePercent, 15)}%` }}
            >
              <span className="text-xs font-semibold text-[#FF0000]">{poll.disapprovePercent}%</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="h-2.5 w-2.5 rounded-full bg-[#00C853]" />
                <span className="text-xs font-medium">Support</span>
              </div>
              <p className="text-lg font-bold font-mono text-[#00C853]" data-testid="text-support-percent">{poll.approvePercent}%</p>
              <p className="text-xs text-muted-foreground">{poll.supportCount.toLocaleString('en-US')} votes</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                <span className="text-xs font-medium">Neutral</span>
              </div>
              <p className="text-lg font-bold font-mono text-slate-300" data-testid="text-neutral-percent">{poll.neutralPercent}%</p>
              <p className="text-xs text-muted-foreground">{poll.neutralCount.toLocaleString('en-US')} votes</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className="h-2.5 w-2.5 rounded-full bg-[#FF0000]" />
                <span className="text-xs font-medium">Oppose</span>
              </div>
              <p className="text-lg font-bold font-mono text-[#FF0000]" data-testid="text-oppose-percent">{poll.disapprovePercent}%</p>
              <p className="text-xs text-muted-foreground">{poll.opposeCount.toLocaleString('en-US')} votes</p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/30 text-center">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{poll.totalVotes.toLocaleString('en-US')}</span> total votes
            </p>
          </div>
        </Card>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 mb-6" data-testid="section-stats">
          <Card className="p-3 text-center">
            <Users className="h-4 w-4 text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-votes">{poll.totalVotes.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">Total Votes</p>
          </Card>
          <Card className="p-3 text-center">
            <MessageSquare className="h-4 w-4 text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-comment-count">{comments.length}</p>
            <p className="text-xs text-muted-foreground">Comments</p>
          </Card>
          <Card className="p-3 text-center">
            <Clock className="h-4 w-4 text-cyan-500 mx-auto mb-1" />
            <p className="text-sm font-semibold" data-testid="text-created-date">{formatDate(poll.createdAt)}</p>
            <p className="text-xs text-muted-foreground">Created</p>
          </Card>
        </div>

        {/* Description / Context */}
        {poll.description && (
          <Card className="p-5 mb-6" data-testid="section-description">
            <h2 className="text-lg font-serif font-bold mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-cyan-500" />
              Context
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {poll.description}
            </p>
          </Card>
        )}

        {/* Discussion / Comments */}
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

          {isLoggedIn ? (
            <div className="mb-5">
              <Textarea
                placeholder="Share your thoughts on this topic..."
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                className="mb-2 bg-background/50 resize-none"
                rows={3}
                data-testid="input-comment"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!commentBody.trim() || commentMutation.isPending}
                  onClick={handlePostComment}
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
                {sortedComments.map((comment, idx) => {
                  const netVotes = comment.upvotes - comment.downvotes;
                  const isTopComment = commentSort === "top" && idx === 0 && netVotes > 0;
                  return (
                    <div
                      key={comment.id}
                      className={`flex gap-3 p-3 rounded-lg ${isTopComment ? "bg-cyan-500/5 border border-cyan-500/20" : ""}`}
                      data-testid={`comment-${comment.id}`}
                    >
                      <Avatar className="h-8 w-8 shrink-0">
                        {comment.avatarUrl && <AvatarImage src={comment.avatarUrl} alt={comment.username || ""} />}
                        <AvatarFallback className="bg-cyan-500/20 text-cyan-400 text-xs font-semibold">
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
                            {comment.upvotes > 0 && <span>{comment.upvotes}</span>}
                          </button>
                          <button
                            onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "down" })}
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-400 transition-colors"
                            data-testid={`button-downvote-${comment.id}`}
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                            {comment.downvotes > 0 && <span>{comment.downvotes}</span>}
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

        {/* Back link at bottom */}
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
