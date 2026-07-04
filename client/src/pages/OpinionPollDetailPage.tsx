import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sharePage } from "@/lib/share";
import { goBack } from "@/lib/goBack";
import { HeaderUserActions } from "@/components/HeaderUserActions";
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
import { RelatedVoteItems } from "@/components/vote/RelatedVoteItems";
import { apiRequest } from "@/lib/queryClient";
import { optimisticVotePatch } from "@/hooks/useOpinionPollVoteMutation";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { navigateToLogin } from "@/lib/authReturn";
import { useAnonBudget, applyBudgetFromVoteResponse } from "@/hooks/useAnonBudget";
import { checkVoteGate } from "@/lib/voteGate";
import { isBudgetExhaustedVoteError } from "@/lib/voteErrors";
import { formatDate } from "@/lib/formatDate";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { VoteDetailNavCluster } from "@/components/vote/VoteDetailNavCluster";
import { OpinionPollOptionRow } from "@/components/opinion-polls/OpinionPollOptionRow";
import { OpinionPollGalleryOption } from "@/components/opinion-polls/OpinionPollGalleryOption";
import { SuggestOptionCard } from "@/components/opinion-polls/SuggestOptionCard";
import { SwipeNavigator } from "@/components/vote/SwipeNavigator";
import { useDetailNavigation } from "@/hooks/useDetailNavigation";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { opinionPollOgImagePath } from "@shared/opinion-poll-og";
import { voteDetailSectionCardClass } from "@/lib/vote-detail-ui";
import { sortOpinionPollOptionsByVotes } from "@/lib/opinionPollOptions";
import { ImageLightbox } from "@/components/ImageLightbox";
import { useSupabaseUrl } from "@/lib/imageResolver";
import { getDisplayImageUrl } from "@/lib/imageTransform";
import { useOpinionPollHeaderImage } from "@/lib/opinionPollHeaderImage";
import {
  ArrowLeft,
  Clock,
  Users,
  Loader2,
  MessageSquare,
  Share2,
  BarChart3,
  Images,
  Info,
  List,
  ListChecks,
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
  const queryClient = useQueryClient();
  const opCommentCount = useCommentCount("opinion-poll", slug || "");
  const { showNav, goPrev, goNext, prevSlug, nextSlug, hasVoteListContext, goBackToVoteHub } =
    useDetailNavigation(slug || undefined, "opinion");

  const handleBackToVote = useCallback(() => {
    if (hasVoteListContext) goBackToVoteHub();
    else if (window.history.length > 1) window.history.back();
    else setLocation("/vote");
  }, [hasVoteListContext, goBackToVoteHub, setLocation]);
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [pendingOption, setPendingOption] = useState<{ id: string; name: string } | null>(null);
  const [expandedImage, setExpandedImage] = useState<{ url: string; alt: string } | null>(null);
  const [optionsViewMode, setOptionsViewMode] = useState<"list" | "gallery">("list");
  const [galleryScrollTargetId, setGalleryScrollTargetId] = useState<string | null>(null);
  const galleryOptionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const supabaseUrl = useSupabaseUrl();

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

  const { currentSrc: currentImgSrc, onImageError: handleHeaderImgError } = useOpinionPollHeaderImage(
    poll,
    slug,
    supabaseUrl,
  );

  const budget = useAnonBudget();

  useEffect(() => {
    if (optionsViewMode !== "gallery" || !galleryScrollTargetId) return;
    const raf = window.requestAnimationFrame(() => {
      galleryOptionRefs.current[galleryScrollTargetId]?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
      setGalleryScrollTargetId(null);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [optionsViewMode, galleryScrollTargetId]);

  const voteMutation = useMutation({
    mutationFn: async (optionId: string) => {
      const res = await apiRequest("POST", `/api/opinion-polls/${encodeURIComponent(slug)}/vote`, { optionId });
      return res.json();
    },
    onMutate: async (optionId: string) => {
      await queryClient.cancelQueries({ queryKey: ["/api/opinion-polls"] });
      const previousDetail = queryClient.getQueryData<any>(["/api/opinion-polls", slug]);
      const previousList = queryClient.getQueryData<any[]>(["/api/opinion-polls"]);
      queryClient.setQueryData<any>(["/api/opinion-polls", slug], (old: any) =>
        old ? optimisticVotePatch(old, { kind: "vote", slug, optionId }) : old,
      );
      queryClient.setQueryData<any[]>(["/api/opinion-polls"], (old: any[] | undefined) =>
        old?.map((p) => (p.slug === slug ? optimisticVotePatch(p, { kind: "vote", slug, optionId }) : p)),
      );
      return { previousDetail, previousList };
    },
    onSuccess: (data) => {
      // Phase 4 — sync the anon-budget cache from the server-authoritative
      // snapshot in the response.
      applyBudgetFromVoteResponse(queryClient, data);
      if (data?.poll) {
        queryClient.setQueryData<any[]>(["/api/opinion-polls"], (old: any[] | undefined) =>
          old?.map((p) => (p.id === data.poll.id ? data.poll : p)),
        );
      }
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls", slug] });
      toast("Vote recorded");
    },
    onError: (error, optionId, ctx) => {
      if (ctx?.previousDetail !== undefined) {
        queryClient.setQueryData(["/api/opinion-polls", slug], ctx.previousDetail);
      }
      if (ctx?.previousList !== undefined) {
        queryClient.setQueryData(["/api/opinion-polls"], ctx.previousList);
      }
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => setLocation("/login")));
      } else if (isBudgetExhaustedVoteError(error) && poll?.id) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          resumeAction: {
            surfaceType: "opinion_poll",
            targetId: poll.id,
            cardRoute: window.location.pathname,
            pendingVote: { optionId },
          },
        });
      } else {
        toast.error("Could not vote", { description: parseOpinionPollVoteError(error) });
      }
    },
  });

  const removeVoteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/opinion-polls/${encodeURIComponent(slug)}/vote`, { remove: true });
      return res.json();
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/opinion-polls"] });
      const previousDetail = queryClient.getQueryData<any>(["/api/opinion-polls", slug]);
      const previousList = queryClient.getQueryData<any[]>(["/api/opinion-polls"]);
      queryClient.setQueryData<any>(["/api/opinion-polls", slug], (old: any) =>
        old ? optimisticVotePatch(old, { kind: "remove", slug }) : old,
      );
      queryClient.setQueryData<any[]>(["/api/opinion-polls"], (old: any[] | undefined) =>
        old?.map((p) => (p.slug === slug ? optimisticVotePatch(p, { kind: "remove", slug }) : p)),
      );
      return { previousDetail, previousList };
    },
    onSuccess: (data) => {
      // Phase 4 — sync budget cache. Remove paths return budget: null
      // server-side (no budget delta) but the helper handles that correctly.
      applyBudgetFromVoteResponse(queryClient, data);
      if (data?.poll) {
        queryClient.setQueryData<any[]>(["/api/opinion-polls"], (old: any[] | undefined) =>
          old?.map((p) => (p.id === data.poll.id ? data.poll : p)),
        );
      }
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls", slug] });
      toast("Vote removed");
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previousDetail !== undefined) {
        queryClient.setQueryData(["/api/opinion-polls", slug], ctx.previousDetail);
      }
      if (ctx?.previousList !== undefined) {
        queryClient.setQueryData(["/api/opinion-polls"], ctx.previousList);
      }
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => setLocation("/login")));
      } else if (isBudgetExhaustedVoteError(error) && poll?.id) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          resumeAction: {
            surfaceType: "opinion_poll",
            targetId: poll.id,
            cardRoute: window.location.pathname,
            pendingVote: { remove: true },
          },
        });
      } else {
        toast.error("Could not remove vote", { description: parseOpinionPollVoteError(error) });
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

  const openOptionImageReview = useCallback((optionId?: string) => {
    setOptionsViewMode("gallery");
    setGalleryScrollTargetId(optionId ?? null);
  }, []);

  const handleDetailVote = useCallback((option: any) => {
    if (!poll) return;
    const decision = checkVoteGate(budget, "opinion_poll", poll.id, false);
    if (!decision.proceed) {
      navigateToLogin(setLocation, {
        mode: "signup",
        reason: "vote_limit_reached",
        resumeAction: {
          ...decision.resumeAction,
          cardRoute: window.location.pathname,
          pendingVote: { kind: "vote", optionId: option.id },
        },
      });
      return;
    }
    setOptionsViewMode("list");
    voteMutation.mutate(option.id);
  }, [budget, poll, setLocation, voteMutation]);

  const handleDetailChangeVote = useCallback((option: any) => {
    setOptionsViewMode("list");
    setPendingOption({ id: option.id, name: option.name });
    setChangeDialogOpen(true);
  }, []);

  const handleShare = () => {
    sharePage(poll ? `${poll.title} on VoxDex` : "VoxDex", { sharerUserId: user?.id, surface: "poll" });
  };

  // Dynamic <title> + OG/Twitter meta. Crawlers without JS hit
  // /api/og/opinion-polls/:slug via the vercel.json bot rewrite; this
  // hook keeps the live document head accurate for everyone else.
  useDocumentMeta({
    title: poll ? `${poll.title} • VoxDex` : "Opinion poll • VoxDex",
    description: poll
      ? poll.summary ?? poll.description ?? "Cast your vote on VoxDex."
      : null,
    image: poll?.slug ? opinionPollOgImagePath(poll.slug) : null,
  });

  if (isLoading && !poll) {
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
  const voteSortedOptions = sortOpinionPollOptionsByVotes(options);
  const votedOption = options.find((o: any) => o.id === poll.userVote);
  const detailDisplayOptions = hasVoted ? voteSortedOptions : options;
  const detailMaxPercent = Math.max(...voteSortedOptions.map((o: any) => o.percent || 0), 0);

  return (
    <div className="min-h-screen bg-background" data-testid="opinion-poll-detail-page">
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
            <VoteDetailNavCluster listType="opinion" slug={slug} />
          </div>
          <div className="flex justify-end min-w-0 justify-self-end col-start-3">
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
              {currentImgSrc ? (
                <div
                  className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-800 cursor-pointer"
                  onClick={() => setExpandedImage({ url: currentImgSrc, alt: poll.title })}
                >
                  <img
                    src={currentImgSrc}
                    alt={poll.title}
                    className="w-full h-full object-cover"
                    onError={handleHeaderImgError}
                  />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-lg bg-gradient-to-br from-slate-700/50 to-slate-800/50 flex items-center justify-center shrink-0">
                  <ListChecks className="h-5 w-5 text-slate-400" />
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
          className={voteDetailSectionCardClass("p-5 sm:p-6 mb-6")}
          data-testid="section-vote-module"
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-lg font-serif font-bold">
              <BarChart3 className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
              Cast Your Vote
            </h2>
            <div className="flex rounded-lg border border-border/50 bg-muted/30 p-0.5" role="group" aria-label="Option view mode">
              <button
                type="button"
                onClick={() => setOptionsViewMode("list")}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none ${
                  optionsViewMode === "list"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-pressed={optionsViewMode === "list"}
                data-testid="button-opinion-detail-options-list"
              >
                <List className="h-3.5 w-3.5" />
                List
              </button>
              <button
                type="button"
                onClick={() => openOptionImageReview()}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none ${
                  optionsViewMode === "gallery"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-pressed={optionsViewMode === "gallery"}
                data-testid="button-opinion-detail-options-gallery"
              >
                <Images className="h-3.5 w-3.5" />
                Image review
              </button>
            </div>
          </div>

          {optionsViewMode === "gallery" ? (
            <div className="max-h-[80dvh] space-y-3 overflow-y-auto pr-1 snap-y snap-mandatory overscroll-contain" data-testid="opinion-detail-image-review">
              {detailDisplayOptions.map((option: any, idx: number) => {
                const isSelected = poll.userVote === option.id;
                const percent = option.percent || 0;
                const isLeading = percent === detailMaxPercent && percent > 0;
                return (
                  <div
                    key={option.id}
                    className="snap-start"
                    ref={(node) => {
                      galleryOptionRefs.current[option.id] = node;
                    }}
                  >
                    <OpinionPollGalleryOption
                      pollId={poll.id}
                      option={option}
                      orderLabel={(option.orderIndex ?? idx) + 1}
                      mode={!hasVoted ? "vote" : isSelected ? "result-selected" : "result-other"}
                      percent={percent}
                      isLeading={isLeading}
                      disabled={voteMutation.isPending}
                      onVote={() => handleDetailVote(option)}
                      onChangeVote={() => handleDetailChangeVote(option)}
                      testIdPrefix={!hasVoted ? "opinion-detail-gallery-option" : "opinion-detail-gallery-result"}
                    />
                  </div>
                );
              })}
            </div>
          ) : !hasVoted ? (
            <div className="flex flex-col gap-2.5">
              {options.map((option: any, idx: number) => (
                <OpinionPollOptionRow
                  key={option.id}
                  pollId={poll.id}
                  option={option}
                  orderLabel={(option.orderIndex ?? idx) + 1}
                  mode="vote"
                  disabled={voteMutation.isPending}
                  onVote={() => handleDetailVote(option)}
                  onExpandImage={() => openOptionImageReview(option.id)}
                  imageInteraction="gallery"
                  testIdPrefix="button-vote-option"
                />
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
              {voteSortedOptions.map((option: any, idx: number) => {
                const isSelected = poll.userVote === option.id;
                const percent = option.percent || 0;
                const isLeading = percent === detailMaxPercent && percent > 0;
                return (
                  <OpinionPollOptionRow
                    key={option.id}
                    pollId={poll.id}
                    option={option}
                    orderLabel={(option.orderIndex ?? idx) + 1}
                    mode={isSelected ? "result-selected" : "result-other"}
                    percent={percent}
                    isLeading={isLeading}
                    disabled={voteMutation.isPending}
                    onChangeVote={() => handleDetailChangeVote(option)}
                    onExpandImage={() => openOptionImageReview(option.id)}
                    imageInteraction="gallery"
                    testIdPrefix="opinion-poll-cast-result"
                  />
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
                    // Phase 4 — no budget cost on remove (per Stage 4 server
                    // behaviour); anon users with a prior vote can remove it.
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

        <SuggestOptionCard
          slug={slug || ""}
          pollTitle={poll.title}
          isLoggedIn={!!user}
          onRequireLogin={() => setLocation("/login")}
        />

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

        <Card className={voteDetailSectionCardClass("p-5 mb-6")} data-testid="section-results">
          <h2 className="text-lg font-serif font-bold mb-5 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
            Results
          </h2>

          <div className="flex flex-col gap-3">
            {voteSortedOptions.map((option: any) => {
                const percent = option.percent || 0;
                const maxPercent = Math.max(...voteSortedOptions.map((o: any) => o.percent || 0), 0);
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
            focusContextTitle={poll.title}
            onShare={handleShare}
          />
        </div>

        <div className="hidden md:block">
          <CardComments
            entityType="opinion-poll"
            slug={slug || ""}
            placeholder="Share your thoughts on this topic..."
            focusContextTitle={poll.title}
            onShare={handleShare}
          />
        </div>

        {slug && poll && (
          <RelatedVoteItems
            type="opinion"
            currentSlug={slug}
            category={poll.category}
            className="mt-8"
          />
        )}
      </div>
      </SwipeNavigator>

      <ImageLightbox
        open={!!expandedImage}
        src={expandedImage?.url ?? ""}
        alt={expandedImage?.alt ?? ""}
        onClose={() => setExpandedImage(null)}
        zIndexClass="z-50"
      />
    </div>
  );
}
