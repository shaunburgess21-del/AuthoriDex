import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReferralLink } from "@/hooks/useReferralLink";
import {
  ReferralFriendPanel,
  REFERRAL_PANEL_GLOW_CLASS,
} from "./ReferralFriendPanel";

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
 * and from the user menu. Visual design matches the /me Refer a Friend
 * card via the shared ReferralFriendPanel chrome glow skin.
 */
export function ReferralPromptModal({ open, onOpenChange, source }: Props) {
  const [, setLocation] = useLocation();
  const { isLoading, isError, hasCode, referralUrl } = useReferralLink();

  const goToEarnMore = () => {
    onOpenChange(false);
    setLocation("/how-it-works?tab=credits");
  };

  const showPanel = !isLoading && !isError && hasCode && referralUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-md gap-0 p-0 border-0",
          REFERRAL_PANEL_GLOW_CLASS,
        )}
      >
        <DialogTitle className="sr-only">{headlineFor(source)}</DialogTitle>
        <DialogDescription className="sr-only">
          Share your referral link to earn Vox when friends join and make their
          first move.
        </DialogDescription>
        {isLoading ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : !showPanel ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating your referral link...
          </div>
        ) : (
          <ReferralFriendPanel
            title={headlineFor(source)}
            showEarnMoreLink
            onEarnMoreClick={goToEarnMore}
            copyTestId="button-copy-referral-modal"
            shareTestId="button-share-referral-modal"
            earnMoreTestId="link-earn-more-vox"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
