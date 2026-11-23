import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { readStoredAuthUserId } from "@/lib/authSession";
import { isFirstVisitSession } from "@/lib/firstVisit";
import {
  browserLocalStorage,
  countNewlyResolvedPredictions,
  forgetReturningUser,
  readCachedReturningUserId,
  readResolvedLastSeenAt,
  rememberReturningUser,
  returningStripVisibleAtPaint,
  rowsFromPredictionsResponse,
  shouldStampResolvedLastSeen,
  stampResolvedLastSeenAt,
  xpRankProgress,
  xpRankProgressLabel,
  type StripStorage,
} from "@/lib/returningUserStrip";
import {
  DAILY_GOAL_UNAVAILABLE_LABEL,
  DAILY_VOTE_GOAL,
  ME_VOTES_QUERY_KEY,
  appendOptimisticMeVote,
  countMeVotesOnStreakDay,
  dailyGoalCopy,
  streakChipLabel,
  streakReminderActive,
  subscribeDailyVoteGoal,
  type DailyGoalCopy,
} from "@/lib/dailyVoteGoal";
import { queryClient } from "@/lib/queryClient";
import { newlyResolvedRevealRows, revealRowsFromPredictionsResponse } from "@/lib/resolvedReveal";
import { ResolvedPredictionsSheet } from "@/components/vote/ResolvedPredictionsSheet";
import { DailyGoalMark } from "@/components/vote/DailyGoalMark";
import { GoalInviteCard, GoalInviteReveal } from "@/components/vote/GoalInviteCard";
import {
  GOAL_INVITE_INTERVAL_MS,
  goalInviteOpen,
  readGoalInviteDismissed,
  readGoalInviteShownAt,
  writeGoalInviteDismissed,
  writeGoalInviteShownAt,
} from "@/lib/goalInvite";
import { cn } from "@/lib/utils";

/**
 * Orange streak badge from UserMenu. The copy here is "N-day streak"
 * (and the zero-streak prompt); the classes stay the menu's.
 * The amber reminder replaces this class only while the streak day is
 * still open and the voter has not voted on that UTC day.
 */
const STREAK_BADGE_CLASS =
  "shrink-0 text-[10px] px-1.5 py-0 border-orange-500/50 dark:border-orange-500/40 text-orange-500 dark:text-orange-300";

const STREAK_REMINDER_BADGE_CLASS =
  "shrink-0 text-[10px] px-1.5 py-0 border-amber-600/70 bg-amber-500/15 text-amber-800 dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200";

/** Same cyan family as the active Vote section chip. */
const RESOLVED_CHIP_CLASS =
  "shrink-0 cursor-pointer px-1.5 py-0 border-cyan-500/50 bg-cyan-500/25 text-[10px] text-cyan-600 hover:bg-cyan-500/30 dark:border-cyan-400/40 dark:bg-cyan-500/20 dark:text-cyan-400";

const ROW_GAP_CLASS = "gap-0.5 sm:gap-2";

type GoalFit = "full" | "mid" | "tight" | "tight-xp";

export interface ReturningUserStripLayoutProps {
  streakLabel: string;
  reminder: boolean;
  xpLabel: string;
  xpProgressPct: number;
  /** Null when today's count could not be loaded. Never a fake zero. */
  goal: DailyGoalCopy | null;
  goalCount: number;
  resolvedCount: number;
  onResolvedClick?: () => void;
  revealed?: boolean;
}

function goalVisibleLabel(goal: DailyGoalCopy, fit: GoalFit): string {
  if (fit === "full") return goal.full;
  if (fit === "mid") return goal.mid;
  return goal.tight;
}

function StripPieces({
  streakLabel,
  reminder,
  xpLabel,
  xpProgressPct,
  goal,
  goalCount,
  resolvedCount,
  onResolvedClick,
  truncateXp,
  fit,
  interactive,
}: ReturningUserStripLayoutProps & { truncateXp: boolean; fit: GoalFit; interactive: boolean }) {
  const showChip = resolvedCount > 0;
  const goalLabel = goal ? goalVisibleLabel(goal, fit) : "—";
  const goalAria = goal?.ariaLabel ?? DAILY_GOAL_UNAVAILABLE_LABEL;
  return (
    <>
      <Badge
        variant="outline"
        className={reminder ? STREAK_REMINDER_BADGE_CLASS : STREAK_BADGE_CLASS}
        data-testid={interactive ? "vote-return-strip-streak" : undefined}
        data-streak-reminder={reminder ? "amber" : "off"}
      >
        <Flame className="mr-1 h-3 w-3" aria-hidden />
        <span className="whitespace-nowrap">{streakLabel}</span>
      </Badge>
      <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
      <div
        className={cn(truncateXp ? "min-w-0 flex-1" : "min-w-max shrink-0")}
        data-testid={interactive ? "vote-return-strip-xp" : undefined}
      >
        <p
          className={cn(
            "whitespace-nowrap text-[10px] font-medium leading-none tracking-tighter text-foreground sm:text-xs sm:tracking-normal",
            truncateXp && "truncate",
          )}
        >
          {xpLabel}
        </p>
        <div
          className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-muted/50"
          role={interactive ? "progressbar" : undefined}
          aria-valuemin={interactive ? 0 : undefined}
          aria-valuemax={interactive ? 100 : undefined}
          aria-valuenow={interactive ? Math.round(xpProgressPct) : undefined}
          aria-label={interactive ? xpLabel : undefined}
          aria-hidden={interactive ? undefined : true}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
            style={{ width: `${xpProgressPct}%` }}
          />
        </div>
      </div>
      {/* Item 47: today's goal. The slot stays in this fixed row. */}
      <div
        data-testid={interactive ? "vote-return-strip-goal-slot" : undefined}
        className={cn("flex items-center gap-1", interactive && !truncateXp ? "flex-1" : "shrink-0")}
      >
        <DailyGoalMark
          count={goal?.done ? DAILY_VOTE_GOAL : goalCount}
          done={Boolean(goal?.done)}
          label={goalAria}
          exposed={interactive}
        />
        <span
          data-testid={interactive ? "vote-return-strip-goal" : undefined}
          data-goal-state={goal == null ? "unavailable" : goal.done ? "done" : "progress"}
          aria-hidden
          className="whitespace-nowrap text-[10px] font-medium leading-none tracking-tight text-foreground sm:text-xs sm:tracking-normal"
        >
          {goalLabel}
        </span>
        {interactive ? (
          <span className="sr-only" aria-live="polite">
            {goalAria}
          </span>
        ) : null}
      </div>
      <div data-testid={interactive ? "vote-return-strip-resolved-slot" : undefined} className="shrink-0">
        {showChip ? (
          interactive ? (
            <button
              type="button"
              onClick={onResolvedClick}
              data-testid="vote-return-strip-resolved"
              aria-label={`${resolvedCount} resolved predictions`}
              aria-haspopup="dialog"
              className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Badge variant="outline" className={RESOLVED_CHIP_CLASS}>
                <span className="whitespace-nowrap">{resolvedCount} resolved ›</span>
              </Badge>
            </button>
          ) : (
            <span className="inline-flex" aria-hidden>
              <Badge variant="outline" className={RESOLVED_CHIP_CLASS}>
                <span className="whitespace-nowrap">{resolvedCount} resolved ›</span>
              </Badge>
            </span>
          )
        ) : null}
      </div>
    </>
  );
}

/**
 * Fixed 44px row. The goal uses the longest copy that fits on one line
 * ("2 of 5 votes today", then "2 of 5", then "2/5"). The resolved chip
 * stays at the trailing edge. XP ellipsizes only when even "2/5" cannot
 * share the row with the streak chip and the resolved chip.
 */
export function ReturningUserStripLayout({
  streakLabel,
  reminder,
  xpLabel,
  xpProgressPct,
  goal,
  goalCount,
  resolvedCount,
  onResolvedClick,
  revealed = true,
}: ReturningUserStripLayoutProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const tightRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<GoalFit>("full");
  const pieceProps = {
    streakLabel,
    reminder,
    xpLabel,
    xpProgressPct,
    goal,
    goalCount,
    resolvedCount,
    onResolvedClick,
  };

  useLayoutEffect(() => {
    const row = rowRef.current;
    const full = fullRef.current;
    const mid = midRef.current;
    const tight = tightRef.current;
    if (!row || !full || !mid || !tight) return;
    const measure = () => {
      const style = window.getComputedStyle(row);
      const available =
        row.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
      const fits = (el: HTMLElement) => el.scrollWidth <= available + 1;
      const next: GoalFit = fits(full) ? "full" : fits(mid) ? "mid" : fits(tight) ? "tight" : "tight-xp";
      setFit((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [streakLabel, reminder, xpLabel, goal, goalCount, resolvedCount]);

  return (
    <div className="relative h-11">
      <div
        ref={rowRef}
        className={cn(
          "flex h-11 w-full min-w-0 items-center px-1 transition-opacity duration-300 sm:px-3",
          ROW_GAP_CLASS,
          revealed ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!revealed}
      >
        <StripPieces {...pieceProps} fit={fit} truncateXp={fit === "tight-xp"} interactive />
      </div>
      {/* Width probes only. inert plus aria-hidden keep the three copy
          lengths out of the accessibility tree and out of test queries
          that look for the visible row's roles and test ids. */}
      <div
        className="pointer-events-none h-0 overflow-hidden"
        aria-hidden="true"
        ref={(node) => {
          if (node) node.inert = true;
        }}
        data-strip-measure=""
      >
        <div ref={fullRef} className={cn("flex w-max items-center", ROW_GAP_CLASS)}>
          <StripPieces {...pieceProps} fit="full" truncateXp={false} interactive={false} />
        </div>
        <div ref={midRef} className={cn("flex w-max items-center", ROW_GAP_CLASS)}>
          <StripPieces {...pieceProps} fit="mid" truncateXp={false} interactive={false} />
        </div>
        <div ref={tightRef} className={cn("flex w-max items-center", ROW_GAP_CLASS)}>
          <StripPieces {...pieceProps} fit="tight" truncateXp={false} interactive={false} />
        </div>
      </div>
    </div>
  );
}

/**
 * Slim returning-user row on /vote. The slot is latched at first paint
 * so it never mounts after streak, XP, or predictions arrive. Values
 * fade in inside the same 44px box. Item 47 fills the reserved goal slot.
 */
export function ReturningUserStrip() {
  const { user, profile, loading, profileLoading } = useAuth();
  const storage = browserLocalStorage();
  const profileSettled = !loading && !profileLoading && (!user || profile != null);

  const [visibleAtPaint] = useState(() =>
    returningStripVisibleAtPaint({
      user,
      onboardingCompletedAt: profile?.onboardingCompletedAt,
      profileSettled,
      firstVisitSession: isFirstVisitSession(),
      persistedUserId: storage ? readStoredAuthUserId(storage) : null,
      cachedReturningUserId: storage ? readCachedReturningUserId(storage) : null,
    }),
  );

  const signedOut = !loading && !user;
  const onboardingRevoked = profile != null && !profile.onboardingCompletedAt;
  const shown = visibleAtPaint && !signedOut && !onboardingRevoked;

  useEffect(() => {
    const store = browserLocalStorage();
    if (!store) return;
    if (!loading && !user) {
      forgetReturningUser(store);
      return;
    }
    if (!user || !profile) return;
    if (profile.onboardingCompletedAt) rememberReturningUser(store, user.id);
    else forgetReturningUser(store);
  }, [loading, user, profile]);

  const predictions = useQuery({
    queryKey: ["/api/me/predictions"],
    enabled: shown && Boolean(user),
  });

  const votes = useQuery({
    queryKey: ME_VOTES_QUERY_KEY,
    enabled: shown && Boolean(user),
  });

  useEffect(() => {
    if (!shown || !user) return;
    return subscribeDailyVoteGoal(() => {
      void queryClient.cancelQueries({ queryKey: ME_VOTES_QUERY_KEY, exact: true }).then(() => {
        queryClient.setQueryData(ME_VOTES_QUERY_KEY, (current) => {
          if (current == null) return current;
          return appendOptimisticMeVote(current, new Date());
        });
        void queryClient.invalidateQueries({ queryKey: ME_VOTES_QUERY_KEY, exact: true });
      });
    });
  }, [shown, user]);

  const lastSeenRef = useRef<number | null | undefined>(undefined);
  if (lastSeenRef.current === undefined) {
    lastSeenRef.current = storage ? readResolvedLastSeenAt(storage) : null;
  }

  const predictionsSettled = predictions.isSuccess || predictions.isError;
  const votesSettled = votes.isSuccess || votes.isError;
  const ready = profile != null && predictionsSettled && votesSettled;
  // Values stay at opacity 0 for one frame so the crossfade runs inside
  // the box that was already painted, instead of popping in.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, [ready]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const resolvedCount = useMemo(() => {
    if (!predictions.isSuccess) return 0;
    return countNewlyResolvedPredictions(
      rowsFromPredictionsResponse(predictions.data),
      lastSeenRef.current ?? null,
    );
  }, [predictions.isSuccess, predictions.data]);

  const [chipCleared, setChipCleared] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [dismissedInvite, setDismissedInvite] = useState(false);
  const inviteUserId = user?.id ?? null;
  const inviteUserRef = useRef<string | null>(inviteUserId);
  const inviteHoldingRef = useRef(false);
  const sawGoalOpenRef = useRef(false);
  const [goalFlipped, setGoalFlipped] = useState(false);

  // A different account must not inherit the previous user's flip or dismiss.
  if (inviteUserRef.current !== inviteUserId) {
    inviteUserRef.current = inviteUserId;
    inviteHoldingRef.current = false;
    sawGoalOpenRef.current = false;
    setGoalFlipped(false);
    setDismissedInvite(false);
  }

  const votesToday = votes.isSuccess ? countMeVotesOnStreakDay(votes.data, now) : null;

  useEffect(() => {
    if (votesToday == null) return;
    const done = votesToday >= DAILY_VOTE_GOAL;
    if (!done) {
      sawGoalOpenRef.current = true;
      return;
    }
    if (sawGoalOpenRef.current) setGoalFlipped(true);
  }, [votesToday]);

  const goal = votesToday == null ? null : dailyGoalCopy(votesToday);
  const inviteStorage = browserLocalStorage();
  const inviteDismissed =
    dismissedInvite ||
    (inviteUserId != null && inviteStorage != null && readGoalInviteDismissed(inviteStorage, inviteUserId));
  const inviteShownAt =
    inviteUserId != null && inviteStorage != null ? readGoalInviteShownAt(inviteStorage, inviteUserId) : null;
  const inviteOpen = goalInviteOpen({
    signedIn: Boolean(user),
    userId: inviteUserId,
    flippedThisSession: goalFlipped,
    goalDone: goal?.done === true,
    dismissed: inviteDismissed,
    lastShownAt: inviteShownAt,
    now: Date.now(),
    alreadyOpen: inviteHoldingRef.current,
  });
  if (!inviteUserId || inviteDismissed || goal?.done !== true) inviteHoldingRef.current = false;
  else if (inviteOpen) inviteHoldingRef.current = true;

  useEffect(() => {
    if (!inviteOpen || !inviteUserId) return;
    const store = browserLocalStorage();
    if (!store) return;
    const existing = readGoalInviteShownAt(store, inviteUserId);
    const stampedAt = Date.now();
    if (existing != null && stampedAt - existing < GOAL_INVITE_INTERVAL_MS) return;
    writeGoalInviteShownAt(store, inviteUserId, stampedAt);
  }, [inviteOpen, inviteUserId]);

  const revealRows = useMemo(() => {
    if (!predictions.isSuccess) return [];
    return newlyResolvedRevealRows(
      revealRowsFromPredictionsResponse(predictions.data),
      lastSeenRef.current ?? null,
    );
  }, [predictions.isSuccess, predictions.data]);

  if (!shown) return null;

  const progress = xpRankProgress(profile?.xpPoints ?? 0);
  const xpLabel = xpRankProgressLabel(progress);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const reminder =
    votesToday != null &&
    streakReminderActive({
      now,
      timeZone,
      streak: profile?.currentStreak ?? 0,
      votesToday,
    });
  const streakLabel = streakChipLabel(profile?.currentStreak ?? 0, reminder);
  const showChip = ready && !chipCleared && resolvedCount > 0;

  const dismissInvite = () => {
    setDismissedInvite(true);
    inviteHoldingRef.current = false;
    const store = browserLocalStorage();
    if (inviteUserId && store) writeGoalInviteDismissed(store, inviteUserId);
  };

  const acknowledgeChip = () => {
    if (shouldStampResolvedLastSeen("results-sheet")) {
      const store: StripStorage | null = browserLocalStorage();
      const stampedAt = Date.now();
      if (store) stampResolvedLastSeenAt(store, stampedAt);
      lastSeenRef.current = stampedAt;
    }
    setChipCleared(true);
  };

  return (
    <>
      <Card
        className="relative mb-3 mt-1.5 h-11 overflow-hidden rounded-[12px] border-card-border bg-card/80 shadow-none md:rounded-xl"
        data-testid="vote-return-strip"
        aria-busy={!ready}
      >
        {ready ? (
          <ReturningUserStripLayout
            streakLabel={streakLabel}
            reminder={reminder}
            xpLabel={xpLabel}
            xpProgressPct={progress.progressPct}
            goal={goal}
            goalCount={votesToday ?? 0}
            resolvedCount={showChip ? resolvedCount : 0}
            onResolvedClick={() => {
              acknowledgeChip();
              setRevealOpen(true);
            }}
            revealed={revealed}
          />
        ) : (
          <div className="h-11" />
        )}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center gap-0.5 px-1 transition-opacity duration-300 sm:gap-2 sm:px-3",
            revealed ? "opacity-0" : "opacity-100",
          )}
          aria-hidden
        >
          <Skeleton className="h-5 w-[7.75rem] rounded-md" />
          <Skeleton className="h-5 w-[8.5rem] rounded-md" />
          <Skeleton className="ml-auto h-5 w-[5.5rem] rounded-md" />
        </div>
      </Card>
      <GoalInviteReveal open={inviteOpen}>
        <GoalInviteCard onDismiss={dismissInvite} />
      </GoalInviteReveal>
      <ResolvedPredictionsSheet open={revealOpen} onOpenChange={setRevealOpen} rows={revealRows} />
    </>
  );
}
