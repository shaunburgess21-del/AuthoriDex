import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Check, Share2, Users, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CREDIT_ACTIONS, SIGNUP_CREDIT_GRANT } from "@shared/credit-config";
import { voxWord } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { glowClassFor } from "@/lib/gamification-content";
import { useReferralLink } from "@/hooks/useReferralLink";

// Derive the referral copy numbers from credit-config so the marketing
// blurb in the card and the actual Vox awarded by the backend stay
// in lockstep. If the founders bump the signup bonus next quarter we
// just edit shared/credit-config.ts and the card reflects it. (Config
// file/type names keep their internal "credit" naming; only the user-
// facing label is "Vox".)
const REFERRAL_SIGNUP_BONUS =
  CREDIT_ACTIONS.find((a) => a.key === "referral_signup_bonus")
    ?.proposedCredits ?? 0;
const REFERRAL_REWARD =
  CREDIT_ACTIONS.find((a) => a.key === "referral_completed")
    ?.proposedCredits ?? 0;
const REFERRED_USER_TOTAL = SIGNUP_CREDIT_GRANT + REFERRAL_SIGNUP_BONUS;

const REFER_CARD_CLASS = cn(
  "p-6 shadow-none pulse-card-flush",
  glowClassFor("xp"),
);

/**
 * "Refer a Friend" card mounted on /me. Shows the user's referral
 * link, a copy + share affordance, and counters. The link/share/copy
 * logic + stats query live in the shared `useReferralLink` hook so this
 * card, the ReferralPromptModal, and the out-of-Vox banners never drift.
 *
 * Failure modes — the card stays mounted in all of them so the user
 * never sees it disappear mid-page:
 *
 *   - loading             → skeleton
 *   - error               → "Generating your referral link..." with a
 *                           single auto-retry after 2s, then a manual
 *                           Retry button
 *   - referralCode null (server failed to mint on demand) →
 *                           same generating state, with retry.
 *   - happy path          → full card with link, copy, share, counters
 */
export function ReferAFriendCard() {
  const { isLoggedIn } = useAuth();
  const {
    stats,
    referralUrl,
    hasCode,
    isLoading,
    isError,
    isFetching,
    copied,
    copy,
    share,
    refetch,
  } = useReferralLink();
  const [autoRetryDone, setAutoRetryDone] = useState(false);

  // Single auto-retry 2s after a missing-code or error response.
  // Most often this is a fresh post-overhaul login that triggered
  // the server's on-demand mint; the second call hits the populated
  // column and renders the happy path.
  useEffect(() => {
    if (autoRetryDone) return;
    if (isLoading || isFetching) return;
    const needsRetry = isError || !hasCode;
    if (!needsRetry) return;

    const t = setTimeout(() => {
      setAutoRetryDone(true);
      refetch();
    }, 2000);
    return () => clearTimeout(t);
  }, [autoRetryDone, isLoading, isFetching, isError, hasCode, refetch]);

  if (!isLoggedIn) return null;

  if (isLoading) {
    return (
      <Card className={cn(REFER_CARD_CLASS, "space-y-3")} data-testid="refer-a-friend-loading">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </Card>
    );
  }

  // Error / missing-code path. We keep the card mounted with a
  // friendly message so the /me layout doesn't reflow when the
  // referral system has a transient hiccup.
  if (isError || !hasCode || !referralUrl) {
    return (
      <Card
        className={cn(REFER_CARD_CLASS, "space-y-3")}
        data-testid="refer-a-friend-generating"
      >
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          <h3 className="font-semibold">Refer a Friend</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {isError
            ? "Couldn't load your referral link. We'll try again automatically."
            : "Generating your referral link..."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAutoRetryDone(false);
            refetch();
          }}
          disabled={isFetching}
          data-testid="button-retry-referral"
        >
          {isFetching ? "Trying again..." : "Retry"}
        </Button>
      </Card>
    );
  }

  return (
    <Card className={cn(REFER_CARD_CLASS, "space-y-4")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-700 dark:text-white" />
          <h3 className="font-semibold">Refer a Friend</h3>
        </div>
        <Badge variant="outline" className="text-xs">
          {stats?.successfulReferrals ?? 0} successful
          {(stats?.pendingReferrals ?? 0) > 0 ? ` · ${stats?.pendingReferrals} pending` : ""}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        Your friend gets {voxWord(REFERRED_USER_TOTAL)} to start (
        {voxWord(SIGNUP_CREDIT_GRANT)} signup grant + {voxWord(REFERRAL_SIGNUP_BONUS)}{" "}
        bonus). You get {voxWord(REFERRAL_REWARD)} when they make their
        first move.
      </p>

      <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
        <code className="flex-1 truncate text-xs font-mono text-muted-foreground">
          {referralUrl}
        </code>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void copy()}
          aria-label="Copy referral link"
          data-testid="button-copy-referral"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={share}
        data-testid="button-share-referral"
      >
        <Share2 className="h-4 w-4" />
        Share link
      </Button>
    </Card>
  );
}
