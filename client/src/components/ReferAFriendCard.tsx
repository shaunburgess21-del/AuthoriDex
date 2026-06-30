import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useReferralLink } from "@/hooks/useReferralLink";
import {
  ReferralFriendPanel,
  REFERRAL_PANEL_GLOW_CLASS,
} from "@/components/referral/ReferralFriendPanel";

/**
 * "Refer a Friend" card mounted on /me. Shows the user's referral
 * link, a copy + share affordance, and counters. Happy-path visuals
 * live in ReferralFriendPanel so the card and ReferralPromptModal
 * never drift.
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
  const { hasCode, isLoading, isError, isFetching, referralUrl, refetch } =
    useReferralLink();
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
      <Card
        className={cn(REFERRAL_PANEL_GLOW_CLASS, "space-y-3 p-6")}
        data-testid="refer-a-friend-loading"
      >
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
        className={cn(REFERRAL_PANEL_GLOW_CLASS, "space-y-3 p-6")}
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
    <Card className={cn(REFERRAL_PANEL_GLOW_CLASS, "p-0")} data-testid="refer-a-friend">
      <ReferralFriendPanel title="Refer a Friend" />
    </Card>
  );
}
