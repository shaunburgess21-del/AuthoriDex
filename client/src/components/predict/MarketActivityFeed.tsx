import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserSocialAvatar } from "@/components/UserSocialAvatar";
import { Badge } from "@/components/ui/badge";
import { PredictDetailSectionHeader } from "@/components/predict/PredictDetailSectionHeader";
import { Activity } from "lucide-react";
import { formatActivityAge } from "@/lib/formatDate";
import { voxWord } from "@/lib/currency";

interface MarketTrade {
  id: string;
  createdAt: string;
  actionType: "parimutuel" | "buy" | "sell";
  direction: string | null;
  entryLabel: string;
  shareCount: number | null;
  pricePerShare: number | null;
  stakeAmount: number;
  payoutAmount: number | null;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

interface RecentTradesResponse {
  trades: MarketTrade[];
  nextCursor: string | null;
}

interface MarketActivityFeedProps {
  marketId: string;
  /** Trim to N rows (default 20). Server caps at 100. */
  limit?: number;
  className?: string;
  /** Use predict-detail section header styling (matches Category Race page). */
  detailHeader?: boolean;
}

/**
 * Per-market activity feed (last N trades). Used on every market
 * detail page so traders see live depth + flow without leaving the
 * market. Polls every 15s while the page is visible — matches the
 * server's `Cache-Control` window so a hot market gets at most one
 * DB hit per browser per 15s, regardless of how many users are
 * watching.
 *
 * Privacy contract (enforced server-side): users with positions
 * hidden surface as "Private Predictor" with no avatar/username link.
 */
export function MarketActivityFeed({
  marketId,
  limit = 20,
  className,
  detailHeader = false,
}: MarketActivityFeedProps) {
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<RecentTradesResponse>({
    queryKey: ["/api/markets", marketId, "recent-trades", limit],
    queryFn: async () => {
      const res = await fetch(
        `/api/markets/${marketId}/recent-trades?limit=${limit}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch recent trades");
      return res.json();
    },
    enabled: !!marketId,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const trades = data?.trades ?? [];

  return (
    <Card className={`p-4 sm:p-5 ${className ?? ""}`}>
      {detailHeader ? (
        <PredictDetailSectionHeader
          icon={Activity}
          title="Recent Trades"
          subtitle="Latest market activity from the crowd"
          accent="predict"
          trailing={
            <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/50 ml-auto">
              Live
            </Badge>
          }
        />
      ) : (
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <h3 className="text-sm font-semibold">Recent Trades</h3>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider ml-auto">
            Live
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-3 w-52" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Couldn&apos;t load activity.
        </p>
      ) : trades.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No trades yet. Be the first to make a prediction.
        </p>
      ) : (
        <div className="space-y-2">
          {trades.map((t) => {
            const isAmmBuy = t.actionType === "buy";
            const isAmmSell = t.actionType === "sell";
            const dotColor = isAmmBuy
              ? "bg-emerald-500"
              : isAmmSell
                ? "bg-amber-500"
                : "bg-muted-foreground/50";
            const pricePct =
              t.pricePerShare != null
                ? `${Math.round(t.pricePerShare * 100)}%`
                : null;
            const shareCountLabel =
              t.shareCount != null
                ? Math.round(t.shareCount).toLocaleString()
                : null;
            const proceeds =
              isAmmSell && t.payoutAmount != null
                ? Math.round(t.payoutAmount)
                : null;
            const clickable = t.username !== null;
            return (
              <div key={t.id} className="flex items-start gap-3 py-1.5">
                <UserSocialAvatar
                  displayName={t.displayName}
                  avatarUrl={t.avatarUrl}
                  className="h-8 w-8 shrink-0"
                  onClick={
                    clickable
                      ? () => setLocation(`/u/${t.username}`)
                      : undefined
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${dotColor}`}
                      aria-hidden="true"
                    />
                    <button
                      className={`text-xs font-medium ${
                        clickable
                          ? "hover:underline cursor-pointer"
                          : "cursor-default"
                      }`}
                      onClick={() =>
                        clickable && setLocation(`/u/${t.username}`)
                      }
                      aria-disabled={!clickable}
                    >
                      {t.displayName}
                    </button>
                    <span className="text-[10px] text-muted-foreground">
                      {formatActivityAge(t.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-foreground line-clamp-2">
                    {isAmmBuy && shareCountLabel ? (
                      <>
                        bought{" "}
                        <span className="font-semibold">
                          {shareCountLabel} shares
                        </span>{" "}
                        of{" "}
                        <span className="font-semibold text-violet-600 dark:text-violet-400">
                          {t.entryLabel}
                        </span>
                        {pricePct ? <> @ {pricePct}</> : null}
                      </>
                    ) : isAmmSell && shareCountLabel ? (
                      <>
                        sold{" "}
                        <span className="font-semibold">
                          {shareCountLabel} shares
                        </span>{" "}
                        of{" "}
                        <span className="font-semibold text-violet-600 dark:text-violet-400">
                          {t.entryLabel}
                        </span>
                        {pricePct ? <> @ {pricePct}</> : null}
                      </>
                    ) : (
                      <>
                        backed{" "}
                        <span className="font-semibold text-violet-600 dark:text-violet-400">
                          {t.entryLabel}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {isAmmSell && proceeds != null
                      ? `${voxWord(proceeds)} in`
                      : voxWord(t.stakeAmount)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
