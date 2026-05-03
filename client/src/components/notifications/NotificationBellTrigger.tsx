import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";

export type NotificationBellTriggerProps = {
  unreadCount: number;
  /** True when there are notifications the user hasn't seen since last bell-open. */
  hasNew: boolean;
  /** Caps at 9+; rendered as the badge. */
  cap: number;
  /**
   * Render size. `compact` matches the existing 8x8 ScrollText icon used
   * on the dense PredictPage mobile header; `default` matches the 9x9
   * UserMenu avatar size on every other page.
   */
  size?: "default" | "compact";
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<"button">, "children">;

/**
 * The bell icon button itself. Stateless w.r.t. data fetching — receives
 * count + hasNew as props so it stays trivially testable and the parent
 * (NotificationBell) owns the wiring to TanStack Query / Realtime.
 *
 * Must use `forwardRef` and forward unknown DOM/Radix props (e.g. `onClick`,
 * `ref`) to the underlying `<button>` so `DropdownMenuTrigger asChild` works
 * on desktop. Mobile passes `onClick` in those props to open the Sheet.
 *
 * Visual rules (from design_guidelines.md):
 *   - No unread → outline `Bell`, no badge.
 *   - Unread   → filled `BellRing` + numeric badge ("9+" cap).
 *   - hasNew   → 1s ring pulse on the badge to mimic the "Live pulse"
 *                pattern used on the leaderboard.
 *
 * The pulse is one-shot on every transition into hasNew=true so the
 * user can't visually "miss" a notification arriving while the panel
 * is closed.
 */
export const NotificationBellTrigger = React.forwardRef<
  HTMLButtonElement,
  NotificationBellTriggerProps
>(function NotificationBellTrigger(
  { unreadCount, hasNew, cap, size = "default", className, type = "button", ...rest },
  ref,
) {
  const previousHasNewRef = useRef(false);
  const [showPulse, setShowPulse] = useState(false);

  useEffect(() => {
    if (hasNew && !previousHasNewRef.current) {
      setShowPulse(true);
      const t = setTimeout(() => setShowPulse(false), 1100);
      return () => clearTimeout(t);
    }
    previousHasNewRef.current = hasNew;
  }, [hasNew]);

  const Icon = unreadCount > 0 ? BellRing : Bell;
  const sizeClass = size === "compact" ? "h-8 w-8" : "h-9 w-9";
  const iconSize = size === "compact" ? "h-4 w-4" : "h-[18px] w-[18px]";
  const badgeText = unreadCount > 9 ? `${cap > 9 ? "9+" : String(cap)}` : String(unreadCount);

  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      className={cn(
        "relative inline-flex items-center justify-center rounded-full transition-colors",
        "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        sizeClass,
        className,
      )}
      aria-label={
        unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
      }
      data-testid="button-notifications-bell"
    >
      <Icon
        className={cn(
          iconSize,
          unreadCount > 0 ? "text-foreground" : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      {unreadCount > 0 && (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "absolute -top-0.5 -right-0.5 inline-flex items-center justify-center rounded-full",
              "bg-red-500 text-white text-[10px] leading-none font-semibold",
              "min-w-[16px] h-[16px] px-[3px] ring-2 ring-background",
            )}
          >
            {badgeText}
          </span>
          {/* Reuses the existing `attention-pulse-once` keyframe (defined in
              client/src/index.css for important-toggle highlighting) so the
              ring expansion plays once when a new notification arrives. */}
          {showPulse && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 inline-block min-w-[16px] h-[16px] rounded-full attention-pulse-once"
            />
          )}
        </>
      )}
      {/* Subtle dot if there's something new but no numeric unread (edge:
          a row was created+seen+read in the same tick). Uncommon but the
          dot keeps the feedback consistent with the pulse intent. */}
      {unreadCount === 0 && hasNew && (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 h-2 w-2 rounded-full bg-blue-500"
        />
      )}
    </button>
  );
});

NotificationBellTrigger.displayName = "NotificationBellTrigger";
