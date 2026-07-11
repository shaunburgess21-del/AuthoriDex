import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useReferralLink } from "@/hooks/useReferralLink";
import { useReferralModal } from "./ReferralModalProvider";

// Surfaces the referral modal once the user is clearly engaged. The
// threshold is intentionally high (you've voted/predicted on ~25 cards)
// so the prompt feels earned, not pushy. Single named constant keeps it
// trivial to tune later.
const REFERRAL_PROMPT_THRESHOLD = 25;
const REFERRAL_PROMPT_ROUTES = new Set(["/", "/vote", "/predict", "/me"]);
const STORAGE_KEY = "voxdex_referral_prompt_seen";
const RE_SHOW_DAYS = 21;
const MS_PER_DAY = 86_400_000;

function shouldShow(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const ts = Number(raw);
    if (Number.isNaN(ts)) return true;
    return Date.now() - ts > RE_SHOW_DAYS * MS_PER_DAY;
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

/**
 * Engagement-triggered referral nudge. Mounted at app root alongside
 * InterestsGate. Fires `useReferralModal().open("auto")` exactly once per
 * re-show window when an engaged user lands on a main surface, deferring
 * to the interests onboarding flow and going silent once the user has
 * landed their first successful referral.
 */
export function ReferralPromptGate() {
  const { user, profile, profileLoading, loading } = useAuth();
  const [location] = useLocation();
  const { open } = useReferralModal();
  const { stats } = useReferralLink();
  const shownThisSession = useRef(false);

  useEffect(() => {
    if (loading || profileLoading) return;
    if (!user || !profile) return;
    if (shownThisSession.current) return;

    // Wait until the user has finished core onboarding so we don't stack
    // on top of the welcome / interests flows.
    if (!profile.onboardingCompletedAt) return;
    if (!REFERRAL_PROMPT_ROUTES.has(location)) return;

    // Defer to the interests picker: if interests are still unset and the
    // user hasn't dismissed that prompt yet, let it go first.
    const interestsPending =
      (profile.statedInterests?.length ?? 0) === 0 &&
      !profile.interestsPromptDismissedAt;
    if (interestsPending) return;

    // Already a successful referrer — no need to nag.
    if ((stats?.successfulReferrals ?? 0) > 0) return;

    const engaged =
      (profile.totalVotes ?? 0) + (profile.totalPredictions ?? 0) >=
      REFERRAL_PROMPT_THRESHOLD;
    if (!engaged) return;

    if (!shouldShow()) return;

    // Defer past the post-login "Welcome back" toast so the two don't stack.
    // Latch + markSeen run when we actually open — not when we schedule —
    // so a deps-driven re-run that cancels the timer does not burn the
    // once-per-window slot.
    const t = window.setTimeout(() => {
      if (shownThisSession.current) return;
      shownThisSession.current = true;
      markSeen();
      open("auto");
    }, 750);
    return () => window.clearTimeout(t);
  }, [loading, profileLoading, user, profile, location, stats, open]);

  return null;
}
