import { useState } from "react";
import { useLocation } from "wouter";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnonBudget } from "@/hooks/useAnonBudget";
import { useDeferredReady } from "@/hooks/useDeferredReady";
import { navigateToLogin } from "@/lib/authReturn";
import {
  ANON_FIRST_VOTE_NUDGE_COPY,
  ANON_FIRST_VOTE_NUDGE_DISMISS_KEY,
  shouldShowAnonFirstVoteNudge,
} from "@/lib/anonFirstVoteNudge";

function readDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ANON_FIRST_VOTE_NUDGE_DISMISS_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * Non-blocking strip after the first anonymous vote. Voting stays available
 * for the rest of the free budget — this never opens a modal or redirects.
 */
function AnonFirstVoteNudgeBody() {
  const budget = useAnonBudget();
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (
    !shouldShowAnonFirstVoteNudge({
      isAnonymous: budget.isAnonymous,
      used: budget.used,
      dismissed,
    })
  ) {
    return null;
  }

  return (
    <div
      className="border-b border-cyan-500/30 bg-cyan-500/10"
      role="region"
      aria-label="Save your votes"
      data-testid="anon-first-vote-nudge"
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
          Sign up
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
