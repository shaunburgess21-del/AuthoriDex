import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Target, X, Search, Users, RotateCcw } from "lucide-react";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TrendingPerson } from "@shared/schema";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";

type TimeRange = "1D" | "7D" | "30D" | "6M" | "1Y" | "ALL";

export interface ActiveMarketOverlay {
  baselineScore: number;
  endAt: string;
  marketId: string;
  label: string;
}

interface TrendChartProps {
  personId: string;
  personName: string;
  activeMarkets?: ActiveMarketOverlay[];
}

interface HistoryDataPoint {
  timestamp: string;
  date: string;
  time: string;
  trendScore: number;
  fameIndex: number;
  newsCount: number;
  youtubeViews: number;
  spotifyFollowers: number;
  searchVolume: number;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const COMPARISON_COLORS = [
  "#22D3EE", // cyan
  "#F97316", // orange
  "#A855F7", // purple
  "#22C55E", // green
  "#FACC15", // yellow
];

interface ComparedPerson {
  id: string;
  name: string;
  avatar: string | null;
  color: string;
}

// ─── Formatting helpers ───────────────────────────────────────────

function toTimeStr(d: Date): string {
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${h12}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

function formatTimestampForAxis(
  isoString: string,
  timeRange: TimeRange,
  data: HistoryDataPoint[],
): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;

  if (timeRange === "1D") {
    const firstDate =
      data.length > 0 ? new Date(data[0].timestamp).getDate() : d.getDate();
    if (d.getDate() !== firstDate) {
      return `${MONTHS[d.getMonth()]} ${d.getDate()} ${toTimeStr(d)}`;
    }
    return toTimeStr(d);
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function formatTooltipDate(isoString: string, timeRange: TimeRange): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  if (timeRange === "1D" || timeRange === "7D") {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${toTimeStr(d)}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ─── Celebrity search modal ──────────────────────────────────────

function CompareSearchModal({
  open,
  onOpenChange,
  people,
  selected,
  onSelect,
  isLoading,
  max,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: TrendingPerson[];
  selected: ComparedPerson[];
  onSelect: (person: TrendingPerson) => void;
  isLoading: boolean;
  max: number;
}) {
  const [q, setQ] = useState("");
  const selectedIds = new Set(selected.map((s) => s.id));
  const filtered = (people || []).filter(
    (p) =>
      !selectedIds.has(p.id) &&
      p.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-cyan-700 dark:text-cyan-500" />
            Compare Celebrities
          </DialogTitle>
          <DialogDescription>
            Select up to {max} people to overlay on the chart
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
              autoFocus
              data-testid="input-compare-search"
            />
          </div>
        </div>

        <div className="h-[350px] overflow-y-auto">
          <div className="p-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-solid border-primary border-r-transparent" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No results
              </p>
            ) : (
              <ScrollArea className="h-full">
                {filtered.slice(0, 50).map((person) => (
                  <button
                    key={person.id}
                    onClick={() => {
                      onSelect(person);
                      onOpenChange(false);
                      setQ("");
                    }}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                    data-testid={`compare-option-${person.id}`}
                  >
                    <PersonAvatar
                      name={person.name}
                      avatar={person.avatar}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {person.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {person.category} · #{person.rank}
                      </p>
                    </div>
                  </button>
                ))}
              </ScrollArea>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Comparison data hook ────────────────────────────────────────

function useComparisonData(personId: string, days: number) {
  return useQuery<HistoryDataPoint[]>({
    queryKey: [`/api/trending/${personId}/history?days=${days}`],
    enabled: !!personId,
    staleTime: 5 * 60 * 1000,
  });
}

function ComparisonDataLoader({
  personId,
  days,
  onData,
}: {
  personId: string;
  days: number;
  onData: (id: string, data: HistoryDataPoint[] | undefined) => void;
}) {
  const { data } = useComparisonData(personId, days);
  const prev = useRef<HistoryDataPoint[] | undefined>(undefined);
  useEffect(() => {
    if (data !== prev.current) {
      prev.current = data;
      onData(personId, data);
    }
  }, [data, personId, onData]);
  return null;
}

// ─── Main component ──────────────────────────────────────────────

export function TrendChart({ personId, personName, activeMarkets }: TrendChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7D");
  const [showMarketOverlay, setShowMarketOverlay] = useState(false);

  // Pin state: two-point comparison
  const [pinA, setPinA] = useState<number | null>(null);
  const [pinB, setPinB] = useState<number | null>(null);

  // Hover index (lightweight crosshair only)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Compare celebrities
  const [compared, setCompared] = useState<ComparedPerson[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparisonDataMap, setComparisonDataMap] = useState<
    Record<string, HistoryDataPoint[]>
  >({});

  // Active line selection (which person's line is "focused" for tooltip)
  const [focusedLine, setFocusedLine] = useState<string | null>(null);

  const hasMarkets = activeMarkets && activeMarkets.length > 0;

  const days =
    timeRange === "1D"
      ? 1
      : timeRange === "7D"
        ? 7
        : timeRange === "30D"
          ? 30
          : timeRange === "6M"
            ? 180
            : timeRange === "1Y"
              ? 365
              : 365;

  const { data: historyData, isLoading } = useQuery<HistoryDataPoint[]>({
    queryKey: [`/api/trending/${personId}/history?days=${days}`],
  });

  const { data: trendingResponse, isLoading: peopleLoading } = useQuery<{ data: TrendingPerson[] } | TrendingPerson[]>({
    queryKey: ["/api/trending?sort=rank&limit=100"],
    enabled: compareOpen || compared.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const trendingPeople: TrendingPerson[] = useMemo(() => {
    if (!trendingResponse) return [];
    if (Array.isArray(trendingResponse)) return trendingResponse;
    if (Array.isArray((trendingResponse as any).data)) return (trendingResponse as any).data;
    return [];
  }, [trendingResponse]);

  const startScore = useMemo(() => {
    if (!historyData || historyData.length === 0) return 0;
    return historyData[0].fameIndex;
  }, [historyData]);

  // ─── Merged data for multi-line chart ────────────────────────
  const mergedData = useMemo(() => {
    if (!historyData) return [];
    return historyData.map((dp) => {
      const row: Record<string, any> = { ...dp };
      for (const cp of compared) {
        const cpData = comparisonDataMap[cp.id];
        if (!cpData) continue;
        const ts = new Date(dp.timestamp).getTime();
        let closest = cpData[0];
        let closestDiff = Math.abs(new Date(cpData[0]?.timestamp ?? 0).getTime() - ts);
        for (const cpDp of cpData) {
          const diff = Math.abs(new Date(cpDp.timestamp).getTime() - ts);
          if (diff < closestDiff) {
            closest = cpDp;
            closestDiff = diff;
          }
        }
        if (closest) row[`compare_${cp.id}`] = closest.fameIndex;
      }
      return row;
    });
  }, [historyData, compared, comparisonDataMap]);

  // ─── Y domain including comparison data ──────────────────────
  const yDomain = useMemo(() => {
    if (!mergedData || mergedData.length === 0) return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const row of mergedData) {
      const v = row.fameIndex;
      if (v < min) min = v;
      if (v > max) max = v;
      for (const cp of compared) {
        const cv = row[`compare_${cp.id}`];
        if (cv != null) {
          if (cv < min) min = cv;
          if (cv > max) max = cv;
        }
      }
    }
    if (!isFinite(min)) return ["auto", "auto"];
    const padding = (max - min) * 0.1;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [mergedData, compared]);

  // ─── Formatting ──────────────────────────────────────────────

  const formatYAxis = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
  };

  const formatXAxisTick = useCallback(
    (value: string) => formatTimestampForAxis(value, timeRange, historyData || []),
    [timeRange, historyData],
  );

  const getTickInterval = useCallback(() => {
    if (!historyData) return 0;
    const len = historyData.length;
    if (typeof window !== "undefined" && window.innerWidth < 640)
      return Math.max(1, Math.floor(len / 5));
    return Math.max(1, Math.floor(len / 7));
  }, [historyData]);

  // ─── Chart click → pin logic ─────────────────────────────────

  const handleChartClick = useCallback(
    (state: any) => {
      if (!state || state.activeTooltipIndex == null) return;
      const idx = state.activeTooltipIndex as number;

      if (pinA === null) {
        setPinA(idx);
        setPinB(null);
      } else if (pinB === null && idx !== pinA) {
        setPinB(idx);
      } else {
        setPinA(idx);
        setPinB(null);
      }
    },
    [pinA, pinB],
  );

  const handleMouseMove = useCallback((state: any) => {
    if (state && state.activeTooltipIndex !== undefined) {
      setHoverIndex(state.activeTooltipIndex);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  const clearPins = useCallback(() => {
    setPinA(null);
    setPinB(null);
  }, []);

  // ─── Comparison person management ────────────────────────────

  const handleComparisonDataUpdate = useCallback(
    (id: string, data: HistoryDataPoint[] | undefined) => {
      if (data) {
        setComparisonDataMap((prev) => ({ ...prev, [id]: data }));
      }
    },
    [],
  );

  const addComparison = useCallback(
    (person: TrendingPerson) => {
      if (compared.length >= 5) return;
      if (person.id === personId) return;
      if (compared.find((c) => c.id === person.id)) return;
      const color = COMPARISON_COLORS[compared.length % COMPARISON_COLORS.length];
      setCompared((prev) => [
        ...prev,
        { id: person.id, name: person.name, avatar: person.avatar ?? null, color },
      ]);
    },
    [compared, personId],
  );

  const removeComparison = useCallback((id: string) => {
    setCompared((prev) => {
      const next = prev.filter((c) => c.id !== id);
      return next.map((c, i) => ({
        ...c,
        color: COMPARISON_COLORS[i % COMPARISON_COLORS.length],
      }));
    });
    setComparisonDataMap((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setFocusedLine((prev) => (prev === id ? null : prev));
  }, []);

  // Reset pins when time range changes
  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range);
    setPinA(null);
    setPinB(null);
    setHoverIndex(null);
  }, []);

  // ─── Pin data helpers ────────────────────────────────────────

  const data = mergedData;
  const pinAData = pinA !== null && data[pinA] ? data[pinA] : null;
  const pinBData = pinB !== null && data[pinB] ? data[pinB] : null;
  const hasTwoPins = pinAData !== null && pinBData !== null;

  const [lowIdx, highIdx] = useMemo(() => {
    if (pinA === null || pinB === null) return [null, null];
    return pinA < pinB ? [pinA, pinB] : [pinB, pinA];
  }, [pinA, pinB]);

  const pinComparison = useMemo(() => {
    if (!hasTwoPins) return null;
    const scoreA = pinAData!.fameIndex;
    const scoreB = pinBData!.fameIndex;
    const abs = scoreB - scoreA;
    const pct = scoreA > 0 ? ((scoreB - scoreA) / scoreA) * 100 : 0;
    return { scoreA, scoreB, abs, pct, isPositive: abs >= 0 };
  }, [hasTwoPins, pinAData, pinBData]);

  // Focused line tooltip info at pinA
  const focusedInfo = useMemo(() => {
    if (!focusedLine || pinA === null || !data[pinA]) return null;
    const row = data[pinA];
    const key = `compare_${focusedLine}`;
    const value = row[key];
    const cp = compared.find((c) => c.id === focusedLine);
    if (value == null || !cp) return null;
    return { name: cp.name, color: cp.color, score: value };
  }, [focusedLine, pinA, data, compared]);

  return (
    <div className="w-screen relative left-1/2 -ml-[50vw] md:w-auto md:relative md:left-0 md:ml-0">
      <section className="bg-transparent border-0 shadow-none overflow-visible">
        {/* Header row */}
        <div className="pb-3 px-4 md:px-6 flex flex-row items-center justify-between gap-3">
          <h2 className="text-lg font-serif text-foreground">Trend History</h2>
          <div className="flex items-center gap-2">
            {hasMarkets && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMarketOverlay((prev) => !prev)}
                className={`text-xs gap-1.5 shrink-0 ${showMarketOverlay ? "bg-primary/10 border-primary/40" : ""}`}
              >
                <Target className="h-3.5 w-3.5" />
                {showMarketOverlay ? "Hide Markets" : "Show Markets"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCompareOpen(true)}
              className={`text-xs gap-1.5 shrink-0 ${compared.length > 0 ? "bg-cyan-500/15 dark:bg-cyan-500/10 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-600 dark:text-cyan-400" : ""}`}
              data-testid="button-compare"
            >
              <Users className="h-3.5 w-3.5" />
              Compare
              {compared.length > 0 && (
                <span className="ml-1 tabular-nums">({compared.length})</span>
              )}
            </Button>
          </div>
        </div>

        {/* Selected comparison chips */}
        {compared.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 mb-3">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border"
              style={{ borderColor: "hsl(var(--primary))", color: "hsl(var(--primary))" }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: "hsl(var(--primary))" }}
              />
              {personName}
            </div>
            {compared.map((cp) => (
              <button
                key={cp.id}
                onClick={() => removeComparison(cp.id)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border hover:opacity-80 transition-opacity group"
                style={{ borderColor: cp.color, color: cp.color }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: cp.color }}
                />
                {cp.name}
                <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        )}

        <div>
          {isLoading ? (
            <div className="h-[400px] flex items-center justify-center px-4">
              <div className="text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
                <p className="mt-4 text-sm text-muted-foreground">
                  Loading trend data...
                </p>
              </div>
            </div>
          ) : !historyData || historyData.length === 0 ? (
            <div className="h-[400px] flex items-center justify-center px-4 md:px-6">
              <div className="text-center max-w-sm">
                <p className="text-muted-foreground">
                  No historical data available yet
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Data will appear as trend snapshots are collected
                </p>
              </div>
            </div>
          ) : (
            <div className="relative">
              <div className="h-[400px] touch-manipulation cursor-crosshair">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data}
                    margin={{ top: 5, right: 0, left: 4, bottom: 5 }}
                    onClick={handleChartClick}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                  >
                    <defs>
                      <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      {compared.map((cp) => (
                        <linearGradient key={`grad-${cp.id}`} id={`grad-${cp.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={cp.color} stopOpacity={0.15} />
                          <stop offset="100%" stopColor={cp.color} stopOpacity={0} />
                        </linearGradient>
                      ))}
                      {hasTwoPins && lowIdx !== null && highIdx !== null && (
                        <linearGradient id="rangeBandGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                        </linearGradient>
                      )}
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--muted-foreground))"
                      strokeOpacity={0.1}
                    />
                    <XAxis
                      dataKey="timestamp"
                      className="text-xs"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickFormatter={formatXAxisTick}
                      interval={getTickInterval()}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={10}
                      padding={{ left: 0, right: 0 }}
                    />
                    <YAxis
                      tickFormatter={formatYAxis}
                      className="text-xs"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      domain={yDomain as [number, number]}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      orientation="left"
                      mirror={false}
                      tickMargin={0}
                    />

                    {/* Hover crosshair */}
                    {hoverIndex !== null && data[hoverIndex] && (
                      <ReferenceLine
                        x={data[hoverIndex].timestamp}
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        strokeOpacity={0.4}
                      />
                    )}

                    {/* Shaded band between two pins */}
                    {hasTwoPins && lowIdx !== null && highIdx !== null && data[lowIdx] && data[highIdx] && (
                      <ReferenceArea
                        x1={data[lowIdx].timestamp}
                        x2={data[highIdx].timestamp}
                        fill="url(#rangeBandGradient)"
                        strokeOpacity={0}
                      />
                    )}

                    {/* Pin A vertical line */}
                    {pinA !== null && data[pinA] && (
                      <ReferenceLine
                        x={data[pinA].timestamp}
                        stroke="hsl(var(--primary))"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                      />
                    )}
                    {/* Pin B vertical line */}
                    {pinB !== null && data[pinB] && (
                      <ReferenceLine
                        x={data[pinB].timestamp}
                        stroke="hsl(var(--primary))"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                      />
                    )}

                    {/* Market baselines */}
                    {showMarketOverlay &&
                      activeMarkets?.map((market) => (
                        <ReferenceLine
                          key={market.marketId}
                          y={market.baselineScore}
                          stroke="hsl(var(--chart-4))"
                          strokeWidth={1.5}
                          strokeDasharray="6 3"
                          label={{
                            value: `Baseline: ${market.label}`,
                            position: "insideTopRight",
                            fill: "hsl(var(--muted-foreground))",
                            fontSize: 11,
                          }}
                        />
                      ))}

                    {/* Primary person area */}
                    <Area
                      type="linear"
                      dataKey="fameIndex"
                      stroke={focusedLine ? "hsl(var(--primary) / 0.4)" : "hsl(var(--primary))"}
                      strokeWidth={2}
                      fill="url(#trendGradient)"
                      name={personName}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                      onClick={() => setFocusedLine(null)}
                    />

                    {/* Comparison lines */}
                    {compared.map((cp) => (
                      <Area
                        key={cp.id}
                        type="linear"
                        dataKey={`compare_${cp.id}`}
                        stroke={focusedLine === cp.id ? cp.color : focusedLine ? `${cp.color}66` : cp.color}
                        strokeWidth={focusedLine === cp.id ? 2.5 : 2}
                        fill={focusedLine === cp.id ? `url(#grad-${cp.id})` : "transparent"}
                        name={cp.name}
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                        onClick={() => setFocusedLine(cp.id)}
                        style={{ cursor: "pointer" }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* ─── Pinned tooltip overlays ─────────────────── */}

              {/* Single-pin tooltip (no second pin yet) */}
              {pinA !== null && pinB === null && pinAData && (
                <PinnedTooltip
                  data={pinAData}
                  timeRange={timeRange}
                  startScore={startScore}
                  focusedInfo={focusedInfo}
                  onDismiss={clearPins}
                  side="right"
                />
              )}

              {/* Two-pin comparison card */}
              {hasTwoPins && pinComparison && (
                <TwoPinCard
                  pinAData={pinAData!}
                  pinBData={pinBData!}
                  comparison={pinComparison}
                  timeRange={timeRange}
                  onClear={clearPins}
                />
              )}

              {/* Hover label (lightweight) */}
              {hoverIndex !== null && pinA === null && data[hoverIndex] && (
                <div className="absolute top-2 right-2 pointer-events-none">
                  <div className="bg-card/90 backdrop-blur-sm border border-border/50 rounded-md px-2.5 py-1.5 shadow-sm">
                    <p className="text-[10px] text-muted-foreground">
                      {formatTooltipDate(data[hoverIndex].timestamp, timeRange)}
                    </p>
                    <p className="font-mono font-bold text-sm">
                      {data[hoverIndex].fameIndex.toLocaleString("en-US")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Time range buttons */}
          <div className="flex gap-1.5 mt-4 mb-2 px-4 md:px-6">
            {(["1D", "7D", "30D", "6M", "1Y", "ALL"] as TimeRange[]).map(
              (range) => (
                <Button
                  key={range}
                  variant={timeRange === range ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleTimeRangeChange(range)}
                  className="text-xs px-3"
                  data-testid={`button-timerange-${range}`}
                >
                  {range}
                </Button>
              ),
            )}
          </div>
        </div>
      </section>

      {/* Comparison data loaders (invisible) */}
      {compared.map((cp) => (
        <ComparisonDataLoader
          key={cp.id}
          personId={cp.id}
          days={days}
          onData={handleComparisonDataUpdate}
        />
      ))}

      {/* Compare modal */}
      <CompareSearchModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        people={(trendingPeople || []).filter((p) => p.id !== personId)}
        selected={compared}
        onSelect={addComparison}
        isLoading={peopleLoading}
        max={5}
      />
    </div>
  );
}

// ─── Pinned tooltip (single point) ──────────────────────────────

function PinnedTooltip({
  data,
  timeRange,
  startScore,
  focusedInfo,
  onDismiss,
  side,
}: {
  data: Record<string, any>;
  timeRange: TimeRange;
  startScore: number;
  focusedInfo: { name: string; color: string; score: number } | null;
  onDismiss: () => void;
  side: "left" | "right";
}) {
  const score = focusedInfo ? focusedInfo.score : data.fameIndex;
  const delta = startScore > 0 ? ((score - startScore) / startScore) * 100 : 0;
  const isPositive = delta >= 0;

  return (
    <div
      className={`absolute top-3 ${side === "right" ? "right-3" : "left-14"} z-20`}
    >
      <div className="bg-card border border-border rounded-lg p-3 shadow-xl pr-9 max-w-[280px]">
        <button
          type="button"
          aria-label="Dismiss"
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </button>
        {focusedInfo && (
          <p className="text-[10px] font-semibold mb-0.5" style={{ color: focusedInfo.color }}>
            {focusedInfo.name}
          </p>
        )}
        <p className="text-xs text-muted-foreground mb-1">
          {formatTooltipDate(data.timestamp, timeRange)}
        </p>
        <p className="font-mono font-bold text-lg">
          {score.toLocaleString("en-US")}
        </p>
        <p
          className={`text-sm font-semibold ${isPositive ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-500"}`}
        >
          {isPositive ? "+" : ""}
          {delta.toFixed(2)}% from start
        </p>
      </div>
    </div>
  );
}

// ─── Two-pin comparison card ────────────────────────────────────

function TwoPinCard({
  pinAData,
  pinBData,
  comparison,
  timeRange,
  onClear,
}: {
  pinAData: Record<string, any>;
  pinBData: Record<string, any>;
  comparison: { scoreA: number; scoreB: number; abs: number; pct: number; isPositive: boolean };
  timeRange: TimeRange;
  onClear: () => void;
}) {
  return (
    <div className="absolute top-3 right-3 z-20">
      <div className="bg-card border border-border rounded-lg p-3 shadow-xl max-w-[300px]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Range Comparison
          </p>
          <button
            type="button"
            aria-label="Clear comparison"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClear}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <p className="text-[10px] text-muted-foreground">
              {formatTooltipDate(pinAData.timestamp, timeRange)}
            </p>
            <p className="font-mono font-bold text-sm">
              {comparison.scoreA.toLocaleString("en-US")}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">
              {formatTooltipDate(pinBData.timestamp, timeRange)}
            </p>
            <p className="font-mono font-bold text-sm">
              {comparison.scoreB.toLocaleString("en-US")}
            </p>
          </div>
        </div>

        <div
          className={`text-center py-1.5 rounded-md text-sm font-bold ${
            comparison.isPositive
              ? "bg-green-500/15 dark:bg-green-500/10 text-green-700 dark:text-green-500"
              : "bg-red-500/15 dark:bg-red-500/10 text-red-700 dark:text-red-500"
          }`}
        >
          {comparison.isPositive ? "+" : ""}
          {comparison.abs.toLocaleString("en-US")}{" "}
          <span className="text-xs font-semibold">
            ({comparison.isPositive ? "+" : ""}
            {comparison.pct.toFixed(2)}%)
          </span>
        </div>
      </div>
    </div>
  );
}
