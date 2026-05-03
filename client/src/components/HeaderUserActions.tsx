import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/UserMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";

interface HeaderUserActionsProps {
  /**
   * Visual density for the inner buttons. The dense PredictPage mobile
   * header sets this to "compact" so the bell sits at h-8 to match the
   * existing ScrollText icon size. Every other page uses "default".
   */
  bellSize?: "default" | "compact";
  /**
   * Optional override for the wrapping flex gap. PredictPage's mobile
   * cluster runs tighter (gap-2) than other pages (gap-3) so we expose
   * this rather than baking opinions into the wrapper.
   */
  className?: string;
}

/**
 * Right-side user-actions cluster that lives at the end of every page
 * header: `[Bell] [UserMenu]`.
 *
 * Pulled out into a single component so adding the bell didn't require
 * touching ~15 inlined headers. Page-specific extras (back button,
 * credits pill, ScrollText icon, logo) stay inline in their pages —
 * we only own the bell+avatar pair.
 *
 * The bell hides itself for logged-out users, so on guest pages this
 * collapses cleanly to just the UserMenu (which handles its own
 * logged-out vs logged-in state via the menu/profile toggle).
 */
export function HeaderUserActions({ bellSize = "default", className }: HeaderUserActionsProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <NotificationBell size={bellSize} />
      <UserMenu />
    </div>
  );
}
