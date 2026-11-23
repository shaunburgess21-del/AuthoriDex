import { useEffect, useMemo, useRef, useState } from "react";
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
  streakStripLabel,
  xpRankProgress,
  xpRankProgressLabel,
  type StripStorage,
} from "@/lib/returningUserStrip";
import { newlyResolvedRevealRows, revealRowsFromPredictionsResponse } from "@/lib/resolvedReveal";
import { ResolvedPredictionsSheet } from "@/components/vote/ResolvedPredictionsSheet";
import { cn } from "@/lib/utils";

/**
 * Orange streak badge from UserMenu. The copy here is "N-day streak"
 * (and the zero-streak prompt); the classes stay the menu's.
 */
const STREAK_BADGE_CLASS =
  "shrink-0 text-[10px] px-1.5 py-0 border-orange-500/50 dark:border-orange-500/40 text-orange-500 dark:text-orange-300";

/** Same cyan family as the active Vote section chip. */
const RESOLVED_CHIP_CLASS =
  "shrink-0 cursor-pointer px-1.5 py-0 border-cyan-500/50 bg-cyan-500/25 text-[10px] text-cyan-600 hover:bg-cyan-500/30 dark:border-cyan-400/40 dark:bg-cyan-500/20 dark:text-cyan-400";

/**
 * Slim returning-user row on /vote. The slot is latched at first paint
 * so it never mounts after streak, XP, or predictions arrive. Values
 * fade in inside the same 44px box.
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

  const lastSeenRef = useRef<number | null | undefined>(undefined);
  if (lastSeenRef.current === undefined) {
    lastSeenRef.current = storage ? readResolvedLastSeenAt(storage) : null;
  }

  const predictionsSettled = predictions.isSuccess || predictions.isError;
  const ready = profile != null && predictionsSettled;
  // Values stay at opacity 0 for one frame so the crossfade runs inside
  // the box that was already painted, instead of popping in.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, [ready]);

  const resolvedCount = useMemo(() => {
    if (!predictions.isSuccess) return 0;
    return countNewlyResolvedPredictions(
      rowsFromPredictionsResponse(predictions.data),
      lastSeenRef.current ?? null,
    );
  }, [predictions.isSuccess, predictions.data]);

  const [chipCleared, setChipCleared] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);

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
  const streakLabel = streakStripLabel(profile?.currentStreak ?? 0);
  const showChip = ready && !chipCleared && resolvedCount > 0;

  const acknowledgeChip = () => {
    if (shouldStampResolvedLastSeen("results-sheet")) {
      const store: StripStorage | null = browserLocalStorage();
      const now = Date.now();
      if (store) stampResolvedLastSeenAt(store, now);
      lastSeenRef.current = now;
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
      <div
        className={cn(
          "flex h-11 items-center gap-1 px-1.5 transition-opacity duration-300 sm:gap-2 sm:px-3",
          revealed ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!revealed}
      >
        {ready ? (
          <>
            <Badge variant="outline" className={STREAK_BADGE_CLASS} data-testid="vote-return-strip-streak">
              <Flame className="mr-1 h-3 w-3" aria-hidden />
              <span className="whitespace-nowrap">{streakLabel}</span>
            </Badge>
            <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
            <div className="shrink-0" data-testid="vote-return-strip-xp">
              <p className="whitespace-nowrap text-[10px] font-medium leading-none tracking-tight text-foreground sm:text-xs sm:tracking-normal">
                {xpLabel}
              </p>
              <div
                className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-muted/50"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress.progressPct)}
                aria-label={xpLabel}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
                  style={{ width: `${progress.progressPct}%` }}
                />
              </div>
            </div>
            {/* Item 47 mounts today's goal in this spacer. */}
            <div data-testid="vote-return-strip-goal-slot" className="min-w-0 flex-1" aria-hidden />
            <div data-testid="vote-return-strip-resolved-slot" className="shrink-0">
              {showChip ? (
                <button
                  type="button"
                  onClick={() => {
                    acknowledgeChip();
                    setRevealOpen(true);
                  }}
                  data-testid="vote-return-strip-resolved"
                  aria-label={`${resolvedCount} resolved predictions`}
                  aria-haspopup="dialog"
                  className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Badge variant="outline" className={RESOLVED_CHIP_CLASS}>
                    <span className="whitespace-nowrap">{resolvedCount} resolved ›</span>
                  </Badge>
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center gap-1 px-1.5 transition-opacity duration-300 sm:gap-2 sm:px-3",
          revealed ? "opacity-0" : "opacity-100",
        )}
        aria-hidden
      >
        <Skeleton className="h-5 w-[7.75rem] rounded-md" />
        <Skeleton className="h-5 w-[8.5rem] rounded-md" />
        <Skeleton className="ml-auto h-5 w-[5.5rem] rounded-md" />
      </div>
    </Card>
    <ResolvedPredictionsSheet
      open={revealOpen}
      onOpenChange={setRevealOpen}
      rows={revealRows}
    />
    </>
  );
}
