import { Share2 } from "lucide-react";
import { sharePage, shareResultImage, type ShareSurface } from "@/lib/share";
import { Button } from "@/components/ui/button";

interface ShareIconButtonProps {
  /**
   * Title used by `navigator.share` on mobile and ignored on desktop
   * (clipboard fallback). Should already include the VoxDex suffix
   * the share-sheet preview reads, e.g. `"Jeff Bezos vs Peter Thiel on VoxDex"`.
   */
  title: string;
  /**
   * Optional className passthrough for sizing tweaks. Default size is
   * a 32px icon button so it slots into the 56px sticky detail-page header
   * next to back / time-left / user actions without crowding.
   */
  className?: string;
  /** Used by Playwright + analytics. */
  testId?: string;
  /**
   * Attribution surface for the share-funnel admin tab. Defaults to
   * "market" since the four detail variants where this lives are
   * all market pages, but the H2H / Up-Down / Race / community
   * variants pass through unchanged so a future per-variant surface
   * can be wired without an API change.
   */
  surface?: ShareSurface;
  /** OG image path. When set, share the result card and fall back to the link. */
  imagePath?: string | null;
}

/**
 * Compact share affordance for prediction-market detail pages.
 *
 * The community `MarketDetailPage` had a "Share" pill inline with the
 * source link. The native pages (Up/Down, H2H, Race) don't have an
 * equivalent meta row — their hero is dense — so the share affordance
 * lives in the sticky header instead, mirroring how X / Polymarket
 * surface it. Icon-only on every breakpoint keeps the header layout
 * consistent across the four detail variants.
 */
export function ShareIconButton({ title, className, testId = "button-share", surface = "market", imagePath }: ShareIconButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`h-8 w-8 shrink-0 ${className ?? ""}`}
      onClick={() => {
        if (imagePath) {
          void shareResultImage({ title, imagePath, surface });
          return;
        }
        void sharePage(title, { surface });
      }}
      aria-label="Share this market"
      data-testid={testId}
    >
      <Share2 className="h-4 w-4" />
    </Button>
  );
}
