/**
 * Quick Vote entry-nudge eligibility. Shared between the QuickVoteHost
 * (which triggers/consumes the nudge) and HomePage (which suppresses the
 * WelcomeModal auto-toast when this higher-priority interrupt is eligible).
 */
import { canShowInterrupt } from "@/lib/interruptArbiter";
import { getLifetimeVoteCount, getSessionVoteCount } from "@/lib/funnelTelemetry";

export const QUICK_VOTE_NUDGE_ID = "quick_vote_pill";
export const QUICK_VOTE_NUDGE_LIFETIME_CAP = 6;

/** Suppress the nudge once the visitor is clearly activated. */
const ACTIVATION_VOTE_THRESHOLD = 5;

/**
 * Pure check (no consumption): can the Quick Vote pill still show for this
 * visitor? `isLoggedIn` comes from the caller's auth context.
 */
export function isQuickVoteNudgeEligible(isLoggedIn: boolean): boolean {
  if (isLoggedIn) return false;
  if (getLifetimeVoteCount() >= ACTIVATION_VOTE_THRESHOLD) return false;
  // Already engaged with a card this session — no interruption needed.
  if (getSessionVoteCount() >= 1) return false;
  return canShowInterrupt(QUICK_VOTE_NUDGE_ID, QUICK_VOTE_NUDGE_LIFETIME_CAP);
}
