import { useRef, useState } from "react";
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
  useMarkNotificationGroupUnread,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotificationPreferences,
} from "@/hooks/useNotifications";
import { useIsMobile } from "@/hooks/use-mobile";
import { getRecentActivityMarketPath } from "@/lib/predict-display";
import { NotificationSwipeableRow } from "./NotificationSwipeableRow";

const DIRECTION_AWARE_KINDS = new Set([
  "favorite_hot_mover",
  "favorite_rank_cross",
  "position_move_alert",
]);

function getNotificationDirection(
  kind: string,
  metadata: NotificationRow["metadata"],
): "up" | "down" | null {
  if (!DIRECTION_AWARE_KINDS.has(kind)) return null;
  if (!metadata || typeof metadata !== "object" || !("direction" in metadata)) return null;
  const raw = metadata.direction;
  return raw === "up" || raw === "down" ? raw : null;
}

function resolveNotificationHref(notification: NotificationRow): string | null {
  if (!notification.href) return null;
  const marketType =
    notification.metadata &&
    typeof notification.metadata === "object" &&
    typeof notification.metadata.marketType === "string"
      ? notification.metadata.marketType
      : null;
  if (notification.entityType === "market" && notification.entityId && marketType) {
    const path = getRecentActivityMarketPath(null, marketType, notification.entityId);
    if (path !== "/predict") return path;
  }
  return notification.href;
}

interface NotificationItemProps {
  notification: NotificationRow;
  /** Called after click navigation so the parent panel can close itself. */
  onNavigate?: () => void;
  /** Enable mobile swipe-to-read / swipe-to-delete (parent gates by context). */
  swipeEnabled?: boolean;
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
 *
 * Mobile (`swipeEnabled`): swipe right = toggle read/unread, swipe left = delete
 * (directions respect Settings → invert swipe actions).
 */
export function NotificationItem({
  notification,
  onNavigate,
  swipeEnabled = false,
}: NotificationItemProps) {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const markRead = useMarkNotificationRead();
  const markUnread = useMarkNotificationUnread();
  const markGroupRead = useMarkNotificationGroupRead();
  const markGroupUnread = useMarkNotificationGroupUnread();
  const dismiss = useDismissNotification();
  const dismissGroup = useDismissNotificationGroup();
  const prefs = useNotificationPreferences();
  const [isExiting, setIsExiting] = useState(false);
  const swipeConsumedRef = useRef(false);

  const meta = getKindMeta(notification.kind);
  const direction = getNotificationDirection(notification.kind, notification.metadata);
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
  const resolvedHref = resolveNotificationHref(notification);
  const isInternalLink = !!resolvedHref && resolvedHref.startsWith("/");
  const isCollapsedHead =
    (notification.collapsedCount ?? 0) > 0 && !!notification.groupKey;

  const useSwipe = swipeEnabled && isMobile;

  const performMarkRead = () => {
    if (!isUnread) return;
    if (isCollapsedHead && notification.groupKey) {
      markGroupRead.mutate(notification.groupKey);
    } else {
      markRead.mutate(notification.id);
    }
  };

  const performMarkUnread = () => {
    if (isUnread) return;
    if (isCollapsedHead && notification.groupKey) {
      markGroupUnread.mutate(notification.groupKey);
    } else {
      markUnread.mutate(notification.id);
    }
  };

  const performToggleRead = () => {
    if (isUnread) {
      performMarkRead();
    } else {
      performMarkUnread();
    }
  };

  const performDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      if (isCollapsedHead && notification.groupKey) {
        dismissGroup.mutate(notification.groupKey);
      } else {
        dismiss.mutate(notification.id);
      }
    }, 120);
  };

  const handleClick = () => {
    if (swipeConsumedRef.current) {
      swipeConsumedRef.current = false;
      return;
    }
    performMarkRead();
    if (resolvedHref) {
      if (isInternalLink) {
        setLocation(resolvedHref);
      } else {
        window.location.assign(resolvedHref);
      }
    }
    onNavigate?.();
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    performDismiss();
  };

  const rowContent = (
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
      onPointerDown={() => {
        swipeConsumedRef.current = false;
      }}
      className={cn(
        "group relative flex gap-3 px-4 py-3 transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isUnread ? "bg-blue-500/[0.04] dark:bg-blue-500/[0.06]" : "hover:bg-muted/40",
        isExiting && "opacity-0 transition-opacity duration-150",
      )}
      data-testid={`notification-item-${notification.kind}`}
    >
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
            {(notification.collapsedCount ?? 0) > 0 && (
              <span
                className={cn(
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

  if (!useSwipe) {
    return rowContent;
  }

  return (
    <NotificationSwipeableRow
      invertSwipe={prefs.data?.invertNotificationSwipe ?? false}
      isUnread={isUnread}
      disabled={isExiting}
      onToggleRead={performToggleRead}
      onDismiss={performDismiss}
      onDragConsumed={() => {
        swipeConsumedRef.current = true;
      }}
    >
      {rowContent}
    </NotificationSwipeableRow>
  );
}
