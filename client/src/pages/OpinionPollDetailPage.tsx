import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sharePage } from "@/lib/share";
import { goBack } from "@/lib/goBack";
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
import { CardComments, useCommentCount } from "@/components/comments/CardComments";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions } from "@/lib/signInToVoteToast";
import { formatDate } from "@/lib/formatDate";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { VoteDetailNavCluster } from "@/components/vote/VoteDetailNavCluster";
import { useDetailNavigation } from "@/hooks/useDetailNavigation";
import {
  ArrowLeft,
  Clock,
  Users,
  Loader2,
  CheckCircle2,
  MessageSquare,
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
  const params = useParams<{ slug: string }>();
  const slugParam = params.slug;
  const slug = useMemo(() => {
    if (!slugParam) return "";
    try {
      return decodeURIComponent(slugParam);
    } catch {
      return slugParam;
    }
  }, [slugParam]);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const opCommentCount = useCommentCount("opinion-poll", slug || "");
  const { showNav, historyDepth } = useDetailNavigation(slug || undefined, "opinion");
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
      const res = await fetch(`/api/opinion-polls/${encodeURIComponent(slug)}`, { headers });
      if (!res.ok) throw new Error("Poll not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const voteMutation = useMutation({
    mutationFn: async (optionId: string) => {
      const res = await apiRequest("POST", `/api/opinion-polls/${encodeURIComponent(slug)}/vote`, { optionId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls", slug] });
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls"] });
      toast({ title: "Vote recorded" });
    },
    onError: (error) => {
      if (isUnauthorizedApiError(error)) {
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        toast({
          title: "Could not vote",
          description: parseOpinionPollVoteError(error),
          variant: "destructive",
        });
      }
    },
  });

  const removeVoteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/opinion-polls/${encodeURIComponent(slug)}/vote`, { remove: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls", slug] });
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls"] });
      toast({ title: "Vote removed" });
    },
    onError: (error) => {
      if (isUnauthorizedApiError(error)) {
        toast({ ...signInToVoteToastOptions(() => setLocation("/login")) });
      } else {
        toast({
          title: "Could not remove vote",
          description: parseOpinionPollVoteError(error),
          variant: "destructive",
        });
      }
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

  const handleShare = () => {
    sharePage(poll ? `${poll.title} on VoxDex` : "VoxDex");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-700 dark:text-cyan-500" />
      </div>
    );
  }

  if (!poll) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 pt-8 pb-24 md:pb-6">
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
        <div className="max-w-3xl mx-auto px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex items-center gap-3 min-w-0 justify-self-start">
            <Link href="/" data-testid="link-logo-home">
              <VoxDexLogo size={28} />
            </Link>
            <Button variant="ghost" size="sm" onClick={() => { showNav ? window.history.go(-historyDepth) : (window.history.length > 1 ? window.history.back() : setLocation("/vote")); }} data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Vote
            </Button>
          </div>
          <div className="flex justify-center min-w-0 col-start-2">
            <VoteDetailNavCluster listType="opinion" slug={slug} />
          </div>
          <div className="flex justify-end min-w-0 justify-self-end col-start-3">
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24 md:pb-6">
        <div className="mb-6" data-testid="section-poll-header">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <CategoryPill category={poll.category} />
            <Badge variant="outline" className="text-xs border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
              Opinion Poll
            </Badge>
            {poll.featured && (
              <Badge variant="outline" className="text-xs border-amber-500/40 dark:border-amber-500/30 text-amber-600 dark:text-amber-400">
                Featured
              </Badge>
            )}
          </div>

          <div className="mb-4">
            <div className="flex items-start gap-4">
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
                  className="text-2xl sm:text-3xl font-serif font-bold leading-tight"
                  data-testid="text-poll-title"
                >
                  {poll.title}
                </h1>
              </div>
            </div>
            {poll.description && (
              <p className="mt-3 text-base text-muted-foreground mb-4 whitespace-pre-wrap" data-testid="text-poll-description">
                {poll.description}
              </p>
            )}
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

        <Card
          className="p-5 sm:p-6 mb-6 border border-border/50 bg-card transition-all duration-200 hover:border-[#EFEFEF]/55 dark:hover:border-white/40"
          data-testid="section-vote-module"
        >
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
            Cast Your Vote
          </h2>

          {!hasVoted ? (
            <div className="flex flex-col gap-2.5">
              {options.map((option: any) => (
                <div
                  key={option.id}
                  className={`w-full flex items-stretch overflow-hidden rounded-lg border border-border/50 bg-muted/30 p-0 text-sm font-medium transition-all duration-200 hover:border-[#EFEFEF]/50 hover:bg-muted/50 dark:hover:border-white/40 dark:hover:bg-white/5 hover:ring-1 hover:ring-inset hover:ring-[#EFEFEF]/40 dark:hover:ring-white/25 ${voteMutation.isPending ? "opacity-60" : ""}`}
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
                    <div className="relative flex shrink-0 w-14 items-center justify-center self-stretch min-h-[2.75rem] bg-cyan-500/15 dark:bg-cyan-500/10">
                      <span className="text-sm font-semibold text-cyan-600 dark:text-cyan-400">{option.orderIndex + 1}</span>
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
                    <div className="mt-1 h-2 rounded-full bg-slate-700/50" />
                    <p className="text-[10px] text-slate-600 mt-0.5">Votes</p>
                  </button>
                </div>
              ))}

              {!user && (
                <p className="text-xs text-center text-muted-foreground mt-1">
                  <Button variant="ghost" className="p-0 h-auto text-cyan-600 dark:text-cyan-400 underline" onClick={() => setLocation("/login")} data-testid="link-login-to-vote">
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
                    ? "border-[#EFEFEF]/45 bg-white/[0.06] dark:border-white/40 dark:bg-white/5"
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
                  <div className="relative flex shrink-0 w-14 items-center justify-center self-stretch min-h-[2.75rem] bg-cyan-500/15 dark:bg-cyan-500/10">
                    <span className="text-sm font-semibold text-cyan-600 dark:text-cyan-400">{option.orderIndex + 1}</span>
                  </div>
                );
                const contentColumn = (
                  <div className="flex-1 min-w-0 py-1.5 pl-2.5 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`min-w-0 flex-1 truncate text-sm ${isSelected ? "font-semibold" : ""}`}>
                        {option.name}
                      </span>
                      {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />}
                      <span className={`shrink-0 text-xs font-mono font-bold ${isLeading ? "text-cyan-600 dark:text-cyan-400" : "text-muted-foreground"}`}>
                        {percent}%
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-700/50 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-cyan-500 transition-all duration-700 ease-out"
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
                      className={`min-w-0 flex-1 text-left cursor-pointer rounded-r-md hover:ring-1 hover:ring-inset hover:ring-[#EFEFEF]/50 dark:hover:ring-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EFEFEF]/40 dark:focus-visible:ring-white/30 border-0 bg-transparent p-0 ${voteMutation.isPending ? "opacity-60 cursor-not-allowed" : ""}`}
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
                <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                  <span className="truncate">
                    You voted: <span className="font-semibold text-cyan-600 dark:text-cyan-400">{votedOption?.name || "—"}</span>
                  </span>
                </div>
                <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border bg-white/[0.06] border-[#EFEFEF]/35 text-foreground/90">
                  You voted
                </span>
              </div>
              <div
                className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center mt-2"
                data-testid="text-change-vote-hint-detail"
              >
                <span className="text-[10px] text-slate-500/70 dark:text-slate-400/70">
                  Tap another option to change your vote
                </span>
                <span className="text-[10px] text-slate-500/40 dark:text-slate-500/40">|</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!user) {
                      toast({ title: "Sign in required", description: "Please sign in to manage your vote", variant: "destructive" });
                      return;
                    }
                    removeVoteMutation.mutate();
                  }}
                  disabled={removeVoteMutation.isPending}
                  className="text-[10px] text-slate-500/70 dark:text-slate-400/70 hover:text-red-600/80 dark:hover:text-red-400/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  data-testid="button-remove-vote-opinion-detail"
                >
                  Remove vote
                </button>
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
            <BarChart3 className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
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
                          hasVoted
                            ? "bg-cyan-500"
                            : isLeading
                              ? "bg-cyan-500"
                              : isUserVote
                                ? "bg-cyan-400/60"
                                : "bg-slate-600/50"
                        }`}
                        style={{ width: `${Math.max(percent, 1)}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 w-[72px] justify-end">
                      <span className={`text-sm font-mono font-bold ${isLeading ? 'text-cyan-600 dark:text-cyan-400' : 'text-muted-foreground'}`} data-testid={`text-percent-${option.id}`}>
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
            <Users className="h-4 w-4 text-cyan-700 dark:text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-votes">{(poll.totalVotes || 0).toLocaleString("en-US")}</p>
            <p className="text-xs text-muted-foreground">Total Votes</p>
          </Card>
          <Card className="p-3 text-center">
            <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-comment-count">{poll.commentCount || opCommentCount}</p>
            <p className="text-xs text-muted-foreground">Comments</p>
          </Card>
          <Card className="p-3 text-center">
            <Clock className="h-4 w-4 text-cyan-700 dark:text-cyan-500 mx-auto mb-1" />
            <p className="text-sm font-semibold" data-testid="text-created-date">{formatDate(poll.createdAt)}</p>
            <p className="text-xs text-muted-foreground">Created</p>
          </Card>
        </div>

        {poll.summary && (
          <Card className="p-5 mb-6" data-testid="section-context">
            <h2 className="text-lg font-serif font-bold mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
              Context
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap" data-testid="text-poll-summary">
              {poll.summary}
            </p>
          </Card>
        )}

        <div className="md:hidden mb-6">
          <CardComments
            entityType="opinion-poll"
            slug={slug || ""}
            variant="inline"
            maxHeight="none"
            placeholder="Share your thoughts on this topic..."
            onShare={handleShare}
          />
        </div>

        <div className="hidden md:block">
          <CardComments
            entityType="opinion-poll"
            slug={slug || ""}
            placeholder="Share your thoughts on this topic..."
            onShare={handleShare}
          />
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
