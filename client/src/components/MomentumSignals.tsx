import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Newspaper, BookOpen, BarChart3, Trophy, AlertTriangle, Clock, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { SiX, SiYoutube, SiInstagram, SiTiktok, SiSpotify } from "react-icons/si";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MomentumData {
  asOf: string | null;
  ageMinutes: number;
  activeSources: string[];
  staleFlags: Record<string, boolean>;
  signals: {
    search: {
      volume: number;
      deltaPct: number;
      relatedSearches: string[];
      peopleAlsoAsk: string[];
    };
    news: {
      count: number;
      deltaPct: number;
      headlines: string[];
      provider: string;
    };
    wiki: {
      views: number;
      deltaPct: number;
    };
    drivers: {
      status: "active" | "stable";
      breakdown: { search: number; news: number; wiki: number } | null;
      activeSources: number;
    };
  } | null;
  categoryRank: {
    overall: number;
    category: string;
    categoryRank: number;
  } | null;
  officialProfiles: Record<string, string>;
}

function formatNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function DeltaBadge({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-xs text-muted-foreground">no change</span>;
  const isUp = pct > 0;
  return (
    <Badge
      variant="outline"
      className={`text-xs font-mono ${isUp ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"}`}
      data-testid="badge-delta"
    >
      {isUp ? "+" : ""}{pct}%
    </Badge>
  );
}

function SignalSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-20 mb-2" />
        <Skeleton className="h-4 w-48" />
      </CardContent>
    </Card>
  );
}

export function MomentumSignals({ personId }: { personId: string }) {
  const [driversExpanded, setDriversExpanded] = useState(false);

  const { data, isLoading, error } = useQuery<MomentumData>({
    queryKey: ['/api/people', personId, 'momentum'],
    queryFn: async () => {
      const res = await fetch(`/api/people/${personId}/momentum`);
      if (!res.ok) throw new Error("Failed to fetch momentum");
      return res.json();
    },
    enabled: !!personId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="mt-8" data-testid="section-momentum-signals">
        <h2 className="text-xl font-bold mb-1">Momentum Signals</h2>
        <p className="text-sm text-muted-foreground mb-4">Loading live signals...</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SignalSkeleton />
          <SignalSkeleton />
          <SignalSkeleton />
          <SignalSkeleton />
        </div>
      </div>
    );
  }

  if (error || !data?.signals) {
    return null;
  }

  const { signals, categoryRank, staleFlags, ageMinutes, activeSources, officialProfiles } = data;

  const freshnessText = ageMinutes < 2
    ? "Just now"
    : ageMinutes < 60
      ? `${ageMinutes}m ago`
      : `${Math.round(ageMinutes / 60)}h ago`;

  const sourceLabels = activeSources.map(s =>
    s === "wiki" ? "Wikipedia" : s === "news" ? "News" : s === "search" ? "Search" : s
  );

  return (
    <div className="mt-8 space-y-6" data-testid="section-momentum-signals">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-xl font-bold">Momentum Signals</h2>
          {categoryRank && (
            <div className="flex items-center gap-2" data-testid="badge-category-rank">
              <Badge variant="secondary" className="text-xs">
                <Trophy className="h-3 w-3 mr-1" />
                #{categoryRank.categoryRank} in {categoryRank.category}
              </Badge>
              <Badge variant="outline" className="text-xs">
                #{categoryRank.overall} Overall
              </Badge>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span data-testid="text-freshness">Updated {freshnessText}</span>
          <span>·</span>
          <span>Sources: {sourceLabels.join(", ")}</span>
        </div>
      </div>

      {staleFlags.dataDelayed && (
        <div className="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/10 rounded-md px-3 py-2" data-testid="banner-data-delayed">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Data may be delayed — last update was over 3 hours ago</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-search-interest">
          <CardHeader className="pb-2 bg-blue-500/10">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-blue-500" />
                <span className="font-semibold text-sm">Search Interest</span>
              </div>
              <DeltaBadge pct={signals.search.deltaPct} />
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="text-2xl font-bold" data-testid="text-search-volume">
              {signals.search.volume}<span className="text-sm font-normal text-muted-foreground ml-1">activity score</span>
            </div>
            {signals.search.relatedSearches.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Related Searches</p>
                <div className="flex flex-wrap gap-1.5">
                  {signals.search.relatedSearches.map((q, i) => (
                    <Badge key={i} variant="outline" className="text-xs font-normal" data-testid={`badge-related-search-${i}`}>
                      {q}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {signals.search.peopleAlsoAsk.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">People Also Ask</p>
                <ul className="space-y-1">
                  {signals.search.peopleAlsoAsk.slice(0, 3).map((q, i) => (
                    <li key={i} className="text-xs text-muted-foreground" data-testid={`text-paa-${i}`}>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-news-activity">
          <CardHeader className="pb-2 bg-red-500/10">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-red-500" />
                <span className="font-semibold text-sm">News Activity</span>
              </div>
              <DeltaBadge pct={signals.news.deltaPct} />
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="text-2xl font-bold" data-testid="text-news-count">
              {formatNum(signals.news.count)}<span className="text-sm font-normal text-muted-foreground ml-1">articles (24h)</span>
            </div>
            {signals.news.headlines.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Top Headlines</p>
                <ul className="space-y-1.5">
                  {signals.news.headlines.map((h, i) => (
                    <li key={i} className="text-xs leading-relaxed line-clamp-2" data-testid={`text-headline-${i}`}>
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/60 capitalize">via {signals.news.provider}</p>
          </CardContent>
        </Card>

        <Card data-testid="card-wiki-pulse">
          <CardHeader className="pb-2 bg-muted/50">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Wikipedia Pulse</span>
              </div>
              <DeltaBadge pct={signals.wiki.deltaPct} />
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold" data-testid="text-wiki-views">
              {formatNum(signals.wiki.views)}<span className="text-sm font-normal text-muted-foreground ml-1">page views (24h)</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-[10px] text-muted-foreground/60 mt-2 cursor-help underline decoration-dotted">
                  Wikipedia views as curiosity proxy
                </p>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs max-w-[200px]">Wikipedia page views spike when public curiosity increases — often before or alongside news cycles.</p>
              </TooltipContent>
            </Tooltip>
          </CardContent>
        </Card>

        {signals.drivers.status === "stable" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground col-span-1 md:col-span-2 py-2" data-testid="card-score-drivers-collapsed">
            <BarChart3 className="h-4 w-4" />
            <span>Score Drivers: Stable — no major signal shift</span>
            <Badge variant="outline" className="text-xs ml-auto">
              {signals.drivers.activeSources}/3 sources
            </Badge>
          </div>
        ) : (
          <Card data-testid="card-score-drivers">
            <CardHeader className="pb-2 bg-primary/5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Score Drivers</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {signals.drivers.activeSources}/3 sources
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {signals.drivers.breakdown ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <DriverBar label="Search" pct={signals.drivers.breakdown.search} color="bg-blue-500" />
                    <DriverBar label="News" pct={signals.drivers.breakdown.news} color="bg-red-500" />
                    <DriverBar label="Wiki" pct={signals.drivers.breakdown.wiki} color="bg-gray-400" />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground"
                    onClick={() => setDriversExpanded(!driversExpanded)}
                    data-testid="button-expand-drivers"
                  >
                    {driversExpanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                    {driversExpanded ? "Hide details" : "View full calculation"}
                  </Button>
                  {driversExpanded && (
                    <div className="text-xs text-muted-foreground space-y-1 border-t pt-2">
                      <p>Search activity score: {signals.search.volume}/100</p>
                      <p>News articles (24h): {formatNum(signals.news.count)}</p>
                      <p>Wiki page views (24h): {formatNum(signals.wiki.views)}</p>
                      <p className="text-[10px] mt-1">Driver weights: Search 40%, News 35%, Wiki 25%</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Insufficient data</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {Object.keys(officialProfiles).length > 0 && (
        <OfficialProfiles profiles={officialProfiles} />
      )}
    </div>
  );
}

function DriverBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2" data-testid={`driver-bar-${label.toLowerCase()}`}>
      <span className="text-xs w-14 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="text-xs font-mono w-10 text-right">{pct}%</span>
    </div>
  );
}

const profileConfig: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  urlPrefix: string;
  color: string;
  bgColor: string;
}> = {
  x: {
    icon: SiX,
    label: "X",
    urlPrefix: "https://x.com/",
    color: "text-foreground",
    bgColor: "bg-foreground/5",
  },
  youtube: {
    icon: SiYoutube,
    label: "YouTube",
    urlPrefix: "https://youtube.com/channel/",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
  },
  instagram: {
    icon: SiInstagram,
    label: "Instagram",
    urlPrefix: "https://instagram.com/",
    color: "text-pink-500",
    bgColor: "bg-pink-500/10",
  },
  tiktok: {
    icon: SiTiktok,
    label: "TikTok",
    urlPrefix: "https://tiktok.com/@",
    color: "text-cyan-400",
    bgColor: "bg-cyan-400/10",
  },
  spotify: {
    icon: SiSpotify,
    label: "Spotify",
    urlPrefix: "https://open.spotify.com/artist/",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
};

function OfficialProfiles({ profiles }: { profiles: Record<string, string> }) {
  const entries = Object.entries(profiles).filter(([key]) => profileConfig[key]);
  if (entries.length === 0) return null;

  return (
    <div data-testid="section-official-profiles">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Official Profiles</h3>
      <div className="flex flex-wrap gap-2">
        {entries.map(([platform, handle]) => {
          const config = profileConfig[platform];
          if (!config) return null;
          const Icon = config.icon;
          const url = `${config.urlPrefix}${handle}`;
          return (
            <a
              key={platform}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="group"
              data-testid={`link-profile-${platform}`}
            >
              <Badge
                variant="outline"
                className={`${config.bgColor} gap-1.5 py-1.5 px-3 text-xs cursor-pointer`}
              >
                <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                <span className="font-normal">@{handle}</span>
                <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </Badge>
            </a>
          );
        })}
      </div>
    </div>
  );
}
