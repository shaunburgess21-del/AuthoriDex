import { useState } from "react";
import { useLocation } from "wouter";
import { TrendingDown, TrendingUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/formatDate";
import { getKindMeta } from "@/lib/notifications/registry";
import type { NotificationRow } from "@/lib/notifications/types";
import {
  useDismissNotification,
  useDismissNotificationGroup,
  useMarkNotificationGroupRead,
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
  const markGroupRead = useMarkNotificationGroupRead();
  const dismiss = useDismissNotification();
  const dismissGroup = useDismissNotificationGroup();
  const [isExiting, setIsExiting] = useState(false);

  const meta = getKindMeta(notification.kind);
  const rawDirection =
    notification.kind === "favorite_hot_mover" &&
    notification.metadata &&
    typeof notification.metadata === "object" &&
    "direction" in notification.metadata
      ? notification.metadata.direction
      : null;
  const direction = rawDirection === "up" || rawDirection === "down" ? rawDirection : null;
  const Icon = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : meta.icon;
  const iconBgAccent =
    direction === "up"
      ? "bg-emerald-500/15 dark:bg-emerald-500/10"
      : direction === "down"
        ? "bg-red-500/15 dark:bg-red-500/10"
        : meta.bgAccent;
  const iconAccent =
    direction === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : direction === "down"
        ? "text-red-600 dark:text-red-400"
        : meta.accent;
  const isUnread = !notification.readAt;
  const isInternalLink = !!notification.href && notification.href.startsWith("/");
  // True when this row stands in for additional collapsed rows behind
  // it (`flattenNotifications` set `collapsedCount` and we have a
  // groupKey to address the bundle). The click/dismiss handlers route
  // to the group mutations so the user's interaction affects every
  // row they're standing in for, not just the visible head.
  const isCollapsedHead =
    (notification.collapsedCount ?? 0) > 0 && !!notification.groupKey;

  const handleClick = () => {
    if (isUnread) {
      if (isCollapsedHead && notification.groupKey) {
        markGroupRead.mutate(notification.groupKey);
      } else {
        markRead.mutate(notification.id);
      }
    }
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
    setTimeout(() => {
      if (isCollapsedHead && notification.groupKey) {
        dismissGroup.mutate(notification.groupKey);
      } else {
        dismiss.mutate(notification.id);
      }
    }, 120);
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
            iconBgAccent,
          )}
        >
          <Icon className={cn("h-4 w-4", iconAccent)} aria-hidden="true" />
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
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            {/* Collapse indicator. `collapsedCount` is set by
                `flattenNotifications` when this row represents the head
                of a groupKey bucket (typically the latest closing-soon
                milestone for a market). Renders inline with the
                timestamp so the user can see the row is hiding earlier
                rows without us pulling them into the list itself. */}
            {(notification.collapsedCount ?? 0) > 0 && (
              <span
                className={cn(
                  // Match the neighbouring timestamp's 10px font so the
                  // chip doesn't look like a different size class — 9px
                  // sat half a step below the timestamp and read as a
                  // typo at standard density.
                  "px-1.5 py-0.5 rounded-full text-[10px] font-medium",
                  "bg-muted text-muted-foreground/80",
                  "leading-none whitespace-nowrap",
                )}
                aria-label={`${notification.collapsedCount} earlier notification${
                  (notification.collapsedCount ?? 0) === 1 ? "" : "s"
                } in this group`}
                title={`${notification.collapsedCount} earlier notification${
                  (notification.collapsedCount ?? 0) === 1 ? "" : "s"
                } in this group`}
                data-testid={`notification-collapsed-pill-${notification.id}`}
              >
                +{notification.collapsedCount} earlier
              </span>
            )}
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatTimeAgo(notification.createdAt)}
            </span>
          </div>
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
        aria-label={
          isCollapsedHead
            ? `Dismiss this group of ${(notification.collapsedCount ?? 0) + 1} notifications`
            : "Dismiss notification"
        }
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
