import { useEffect, useState, type ReactNode } from "react";
import { Share2, X } from "lucide-react";
import { useReferralLink } from "@/hooks/useReferralLink";
import { goalDoneInviteCopy } from "@/lib/referralRewardCopy";
import { cn } from "@/lib/utils";

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

const ACTION_CLASS =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium text-cyan-600 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 dark:text-cyan-400";

/**
 * Height and opacity open under the strip. Reduced motion snaps
 * instead of animating, so the rows below still don't jump sideways.
 */
export function GoalInviteReveal({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      if (reduce) {
        setVisible(true);
        return;
      }
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        if (inner) cancelAnimationFrame(inner);
      };
    }
    setVisible(false);
    if (reduce) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), 300);
    return () => window.clearTimeout(timer);
  }, [open, reduce]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        visible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      data-testid="vote-goal-invite-reveal"
      data-invite-visible={visible ? "true" : "false"}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * One inline card. The reward sentence is the Refer a Friend copy.
 * Copy and Share use the existing referral link.
 */
export function GoalInviteCardView({
  onDismiss,
  onCopy,
  onShare,
  actionsEnabled = true,
}: {
  onDismiss: () => void;
  onCopy: () => void;
  onShare: () => void;
  actionsEnabled?: boolean;
}) {
  return (
    <div className="mb-3" data-testid="vote-goal-invite-wrap">
      <div
        className="rounded-[12px] border border-card-border bg-card/80 px-2 py-1.5 shadow-none md:rounded-xl md:px-3"
        data-testid="vote-goal-invite"
        role="region"
        aria-label="Invite a friend"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <p
            className="min-w-0 text-[11px] leading-snug text-foreground sm:flex-1 sm:text-xs"
            data-testid="vote-goal-invite-copy"
          >
            {goalDoneInviteCopy()}
          </p>
          <div className="flex shrink-0 items-center gap-0.5 self-end sm:self-auto">
            <button
              type="button"
              className={ACTION_CLASS}
              disabled={!actionsEnabled}
              onClick={onCopy}
              data-testid="vote-goal-invite-copy-link"
            >
              Copy link
            </button>
            <button
              type="button"
              className={ACTION_CLASS}
              disabled={!actionsEnabled}
              onClick={onShare}
              data-testid="vote-goal-invite-share"
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden />
              Share
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss invite"
              onClick={onDismiss}
              data-testid="vote-goal-invite-dismiss"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GoalInviteCard({ onDismiss }: { onDismiss: () => void }) {
  const { referralUrl, copy, share } = useReferralLink();
  return (
    <GoalInviteCardView
      onDismiss={onDismiss}
      onCopy={() => {
        void copy();
      }}
      onShare={share}
      actionsEnabled={Boolean(referralUrl)}
    />
  );
}
