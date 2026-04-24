import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Swords, TrendingUpIcon, Clock, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import type { WatchlistMarket } from "@/hooks/useFavoritesDashboard";
import { cn } from "@/lib/utils";

interface WatchlistMarketsCardProps {
  markets: WatchlistMarket[];
}

function formatClosingLabel(endAt: string | null, closeAt: string | null): string | null {
  const target = endAt || closeAt;
  if (!target) return null;
  const ts = new Date(target).getTime();
  if (isNaN(ts)) return null;
  const now = Date.now();
  const diffMs = ts - now;
  if (diffMs <= 0) return "Closing now";
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

/**
 * Lists active prediction markets (h2h + updown) that feature at least
 * one favorited person. Empty-state hidden by parent when there are no
 * markets, so this component always renders its full chrome.
 */
export function WatchlistMarketsCard({ markets }: WatchlistMarketsCardProps) {
  const [, setLocation] = useLocation();

  return (
    <Card
      className="p-4 border-border/60"
      data-testid="watchlist-markets-card"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">New markets for your favorites</h3>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono h-5">
          {markets.length}
        </Badge>
      </div>

      {markets.length === 0 ? (
        <p
          className="text-sm text-muted-foreground py-3"
          data-testid="watchlist-markets-empty"
        >
          No new markets involving your favorites right now.
        </p>
      ) : (
        <div className="space-y-2">
          {markets.map((m) => {
            const closing = formatClosingLabel(m.endAt, m.closeAt);
            const isH2h = m.marketType === "h2h";
            return (
              <button
                key={m.marketId}
                type="button"
                onClick={() => setLocation(`/markets/${m.slug}`)}
                className={cn(
                  "w-full text-left rounded-md px-3 py-2.5",
                  "bg-muted/30 hover:bg-muted/60 transition-colors",
                  "hover-elevate",
                )}
                data-testid={`watchlist-market-${m.marketId}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex-shrink-0 rounded-md p-1.5",
                      isH2h
                        ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                        : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
                    )}
                  >
                    {isH2h ? (
                      <Swords className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingUpIcon className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wider h-4 px-1">
                        {isH2h ? "H2H" : "Up/Down"}
                      </Badge>
                      {m.category && (
                        <span className="text-[10px] text-muted-foreground">
                          {m.category}
                        </span>
                      )}
                      {closing && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {closing}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-1 line-clamp-2">
                      {m.title}
                    </p>
                    {m.matchedPersonNames.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1 truncate">
                        Features: {m.matchedPersonNames.join(", ")}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 self-center" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {markets.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:text-foreground"
            onClick={() => setLocation("/predict")}
            data-testid="watchlist-markets-view-all"
          >
            Browse all markets
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      )}
    </Card>
  );
}
