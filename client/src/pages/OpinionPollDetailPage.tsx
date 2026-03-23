import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sharePage } from "@/lib/share";
import { UserMenu } from "@/components/UserMenu";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";
import { formatTimeAgo, formatDate } from "@/lib/formatDate";
import { VoxDexLogo } from "@/components/VoxDexLogo";
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
  X,
} from "lucide-react";

function parseOpinionPollVoteError(err: unknown): string {
  if (err instanceof Error && err.message) {
    const jsonMatch = err.message.match(/^\d+:\s*(\{[\s\S]*\})\s*$/);
    if (jsonMatch) {
      try {
        const j = JSON.parse(jsonMatch[1]) as { error?: string };
        if (j.error) return j.error;
      } catch {
        /* ignore */
      }
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export default function OpinionPollDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [commentSort, setCommentSort] = useState<"top" | "newest">("top");
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [pendingOption, setPendingOption] = useState<{ id: string; name: string } | null>(null);
  const [headerImgError, setHeaderImgError] = useState(false);
  const [expandedImage, setExpandedImage] = useState<{ url: string; alt: string } | null>(null);

  const { data: poll, isLoading } = useQuery<any>({
    queryKey: ["/api/opinion-polls", slug],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const { getSupabase } = await import("@/lib/supabase");
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
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
    onError: (error) => {
      toast({
        title: "Could not vote",
        description: parseOpinionPollVoteError(error),
        variant: "destructive",
      });
    },
  });

  const confirmChangeVote = async () => {
    if (!pendingOption) return;
    try {
      await voteMutation.mutateAsync(pendingOption.id);
      setChangeDialogOpen(false);
      setPendingOption(null);
    } catch {
      /* voteMutation.onError shows toast */
    }
  };

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

  const handleShare = () => {
    sharePage(poll ? `${poll.title} on VoxDex` : "VoxDex");
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
              <VoxDexLogo size={28} />
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

          <div className="flex items-start gap-4 mb-4">
            {!headerImgError && poll.imageUrl && (
              <div
                className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-800 cursor-pointer"
                onClick={() => setExpandedImage({ url: poll.imageUrl, alt: poll.title })}
              >
                <img
                  src={poll.imageUrl}
                  alt={poll.title}
                  className="w-full h-full object-cover"
                  onError={() => setHeaderImgError(true)}
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1
                className={`text-2xl sm:text-3xl font-serif font-bold leading-tight ${poll.description ? "mb-3" : ""}`}
                data-testid="text-poll-title"
              >
                {poll.title}
              </h1>

              {poll.description && (
                <p className="text-base text-muted-foreground mb-4 whitespace-pre-wrap" data-testid="text-poll-description">
                  {poll.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formatDate(poll.createdAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              <span className={hasVoted ? "" : "text-slate-600"}>
                {hasVoted
                  ? `${(poll.totalVotes || 0).toLocaleString("en-US")} votes`
                  : "Votes"}
              </span>
            </span>
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

        <Card className="p-5 sm:p-6 mb-6 border-cyan-500/20" data-testid="section-vote-module">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-500" />
            Cast Your Vote
          </h2>

          {!hasVoted ? (
            <div className="flex flex-col gap-2.5">
              {options.map((option: any) => (
                <div
                  key={option.id}
                  className={`w-full flex items-stretch overflow-hidden rounded-lg border border-border/50 bg-muted/30 p-0 text-sm font-medium transition-all duration-200 hover:border-cyan-500/60 hover:bg-cyan-500/10 hover:ring-1 hover:ring-cyan-500/40 ${voteMutation.isPending ? "opacity-60" : ""}`}
                >
                  {option.imageUrl ? (
                    <button
                      type="button"
                      aria-label="View larger image"
                      disabled={voteMutation.isPending}
                      onClick={() => setExpandedImage({ url: option.imageUrl, alt: option.name })}
                      className="relative shrink-0 w-14 self-stretch min-h-[2.75rem] cursor-zoom-in border-0 p-0 disabled:cursor-not-allowed"
                    >
                      <img src={option.imageUrl} alt={option.name} className="absolute inset-0 h-full w-full object-cover" />
                    </button>
                  ) : (
                    <div className="relative flex shrink-0 w-14 items-center justify-center self-stretch min-h-[2.75rem] bg-cyan-500/10">
                      <span className="text-sm font-semibold text-cyan-400">{option.orderIndex + 1}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!user) {
                        toast({ title: "Sign in required", description: "Please sign in to vote", variant: "destructive" });
                        return;
                      }
                      voteMutation.mutate(option.id);
                    }}
                    disabled={voteMutation.isPending}
                    className={`flex min-w-0 flex-1 flex-col items-stretch py-1.5 pl-2.5 pr-2 text-left transition-transform active:scale-[0.99] ${voteMutation.isPending ? "cursor-not-allowed" : "cursor-pointer"}`}
                    data-testid={`button-vote-option-${option.id}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate">{option.name}</span>
                      {option.personName && option.personName !== option.name && (
                        <span className="text-xs text-muted-foreground shrink-0">({option.personName})</span>
                      )}
                      <span className="shrink-0 text-xs font-mono font-bold text-slate-600">%</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-700/50" />
                    <p className="text-[10px] text-slate-600 mt-0.5">Votes</p>
                  </button>
                </div>
              ))}

              {!user && (
                <p className="text-xs text-center text-muted-foreground mt-1">
                  <Button variant="ghost" className="p-0 h-auto text-cyan-400 underline" onClick={() => setLocation("/login")} data-testid="link-login-to-vote">
                    Sign in
                  </Button>{" "}
                  to cast your vote
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {options.map((option: any) => {
                const isSelected = poll.userVote === option.id;
                const percent = option.percent || 0;
                const maxPercent = Math.max(...options.map((o: any) => o.percent || 0), 0);
                const isLeading = percent === maxPercent && percent > 0;
                const rowClass = `flex items-stretch overflow-hidden rounded-lg border transition-all duration-300 ${
                  isSelected
                    ? "border-cyan-500/60 bg-cyan-500/[0.08]"
                    : "border-border/30 bg-muted/20"
                }`;
                const imageColumn = option.imageUrl ? (
                  <button
                    type="button"
                    aria-label="View larger image"
                    disabled={voteMutation.isPending}
                    onClick={() => setExpandedImage({ url: option.imageUrl, alt: option.name })}
                    className="relative shrink-0 w-14 self-stretch min-h-[2.75rem] cursor-zoom-in border-0 p-0 disabled:cursor-not-allowed"
                  >
                    <img src={option.imageUrl} alt={option.name} className="absolute inset-0 h-full w-full object-cover" />
                  </button>
                ) : (
                  <div className="relative flex shrink-0 w-14 items-center justify-center self-stretch min-h-[2.75rem] bg-cyan-500/10">
                    <span className="text-sm font-semibold text-cyan-400">{option.orderIndex + 1}</span>
                  </div>
                );
                const contentColumn = (
                  <div className="flex-1 min-w-0 py-1.5 pl-2.5 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`min-w-0 flex-1 truncate text-sm ${isSelected ? "font-semibold" : ""}`}>
                        {option.name}
                      </span>
                      {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />}
                      <span className={`shrink-0 text-xs font-mono font-bold ${isLeading ? "text-cyan-400" : "text-muted-foreground"}`}>
                        {percent}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${
                          isLeading ? "bg-cyan-500" : isSelected ? "bg-cyan-400/60" : "bg-slate-600/50"
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{(option.votes || 0).toLocaleString("en-US")} votes</p>
                  </div>
                );
                return isSelected ? (
                  <div key={option.id} className={rowClass} data-testid={`opinion-poll-cast-result-${option.id}`}>
                    {imageColumn}
                    {contentColumn}
                  </div>
                ) : (
                  <div key={option.id} className={`${rowClass} w-full`} data-testid={`opinion-poll-cast-result-${option.id}`}>
                    {imageColumn}
                    <button
                      type="button"
                      disabled={voteMutation.isPending}
                      className={`min-w-0 flex-1 text-left cursor-pointer hover:border-cyan-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 border-0 bg-transparent p-0 ${voteMutation.isPending ? "opacity-60 cursor-not-allowed" : ""}`}
                      onClick={() => {
                        if (!user) {
                          toast({ title: "Sign in required", description: "Please sign in to vote", variant: "destructive" });
                          return;
                        }
                        setPendingOption({ id: option.id, name: option.name });
                        setChangeDialogOpen(true);
                      }}
                    >
                      {contentColumn}
                    </button>
                  </div>
                );
              })}

              <div className="flex items-center justify-between mt-1 pt-3 border-t border-border/30">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    You voted: <span className="font-semibold text-cyan-400">{votedOption?.name || "—"}</span>
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-cyan-500/10 border-cyan-500/40 text-cyan-400">
                  You voted
                </span>
              </div>
            </div>
          )}
        </Card>

        <AlertDialog
          open={changeDialogOpen}
          onOpenChange={(open) => {
            setChangeDialogOpen(open);
            if (!open) setPendingOption(null);
          }}
        >
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Change your vote?</AlertDialogTitle>
              <AlertDialogDescription>
                You&apos;re switching to{" "}
                <span className="font-medium text-foreground">{pendingOption?.name ?? "this option"}</span>. You can
                change your vote once per day on this poll.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <Button
                type="button"
                className="bg-cyan-600 hover:bg-cyan-700"
                onClick={() => void confirmChangeVote()}
                disabled={voteMutation.isPending}
              >
                Change vote
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Card className="p-5 mb-6" data-testid="section-results">
          <h2 className="text-lg font-serif font-bold mb-5 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-500" />
            Results
          </h2>

          <div className="flex flex-col gap-3">
            {[...options]
              .sort((a: any, b: any) => (b.percent || 0) - (a.percent || 0))
              .map((option: any) => {
                const percent = option.percent || 0;
                const maxPercent = Math.max(...options.map((o: any) => o.percent || 0), 0);
                const isLeading = percent === maxPercent && percent > 0;
                const isUserVote = poll.userVote === option.id;
                return (
                  <div key={option.id} className="flex items-center gap-3" data-testid={`opinion-poll-result-${option.id}`}>
                    <span className={`w-[38%] sm:w-[30%] text-sm truncate shrink-0 ${isUserVote ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {option.name}
                    </span>
                    <div className="flex-1 h-6 rounded bg-slate-800/60 overflow-hidden">
                      <div
                        className={`h-full rounded transition-all duration-700 ease-out ${
                          isLeading ? 'bg-cyan-500' : isUserVote ? 'bg-cyan-400/60' : 'bg-slate-600/50'
                        }`}
                        style={{ width: `${Math.max(percent, 1)}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 w-[72px] justify-end">
                      <span className={`text-sm font-mono font-bold ${isLeading ? 'text-cyan-400' : 'text-muted-foreground'}`} data-testid={`text-percent-${option.id}`}>
                        {percent}%
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 w-[56px] text-right hidden sm:block">
                      {(option.votes || 0).toLocaleString("en-US")}
                    </span>
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

      {expandedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={() => setExpandedImage(null)}
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <img
            src={expandedImage.url}
            alt={expandedImage.alt}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
