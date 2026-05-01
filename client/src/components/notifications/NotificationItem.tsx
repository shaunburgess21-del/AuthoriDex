import { useState } from "react";
import { useLocation } from "wouter";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/formatDate";
import { getKindMeta } from "@/lib/notifications/registry";
import type { NotificationRow } from "@/lib/notifications/types";
import {
  useDismissNotification,
  useMarkNotificationRead,
} from "@/hooks/useNotifications";

interface NotificationItemProps {
  notification: NotificationRow;
  /** Called after click navigation so the parent panel can close itself. */
  onNavigate?: () => void;
}

/**
 * One row in the inbox. Kind-aware icon/accent (driven by the registry),
 * relative timestamp on the right, unread indicator on the left.
 *
 * Click-through: marks read AND navigates if the row carries an href.
 * Dismiss: tucked into a hover-revealed corner button so it doesn't
 * compete visually with the row content. On touch devices the button
 * is always visible (no hover) — we keep it always rendered and rely
 * on opacity to gate hover-only display via Tailwind.
 */
export function NotificationItem({ notification, onNavigate }: NotificationItemProps) {
  const [, setLocation] = useLocation();
  const markRead = useMarkNotificationRead();
  const dismiss = useDismissNotification();
  const [isExiting, setIsExiting] = useState(false);

  const meta = getKindMeta(notification.kind);
  const Icon = meta.icon;
  const isUnread = !notification.readAt;
  const isInternalLink = !!notification.href && notification.href.startsWith("/");

  const handleClick = () => {
    if (isUnread) markRead.mutate(notification.id);
    if (notification.href) {
      if (isInternalLink) {
        setLocation(notification.href);
      } else {
        window.location.assign(notification.href);
      }
    }
    onNavigate?.();
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExiting(true);
    // Slight delay matches the fade-out feel — list filters out the
    // row the moment the dismiss mutation lands.
    setTimeout(() => dismiss.mutate(notification.id), 120);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        "group relative flex gap-3 px-4 py-3 transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isUnread ? "bg-blue-500/[0.04] dark:bg-blue-500/[0.06]" : "hover:bg-muted/40",
        isExiting && "opacity-0 transition-opacity duration-150",
      )}
      data-testid={`notification-item-${notification.kind}`}
    >
      {/* Left: kind-specific icon chip. The colored chip is the primary
          visual cue; the unread dot to the left of it is the secondary. */}
      <div className="flex items-start gap-2.5 shrink-0">
        {isUnread && (
          <span
            aria-hidden="true"
            className="mt-2 h-2 w-2 rounded-full bg-blue-500 shrink-0"
          />
        )}
        <div
          className={cn(
            "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
            meta.bgAccent,
          )}
        >
          <Icon className={cn("h-4 w-4", meta.accent)} aria-hidden="true" />
        </div>
      </div>

      {/* Center: title + body + relative time. min-w-0 so flex truncation
          works correctly when title is longer than the panel width. */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "text-sm leading-tight",
              isUnread ? "font-semibold" : "font-medium text-muted-foreground",
            )}
          >
            {notification.title}
          </p>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 mt-0.5">
            {formatTimeAgo(notification.createdAt)}
          </span>
        </div>
        {notification.body && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
            {notification.body}
          </p>
        )}
      </div>

      {/* Dismiss action.
          - Touch devices (no hover): always visible at 60% opacity so
            users can actually tap it.
          - Hover devices: hidden until row is hovered or focused. The
            `(hover:hover)` media query is the standard way to detect
            true hover-capable pointers. */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        className={cn(
          "absolute top-2 right-2 h-6 w-6 rounded-full",
          "flex items-center justify-center",
          "text-muted-foreground hover:text-foreground hover:bg-muted/80",
          "opacity-60",
          "[@media(hover:hover)]:opacity-0",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          "transition-opacity",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        data-testid={`notification-dismiss-${notification.id}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
