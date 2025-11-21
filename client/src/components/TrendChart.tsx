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

  // Calculate optimal interval for X-axis labels (target max 10 labels)
  const getXAxisInterval = () => {
    if (timeRange === "1D") return 0; // Show hourly data (max ~24 hours)
    if (timeRange === "7D") return 0; // Show all 7 days (7 labels)
    if (timeRange === "30D") return 2; // Show every 3rd day (~10 labels)
    if (timeRange === "6M") return 17; // Show every 18th day (~10 labels)
    if (timeRange === "1Y" || timeRange === "ALL") return 36; // Show every 37th day (~10 labels)
    return 0;
  };

  // Format date for display based on time range
  const formatXAxisDate = (dateStr: string) => {
    if (timeRange === "1D") {
      // For 1D, show time (HH:MM format)
      const parts = dateStr.split(' ');
      if (parts.length === 2) return parts[1]; // Return time portion
      return dateStr;
    }
    return dateStr; // Return full date for other ranges
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
              <LineChart data={historyData} margin={{ top: 5, right: 30, left: 20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  className="text-xs"
                  tick={{ 
                    fill: 'hsl(var(--muted-foreground))',
                    angle: window.innerWidth < 768 ? -45 : 0,
                    textAnchor: window.innerWidth < 768 ? 'end' : 'middle',
                    height: window.innerWidth < 768 ? 80 : 40
                  }}
                  interval={getXAxisInterval()}
                  tickFormatter={formatXAxisDate}
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
