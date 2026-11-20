import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/UserMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";

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
  const { isLoggedIn, loading } = useAuth();
  const [, setLocation] = useLocation();
  const showAuth = !loading && !isLoggedIn;

  return (
    <div className={cn("flex shrink-0 items-center gap-1.5 sm:gap-2", className)}>
      {showAuth && (
        <>
          {/* Sign in drops only under 360px, where the logo, Sign up, and
              menu already fill the row. Sign up stays at every width. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 whitespace-nowrap px-2 text-xs max-[359px]:hidden"
            data-testid="button-header-sign-in"
            onClick={() => navigateToLogin(setLocation)}
          >
            Sign in
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 whitespace-nowrap px-2 text-xs"
            data-testid="button-header-sign-up"
            onClick={() => navigateToLogin(setLocation, { mode: "signup" })}
          >
            Sign up
          </Button>
        </>
      )}
      <NotificationBell size={bellSize} />
      <UserMenu />
    </div>
  );
}
