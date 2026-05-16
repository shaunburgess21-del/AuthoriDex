import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBadgeIcon, getRarityStyle } from "@/lib/badge-icons";

interface BadgeToastProps {
  badgeName: string;
  description?: string | null;
  rarity: string;
  /** Lucide icon name from the badge config. */
  icon: string;
  /** Sonner-supplied dismiss handler. Wired to the close button. */
  onClose: () => void;
}

/**
 * Toast variant of the badge tile. Mirrors the StreakToast layout
 * (340px wide, rarity-tinted left border, icon on the left, headline
 * + chip + description on the right) so the celebration moments feel
 * like one family. Styled vs. the default Sonner so badge unlocks
 * read as a moment rather than a routine info ping.
 */
export function BadgeToast({
  badgeName,
  description,
  rarity,
  icon,
  onClose,
}: BadgeToastProps) {
  const Icon = getBadgeIcon(icon);
  const rarityStyle = getRarityStyle(rarity);

  return (
    <div
      role="status"
      data-testid="badge-toast"
      data-rarity={rarity}
      className={cn(
        // Cap at the StreakToast width on roomy screens but never
        // overflow narrow viewports — small phones (<360px) would
        // previously bleed past the toast container with the fixed
        // 340px width. The min() expression keeps a 1rem gutter.
        "w-[min(340px,calc(100vw-2rem))] sm:w-[360px] rounded-2xl border-2 p-4 relative bg-card shadow-lg",
        rarityStyle.border,
      )}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss badge toast"
        className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="badge-toast-close"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <span
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            rarityStyle.bgSoft,
            rarityStyle.accent,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="space-y-0.5 min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Badge Unlocked
          </p>
          <p className="text-[15px] font-semibold leading-tight">{badgeName}</p>
          <span
            className={cn(
              "inline-block uppercase tracking-wide rounded-full border bg-background/40 font-semibold text-[10px] px-2 py-0.5 mt-0.5",
              rarityStyle.chipBorder,
              rarityStyle.accent,
            )}
          >
            {rarityStyle.label}
          </span>
          {description && (
            <p className="text-xs text-muted-foreground pt-1.5 leading-snug">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
