import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMarketMuted, useToggleMarketMute } from "@/hooks/useNotifications";

interface MuteMarketToggleProps {
  /**
   * Database id of the market (NOT the slug). Mutes are keyed off the
   * shared `prediction_markets.id` so jackpot/H2H/Race/Updown/community
   * all use the same lookup column.
   */
  marketId: string;
  /**
   * Optional className passthrough. Default sizing is icon-only 32px so
   * the button slots into a 56px sticky detail-page header next to the
   * Share affordance without crowding.
   */
  className?: string;
  /** Used by Playwright + analytics. */
  testId?: string;
}

/**
 * Per-market mute toggle.
 *
 * Lives in the detail-page sticky header so the user has a single
 * obvious affordance to drop a market they don't want to hear about
 * anymore — without nuking the whole "predictions" notification
 * category. Composes with the category-level toggles in
 * Settings → Notifications.
 *
 * Hidden when the user is logged out (the mute concept is meaningless
 * without a server-side preference row to write to). The mute itself is
 * idempotent on the server, so repeat-presses stay safe.
 */
export function MuteMarketToggle({ marketId, className, testId = "button-mute-market" }: MuteMarketToggleProps) {
  const { user } = useAuth();
  const muted = useIsMarketMuted(marketId);
  const toggle = useToggleMarketMute();

  if (!user) return null;

  const handleClick = () => {
    const next = !muted;
    toggle.mutate(
      { marketId, muted: next },
      {
        onSuccess: () => {
          toast.success(
            next
              ? "Notifications muted for this market"
              : "Notifications unmuted",
            { duration: 1800 },
          );
        },
        onError: () => {
          toast.error("Couldn't update mute setting");
        },
      },
    );
  };

  const Icon = muted ? BellOff : Bell;
  const label = muted ? "Unmute notifications for this market" : "Mute notifications for this market";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-8 w-8 shrink-0 ${muted ? "text-amber-600 dark:text-amber-400" : ""} ${className ?? ""}`}
          onClick={handleClick}
          disabled={toggle.isPending}
          aria-label={label}
          aria-pressed={muted}
          data-testid={testId}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
