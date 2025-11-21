import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

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

export function TrendChart({ personId, personName }: TrendChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7D");

  const days = timeRange === "1D" ? 1 : timeRange === "7D" ? 7 : timeRange === "30D" ? 30 : timeRange === "6M" ? 180 : timeRange === "1Y" ? 365 : 365;

  // Calculate optimal interval for X-axis labels (target ~6-10 labels across the chart)
  const getXAxisInterval = () => {
    if (timeRange === "1D") return 0; // Show the single date
    if (timeRange === "7D") return 1; // Show every other day (~4 dates)
    if (timeRange === "30D") return 3; // Show every 4th day (~8 labels)
    if (timeRange === "6M") return 14; // Show every 15th day (~12 labels)
    if (timeRange === "1Y" || timeRange === "ALL") return 30; // Show every 31st day (~12 labels)
    return 0;
  };

  const { data: historyData, isLoading } = useQuery<HistoryDataPoint[]>({
    queryKey: [`/api/trending/${personId}/history?days=${days}`],
  });

  const formatYAxis = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg font-serif">Trend History</CardTitle>
        <div className="flex gap-2">
          {(["1D", "7D", "30D", "6M", "1Y", "ALL"] as TimeRange[]).map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeRange(range)}
              className="text-xs"
              data-testid={`button-timerange-${range}`}
            >
              {range}
            </Button>
          ))}
        </div>
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
              <LineChart data={historyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  interval={getXAxisInterval()}
                  minTickGap={20}
                />
                <YAxis 
                  tickFormatter={formatYAxis}
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    color: 'hsl(var(--card-foreground))',
                  }}
                  formatter={(value: number) => formatYAxis(value)}
                />
                <Legend 
                  wrapperStyle={{ paddingTop: '20px' }}
                  iconType="line"
                />
                <Line 
                  type="monotone" 
                  dataKey="trendScore" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={3}
                  name="Trend Score"
                  dot={false}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
