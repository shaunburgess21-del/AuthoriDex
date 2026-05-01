import { BellOff } from "lucide-react";

interface NotificationsEmptyStateProps {
  /** When true, message is tailored for the "Unread" filter being active. */
  unreadOnly?: boolean;
}

export function NotificationsEmptyState({ unreadOnly }: NotificationsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="h-14 w-14 rounded-full bg-muted/60 flex items-center justify-center mb-4">
        <BellOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="font-semibold text-sm">
        {unreadOnly ? "No unread notifications" : "You're all caught up"}
      </p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
        {unreadOnly
          ? "Switch to All to see your full notification history."
          : "We'll let you know when your predictions resolve, your favorites move, or someone replies to you."}
      </p>
    </div>
  );
}
