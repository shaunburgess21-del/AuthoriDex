import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnonBudget } from "@/hooks/useAnonBudget";
import { useDeferredReady } from "@/hooks/useDeferredReady";
import { navigateToLogin } from "@/lib/authReturn";
import {
  ANON_FIRST_VOTE_NUDGE_COPY,
  ANON_FIRST_VOTE_NUDGE_DISMISS_KEY,
  anonNudgePlacement,
  shouldShowAnonFirstVoteNudge,
  type AnonNudgePlacement,
} from "@/lib/anonFirstVoteNudge";
import { browserLocalStorage } from "@/lib/returningUserStrip";
import {
  readWelcomeDeviceDismissed,
  subscribeWelcomeDeviceDismiss,
} from "@/lib/welcomeChecklist";
import { cn } from "@/lib/utils";

function readDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ANON_FIRST_VOTE_NUDGE_DISMISS_KEY) === "1";
  } catch {
    return true;
  }
}

function readWelcomeDismissed(): boolean {
  const store = browserLocalStorage();
  if (!store) return false;
  return readWelcomeDeviceDismissed(store);
}

/**
 * Above the bottom nav and just under the shared header, the strip is
 * fixed so it cannot push those layouts. On pages without that header it
 * stays in normal flow (`in-flow`) and reserves its height, so a logo or
 * title underneath is never covered. Auth screens hide it entirely.
 */
const PLACEMENT_CLASS: Record<Exclude<AnonNudgePlacement, "hidden">, string> = {
  "above-nav":
    "fixed inset-x-0 z-40 border-t bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-0",
  "under-header":
    "fixed inset-x-0 z-40 border-b top-[calc(4rem+var(--site-banner-height,0px)+var(--offline-banner-height,0px))]",
  "in-flow": "relative z-30 w-full border-b",
};

function AnonFirstVoteNudgeBody() {
  const budget = useAnonBudget();
  const [location, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [welcomeDismissed, setWelcomeDismissed] = useState(readWelcomeDismissed);

  useEffect(() => subscribeWelcomeDeviceDismiss(() => setWelcomeDismissed(true)), []);

  const show = shouldShowAnonFirstVoteNudge({
    isAnonymous: budget.isAnonymous,
    used: budget.used,
    dismissed,
  });
  const placement = anonNudgePlacement({
    show,
    pathname: location,
    deviceDismissed: welcomeDismissed,
  });
  if (placement === "hidden") return null;

  return (
    <div
      className={cn(
        "border-cyan-500/30 bg-cyan-500/10",
        PLACEMENT_CLASS[placement],
      )}
      role="region"
      aria-label="Save your votes"
      data-testid="anon-first-vote-nudge"
      data-nudge-placement={placement}
    >
      <div className="container mx-auto flex items-center gap-2 px-3 py-2 sm:px-4">
        <p className="min-w-0 flex-1 text-sm leading-snug">{ANON_FIRST_VOTE_NUDGE_COPY}</p>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 px-2.5 text-xs sm:px-3 sm:text-sm"
          data-testid="button-anon-nudge-sign-up"
          onClick={() => navigateToLogin(setLocation, { mode: "signup" })}
        >
          Join free
        </Button>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss sign-up note"
          data-testid="button-dismiss-anon-nudge"
          onClick={() => {
            try {
              window.localStorage.setItem(ANON_FIRST_VOTE_NUDGE_DISMISS_KEY, "1");
            } catch {
              /* still hide it for this view */
            }
            setDismissed(true);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Mounts after first paint so the budget request does not compete with the leaderboard. */
export function AnonFirstVoteNudge() {
  const ready = useDeferredReady(1600);
  if (!ready) return null;
  return <AnonFirstVoteNudgeBody />;
}
