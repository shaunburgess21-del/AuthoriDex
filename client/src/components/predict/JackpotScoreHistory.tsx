import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type HistoryRange = "7D" | "30D";

/** Shape returned by `/api/trending/:id/history?slim=1`. */
interface SlimHistoryPoint {
  timestamp: string;
  fameIndex: number | null;
}

/** A point that survived the null/zero filter and is safe to plot. */
interface PlottablePoint {
  timestamp: string;
  fameIndex: number;
}

interface JackpotScoreHistoryProps {
  personId: string;
  personName: string;
  /** Live score shown in the modal header; used as the "Now" chip fallback. */
  currentScore: number;
  /** Fills the modal's score input. */
  onPickScore: (score: number) => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}

function formatAxisDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function formatTooltipDate(iso: string, range: HistoryRange): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (range === "7D") {
    return `${base}, ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;
  }
  return base;
}

/**
 * Friday-close → Sunday-close spans present in the series.
 *
 * The jackpot locks entries on Friday 23:59 UTC but settles on the Sunday
 * 23:59 UTC snapshot, so these bands are the part of the chart the user is
 * actually being asked to forecast. Shading them is the whole point of showing
 * history here — the weekend pattern should be visible rather than asserted.
 */
function computeWeekendBands(points: PlottablePoint[]): { x1: string; x2: string }[] {
  const lastOfDay = new Map<string, string>();
  for (const point of points) {
    lastOfDay.set(point.timestamp.slice(0, 10), point.timestamp);
  }

  const bands: { x1: string; x2: string }[] = [];
  for (const [day, timestamp] of lastOfDay) {
    const dayStart = new Date(`${day}T00:00:00Z`);
    if (isNaN(dayStart.getTime()) || dayStart.getUTCDay() !== 5) continue;
    const sundayKey = new Date(dayStart.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const sundayTimestamp = lastOfDay.get(sundayKey);
    if (sundayTimestamp) bands.push({ x1: timestamp, x2: sundayTimestamp });
  }
  return bands;
}

export function JackpotScoreHistory({
  personId,
  personName,
  currentScore,
  onPickScore,
}: JackpotScoreHistoryProps) {
  const [range, setRange] = useState<HistoryRange>("30D");
  // Resolved synchronously on first render. `useIsMobile` reports false until
  // its effect runs, which would flash the full chart on phones before
  // collapsing it — and would fire the query we're trying to defer.
  const [expanded, setExpanded] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 768,
  );

  // 7D stays hourly for shape; 30D collapses to one point per UTC day so the
  // modal pulls ~31 rows instead of ~720.
  const days = range === "7D" ? 7 : 30;
  const intervalParam = range === "7D" ? "" : "&interval=day";
  const showChart = expanded;

  const { data, isLoading, isError } = useQuery<SlimHistoryPoint[]>({
    queryKey: [`/api/trending/${personId}/history?days=${days}${intervalParam}&slim=1`],
    enabled: showChart,
    staleTime: 5 * 60_000,
  });

  const points = useMemo<PlottablePoint[]>(
    () =>
      (data || []).flatMap((p) =>
        typeof p.fameIndex === "number" && p.fameIndex > 0
          ? [{ timestamp: p.timestamp, fameIndex: p.fameIndex }]
          : [],
      ),
    [data],
  );

  const bands = useMemo(() => computeWeekendBands(points), [points]);

  const anchors = useMemo(() => {
    if (points.length === 0) return null;

    const values = points.map((p) => p.fameIndex);

    // Last *completed* Sunday close — where the previous jackpot settled, and
    // the most directly comparable prior reading. Today's points are skipped so
    // that opening this on a Sunday can't label a mid-day reading a "close".
    const todayKey = new Date().toISOString().slice(0, 10);
    let lastSundayClose: number | null = null;
    for (let i = points.length - 1; i >= 0; i--) {
      const point = points[i];
      if (point.timestamp.slice(0, 10) === todayKey) continue;
      if (new Date(point.timestamp).getUTCDay() !== 0) continue;
      lastSundayClose = point.fameIndex;
      break;
    }

    return {
      now: currentScore > 0 ? currentScore : values[values.length - 1],
      lastSundayClose,
      low: Math.min(...values),
      high: Math.max(...values),
    };
  }, [points, currentScore]);

  const yDomain = useMemo(() => {
    if (points.length === 0) return undefined;
    const values = points.map((p) => p.fameIndex);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max((max - min) * 0.12, max * 0.01);
    return [Math.max(0, Math.round(min - pad)), Math.round(max + pad)] as [number, number];
  }, [points]);

  const chips = useMemo(() => {
    if (!anchors) return [];
    // Low/high are labelled with the selected range because they're read off
    // the visible series — a fixed "7d" label would drift from the chart the
    // moment the user switches to 30D.
    const raw = [
      { label: "Now", value: anchors.now },
      { label: "Last Sun close", value: anchors.lastSundayClose },
      { label: `${range} low`, value: anchors.low },
      { label: `${range} high`, value: anchors.high },
    ];
    const seen = new Set<number>();
    return raw.flatMap(({ label, value }) => {
      if (typeof value !== "number" || !isFinite(value) || value <= 0) return [];
      const rounded = Math.round(value);
      if (seen.has(rounded)) return [];
      seen.add(rounded);
      return [{ label, value: rounded }];
    });
  }, [anchors, range]);

  return (
    <div className="rounded-lg border bg-muted/30 p-3" data-testid="section-jackpot-history">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-muted-foreground">Score history</p>

        {!expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            data-testid="button-jackpot-history-expand"
          >
            Show
            <ChevronDown className="h-3 w-3" />
          </button>
        ) : (
          <div className="flex gap-1">
            {(["7D", "30D"] as HistoryRange[]).map((option) => (
              <Button
                key={option}
                variant={range === option ? "default" : "outline"}
                size="sm"
                onClick={() => setRange(option)}
                className="h-6 px-2 text-[11px]"
                data-testid={`button-jackpot-history-${option}`}
              >
                {option}
              </Button>
            ))}
          </div>
        )}
      </div>

      {showChart && (
        <>
          {isLoading ? (
            <div className="h-[120px] flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="h-[120px] flex items-center justify-center text-center px-2">
              <p className="text-xs text-muted-foreground">
                Couldn&apos;t load score history right now.
              </p>
            </div>
          ) : points.length < 2 ? (
            <div className="h-[120px] flex items-center justify-center text-center px-2">
              <p className="text-xs text-muted-foreground">
                Not enough score history yet for {personName}.
              </p>
            </div>
          ) : (
            <div
              className="h-[120px] -ml-2"
              data-testid="chart-jackpot-history"
              role="img"
              aria-label={`${personName} Trend Score over the last ${range === "7D" ? "7 days" : "30 days"}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="jackpotHistoryGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--muted-foreground))"
                    strokeOpacity={0.1}
                  />

                  <XAxis
                    dataKey="timestamp"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickFormatter={formatAxisDate}
                    interval="preserveStartEnd"
                    minTickGap={40}
                    axisLine={false}
                    tickLine={false}
                    tickMargin={6}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickFormatter={formatCompact}
                    tickCount={3}
                    width={34}
                    axisLine={false}
                    tickLine={false}
                  />

                  {/* After the axes so recharts can resolve the category
                      coordinates, before <Area> so the bands sit behind it. */}
                  {bands.map((band) => (
                    <ReferenceArea
                      key={`weekend-${band.x1}`}
                      x1={band.x1}
                      x2={band.x2}
                      fill="hsl(var(--muted-foreground))"
                      fillOpacity={0.14}
                      strokeOpacity={0}
                    />
                  ))}

                  <Tooltip
                    cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.3 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const point = payload[0].payload as PlottablePoint;
                      return (
                        <div className="rounded-md border bg-popover px-2 py-1 shadow-md">
                          <p className="text-[10px] text-muted-foreground">
                            {formatTooltipDate(point.timestamp, range)}
                          </p>
                          <p className="text-xs font-mono font-semibold">
                            {formatNumber(point.fameIndex)}
                          </p>
                        </div>
                      );
                    }}
                  />

                  <Area
                    type="linear"
                    dataKey="fameIndex"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#jackpotHistoryGradient)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {points.length >= 2 && bands.length > 0 && (
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              Shaded bands are past Fri→Sun weekends — the same stretch you&apos;re predicting.
            </p>
          )}
        </>
      )}

      {chips.length > 0 && showChart && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => onPickScore(chip.value)}
              className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] hover:border-amber-500/50 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              data-testid={`button-jackpot-chip-${chip.label.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <span className="text-muted-foreground">{chip.label}</span>{" "}
              <span className="font-mono font-medium">{formatNumber(chip.value)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
