import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Newspaper, BookOpen, BarChart3, AlertTriangle, Clock, ExternalLink, Info, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { SiX, SiYoutube, SiInstagram, SiTiktok, SiSpotify } from "react-icons/si";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { cn } from "@/lib/utils";

type MomentumLevel = "none" | "low" | "medium" | "high";

interface MomentumData {
  asOf: string | null;
  ageMinutes: number;
  activeSources: string[];
  staleFlags: Record<string, boolean>;
  signals: {
    search: {
      volume: number;
      deltaPct: number;
      level?: MomentumLevel;
      relatedSearches: string[];
      peopleAlsoAsk: string[];
    };
    news: {
      count: number;
      recentPeak?: number | null;
      recentPeakAge?: string | null;
      deltaPct: number;
      level?: MomentumLevel;
      headlines: string[];
      topStories?: Array<{ title: string; link: string }>;
      provider: string;
    };
    wiki: {
      views: number;
      deltaPct: number;
      level?: MomentumLevel;
      wiki_falling?: boolean;
      wiki_rising?: boolean;
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

// Fallback thresholds used only when the server response doesn't carry `level`
// (e.g. older cached responses or the first load before stats warm up).
function fallbackLevel(source: "search" | "news" | "wiki", value: number): MomentumLevel {
  if (!Number.isFinite(value) || value <= 0) return "none";
  if (source === "search") {
    if (value < 20) return "low";
    if (value < 60) return "medium";
    return "high";
  }
  if (source === "news") {
    if (value < 7) return "low";
    if (value < 16) return "medium";
    return "high";
  }
  if (value < 500) return "low";
  if (value < 5000) return "medium";
  return "high";
}

const LEVEL_STYLES: Record<MomentumLevel, {
  label: string;
  dot: string;
  glow: string;
  text: string;
  ring: string;
}> = {
  high: {
    label: "High",
    dot: "bg-emerald-500",
    glow: "shadow-[0_0_12px_2px_rgba(16,185,129,0.55)]",
    text: "text-emerald-700 dark:text-emerald-400",
    ring: "ring-emerald-500/25",
  },
  medium: {
    label: "Medium",
    dot: "bg-amber-500",
    glow: "shadow-[0_0_10px_1px_rgba(245,158,11,0.45)]",
    text: "text-amber-700 dark:text-amber-400",
    ring: "ring-amber-500/25",
  },
  low: {
    label: "Low",
    dot: "bg-rose-500",
    glow: "shadow-[0_0_10px_1px_rgba(244,63,94,0.4)]",
    text: "text-rose-700 dark:text-rose-400",
    ring: "ring-rose-500/25",
  },
  none: {
    label: "Quiet",
    dot: "bg-muted-foreground/60",
    glow: "",
    text: "text-muted-foreground",
    ring: "ring-transparent",
  },
};

function LevelIndicator({ level, testId }: { level: MomentumLevel; testId?: string }) {
  const s = LEVEL_STYLES[level];
  const pulse = level === "high"
    ? "motion-safe:animate-pulse motion-reduce:animate-none"
    : "";
  return (
    <div className="flex items-center gap-2.5" data-testid={testId}>
      <span
        className={cn(
          "relative inline-flex h-2.5 w-2.5 rounded-full shrink-0 transition-colors duration-500",
          s.dot,
          s.glow,
          pulse,
        )}
        style={level === "high" ? { animationDuration: "2.4s" } : undefined}
      />
      <span className={cn("text-xl font-semibold tracking-tight transition-colors duration-500", s.text)}>
        {s.label}
      </span>
    </div>
  );
}

type TrendWord = "rising" | "falling" | "steady";

function DeltaPill({ pct, trendWord }: { pct: number; trendWord?: TrendWord }) {
  if (!Number.isFinite(pct) || pct === 0) {
    return (
      <div
        className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"
        data-testid="badge-delta"
      >
        <Minus className="h-3 w-3" />
        <span>flat</span>
      </div>
    );
  }
  const isUp = pct > 0;
  const Arrow = isUp ? ArrowUp : ArrowDown;
  const tint = isUp
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-rose-700 dark:text-rose-400";
  return (
    <div
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium font-mono", tint)}
      data-testid="badge-delta"
    >
      <Arrow className="h-3 w-3" />
      <span>{isUp ? "+" : ""}{pct}%</span>
      {trendWord && trendWord !== "steady" && (
        <span className="text-muted-foreground font-sans font-normal ml-0.5">· {trendWord}</span>
      )}
    </div>
  );
}

interface SignalCardProps {
  icon: React.ReactNode;
  iconWrapClass?: string;
  title: string;
  level: MomentumLevel;
  value: string;
  unit: string;
  deltaPct: number;
  trendWord?: TrendWord;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  tooltip?: React.ReactNode;
  testId?: string;
}

function SignalCard({
  icon,
  iconWrapClass,
  title,
  level,
  value,
  unit,
  deltaPct,
  trendWord,
  headerRight,
  footer,
  tooltip,
  testId,
}: SignalCardProps) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden border-border/50 bg-card/60 backdrop-blur-sm transition-colors duration-300 hover:bg-card/80",
      )}
      data-testid={testId}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-px opacity-70 transition-colors duration-500",
          level === "high" ? "bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent"
            : level === "medium" ? "bg-gradient-to-r from-transparent via-amber-500/60 to-transparent"
              : level === "low" ? "bg-gradient-to-r from-transparent via-rose-500/60 to-transparent"
                : "bg-transparent",
        )}
      />
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md shrink-0", iconWrapClass)}>
              {icon}
            </span>
            <span className="text-xs font-medium text-muted-foreground truncate">{title}</span>
            {tooltip}
          </div>
          {headerRight}
        </div>
      </CardHeader>
      <CardContent className="pt-1 pb-3 px-4 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <LevelIndicator level={level} testId={`level-${testId ?? title.toLowerCase()}`} />
          <DeltaPill pct={deltaPct} trendWord={trendWord} />
        </div>
        <div className="text-[11px] text-muted-foreground font-mono">
          <span className="text-foreground/80">{value}</span>
          <span className="ml-1">{unit}</span>
        </div>
        {footer}
      </CardContent>
    </Card>
  );
}

function SignalSkeleton() {
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-2 pt-3 px-4">
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="pt-1 pb-3 px-4 space-y-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-3 w-16" />
      </CardContent>
    </Card>
  );
}

export function MomentumSignals({ personId, wikiSlug }: { personId: string; wikiSlug?: string | null }) {
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
        <div className="grid grid-cols-2 gap-3">
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

  const { signals, staleFlags, ageMinutes, activeSources, officialProfiles } = data;

  const freshnessText = ageMinutes < 2
    ? "Just now"
    : ageMinutes < 60
      ? `${ageMinutes}m ago`
      : `${Math.round(ageMinutes / 60)}h ago`;

  const sourceLabels = activeSources.map(s =>
    s === "wiki" ? "Wikipedia" : s === "news" ? "News" : s === "search" ? "Search" : s
  );

  const searchLevel: MomentumLevel = signals.search.level ?? fallbackLevel("search", signals.search.volume);
  const newsLevel: MomentumLevel = signals.news.level ?? fallbackLevel("news", signals.news.count);
  const wikiLevel: MomentumLevel = signals.wiki.level ?? fallbackLevel("wiki", signals.wiki.views);

  const searchTrend: TrendWord =
    signals.search.deltaPct > 5 ? "rising" : signals.search.deltaPct < -5 ? "falling" : "steady";
  const newsTrend: TrendWord =
    signals.news.deltaPct > 5 ? "rising" : signals.news.deltaPct < -5 ? "falling" : "steady";
  const wikiTrend: TrendWord =
    signals.wiki.wiki_rising === true ? "rising"
      : signals.wiki.wiki_falling === true ? "falling"
        : signals.wiki.deltaPct > 5 ? "rising"
          : signals.wiki.deltaPct < -5 ? "falling"
            : "steady";

  return (
    <div id="momentum-signals" className="mt-8 space-y-5" data-testid="section-momentum-signals">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-xl font-bold">Momentum Signals</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative inline-flex items-center">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse motion-reduce:animate-none" style={{ animationDuration: "2s" }} />
          </span>
          <Clock className="h-3 w-3" />
          <span data-testid="text-freshness">Updated {freshnessText}</span>
          <span>·</span>
          <span>Sources: {sourceLabels.join(", ")}</span>
        </div>
      </div>

      {staleFlags.dataDelayed && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-500 bg-amber-500/15 dark:bg-amber-500/10 rounded-md px-3 py-2" data-testid="banner-data-delayed">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Data may be delayed — last update was over 3 hours ago</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <SignalCard
          testId="card-search-interest"
          icon={<Search className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />}
          iconWrapClass="bg-blue-500/15 dark:bg-blue-500/10"
          title="Search Interest"
          level={searchLevel}
          value={`${signals.search.volume}`}
          unit="/ 100"
          deltaPct={signals.search.deltaPct}
          trendWord={searchTrend}
          tooltip={
            <TouchTooltip
              side="top"
              contentClassName="max-w-[220px] text-xs normal-case tracking-normal"
              content="How actively people are searching for this person on Google right now, scored from 0 to 100."
            >
              <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" data-testid="icon-search-tooltip" />
            </TouchTooltip>
          }
        />

        <SignalCard
          testId="card-news-activity"
          icon={<Newspaper className="h-3.5 w-3.5 text-red-700 dark:text-red-400" />}
          iconWrapClass="bg-red-500/15 dark:bg-red-500/10"
          title="News Activity"
          level={newsLevel}
          value={`${signals.news.count}`}
          unit={signals.news.count === 1 ? "article (24h)" : "articles (24h)"}
          deltaPct={signals.news.deltaPct}
          trendWord={newsTrend}
          footer={
            signals.news.count === 0 && signals.news.recentPeak && signals.news.recentPeakAge ? (
              <p className="text-[10px] text-muted-foreground/60 pt-0.5" data-testid="text-news-recent-peak">
                {signals.news.recentPeak} articles found {signals.news.recentPeakAge}
              </p>
            ) : null
          }
        />

        <SignalCard
          testId="card-wiki-pulse"
          icon={<BookOpen className="h-3.5 w-3.5 text-muted-foreground" />}
          iconWrapClass="bg-muted"
          title="Wikipedia Pulse"
          level={wikiLevel}
          value={formatNum(signals.wiki.views)}
          unit="page views (24h)"
          deltaPct={signals.wiki.deltaPct}
          trendWord={wikiTrend}
          headerRight={wikiSlug ? (
            <a
              href={`https://en.wikipedia.org/wiki/${encodeURIComponent(wikiSlug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex p-1 -m-1 rounded-md hover:bg-muted/50"
              aria-label="Open Wikipedia page"
              data-testid="link-wiki-page"
            >
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity" />
            </a>
          ) : undefined}
        />

        <ScoreDriversCard drivers={signals.drivers} />
      </div>

      <OfficialProfiles profiles={officialProfiles} />
    </div>
  );
}

function ScoreDriversCard({ drivers }: { drivers: NonNullable<MomentumData["signals"]>["drivers"] }) {
  const isStable = drivers.status === "stable";
  const source = isStable ? drivers.breakdownPct : drivers.breakdown;
  const hasData = !!source;

  const values = source ?? { search: 0, news: 0, wiki: 0 };

  const method = drivers.method === "exact_velocity_components" || drivers.isExact
    ? "exact"
    : "estimate";

  const headerRight = isStable ? (
    <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
      {drivers.quietSources.length === 3 ? "steady" : `${3 - drivers.quietSources.length}/3 live`}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
      {drivers.activeSources}/3 live
    </Badge>
  );

  return (
    <Card
      className="relative overflow-hidden border-border/50 bg-card/60 backdrop-blur-sm transition-colors duration-300 hover:bg-card/80"
      data-testid={isStable ? "card-score-drivers-collapsed" : "card-score-drivers"}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70 bg-gradient-to-r from-transparent via-primary/60 to-transparent"
      />
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 shrink-0">
              <BarChart3 className="h-3.5 w-3.5 text-primary" />
            </span>
            <span className="text-xs font-medium text-muted-foreground truncate">Score Drivers</span>
            <TouchTooltip
              side="top"
              contentClassName="max-w-[240px] text-xs normal-case tracking-normal"
              content={isStable
                ? "Current velocity composition — how each signal contributes to the overall score right now."
                : "Based on what changed (not raw totals). Shows which signals drove the most movement in the last 24h."}
            >
              <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
            </TouchTooltip>
          </div>
          {headerRight}
        </div>
      </CardHeader>
      <CardContent className="pt-1 pb-3 px-4 space-y-2.5">
        {hasData ? (
          <>
            <StackedDriverBar search={values.search} news={values.news} wiki={values.wiki} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <DriverLegendDot color="bg-blue-500" label="Search" pct={values.search} />
              <DriverLegendDot color="bg-red-500" label="News" pct={values.news} />
              <DriverLegendDot color="bg-gray-500 dark:bg-gray-400" label="Wiki" pct={values.wiki} />
              <span
                className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground/60"
                data-testid={isStable ? "badge-drivers-method-stable" : "badge-drivers-method"}
              >
                {method}
              </span>
            </div>
            {isStable ? (
              <p className="text-[10px] text-muted-foreground/60" data-testid="text-stable-context">
                Steady — no major shift in the last 24h
              </p>
            ) : drivers.quietSources.length > 0 ? (
              <p className="text-[10px] text-muted-foreground/60" data-testid="text-quiet-sources">
                {drivers.quietSources.join(" & ")} minimal · compared to ~24h ago
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground/60" data-testid="text-drivers-clarifier">
                Drivers explain today's score change · compared to ~24h ago
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="text-stable-no-data">
            Insufficient data for attribution
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StackedDriverBar({ search, news, wiki }: { search: number; news: number; wiki: number }) {
  const total = Math.max(search + news + wiki, 1);
  const s = Math.max(0, (search / total) * 100);
  const n = Math.max(0, (news / total) * 100);
  const w = Math.max(0, (wiki / total) * 100);
  return (
    <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden flex" aria-hidden>
      <div
        className="h-full bg-blue-500 transition-[width] duration-500"
        style={{ width: `${s}%` }}
        data-testid="driver-bar-search"
      />
      <div
        className="h-full bg-red-500 transition-[width] duration-500"
        style={{ width: `${n}%` }}
        data-testid="driver-bar-news"
      />
      <div
        className="h-full bg-gray-500 dark:bg-gray-400 transition-[width] duration-500"
        style={{ width: `${w}%` }}
        data-testid="driver-bar-wiki"
      />
    </div>
  );
}

function DriverLegendDot({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      <span>{label}</span>
      <span className="font-mono text-foreground/80">{pct}%</span>
    </span>
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
    color: "text-red-700 dark:text-red-500",
    bgColor: "bg-red-500/15 dark:bg-red-500/10",
  },
  instagram: {
    icon: SiInstagram,
    label: "Instagram",
    urlPrefix: "https://instagram.com/",
    color: "text-pink-700 dark:text-pink-500",
    bgColor: "bg-pink-500/15 dark:bg-pink-500/10",
  },
  tiktok: {
    icon: SiTiktok,
    label: "TikTok",
    urlPrefix: "https://tiktok.com/@",
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor: "bg-cyan-400/10",
  },
  spotify: {
    icon: SiSpotify,
    label: "Spotify",
    urlPrefix: "https://open.spotify.com/artist/",
    color: "text-green-700 dark:text-green-500",
    bgColor: "bg-green-500/15 dark:bg-green-500/10",
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
