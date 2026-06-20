import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sharePage } from "@/lib/share";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { useXpBurst } from "@/components/XpBurstProvider";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest } from "@/lib/queryClient";
import { formatTimeAgo, formatDate } from "@/lib/formatDate";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { VoteDetailNavCluster } from "@/components/vote/VoteDetailNavCluster";
import { SwipeNavigator } from "@/components/vote/SwipeNavigator";
import { useDetailNavigation } from "@/hooks/useDetailNavigation";
import { navigateToLogin } from "@/lib/authReturn";
import { useAnonBudget, applyBudgetFromVoteResponse } from "@/hooks/useAnonBudget";
import { checkVoteGate } from "@/lib/voteGate";
import { isBudgetExhaustedVoteError } from "@/lib/voteErrors";
import {
  optimisticSentimentVotePatch,
  type SentimentChoice,
} from "@/lib/optimisticSentimentPollVote";
import {
  getSentimentPollChoiceColor,
  getSentimentPollChoiceLabel,
} from "@/lib/sentimentPollVoteDisplay";
import { goBack } from "@/lib/goBack";
import { CardComments, useCommentCount } from "@/components/comments/CardComments";
import { RelatedVoteItems } from "@/components/vote/RelatedVoteItems";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { sentimentPollOgImagePath } from "@shared/sentiment-poll-og";
import { voteDetailSectionCardClass } from "@/lib/vote-detail-ui";
import { useSupabaseUrl } from "@/lib/imageResolver";
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
  X,
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

export default function PollDetailPage() {
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
  const { user, isLoggedIn } = useAuth();
  const queryClient = useQueryClient();
  const { trigger: triggerXpBurst } = useXpBurst();

  const pollCommentCount = useCommentCount("poll", slug || "");
  const { showNav, goPrev, goNext, prevSlug, nextSlug, hasVoteListContext, goBackToVoteHub } =
    useDetailNavigation(slug || undefined, "sentiment");

  const handleBackToVote = useCallback(() => {
    if (hasVoteListContext) goBackToVoteHub();
    else if (window.history.length > 1) window.history.back();
    else setLocation("/vote");
  }, [hasVoteListContext, goBackToVoteHub, setLocation]);
  const [showVoteChange, setShowVoteChange] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const supabaseUrl = useSupabaseUrl();

  const conventionImageUrl = useMemo(() => {
    if (!supabaseUrl?.trim() || !slug.trim()) return null;
    return `${supabaseUrl.trim()}/storage/v1/object/public/sentiment-polls/${slug}/1.webp`;
  }, [supabaseUrl, slug]);

  const { data: poll, isLoading: pollLoading, error: pollError } = useQuery<PollData>({
    queryKey: ["/api/polls", slug],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const { getSupabase } = await import("@/lib/supabase");
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/polls/${encodeURIComponent(slug)}`, { headers });
      if (!res.ok) throw new Error("Poll not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const imgSources = useMemo(() => {
    if (!poll) return [] as string[];
    return [poll.personAvatar, poll.imageUrl, conventionImageUrl].filter(Boolean) as string[];
  }, [poll, conventionImageUrl]);

  useEffect(() => {
    setImgIdx(0);
  }, [slug, poll?.id, poll?.imageUrl, poll?.personAvatar, conventionImageUrl]);

  const currentImgSrc = imgSources[imgIdx] ?? null;

  const handleImgError = useCallback(() => {
    setImgIdx((prev) => (prev + 1 < imgSources.length ? prev + 1 : imgSources.length));
  }, [imgSources.length]);

  const budget = useAnonBudget();

  const pollQueryKey = ["/api/polls", slug] as const;

  const voteMutation = useMutation({
    mutationFn: async (choice: SentimentChoice) => {
      const res = await apiRequest("POST", `/api/polls/${encodeURIComponent(slug)}/vote`, { choice });
      return res.json();
    },
    onMutate: (choice) => {
      const previousPoll = queryClient.getQueryData<PollData>(pollQueryKey);
      if (previousPoll) {
        queryClient.setQueryData<PollData>(
          pollQueryKey,
          optimisticSentimentVotePatch(previousPoll, choice),
        );
      }
      void queryClient.cancelQueries({ queryKey: pollQueryKey });
      return { previousPoll };
    },
    onError: (error, choice, context) => {
      if (context?.previousPoll) {
        queryClient.setQueryData(pollQueryKey, context.previousPoll);
      }
      if (poll && isBudgetExhaustedVoteError(error)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          resumeAction: {
            surfaceType: "trending_poll",
            targetId: poll.id,
            cardRoute: window.location.pathname,
            pendingVote: { choice },
          },
        });
        return;
      }
      toast.error("Error", { description: "Failed to cast vote. Please sign in." });
    },
    onSuccess: (data) => {
      applyBudgetFromVoteResponse(queryClient, data);
      if (data?.poll && typeof data.poll === "object") {
        queryClient.setQueryData<PollData>(pollQueryKey, (current) =>
          current ? { ...current, ...data.poll } : data.poll,
        );
      }
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      toast("Vote Recorded", { description: "Your vote has been counted." });
    },
  });

  const pendingChoice = voteMutation.isPending ? voteMutation.variables : undefined;
  const displayUserVote = poll?.userVote ?? pendingChoice ?? null;
  const showVoteButtons = !displayUserVote || showVoteChange;
  const voteButtonsDisabled = voteMutation.isPending && !displayUserVote;

  const handleVote = (choice: SentimentChoice) => {
    if (!poll) return;
    const decision = checkVoteGate(budget, "trending_poll", poll.id, false);
    if (!decision.proceed) {
      navigateToLogin(setLocation, {
        mode: "signup",
        reason: "vote_limit_reached",
        resumeAction: {
          ...decision.resumeAction,
          cardRoute: window.location.pathname,
          pendingVote: { choice },
        },
      });
      return;
    }
    setShowVoteChange(false);
    voteMutation.mutate(choice);
  };

  const handleShare = () => {
    sharePage(poll ? `${poll.headline} on VoxDex` : "VoxDex", { sharerUserId: user?.id, surface: "poll" });
  };

  // Dynamic <title> + OG/Twitter meta. Slack/iMessage previews come
  // from the server-side /api/og/polls/:slug rewrite (see vercel.json),
  // but human shares (browser tab → AirDrop, copy/paste, Save as
  // bookmark, JS-aware crawlers) all read the live document head, so
  // we keep this in sync with the server payload.
  useDocumentMeta({
    title: poll ? `${poll.headline} • VoxDex` : "Sentiment poll • VoxDex",
    description: poll
      ? poll.description ?? poll.subjectText ?? "Cast your vote on VoxDex."
      : null,
    image: poll?.slug ? sentimentPollOgImagePath(poll.slug) : null,
  });

  if (pollLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-700 dark:text-cyan-500" />
      </div>
    );
  }

  if (pollError || !poll) {
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

  return (
    <div className="min-h-screen bg-background" data-testid="poll-detail-page">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-3xl mx-auto px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex items-center gap-3 min-w-0 justify-self-start">
            <Link href="/" data-testid="link-logo-home">
              <VoxDexLogo size={28} />
            </Link>
            {/* Icon-only on mobile so the prev-card chevron next to
                it has visible breathing room and the two tap
                targets don't fight for the same thumb. Label
                returns at sm: for desktop clarity. */}
            <Button variant="ghost" size="sm" className="px-2 sm:px-3" onClick={handleBackToVote} data-testid="button-back" aria-label="Back to Vote">
              <ArrowLeft className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Vote</span>
            </Button>
          </div>
          <div className="flex justify-center min-w-0 col-start-2">
            <VoteDetailNavCluster listType="sentiment" slug={slug} />
          </div>
          <div className="justify-self-end col-start-3">
            <HeaderUserActions />
          </div>
        </div>
      </header>

      <SwipeNavigator
        onSwipeRight={goPrev}
        onSwipeLeft={goNext}
        disableRight={!prevSlug}
        disableLeft={!nextSlug}
      >
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24 md:pb-6">
        {/* Header Block */}
        <div className="mb-6" data-testid="section-poll-header">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <CategoryPill category={poll.category} />
            <Badge variant="outline" className="text-xs border-cyan-500/40 dark:border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
              Sentiment Poll
            </Badge>
            {poll.featured && (
              <Badge variant="outline" className="text-xs border-amber-500/40 dark:border-amber-500/30 text-amber-600 dark:text-amber-400">
                Featured
              </Badge>
            )}
          </div>

          <div className="mb-4">
            <div className="flex items-start gap-4">
              {currentImgSrc ? (
                <div
                  className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-800 cursor-pointer"
                  onClick={() => setExpandedImage(currentImgSrc)}
                >
                  <img
                    src={currentImgSrc}
                    alt={poll.headline}
                    className="w-full h-full object-cover"
                    onError={handleImgError}
                  />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-lg bg-gradient-to-br from-slate-700/50 to-slate-800/50 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-5 w-5 text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl font-serif font-bold mb-0 leading-tight" data-testid="text-poll-title">
                  {poll.headline}
                </h1>
              </div>
            </div>
            <p className="mt-2 text-base text-muted-foreground" data-testid="text-poll-question">
              {poll.subjectText}
            </p>
          </div>

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
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
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
              <AvatarFallback className="bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 text-xs">{(poll.personName || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              {poll.personId ? (
                <Link href={`/person/${poll.personId}`} className="text-sm font-semibold text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 hover:underline">
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
        <Card className={voteDetailSectionCardClass("p-5 mb-6")} data-testid="section-vote-module">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
            Cast Your Vote
          </h2>

          {showVoteButtons ? (
            <div className="flex flex-col gap-3 mb-4">
              <button
                onClick={(e) => { e.stopPropagation(); handleVote("support"); }}
                disabled={voteButtonsDisabled}
                className={`w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20 ${voteButtonsDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                data-testid="button-vote-support"
              >
                <ThumbsUp className="h-4 w-4 shrink-0" />
                <span>Support</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleVote("neutral"); }}
                disabled={voteButtonsDisabled}
                className={`w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-white/5 border border-white/40 text-white text-sm font-medium transition-all duration-300 hover:border-white/80 hover:bg-white/15 ${voteButtonsDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                data-testid="button-vote-neutral"
              >
                <Minus className="h-4 w-4 shrink-0" />
                <span>Neutral</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleVote("oppose"); }}
                disabled={voteButtonsDisabled}
                className={`w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 ${voteButtonsDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                data-testid="button-vote-oppose"
              >
                <ThumbsDown className="h-4 w-4 shrink-0" />
                <span>Oppose</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center gap-3">
                <ThumbsUp className="h-4 w-4 shrink-0" style={{ color: getSentimentPollChoiceColor("support") }} />
                <span
                  className="text-sm w-16 shrink-0 font-medium"
                  style={{ color: getSentimentPollChoiceColor("support") }}
                >
                  {getSentimentPollChoiceLabel("support")}
                </span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                    style={{ width: `${poll.approvePercent}%` }}
                  />
                </div>
                <span className="text-sm text-muted-foreground w-10 text-right">{poll.approvePercent}%</span>
              </div>
              <div className="flex items-center gap-3">
                <Minus className="h-4 w-4 shrink-0" style={{ color: getSentimentPollChoiceColor("neutral") }} />
                <span
                  className="text-sm w-16 shrink-0 font-medium"
                  style={{ color: getSentimentPollChoiceColor("neutral") }}
                >
                  {getSentimentPollChoiceLabel("neutral")}
                </span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-400 rounded-full transition-all duration-500"
                    style={{ width: `${poll.neutralPercent}%` }}
                  />
                </div>
                <span className="text-sm text-muted-foreground w-10 text-right">{poll.neutralPercent}%</span>
              </div>
              <div className="flex items-center gap-3">
                <ThumbsDown className="h-4 w-4 shrink-0" style={{ color: getSentimentPollChoiceColor("oppose") }} />
                <span
                  className="text-sm w-16 shrink-0 font-medium"
                  style={{ color: getSentimentPollChoiceColor("oppose") }}
                >
                  {getSentimentPollChoiceLabel("oppose")}
                </span>
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
                  <span>
                    You voted:{" "}
                    <span
                      className="font-semibold"
                      style={{
                        color: displayUserVote ? getSentimentPollChoiceColor(displayUserVote) : undefined,
                      }}
                    >
                      {displayUserVote ? getSentimentPollChoiceLabel(displayUserVote) : "—"}
                    </span>
                  </span>
                </div>
                <button
                  onClick={() => setShowVoteChange(true)}
                  className="text-xs text-slate-600 dark:text-slate-400 hover:text-white transition-colors underline-offset-4 hover:underline"
                  data-testid="button-change-vote"
                >
                  Change your vote
                </button>
              </div>
            </div>
          )}
          {!isLoggedIn && (
            <p className="text-xs text-center text-muted-foreground">
              <Button variant="ghost" className="p-0 h-auto text-cyan-600 dark:text-cyan-400 underline" onClick={() => navigateToLogin(setLocation)} data-testid="link-login-to-vote">
                Sign in
              </Button>{" "}
              to cast your vote
            </p>
          )}
        </Card>

        {/* Results Bar */}
        <Card className={voteDetailSectionCardClass("p-5 mb-6")} data-testid="section-results">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
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
              <p className="text-lg font-bold font-mono text-slate-500 dark:text-slate-300" data-testid="text-neutral-percent">{poll.neutralPercent}%</p>
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
            <Users className="h-4 w-4 text-cyan-700 dark:text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-votes">{poll.totalVotes.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">Total Votes</p>
          </Card>
          <Card className="p-3 text-center">
            <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-comment-count">{pollCommentCount}</p>
            <p className="text-xs text-muted-foreground">Comments</p>
          </Card>
          <Card className="p-3 text-center">
            <Clock className="h-4 w-4 text-cyan-700 dark:text-cyan-500 mx-auto mb-1" />
            <p className="text-sm font-semibold" data-testid="text-created-date">{formatDate(poll.createdAt)}</p>
            <p className="text-xs text-muted-foreground">Created</p>
          </Card>
        </div>

        {/* Description / Context */}
        {poll.description && (
          <Card className="p-5 mb-6" data-testid="section-description">
            <h2 className="text-lg font-serif font-bold mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
              Context
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {poll.description}
            </p>
          </Card>
        )}

        <div className="md:hidden mb-6">
          <CardComments
            entityType="poll"
            slug={slug || ""}
            variant="inline"
            maxHeight="none"
            placeholder="Share your thoughts on this topic..."
            focusContextTitle={poll.headline}
            onShare={handleShare}
          />
        </div>

        <div className="hidden md:block">
          <CardComments
            entityType="poll"
            slug={slug || ""}
            placeholder="Share your thoughts on this topic..."
            focusContextTitle={poll.headline}
            onShare={handleShare}
          />
        </div>

        {slug && (
          <RelatedVoteItems
            type="sentiment"
            currentSlug={slug}
            category={poll.category}
            className="mt-8"
          />
        )}
      </div>
      </SwipeNavigator>

      {expandedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={() => setExpandedImage(null)}
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <img
            src={expandedImage}
            alt={poll.headline}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
