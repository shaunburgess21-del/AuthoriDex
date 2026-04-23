import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  Newspaper,
  ExternalLink,
  Sparkles,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/formatDate";

/**
 * Companion to WhyTrendingCard. Explains why the Fame Index moved, grounded
 * in the person's own change24h/change7d plus a short list of supporting
 * headlines. Backend logic lives at /api/why-score-moved/:personId and reuses
 * the same eligibility + caching + rate-limit scaffolding as why-trending.
 */

type PrimaryDriver = "wiki" | "news" | "search" | "mass" | "stable";
type Direction = "up" | "down" | "flat";

interface WhyScoreMovedData {
  personId: string;
  personName: string;
  hasContext: boolean;
  summary?: string;
  primaryDriver?: PrimaryDriver;
  direction?: Direction;
  change24h?: number | null;
  change7d?: number | null;
  fameIndex?: number | null;
  sources?: Array<{ title: string; link: string; date?: string }>;
  fetchedAt: string;
  message?: string;
  cacheStatus?: string;
}

interface WhyScoreMovedCardProps {
  personId: string;
  personName: string;
  hotMover?: boolean;
}

const driverLabels: Record<PrimaryDriver, string> = {
  wiki: "Wikipedia surge",
  news: "News volume",
  search: "Search interest",
  mass: "Baseline popularity",
  stable: "Stable",
};

const driverBadgeClass: Record<PrimaryDriver, string> = {
  wiki: "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border-indigo-500/40",
  news: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40",
  search: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
  mass: "bg-slate-500/20 text-slate-600 dark:text-slate-400 border-slate-500/40",
  stable: "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/30",
};

function DirectionIcon({ direction }: { direction: Direction }) {
  if (direction === "up") return <ArrowUp className="h-3 w-3 text-emerald-500" />;
  if (direction === "down") return <ArrowDown className="h-3 w-3 text-red-500" />;
  return <ArrowRight className="h-3 w-3 text-muted-foreground" />;
}

function formatChange(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function WhyScoreMovedCard({ personId, personName: _personName, hotMover }: WhyScoreMovedCardProps) {
  const queryClient = useQueryClient();
  const url = hotMover
    ? `/api/why-score-moved/${personId}?hotMover=true`
    : `/api/why-score-moved/${personId}`;
  const queryKey = ["/api/why-score-moved", personId, hotMover ? "hot" : "default"];
  const { data, isLoading, error, isFetching } = useQuery<WhyScoreMovedData>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  const handleRetry = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-why-score-moved-loading">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Why the Score Moved</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 animate-pulse" />
            <span>Explaining the move...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-why-score-moved-error">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Why the Score Moved</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Couldn't load the score-move summary right now.</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRetry}
              disabled={isFetching}
              aria-label="Retry loading score-move summary"
              data-testid="button-retry-why-score-moved"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.hasContext) {
    const isGenerating = data?.cacheStatus === "LOCKED_COLD";
    if (isGenerating) {
      return (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-why-score-moved-pending">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-medium">Why the Score Moved</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                <span>Generating summary — check back in a few seconds.</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRetry}
                disabled={isFetching}
                aria-label="Refresh score-move summary"
                data-testid="button-refresh-why-score-moved"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }
    // Ineligible / insufficient history / gated — render nothing rather than an empty card.
    return null;
  }

  const driver = (data.primaryDriver ?? "stable") as PrimaryDriver;
  const direction = (data.direction ?? "flat") as Direction;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-why-score-moved">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Why the Score Moved</CardTitle>
          </div>
          <Badge
            variant="outline"
            className={`text-xs ${driverBadgeClass[driver]}`}
            data-testid="badge-score-moved-driver"
          >
            {driverLabels[driver]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 text-xs font-medium tabular-nums">
          <div className="flex items-center gap-1 text-muted-foreground" data-testid="text-score-moved-24h">
            <DirectionIcon direction={direction} />
            <span>24h: {formatChange(data.change24h)}</span>
          </div>
          <span className="text-border">•</span>
          <div className="flex items-center gap-1 text-muted-foreground" data-testid="text-score-moved-7d">
            <span>7d: {formatChange(data.change7d)}</span>
          </div>
        </div>

        {data.summary && (
          <p className="text-sm leading-relaxed text-foreground" data-testid="text-score-moved-summary">
            {data.summary}
          </p>
        )}

        {data.sources && data.sources.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Newspaper className="h-3 w-3" />
              <span>Supporting Headlines</span>
            </div>
            <div className="space-y-1.5">
              {data.sources.slice(0, 3).map((source, index) => (
                <a
                  key={index}
                  href={source.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                  data-testid={`link-score-moved-source-${index}`}
                >
                  <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 opacity-50 group-hover:opacity-100" />
                  <span className="line-clamp-2">{source.title}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            <span>AI-summarized</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span data-testid="text-score-moved-updated">{formatRelativeTime(data.fetchedAt)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
