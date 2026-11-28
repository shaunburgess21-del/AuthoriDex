import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, Lock, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAnonBudget } from "@/hooks/useAnonBudget";
import { useFavorites } from "@/hooks/useFavorites";
import { navigateToLogin } from "@/lib/authReturn";
import { readStoredAuthUserId } from "@/lib/authSession";
import {
  browserLocalStorage,
  type StripStorage,
} from "@/lib/returningUserStrip";
import {
  ME_VOTES_QUERY_KEY,
  appendOptimisticMeVote,
  subscribeDailyVoteGoal,
} from "@/lib/dailyVoteGoal";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  WELCOME_ACCOUNT_GATE_LABEL,
  WELCOME_ALL_SET_LABEL,
  WELCOME_ALL_SET_MS,
  WELCOME_CHECKLIST_HEADLINE,
  WELCOME_FAVORITE_HREF,
  WELCOME_FREE_ACCOUNT_HINT,
  WELCOME_HOW_IT_WORKS_LABEL,
  WELCOME_JOIN_FREE_LABEL,
  WELCOME_PREDICT_HREF,
  WELCOME_STEPS,
  anonBudgetProvesVote,
  clearWelcomeOpen,
  favoriteListHasPerson,
  predictionListHasRow,
  profileProvesPartial,
  readWelcomeComplete,
  readWelcomeDeviceDismissed,
  readWelcomeOpen,
  readWelcomeUserDismissed,
  returningStripAllowed,
  voteListHasBallot,
  welcomeChecklistPhase,
  welcomeDoneCount,
  welcomeProgressLabel,
  welcomeStepNeedsAccount,
  writeWelcomeComplete,
  writeWelcomeDeviceDismissed,
  writeWelcomeOpen,
  writeWelcomeUserDismissed,
  type WelcomePhase,
  type WelcomeStorage,
} from "@/lib/welcomeChecklist";
import { ReturningUserStrip } from "@/components/vote/ReturningUserStrip";
import { WelcomeTourPreview } from "@/components/vote/WelcomeTourPreview";
import { readTourSeen, requestWelcomeTour } from "@/lib/welcomeTour";

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduce(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

function useTourSeen(): boolean {
  const [seen, setSeen] = useState(() => {
    const store = storageOrNull();
    return store ? readTourSeen(store) : false;
  });
  useEffect(() => {
    const sync = () => {
      const store = storageOrNull();
      setSeen(store ? readTourSeen(store) : false);
    };
    window.addEventListener("voxdex-welcome-tour-seen", sync);
    return () => window.removeEventListener("voxdex-welcome-tour-seen", sync);
  }, []);
  return seen;
}

function storageOrNull(): WelcomeStorage | null {
  const store: StripStorage | null = browserLocalStorage();
  return store;
}

interface WelcomeModel {
  phase: WelcomePhase;
  done: number;
  flags: { vote: boolean; predict: boolean; favorite: boolean };
  pending: boolean;
  signedOut: boolean;
  dismiss: () => void;
  openPredict: () => void;
  openFavorite: () => void;
  openJoin: () => void;
}

function useWelcomeModel(): WelcomeModel {
  const { user, profile, loading } = useAuth();
  const [, navigate] = useLocation();
  const store = storageOrNull();
  const persistedId = store ? readStoredAuthUserId(store) : null;
  const userId = user?.id ?? persistedId;
  const authSettled = !loading;
  // A stored session answers signed-in vs signed-out before the profile request.
  // No storage at all (private mode threw) waits until auth settles.
  const audienceKnown = authSettled || store != null;
  const signedIn = user ? true : authSettled ? false : Boolean(persistedId);

  const [dismissedNow, setDismissedNow] = useState(false);
  const [completedNow, setCompletedNow] = useState(false);
  const sawIncomplete = useRef(false);

  const deviceDismissed = dismissedNow || (store ? readWelcomeDeviceDismissed(store) : false);
  const userDismissed = Boolean(userId && store && readWelcomeUserDismissed(store, userId));
  const persistedComplete = completedNow || Boolean(userId && store && readWelcomeComplete(store, userId));
  const persistedOpen = Boolean(userId && store && readWelcomeOpen(store, userId));
  const partialFromProfile = profileProvesPartial(profile);

  const needsProgress = signedIn && !deviceDismissed && !userDismissed && !persistedComplete;

  const votes = useQuery({
    queryKey: ME_VOTES_QUERY_KEY,
    enabled: needsProgress,
  });
  const predictions = useQuery({
    queryKey: ["/api/me/predictions"],
    enabled: needsProgress,
  });
  const favorites = useFavorites();
  const budget = useAnonBudget();
  const anonVoted =
    !signedIn &&
    anonBudgetProvesVote(
      budget.isAnonymous ? { authenticated: false, used: budget.used } : null,
    );

  const hasVote = signedIn
    ? votes.isSuccess
      ? voteListHasBallot(votes.data)
      : null
    : anonVoted
      ? true
      : null;
  const hasPrediction = predictions.isSuccess ? predictionListHasRow(predictions.data) : null;
  const hasFavorite =
    needsProgress && favorites.isAuthenticated && !favorites.isLoading && !favorites.error
      ? favoriteListHasPerson(favorites.favorites)
      : null;

  if (hasVote === false || hasPrediction === false || hasFavorite === false) {
    sawIncomplete.current = true;
  }

  const phase = welcomeChecklistPhase({
    audienceKnown,
    signedIn,
    deviceDismissed,
    userDismissed,
    persistedComplete,
    persistedOpen,
    profileProvesPartial: partialFromProfile,
    hasVote,
    hasPrediction,
    hasFavorite,
    sawIncomplete: sawIncomplete.current,
  });

  useEffect(() => {
    if (!needsProgress || phase === "hidden") return;
    return subscribeDailyVoteGoal(() => {
      void queryClient.cancelQueries({ queryKey: ME_VOTES_QUERY_KEY, exact: true }).then(() => {
        queryClient.setQueryData(ME_VOTES_QUERY_KEY, (current) => {
          if (current == null) return [{ id: "optimistic-welcome", createdAt: new Date().toISOString() }];
          return appendOptimisticMeVote(current, new Date());
        });
        void queryClient.invalidateQueries({ queryKey: ME_VOTES_QUERY_KEY, exact: true });
      });
    });
  }, [needsProgress, phase]);

  useEffect(() => {
    if (!userId || !signedIn) return;
    const next = storageOrNull();
    if (!next) return;
    if (phase === "checklist" || phase === "all-set") writeWelcomeOpen(next, userId);
  }, [phase, signedIn, userId]);

  useEffect(() => {
    if (phase !== "hidden" || !signedIn || !userId) return;
    if (!hasVote || !hasPrediction || !hasFavorite || sawIncomplete.current) return;
    const next = storageOrNull();
    if (!next) return;
    writeWelcomeComplete(next, userId);
  }, [hasFavorite, hasPrediction, hasVote, phase, signedIn, userId]);

  useEffect(() => {
    if (phase !== "all-set" || !userId) return;
    const timer = window.setTimeout(() => {
      const next = storageOrNull();
      if (next) writeWelcomeComplete(next, userId);
      setCompletedNow(true);
    }, WELCOME_ALL_SET_MS);
    return () => window.clearTimeout(timer);
  }, [phase, userId]);

  const dismiss = () => {
    setDismissedNow(true);
    const next = storageOrNull();
    if (!next) return;
    if (signedIn && userId) {
      writeWelcomeUserDismissed(next, userId);
      clearWelcomeOpen(next, userId);
      return;
    }
    writeWelcomeDeviceDismissed(next);
  };

  const openPredict = () => {
    if (signedIn) {
      navigate(WELCOME_PREDICT_HREF);
      return;
    }
    navigateToLogin(navigate, { mode: "signup", reason: "predict_signup" });
  };

  const openFavorite = () => {
    if (signedIn) {
      navigate(WELCOME_FAVORITE_HREF);
      return;
    }
    navigateToLogin(navigate, { mode: "signup", reason: "favorite_signup" });
  };

  const openJoin = () => {
    navigateToLogin(navigate, { mode: "signup" });
  };

  return {
    phase,
    signedOut: !signedIn,
    done: welcomeDoneCount({ hasVote, hasPrediction, hasFavorite }),
    flags: {
      vote: hasVote === true,
      predict: hasPrediction === true,
      favorite: hasFavorite === true,
    },
    pending: signedIn && (hasVote == null || hasPrediction == null || hasFavorite == null),
    dismiss,
    openPredict,
    openFavorite,
    openJoin,
  };
}

function StepMark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color] duration-300 ease-out motion-reduce:transition-none",
        done
          ? "border-cyan-600/70 bg-cyan-500/15 text-cyan-700 dark:border-cyan-300/60 dark:bg-cyan-400/15 dark:text-cyan-200"
          : "border-border bg-transparent text-transparent",
      )}
    >
      <Check
        className={cn(
          "h-3 w-3 origin-center transition-transform duration-300 ease-out motion-reduce:transition-none",
          done ? "scale-100" : "scale-0",
        )}
        strokeWidth={2.5}
      />
    </span>
  );
}

export function WelcomeChecklistCard({
  phase,
  done,
  flags,
  pending,
  signedOut,
  onVote,
  onPredict,
  onFavorite,
  onJoin,
  onDismiss,
}: {
  phase: WelcomePhase;
  done: number;
  flags: { vote: boolean; predict: boolean; favorite: boolean };
  pending: boolean;
  signedOut: boolean;
  onVote: () => void;
  onPredict: () => void;
  onFavorite: () => void;
  onJoin: () => void;
  onDismiss: () => void;
}) {
  const tourSeen = useTourSeen();
  const signedOutNudge = signedOut && flags.vote && phase !== "all-set";
  const status =
    phase === "all-set" ? WELCOME_ALL_SET_LABEL : welcomeProgressLabel(done, { signedOutNudge });
  const checked = {
    vote: flags.vote || phase === "all-set",
    predict: flags.predict || phase === "all-set",
    favorite: flags.favorite || phase === "all-set",
  };
  const actions = {
    vote: onVote,
    predict: onPredict,
    favorite: onFavorite,
  };
  const showJoin = signedOutNudge;

  return (
    <section
      data-testid="vote-welcome-checklist"
      aria-labelledby="vote-welcome-heading"
      aria-busy={pending && phase !== "all-set"}
      className="relative rounded-[12px] border border-cyan-500/35 bg-card/80 px-3 pb-2.5 pt-3 text-card-foreground shadow-none dark:border-cyan-400/25 md:rounded-xl"
    >
      <div className="relative">
        <h2 id="vote-welcome-heading" className="pr-12 text-sm font-semibold leading-snug text-foreground">
          {WELCOME_CHECKLIST_HEADLINE}
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss welcome checklist"
          data-testid="vote-welcome-dismiss"
          className="absolute -right-2 -top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p
        className="mt-1 grid grid-cols-1 pr-12 text-xs font-medium leading-4 text-cyan-700 dark:text-cyan-300"
        data-testid="vote-welcome-progress"
      >
        <span className="col-start-1 row-start-1" aria-live="polite">
          {status}
        </span>
        {signedOut ? (
          <span className="invisible col-start-1 row-start-1 select-none" aria-hidden>
            {welcomeProgressLabel(1, { signedOutNudge: true })}
          </span>
        ) : null}
      </p>
      <div className="mt-3 h-32" data-testid="vote-welcome-tour-slot">
        <WelcomeTourPreview />
      </div>
      <ul className="mt-2" aria-label="Getting started steps">
        {WELCOME_STEPS.map((step) => {
          const isDone = checked[step.id];
          const accountGated = welcomeStepNeedsAccount(step.id, signedOut) && !isDone;
          return (
            <li key={step.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isDone}
                data-testid={`vote-welcome-step-${step.id}`}
                onClick={actions[step.id]}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-1.5 text-left text-sm leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isDone
                    ? "text-muted-foreground hover:bg-muted/60"
                    : "text-foreground hover:bg-cyan-500/10",
                )}
              >
                <StepMark done={isDone} />
                <span className="min-w-0 flex-1">{step.label}</span>
                {accountGated ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium leading-none text-muted-foreground"
                    data-testid={`vote-welcome-account-hint-${step.id}`}
                  >
                    <Lock className="h-3 w-3" aria-hidden />
                    <span className="whitespace-nowrap" aria-hidden>
                      {WELCOME_FREE_ACCOUNT_HINT}
                    </span>
                    <span className="sr-only">{WELCOME_ACCOUNT_GATE_LABEL}</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex min-h-8 items-center justify-between gap-2">
        <button
          type="button"
          data-testid="vote-welcome-how-it-works"
          onClick={() => requestWelcomeTour("link")}
          className="inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-cyan-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-cyan-300"
        >
          <StepMark done={tourSeen} />
          <span>{WELCOME_HOW_IT_WORKS_LABEL}</span>
        </button>
        {signedOut ? (
          <button
            type="button"
            onClick={onJoin}
            tabIndex={showJoin ? 0 : -1}
            aria-hidden={showJoin ? undefined : true}
            data-testid="vote-welcome-join-free"
            className={cn(
              "inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-cyan-200",
              showJoin ? "" : "invisible pointer-events-none",
            )}
          >
            {WELCOME_JOIN_FREE_LABEL}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Checklist or the returning-user strip, never both. The checklist keeps
 * its height while it is open so ticks and the done line do not reflow it,
 * then closes before the strip is allowed to mount.
 */
export function VoteWelcomeSlot({ onVote }: { onVote: () => void }) {
  const model = useWelcomeModel();
  const reduce = usePrefersReducedMotion();
  const shownPhase = useRef<WelcomePhase>(model.phase === "hidden" ? "checklist" : model.phase);
  if (model.phase !== "hidden") shownPhase.current = model.phase;
  const [present, setPresent] = useState(model.phase !== "hidden");
  const [expanded, setExpanded] = useState(model.phase !== "hidden");

  useEffect(() => {
    if (model.phase !== "hidden") {
      setPresent(true);
      if (reduce) {
        setExpanded(true);
        return;
      }
      const frame = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(frame);
    }
    setExpanded(false);
    if (reduce) {
      setPresent(false);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), 280);
    return () => window.clearTimeout(timer);
  }, [model.phase, reduce]);

  const showStrip = returningStripAllowed(true, model.phase) && !present;

  return (
    <>
      {present ? (
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
            expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="mb-3 mt-1.5">
              <WelcomeChecklistCard
                phase={model.phase === "hidden" ? shownPhase.current : model.phase}
                done={model.done}
                flags={model.flags}
                pending={model.pending}
                signedOut={model.signedOut}
                onVote={onVote}
                onPredict={model.openPredict}
                onFavorite={model.openFavorite}
                onJoin={model.openJoin}
                onDismiss={model.dismiss}
              />
            </div>
          </div>
        </div>
      ) : null}
      {showStrip ? <ReturningUserStrip /> : null}
    </>
  );
}
