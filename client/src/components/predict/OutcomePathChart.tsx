import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
  CartesianGrid,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { usePriceHistory } from "@/lib/ammClient";

interface OutcomePathChartProps {
  marketId: string;
  baselineScore: number;
  currentScore: number;
  personName: string;
  height?: number;
  compact?: boolean;
  userPick?: "up" | "down" | null;
  /**
   * Optional AMM Up-entry ID. When provided the chart overlays the
   * market's UP probability % on a right Y-axis (dashed teal line)
   * so users can see how the LMSR price reacted to the underlying
   * Trend Score. Parimutuel markets pass null and the overlay is
   * skipped — they fall back to the single Trend Score line.
   */
  ammUpEntryId?: string | null;
}

interface HistoryPoint {
  timestamp: string;
  fameIndex: number;
}

interface MarketHistory {
  marketId: string;
  personId: string;
  baselineScore: number | null;
  currentScore: number | null;
  startAt: string;
  endAt: string;
  status: string;
  history: HistoryPoint[];
  userEntry: {
    enteredAt: string;
    /**
     * Trend score at the user's first-bet timestamp. Null when the
     * person had no snapshots yet at trade time (rare but possible
     * for brand-new entities). The marker falls back to the closest
     * available chart point's fameIndex.
     */
    enteredScore: number | null;
    /**
     * AMM marginal price (0–1) on the side the user took, at the
     * moment of their first bet. Null for legacy bets that pre-date
     * the `pricePerShare` column or jackpot tickets.
     */
    enteredAmmPrice: number | null;
    /** entryId of the side the user took — UP, DOWN, or community side. */
    entryId: string;
    pick: string;
    stake: number;
  } | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatAxisTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function formatTooltipTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} UTC`;
}

function formatScore(n: number): string {
  return n.toLocaleString("en-US");
}

function ChartTooltip({ active, payload, baseline }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const score = point.fameIndex;
  const upProb = point.upProb;
  const delta = baseline ? score - baseline : 0;
  const pct = baseline && baseline > 0 ? ((delta / baseline) * 100).toFixed(2) : "0";
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs space-y-0.5">
      <p className="text-muted-foreground">{formatTooltipTime(point.timestamp)}</p>
      <p className="font-mono font-bold text-sm">
        <span className="text-muted-foreground/80 font-normal">Score </span>
        {formatScore(score)}
      </p>
      {baseline != null && (
        <p className={`font-semibold ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>
          {delta >= 0 ? "+" : ""}{formatScore(delta)} ({delta >= 0 ? "+" : ""}{pct}%) vs baseline
        </p>
      )}
      {typeof upProb === "number" && (
        <p className="font-mono text-cyan-600 dark:text-cyan-400">
          <span className="text-muted-foreground/80 font-normal">UP odds </span>
          {Math.round(upProb * 100)}%
        </p>
      )}
    </div>
  );
}

export function OutcomePathChart({
  marketId,
  baselineScore,
  currentScore,
  personName,
  height = 280,
  compact = false,
  userPick,
  ammUpEntryId,
}: OutcomePathChartProps) {
  const { data, isLoading } = useQuery<MarketHistory>({
    queryKey: [`/api/native-markets/${marketId}/history`],
    enabled: !!marketId,
    staleTime: 60_000,
    // Match MyPositionCard's 60s polling cadence so the chart and
    // header score stay in sync as the week unfolds. Pause polling
    // when the tab is hidden or the market has resolved.
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.hidden) return false;
      const status = (query.state.data as MarketHistory | undefined)?.status;
      if (status && status !== "OPEN") return false;
      return 60_000;
    },
    refetchOnWindowFocus: true,
  });

  // AMM probability history (UP entry only — DOWN = 1 - UP for a binary
  // market so a single line is enough). 1h buckets over 7d match the
  // headline score chart's granularity. Disabled when no entry is
  // passed so we don't fire unused requests.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const { data: ammHistory } = usePriceHistory(marketId, {
    bucket: "1h",
    fromMs: SEVEN_DAYS_MS,
    enabled: !!ammUpEntryId,
    refetchMs: 60_000,
  });

  /**
   * Index AMM price points keyed by the floor-hour of their bucket so
   * we can align them with the Trend Score history (which samples at
   * arbitrary times). We snap both timelines to the hour and forward-
   * fill the AMM series — a quiet period on the AMM (no trades) is
   * still a known price, not a gap.
   */
  const ammByHourMs = useMemo(() => {
    if (!ammUpEntryId || !ammHistory?.points) return null;
    const map = new Map<number, number>();
    for (const p of ammHistory.points) {
      if (p.entryId !== ammUpEntryId) continue;
      const t = Date.parse(p.bucket);
      if (!Number.isFinite(t)) continue;
      const hourMs = Math.floor(t / (60 * 60 * 1000)) * (60 * 60 * 1000);
      map.set(hourMs, Number(p.price));
    }
    return map;
  }, [ammHistory, ammUpEntryId]);

  const chartData = useMemo(() => {
    if (!data?.history || data.history.length === 0) return [];
    // Forward-fill AMM probability so a quiet period reads as
    // "price held" rather than a broken line.
    let lastAmm: number | undefined;
    return data.history.map((h) => {
      const t = Date.parse(h.timestamp);
      const hourMs = Number.isFinite(t)
        ? Math.floor(t / (60 * 60 * 1000)) * (60 * 60 * 1000)
        : null;
      let upProb: number | undefined;
      if (ammByHourMs && hourMs != null) {
        const v = ammByHourMs.get(hourMs);
        if (typeof v === "number") {
          lastAmm = v;
          upProb = v;
        } else if (typeof lastAmm === "number") {
          upProb = lastAmm;
        }
      }
      return {
        timestamp: h.timestamp,
        fameIndex: h.fameIndex,
        upProb,
      };
    });
  }, [data, ammByHourMs]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const scores = chartData.map((d) => d.fameIndex);
    if (baselineScore != null) scores.push(baselineScore);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const padding = (max - min) * 0.15 || 1000;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData, baselineScore]);

  const tickInterval = useMemo(() => {
    return Math.max(1, Math.floor(chartData.length / (compact ? 4 : 6)));
  }, [chartData, compact]);

  // User-entry marker — pinned at the closest historical sample to
  // their entry timestamp. We use the *score* axis (not probability)
  // because the marker is a "you entered when the score was X" pin,
  // not a "you traded at price Y" pin. Color = pick side. Memoized
  // because chartData scans are cheap on 168 hourly rows but the
  // tooltip re-renders the chart on every hover.
  //
  // IMPORTANT: this hook MUST sit above the `isLoading` / empty-data
  // early returns below — otherwise the first render (loading) runs
  // 5 hooks and the second render (data ready) runs 6, blowing up
  // Rules of Hooks ("Rendered more hooks than during the previous
  // render"). Keep all hooks above the conditional returns.
  const userBetMarker = useMemo(() => {
    const entry = data?.userEntry;
    if (!entry || chartData.length === 0) return null;
    const entryMs = Date.parse(entry.enteredAt);
    if (!Number.isFinite(entryMs)) return null;
    // Find the nearest chart point — Recharts ReferenceDot needs an
    // exact x value matching a row in the data series.
    let nearest = chartData[0];
    let nearestDelta = Math.abs(Date.parse(nearest.timestamp) - entryMs);
    for (const p of chartData) {
      const d = Math.abs(Date.parse(p.timestamp) - entryMs);
      if (d < nearestDelta) {
        nearest = p;
        nearestDelta = d;
      }
    }
    // Side detection. Prefer the explicit entryId comparison when both
    // the caller and the server gave us one (UP/DOWN markets, modern
    // /history response) because the pick label can be free-text on
    // H2H / Race. Falls back to the legacy pick-string match for
    // legacy responses without entryId and for a brief window during
    // deploys when a freshly-rebuilt client may talk to a still-warming
    // server.
    const pickStr = entry.pick?.toLowerCase();
    const isUpPick = ammUpEntryId && entry.entryId
      ? entry.entryId === ammUpEntryId
      : pickStr === "up" || pickStr === "yes";
    const isDownPick = ammUpEntryId && entry.entryId
      ? entry.entryId !== ammUpEntryId
      : pickStr === "down" || pickStr === "no";
    const color = isUpPick
      ? "#22c55e"
      : isDownPick
        ? "#ef4444"
        : "#a855f7";
    // Entry-odds reference-line position on the *UP* axis. The chart's
    // right Y-axis (`yAxisId="prob"`) plots UP-side probability, so a
    // DOWN bet at e.g. Ꝟ0.45/share shows on the chart at UP = 0.55.
    // The visible label stays in the user's own currency though — they
    // bought at "45% DOWN" mentally, not "55% UP" — so `entryProbDisplayPct`
    // keeps that perspective.
    const pps = entry.enteredAmmPrice;
    const hasPps = pps != null && Number.isFinite(pps) && pps > 0 && pps < 1;
    const entryProb = hasPps
      ? (isUpPick ? pps : 1 - pps)
      : null;
    const entryProbDisplayPct = hasPps ? Math.round(pps * 100) : null;
    return {
      x: nearest.timestamp,
      y: entry.enteredScore || nearest.fameIndex,
      color,
      entryProb,
      entryProbDisplayPct,
    };
  }, [data?.userEntry, chartData, ammUpEntryId]);

  if (isLoading) {
    return <Skeleton className="w-full" style={{ height }} />;
  }

  if (chartData.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground border border-border/30 rounded-lg bg-muted/10"
        style={{ height: compact ? 120 : height }}
      >
        Not enough trend data for chart
      </div>
    );
  }

  const firstName = personName.split(" ")[0];
  const delta = currentScore - baselineScore;
  const pctDelta = baselineScore > 0 ? ((delta / baselineScore) * 100).toFixed(1) : "0";

  // Overlay shows when the caller passed an AMM entry AND we have at
  // least one historical price point — otherwise the dashed line would
  // either flat-line at 50% (no data) or render as a single dot.
  const hasAmmOverlay = !!ammUpEntryId && chartData.some((p) => typeof p.upProb === "number");

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground px-1">
          <span>
            Baseline: <span className="font-mono font-medium text-foreground">{formatScore(baselineScore)}</span>
          </span>
          <span>
            Current: <span className="font-mono font-medium text-foreground">{formatScore(currentScore)}</span>
          </span>
          <span>
            Change:{" "}
            <span className={`font-mono font-medium ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>
              {delta >= 0 ? "+" : ""}{formatScore(delta)} ({delta >= 0 ? "+" : ""}{pctDelta}%)
            </span>
          </span>
        </div>
      )}

      {/* Legend lives ABOVE the chart now (round-2 polish). Users
          previously had to scroll past the chart to find out what
          the two lines meant; surfacing it inline at the top makes
          the chart self-explanatory on first paint. Renders in both
          compact (modal expander) and non-compact (detail page) when
          the AMM overlay is on, because the question "what are the
          lines?" came up first in modal smoke testing. */}
      {hasAmmOverlay && (
        <p className="text-[10px] text-muted-foreground px-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
          <span className="flex items-center gap-1">
            <svg width="14" height="6" aria-hidden className="shrink-0">
              <line x1="0" y1="3" x2="14" y2="3" stroke="hsl(var(--primary))" strokeWidth="2" />
            </svg>
            Trend Score
          </span>
          <span className="flex items-center gap-1">
            <svg width="14" height="6" aria-hidden className="shrink-0">
              <line
                x1="0"
                y1="3"
                x2="14"
                y2="3"
                stroke="#22d3ee"
                strokeWidth="2"
                strokeDasharray="3 2"
              />
            </svg>
            UP odds
          </span>
          {userBetMarker && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-background"
                style={{ background: userBetMarker.color }}
              />
              Your entry
            </span>
          )}
          {userBetMarker?.entryProb != null && (
            <span className="flex items-center gap-1">
              {/* Side-coloured dashed swatch mirrors the on-chart
                  ReferenceLine. Tells users at a glance "this line
                  is where you bought in" without crowding the chart
                  with a verbose inline label.
                  `entryProbDisplayPct` is null-safe here because it
                  derives from the same `hasPps` guard that makes
                  `entryProb` non-null. */}
              <svg width="14" height="6" aria-hidden className="shrink-0">
                <line
                  x1="0"
                  y1="3"
                  x2="14"
                  y2="3"
                  stroke={userBetMarker.color}
                  strokeWidth="2"
                  strokeDasharray="3 2"
                />
              </svg>
              Entry odds ({userBetMarker.entryProbDisplayPct}%)
            </span>
          )}
        </p>
      )}

      <div style={{ height: compact ? 140 : height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: hasAmmOverlay ? 36 : 8, left: compact ? 0 : 4, bottom: 5 }}>
            <defs>
              <linearGradient id={`aboveBaseline-${marketId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`belowBaseline-${marketId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.2} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.08} />
            {!compact && (
              <XAxis
                dataKey="timestamp"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                tickFormatter={formatAxisTime}
                interval={tickInterval}
                axisLine={false}
                tickLine={false}
                tickMargin={6}
              />
            )}
            <YAxis
              yAxisId="score"
              domain={yDomain as [number, number]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
              axisLine={false}
              tickLine={false}
              width={compact ? 36 : 44}
              mirror={compact}
            />
            {hasAmmOverlay && (
              <YAxis
                yAxisId="prob"
                orientation="right"
                domain={[0, 1]}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                tick={{ fill: "#22d3ee", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
            )}
            {/* Crosshair cursor (round-2 polish, Avatrade-style). The
                default recharts cursor is a thin solid line which
                disappears against the area fill. A dashed muted line
                reads as a "you're inspecting here" affordance without
                competing with the data series. */}
            <Tooltip
              content={<ChartTooltip baseline={baselineScore} />}
              cursor={{
                stroke: "hsl(var(--foreground))",
                strokeWidth: 1,
                strokeDasharray: "2 3",
                strokeOpacity: 0.5,
              }}
            />
            {baselineScore != null && (
              <ReferenceLine
                yAxisId="score"
                y={baselineScore}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="6 3"
                strokeOpacity={0.5}
                label={compact ? undefined : { value: "Baseline", position: "right", fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              />
            )}
            <Area
              yAxisId="score"
              type="monotone"
              dataKey="fameIndex"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill={delta >= 0 ? `url(#aboveBaseline-${marketId})` : `url(#belowBaseline-${marketId})`}
              dot={false}
              activeDot={{
                r: compact ? 3 : 5,
                fill: "hsl(var(--primary))",
                stroke: "hsl(var(--background))",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
            {hasAmmOverlay && (
              <Line
                yAxisId="prob"
                type="monotone"
                dataKey="upProb"
                // Brightened from cyan-500 (#06b6d4) → cyan-400
                // (#22d3ee) at 2px so the dashed line reads clearly
                // against the area-fill underneath the Trend Score
                // (round-2 polish).
                stroke="#22d3ee"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                // activeDot pins a visible point on the UP odds line
                // at the tooltip's x position so the "UP odds 63%"
                // tooltip line ties to a concrete dot on the line
                // (not just to the area fill behind it).
                activeDot={{
                  r: 4,
                  fill: "#22d3ee",
                  stroke: "hsl(var(--background))",
                  strokeWidth: 2,
                }}
                isAnimationActive={false}
                connectNulls
              />
            )}
            {/* Entry-odds reference line (sprint 4.2, repositioned in
                4.3 to render AFTER the Area + Line so its dashes and
                label paint *on top of* the trend score area instead
                of behind it — fixes the "Entry 57%" text being
                bisected by the blue trend line that smoke testing
                surfaced on Jamie Dimon / Peter Thiel charts).
                Side-coloured horizontal dashed line on the UP-
                probability axis at the AMM marginal price the user
                bought at. Paired with the green/red entry dot on the
                score axis below this tells the full P&L story: dot
                says WHEN you entered, line says AT WHAT ODDS — and
                the visible gap to the cyan UP-odds line is your
                per-share P&L. Only renders when the AMM overlay is
                on (otherwise there's no prob axis to plot against)
                and the server surfaced a finite pricePerShare. */}
            {hasAmmOverlay && userBetMarker?.entryProb != null && (
              <ReferenceLine
                yAxisId="prob"
                y={userBetMarker.entryProb}
                stroke={userBetMarker.color}
                strokeDasharray="3 3"
                strokeOpacity={0.55}
                strokeWidth={1.5}
                label={
                  compact
                    ? undefined
                    : {
                        value: `Entry ${userBetMarker.entryProbDisplayPct}%`,
                        position: "insideLeft",
                        fill: userBetMarker.color,
                        fontSize: 9,
                      }
                }
                ifOverflow="visible"
              />
            )}
            {/* "You bet here" marker. Server returns at most one entry
                per user per market (the first one — same-side top-ups
                aggregate, opposite-side hedges are blocked). Pin it on
                the score axis so it lands on the user's pick at the
                time they entered. */}
            {userBetMarker && (
              <ReferenceDot
                yAxisId="score"
                x={userBetMarker.x}
                y={userBetMarker.y}
                r={5}
                fill={userBetMarker.color}
                stroke="hsl(var(--background))"
                strokeWidth={2}
                ifOverflow="visible"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {!compact && userPick && (
        <p className="text-[11px] text-muted-foreground px-1">
          {userPick === "up" ? (
            delta >= 0 ? (
              <>Your UP position is in the lead. {firstName} is {formatScore(Math.abs(delta))} above baseline.</>
            ) : (
              <>Your UP position needs +{formatScore(Math.abs(delta) + 1)} points by close.</>
            )
          ) : (
            delta < 0 ? (
              <>Your DOWN position is in the lead. {firstName} is {formatScore(Math.abs(delta))} below baseline.</>
            ) : (
              <>Your DOWN position needs {firstName} to drop below {formatScore(baselineScore)} by close.</>
            )
          )}
        </p>
      )}
    </div>
  );
}
