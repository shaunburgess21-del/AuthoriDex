import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/UserMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";

interface HeaderUserActionsProps {
  /**
   * Bell touch target + icon scale. Hub pages (Vote, Predict, Leaderboard, …)
   * use `"default"` for consistency. `"compact"` (h-8) remains available for
   * unusually dense toolbars if needed.
   */
  bellSize?: "default" | "compact";
  /**
   * Optional override for the wrapping flex gap between bell and UserMenu
   * (default gap-3).
   */
  className?: string;
}

/**
 * Right-side user-actions cluster that lives at the end of every page
 * header: `[Bell] [UserMenu]`.
 *
 * Pulled out into a single component so adding the bell didn't require
 * touching ~15 inlined headers. Page-specific extras (back button,
 * Vox pill, ScrollText icon, logo) stay inline in their pages —
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
