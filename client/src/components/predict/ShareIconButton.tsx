import { Share2 } from "lucide-react";
import { sharePage } from "@/lib/share";
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
export function ShareIconButton({ title, className, testId = "button-share" }: ShareIconButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`h-8 w-8 shrink-0 ${className ?? ""}`}
      onClick={() => {
        void sharePage(title);
      }}
      aria-label="Share this market"
      data-testid={testId}
    >
      <Share2 className="h-4 w-4" />
    </Button>
  );
}
