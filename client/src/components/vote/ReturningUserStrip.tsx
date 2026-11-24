import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useUserStats } from "@/hooks/useGamification";
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
import {
  goalExplainerCopy,
  reduceStripExplainer,
  streakExplainerCopy,
  STRIP_XP_QUERY_KEY,
  xpExplainerCopy,
  type StripExplainerCopy,
  type StripExplainerId,
} from "@/lib/stripExplainers";
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

/** 10px — inside the 8–12px gap the three segments need to read apart. */
const ROW_GAP_CLASS = "gap-2.5";

const PILL_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 font-inherit leading-none";

const VALUE_PILL_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border/80 bg-muted/40 px-2.5 font-inherit leading-none text-foreground";

const EXPLAINER_BUTTON_CLASS =
  "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * Under the quick-vote stack (z-55) and the bottom nav (z-50), above the
 * page. collisionPadding keeps the popover out of the FAB zone so it
 * neither covers those controls nor sits underneath them.
 */
const EXPLAINER_POPOVER_CLASS = "z-[45] w-[min(18rem,calc(100vw-2rem))] p-3 text-left";

const EXPLAINER_COLLISION_PADDING = { top: 80, right: 16, bottom: 200, left: 16 };

type GoalFit = "full" | "mid" | "tight";

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
  streakCopy: StripExplainerCopy;
  xpCopy: StripExplainerCopy;
  goalCopy: StripExplainerCopy;
}

function goalVisibleLabel(goal: DailyGoalCopy, fit: GoalFit): string {
  if (fit === "full") return goal.full;
  if (fit === "mid") return goal.mid;
  return goal.tight;
}

function ExplainerControl({
  id,
  openId,
  onOpenChange,
  onDismiss,
  copy,
  className,
  testId,
  interactive,
  children,
  ...rest
}: {
  id: StripExplainerId;
  openId: StripExplainerId | null;
  onOpenChange: (id: StripExplainerId, next: boolean) => void;
  onDismiss: () => void;
  copy: StripExplainerCopy;
  className: string;
  testId?: string;
  interactive: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  if (!interactive) {
    return (
      <span className={className} {...rest}>
        {children}
      </span>
    );
  }
  const open = openId === id;
  const contentId = `vote-return-strip-explainer-${id}`;
  return (
    <Popover open={open} onOpenChange={(next) => onOpenChange(id, next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...rest}
          data-testid={testId}
          aria-expanded={open}
          aria-controls={contentId}
          onKeyDown={(event) => {
            if (event.key === "Escape") onDismiss();
          }}
          className={cn(className, EXPLAINER_BUTTON_CLASS)}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={contentId}
        data-testid={contentId}
        side="bottom"
        align="start"
        collisionPadding={EXPLAINER_COLLISION_PADDING}
        onEscapeKeyDown={onDismiss}
        className={EXPLAINER_POPOVER_CLASS}
      >
        <p className="text-sm font-semibold leading-snug text-foreground">{copy.title}</p>
        <p className="mt-1 text-sm font-medium leading-snug text-foreground">{copy.value}</p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{copy.body}</p>
      </PopoverContent>
    </Popover>
  );
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
  fit,
  interactive,
  openId,
  onOpenChange,
  onDismiss,
  streakCopy,
  xpCopy,
  goalCopy,
}: ReturningUserStripLayoutProps & {
  fit: GoalFit;
  interactive: boolean;
  openId: StripExplainerId | null;
  onOpenChange: (id: StripExplainerId, next: boolean) => void;
  onDismiss: () => void;
}) {
  const showChip = resolvedCount > 0;
  const goalLabel = goal ? goalVisibleLabel(goal, fit) : "—";
  const goalAria = goal?.ariaLabel ?? DAILY_GOAL_UNAVAILABLE_LABEL;
  const control = {
    openId,
    onOpenChange,
    onDismiss,
    interactive,
  };
  return (
    <>
      <ExplainerControl
        {...control}
        id="streak"
        copy={streakCopy}
        testId={interactive ? "vote-return-strip-streak" : undefined}
        data-streak-reminder={reminder ? "amber" : "off"}
        className={cn(PILL_CLASS, reminder ? STREAK_REMINDER_BADGE_CLASS : STREAK_BADGE_CLASS, "px-2")}
      >
        <Flame className="h-3 w-3" aria-hidden />
        <span className="whitespace-nowrap">{streakLabel}</span>
      </ExplainerControl>
      <ExplainerControl
        {...control}
        id="xp"
        copy={xpCopy}
        testId={interactive ? "vote-return-strip-xp" : undefined}
        className={cn(VALUE_PILL_CLASS, "flex-col items-stretch justify-center")}
      >
        <span className="whitespace-nowrap text-[10px] font-medium leading-none tracking-tighter sm:text-xs sm:tracking-normal">
          {xpLabel}
        </span>
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
      </ExplainerControl>
      {/* Item 47: today's goal. The slot stays in this fixed row. */}
      <ExplainerControl
        {...control}
        id="goal"
        copy={goalCopy}
        testId={interactive ? "vote-return-strip-goal-slot" : undefined}
        aria-label={goalAria}
        className={VALUE_PILL_CLASS}
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
          className="whitespace-nowrap text-[10px] font-medium leading-none tracking-tight sm:text-xs sm:tracking-normal"
        >
          {goalLabel}
        </span>
        {interactive ? (
          <span className="sr-only" aria-live="polite">
            {goalAria}
          </span>
        ) : null}
      </ExplainerControl>
      <div data-testid={interactive ? "vote-return-strip-resolved-slot" : undefined} className="ml-auto shrink-0">
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
 * Fixed 44px row. The three segments are equal-height pills with a 10px
 * gap. The goal uses the longest copy that fits ("2 of 5 votes today",
 * then "2 of 5", then "2/5"). Anything still wider than the card scrolls
 * instead of truncating. The resolved chip stays at the trailing edge
 * when there is room.
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
  streakCopy,
  xpCopy,
  goalCopy,
}: ReturningUserStripLayoutProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<GoalFit>("full");
  const [openId, setOpenId] = useState<StripExplainerId | null>(null);
  const onOpenChange = (id: StripExplainerId, next: boolean) => {
    setOpenId((current) => reduceStripExplainer(current, next ? { type: "open", id } : { type: "close", id }));
  };
  const onDismiss = () => {
    setOpenId((current) => reduceStripExplainer(current, { type: "dismiss" }));
  };
  const pieceProps = {
    streakLabel,
    reminder,
    xpLabel,
    xpProgressPct,
    goal,
    goalCount,
    resolvedCount,
    onResolvedClick,
    streakCopy,
    xpCopy,
    goalCopy,
    openId,
    onOpenChange,
    onDismiss,
  };

  useLayoutEffect(() => {
    const row = rowRef.current;
    const full = fullRef.current;
    const mid = midRef.current;
    if (!row || !full || !mid) return;
    const measure = () => {
      const style = window.getComputedStyle(row);
      const available =
        row.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
      const fits = (el: HTMLElement) => el.scrollWidth <= available + 1;
      const next: GoalFit = fits(full) ? "full" : fits(mid) ? "mid" : "tight";
      setFit((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [streakLabel, reminder, xpLabel, goal, goalCount, resolvedCount]);

  useEffect(() => {
    const row = rowRef.current;
    if (row) row.inert = !revealed;
  }, [revealed]);

  return (
    <div className="relative h-11">
      <div
        ref={rowRef}
        className={cn(
          "flex h-11 w-full min-w-0 flex-nowrap items-center overflow-x-auto overscroll-x-contain px-1 transition-opacity duration-300 [scrollbar-width:none] sm:px-3 [&::-webkit-scrollbar]:hidden",
          ROW_GAP_CLASS,
          revealed ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!revealed}
      >
        <StripPieces {...pieceProps} fit={fit} interactive />
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
          <StripPieces {...pieceProps} fit="full" interactive={false} />
        </div>
        <div ref={midRef} className={cn("flex w-max items-center", ROW_GAP_CLASS)}>
          <StripPieces {...pieceProps} fit="mid" interactive={false} />
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

  const stats = useUserStats(shown && Boolean(user));

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
      // The goal count moves optimistically. XP is a server total, so the
      // same successful vote refetches /api/gamification/stats instead of
      // guessing the award.
      void queryClient.invalidateQueries({ queryKey: STRIP_XP_QUERY_KEY });
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

  const xpPoints = stats.data?.xpPoints ?? profile?.xpPoints ?? 0;
  const progress = xpRankProgress(xpPoints);
  const xpLabel = xpRankProgressLabel(progress);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const streakCopy = streakExplainerCopy(profile?.currentStreak ?? 0, now, timeZone);
  const xpCopy = xpExplainerCopy(xpPoints);
  const goalCopy = goalExplainerCopy(votesToday);
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
            streakCopy={streakCopy}
            xpCopy={xpCopy}
            goalCopy={goalCopy}
          />
        ) : (
          <div className="h-11" />
        )}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center gap-2.5 px-1 transition-opacity duration-300 sm:px-3",
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
