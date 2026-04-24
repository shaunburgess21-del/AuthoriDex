import { Card } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Newspaper,
  Search,
  BookOpen,
  TrendingUp,
  Minus,
  Flame,
} from "lucide-react";
import { useLocation } from "wouter";
import { getDriverLabel, type TrendDriver } from "@/hooks/useTrendContext";
import type { WatchlistBiggestMover } from "@/hooks/useFavoritesDashboard";
import { cn } from "@/lib/utils";

interface WatchlistHeroCardProps {
  mover: WatchlistBiggestMover | null;
  isLoading?: boolean;
}

function DriverIcon({ driver }: { driver: TrendDriver | null }) {
  switch (driver) {
    case "NEWS":
      return <Newspaper className="h-3.5 w-3.5" />;
    case "SEARCH":
      return <Search className="h-3.5 w-3.5" />;
    case "WIKI":
      return <BookOpen className="h-3.5 w-3.5" />;
    default:
      return null;
  }
}

/**
 * Hero card spotlighting the single biggest 24h mover among a user's
 * favorites. If no favorite has moved materially, we render nothing so
 * the page doesn't feel filler-padded.
 */
export function WatchlistHeroCard({ mover, isLoading }: WatchlistHeroCardProps) {
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <Card
        className="relative overflow-hidden p-5 border-border/60"
        data-testid="watchlist-hero-loading"
      >
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
            <div className="h-3 w-48 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </Card>
    );
  }

  if (!mover) {
    return null;
  }

  const up = mover.change24h > 0;
  const down = mover.change24h < 0;
  const changeAbs = Math.abs(mover.change24h);
  const driverLabel = mover.driver
    ? getDriverLabel(mover.driver as TrendDriver)
    : null;

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-border/60 hover-elevate cursor-pointer",
        "bg-gradient-to-br from-primary/5 via-background to-background",
      )}
      onClick={() => setLocation(`/person/${mover.personId}`)}
      data-testid="watchlist-hero-card"
    >
      <div className="absolute inset-y-0 right-0 w-1/2 opacity-[0.04] pointer-events-none">
        <div className="h-full w-full bg-gradient-to-l from-primary/40 to-transparent" />
      </div>

      <div className="relative p-5 md:p-6 flex items-start gap-4">
        <div className="flex-shrink-0">
          <div className="relative">
            <Avatar className="h-16 w-16 md:h-20 md:w-20 ring-2 ring-border/50">
              {mover.avatar ? (
                <AvatarImage src={mover.avatar} alt={mover.name} />
              ) : (
                <AvatarFallback>
                  {mover.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              )}
            </Avatar>
            <div className="absolute -bottom-1 -right-1 rounded-full bg-background border border-border/60 p-1">
              <Flame className="h-3.5 w-3.5 text-orange-500" />
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Biggest mover · 24h
            </span>
          </div>

          <h3
            className="text-lg md:text-xl font-semibold truncate"
            data-testid="watchlist-hero-name"
          >
            {mover.name}
          </h3>

          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {mover.category && (
              <Badge variant="outline" className="text-xs">
                {mover.category}
              </Badge>
            )}
            {typeof mover.rank === "number" && (
              <span className="text-xs text-muted-foreground font-mono">
                #{mover.rank}
              </span>
            )}
            <div
              className={cn(
                "flex items-center gap-1 text-sm font-mono font-medium",
                up && "text-green-600 dark:text-green-400",
                down && "text-red-600 dark:text-red-400",
                !up && !down && "text-muted-foreground",
              )}
              data-testid="watchlist-hero-change"
            >
              {up && <TrendingUp className="h-3.5 w-3.5" />}
              {down && <TrendingUp className="h-3.5 w-3.5 rotate-180" />}
              {!up && !down && <Minus className="h-3.5 w-3.5" />}
              {up ? "+" : ""}
              {changeAbs.toFixed(1)}%
            </div>
          </div>

          {(driverLabel || mover.reasonTag) && (
            <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              {mover.driver && (
                <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-foreground/80">
                  <DriverIcon driver={mover.driver as TrendDriver} />
                  <span className="font-medium">{driverLabel}</span>
                </span>
              )}
              {mover.reasonTag && (
                <p className="line-clamp-2 pt-0.5">{mover.reasonTag}</p>
              )}
            </div>
          )}
        </div>

        <Button
          size="sm"
          variant="ghost"
          className="hidden md:inline-flex flex-shrink-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setLocation(`/person/${mover.personId}`);
          }}
          data-testid="watchlist-hero-view"
        >
          View
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </Card>
  );
}
