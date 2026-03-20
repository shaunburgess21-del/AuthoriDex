import { Button } from "@/components/ui/button";
import { Target, X } from "lucide-react";
import { useState, useCallback, useMemo, type MouseEvent, type TouchEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

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

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: HistoryDataPoint }>;
  label?: string;
  startScore: number;
  timeRange: TimeRange;
  onDismiss?: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toTimeStr(d: Date): string {
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${h12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function formatTimestampForAxis(isoString: string, timeRange: TimeRange, data: HistoryDataPoint[]): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;

  if (timeRange === "1D") {
    const firstDate = data.length > 0 ? new Date(data[0].timestamp).getDate() : d.getDate();
    if (d.getDate() !== firstDate) {
      return `${MONTHS[d.getMonth()]} ${d.getDate()} ${toTimeStr(d)}`;
    }
    return toTimeStr(d);
  } else if (timeRange === "7D" || timeRange === "30D") {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  } else {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
}

function formatTooltipDate(isoString: string, timeRange: TimeRange): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;

  if (timeRange === "1D" || timeRange === "7D") {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${toTimeStr(d)}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function CustomTooltip({ active, payload, startScore, timeRange, onDismiss }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  
  const currentScore = payload[0].value;
  const dataPoint = payload[0].payload;
  const delta = startScore > 0 ? ((currentScore - startScore) / startScore) * 100 : 0;
  const isPositive = delta >= 0;

  const stopBubble = (e: MouseEvent | TouchEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl relative pr-9 max-w-[min(100vw-2rem,280px)]">
      {onDismiss && (
        <button
          type="button"
          aria-label="Hide tooltip"
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground touch-manipulation"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            stopBubble(e);
            onDismiss();
          }}
          onTouchEnd={(e) => {
            stopBubble(e);
            onDismiss();
          }}
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <p className="text-xs text-muted-foreground mb-1">
        {formatTooltipDate(dataPoint.timestamp, timeRange)}
      </p>
      <p className="font-mono font-bold text-lg">
        {currentScore.toLocaleString('en-US')}
      </p>
      <p className={`text-sm font-semibold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
        {isPositive ? '+' : ''}{delta.toFixed(2)}% from start
      </p>
    </div>
  );
}

export function TrendChart({ personId, personName, activeMarkets }: TrendChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7D");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showMarketOverlay, setShowMarketOverlay] = useState(false);
  /** Mobile: Recharts keeps tooltip "active" after touch; user can dismiss until next tap on chart */
  const [tooltipDismissed, setTooltipDismissed] = useState(false);

  const hasMarkets = activeMarkets && activeMarkets.length > 0;

  const days = timeRange === "1D" ? 1 : timeRange === "7D" ? 7 : timeRange === "30D" ? 30 : timeRange === "6M" ? 180 : timeRange === "1Y" ? 365 : 365;

  const { data: historyData, isLoading } = useQuery<HistoryDataPoint[]>({
    queryKey: [`/api/trending/${personId}/history?days=${days}`],
  });

  const startScore = useMemo(() => {
    if (!historyData || historyData.length === 0) return 0;
    return historyData[0].fameIndex;
  }, [historyData]);

  const formatYAxis = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
  };

  const formatXAxisTick = useCallback((value: string) => {
    return formatTimestampForAxis(value, timeRange, historyData || []);
  }, [timeRange, historyData]);

  const getTickInterval = useCallback(() => {
    if (!historyData) return 0;
    const dataLength = historyData.length;
    
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      return Math.max(1, Math.floor(dataLength / 5));
    }
    return Math.max(1, Math.floor(dataLength / 7));
  }, [historyData]);

  const handleMouseMove = useCallback((state: any) => {
    if (state && state.activeTooltipIndex !== undefined) {
      setActiveIndex(state.activeTooltipIndex);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setActiveIndex(null);
    setTooltipDismissed(false);
  }, []);

  const dismissTooltip = useCallback(() => {
    setTooltipDismissed(true);
    setActiveIndex(null);
  }, []);

  const handleChartPointerDown = useCallback(() => {
    setTooltipDismissed(false);
  }, []);

  const yDomain = useMemo(() => {
    if (!historyData || historyData.length === 0) return ['auto', 'auto'];
    const scores = historyData.map(d => d.fameIndex);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const padding = (max - min) * 0.1;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [historyData]);

  return (
    <div className="w-screen relative left-1/2 -ml-[50vw] md:w-auto md:relative md:left-0 md:ml-0">
      {/* Frameless: chart sits on page background (no card chrome) — works on mobile and desktop */}
      <section className="bg-transparent border-0 shadow-none overflow-visible">
        <div className="pb-3 px-4 md:px-6 flex flex-row items-center justify-between gap-3">
          <h2 className="text-lg font-serif text-foreground">Trend History</h2>
          {hasMarkets && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMarketOverlay(prev => !prev)}
              className={`text-xs gap-1.5 shrink-0 ${showMarketOverlay ? 'bg-primary/10 border-primary/40' : ''}`}
            >
              <Target className="h-3.5 w-3.5" />
              {showMarketOverlay ? 'Hide Markets' : 'Show Markets'}
            </Button>
          )}
        </div>
        <div>
          {isLoading ? (
            <div className="h-[400px] flex items-center justify-center px-4">
              <div className="text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
                <p className="mt-4 text-sm text-muted-foreground">Loading trend data...</p>
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
            <div
              className="h-[400px] touch-manipulation"
              onPointerDown={handleChartPointerDown}
              onTouchStart={handleChartPointerDown}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart 
                  data={historyData} 
                  margin={{ top: 5, right: 0, left: 4, bottom: 5 }}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                >
                  <defs>
                    <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
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
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
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
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    domain={yDomain as [number, number]}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    orientation="left"
                    mirror={false}
                    tickMargin={0}
                  />
                  <Tooltip 
                    active={tooltipDismissed ? false : undefined}
                    content={
                      <CustomTooltip
                        startScore={startScore}
                        timeRange={timeRange}
                        onDismiss={dismissTooltip}
                      />
                    }
                    cursor={
                      tooltipDismissed
                        ? false
                        : {
                            stroke: 'hsl(var(--primary))',
                            strokeWidth: 1,
                            strokeDasharray: '4 4',
                          }
                    }
                  />
                  {activeIndex !== null && !tooltipDismissed && historyData[activeIndex] && (
                    <ReferenceLine
                      x={historyData[activeIndex].timestamp}
                      stroke="hsl(var(--primary))"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                  )}
                  {showMarketOverlay && activeMarkets?.map((market) => (
                    <ReferenceLine
                      key={market.marketId}
                      y={market.baselineScore}
                      stroke="hsl(var(--chart-4))"
                      strokeWidth={1.5}
                      strokeDasharray="6 3"
                      label={{
                        value: `Baseline: ${market.label}`,
                        position: 'insideTopRight',
                        fill: 'hsl(var(--muted-foreground))',
                        fontSize: 11,
                      }}
                    />
                  ))}
                  <Area 
                    type="linear"
                    dataKey="fameIndex" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    fill="url(#trendGradient)"
                    name="Trend Score"
                    dot={false}
                    activeDot={{ 
                      r: 6, 
                      fill: 'hsl(var(--primary))',
                      stroke: 'hsl(var(--background))',
                      strokeWidth: 2
                    }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          
          <div className="flex gap-1.5 mt-4 mb-2 px-4 md:px-6">
            {(["1D", "7D", "30D", "6M", "1Y", "ALL"] as TimeRange[]).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setTimeRange(range);
                  setTooltipDismissed(false);
                  setActiveIndex(null);
                }}
                className="text-xs px-3"
                data-testid={`button-timerange-${range}`}
              >
                {range}
              </Button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
