import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingPerson } from "@shared/schema";
import { X } from "lucide-react";

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
  comparisonTrendScore?: number;
}

export function TrendChart({ personId, personName }: TrendChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7D");
  const [comparisonPersonId, setComparisonPersonId] = useState<string | null>(null);

  const days = timeRange === "1D" ? 1 : timeRange === "7D" ? 7 : timeRange === "30D" ? 30 : timeRange === "6M" ? 180 : timeRange === "1Y" ? 365 : 365;

  // Fetch all trending people for comparison dropdown
  const { data: allPeople } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending'],
  });

  // Fetch main person's history
  const { data: historyData, isLoading } = useQuery<HistoryDataPoint[]>({
    queryKey: [`/api/trending/${personId}/history?days=${days}`],
  });

  // Fetch comparison person's history if selected
  const { data: comparisonHistoryData } = useQuery<HistoryDataPoint[]>({
    queryKey: [`/api/trending/${comparisonPersonId}/history?days=${days}`],
    enabled: !!comparisonPersonId,
  });

  // Merge both datasets
  const mergedData = useMemo(() => {
    if (!historyData) return [];
    if (!comparisonPersonId || !comparisonHistoryData) return historyData;

    // Create a map of comparison data by timestamp
    const comparisonMap = new Map(
      comparisonHistoryData.map((item) => [item.timestamp, item.trendScore])
    );

    // Merge the data
    return historyData.map((item) => ({
      ...item,
      comparisonTrendScore: comparisonMap.get(item.timestamp) || null,
    }));
  }, [historyData, comparisonPersonId, comparisonHistoryData]);

  const formatYAxis = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
  };

  const comparisonPerson = allPeople?.find((p) => p.id === comparisonPersonId);
  const otherPeople = allPeople?.filter((p) => p.id !== personId) || [];

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-row items-center justify-between space-y-0">
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
        </div>
        <div className="flex items-center gap-2">
          <Select value={comparisonPersonId || ""} onValueChange={(value) => setComparisonPersonId(value || null)}>
            <SelectTrigger className="w-48" data-testid="select-compare-person">
              <SelectValue placeholder="Compare with..." />
            </SelectTrigger>
            <SelectContent>
              {otherPeople.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {comparisonPersonId && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setComparisonPersonId(null)}
              data-testid="button-clear-comparison"
              className="h-9 w-9"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
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
              <LineChart data={mergedData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  className="text-xs"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
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
                  name={personName}
                  dot={false}
                  activeDot={{ r: 6 }}
                />
                {comparisonPersonId && comparisonPerson && (
                  <Line 
                    type="monotone" 
                    dataKey="comparisonTrendScore" 
                    stroke="hsl(var(--accent))" 
                    strokeWidth={3}
                    name={comparisonPerson.name}
                    dot={false}
                    activeDot={{ r: 6 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
