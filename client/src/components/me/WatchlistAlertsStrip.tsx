import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Crown, TrendingUp, Trophy, Bell, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import type { WatchlistAlert } from "@/hooks/useFavoritesDashboard";
import { cn } from "@/lib/utils";

interface WatchlistAlertsStripProps {
  alerts: WatchlistAlert[];
}

function AlertIcon({ kind }: { kind: WatchlistAlert["kind"] }) {
  switch (kind) {
    case "rank_cross_top10":
      return <Crown className="h-4 w-4 text-amber-500" />;
    case "rank_cross_top50":
      return <TrendingUp className="h-4 w-4 text-blue-500" />;
    case "prediction_winning":
      return <Trophy className="h-4 w-4 text-green-500" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground" />;
  }
}

/**
 * Renders a compact row of alert chips derived from the watchlist
 * endpoint. Each alert deep-links to the relevant page (person or
 * market). Hidden when the alert list is empty to keep the dashboard
 * clean for new users.
 */
export function WatchlistAlertsStrip({ alerts }: WatchlistAlertsStripProps) {
  const [, setLocation] = useLocation();

  if (alerts.length === 0) {
    return null;
  }

  return (
    <Card
      className="p-4 border-border/60"
      data-testid="watchlist-alerts-strip"
    >
      <div className="flex items-center gap-2 mb-3">
        <Bell className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Alerts</h3>
        <Badge variant="outline" className="text-[10px] font-mono h-5">
          {alerts.length}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        {alerts.map((alert, i) => {
          const label = describeAlert(alert);
          const href = getAlertHref(alert);
          return (
            <button
              key={alertKey(alert, i)}
              type="button"
              onClick={() => href && setLocation(href)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-left",
                "bg-muted/30 hover:bg-muted/60 transition-colors",
                "hover-elevate",
              )}
              data-testid={`watchlist-alert-${alert.kind}`}
            >
              <div className="flex-shrink-0">
                <AlertIcon kind={alert.kind} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{label}</p>
              </div>
              {href && (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function describeAlert(alert: WatchlistAlert): string {
  switch (alert.kind) {
    case "rank_cross_top10":
      return `${alert.personName} broke into the Top 10 (from #${alert.previousRank} → #${alert.currentRank})`;
    case "rank_cross_top50":
      return `${alert.personName} entered the Top 50 (from #${alert.previousRank} → #${alert.currentRank})`;
    case "prediction_winning":
      return `Your "${alert.entryLabel}" pick on ${alert.marketTitle} is currently winning`;
    default:
      return "New alert";
  }
}

function getAlertHref(alert: WatchlistAlert): string | null {
  switch (alert.kind) {
    case "rank_cross_top10":
    case "rank_cross_top50":
      return `/person/${alert.personId}`;
    case "prediction_winning":
      return `/markets/${alert.marketSlug}`;
    default:
      return null;
  }
}

function alertKey(alert: WatchlistAlert, index: number): string {
  switch (alert.kind) {
    case "rank_cross_top10":
    case "rank_cross_top50":
      return `${alert.kind}-${alert.personId}-${index}`;
    case "prediction_winning":
      return `${alert.kind}-${alert.betId}`;
    default:
      return `alert-${index}`;
  }
}

/**
 * Export the describe helper so other surfaces (e.g. notifications page,
 * mobile sheet) can reuse the exact copy without reimplementing switch
 * logic.
 */
export { describeAlert as describeWatchlistAlert };
