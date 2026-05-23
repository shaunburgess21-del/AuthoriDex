import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Settings, CheckCheck, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CATEGORY_SHORT_LABELS,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "@/lib/notifications/types";
import {
  flattenNotifications,
  useMarkAllNotificationsRead,
  useNotificationsList,
} from "@/hooks/useNotifications";
import { NotificationItem } from "./NotificationItem";
import { NotificationsEmptyState } from "./NotificationsEmptyState";

export interface NotificationsPanelProps {
  /** Called when the user clicks a row, "View all", or settings — lets
   *  the parent (popover/sheet) close itself. */
  onClose?: () => void;
  /** Display variant: 'popover' constrains height; 'sheet' fills available height. */
  variant?: "popover" | "sheet";
}

type Tab = "all" | "unread";

/**
 * The shared inbox UI. Used by both the desktop dropdown and the
 * mobile sheet. Owns local UI state (active tab, category filter) but
 * delegates all data and mutation concerns to the TanStack Query hooks.
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │ Notifications      [Mark all read] [⚙] │
 *   │ All  │  Unread                         │
 *   │ [chip][chip][chip][chip][chip]          │
 *   ├─────────────────────────────────────────┤
 *   │  [icon] Headline                3m      │
 *   │         Body line                       │
 *   ├─────────────────────────────────────────┤
 *   │  [icon] Headline                Yest.   │
 *   ├─────────────────────────────────────────┤
 *   │              View all  →                │
 *   └─────────────────────────────────────────┘
 */
export function NotificationsPanel({ onClose, variant = "popover" }: NotificationsPanelProps) {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>("all");
  const [category, setCategory] = useState<NotificationCategory | null>(null);
  const markAllRead = useMarkAllNotificationsRead();

  const list = useNotificationsList({
    category: category ?? undefined,
    unreadOnly: tab === "unread",
  });

  const items = useMemo(
    () => flattenNotifications(list.data?.pages),
    [list.data?.pages],
  );

  const isLoadingFirstPage = list.isLoading && items.length === 0;
  const showEmpty = !isLoadingFirstPage && items.length === 0;

  const handleNavigate = (path: string) => {
    setLocation(path);
    onClose?.();
  };

  return (
    <div
      className={cn(
        "flex flex-col w-full",
        variant === "popover" ? "max-h-[600px]" : "h-full",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "px-4 pt-4 pb-2 border-b",
          // SheetContent renders its own absolute top-right close button.
          // Reserve space so it does not overlap Settings on mobile.
          variant === "sheet" && "pr-14",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-base">Notifications</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              data-testid="button-notifications-mark-all-read"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Mark all read
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => handleNavigate("/me/settings#notifications")}
              aria-label="Notification settings"
              data-testid="button-notifications-settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex items-center gap-1">
          <TabButton active={tab === "all"} onClick={() => setTab("all")}>
            All
          </TabButton>
          <TabButton active={tab === "unread"} onClick={() => setTab("unread")}>
            Unread
          </TabButton>
        </div>

        {/* Category chips. Always rendered; the active state acts as
            the filter toggle. Clicking the same chip twice clears it. */}
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          <CategoryChip
            active={category === null}
            onClick={() => setCategory(null)}
          >
            Everything
          </CategoryChip>
          {NOTIFICATION_CATEGORIES.map((cat) => (
            <CategoryChip
              key={cat}
              active={category === cat}
              onClick={() => setCategory(category === cat ? null : cat)}
            >
              {CATEGORY_SHORT_LABELS[cat]}
            </CategoryChip>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingFirstPage ? (
          <div className="px-4 py-3 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : showEmpty ? (
          <NotificationsEmptyState unreadOnly={tab === "unread"} />
        ) : (
          <div className="divide-y divide-border/50">
            {items.map((row) => (
              <NotificationItem
                key={row.id}
                notification={row}
                onNavigate={onClose}
                swipeEnabled={variant === "sheet"}
              />
            ))}
            {list.hasNextPage && (
              <div className="p-3 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => list.fetchNextPage()}
                  disabled={list.isFetchingNextPage}
                  data-testid="button-notifications-load-more"
                >
                  {list.isFetchingNextPage ? "Loading..." : "Load older"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-2 py-2">
        <Button
          variant="ghost"
          className="w-full justify-between text-sm"
          onClick={() => handleNavigate("/me/notifications")}
          data-testid="link-notifications-archive"
        >
          <span>View all notifications</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      {children}
    </button>
  );
}

interface CategoryChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function CategoryChip({ active, onClick, children }: CategoryChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active
          ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40"
          : "border-border text-muted-foreground hover:bg-muted/60",
      )}
    >
      {children}
    </button>
  );
}
