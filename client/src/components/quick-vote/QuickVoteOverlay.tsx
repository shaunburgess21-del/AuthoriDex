/**
 * Quick Vote overlay — the "First Vote Fast Path" onboarding surface.
 *
 * A transform-driven card deck (QuickVoteDeck — no native scrolling) over a
 * single curated column (from GET /api/vote/starter-mix, matchup → sentiment
 * → opinion → rating interleave). `?qvdeck=snap` swaps in the legacy
 * minimal-variant VoteSnapScrollView for on-device comparison.
 * Cards hydrate from the SAME list queries the Vote hub uses
 * (/api/matchups, /api/trending-polls, /api/opinion-polls,
 * /api/vote/overall-ratings), and votes go
 * through the shared cache-first paths, so everything the visitor does here
 * is already reflected when they land on /vote.
 *
 * Mobile-only by design (v1); hosts gate on useIsMobile.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { CheckCircle2, Loader2, X } from "lucide-react";
import {
  VoteSnapScrollView,
  type SnapItem,
  type SnapViewApi,
} from "@/components/snap-scroll/VoteSnapScrollView";
import { QuickVoteActionBar } from "@/components/quick-vote/QuickVoteActionBar";
import { QuickVoteDeck } from "@/components/quick-vote/QuickVoteDeck";
import { QuickVoteDebugHud } from "@/components/quick-vote/QuickVoteDebugHud";
import { qvLog, qvSetState, readQvDebugFlags } from "@/lib/quickVoteDebug";
import { Card } from "@/components/ui/card";
import { QuickVoteSearch, resetIosInputZoom } from "@/components/quick-vote/QuickVoteSearch";
import {
  QuickVoteHideVotedToggle,
  type HideVotedTipDismissReason,
} from "@/components/quick-vote/QuickVoteHideVotedToggle";
import {
  hasSeenHideVotedTip,
  isQuickVoteCardVoted,
  markHideVotedTipSeen,
  readHideVotedPreference,
  writeHideVotedPreference,
} from "@/lib/quickVoteHideVoted";
import { VersusCard, type VersusCardMatchup } from "@/components/matchups/VersusCard";
import { DiscourseCard } from "@/components/sentiment/DiscourseCard";
import { OpinionPollCard, type OpinionPollCardPoll } from "@/components/opinion-polls/OpinionPollCard";
import { OverallRatingCard, type OverallRatingPerson } from "@/components/OverallRatingCard";
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
import { haptic, hapticSuccess } from "@/lib/haptic";
import { logFunnelEvent, trackVoteCast } from "@/lib/funnelTelemetry";
import {
  matchupSearchLabel,
  searchQuickVoteCards,
  type QuickVoteSearchHit,
  type QuickVoteSearchRecord,
} from "@/lib/quickVoteSearch";

interface StarterMixItem {
  type: "matchup" | "sentiment" | "opinion" | "rating";
  id: string;
  slug: string | null;
}

const AUTO_ADVANCE_HOLD_MS = 1000;
/** Coach tip surfaces once the filter is useful: this many voted cards in
 * the deck, or this many votes cast this overlay session. */
const HIDE_VOTED_TIP_MIN_VOTED_CARDS = 3;
const HIDE_VOTED_TIP_MIN_SESSION_VOTES = 2;
/** Tap-time XP burst amount (same value as VotePage's optimistic feedback).
 * Fired immediately for signed-in users on NEW votes so the reward doesn't
 * wait on the server round-trip; the server-driven burst is suppressed. */
const OPTIMISTIC_VOTE_XP = 20;
const EMPTY_RACE_MAP = new Map<string, string>();
const NOOP = () => {};

/** Diagnostics (?qvstub=rating): static stand-in for OverallRatingCard with
 * the identical slot/Card shell and min-height, but no hooks, no Radix
 * Avatar, no role=button segments. */
function QuickVoteRatingStub({ name, category }: { name: string; category: string | null }) {
  return (
    <div className="hub-card-slot relative h-full">
      <Card
        className="hub-card-hover lb-row-neutral relative pt-5 px-4 sm:px-5 pb-4 sm:pb-5 bg-card/80 backdrop-blur-sm h-full min-h-[390px] md:min-h-[340px] flex flex-col shadow-none md:shadow-sm rounded-[12px] md:rounded-xl"
        data-testid="card-overall-rating-stub"
      >
        <div className="flex items-center justify-between gap-2 mb-3 text-xs text-muted-foreground">
          <span>Votes</span>
          <span>{category ?? "misc"}</span>
        </div>
        <div className="flex items-start gap-3 mb-2">
          <div className="h-20 w-20 rounded-md bg-primary/10" />
          <div className="flex-1 min-w-0">
            <h3 className="font-serif font-bold text-xl leading-tight">Rate {name}</h3>
            <p className="text-[15px] text-muted-foreground mt-1">STUB CARD (qvstub=rating)</p>
          </div>
        </div>
        <div className="mt-auto flex flex-col gap-3">
          <div className="grid grid-cols-5 gap-1">
            {["Hate", "Dislike", "Neutral", "Like", "Love"].map((l) => (
              <div key={l} className="py-1.5 rounded-md border border-border/40 text-center text-[10px] text-muted-foreground">
                {l}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-1">
            {[1, 2, 3, 4, 5].map((v) => (
              <div key={v} className="h-5 rounded-full bg-white/20" />
            ))}
          </div>
          <div className="h-9 w-full rounded-md bg-blue-600/60" />
        </div>
      </Card>
    </div>
  );
}

/** Diagnostics: logs card mount/unmount by deck index and type. Only wrapped
 * around cards when the HUD flag is on; renders no DOM of its own. */
function QvCardProbe({
  index,
  type,
  title,
  children,
}: {
  index: number;
  type: string;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    qvLog("card.mount", { i: index, type, title: title.slice(0, 24) });
    return () => qvLog("card.unmount", { i: index, type });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{children}</>;
}
const KEYBOARD_SETTLE_IDLE_MS = 80;
const KEYBOARD_SETTLE_FALLBACK_MS = 450;
const SCALE_EPS = 0.02;
const OFFSET_EPS = 2;

function isVisualViewportReset(): boolean {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return true;
  return (
    Math.abs(vv.scale - 1) <= SCALE_EPS &&
    Math.abs(vv.offsetLeft) <= OFFSET_EPS &&
    Math.abs(vv.offsetTop) <= OFFSET_EPS
  );
}

/** Wait until the keyboard/toolbar AND leftover input-zoom settle so a
 * search jump measures the full-bleed unzoomed card. Fallback if quiet. */
function afterVisualViewportSettles(cb: () => void): () => void {
  let settled = false;
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  let idleTimer = 0;
  let fallbackTimer = 0;

  const detach = () => {
    vv?.removeEventListener("resize", onChange);
    vv?.removeEventListener("scroll", onChange);
    window.clearTimeout(idleTimer);
    window.clearTimeout(fallbackTimer);
  };

  const finish = (force: boolean) => {
    if (settled) return;
    if (!isVisualViewportReset()) {
      resetIosInputZoom();
      if (!force) {
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => finish(false), KEYBOARD_SETTLE_IDLE_MS);
        return;
      }
    }
    settled = true;
    detach();
    cb();
  };

  const onChange = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => finish(false), KEYBOARD_SETTLE_IDLE_MS);
  };

  resetIosInputZoom();
  fallbackTimer = window.setTimeout(() => finish(true), KEYBOARD_SETTLE_FALLBACK_MS);
  vv?.addEventListener("resize", onChange);
  vv?.addEventListener("scroll", onChange);

  return () => {
    settled = true;
    detach();
  };
}

export interface QuickVoteOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Card to restore to (post-signup return). */
  initialCardId?: string;
  /** Telemetry: what opened the overlay (nudge_pill, persistent_pill, restore). */
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
  const { data: ratingsResponse, isFetched: ratingsFetched } = useQuery<{ data: OverallRatingPerson[] }>({
    queryKey: ["/api/vote/overall-ratings"],
    enabled: open,
    staleTime: 60 * 1000,
  });
  const hydrationSettled =
    mixFetched && matchupsFetched && sentimentFetched && opinionFetched && ratingsFetched;
  const ratingPeople = useMemo(
    () => (ratingsResponse?.data ?? []).filter((p) => !p.isInduction),
    [ratingsResponse],
  );

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
      } else if (ref.type === "rating") {
        const person = ratingPeople.find((p) => p.id === ref.id);
        if (person) {
          items.push({
            id: person.id,
            slug: person.id,
            category: person.category || "misc",
            title: person.name,
            personId: person.id,
            personName: person.name,
          });
        }
      } else {
        const p = opinionPolls.find((x: any) => x.id === ref.id);
        if (p) items.push({ id: p.id, slug: p.slug ?? "", category: p.category, title: p.title });
      }
    }
    // Diagnostics bisection (?qvorder=rating-first): rating cards lead the
    // deck so a jam at card 1 implicates the card, a jam at card 4 the position.
    if (readQvDebugFlags().ratingFirst) {
      const ratings = items.filter((i) => typeById.get(i.id) === "rating");
      const rest = items.filter((i) => typeById.get(i.id) !== "rating");
      return [...ratings, ...rest];
    }
    return items;
  }, [mixRefs, matchups, sentimentPolls, opinionPolls, ratingPeople, typeById]);

  // Diagnostics: count deck identity changes (a refetch of any hydration list
  // rebuilds snapItems and re-renders every mounted page).
  const itemsChangesRef = useRef(-1);
  useEffect(() => {
    itemsChangesRef.current += 1;
    qvSetState({ itemsChanges: itemsChangesRef.current });
    if (itemsChangesRef.current > 0) qvLog("items.changed", { count: snapItems.length });
  }, [snapItems]);

  // ── Hide voted cards: preference + never-yank-the-current-card sets ────
  // `retainedIds` holds the previous and current card ids: a card the
  // visitor just voted on stays for its result reveal and the auto-advance,
  // and only drops out once it is two pages behind (never on screen, never
  // mid-spring). `pinnedIds` are hidden cards reached via search.
  const [hideVoted, setHideVoted] = useState(() => readHideVotedPreference());
  const [retainedIds, setRetainedIds] = useState<string[]>([]);
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Rating votes land in localStorage first (anon fallback) — bump to re-read.
  const [ratingVoteTick, setRatingVoteTick] = useState(0);
  const [sessionVotes, setSessionVotes] = useState(0);
  const [tipOpen, setTipOpen] = useState(false);
  const tipOpenRef = useRef(false);
  const tipShownRef = useRef(false);
  const [tipPulseKey, setTipPulseKey] = useState(0);
  const displayItemsRef = useRef<SnapItem[]>([]);

  useEffect(() => {
    if (!open) return;
    const bump = () => setRatingVoteTick((t) => t + 1);
    window.addEventListener("sentiment-vote-updated", bump);
    return () => window.removeEventListener("sentiment-vote-updated", bump);
  }, [open]);

  const [searchQuery, setSearchQuery] = useState("");

  // ── Session stats + current-card tracking (telemetry, auth snapshot) ───
  const currentCardIdRef = useRef<string | null>(null);
  const maxIndexSeenRef = useRef(0);
  const votesCastRef = useRef(0);
  const wasOpenRef = useRef(false);
  // Render-time mirror of `open` (child effects run before our open effect).
  const openRef = useRef(open);
  openRef.current = open;

  const handleVisibleIndexChange = useCallback((index: number, item: SnapItem | null) => {
    currentCardIdRef.current = item?.id ?? null;
    if (index > maxIndexSeenRef.current) maxIndexSeenRef.current = index;
    const id = item?.id;
    // Ignore reports from the deck's exit animation after close so a stale
    // id cannot survive into the next session.
    if (id && openRef.current) {
      setRetainedIds((prev) => {
        if (prev[prev.length - 1] === id) return prev;
        const last = prev[prev.length - 1];
        return last ? [last, id] : [id];
      });
    }
    qvSetState({
      cardType: item ? (typeById.get(item.id) ?? "?") : null,
      cardTitle: item ? item.title.slice(0, 22) : null,
    });
  }, [typeById]);

  const quickVoteSnapshot = useCallback(
    (): VoteResumePayload => ({
      inductionOverlayOpen: false,
      topicsOverlayOpen: false,
      matchupsOverlayOpen: false,
      opinionPollsOverlayOpen: false,
      ratingOverlayOpen: false,
      snapScrollOpen: false,
      quickVoteOpen: true,
      quickVoteCardId: currentCardIdRef.current ?? undefined,
    }),
    [],
  );

  // overlay_open / overlay_close funnel events
  const closeReasonRef = useRef<string | null>(null);
  const keyboardWaitCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      maxIndexSeenRef.current = 0;
      votesCastRef.current = 0;
      closeReasonRef.current = null;
      tipShownRef.current = false;
      logFunnelEvent("overlay_open", "quick_vote", { source: source ?? "unknown" });
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      logFunnelEvent("overlay_close", "quick_vote", {
        cardsSeen: maxIndexSeenRef.current + 1,
        votesCast: votesCastRef.current,
        reason: closeReasonRef.current ?? "user",
      });
      closeReasonRef.current = null;
      setSearchQuery("");
      tipOpenRef.current = false;
      setTipOpen(false);
      // Reset the filter's per-session sets on CLOSE, not open: on the open
      // commit the deck mounts in the same pass and has already reported
      // the current card (child effects run first) — clearing here would
      // wipe that retention and let the card on screen vanish on toggle.
      setSessionVotes(0);
      setRetainedIds([]);
      setPinnedIds(new Set());
      keyboardWaitCleanupRef.current?.();
      keyboardWaitCleanupRef.current = null;
    }
  }, [open, source]);

  // Nothing to show: all sources settled but hydration produced zero cards
  // (empty mix, geo-filtered out, stale ids). Bail out instead of leaving
  // the visitor on a scroll-locked spinner. Checks the UNFILTERED list on
  // purpose: the hide-voted filter renders its own empty panel and must
  // never close the overlay.
  useEffect(() => {
    if (!open || !hydrationSettled) return;
    if (snapItems.length > 0) return;
    closeReasonRef.current = "empty_mix";
    onClose();
  }, [open, hydrationSettled, snapItems.length, onClose]);

  // ── Auto-advance beat (1s result reveal, gesture cancels) ──────────────
  const snapApiRef = useRef<SnapViewApi | null>(null);
  const advanceTimerRef = useRef<number | null>(null);

  const handleSearchSelect = useCallback((hit: QuickVoteSearchHit) => {
    setSearchQuery("");
    haptic();
    logFunnelEvent("overlay_search_select", "quick_vote", { type: hit.type, hidden: !!hit.hidden });
    // Search bypasses the hide-voted filter: pin a hidden hit so it is back
    // in the deck by the time the jump below runs (≥80ms later).
    if (hit.hidden) {
      setPinnedIds((prev) => (prev.has(hit.id) ? prev : new Set(prev).add(hit.id)));
    }
    keyboardWaitCleanupRef.current?.();
    keyboardWaitCleanupRef.current = afterVisualViewportSettles(() => {
      keyboardWaitCleanupRef.current = null;
      // Jump only after the keyboard/toolbar height has settled so
      // clientHeight is the full-bleed card. Keep the old card on screen
      // until then — never releaseGestures first (that cancels the snap).
      // Resolve the index at jump time: the filtered deck may have shifted.
      const index = displayItemsRef.current.findIndex((i) => i.id === hit.id);
      snapApiRef.current?.scrollToIndex(index >= 0 ? index : hit.index);
      snapApiRef.current?.releaseGestures();
    });
  }, []);

  useEffect(() => {
    return () => {
      keyboardWaitCleanupRef.current?.();
      keyboardWaitCleanupRef.current = null;
    };
  }, []);

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
    window.addEventListener("pointerdown", cancel, { passive: true });
    window.addEventListener("wheel", cancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("wheel", cancel);
      cancelAdvance();
    };
  }, [open, cancelAdvance]);

  // Confirmed-vote bookkeeping: session stats, funnel attribution (the
  // shared vote_cast events carry no overlay marker), auto-advance beat.
  const recordVote = useCallback(
    (type: "matchup" | "sentiment" | "opinion" | "rating") => {
      votesCastRef.current += 1;
      setSessionVotes((n) => n + 1);
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

  // ── Filtered deck (hide voted) ─────────────────────────────────────────
  const isVoted = useCallback(
    (item: SnapItem) =>
      isQuickVoteCardVoted(typeById.get(item.id), item.id, {
        matchupUserVotes,
        sentimentPolls,
        opinionPolls,
        ratingPeople,
      }),
    [typeById, matchupUserVotes, sentimentPolls, opinionPolls, ratingPeople],
  );

  const votedCount = useMemo(() => {
    void ratingVoteTick; // rating votes land in localStorage — re-read on the event
    return snapItems.reduce((n, item) => n + (isVoted(item) ? 1 : 0), 0);
  }, [snapItems, isVoted, ratingVoteTick]);

  const displayItems = useMemo<SnapItem[]>(() => {
    void ratingVoteTick;
    if (!hideVoted) return snapItems;
    return snapItems.filter(
      (item) =>
        retainedIds.includes(item.id) ||
        pinnedIds.has(item.id) ||
        item.id === initialCardId ||
        !isVoted(item),
    );
  }, [snapItems, hideVoted, retainedIds, pinnedIds, initialCardId, isVoted, ratingVoteTick]);
  displayItemsRef.current = displayItems;
  const hiddenCount = snapItems.length - displayItems.length;

  const displayIndexById = useMemo(
    () => new Map(displayItems.map((item, index) => [item.id, index])),
    [displayItems],
  );

  // Search bypasses the filter: records cover every card, hidden ones tagged.
  const searchRecords = useMemo<QuickVoteSearchRecord[]>(() => {
    return snapItems.map((item, rawIndex) => {
      const type = typeById.get(item.id);
      const displayIndex = displayIndexById.get(item.id);
      const index = displayIndex ?? rawIndex;
      const hidden = displayIndex === undefined;
      if (type === "matchup") {
        const m = matchups.find((x) => x.id === item.id);
        return {
          id: item.id,
          index,
          hidden,
          type: "matchup" as const,
          label: matchupSearchLabel(m?.optionAText, m?.optionBText, m?.promptText || m?.title || item.title),
          titleHaystack: [m?.title, m?.promptText, item.title].filter(Boolean).join(" "),
          optionHaystack: [m?.optionAText, m?.optionBText].filter(Boolean).join(" "),
          extraHaystack: m?.category ?? item.category,
          thumbA: m?.optionAImage,
          thumbB: m?.optionBImage,
        };
      }
      if (type === "sentiment") {
        const t = sentimentPolls.find((x: any) => x.id === item.id);
        return {
          id: item.id,
          index,
          hidden,
          type: "sentiment" as const,
          label: t?.headline || item.title,
          titleHaystack: [t?.headline, item.title, t?.personName].filter(Boolean).join(" "),
          optionHaystack: "",
          extraHaystack: t?.category ?? item.category,
          thumbA: t?.personAvatar || t?.imageUrl || null,
        };
      }
      if (type === "rating") {
        const person = ratingPeople.find((p) => p.id === item.id);
        return {
          id: item.id,
          index,
          hidden,
          type: "rating" as const,
          label: person?.name || item.title,
          titleHaystack: [person?.name, item.title].filter(Boolean).join(" "),
          optionHaystack: "",
          extraHaystack: person?.category ?? item.category,
          thumbA: person?.avatar ?? null,
        };
      }
      const p = opinionPolls.find((x: any) => x.id === item.id) as OpinionPollCardPoll | undefined;
      const optionNames = (p?.options ?? []).map((o) => o.name).filter(Boolean);
      return {
        id: item.id,
        index,
        hidden,
        type: "opinion" as const,
        label: p?.title || item.title,
        titleHaystack: [p?.title, p?.description, item.title].filter(Boolean).join(" "),
        optionHaystack: optionNames.join(" "),
        extraHaystack: p?.category ?? item.category,
        thumbA: p?.options?.[0]?.imageUrl || p?.imageUrl || null,
        thumbB: p?.options?.[1]?.imageUrl || null,
      };
    });
  }, [snapItems, displayIndexById, typeById, matchups, sentimentPolls, opinionPolls, ratingPeople]);

  const searchResults = useMemo(
    () => searchQuickVoteCards(searchQuery, searchRecords),
    [searchQuery, searchRecords],
  );

  const handleToggleHideVoted = useCallback(() => {
    const next = !hideVoted;
    haptic();
    setHideVoted(next);
    writeHideVotedPreference(next);
    logFunnelEvent("overlay_hide_voted", "quick_vote", {
      enabled: next,
      hiddenCount: next ? votedCount : 0,
    });
  }, [hideVoted, votedCount]);

  const handleTipDismiss = useCallback((reason: HideVotedTipDismissReason) => {
    if (!tipOpenRef.current) return;
    tipOpenRef.current = false;
    setTipOpen(false);
    logFunnelEvent("overlay_hide_voted_tip", "quick_vote", {
      action: reason === "accepted" ? "accepted" : "dismissed",
    });
  }, []);

  // Coach tip: once per device, only when the filter would actually do
  // something, and never over an open comments / search sheet.
  useEffect(() => {
    if (!open || hideVoted || tipShownRef.current) return;
    if (votedCount < HIDE_VOTED_TIP_MIN_VOTED_CARDS && sessionVotes < HIDE_VOTED_TIP_MIN_SESSION_VOTES) return;
    if (searchQuery.trim().length > 0) return;
    if (hasSeenHideVotedTip()) {
      tipShownRef.current = true;
      return;
    }
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    tipShownRef.current = true;
    tipOpenRef.current = true;
    markHideVotedTipSeen();
    setTipOpen(true);
    setTipPulseKey((k) => k + 1);
    logFunnelEvent("overlay_hide_voted_tip", "quick_vote", { action: "shown" });
  }, [open, hideVoted, votedCount, sessionVotes, searchQuery]);

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

  const handleRated = useCallback(() => {
    recordVote("rating");
  }, [recordVote]);

  // ── Card rendering ──────────────────────────────────────────────────────
  const renderCardInner = useCallback(
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
      if (type === "rating") {
        const person = ratingPeople.find((p) => p.id === item.id);
        if (!person) return null;
        // Diagnostics bisection (?qvstub=rating): same shell, no hooks, no
        // avatar, no role=button segments. Smooth here = culprit is inside
        // OverallRatingCard; still jams = the deck/scroller.
        if (readQvDebugFlags().stubRating) {
          return <QuickVoteRatingStub name={person.name} category={person.category} />;
        }
        return (
          <OverallRatingCard
            person={person}
            onFilterCategory={NOOP}
            categoryRaceMap={EMPTY_RACE_MAP}
            categoryMenuDisabled
            onRated={handleRated}
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
      ratingPeople,
      matchupUserVotes,
      handleMatchupVote,
      handleMatchupRemoveVote,
      handleSentimentVote,
      handleOpinionVote,
      handleOpinionRemoveVote,
      handleRated,
    ],
  );

  // Diagnostics wrapper: mount/unmount log per deck index (HUD flag only —
  // without it renderCard IS renderCardInner, no extra component).
  const renderCard = useMemo(() => {
    if (!readQvDebugFlags().hud) return renderCardInner;
    return (item: SnapItem, ctx: { priority: boolean; index: number }) => {
      const card = renderCardInner(item, ctx);
      if (card == null) return card;
      return (
        <QvCardProbe
          key={item.id}
          index={ctx.index}
          type={typeById.get(item.id) ?? "?"}
          title={item.title}
        >
          {card}
        </QvCardProbe>
      );
    };
  }, [renderCardInner, typeById]);

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

  // Stable element: a fresh <QuickVoteSearch> per overlay render would make
  // every deck prop change on each refetch (anon budget, list invalidation
  // after a vote) and re-reconcile all mounted cards mid-gesture.
  // `relative` here anchors the search results sheet across the whole row.
  const headerSlot = useMemo(
    () => (
      <div className="relative flex items-center gap-2">
        <QuickVoteSearch
          query={searchQuery}
          onQueryChange={setSearchQuery}
          results={searchResults}
          onSelect={handleSearchSelect}
        />
        <QuickVoteHideVotedToggle
          enabled={hideVoted}
          hiddenCount={hiddenCount}
          onToggle={handleToggleHideVoted}
          tipOpen={tipOpen}
          onTipDismiss={handleTipDismiss}
          pulseKey={tipPulseKey}
        />
      </div>
    ),
    [
      searchQuery,
      searchResults,
      handleSearchSelect,
      hideVoted,
      hiddenCount,
      handleToggleHideVoted,
      tipOpen,
      handleTipDismiss,
      tipPulseKey,
    ],
  );

  const deckOpen = open && displayItems.length > 0;
  // Only once every source has landed: a half-hydrated deck whose first
  // list happens to be all voted must show the spinner, not "voted on
  // everything".
  const allVotedHidden =
    open && hideVoted && hydrationSettled && snapItems.length > 0 && displayItems.length === 0;
  const showLoadingShell = open && displayItems.length === 0 && !allVotedHidden;
  // ?qvdeck=snap — legacy native scroll-snap column for on-device A/B.
  const useLegacySnap = readQvDebugFlags().legacySnap;

  return (
    <>
      {useLegacySnap ? (
        <VoteSnapScrollView
          open={deckOpen}
          onClose={onClose}
          sectionType="matchups"
          commentMode="none"
          variant="minimal"
          items={displayItems}
          initialItemId={initialCardId}
          renderCard={renderCard}
          apiRef={snapApiRef}
          onVisibleIndexChange={handleVisibleIndexChange}
          renderPageFooter={renderPageFooter}
          headerSlot={headerSlot}
        />
      ) : (
        <QuickVoteDeck
          open={deckOpen}
          onClose={onClose}
          items={displayItems}
          initialItemId={initialCardId}
          renderCard={renderCard}
          apiRef={snapApiRef}
          onVisibleIndexChange={handleVisibleIndexChange}
          renderPageFooter={renderPageFooter}
          headerSlot={headerSlot}
          followCurrent={hydrationSettled}
        />
      )}
      {open && readQvDebugFlags().hud && <QuickVoteDebugHud />}
      {/* Loading shell: the host locks scroll + pushes history the moment the
          overlay opens, so the visitor must never face a bare locked page.
          Same glass chrome as the minimal snap variant, X always available. */}
      {showLoadingShell && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/40 backdrop-blur-md"
          data-testid="quick-vote-loading-shell"
        >
          <div
            className="shrink-0 flex items-center justify-end px-1"
            style={{
              paddingTop: "var(--safe-area-inset-top, 0px)",
              height: "calc(52px + var(--safe-area-inset-top, 0px))",
            }}
          >
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
      {/* Hide-voted on and every card is voted: same chrome as the loading
          shell, with the toggle still in the header and a one-tap way out. */}
      {allVotedHidden && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/40 backdrop-blur-md"
          data-testid="quick-vote-all-voted"
        >
          <div
            className="shrink-0 flex items-center px-1"
            style={{
              paddingTop: "var(--safe-area-inset-top, 0px)",
              height: "calc(52px + var(--safe-area-inset-top, 0px))",
            }}
          >
            <div className="flex-1 min-w-0 pl-3">{headerSlot}</div>
            <button
              onClick={onClose}
              className="p-3 text-white/80 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-interactive="true"
              aria-label="Close quick vote"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-black/60 p-6 text-center shadow-2xl shadow-black/50 backdrop-blur-xl">
              <CheckCircle2 className="mx-auto h-9 w-9 text-amber-400" aria-hidden />
              <h2 className="mt-3 font-serif text-xl font-bold text-slate-100">
                You&apos;ve voted on everything here
              </h2>
              <p className="mt-1.5 text-sm text-white/60">
                All {snapItems.length} cards in this deck are hidden because you&apos;ve already voted on them.
              </p>
              <button
                type="button"
                onClick={handleToggleHideVoted}
                data-interactive="true"
                data-testid="quick-vote-show-voted"
                className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/15 px-4 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/25 active:scale-[0.98]"
              >
                Show voted cards
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
