import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useMarkNotificationsSeen,
  useNotificationCounts,
} from "@/hooks/useNotifications";
import { NotificationBellTrigger } from "./NotificationBellTrigger";
import { NotificationsPanel } from "./NotificationsPanel";

interface NotificationBellProps {
  /**
   * Trigger button size. `default` (larger touch target) matches hub headers;
   * `compact` (h-8 w-8) is optional for dense layouts.
   */
  size?: "default" | "compact";
  className?: string;
}

/**
 * Header bell + popover/sheet inbox. Mounted alongside `<UserMenu />`
 * via the shared `<HeaderUserActions />` wrapper. Hidden entirely for
 * logged-out users (nothing to notify).
 *
 * Open behavior:
 *   - Desktop (≥ md): DropdownMenu/Popover anchored right.
 *   - Mobile: right-side Sheet (mirrors UserMenu).
 *
 * Side effect on open: fires `POST /api/me/notifications/seen` so the
 * red badge clears the moment the panel renders. Rows themselves stay
 * bold/unread until the user clicks them — this seen vs read split
 * matches X / LinkedIn behavior and is the UX nudge from the plan.
 */
export function NotificationBell({ size = "default", className }: NotificationBellProps) {
  const { isLoggedIn } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const counts = useNotificationCounts();
  const markSeen = useMarkNotificationsSeen();

  // Whenever the panel opens AND there are unseen items, mark seen.
  // Tracked via a useEffect so we only fire once per open transition,
  // and only when there's actually something to mark (avoids needless
  // POST traffic every time the user toggles the panel).
  useEffect(() => {
    if (!open) return;
    if (!counts.data) return;
    if (counts.data.unseen <= 0) return;
    markSeen.mutate();
    // We deliberately depend only on `open` — `counts.data.unseen`
    // updates the moment markSeen succeeds, which would re-fire if
    // it were in the dep list. The mutation itself is idempotent
    // server-side, but minimizing duplicate calls keeps logs clean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!isLoggedIn) return null;

  const unread = counts.data?.unread ?? 0;
  const hasNew = (counts.data?.unseen ?? 0) > 0;
  const cap = counts.data?.cap ?? 99;

  if (isMobile) {
    // Mobile: the trigger lives outside the Sheet (sheet has no trigger
    // slot), so we drive `open` ourselves via the trigger's onClick.
    return (
      <>
        <NotificationBellTrigger
          unreadCount={unread}
          hasNew={hasNew}
          cap={cap}
          size={size}
          className={className}
          onClick={() => setOpen(true)}
        />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" className="w-[360px] max-w-[100vw] p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Notifications</SheetTitle>
              <SheetDescription>Your in-app notifications inbox</SheetDescription>
            </SheetHeader>
            <NotificationsPanel
              variant="sheet"
              onClose={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Desktop: Radix's DropdownMenuTrigger handles the click → open/close
  // wiring via Slot. Do NOT pass our own onClick here — adding one
  // double-toggles state (Radix sets open=true and our handler computes
  // !true → open=false in the same React batch, so the panel never
  // appears to open).
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <NotificationBellTrigger
          unreadCount={unread}
          hasNew={hasNew}
          cap={cap}
          size={size}
          className={className}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[400px] max-w-[calc(100vw-1rem)] p-0"
      >
        <NotificationsPanel
          variant="popover"
          onClose={() => setOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
