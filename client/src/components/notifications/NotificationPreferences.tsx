import { Bell } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CATEGORY_LABELS,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences as NotificationPreferencesRow,
} from "@/lib/notifications/types";
import { useNotificationPreferences } from "@/hooks/useNotifications";

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
    </Card>
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
