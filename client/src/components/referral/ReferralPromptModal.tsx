import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Check, Share2, Gift, ArrowRight, Loader2 } from "lucide-react";
import { CREDIT_ACTIONS, SIGNUP_CREDIT_GRANT } from "@shared/credit-config";
import { voxWord } from "@/lib/currency";
import { useReferralLink } from "@/hooks/useReferralLink";

// Reward numbers derive from credit-config so this modal, the /me card,
// and the How It Works Vox tab stay in lockstep with the actual server
// award amounts. (Internal config keeps its "credit" naming; the
// user-facing label is "Vox".)
const REFERRAL_SIGNUP_BONUS =
  CREDIT_ACTIONS.find((a) => a.key === "referral_signup_bonus")
    ?.proposedCredits ?? 0;
const REFERRAL_REWARD =
  CREDIT_ACTIONS.find((a) => a.key === "referral_completed")
    ?.proposedCredits ?? 0;
const REFERRED_USER_TOTAL = SIGNUP_CREDIT_GRANT + REFERRAL_SIGNUP_BONUS;

export type ReferralPromptSource = "auto" | "out_of_vox" | "menu";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: ReferralPromptSource;
}

function headlineFor(source: ReferralPromptSource): string {
  switch (source) {
    case "out_of_vox":
      return "Out of Vox? Invite a friend";
    case "menu":
      return "Refer a friend";
    case "auto":
    default:
      return "Enjoying VoxDex? Invite a friend";
  }
}

/**
 * Reusable referral modal. Opened automatically by ReferralPromptGate
 * after an engagement threshold, from the out-of-Vox prediction banners,
 * and from the user menu. Reward copy + link/share affordances come from
 * the shared `useReferralLink` hook and `shared/credit-config.ts`.
 */
export function ReferralPromptModal({ open, onOpenChange, source }: Props) {
  const [, setLocation] = useLocation();
  const { referralUrl, isLoading, isError, hasCode, copied, copy, share, stats } =
    useReferralLink();

  const goToEarnMore = () => {
    onOpenChange(false);
    setLocation("/how-it-works?tab=credits");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            {headlineFor(source)}
          </DialogTitle>
          <DialogDescription>
            You both win. Your friend gets {voxWord(REFERRED_USER_TOTAL)} to
            start ({voxWord(SIGNUP_CREDIT_GRANT)} signup grant +{" "}
            {voxWord(REFERRAL_SIGNUP_BONUS)} bonus), and you get{" "}
            {voxWord(REFERRAL_REWARD)} when they make their first move.
          </DialogDescription>
        </DialogHeader>

        {stats && (stats.successfulReferrals > 0 || stats.pendingReferrals > 0) && (
          <div className="flex justify-center">
            <Badge variant="outline" className="text-xs">
              {stats.successfulReferrals} successful
              {stats.pendingReferrals > 0
                ? ` · ${stats.pendingReferrals} pending`
                : ""}
            </Badge>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : isError || !hasCode || !referralUrl ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating your referral link...
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
              <code className="flex-1 truncate text-xs font-mono text-muted-foreground">
                {referralUrl}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copy()}
                aria-label="Copy referral link"
                data-testid="button-copy-referral-modal"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>

            <Button
              className="w-full gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
              onClick={share}
              data-testid="button-share-referral-modal"
            >
              <Share2 className="h-4 w-4" />
              Share your link
            </Button>
          </>
        )}

        <button
          type="button"
          onClick={goToEarnMore}
          className="flex items-center justify-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          data-testid="link-earn-more-vox"
        >
          How to earn more Vox
          <ArrowRight className="h-3 w-3" />
        </button>
      </DialogContent>
    </Dialog>
  );
}
