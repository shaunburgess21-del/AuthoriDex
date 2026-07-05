import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBadgeIcon, getRarityStyle } from "@/lib/badge-icons";

/** Sonner `--width` + host CSS — match glass vote toast slot (356px cap, 1rem mobile gutter). */
export const BADGE_TOAST_WIDTH_CSS = "min(356px, calc(100vw - 1rem))";

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
 * (vote-toast-width slot, rarity-tinted left border, icon on the left,
 * headline + description on the right) so the celebration moments feel
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
        // Fill the Sonner host slot (see BADGE_TOAST_WIDTH_CSS) so the
        // card matches glass vote toast width on mobile.
        "w-full max-w-[min(356px,calc(100vw-1rem))] rounded-2xl border-2 p-4 relative bg-card shadow-lg",
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
          {description && (
            <p className="text-xs text-muted-foreground leading-snug">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
