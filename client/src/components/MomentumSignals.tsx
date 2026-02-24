import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Newspaper, BookOpen, BarChart3, Trophy, AlertTriangle, Clock, ChevronDown, ChevronUp, ExternalLink, Info, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { SiX, SiYoutube, SiInstagram, SiTiktok, SiSpotify } from "react-icons/si";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TouchTooltip } from "@/components/ui/touch-tooltip";

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
      recentPeak?: number | null;
      recentPeakAge?: string | null;
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
      breakdownPct: { search: number; news: number; wiki: number } | null;
      activeSources: number;
      quietSources: string[];
      isExact?: boolean;
      method?: string;
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
  return n.toLocaleString('en-US');
}

function DeltaBadge({ pct }: { pct: number }) {
  if (pct === 0) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground border-muted" data-testid="badge-delta">
        flat
      </Badge>
    );
  }
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

function extractTopics(headlines: string[]): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "and", "but", "or", "nor", "not",
    "so", "yet", "both", "either", "neither", "each", "every", "all", "any",
    "few", "more", "most", "other", "some", "such", "no", "only", "own",
    "same", "than", "too", "very", "just", "about", "up", "out", "how",
    "what", "when", "where", "who", "which", "why", "this", "that", "these",
    "those", "it", "its", "he", "she", "they", "them", "his", "her", "their",
    "our", "your", "my", "me", "us", "we", "him", "i", "says", "said",
    "new", "also", "over", "per", "get", "gets", "got", "set", "amid",
    "back", "last", "first", "now", "top", "big", "day", "may", "make",
    "report", "reports", "news", "update", "updates", "latest", "video",
  ]);
  const genericWords = new Set([
    "surgery", "money", "team", "game", "show", "fight", "deal", "talk",
    "star", "fans", "world", "time", "year", "life", "man", "woman",
  ]);
  const acronymWhitelist = new Set([
    "AI", "NBA", "NFL", "UFC", "MLB", "NHL", "FIFA", "F1",
    "EU", "US", "UK", "UN", "NATO", "GOP",
    "XRP", "BTC", "ETH", "SOL", "NFT", "CEO", "IPO",
    "MMA", "MVP", "KO", "GDP", "FBI", "CIA", "SEC",
  ]);
  const freq = new Map<string, number>();
  const seen = new Set<string>();
  for (const h of headlines) {
    const words = h.replace(/[^a-zA-Z\s'-]/g, "").split(/\s+/).filter(Boolean);
    for (const w of words) {
      const lower = w.toLowerCase();
      const isWhitelisted = acronymWhitelist.has(w.toUpperCase());
      if (!isWhitelisted && (lower.length < 4 || stopWords.has(lower))) continue;
      if (genericWords.has(lower)) continue;
      if (seen.has(lower)) {
        const existing = Array.from(freq.keys()).find(k => k.toLowerCase() === lower);
        if (existing) freq.set(existing, (freq.get(existing) || 0) + 1);
        continue;
      }
      seen.add(lower);
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word);
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

export function MomentumSignals({ personId, wikiSlug }: { personId: string; wikiSlug?: string | null }) {
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
    <div id="momentum-signals" className="mt-8 space-y-6" data-testid="section-momentum-signals">
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
                <TouchTooltip side="top" contentClassName="max-w-[220px] text-xs normal-case tracking-normal" content="How actively people are searching for this person on Google right now, scored from 0 to 100. Higher means more search buzz.">
                  <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" data-testid="icon-search-tooltip" />
                </TouchTooltip>
              </div>
              <DeltaBadge pct={signals.search.deltaPct} />
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap" data-testid="text-search-volume">
              <div className="text-2xl font-bold">
                {signals.search.volume}<span className="text-sm font-normal text-muted-foreground ml-1">/ 100 search activity score</span>
              </div>
              <div className="flex items-center gap-1 text-xs" data-testid="text-search-trend">
                {signals.search.deltaPct > 5 ? (
                  <><TrendingUp className="h-3 w-3 text-green-500" /><span className="text-green-500">Rising</span></>
                ) : signals.search.deltaPct < -5 ? (
                  <><TrendingDown className="h-3 w-3 text-red-500" /><span className="text-red-500">Falling</span></>
                ) : (
                  <><Minus className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Steady</span></>
                )}
              </div>
            </div>
            {signals.search.relatedSearches.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Top searches</p>
                <div className="flex flex-wrap gap-1.5">
                  {signals.search.relatedSearches.slice(0, 5).map((q, i) => (
                    <Badge key={i} variant="outline" className="text-xs font-normal" data-testid={`badge-related-search-${i}`}>
                      {q}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : signals.search.peopleAlsoAsk.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">People ask</p>
                <ul className="space-y-1">
                  {signals.search.peopleAlsoAsk.slice(0, 3).map((q, i) => (
                    <li key={i} className="text-xs text-muted-foreground" data-testid={`text-paa-${i}`}>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            ) : signals.news.headlines.length > 0 && extractTopics(signals.news.headlines).length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Topics in the news</p>
                <div className="flex flex-wrap gap-1.5">
                  {extractTopics(signals.news.headlines).slice(0, 4).map((topic, i) => (
                    <Badge key={i} variant="outline" className="text-xs font-normal" data-testid={`badge-news-topic-${i}`}>
                      {topic}
                    </Badge>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-1.5" data-testid="text-top-searches-hint">Top searches appear when available</p>
              </div>
            ) : (
              <div data-testid="text-search-empty">
                <p className="text-xs text-muted-foreground">
                  {signals.search.volume > 0 ? "Search interest steady" : "Collecting search data..."}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Top searches will appear as we collect more data.</p>
              </div>
            )}
            {signals.search.relatedSearches.length > 0 && signals.search.peopleAlsoAsk.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">People ask</p>
                <ul className="space-y-1">
                  {signals.search.peopleAlsoAsk.slice(0, 2).map((q, i) => (
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
              {signals.news.count === 0 && signals.news.recentPeak ? (
                <>
                  {formatNum(signals.news.recentPeak)}<span className="text-sm font-normal text-muted-foreground ml-1">articles tracked recently</span>
                </>
              ) : (
                <>
                  {formatNum(signals.news.count)}<span className="text-sm font-normal text-muted-foreground ml-1">articles (24h)</span>
                </>
              )}
            </div>
            {signals.news.count === 0 && signals.news.recentPeak && signals.news.recentPeakAge && (
              <p className="text-[10px] text-muted-foreground/60" data-testid="text-news-recent-peak">
                {signals.news.recentPeak} articles detected {signals.news.recentPeakAge} &middot; current tick shows 0
              </p>
            )}
            {signals.news.headlines.length > 0 ? (
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
            ) : (
              <p className="text-[10px] text-muted-foreground/60" data-testid="text-news-empty">
                {signals.news.count > 0 ? "No major headlines in the last 24h" : (signals.news.recentPeak ? "Headlines from recent coverage no longer cached" : "No headlines tracked yet")}
              </p>
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
                {wikiSlug && (
                  <a
                    href={`https://en.wikipedia.org/wiki/${encodeURIComponent(wikiSlug)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex"
                    data-testid="link-wiki-page"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity" />
                  </a>
                )}
              </div>
              <DeltaBadge pct={signals.wiki.deltaPct} />
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold" data-testid="text-wiki-views">
              {formatNum(signals.wiki.views)}<span className="text-sm font-normal text-muted-foreground ml-1">page views (24h)</span>
            </div>
            {signals.wiki.views < 100 && signals.wiki.deltaPct === 0 ? (
              <p className="text-[10px] text-muted-foreground/60 mt-2" data-testid="text-wiki-quiet">Low curiosity signal today</p>
            ) : (
              <TouchTooltip content={<p className="text-xs max-w-[200px]">Wikipedia page views spike when public curiosity increases — often before or alongside news cycles.</p>}>
                <p className="text-[10px] text-muted-foreground/60 mt-2 cursor-help underline decoration-dotted">
                  Wikipedia views as curiosity proxy
                </p>
              </TouchTooltip>
            )}
          </CardContent>
        </Card>

        {signals.drivers.status === "stable" ? (
          <Card data-testid="card-score-drivers-collapsed">
            <CardHeader className="pb-2 bg-primary/5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Score Drivers</span>
                  <TouchTooltip content={<p className="text-xs max-w-[220px]">Current velocity composition — how each signal contributes to the overall score right now.</p>}>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TouchTooltip>
                </div>
                <Badge variant="outline" className="text-xs">
                  {signals.drivers.quietSources.length === 3 ? "steady" : `${3 - signals.drivers.quietSources.length}/3 active`}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {signals.drivers.breakdownPct ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <DriverBar label="Search" pct={signals.drivers.breakdownPct.search} color="bg-blue-500" />
                    <DriverBar label="News" pct={signals.drivers.breakdownPct.news} color="bg-red-500" />
                    <DriverBar label="Wiki" pct={signals.drivers.breakdownPct.wiki} color="bg-gray-400" />
                  </div>
                  <p className="text-[10px] text-muted-foreground/60" data-testid="text-stable-context">
                    Signals are steady — no major shift in the last 24h
                  </p>
                  {signals.drivers.method && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0" data-testid="badge-drivers-method-stable">
                      {signals.drivers.method === "exact_velocity_components" ? "Exact (from score components)" : "Estimate (from signal changes)"}
                    </Badge>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-stable-no-data">Signals are steady — no major shift in the last 24h</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card data-testid="card-score-drivers">
            <CardHeader className="pb-2 bg-primary/5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Score Drivers (24h change)</span>
                  <TouchTooltip content={<p className="text-xs max-w-[220px]">Based on what changed, not raw totals. Shows which signals drove the most movement.</p>}>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TouchTooltip>
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
                  <div className="space-y-0.5">
                    {signals.drivers.quietSources.length > 0 && (
                      <p className="text-[10px] text-muted-foreground/60" data-testid="text-quiet-sources">
                        Based on {signals.drivers.activeSources}/3 sources ({signals.drivers.quietSources.join(" & ")} quiet)
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/60" data-testid="text-drivers-clarifier">
                      Drivers explain today's change, not total attention · Compared to ~24h ago
                    </p>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0" data-testid="badge-drivers-method">
                      {(signals.drivers.method === "exact_velocity_components" || signals.drivers.isExact) ? "Exact (from score components)" : "Estimate (from signal changes)"}
                    </Badge>
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
                      <p className="text-[10px] mt-1">Attribution based on actual 24h signal changes, weighted: Search 40%, News 35%, Wiki 25%</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Insufficient data for attribution</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <OfficialProfiles profiles={officialProfiles} />
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

export function InlineProfileBadge({ platform, handle }: { platform: string; handle: string }) {
  const config = profileConfig[platform];
  if (!config) return null;
  const Icon = config.icon;
  const url = `${config.urlPrefix}${handle}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group"
      data-testid={`link-inline-profile-${platform}`}
    >
      <Badge
        variant="outline"
        className={`${config.bgColor} gap-1.5 py-1 px-2.5 text-xs cursor-pointer`}
      >
        <Icon className={`h-3 w-3 ${config.color}`} />
        <span className="font-normal">@{handle}</span>
        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </Badge>
    </a>
  );
}

function OfficialProfiles({ profiles }: { profiles: Record<string, string> }) {
  const entries = Object.entries(profiles).filter(([key]) => profileConfig[key]);
  if (entries.length === 0) return null;

  return (
    <div data-testid="section-official-profiles">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {entries.length === 1 ? "Official Profile" : "Official Profiles"}
        </h3>
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
