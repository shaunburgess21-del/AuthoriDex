/**
 * Quick Vote overlay — the "First Vote Fast Path" onboarding surface.
 *
 * A minimal-variant snap view over a single curated column (~12 cards from
 * GET /api/vote/starter-mix, matchup → sentiment → opinion interleave).
 * Cards hydrate from the SAME list queries the Vote hub uses
 * (/api/matchups, /api/trending-polls, /api/opinion-polls), and votes go
 * through the shared cache-first paths, so everything the visitor does here
 * is already reflected when they land on /vote.
 *
 * Mobile-only by design (v1); hosts gate on useIsMobile.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import {
  VoteSnapScrollView,
  type SnapItem,
  type SnapViewApi,
} from "@/components/snap-scroll/VoteSnapScrollView";
import { QuickVoteActionBar } from "@/components/quick-vote/QuickVoteActionBar";
import { VersusCard, type VersusCardMatchup } from "@/components/matchups/VersusCard";
import { DiscourseCard } from "@/components/sentiment/DiscourseCard";
import { OpinionPollCard, type OpinionPollCardPoll } from "@/components/opinion-polls/OpinionPollCard";
import { useMatchupVotes } from "@/hooks/useMatchupVotes";
import { useOpinionPollVoteMutation } from "@/hooks/useOpinionPollVoteMutation";
import { useAnonBudget, applyBudgetFromVoteResponse } from "@/hooks/useAnonBudget";
import { checkVoteGate, VoteGateRedirectError } from "@/lib/voteGate";
import { navigateToLogin, type VoteResumePayload } from "@/lib/authReturn";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { isBudgetExhaustedVoteError, parseVoteError } from "@/lib/voteErrors";
import { apiRequest } from "@/lib/queryClient";
import { useXpBurst } from "@/components/XpBurstProvider";
import { useAuth } from "@/contexts/AuthContext";
import { hapticSuccess } from "@/lib/haptic";
import { logFunnelEvent, trackVoteCast } from "@/lib/funnelTelemetry";

interface StarterMixItem {
  type: "matchup" | "sentiment" | "opinion";
  id: string;
  slug: string | null;
}

const AUTO_ADVANCE_HOLD_MS = 1000;
/** Tap-time XP burst amount (same value as VotePage's optimistic feedback).
 * Fired immediately for signed-in users on NEW votes so the reward doesn't
 * wait on the server round-trip; the server-driven burst is suppressed. */
const OPTIMISTIC_VOTE_XP = 20;
const EMPTY_RACE_MAP = new Map<string, string>();
const NOOP = () => {};

export interface QuickVoteOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Card to restore to (post-signup return). */
  initialCardId?: string;
  /** Telemetry: what opened the overlay (nudge_pill, reentry_pill, restore). */
  source?: string;
}

export function QuickVoteOverlay({ open, onClose, initialCardId, source }: QuickVoteOverlayProps) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { trigger: triggerXpBurst } = useXpBurst();
  const { user } = useAuth();
  const budget = useAnonBudget();

  // ── Data: mix references + hydration lists (shared with Vote hub) ──────
  const { data: mixResponse, isFetched: mixFetched } = useQuery<{ data: StarterMixItem[] }>({
    queryKey: ["/api/vote/starter-mix"],
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const { data: matchups = [], isFetched: matchupsFetched } = useQuery<VersusCardMatchup[]>({
    queryKey: ["/api/matchups"],
    enabled: open,
    staleTime: 60 * 1000,
  });
  const { data: sentimentPolls = [], isFetched: sentimentFetched } = useQuery<any[]>({
    queryKey: ["/api/trending-polls"],
    enabled: open,
    staleTime: 60 * 1000,
  });
  const { data: opinionPolls = [], isFetched: opinionFetched } = useQuery<any[]>({
    queryKey: ["/api/opinion-polls"],
    enabled: open,
    staleTime: 60 * 1000,
  });
  const hydrationSettled =
    mixFetched && matchupsFetched && sentimentFetched && opinionFetched;

  const mixRefs = useMemo(() => mixResponse?.data ?? [], [mixResponse]);
  const typeById = useMemo(
    () => new Map(mixRefs.map((r) => [r.id, r.type])),
    [mixRefs],
  );

  const snapItems = useMemo<SnapItem[]>(() => {
    const items: SnapItem[] = [];
    for (const ref of mixRefs) {
      if (ref.type === "matchup") {
        const m = matchups.find((x) => x.id === ref.id);
        if (m) items.push({ id: m.id, slug: m.slug ?? "", category: m.category, title: m.title });
      } else if (ref.type === "sentiment") {
        const t = sentimentPolls.find((x: any) => x.id === ref.id);
        if (t) items.push({ id: t.id, slug: t.slug ?? "", category: t.category, title: t.headline });
      } else {
        const p = opinionPolls.find((x: any) => x.id === ref.id);
        if (p) items.push({ id: p.id, slug: p.slug ?? "", category: p.category, title: p.title });
      }
    }
    return items;
  }, [mixRefs, matchups, sentimentPolls, opinionPolls]);

  // ── Session stats + current-card tracking (telemetry, auth snapshot) ───
  const currentCardIdRef = useRef<string | null>(null);
  const maxIndexSeenRef = useRef(0);
  const votesCastRef = useRef(0);

  const handleVisibleIndexChange = useCallback((index: number, item: SnapItem | null) => {
    currentCardIdRef.current = item?.id ?? null;
    if (index > maxIndexSeenRef.current) maxIndexSeenRef.current = index;
  }, []);

  const quickVoteSnapshot = useCallback(
    (): VoteResumePayload => ({
      inductionOverlayOpen: false,
      topicsOverlayOpen: false,
      matchupsOverlayOpen: false,
      opinionPollsOverlayOpen: false,
      valuePerceptionOverlayOpen: false,
      snapScrollOpen: false,
      quickVoteOpen: true,
      quickVoteCardId: currentCardIdRef.current ?? undefined,
    }),
    [],
  );

  // overlay_open / overlay_close funnel events
  const wasOpenRef = useRef(false);
  const closeReasonRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      maxIndexSeenRef.current = 0;
      votesCastRef.current = 0;
      closeReasonRef.current = null;
      logFunnelEvent("overlay_open", "quick_vote", { source: source ?? "unknown" });
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      logFunnelEvent("overlay_close", "quick_vote", {
        cardsSeen: maxIndexSeenRef.current + 1,
        votesCast: votesCastRef.current,
        reason: closeReasonRef.current ?? "user",
      });
      closeReasonRef.current = null;
    }
  }, [open, source]);

  // Nothing to show: all sources settled but hydration produced zero cards
  // (empty mix, geo-filtered out, stale ids). Bail out instead of leaving
  // the visitor on a scroll-locked spinner.
  useEffect(() => {
    if (!open || !hydrationSettled) return;
    if (snapItems.length > 0) return;
    closeReasonRef.current = "empty_mix";
    onClose();
  }, [open, hydrationSettled, snapItems.length, onClose]);

  // ── Auto-advance beat (1s result reveal, gesture cancels) ──────────────
  const snapApiRef = useRef<SnapViewApi | null>(null);
  const advanceTimerRef = useRef<number | null>(null);

  const cancelAdvance = useCallback(() => {
    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, []);

  const scheduleAdvance = useCallback(() => {
    cancelAdvance();
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      snapApiRef.current?.advanceToNext();
    }, AUTO_ADVANCE_HOLD_MS);
  }, [cancelAdvance]);

  useEffect(() => {
    if (!open) {
      cancelAdvance();
      return;
    }
    // Any user gesture during the reveal hold cancels the pending advance.
    const cancel = () => cancelAdvance();
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("wheel", cancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("wheel", cancel);
      cancelAdvance();
    };
  }, [open, cancelAdvance]);

  // Confirmed-vote bookkeeping: session stats, funnel attribution (the
  // shared vote_cast events carry no overlay marker), auto-advance beat.
  const recordVote = useCallback(
    (type: "matchup" | "sentiment" | "opinion") => {
      votesCastRef.current += 1;
      logFunnelEvent("overlay_vote", "quick_vote", { type });
      scheduleAdvance();
    },
    [scheduleAdvance],
  );

  const redirectToSignup = useCallback(
    (resumeAction: { surfaceType: string; targetId: string; pendingVote?: any }) => {
      logFunnelEvent("exhaustion_hit", "quick_vote", { surfaceType: resumeAction.surfaceType });
      logFunnelEvent("signup_from_overlay", "quick_vote", { surfaceType: resumeAction.surfaceType });
      navigateToLogin(setLocation, {
        mode: "signup",
        reason: "vote_limit_reached",
        voteUi: quickVoteSnapshot(),
        resumeAction: {
          ...resumeAction,
          cardRoute: window.location.pathname,
        },
      });
    },
    [setLocation, quickVoteSnapshot],
  );

  // ── Matchups: shared cache-first hook (mirrors Vote hub instantly) ─────
  // Auto-advance only on confirmed server success; a rollback cancels any
  // pending advance so a failed vote never scrolls the visitor forward.
  const { userVotes: matchupUserVotes, voteMatchup, removeMatchupVote } = useMatchupVotes({
    getVoteUiSnapshot: quickVoteSnapshot,
    onVoteSuccess: () => recordVote("matchup"),
    onVoteRolledBack: () => cancelAdvance(),
  });

  const handleMatchupVote = useCallback(
    (matchupId: string, option: "option_a" | "option_b" | "neutral") => {
      const attempt = voteMatchup(matchupId, option, {
        // No success toast in the overlay: the top-center toaster would sit
        // over the header X for 4s. Card voted-state + auto-advance is the
        // feedback; haptic + tap-time XP burst give click-time confirmation.
        onProceed: (previousVote) => {
          hapticSuccess();
          if (user && !previousVote) {
            triggerXpBurst(OPTIMISTIC_VOTE_XP, undefined, "Vote");
            return { optimisticFeedbackShown: true };
          }
        },
      });
      if (attempt.ok === false && attempt.reason === "redirected_to_signup") {
        logFunnelEvent("exhaustion_hit", "quick_vote", { surfaceType: "matchup_poll" });
        logFunnelEvent("signup_from_overlay", "quick_vote", { surfaceType: "matchup_poll" });
      }
    },
    [voteMatchup, user, triggerXpBurst],
  );

  const handleMatchupRemoveVote = useCallback(
    (matchupId: string) => {
      removeMatchupVote(matchupId);
    },
    [removeMatchupVote],
  );

  // ── Sentiment: lean mirror of VotePage's discourse mutation ────────────
  const sentimentVoteMutation = useMutation({
    mutationFn: async ({ slug, choice }: { slug: string; choice: string; topicId: string; hadPreviousVote: boolean; suppressXpBurst: boolean }) => {
      const res = await apiRequest("POST", `/api/polls/${encodeURIComponent(slug)}/vote`, { choice });
      return res.json();
    },
    onSuccess: (data, variables) => {
      applyBudgetFromVoteResponse(queryClient, data);
      // New votes only — matches the matchup hook's !previousVote gate so
      // nthInSession isn't inflated by vote changes.
      if (!variables.hadPreviousVote) {
        trackVoteCast("trending_poll", { surface: "quick_vote" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/trending-polls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gamification/stats"] });
      // Voices feed shows the author's poll vote as a pill — keep it fresh.
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
      if (data?.xp?.xpAwarded && !variables.suppressXpBurst) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
    },
    onError: (error: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trending-polls"] });
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation, { voteUi: quickVoteSnapshot() })));
      } else if (isBudgetExhaustedVoteError(error)) {
        redirectToSignup({
          surfaceType: "trending_poll",
          targetId: variables.topicId,
          pendingVote: { choice: variables.choice },
        });
      } else {
        const parsed = parseVoteError(error);
        toast.error("Couldn't record vote", { description: parsed.message });
      }
    },
  });

  const handleSentimentVote = useCallback(
    async (topic: any, choice: "agree" | "neutral" | "disagree"): Promise<void> => {
      const decision = checkVoteGate(budget, "trending_poll", topic.id, !!topic.userVote);
      if (!decision.proceed) {
        redirectToSignup({
          ...decision.resumeAction,
          pendingVote: { choice },
        });
        throw new VoteGateRedirectError();
      }
      hapticSuccess();
      const optimisticBurst = !!user && !topic.userVote;
      if (optimisticBurst) {
        triggerXpBurst(OPTIMISTIC_VOTE_XP, undefined, "Vote");
      }
      await sentimentVoteMutation.mutateAsync({
        slug: topic.slug,
        choice,
        topicId: topic.id,
        hadPreviousVote: !!topic.userVote,
        suppressXpBurst: optimisticBurst,
      });
      recordVote("sentiment");
    },
    [budget, redirectToSignup, sentimentVoteMutation, recordVote, user, triggerXpBurst],
  );

  // ── Opinion: shared mutation hook (true cache mirror) ──────────────────
  const { vote: voteOnOpinionPoll, removeVote: removeOpinionPollVote } = useOpinionPollVoteMutation();

  const handleOpinionVote = useCallback(
    async (slug: string, optionId: string): Promise<void> => {
      const poll = (opinionPolls as any[]).find((p) => p.slug === slug);
      if (poll) {
        const decision = checkVoteGate(budget, "opinion_poll", poll.id, !!poll.userVote);
        if (!decision.proceed) {
          redirectToSignup({
            ...decision.resumeAction,
            pendingVote: { optionId },
          });
          throw new VoteGateRedirectError();
        }
      }
      const optimisticBurst = !!user && !!poll && !poll.userVote;
      if (optimisticBurst) {
        triggerXpBurst(OPTIMISTIC_VOTE_XP, undefined, "Vote");
      }
      await voteOnOpinionPoll(slug, optionId, { suppressXpBurst: optimisticBurst });
      recordVote("opinion");
    },
    [opinionPolls, budget, redirectToSignup, voteOnOpinionPoll, recordVote, user, triggerXpBurst],
  );

  const handleOpinionRemoveVote = useCallback(
    async (slug: string): Promise<void> => {
      await removeOpinionPollVote(slug);
    },
    [removeOpinionPollVote],
  );

  // ── Card rendering ──────────────────────────────────────────────────────
  const renderCard = useCallback(
    (item: SnapItem, ctx: { priority: boolean; index: number }) => {
      const type = typeById.get(item.id);
      if (type === "matchup") {
        const m = matchups.find((x) => x.id === item.id);
        if (!m) return null;
        return (
          <VersusCard
            matchup={m}
            priority={ctx.priority}
            userVote={matchupUserVotes[m.id] || null}
            onVote={handleMatchupVote}
            onRemoveVote={handleMatchupRemoveVote}
            onFilterCategory={NOOP}
            categoryRaceMap={EMPTY_RACE_MAP}
            categoryMenuDisabled
          />
        );
      }
      if (type === "sentiment") {
        const t = sentimentPolls.find((x: any) => x.id === item.id);
        if (!t) return null;
        return (
          <DiscourseCard
            topic={t}
            onVote={(choice) => handleSentimentVote(t, choice)}
            onFilterCategory={NOOP}
            categoryRaceMap={EMPTY_RACE_MAP}
            categoryMenuDisabled
          />
        );
      }
      if (type === "opinion") {
        const p = opinionPolls.find((x: any) => x.id === item.id);
        if (!p) return null;
        return (
          <OpinionPollCard
            poll={p as OpinionPollCardPoll}
            onVote={handleOpinionVote}
            onRemoveVote={handleOpinionRemoveVote}
            onFilterCategory={NOOP}
            categoryRaceMap={EMPTY_RACE_MAP}
            categoryMenuDisabled
          />
        );
      }
      return null;
    },
    [
      typeById,
      matchups,
      sentimentPolls,
      opinionPolls,
      matchupUserVotes,
      handleMatchupVote,
      handleMatchupRemoveVote,
      handleSentimentVote,
      handleOpinionVote,
      handleOpinionRemoveVote,
    ],
  );

  // Hovering action row below each card (discussion / like / dislike / share).
  const handleOverlayClosed = useCallback(() => {
    snapApiRef.current?.releaseGestures();
  }, []);

  const renderPageFooter = useCallback(
    (item: SnapItem) => {
      const type = typeById.get(item.id);
      if (!type) return null;
      return (
        <QuickVoteActionBar
          type={type}
          targetId={item.id}
          slug={item.slug}
          title={item.title}
          category={item.category}
          onOverlayClosed={handleOverlayClosed}
        />
      );
    },
    [typeById, handleOverlayClosed],
  );

  return (
    <>
      <VoteSnapScrollView
        open={open && snapItems.length > 0}
        onClose={onClose}
        sectionType="matchups"
        commentMode="none"
        variant="minimal"
        items={snapItems}
        initialItemId={initialCardId}
        renderCard={renderCard}
        apiRef={snapApiRef}
        onVisibleIndexChange={handleVisibleIndexChange}
        renderPageFooter={renderPageFooter}
      />
      {/* Loading shell: the host locks scroll + pushes history the moment the
          overlay opens, so the visitor must never face a bare locked page.
          Same glass chrome as the minimal snap variant, X always available. */}
      {open && snapItems.length === 0 && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/40 backdrop-blur-md"
          data-testid="quick-vote-loading-shell"
        >
          <div className="shrink-0 h-[52px] flex items-center justify-end safe-top px-1">
            <button
              onClick={onClose}
              className="p-3 text-white/80 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-interactive="true"
              aria-label="Close quick vote"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/70" />
          </div>
        </div>
      )}
    </>
  );
}
