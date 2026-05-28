import { Link, useLocation } from "wouter";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useInsightsOverview } from "@/lib/insights-hooks";
import { ChartOrList } from "./ChartOrList";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { writeInsightsQuery } from "@shared/insights/filters";
import type { InsightsQuadrantPoint } from "@shared/insights/types";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { useAuth } from "@/contexts/AuthContext";
import {
  InsightsSection,
  DRIVER_DISPLAY,
  InsightsEmptyState,
} from "./insights-ui";
const QUADRANT_LABELS: Record<InsightsQuadrantPoint["quadrant"], string> = {
  beloved_giants: "Beloved Giants",
  hated_giants: "Hated Giants",
  cult_favourites: "Cult Favourites",
  unknown_critics: "Unknown Critics",
};

const QUADRANT_COLORS: Record<InsightsQuadrantPoint["quadrant"], string> = {
  beloved_giants: "hsl(142 71% 45%)",
  hated_giants: "hsl(0 84% 60%)",
  cult_favourites: "hsl(217 91% 60%)",
  unknown_critics: "hsl(271 81% 56%)",
};

function QuadrantTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: InsightsQuadrantPoint }>;
}) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{p.name}</p>
      <p className="text-muted-foreground mt-0.5">
        Fame {p.fameIndex} · Approval {Math.round(p.approvalPct)}%
      </p>
    </div>
  );
}

function QuadrantMobileLists({ points }: { points: InsightsQuadrantPoint[] }) {
  const groups = (Object.keys(QUADRANT_LABELS) as InsightsQuadrantPoint["quadrant"][]).map((q) => ({
    quadrant: q,
    items: points.filter((p) => p.quadrant === q).slice(0, 5),
  }));

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {groups.map(({ quadrant, items }) => (
        <details
          key={quadrant}
          className="rounded-lg border border-border/40 bg-background/40 p-3"
          open={items.length > 0}
        >
          <summary className="font-medium text-sm cursor-pointer list-none flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: QUADRANT_COLORS[quadrant] }}
            />
            {QUADRANT_LABELS[quadrant]}
            <span className="text-muted-foreground font-normal">({items.length})</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {items.map((p) => (
              <li key={p.id}>
                <Link href={`/person/${p.id}`} className="flex items-center gap-2 text-sm">
                  <PersonAvatar name={p.name} avatar={p.avatar} size="xs" />
                  <span className="truncate flex-1">{p.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">FI {p.fameIndex}</span>
                </Link>
              </li>
            ))}
            {items.length === 0 && (
              <li className="text-xs text-muted-foreground">No names in this quadrant.</li>
            )}
          </ul>
        </details>
      ))}
    </div>
  );
}

function MoverList({
  items,
  positive,
}: {
  items: Array<{
    id: string;
    name: string;
    avatar: string | null;
    category: string | null;
    change7d: number | null;
    rank: number;
  }>;
  positive: boolean;
}) {
  if (items.length === 0) {
    return <InsightsEmptyState message={positive ? "No climbers this week." : "No droppers this week."} />;
  }
  return (
    <div className="space-y-1.5">
      {items.map((m) => (
        <Link
          key={m.id}
          href={`/person/${m.id}`}
          className="flex items-center gap-2.5 text-sm p-2.5 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
        >
          <span className="text-[10px] font-mono text-muted-foreground w-6">#{m.rank}</span>
          <PersonAvatar name={m.name} avatar={m.avatar} size="xs" />
          <span className="truncate flex-1 font-medium">{m.name}</span>
          <span
            className={`tabular-nums text-xs font-semibold ${positive ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
          >
            {positive ? "+" : ""}
            {(m.change7d ?? 0).toFixed(1)}%
          </span>
        </Link>
      ))}
    </div>
  );
}

export function OverviewTab() {
  const { isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  const { data, isLoading, isError } = useInsightsOverview();

  if (isLoading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="text-sm text-destructive">Could not load overview. Try again shortly.</p>;
  }

  const { story, movers, driverMix, quadrantPoints, quadrantMeta, favouritesSignals } = data;

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="relative overflow-hidden rounded-xl pulse-card-voxdex border border-border/50">
        <div className="p-5 md:p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-blue-500/15 p-2 shrink-0">
              <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                Today&apos;s story
              </p>
              <h2 className="text-lg md:text-xl font-serif font-semibold mt-1 leading-snug">
                {story.headline}
              </h2>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{story.body}</p>
              <p className="text-[10px] text-muted-foreground/70 mt-3">
                {story.mode === "ai" ? "AI summary" : "Live data snapshot"} · next refresh{" "}
                {new Date(story.refreshesAt).toLocaleString(undefined, {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <InsightsSection
          title="Board movers"
          description="Biggest 7-day climbers and droppers on the Fame Index."
          accent="blue"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5 text-green-600" /> Climbers
              </p>
              <MoverList items={movers.climbers.slice(0, 8)} positive />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <TrendingDown className="h-3.5 w-3.5 text-red-500" /> Droppers
              </p>
              <MoverList items={movers.droppers.slice(0, 8)} positive={false} />
            </div>
          </div>
        </InsightsSection>

        {isLoggedIn && favouritesSignals && (
          <InsightsSection title="Your favourites" description="Signals from people you follow.">
            <p className="text-sm text-muted-foreground leading-relaxed">{favouritesSignals.summary}</p>
            <ul className="mt-3 space-y-2">
              {favouritesSignals.highlights.map((h) => (
                <li key={h.personId}>
                  <Link
                    href={`/person/${h.personId}`}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {h.message}
                  </Link>
                </li>
              ))}
            </ul>
          </InsightsSection>
        )}
      </div>

      <InsightsSection
        title="Approval × Fame"
        description={`${quadrantMeta.includedCount} people with ≥${quadrantMeta.minVotes} votes. Median split shown on desktop.`}
        accent="voxdex"
      >
        <ChartOrList
          chart={
            <div className="h-[300px] md:h-[420px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis
                    type="number"
                    dataKey="fameIndex"
                    name="Fame"
                    tick={{ fontSize: 11 }}
                    label={{ value: "Fame Index", position: "bottom", offset: 0, fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="approvalPct"
                    name="Approval"
                    tick={{ fontSize: 11 }}
                    domain={[0, 100]}
                    label={{
                      value: "Approval %",
                      angle: -90,
                      position: "insideLeft",
                      fontSize: 11,
                    }}
                  />
                  <ReferenceLine
                    x={quadrantMeta.medianFame}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />
                  <ReferenceLine
                    y={quadrantMeta.medianApproval}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />
                  <Tooltip content={<QuadrantTooltip />} />
                  <Scatter
                    data={quadrantPoints}
                    onClick={(pt) => {
                      const p = pt as InsightsQuadrantPoint;
                      logInsightsEvent("overview", "quadrant_click", { personId: p.id });
                      setLocation(`/person/${p.id}`);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {quadrantPoints.map((p) => (
                      <Cell key={p.id} fill={QUADRANT_COLORS[p.quadrant]} fillOpacity={0.85} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          }
          list={<QuadrantMobileLists points={quadrantPoints} />}
        />
      </InsightsSection>

      <InsightsSection
        title={`Driver mix · top ${driverMix.topN}`}
        description="What is leading attention right now — tap a bar to open matching rankings."
      >
        <div className="space-y-3 max-w-2xl">
          {driverMix.segments.map((seg) => (
            <button
              key={seg.driver}
              type="button"
              className="w-full text-left group"
              onClick={() => {
                logInsightsEvent("overview", "driver_slice_click", { driver: seg.driver });
                const sourceMap: Record<string, string> = {
                  NEWS: "news_momentum",
                  WIKI: "wiki_momentum",
                  // Search-led → Most Searched ranking (Google Trends ranking retired).
                  TRENDS: "search_volume",
                  VELOCITY: "velocity",
                  MASS: "mass",
                  MIXED: "news_momentum",
                };
                writeInsightsQuery({
                  tab: "rankings",
                  filters: { source: (sourceMap[seg.driver] ?? "news_momentum") as never },
                });
              }}
            >
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {DRIVER_DISPLAY[seg.driver] ?? seg.driver}
                </span>
                <span className="text-muted-foreground tabular-nums">{seg.pct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted/80 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600/80 to-blue-400/60 transition-all"
                  style={{ width: `${Math.max(seg.pct, 2)}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      </InsightsSection>
    </div>
  );
}
