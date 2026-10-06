import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Share2,
  TrendingUp,
  UserRound,
  Vote,
  X,
} from "lucide-react";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { InlineProfileBadge } from "@/components/MomentumSignals";
import { SwipeNavigator } from "@/components/vote/SwipeNavigator";
import { useWikiSummary, wikiSummaryQueryOptions } from "@/hooks/useWikiSummary";
import { getDisplayImageUrl } from "@/lib/imageTransform";
import { sharePage } from "@/lib/share";
import {
  SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS,
  SENTIMENT_POLL_SUPPORT_BUTTON_COMPACT_CLASS,
} from "@/lib/sentimentPollVoteDisplay";
import { cn } from "@/lib/utils";
import type { RankedCandidate } from "./types";

interface CandidateSpotlightProps {
  open: boolean;
  onClose: () => void;
  /** The browse sequence (search results or the active category), in order. */
  sequence: RankedCandidate[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Whole queue by rank — used for "votes to pass #N" and the leader bar. */
  ranked: RankedCandidate[];
  isVoted: (id: string) => boolean;
  onVote: (id: string) => void;
  onViewProfile: (personId: string) => void;
}

const GLASS_BUTTON =
  "pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400";

function preloadImage(candidate: RankedCandidate | undefined) {
  const src = candidate?.avatar?.trim();
  if (!src || !/^https?:\/\//i.test(src)) return;
  const img = new Image();
  img.src = getDisplayImageUrl(src, { width: 700 });
}

export function CandidateSpotlight({
  open,
  onClose,
  sequence,
  index,
  onIndexChange,
  ranked,
  isVoted,
  onVote,
  onViewProfile,
}: CandidateSpotlightProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [direction, setDirection] = useState(1);
  const candidate = sequence[index];
  const hasPrev = index > 0;
  const hasNext = index < sequence.length - 1;

  const go = useCallback(
    (delta: 1 | -1) => {
      const next = index + delta;
      if (next < 0 || next >= sequence.length) return;
      setDirection(delta);
      onIndexChange(next);
    },
    [index, sequence.length, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  const share = () => {
    if (!candidate) return;
    void sharePage(`Vote ${candidate.displayName} onto the VoxDex leaderboard`, {
      url: candidate.personId
        ? `/person/${candidate.personId}`
        : `/vote/induction?search=${encodeURIComponent(candidate.displayName)}`,
      sharerUserId: user?.id ?? null,
      surface: "person_profile",
    });
  };

  useEffect(() => {
    if (!open) return;
    for (const neighbour of [sequence[index + 1], sequence[index - 1]]) {
      if (!neighbour) continue;
      preloadImage(neighbour);
      if (neighbour.wikiSlug) {
        void queryClient.prefetchQuery(wikiSummaryQueryOptions(neighbour.wikiSlug));
      }
    }
  }, [open, index, sequence, queryClient]);

  return (
    <DialogPrimitive.Root open={open && !!candidate} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/75 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background outline-none",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(820px,calc(100dvh-3rem))] sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:rounded-2xl sm:border sm:border-border/60 sm:shadow-2xl sm:shadow-black/60",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:slide-in-from-bottom-6 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
          )}
          data-testid="induction-spotlight"
        >
          {candidate && (
            <>
              {/* Floating chrome over the portrait */}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-[max(0.75rem,var(--safe-area-inset-top,env(safe-area-inset-top,0px)))]">
                <DialogPrimitive.Close className={GLASS_BUTTON} aria-label="Close" data-testid="button-spotlight-close">
                  <X className="h-5 w-5" />
                </DialogPrimitive.Close>
                {sequence.length > 1 && (
                  <span className="rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium tabular-nums text-white/90 backdrop-blur-md">
                    {index + 1} of {sequence.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={share}
                  className={GLASS_BUTTON}
                  aria-label={`Share ${candidate.displayName}`}
                  data-testid="button-spotlight-share"
                >
                  <Share2 className="h-[18px] w-[18px]" />
                </button>
              </div>

              <SwipeNavigator
                onSwipeLeft={() => go(1)}
                onSwipeRight={() => go(-1)}
                disableLeft={!hasNext}
                disableRight={!hasPrev}
                className="relative min-h-0 flex-1"
              >
                <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                  <motion.div
                    key={candidate.id}
                    custom={direction}
                    initial={{ opacity: 0, x: direction * 48 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: direction * -48 }}
                    transition={{ type: "spring", stiffness: 380, damping: 36 }}
                    className="absolute inset-0 overflow-y-auto overscroll-contain"
                  >
                    <SpotlightBody
                      candidate={candidate}
                      ranked={ranked}
                      voted={isVoted(candidate.id)}
                      onViewProfile={onViewProfile}
                    />
                  </motion.div>
                </AnimatePresence>
              </SwipeNavigator>

              <SpotlightActions
                key={candidate.id}
                candidate={candidate}
                voted={isVoted(candidate.id)}
                hasPrev={hasPrev}
                hasNext={hasNext}
                onPrev={() => go(-1)}
                onNext={() => go(1)}
                onVote={() => onVote(candidate.id)}
              />
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}

function SpotlightBody({
  candidate,
  ranked,
  voted,
  onViewProfile,
}: {
  candidate: RankedCandidate;
  ranked: RankedCandidate[];
  voted: boolean;
  onViewProfile: (personId: string) => void;
}) {
  const { data: wiki, isLoading: wikiLoading } = useWikiSummary(candidate.wikiSlug);
  const leaderVotes = Math.max(ranked[0]?.seedVotes ?? 0, 1);
  const above = candidate.rank > 1 ? ranked[candidate.rank - 2] : null;
  const votesToPass = above ? above.seedVotes - candidate.seedVotes + 1 : 0;
  const progressPct = Math.max(4, Math.min(100, (candidate.seedVotes / leaderVotes) * 100));
  const socials = [
    ["x", candidate.xHandle],
    ["instagram", candidate.instagramHandle],
    ["tiktok", candidate.tiktokHandle],
    ["youtube", candidate.youtubeId],
  ].filter((entry): entry is [string, string] => !!entry[1]);

  return (
    <div className="flex min-h-full flex-col">
      {/* Portrait */}
      <div className="relative h-[46dvh] shrink-0 sm:h-[360px]">
        <div className="absolute inset-0 [&_*]:!rounded-none">
          <PersonAvatar
            name={candidate.displayName}
            avatar={candidate.avatar}
            imageSlug={candidate.imageSlug}
            imageContext="induction"
            size="xl"
            className="h-full w-full text-4xl"
          />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        {voted && (
          <div
            className={cn(
              "absolute right-4 top-[calc(max(0.75rem,var(--safe-area-inset-top,env(safe-area-inset-top,0px)))+3.25rem)] flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow-lg",
              SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS,
            )}
          >
            <Check className="h-3.5 w-3.5" />
            Voted
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
          <div className="mb-2 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold tabular-nums backdrop-blur-sm",
                candidate.rank === 1
                  ? "border-yellow-500/50 bg-yellow-500/20 text-yellow-300"
                  : "border-white/20 bg-black/40 text-white/90",
              )}
            >
              {candidate.rank === 1 && <Crown className="h-3 w-3" />}#{candidate.rank} in queue
            </span>
            <CategoryPill category={candidate.category} />
          </div>
          <DialogPrimitive.Title className="font-serif text-3xl font-bold leading-tight tracking-tight text-foreground">
            {candidate.displayName}
          </DialogPrimitive.Title>
          {wikiLoading ? (
            <Skeleton className="mt-2 h-4 w-40" />
          ) : wiki?.description ? (
            <p className="mt-1 text-sm text-muted-foreground first-letter:uppercase">{wiki.description}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 px-5 pb-5 pt-1">
        {/* Standing */}
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted/60 dark:bg-white/5">
            <motion.div
              className={cn(
                "h-full rounded-full",
                candidate.rank === 1
                  ? "bg-gradient-to-r from-yellow-500 to-yellow-300"
                  : "bg-gradient-to-r from-cyan-600 to-cyan-400",
              )}
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold tabular-nums">
              {candidate.seedVotes.toLocaleString("en-US")} {candidate.seedVotes === 1 ? "vote" : "votes"}
            </span>
            {above ? (
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
                <span className="truncate">
                  {votesToPass} to pass #{above.rank} {above.displayName}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
                <Crown className="h-3.5 w-3.5" />
                Leading the queue
              </span>
            )}
          </div>
        </div>

        {/* About */}
        {wikiLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-[92%]" />
            <Skeleton className="h-3.5 w-[70%]" />
          </div>
        ) : wiki?.extract ? (
          <div>
            <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">{wiki.extract}</p>
            <a
              href={wiki.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-cyan-600 hover:underline dark:text-cyan-400"
            >
              Wikipedia
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        ) : null}

        {(socials.length > 0 || candidate.personId) && (
          <div className="mt-auto flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {socials.map(([platform, handle]) => (
                <InlineProfileBadge key={platform} platform={platform} handle={handle} />
              ))}
            </div>
            {candidate.personId && (
              <button
                type="button"
                onClick={() => onViewProfile(candidate.personId!)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                data-testid="button-spotlight-profile"
              >
                <UserRound className="h-3.5 w-3.5" />
                Full profile
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SpotlightActions({
  candidate,
  voted,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onVote,
}: {
  candidate: RankedCandidate;
  voted: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onVote: () => void;
}) {
  // Only cue "next" after a vote cast on this card, not for pre-existing votes.
  const [justVoted, setJustVoted] = useState(false);
  const [sweep, setSweep] = useState(false);
  const sweepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => {
    if (sweepTimer.current) clearTimeout(sweepTimer.current);
  }, []);

  const handleVote = () => {
    if (voted) return;
    setJustVoted(true);
    setSweep(true);
    sweepTimer.current = setTimeout(() => setSweep(false), 700);
    onVote();
    // The vote button disables itself; hand focus to Next so Enter keeps going.
    if (hasNext) nextRef.current?.focus({ preventScroll: true });
  };

  const navButton =
    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/60 text-foreground transition-all hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500";

  return (
    <div className="relative z-10 shrink-0 border-t border-border/40 bg-background/95 px-4 pb-[max(0.75rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] pt-3 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={onPrev} disabled={!hasPrev} className={navButton} aria-label="Previous candidate">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={handleVote}
          disabled={voted}
          className={cn(
            "relative flex h-12 flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl text-sm font-semibold transition-all",
            voted
              ? cn("border disabled:cursor-default", SENTIMENT_POLL_SUPPORT_BUTTON_COMPACT_CLASS)
              : "bg-cyan-500 text-white shadow-lg shadow-cyan-500/25 hover:bg-cyan-400 active:scale-[0.98]",
          )}
          data-testid={`button-spotlight-vote-${candidate.id}`}
        >
          <AnimatePresence>
            {sweep && (
              <motion.span
                className="pointer-events-none absolute inset-0 skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                initial={{ x: "-100%" }}
                animate={{ x: "200%" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeInOut" }}
              />
            )}
          </AnimatePresence>
          {voted ? <Check className="h-4 w-4" /> : <Vote className="h-4 w-4" />}
          {voted ? "Voted" : "Vote to induct"}
        </button>
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          className={cn(
            navButton,
            justVoted && voted && hasNext && "border-cyan-500/60 bg-cyan-500/10 text-cyan-600 shadow-[0_0_18px_-4px] shadow-cyan-500/50 dark:text-cyan-400",
          )}
          aria-label="Next candidate"
          data-testid="button-spotlight-next"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
