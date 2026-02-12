import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, ExternalLink, Clock, Newspaper, Sparkles, RefreshCw, AlertCircle } from "lucide-react";

interface WhyTrendingData {
  personId: string;
  personName: string;
  hasContext: boolean;
  summary?: string;
  category?: string;
  topHeadline?: string;
  sources?: Array<{ title: string; link: string; date?: string }>;
  fetchedAt: string;
  message?: string;
  cacheStatus?: string;
}

interface WhyTrendingCardProps {
  personId: string;
  personName: string;
  hotMover?: boolean;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const categoryColors: Record<string, string> = {
  "Politics": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "Business": "bg-green-500/20 text-green-400 border-green-500/30",
  "Entertainment": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "Sports": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "Technology": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "Legal": "bg-red-500/20 text-red-400 border-red-500/30",
  "Personal Life": "bg-pink-500/20 text-pink-400 border-pink-500/30",
  "Controversy": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "General News": "bg-slate-500/20 text-slate-400 border-slate-500/30",
  "In The News": "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export function WhyTrendingCard({ personId, personName, hotMover }: WhyTrendingCardProps) {
  const queryClient = useQueryClient();
  const url = hotMover ? `/api/why-trending/${personId}?hotMover=true` : `/api/why-trending/${personId}`;
  const queryKey = ['/api/why-trending', personId, hotMover ? 'hot' : 'default'];
  const { data, isLoading, error, isFetching } = useQuery<WhyTrendingData>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch');
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
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-why-trending-loading">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Why They're Trending</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3 animate-pulse" />
            <span>Generating AI summary...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-why-trending-error">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Why They're Trending</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Couldn't load the trending summary right now.</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRetry}
              disabled={isFetching}
              data-testid="button-retry-why-trending"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
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
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-why-trending-pending">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-medium">Why They're Trending</CardTitle>
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
                data-testid="button-refresh-why-trending"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-why-trending-empty">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Why They're Trending</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="text-no-driver">
            No clear driver found in the last 24h.
          </p>
        </CardContent>
      </Card>
    );
  }

  const categoryClass = categoryColors[data.category || "In The News"] || categoryColors["In The News"];

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm" data-testid="card-why-trending">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-base font-medium">Why They're Trending</CardTitle>
          </div>
          {data.category && (
            <Badge 
              variant="outline" 
              className={`text-xs ${categoryClass}`}
              data-testid="badge-trending-category"
            >
              {data.category}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.summary && (
          <p className="text-sm leading-relaxed text-foreground" data-testid="text-trending-summary">
            {data.summary}
          </p>
        )}
        
        {data.sources && data.sources.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Newspaper className="h-3 w-3" />
              <span>Recent Headlines</span>
            </div>
            <div className="space-y-1.5">
              {data.sources.slice(0, 3).map((source, index) => (
                <a
                  key={index}
                  href={source.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                  data-testid={`link-source-${index}`}
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
            <span data-testid="text-trending-updated">{formatRelativeTime(data.fetchedAt)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
