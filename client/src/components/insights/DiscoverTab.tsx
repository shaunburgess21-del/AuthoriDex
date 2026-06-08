import { Link } from "wouter";
import type {
  InsightsDivergenceType,
  InsightsDiscoverRow,
  InsightsSingleSourceSurgeRow,
} from "@shared/insights/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { shareInsightsView } from "@/lib/insights-share";
import { ChartOrList } from "./ChartOrList";
import { SentimentMiniBar } from "./SentimentMiniBar";
import { InsightsSection, InsightsEmptyState } from "./insights-ui";
import { QuadrantSection } from "./QuadrantSection";
import { useInsightsOverview, useInsightsQuery } from "@/lib/insights-hooks";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const DIVERGENCE_CARDS: Array<{ type: InsightsDivergenceType; title: string; description: string }> = [
  {
    type: "rising_disliked",
    title: "Rising but Disliked",
    description: "High 7d momentum, low approval percentile",
  },
  {
    type: "underrated_gaining",
    title: "Underrated & Gaining",
    description: "Crowd says underrated while signals rise",
  },
  {
    type: "overrated_cooling",
    title: "Overrated & Cooling",
    description: "Crowd says overrated while signals cool",
  },
  {
    type: "consensus",
    title: "Consensus Sweet Spot",
    description: "High approval with fair-rating consensus",
  },
];

const PRESS_VS_CROWD_CARDS: Array<{
  type: Extract<InsightsDivergenceType, "press_loved_crowd_cool" | "crowd_loved_press_critical">;
  title: string;
  description: string;
}> = [
  {
    type: "press_loved_crowd_cool",
    title: "Web Darling, Crowd Skeptic",
    description: "Online sentiment reads positive; crowd approval is low",
  },
  {
    type: "crowd_loved_press_critical",
    title: "Crowd Favorite, Web Critic",
    description: "Crowd approval is high; online sentiment reads negative",
  },
];

type BreakoutRow = {
  id: string;
  name: string;
  avatar: string | null;
  highlight: string;
  rank: number;
};

type PolarisationRow = {
  id: string;
  slug: string | null;
  title: string;
  maxPct: number;
  spreadStddev?: number | null;
  kind: string;
};

function polarisationHref(item: { kind: string; slug: string | null }): string | null {
  if (!item.slug) return null;
  return item.kind === "opinion_poll"
    ? `/vote/opinion-polls/${item.slug}`
    : `/vote/matchups/${item.slug}`;
}

function DivergenceCard({
  type,
  title,
  description,
}: {
  type: InsightsDivergenceType;
  title: string;
  description: string;
}) {
  const { data, isLoading } = useInsightsQuery<{ rows: InsightsDiscoverRow[]; total: number }>(
    `/api/insights/discover/divergence?type=${type}&limit=5`,
    { queryKey: ["/api/insights/discover/divergence", type] },
  );

  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3 h-full flex flex-col">
      <h4 className="font-medium text-sm">{title}</h4>
      <p className="text-xs text-muted-foreground mb-3 mt-0.5">{description}</p>
      {isLoading && <Skeleton className="h-16 w-full flex-1" />}
      <ul className="space-y-2 flex-1">
        {data?.rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/person/${row.id}`}
              onClick={() => logInsightsEvent("discover", "divergence_row_click", { type, personId: row.id })}
              className="flex items-center gap-2 text-sm hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <PersonAvatar name={row.name} avatar={row.avatar} size="xs" />
              <span className="truncate flex-1 font-medium">{row.name}</span>
            </Link>
            <p className="text-[10px] text-muted-foreground ml-8 leading-snug">{row.highlight}</p>
          </li>
        ))}
        {data && data.rows.length === 0 && (
          <li className="text-xs text-muted-foreground">No matches right now.</li>
        )}
      </ul>
    </div>
  );
}

function PressVsCrowdCard({
  type,
  title,
  description,
}: {
  type: Extract<InsightsDivergenceType, "press_loved_crowd_cool" | "crowd_loved_press_critical">;
  title: string;
  description: string;
}) {
  const { data, isLoading } = useInsightsQuery<{ rows: InsightsDiscoverRow[]; total: number }>(
    `/api/insights/discover/divergence?type=${type}&limit=5`,
    { queryKey: ["/api/insights/discover/divergence", type] },
  );

  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3 h-full flex flex-col">
      <h4 className="font-medium text-sm">{title}</h4>
      <p className="text-xs text-muted-foreground mb-3 mt-0.5">{description}</p>
      {isLoading && <Skeleton className="h-20 w-full flex-1" />}
      <ul className="space-y-3 flex-1">
        {data?.rows.map((row) => {
          const webPct = row.webSentimentPositivePct;
          const crowdPct = row.approvalPct;
          const gap = row.sentimentApprovalGap;
          return (
            <li key={row.id} className="rounded-md border border-border/30 p-2">
              <Link
                href={`/person/${row.id}`}
                onClick={() =>
                  logInsightsEvent("discover", "divergence_row_click", { type, personId: row.id })
                }
                className="flex items-center gap-2 text-sm hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <PersonAvatar name={row.name} avatar={row.avatar} size="xs" />
                <span className="truncate flex-1 font-medium">{row.name}</span>
                {gap != null && (
                  <span
                    className={cn(
                      "text-[10px] font-mono font-semibold tabular-nums shrink-0 px-1.5 py-0.5 rounded",
                      gap > 0
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-rose-500/15 text-rose-700 dark:text-rose-400",
                    )}
                  >
                    {gap > 0 ? "+" : ""}
                    {gap} pt
                  </span>
                )}
              </Link>
              {webPct != null && crowdPct != null && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground ml-8 mt-1 font-mono tabular-nums">
                  <span>
                    Web{" "}
                    <span className="text-foreground font-medium">{Math.round(webPct)}%</span> pos
                  </span>
                  <span>
                    Crowd{" "}
                    <span className="text-foreground font-medium">{Math.round(crowdPct)}%</span>{" "}
                    approval
                  </span>
                </div>
              )}
              {(row.webSentimentPositive ?? 0) + (row.webSentimentNegative ?? 0) > 0 && (
                <div className="ml-8">
                  <SentimentMiniBar
                    positive={row.webSentimentPositive ?? 0}
                    negative={row.webSentimentNegative ?? 0}
                    showCounts={false}
                  />
                </div>
              )}
            </li>
          );
        })}
        {data && data.rows.length === 0 && (
          <li className="text-xs text-muted-foreground leading-relaxed">
            No matches yet — needs web-sentiment coverage and 20+ approval votes.
          </li>
        )}
      </ul>
    </div>
  );
}

function PersonRowLink({
  id,
  name,
  avatar,
  meta,
  onClick,
}: {
  id: string;
  name: string;
  avatar: string | null;
  meta?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={`/person/${id}`}
      onClick={onClick}
      className="flex items-center gap-2 p-2 rounded-md border border-border/30 hover:bg-muted/40 transition-colors"
    >
      <PersonAvatar name={name} avatar={avatar} size="xs" />
      <span className="truncate flex-1 text-sm font-medium">{name}</span>
      {meta && <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{meta}</span>}
    </Link>
  );
}

export function DiscoverTab() {
  const { data: overview } = useInsightsOverview();

  const { data: surge, isLoading: surgeLoading } = useInsightsQuery<{
    rows: InsightsSingleSourceSurgeRow[];
    total: number;
  }>("/api/insights/discover/single-source-surge?limit=8", {
    queryKey: ["/api/insights/discover/single-source-surge"],
  });

  const { data: breakout, isLoading: breakoutLoading } = useInsightsQuery<{
    lowRank: BreakoutRow[];
    newEntrants: BreakoutRow[];
    quietGiants: BreakoutRow[];
    coolingTop: BreakoutRow[];
  }>("/api/insights/discover/breakout");

  const { data: volatility, isLoading: volLoading } = useInsightsQuery<{
    volatile: Array<{ id: string; name: string; avatar: string | null; stddev: number; rank: number }>;
    stable: Array<{ id: string; name: string; avatar: string | null; stddev: number; rank: number }>;
    sampleFloor: number;
  }>("/api/insights/discover/volatility");

  const { data: polarisation, isLoading: polLoading } = useInsightsQuery<{
    lopsided: PolarisationRow[];
    evenlySplit: PolarisationRow[];
  }>("/api/insights/discover/polarisation");

  const { data: discussed, isLoading: discussedLoading } = useInsightsQuery<{
    rows: Array<{ id: string; name: string; avatar: string | null; insightCount: number; rank: number }>;
  }>("/api/insights/discover/most-discussed");

  const { data: streaks, isLoading: streaksLoading } = useInsightsQuery<{
    firstTimeTop10: Array<{ id: string; name: string; avatar: string | null; rank: number; firstTop10At: string | null }>;
    longestStreaks: Array<{ id: string; name: string; avatar: string | null; streakHours: number; rank: number }>;
    retentionDays: number;
  }>("/api/insights/discover/streaks");

  const { data: heatmap, isLoading: heatmapLoading } = useInsightsQuery<{
    rows: Array<{
      category: string;
      median24h: number;
      median7d: number;
      hottest: { id: string; name: string; avatar: string | null; change7d: number | null } | null;
    }>;
  }>("/api/insights/discover/category-heatmap");

  const handleShareDiscover = async () => {
    try {
      const result = await shareInsightsView({
        tab: "discover",
        title: "VoxDex Insights — Discover",
        text: "Crowd vs data stories on VoxDex",
        surface: "discover",
      });
      toast(result === "shared" ? "Shared" : "Link copied", {
        description: result === "shared" ? "Thanks for spreading the word." : "Insights link copied to clipboard.",
      });
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 h-8"
          onClick={handleShareDiscover}
        >
          <Share2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Share this view</span>
        </Button>
      </div>

      <InsightsSection
        tab="discover"
        title="Crowd vs Data Divergence"
        description="Stories only VoxDex can tell — where votes and signals disagree."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
          {DIVERGENCE_CARDS.map((card) => (
            <DivergenceCard key={card.type} {...card} />
          ))}
        </div>
      </InsightsSection>

      {overview && overview.quadrantPoints.length > 0 && (
        <QuadrantSection points={overview.quadrantPoints} meta={overview.quadrantMeta} />
      )}

      <InsightsSection
        tab="discover"
        title="Web vs Crowd"
        description="Where organic web sentiment and crowd Approval pull in opposite directions."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {PRESS_VS_CROWD_CARDS.map((card) => (
            <PressVsCrowdCard key={card.type} {...card} />
          ))}
        </div>
      </InsightsSection>

      <InsightsSection
        tab="discover"
        title="Single-source surge"
        description="People where one signal — news, Wikipedia, or search — is hot while the others stay quiet. A uniquely multi-source view."
      >
        {surgeLoading && <Skeleton className="h-32 w-full" />}
        {!surgeLoading && (surge?.rows.length ?? 0) === 0 && (
          <InsightsEmptyState message="No single-source surges right now — attention looks balanced across news, Wikipedia, and search." />
        )}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {surge?.rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/person/${row.id}`}
                className="flex items-center gap-2.5 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors h-full"
                onClick={() => logInsightsEvent("discover", "surge_row_click", { personId: row.id })}
              >
                <PersonAvatar name={row.name} avatar={row.avatar} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{row.name}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">
                    {row.surgeSource} surge
                  </p>
                </div>
                <span className="text-xs font-mono text-muted-foreground">#{row.rank}</span>
              </Link>
            </li>
          ))}
        </ul>
      </InsightsSection>

      <InsightsSection tab="discover" title="Movement" description="Breakout radar and fame volatility (30d).">
        {breakoutLoading && <Skeleton className="h-40 w-full" />}
        {!breakoutLoading && breakout && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["lowRank", "Low rank, high momentum"],
                ["newEntrants", "New top-50 entrants"],
                ["quietGiants", "Quiet giants"],
                ["coolingTop", "Cooling at the top"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="rounded-lg border border-border/40 p-3">
                <h4 className="text-sm font-medium mb-2">{label}</h4>
                <ul className="space-y-1">
                  {breakout[key].length === 0 && (
                    <li className="text-xs text-muted-foreground">None right now.</li>
                  )}
                  {breakout[key].map((p) => (
                    <li key={p.id}>
                      <PersonRowLink
                        id={p.id}
                        name={p.name}
                        avatar={p.avatar}
                        meta={`#${p.rank}`}
                        onClick={() => logInsightsEvent("discover", "breakout_row", { bucket: key, personId: p.id })}
                      />
                      <p className="text-[10px] text-muted-foreground ml-8">{p.highlight}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {volLoading && <Skeleton className="h-32 w-full mt-4" />}
        {!volLoading && volatility && (
          <div className="grid gap-4 md:grid-cols-2 mt-4">
            <div>
              <h4 className="text-sm font-medium">Most volatile</h4>
              <p className="text-[11px] text-muted-foreground mb-2">Biggest day-to-day Trend Score swings (30d).</p>
              <ul className="space-y-1">
                {volatility.volatile.map((p) => (
                  <li key={p.id}>
                    <PersonRowLink
                      id={p.id}
                      name={p.name}
                      avatar={p.avatar}
                      meta={`Swing ${Math.round(p.stddev).toLocaleString()}`}
                      onClick={() => logInsightsEvent("discover", "volatility_row", { kind: "volatile", personId: p.id })}
                    />
                  </li>
                ))}
                {volatility.volatile.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    Not enough recent data yet.
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium">Most stable</h4>
              <p className="text-[11px] text-muted-foreground mb-2">Steadiest Trend Score over the last 30 days.</p>
              <ul className="space-y-1">
                {volatility.stable.map((p) => (
                  <li key={p.id}>
                    <PersonRowLink
                      id={p.id}
                      name={p.name}
                      avatar={p.avatar}
                      meta={`Swing ${Math.round(p.stddev).toLocaleString()}`}
                      onClick={() => logInsightsEvent("discover", "volatility_row", { kind: "stable", personId: p.id })}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </InsightsSection>

      <InsightsSection tab="discover" title="Crowd dynamics" description="Polarised votes and community discussion.">
        {polLoading && <Skeleton className="h-32 w-full" />}
        {!polLoading && polarisation && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="text-sm font-medium mb-2">Most lopsided</h4>
              <ul className="space-y-2 text-sm">
                {polarisation.lopsided.map((item) => {
                  const href = polarisationHref(item);
                  return (
                    <li key={`${item.kind}-${item.id}`} className="text-muted-foreground">
                      {href ? (
                        <Link
                          href={href}
                          className="text-foreground font-medium hover:text-blue-600 dark:hover:text-blue-400"
                          onClick={() =>
                            logInsightsEvent("discover", "polarisation_click", {
                              kind: item.kind,
                              id: item.id,
                            })
                          }
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <span className="text-foreground font-medium">{item.title}</span>
                      )}
                      <span className="ml-1 tabular-nums">({item.maxPct.toFixed(0)}% lead)</span>
                    </li>
                  );
                })}
                {polarisation.lopsided.length === 0 && (
                  <li className="text-xs">No live polls or face-offs with votes yet.</li>
                )}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">Most evenly split</h4>
              <ul className="space-y-2 text-sm">
                {polarisation.evenlySplit.map((item) => {
                  const href = polarisationHref(item);
                  return (
                    <li key={`${item.kind}-${item.id}`} className="text-muted-foreground">
                      {href ? (
                        <Link
                          href={href}
                          className="text-foreground font-medium hover:text-blue-600 dark:hover:text-blue-400"
                          onClick={() =>
                            logInsightsEvent("discover", "polarisation_click", {
                              kind: item.kind,
                              id: item.id,
                            })
                          }
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <span className="text-foreground font-medium">{item.title}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}

        {discussedLoading && <Skeleton className="h-24 w-full mt-4" />}
        {!discussedLoading && discussed && (
          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">Most discussed (7d)</h4>
            <ul className="grid gap-2 sm:grid-cols-2">
              {discussed.rows.map((row) => (
                <li key={row.id}>
                  <PersonRowLink
                    id={row.id}
                    name={row.name}
                    avatar={row.avatar}
                    meta={`${row.insightCount} posts`}
                    onClick={() => logInsightsEvent("discover", "discussed_row", { personId: row.id })}
                  />
                </li>
              ))}
              {discussed.rows.length === 0 && (
                <li className="text-xs text-muted-foreground col-span-2">No community insights this week.</li>
              )}
            </ul>
          </div>
        )}
      </InsightsSection>

      <InsightsSection
        tab="discover"
        title="History"
        description="First-time top-10 entries and longest top-10 streaks."
      >
        {streaksLoading && <Skeleton className="h-32 w-full" />}
        {!streaksLoading && streaks && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="text-sm font-medium mb-2">First-time top 10 (30d)</h4>
              <ul className="space-y-1">
                {streaks.firstTimeTop10.map((p) => (
                  <li key={p.id}>
                    <PersonRowLink id={p.id} name={p.name} avatar={p.avatar} meta={`#${p.rank}`} />
                  </li>
                ))}
                {streaks.firstTimeTop10.length === 0 && (
                  <li className="text-xs text-muted-foreground">No first-time entrants recently.</li>
                )}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">Longest top-10 streaks</h4>
              <ul className="space-y-1">
                {streaks.longestStreaks.map((p) => (
                  <li key={p.id}>
                    <PersonRowLink
                      id={p.id}
                      name={p.name}
                      avatar={p.avatar}
                      meta={`${Math.round(p.streakHours / 24)}d`}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-3">
          Based on hourly ingest snapshots (last {streaks?.retentionDays ?? 90} days).
        </p>
      </InsightsSection>

      <InsightsSection
        tab="discover"
        title="Category heatmap"
        description="7-day median movement per category — green is heating up, red is cooling."
      >
        {heatmapLoading && <Skeleton className="h-40 w-full" />}
        {!heatmapLoading && heatmap && heatmap.rows.length === 0 && (
          <InsightsEmptyState message="No category data yet — needs at least a week of snapshots." />
        )}
        {!heatmapLoading && heatmap && heatmap.rows.length > 0 && (
          <ChartOrList
            chart={
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {heatmap.rows.map((row) => {
                  // Diverging 5-band scale: strong red → light red → neutral
                  // → light green → strong green. Reads cleanly at a glance.
                  const tier =
                    row.median7d >= 10
                      ? "strong-green"
                      : row.median7d >= 3
                        ? "light-green"
                        : row.median7d <= -10
                          ? "strong-red"
                          : row.median7d <= -3
                            ? "light-red"
                            : "neutral";
                  const tone = {
                    "strong-green":
                      "border-green-500/60 bg-green-500/20 text-green-700 dark:text-green-300",
                    "light-green":
                      "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
                    neutral: "border-border/40 bg-muted/20 text-foreground",
                    "light-red":
                      "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
                    "strong-red":
                      "border-red-500/60 bg-red-500/20 text-red-600 dark:text-red-400",
                  }[tier];

                  return (
                    <div
                      key={row.category}
                      className={cn("rounded-lg border p-3 text-center", tone)}
                    >
                      <p className="text-xs font-medium truncate text-foreground/90">
                        {row.category}
                      </p>
                      <p className="text-lg font-semibold tabular-nums mt-1">
                        {row.median7d >= 0 ? "+" : ""}
                        {row.median7d.toFixed(1)}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">7d median</p>
                      {row.hottest && (
                        <Link
                          href={`/person/${row.hottest.id}`}
                          className="text-[10px] mt-2 truncate block hover:underline text-foreground/80"
                          onClick={() =>
                            logInsightsEvent("discover", "heatmap_person", {
                              category: row.category,
                              personId: row.hottest!.id,
                            })
                          }
                        >
                          {row.hottest.name}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            }
            list={
              <ol className="space-y-2">
                {heatmap.rows.map((row, i) => (
                  <li
                    key={row.category}
                    className="flex items-center gap-2 text-sm border-b border-border/30 pb-2"
                  >
                    <span className="text-muted-foreground w-5 tabular-nums">{i + 1}</span>
                    <span className="flex-1 font-medium">{row.category}</span>
                    <span
                      className={cn(
                        "tabular-nums font-semibold",
                        row.median7d > 0 && "text-green-600 dark:text-green-400",
                        row.median7d < 0 && "text-red-500",
                        row.median7d === 0 && "text-muted-foreground",
                      )}
                    >
                      {row.median7d >= 0 ? "+" : ""}
                      {row.median7d.toFixed(1)}% 7d
                    </span>
                  </li>
                ))}
              </ol>
            }
          />
        )}
      </InsightsSection>
    </div>
  );
}
