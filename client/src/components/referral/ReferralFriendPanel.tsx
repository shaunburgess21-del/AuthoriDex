import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Share2, Users, ArrowRight } from "lucide-react";
import { CREDIT_ACTIONS, SIGNUP_CREDIT_GRANT } from "@shared/credit-config";
import { voxWord } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { glowClassFor } from "@/lib/gamification-content";
import { useReferralLink } from "@/hooks/useReferralLink";

// Reward numbers derive from credit-config so the /me card, modal, and
// How It Works Vox tab stay in lockstep with actual server award amounts.
const REFERRAL_SIGNUP_BONUS =
  CREDIT_ACTIONS.find((a) => a.key === "referral_signup_bonus")
    ?.proposedCredits ?? 0;
const REFERRAL_REWARD =
  CREDIT_ACTIONS.find((a) => a.key === "referral_completed")
    ?.proposedCredits ?? 0;
const REFERRED_USER_TOTAL = SIGNUP_CREDIT_GRANT + REFERRAL_SIGNUP_BONUS;

/** Chrome glow skin shared by the /me card and referral prompt modal. */
export const REFERRAL_PANEL_GLOW_CLASS = cn(
  "shadow-none pulse-card-flush",
  glowClassFor("xp"),
);

interface ReferralFriendPanelProps {
  title: string;
  showEarnMoreLink?: boolean;
  onEarnMoreClick?: () => void;
  className?: string;
  copyTestId?: string;
  shareTestId?: string;
  earnMoreTestId?: string;
}

/**
 * Shared chrome-glow referral panel. Mounted on /me (inside Card) and
 * inside ReferralPromptModal so both surfaces share the same visual
 * language: pulse-card-blue top lip, white border halo, outline share CTA.
 */
export function ReferralFriendPanel({
  title,
  showEarnMoreLink = false,
  onEarnMoreClick,
  className,
  copyTestId = "button-copy-referral",
  shareTestId = "button-share-referral",
  earnMoreTestId = "link-earn-more-vox",
}: ReferralFriendPanelProps) {
  const { referralUrl, copied, copy, share, stats } = useReferralLink();

  if (!referralUrl) return null;

  return (
    <div className={cn("space-y-4 p-6", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-slate-700 dark:text-white" />
          <h3 className="font-semibold truncate">{title}</h3>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs">
          {stats?.successfulReferrals ?? 0} successful
          {(stats?.pendingReferrals ?? 0) > 0
            ? ` · ${stats?.pendingReferrals} pending`
            : ""}
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
          data-testid={copyTestId}
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
        data-testid={shareTestId}
      >
        <Share2 className="h-4 w-4" />
        Share link
      </Button>

      {showEarnMoreLink && onEarnMoreClick ? (
        <button
          type="button"
          onClick={onEarnMoreClick}
          className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          data-testid={earnMoreTestId}
        >
          How to earn more Vox
          <ArrowRight className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
