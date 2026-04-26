import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, Newspaper, BookOpen, Sparkles, AlertTriangle, Clock, ExternalLink, Info, ArrowUp, ArrowDown } from "lucide-react";
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
    /**
     * @deprecated Apr 2026 — PR3. The Serper SERP-shape composite no
     * longer feeds scoring (velocity weight = 0) and the dedicated
     * "Search Interest" card is replaced by News Momentum below. Field
     * is still emitted by the API so older mobile clients don't break.
     */
    search?: {
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
    /**
     * News-momentum velocity slot (Apr 2026 — PR2 Fix X). Surfaces the
     * 24h-vs-7d acceleration ratio that replaced the defunct search
     * signal in the velocity score. Marked optional defensively: the
     * current API always emits this field, but a stale React Query
     * cache from a pre-PR3 page load could return without it.
     */
    momentum?: {
      score: number;          // 0..100 sub-score (mirrors velocityComponents.momentum)
      ratio: number;          // 24h / max(7d-avg, 1), capped at 10×
      averageDaily7d: number; // trailing 7d daily news baseline
      articleCount24h: number; // today's count, same as signals.news.count
      deltaPct: number;       // 24h change in *score* vs prior tick
      level: MomentumLevel;
    };
    drivers: {
      status: "active" | "stable";
      breakdown: { search: number; news: number; wiki: number; momentum?: number } | null;
      breakdownPct: { search: number; news: number; wiki: number; momentum?: number } | null;
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
function fallbackLevel(source: "momentum" | "news" | "wiki", value: number): MomentumLevel {
  if (!Number.isFinite(value) || value <= 0) return "none";
  if (source === "momentum") {
    // Kept in sync with computeMomentumLevel in server/routes.ts.
    // Score is the 0..100 momentum velocity sub-score (log-scaled
    // 24h-vs-7d-avg news ratio) — see normalize.ts:normalizeNewsMomentum.
    if (value <= 30) return "low";
    if (value <= 60) return "medium";
    return "high";
  }
  if (source === "news") {
    // Kept in sync with FIXED_LEVEL_FALLBACKS.news in server/routes.ts.
    // Bumped for NEWS_AGGREGATION_MODE=union which roughly 2-3x's raw counts.
    if (value < 15) return "low";
    if (value < 40) return "medium";
    return "high";
  }
  if (value < 500) return "low";
  if (value < 5000) return "medium";
  return "high";
}

const LEVEL_SCALE_COPY =
  "Level compares this person to everyone we track over the last 14 days — Low = bottom 25%, Medium = middle 50%, High = top 25%.";

const MOMENTUM_LEVEL_COPY =
  "Level reflects how today's news volume compares to this person's own 7-day daily average — Low = at or below typical, Medium = mild acceleration, High = clear breakout (3×+ their typical day).";

// Each level gets a distinct dot SHAPE on top of its colour so the indicator is
// still unambiguous for users who can't rely on red/amber/green alone:
//   High   = filled + glow + pulse
//   Medium = filled, no glow, no pulse
//   Low    = outline-only ring
//   None   = small muted filled dot
const LEVEL_STYLES: Record<MomentumLevel, {
  label: string;
  dotClass: string;
  glow: string;
  text: string;
  pulse: boolean;
}> = {
  high: {
    label: "High",
    dotClass: "bg-emerald-500",
    glow: "shadow-[0_0_12px_2px_rgba(16,185,129,0.55)]",
    text: "text-emerald-700 dark:text-emerald-400",
    pulse: true,
  },
  medium: {
    label: "Medium",
    dotClass: "bg-amber-500",
    glow: "",
    text: "text-amber-700 dark:text-amber-400",
    pulse: false,
  },
  low: {
    label: "Low",
    dotClass: "bg-transparent ring-2 ring-inset ring-rose-500",
    glow: "",
    text: "text-rose-700 dark:text-rose-400",
    pulse: false,
  },
  none: {
    label: "Quiet",
    dotClass: "bg-muted-foreground/60",
    glow: "",
    text: "text-muted-foreground",
    pulse: false,
  },
};

function LevelIndicator({ level, testId }: { level: MomentumLevel; testId?: string }) {
  const s = LEVEL_STYLES[level];
  const pulseClass = s.pulse ? "motion-safe:animate-pulse motion-reduce:animate-none" : "";
  return (
    <div className="flex items-center gap-2.5" data-testid={testId}>
      <span
        className={cn(
          "relative inline-flex h-2.5 w-2.5 rounded-full shrink-0 transition-colors duration-500",
          s.dotClass,
          s.glow,
          pulseClass,
        )}
        style={s.pulse ? { animationDuration: "2.4s" } : undefined}
      />
      <span className={cn("text-xl font-semibold tracking-tight transition-colors duration-500", s.text)}>
        {s.label}
      </span>
    </div>
  );
}

type TrendWord = "rising" | "falling" | "steady";

function DeltaPill({ pct, trendWord }: { pct: number; trendWord?: TrendWord }) {
  // pct === 0 from the API usually means "no prior baseline to compare against"
  // rather than "measured and genuinely flat" — render a neutral em-dash instead
  // of asserting "flat", which previously appeared on almost every Wiki card.
  if (!Number.isFinite(pct) || pct === 0) {
    return (
      <span
        className="text-[11px] font-medium text-muted-foreground/60 select-none"
        data-testid="badge-delta"
        aria-label="No change data"
      >
        —
      </span>
    );
  }
  const isUp = pct > 0;
  const Arrow = isUp ? ArrowUp : ArrowDown;
  const tint = isUp
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-rose-700 dark:text-rose-400";
  // Round for display so the pill always matches the take sentence, which
  // also rounds (avoids "-88%" in the pill vs "down 80%" in the take copy).
  const displayPct = Math.round(pct);
  return (
    <div
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium font-mono", tint)}
      data-testid="badge-delta"
    >
      <Arrow className="h-3 w-3" />
      <span>{isUp ? "+" : ""}{displayPct}%</span>
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
        "relative overflow-hidden border-border/50 backdrop-blur-sm transition-colors duration-300",
        level === "high"
          ? "bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]"
          : level === "medium"
            ? "bg-amber-500/[0.04] hover:bg-amber-500/[0.07]"
            : level === "low"
              ? "bg-rose-500/[0.04] hover:bg-rose-500/[0.07]"
              : "bg-card/60 hover:bg-card/80",
      )}
      data-testid={testId}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-90 transition-colors duration-500",
          level === "high" ? "bg-gradient-to-r from-transparent via-emerald-500/90 to-transparent"
            : level === "medium" ? "bg-gradient-to-r from-transparent via-amber-500/90 to-transparent"
              : level === "low" ? "bg-gradient-to-r from-transparent via-rose-500/90 to-transparent"
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
        <div className="flex items-center gap-3 flex-wrap">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
    s === "wiki" ? "Wikipedia" : s === "news" ? "News" : s
  );

  const newsLevel: MomentumLevel = signals.news.level ?? fallbackLevel("news", signals.news.count);
  const wikiLevel: MomentumLevel = signals.wiki.level ?? fallbackLevel("wiki", signals.wiki.views);
  const momentumLevel: MomentumLevel = signals.momentum?.level
    ?? fallbackLevel("momentum", signals.momentum?.score ?? 0);

  const newsTrend: TrendWord =
    signals.news.deltaPct > 5 ? "rising" : signals.news.deltaPct < -5 ? "falling" : "steady";
  const wikiTrend: TrendWord =
    signals.wiki.wiki_rising === true ? "rising"
      : signals.wiki.wiki_falling === true ? "falling"
        : signals.wiki.deltaPct > 5 ? "rising"
          : signals.wiki.deltaPct < -5 ? "falling"
            : "steady";
  const momentumTrend: TrendWord = signals.momentum
    ? (signals.momentum.deltaPct > 5 ? "rising" : signals.momentum.deltaPct < -5 ? "falling" : "steady")
    : "steady";

  // Three-way display state for the News Momentum card. The engine assigns a
  // positive score even when the 7-day baseline is empty (uses MOMENTUM_AVG_FLOOR=1
  // internally) so brand-new tracked persons can still rank — but showing
  // "5.0× vs 7-day baseline" in that case is misleading because there *is* no
  // baseline yet. Detect that explicitly so the user sees a "warming up"
  // state instead of either a fake ratio or "no recent news".
  const momentumScore = signals.momentum?.score ?? 0;
  const momentumRatio = signals.momentum?.ratio ?? 0;
  const momentumAvg7d = signals.momentum?.averageDaily7d ?? 0;
  const hasNewsToday = signals.news.count > 0;
  const hasMomentumBaseline = momentumAvg7d > 0;
  const showRatio = momentumRatio > 0 && hasMomentumBaseline;

  // Cap is enforced at 10× server-side; flag it in the display so the user
  // knows the real number is "10× or more" rather than "exactly 10×".
  const ratioDisplay = showRatio
    ? momentumRatio >= 10
      ? "10×+"
      : `${momentumRatio.toFixed(1)}×`
    : "—";

  const momentumUnit = showRatio
    ? "vs 7-day average"
    : !hasMomentumBaseline && (hasNewsToday || momentumScore > 0)
      ? "establishing baseline"
      : "no recent news";

  const momentumFooter = showRatio
    ? (
        <p className="text-[10px] text-muted-foreground/60 pt-0.5" data-testid="text-momentum-baseline">
          7-day avg: {momentumAvg7d.toFixed(1)} {momentumAvg7d === 1 ? "article/day" : "articles/day"}
        </p>
      )
    : !hasMomentumBaseline && (hasNewsToday || momentumScore > 0)
      ? (
          <p className="text-[10px] text-muted-foreground/60 pt-0.5" data-testid="text-momentum-warmup">
            Need 7 days of history to compare against
          </p>
        )
      : null;

  return (
    <div id="momentum-signals" className="mt-8 space-y-5" data-testid="section-momentum-signals">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-xl font-bold">Momentum Signals</h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="relative inline-flex items-center">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse motion-reduce:animate-none" style={{ animationDuration: "2s" }} />
            </span>
            <Clock className="h-3 w-3" />
            <span data-testid="text-freshness">Updated {freshnessText}</span>
          </span>
          <span className="whitespace-nowrap">Sources: {sourceLabels.join(", ")}</span>
        </div>
      </div>

      {staleFlags.dataDelayed && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-500 bg-amber-500/15 dark:bg-amber-500/10 rounded-md px-3 py-2" data-testid="banner-data-delayed">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Data may be delayed — last update was over 3 hours ago</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SignalCard
          testId="card-news-activity"
          icon={<Newspaper className="h-3.5 w-3.5 text-muted-foreground" />}
          iconWrapClass="bg-muted"
          title="News Activity"
          level={newsLevel}
          value={`${signals.news.count}`}
          unit={signals.news.count === 1 ? "article (24h)" : "articles (24h)"}
          deltaPct={signals.news.deltaPct}
          trendWord={newsTrend}
          tooltip={
            <TouchTooltip
              side="top"
              contentClassName="max-w-[240px] text-xs normal-case tracking-normal"
              content={`News articles mentioning this person in the last 24 hours. ${LEVEL_SCALE_COPY}`}
            >
              <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" data-testid="icon-news-tooltip" />
            </TouchTooltip>
          }
          footer={
            signals.news.count === 0 && signals.news.recentPeak && signals.news.recentPeakAge ? (
              <p className="text-[10px] text-muted-foreground/60 pt-0.5" data-testid="text-news-recent-peak">
                {signals.news.recentPeak} articles found {signals.news.recentPeakAge}
              </p>
            ) : null
          }
        />

        <SignalCard
          testId="card-news-momentum"
          icon={<Flame className="h-3.5 w-3.5 text-orange-500 dark:text-orange-400" />}
          iconWrapClass="bg-orange-500/15 dark:bg-orange-500/10"
          title="News Momentum"
          level={momentumLevel}
          value={ratioDisplay}
          unit={momentumUnit}
          deltaPct={signals.momentum?.deltaPct ?? 0}
          trendWord={momentumTrend}
          tooltip={
            <TouchTooltip
              side="top"
              contentClassName="max-w-[260px] text-xs normal-case tracking-normal"
              content={`How today's news volume compares to this person's own 7-day daily average. 1× means a typical day, 3×+ means a clear breakout. ${MOMENTUM_LEVEL_COPY}`}
            >
              <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" data-testid="icon-momentum-tooltip" />
            </TouchTooltip>
          }
          footer={momentumFooter}
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
          tooltip={
            <TouchTooltip
              side="top"
              contentClassName="max-w-[240px] text-xs normal-case tracking-normal"
              content={`Daily Wikipedia page views for this person. ${LEVEL_SCALE_COPY}`}
            >
              <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" data-testid="icon-wiki-tooltip" />
            </TouchTooltip>
          }
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

        <MomentumTakeCard
          sources={[
            { name: "News", level: newsLevel, delta: signals.news.deltaPct },
            { name: "Momentum", level: momentumLevel, delta: signals.momentum?.deltaPct ?? 0 },
            { name: "Wikipedia", level: wikiLevel, delta: signals.wiki.deltaPct },
          ]}
        />
      </div>

      <OfficialProfiles profiles={officialProfiles} />
    </div>
  );
}

// ─── Today's Take ─────────────────────────────────────────────────────────────
// Replaces the old Score Drivers card. Synthesises the three signal cards above
// into a single human-readable sentence + state badge, so users get a direct
// answer to "what is this person's attention doing right now?" without needing
// to reconcile contradictory-looking percentages against the level traffic lights.

type MomentumState = "peaking" | "rising" | "mixed" | "steady" | "cooling" | "quiet";

const STATE_STYLES: Record<MomentumState, {
  label: string;
  dotClass: string;
  glow: string;
  text: string;
  pulse: boolean;
  tintBg: string;
  tintBar: string;
}> = {
  peaking: {
    label: "Peaking",
    dotClass: "bg-emerald-500",
    glow: "shadow-[0_0_12px_2px_rgba(16,185,129,0.55)]",
    text: "text-emerald-700 dark:text-emerald-400",
    pulse: true,
    tintBg: "bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]",
    tintBar: "bg-gradient-to-r from-transparent via-emerald-500/90 to-transparent",
  },
  rising: {
    // Teal reads as "upward momentum" without colliding with the leaderboard's
    // blue cooling badge. Distinct from emerald (Peaking) because it's notably
    // more cyan-leaning.
    label: "Rising",
    dotClass: "bg-teal-500",
    glow: "shadow-[0_0_10px_1px_rgba(20,184,166,0.5)]",
    text: "text-teal-700 dark:text-teal-400",
    pulse: false,
    tintBg: "bg-teal-500/[0.04] hover:bg-teal-500/[0.07]",
    tintBar: "bg-gradient-to-r from-transparent via-teal-500/90 to-transparent",
  },
  mixed: {
    // Violet reads as "both directions at once" without leaning optimistic
    // (green) or alarmed (amber). Used when a source is surging and another
    // is dropping dramatically at the same time.
    label: "Mixed",
    dotClass: "bg-violet-500",
    glow: "shadow-[0_0_10px_1px_rgba(139,92,246,0.5)]",
    text: "text-violet-700 dark:text-violet-400",
    pulse: false,
    tintBg: "bg-violet-500/[0.04] hover:bg-violet-500/[0.07]",
    tintBar: "bg-gradient-to-r from-transparent via-violet-500/90 to-transparent",
  },
  steady: {
    label: "Steady",
    dotClass: "bg-muted-foreground/70",
    glow: "",
    text: "text-foreground/80",
    pulse: false,
    tintBg: "bg-card/60 hover:bg-card/80",
    tintBar: "bg-gradient-to-r from-transparent via-muted-foreground/40 to-transparent",
  },
  cooling: {
    label: "Cooling",
    dotClass: "bg-amber-500",
    glow: "",
    text: "text-amber-700 dark:text-amber-400",
    pulse: false,
    tintBg: "bg-amber-500/[0.04] hover:bg-amber-500/[0.07]",
    tintBar: "bg-gradient-to-r from-transparent via-amber-500/90 to-transparent",
  },
  quiet: {
    label: "Quiet",
    dotClass: "bg-muted-foreground/50",
    glow: "",
    text: "text-muted-foreground",
    pulse: false,
    tintBg: "bg-card/60 hover:bg-card/80",
    tintBar: "bg-transparent",
  },
};

interface SourceSnapshot {
  name: "News" | "Momentum" | "Wikipedia";
  level: MomentumLevel;
  delta: number;
}

function classifyMomentumState(sources: SourceSnapshot[]): MomentumState {
  const levels = sources.map(s => s.level);
  const deltas = sources.map(s => s.delta).filter(d => Number.isFinite(d));

  const highCount = levels.filter(l => l === "high").length;
  const lowCount = levels.filter(l => l === "low" || l === "none").length;
  const risingCount = deltas.filter(d => d > 5).length;
  const fallingCount = deltas.filter(d => d < -5).length;

  const hasStrongRise = deltas.some(d => d >= 20);
  const hasStrongFall = deltas.some(d => d <= -20);

  // Peaking wins even with some softening — current High levels are the
  // dominant story, regardless of 24h delta direction.
  if (highCount >= 2) return "peaking";

  // Mixed: genuinely bidirectional movement. A source surging >=20% while
  // another drops >=20% can't be honestly compressed into "rising" or
  // "cooling" — the take sentence will name both moves explicitly.
  if (hasStrongRise && hasStrongFall) return "mixed";

  // Bulk directional movement across multiple sources.
  if (risingCount >= 2 && !hasStrongFall) return "rising";
  if (fallingCount >= 2 && !hasStrongRise) return "cooling";

  // Single dramatic move (>=20%) with no opposing pressure — newsworthy on
  // its own, even from a single source.
  if (hasStrongRise && fallingCount === 0) return "rising";
  if (hasStrongFall && risingCount === 0) return "cooling";

  // Quiet needs genuine low activity across the board — one strong source
  // flips the read to steady so we can surface it in the take copy instead.
  if (lowCount >= 2 && highCount === 0 && risingCount === 0) return "quiet";
  return "steady";
}

const LEVEL_RANK: Record<MomentumLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };

// "Wikipedia" is a proper noun so it stays capitalised mid-sentence;
// "news" reads naturally in lowercase. "Momentum" is treated as a label
// rather than a noun ("news momentum surging" reads better than
// "momentum surging") — see momentumPhrase below for context-specific
// rendering.
function nameInSentence(name: SourceSnapshot["name"]): string {
  if (name === "Wikipedia") return "Wikipedia";
  if (name === "Momentum") return "news momentum";
  return "news";
}

// Sentence-start version of the source name (capitalised). "Momentum"
// renders as "News momentum" so it reads naturally as a sentence
// subject ("News momentum surging 47% in the last 24h.").
function nameAtSentenceStart(name: SourceSnapshot["name"]): string {
  if (name === "Momentum") return "News momentum";
  return name;
}

function composeTake(sources: SourceSnapshot[], state: MomentumState): string {
  const byAbsDelta = [...sources].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const byLevel = [...sources].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  const biggestMover = byAbsDelta[0];
  const strongest = byLevel[0];

  switch (state) {
    case "peaking": {
      const high = sources.filter(s => s.level === "high");
      const nonHigh = sources.filter(s => s.level !== "high");
      const highNames = high.map(s => s.name);
      const surge = high.slice().sort((a, b) => b.delta - a.delta)[0];
      const soften = high.slice().sort((a, b) => a.delta - b.delta)[0];

      // Use sentence-start labels here so "News momentum" stays
      // capitalised when it's the leading clause of the base phrase.
      const labels = highNames.map(nameAtSentenceStart);
      let base: string;
      if (labels.length === 3) base = "Peak attention across every signal";
      else if (labels.length === 2) base = `Strong ${labels[0]} and ${labels[1]}`;
      else base = `Peak ${labels[0]}`;

      // Within the peak, surface the most dramatic 24h story. A surge in a
      // High source wins over softening because it's the more interesting
      // narrative when a person is already at peak levels. If a non-High
      // source is moving strongly against the peak, append that
      // divergence too — it signals e.g. wiki-driven vs media-driven.
      if (surge && surge.delta >= 15) {
        const opposing = nonHigh.slice().sort((a, b) => a.delta - b.delta)[0];
        if (opposing && opposing.delta <= -15) {
          const pct = Math.abs(Math.round(opposing.delta));
          return `${base} — ${nameAtSentenceStart(surge.name)} surging ${Math.round(surge.delta)}%, though ${nameInSentence(opposing.name)} down ${pct}%.`;
        }
        return `${base} — ${nameAtSentenceStart(surge.name)} surging ${Math.round(surge.delta)}%.`;
      }
      if (soften && soften.delta <= -15) {
        const opposing = nonHigh.slice().sort((a, b) => b.delta - a.delta)[0];
        if (opposing && opposing.delta >= 15) {
          return `${base} — ${nameInSentence(soften.name)} softening, but ${nameInSentence(opposing.name)} up ${Math.round(opposing.delta)}%.`;
        }
        return `${base} — but ${nameInSentence(soften.name)} softening.`;
      }
      return `${base} right now.`;
    }
    case "rising": {
      if (biggestMover && biggestMover.delta >= 15) {
        return `${nameAtSentenceStart(biggestMover.name)} surging — up ${Math.round(biggestMover.delta)}% in the last 24h.`;
      }
      return "Signals ticking up across the board.";
    }
    case "mixed": {
      const biggestRise = [...sources].sort((a, b) => b.delta - a.delta)[0];
      const biggestFall = [...sources].sort((a, b) => a.delta - b.delta)[0];
      if (biggestRise && biggestFall && biggestRise !== biggestFall) {
        const rPct = Math.round(biggestRise.delta);
        const fPct = Math.abs(Math.round(biggestFall.delta));
        return `${nameAtSentenceStart(biggestRise.name)} surging ${rPct}% while ${nameInSentence(biggestFall.name)} down ${fPct}%.`;
      }
      return "Signals moving in opposite directions.";
    }
    case "cooling": {
      if (biggestMover && biggestMover.delta <= -20) {
        const pct = Math.abs(Math.round(biggestMover.delta));
        // If another source is still at High level, the interest isn't
        // really "cooling" — one channel is just normalising while
        // underlying attention stays elevated. Surface that.
        const stillHigh = sources.find(s => s.level === "high" && s !== biggestMover);
        if (stillHigh) {
          return `${nameAtSentenceStart(biggestMover.name)} down ${pct}% — ${nameInSentence(stillHigh.name)} still elevated.`;
        }
        return `${nameAtSentenceStart(biggestMover.name)} down ${pct}% — interest cooling.`;
      }
      return "Attention easing across multiple signals.";
    }
    case "quiet": {
      return "Quiet across news, momentum, and Wikipedia today.";
    }
    case "steady":
    default: {
      if (biggestMover && Math.abs(biggestMover.delta) >= 6) {
        const dir = biggestMover.delta > 0 ? "ticking up" : "down";
        const pct = Math.abs(Math.round(biggestMover.delta));
        return `Steady overall — ${nameInSentence(biggestMover.name)} ${dir} ${pct}%.`;
      }
      if (strongest && strongest.level === "high") {
        // "news momentum attention" reads awkwardly because momentum is
        // already a derivative measure — drop the "attention" suffix
        // for that case so the sentence parses cleanly.
        if (strongest.name === "Momentum") {
          return "Sustained news momentum — no major shifts today.";
        }
        return `Sustained ${nameInSentence(strongest.name)} attention — no major shifts today.`;
      }
      if (strongest && strongest.level === "medium") {
        return "Baseline attention — no major shifts today.";
      }
      return "No major movement today.";
    }
  }
}

function MomentumTakeCard({ sources }: { sources: SourceSnapshot[] }) {
  const state = classifyMomentumState(sources);
  const take = composeTake(sources, state);
  const s = STATE_STYLES[state];
  const pulseClass = s.pulse ? "motion-safe:animate-pulse motion-reduce:animate-none" : "";

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-border/50 backdrop-blur-sm transition-colors duration-300",
        s.tintBg,
      )}
      data-testid="card-momentum-take"
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-90 transition-colors duration-500",
          s.tintBar,
        )}
      />
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <span className="text-xs font-medium text-muted-foreground truncate">Today's Take</span>
          <TouchTooltip
            side="top"
            contentClassName="max-w-[240px] text-xs normal-case tracking-normal"
            content="A one-line synthesis of the three signals above, classifying this person's attention as Peaking, Rising, Mixed, Steady, Cooling, or Quiet based on current levels and 24h movement."
          >
            <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" data-testid="icon-take-tooltip" />
          </TouchTooltip>
        </div>
      </CardHeader>
      <CardContent className="pt-1 pb-3 px-4 space-y-1.5">
        <div className="flex items-center gap-2.5" data-testid={`state-${state}`}>
          <span
            className={cn(
              "relative inline-flex h-2.5 w-2.5 rounded-full shrink-0 transition-colors duration-500",
              s.dotClass,
              s.glow,
              pulseClass,
            )}
            style={s.pulse ? { animationDuration: "2.4s" } : undefined}
          />
          <span className={cn("text-xl font-semibold tracking-tight transition-colors duration-500", s.text)}>
            {s.label}
          </span>
        </div>
        <p className="text-[13px] text-foreground/80 leading-snug" data-testid="text-momentum-take">
          {take}
        </p>
      </CardContent>
    </Card>
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
    bgColor: "bg-foreground/15",
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
      title={`${config.label} — @${handle}`}
      aria-label={`${config.label} profile: @${handle}`}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 transition-all",
        "hover:scale-105 hover:border-border active:scale-95 motion-reduce:hover:scale-100 motion-reduce:active:scale-100",
        config.bgColor,
      )}
      data-testid={`link-inline-profile-${platform}`}
    >
      <Icon className={cn("h-3.5 w-3.5", config.color)} />
    </a>
  );
}

function OfficialProfiles({ profiles }: { profiles: Record<string, string> }) {
  const entries = Object.entries(profiles).filter(([key]) => profileConfig[key]);
  if (entries.length === 0) return null;

  return (
    <div data-testid="section-official-profiles">
      <h3 className="text-sm font-semibold text-muted-foreground mb-2">
        {entries.length === 1 ? "Official Profile" : "Official Profiles"}
      </h3>
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
              title={`${config.label} — @${handle}`}
              aria-label={`${config.label} profile: @${handle}`}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-full border border-border/60 transition-all",
                "hover:scale-105 hover:border-border hover:ring-2 hover:ring-border/40 hover:ring-offset-2 hover:ring-offset-background",
                "active:scale-95 motion-reduce:hover:scale-100 motion-reduce:active:scale-100",
                config.bgColor,
              )}
              data-testid={`link-profile-${platform}`}
            >
              <Icon className={cn("h-[18px] w-[18px]", config.color)} />
            </a>
          );
        })}
      </div>
    </div>
  );
}
