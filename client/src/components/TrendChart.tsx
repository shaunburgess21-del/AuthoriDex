import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useCallback, useMemo } from "react";
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

interface TrendChartProps {
  personId: string;
  personName: string;
}

interface HistoryDataPoint {
  timestamp: string;
  date: string;
  time: string;
  trendScore: number;
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
}

function CustomTooltip({ active, payload, startScore, timeRange }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  
  const currentScore = payload[0].value;
  const dataPoint = payload[0].payload;
  const delta = ((currentScore - startScore) / startScore) * 100;
  const isPositive = delta >= 0;
  
  const formatDate = () => {
    if (timeRange === "1D") {
      return dataPoint.time || dataPoint.date;
    }
    return dataPoint.date;
  };
  
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl">
      <p className="text-xs text-muted-foreground mb-1">{formatDate()}</p>
      <p className="font-mono font-bold text-lg">
        {currentScore.toLocaleString()}
      </p>
      <p className={`text-sm font-semibold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
        {isPositive ? '+' : ''}{delta.toFixed(2)}% from start
      </p>
    </div>
  );
}

export function TrendChart({ personId, personName }: TrendChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7D");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const days = timeRange === "1D" ? 1 : timeRange === "7D" ? 7 : timeRange === "30D" ? 30 : timeRange === "6M" ? 180 : timeRange === "1Y" ? 365 : 365;

  const { data: historyData, isLoading } = useQuery<HistoryDataPoint[]>({
    queryKey: [`/api/trending/${personId}/history?days=${days}`],
  });

  const startScore = useMemo(() => {
    if (!historyData || historyData.length === 0) return 0;
    return historyData[0].trendScore;
  }, [historyData]);

  const formatYAxis = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
  };

  const formatXAxisTick = useCallback((value: string, index: number) => {
    if (!historyData) return value;
    
    const dataPoint = historyData.find(d => d.date === value || d.time === value);
    if (!dataPoint) return value;

    if (timeRange === "1D") {
      return dataPoint.time || value;
    } else if (timeRange === "7D" || timeRange === "30D") {
      const parts = value.split('/');
      if (parts.length >= 2) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthIndex = parseInt(parts[0], 10) - 1;
        const day = parts[1];
        return `${day} ${months[monthIndex] || ''}`;
      }
      return value;
    } else {
      const parts = value.split('/');
      if (parts.length >= 2) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthIndex = parseInt(parts[0], 10) - 1;
        return months[monthIndex] || value;
      }
      return value;
    }
  }, [historyData, timeRange]);

  const getTickInterval = useCallback(() => {
    if (!historyData) return 0;
    const dataLength = historyData.length;
    
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      return Math.max(1, Math.floor(dataLength / 4));
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
  }, []);

  const yDomain = useMemo(() => {
    if (!historyData || historyData.length === 0) return ['auto', 'auto'];
    const scores = historyData.map(d => d.trendScore);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const padding = (max - min) * 0.1;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [historyData]);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-serif">Trend History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-80 flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
              <p className="mt-4 text-sm text-muted-foreground">Loading trend data...</p>
            </div>
          </div>
        ) : !historyData || historyData.length === 0 ? (
          <div className="h-80 flex items-center justify-center border rounded-lg bg-muted/20">
            <div className="text-center">
              <p className="text-muted-foreground">
                No historical data available yet
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Data will appear as trend snapshots are collected
              </p>
            </div>
          </div>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart 
                data={historyData} 
                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
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
                  strokeOpacity={0.15}
                />
                <XAxis 
                  dataKey="date" 
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickFormatter={formatXAxisTick}
                  interval={getTickInterval()}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={false}
                />
                <YAxis 
                  tickFormatter={formatYAxis}
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  domain={yDomain as [number, number]}
                  axisLine={false}
                  tickLine={false}
                  width={55}
                />
                <Tooltip 
                  content={<CustomTooltip startScore={startScore} timeRange={timeRange} />}
                  cursor={{
                    stroke: 'hsl(var(--primary))',
                    strokeWidth: 1,
                    strokeDasharray: '4 4',
                  }}
                />
                {activeIndex !== null && historyData[activeIndex] && (
                  <ReferenceLine
                    x={historyData[activeIndex].date}
                    stroke="hsl(var(--primary))"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                )}
                <Area 
                  type="linear"
                  dataKey="trendScore" 
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
        
        {/* Time range buttons - positioned below chart like Polymarket */}
        <div className="flex gap-1 mt-4">
          {(["1D", "7D", "30D", "6M", "1Y", "ALL"] as TimeRange[]).map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeRange(range)}
              className="text-xs px-3"
              data-testid={`button-timerange-${range}`}
            >
              {range}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
