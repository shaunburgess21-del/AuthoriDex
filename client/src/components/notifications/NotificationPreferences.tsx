import { Bell, BellOff, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CATEGORY_LABELS,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences as NotificationPreferencesRow,
} from "@/lib/notifications/types";
import {
  useNotificationPreferences,
  useNotificationMutes,
  useToggleMarketMute,
  type MutedMarket,
} from "@/hooks/useNotifications";

/**
 * Settings → Notifications card.
 *
 * Replaces the "Coming soon" stub the page used to render. Per the
 * plan, three columns:
 *   - In-app  : live and editable today.
 *   - Email   : pre-rendered, disabled, badge "Coming soon".
 *   - Push    : pre-rendered, disabled, badge "Coming soon".
 *
 * Storing all three columns now keeps the data model multi-channel
 * from day one — when we wire SendGrid / Web Push later we don't need
 * a follow-up migration or UI change beyond removing the disabled flag.
 *
 * Each row is one user-facing category (predictions / favorites /
 * social / account / system). The mapping to underlying preference
 * fields is mechanical (`<category><Channel>`).
 */
export function NotificationPreferences() {
  const { data, isLoading, update, isUpdating } = useNotificationPreferences();

  if (isLoading || !data) {
    return (
      <Card className="p-6" id="notifications">
        <div className="flex items-center gap-2 mb-6">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold">Notifications</h2>
        </div>
        <div className="space-y-4">
          {NOTIFICATION_CATEGORIES.map((cat) => (
            <div key={cat} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-40" />
              <div className="flex gap-3">
                <Skeleton className="h-5 w-9 rounded-full" />
                <Skeleton className="h-5 w-9 rounded-full" />
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6" id="notifications">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold">Notifications</h2>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Choose what we ping you about. You can always change this later.
      </p>

      {/* Column header. Hidden on small viewports — we render channel
          labels inline next to each switch on mobile to avoid an
          unreadable 4-column grid at 360px. */}
      <div className="hidden sm:grid grid-cols-[1fr_60px_60px_60px] items-end gap-4 pb-3 border-b text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Category</span>
        <span className="text-center">In-app</span>
        <span className="text-center">
          Email
          <Badge variant="outline" className="ml-1 text-[9px] font-normal py-0 px-1 leading-none">
            Soon
          </Badge>
        </span>
        <span className="text-center">
          Push
          <Badge variant="outline" className="ml-1 text-[9px] font-normal py-0 px-1 leading-none">
            Soon
          </Badge>
        </span>
      </div>

      <div className="divide-y">
        {NOTIFICATION_CATEGORIES.map((cat) => (
          <CategoryRow
            key={cat}
            category={cat}
            prefs={data}
            onChange={update}
            disabled={isUpdating}
          />
        ))}
      </div>

      <MutedMarketsSection />
    </Card>
  );
}

/**
 * Per-market mute list. Lives below the channel toggles because it's a
 * fine-grained "and also silence these specific markets" override on top
 * of the category preferences. Hidden entirely when the user has nothing
 * muted to keep the panel uncluttered for the 95% case.
 */
function MutedMarketsSection() {
  const { data, isLoading } = useNotificationMutes();
  const toggle = useToggleMarketMute();

  if (isLoading) return null;
  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="mt-6 pt-5 border-t">
        <div className="flex items-center gap-2 mb-1.5">
          <BellOff className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Muted markets</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          No markets muted. Tap the bell icon on any market to silence it
          without turning off the broader category.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 pt-5 border-t" data-testid="muted-markets-section">
      <div className="flex items-center gap-2 mb-1">
        <BellOff className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Muted markets</h3>
        <Badge variant="secondary" className="text-[10px] py-0 px-1.5 leading-none">
          {items.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        These markets won't trigger any notifications, even when the
        category above is on.
      </p>

      <ul className="divide-y rounded-md border">
        {items.map((item) => (
          <MutedMarketRow
            key={item.marketId}
            item={item}
            disabled={toggle.isPending}
            onUnmute={() =>
              toggle.mutate({ marketId: item.marketId, muted: false })
            }
          />
        ))}
      </ul>
    </div>
  );
}

interface MutedMarketRowProps {
  item: MutedMarket;
  onUnmute: () => void;
  disabled?: boolean;
}

function MutedMarketRow({ item, onUnmute, disabled }: MutedMarketRowProps) {
  // Map marketType to the canonical SPA detail-page path so the user
  // can click through to the muted market and re-engage if they
  // change their mind. Falls back to /predict for unknown types.
  const href = (() => {
    switch (item.marketType) {
      case "updown":
        return `/predict/updown/${item.marketId}`;
      case "h2h":
        return `/predict/h2h/${item.marketId}`;
      case "gainer":
      case "race":
        return `/predict/race/${item.marketId}`;
      case "binary":
      case "multi":
      case "updown_open":
      case "community":
        return item.marketSlug ? `/markets/${item.marketSlug}` : "/predict";
      case "jackpot":
        return `/predict#jackpot`;
      default:
        return "/predict";
    }
  })();

  return (
    <li className="flex items-center gap-3 p-3 text-sm">
      <BellOff className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <Link
        href={href}
        className="flex-1 min-w-0 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
      >
        <div className="flex items-center gap-1.5 truncate">
          <span className="font-medium truncate">{item.marketTitle}</span>
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        </div>
        {item.marketStatus && item.marketStatus !== "OPEN" && (
          <p className="text-[11px] text-muted-foreground capitalize">
            {item.marketStatus.toLowerCase().replace(/_/g, " ")}
          </p>
        )}
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={onUnmute}
        disabled={disabled}
        data-testid={`unmute-${item.marketId}`}
      >
        Unmute
      </Button>
    </li>
  );
}

interface CategoryRowProps {
  category: NotificationCategory;
  prefs: NotificationPreferencesRow;
  onChange: (patch: Partial<NotificationPreferencesRow>) => void;
  disabled?: boolean;
}

function CategoryRow({ category, prefs, onChange, disabled }: CategoryRowProps) {
  const inAppKey = `${category}InApp` as keyof NotificationPreferencesRow;
  const emailKey = `${category}Email` as keyof NotificationPreferencesRow;
  const pushKey = `${category}Push` as keyof NotificationPreferencesRow;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_60px_60px_60px] gap-3 sm:gap-4 py-4 items-center">
      <Label
        htmlFor={`pref-${category}-inapp`}
        className="text-sm font-medium cursor-pointer"
      >
        {CATEGORY_LABELS[category]}
      </Label>

      {/* Mobile: render label-and-switch pairs inline. Desktop: bare
          switches in their column slots. */}
      <div className="flex items-center justify-between sm:justify-center gap-2">
        <span className="sm:hidden text-xs text-muted-foreground">In-app</span>
        <Switch
          id={`pref-${category}-inapp`}
          checked={Boolean(prefs[inAppKey])}
          onCheckedChange={(checked) => onChange({ [inAppKey]: checked } as Partial<NotificationPreferencesRow>)}
          disabled={disabled}
          data-testid={`switch-pref-${category}-inapp`}
        />
      </div>

      <div className="flex items-center justify-between sm:justify-center gap-2">
        <span className="sm:hidden text-xs text-muted-foreground inline-flex items-center gap-1">
          Email
          <Badge variant="outline" className="text-[9px] font-normal py-0 px-1 leading-none">
            Soon
          </Badge>
        </span>
        <Switch
          checked={Boolean(prefs[emailKey])}
          onCheckedChange={() => {}}
          disabled
          aria-label={`Email notifications for ${CATEGORY_LABELS[category]} (coming soon)`}
        />
      </div>

      <div className="flex items-center justify-between sm:justify-center gap-2">
        <span className="sm:hidden text-xs text-muted-foreground inline-flex items-center gap-1">
          Push
          <Badge variant="outline" className="text-[9px] font-normal py-0 px-1 leading-none">
            Soon
          </Badge>
        </span>
        <Switch
          checked={Boolean(prefs[pushKey])}
          onCheckedChange={() => {}}
          disabled
          aria-label={`Push notifications for ${CATEGORY_LABELS[category]} (coming soon)`}
        />
      </div>
    </div>
  );
}
