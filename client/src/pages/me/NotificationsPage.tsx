import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
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
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { NotificationsEmptyState } from "@/components/notifications/NotificationsEmptyState";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Full notifications archive at `/me/notifications`.
 *
 * Shares the same data hooks as the bell popover, but renders a
 * full-page layout with category filtering, an All/Unread toggle, and
 * a "Load older" pager. Sits next to the existing /me/votes,
 * /me/predictions, /me/favorites pages and uses the same header
 * shell pattern (logo + nav + HeaderUserActions).
 */
type Tab = "all" | "unread";

export default function NotificationsArchivePage() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>("all");
  const [category, setCategory] = useState<NotificationCategory | null>(null);
  const markAllRead = useMarkAllNotificationsRead();

  const list = useNotificationsList({
    category: category ?? undefined,
    unreadOnly: tab === "unread",
  });

  // Archive view: show every notification row individually. The
  // panel/dropdown collapses by groupKey for terseness; the archive
  // deliberately doesn't so the per-milestone closing-soon history
  // (and any future groupKey-using kind) is fully browsable.
  const items = useMemo(
    () => flattenNotifications(list.data?.pages, { collapse: false }),
    [list.data?.pages],
  );

  const isLoadingFirstPage = list.isLoading && items.length === 0;
  const showEmpty = !isLoadingFirstPage && items.length === 0;

  if (!loading && !user) {
    navigateToLogin(setLocation);
    return null;
  }

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  setLocation("/me");
                }
              }}
              className="md:hidden"
              aria-label="Go back"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLocation("/")}
              data-testid="link-logo-home"
            >
              <VoxDexLogo size={32} />
              <span className="font-serif font-bold text-xl">VoxDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => setLocation("/#leaderboard")}>
                Leaderboard
              </Button>
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => setLocation("/vote")}>
                Vote
              </Button>
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => setLocation("/predict")}>
                Predict
              </Button>
            </div>
            <HeaderUserActions />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-2 sm:px-4 py-6 max-w-3xl">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Bell className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-serif font-bold truncate" data-testid="text-notifications-title">
                Notifications
              </h1>
              <p className="text-xs text-muted-foreground">
                Your full notification history
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              data-testid="button-archive-mark-all-read"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">Mark all read</span>
              <span className="sm:hidden">Read all</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/me/settings#notifications")}
              aria-label="Notification settings"
              data-testid="button-archive-settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center gap-1">
            <FilterPill active={tab === "all"} onClick={() => setTab("all")}>
              All
            </FilterPill>
            <FilterPill active={tab === "unread"} onClick={() => setTab("unread")}>
              Unread
            </FilterPill>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-hide">
            <ChipPill active={category === null} onClick={() => setCategory(null)}>
              Everything
            </ChipPill>
            {NOTIFICATION_CATEGORIES.map((cat) => (
              <ChipPill
                key={cat}
                active={category === cat}
                onClick={() => setCategory(category === cat ? null : cat)}
              >
                {CATEGORY_SHORT_LABELS[cat]}
              </ChipPill>
            ))}
          </div>
        </div>

        {/* List */}
        <Card className="overflow-hidden">
          {isLoadingFirstPage ? (
            <div className="p-4 space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : showEmpty ? (
            <NotificationsEmptyState unreadOnly={tab === "unread"} />
          ) : (
            <div className="divide-y">
              {items.map((row) => (
                <NotificationItem
                  key={row.id}
                  notification={row}
                  swipeEnabled={isMobile}
                />
              ))}
            </div>
          )}
        </Card>

        {list.hasNextPage && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              data-testid="button-archive-load-more"
            >
              {list.isFetchingNextPage ? "Loading..." : "Load older"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterPill({ active, onClick, children }: PillProps) {
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

function ChipPill({ active, onClick, children }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap",
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
