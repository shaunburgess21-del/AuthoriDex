import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { CANONICAL_CATEGORIES } from "@shared/constants";
import type { TrendingPerson } from "@shared/schema";

const CATEGORY_OPTIONS: string[] = ["All", ...CANONICAL_CATEGORIES.map((c) => c.label)];

const TIME_RANGE_OPTIONS = [
  { key: "7D", label: "7D", days: 7 },
  { key: "30D", label: "30D", days: 30 },
  { key: "90D", label: "90D", days: 90 },
  { key: "ALL", label: "ALL", days: 365 },
] as const;

const MOMENTUM_COLORS = [
  "#22D3EE", // Cyan - matches AuthoriDex teal theme
  "#A855F7", // Violet - ties to Predict page purple
  "#10B981", // Emerald - growth, positivity
  "#F59E0B", // Amber - warm, distinct
  "#F43F5E", // Rose - attention, clear contrast
];

function generateFallbackHistory(
  people: TrendingPerson[],
  days: number
): Record<string, string | number>[] {
  const now = Date.now();
  const dataPoints: Record<string, string | number>[] = [];
  const pointsPerDay = days <= 7 ? 4 : days <= 30 ? 2 : 1;
  const totalPoints = Math.min(days * pointsPerDay, 100);
  const intervalMs = (days * 24 * 60 * 60 * 1000) / totalPoints;

  for (let i = totalPoints - 1; i >= 0; i--) {
    const timestamp = new Date(now - i * intervalMs);
    const entry: Record<string, string | number> = {
      date: `${timestamp.getMonth() + 1}/${timestamp.getDate()}`,
      fullDate: timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      timestamp: timestamp.toISOString(),
    };

    people.forEach((person, idx) => {
      const baseScore = person.trendScore || 5000 + idx * 1000;
      const variation = Math.sin((i / totalPoints) * Math.PI * 2 + idx) * 0.15;
      const trend = (1 - i / totalPoints) * 0.1 * (idx % 2 === 0 ? 1 : -1);
      // Deterministic per-(i, idx) pseudo-noise. Math.random() made the whole
      // chart jitter on every React re-render because the fallback generator
      // re-ran with new values each time; using cos with a mixed frequency
      // gives a stable "noisy" shape that doesn't change across renders.
      const noise = Math.cos(i * 1.7 + idx * 2.3) * 0.025;
      entry[person.id] = Math.round(baseScore * (1 + variation + trend + noise));
    });

    dataPoints.push(entry);
  }

  return dataPoints;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: string;
  people: TrendingPerson[];
  colors: string[];
}

function MomentumTooltip({ active, payload, label, people, colors }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const sortedPayload = [...payload].sort((a, b) => (b.value || 0) - (a.value || 0));

  return (
    <div className="bg-black/90 backdrop-blur-sm border border-white/10 rounded-lg p-3 shadow-xl min-w-[180px]">
      <p className="text-xs text-muted-foreground mb-2 font-medium border-b border-white/10 pb-2">{label}</p>
      <div className="space-y-1.5">
        {sortedPayload.map((entry, idx) => {
          const personIdx = people.findIndex(p => p.id === entry.dataKey);
          const color = colors[personIdx % colors.length];
          const formattedValue = entry.value >= 1000000 
            ? `${(entry.value / 1000000).toFixed(1)}M` 
            : entry.value >= 1000 
              ? `${(entry.value / 1000).toFixed(1)}K` 
              : entry.value;
          
          return (
            <div key={entry.dataKey} className="flex items-center gap-2">
              <span 
                className="w-2.5 h-2.5 rounded-full shrink-0" 
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-white/80 flex-1 truncate">{entry.name}</span>
              <span className="text-xs font-mono font-medium text-white">{formattedValue}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TrendGraphOverlay({
  open,
  onClose,
  allPeople
}: {
  open: boolean;
  onClose: () => void;
  allPeople: TrendingPerson[];
}) {
  const dragScrollRef = useDragScroll<HTMLDivElement>();
  const [selectedCategory, setSelectedCategory] = useState<typeof CATEGORY_OPTIONS[number]>("All");
  const [selectedTimeRange, setSelectedTimeRange] = useState<typeof TIME_RANGE_OPTIONS[number]>(TIME_RANGE_OPTIONS[0]);
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({});

  const filteredPeople = selectedCategory === "All" 
    ? allPeople.slice(0, 5)
    : allPeople.filter(p => p.category?.toLowerCase() === selectedCategory.toLowerCase()).slice(0, 5);

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    filteredPeople.forEach(p => { initial[p.id] = true; });
    setVisibleLines(initial);
  }, [selectedCategory, allPeople]);

  const historyQueries = useQueries({
    queries: filteredPeople.map(person => ({
      queryKey: [`/api/trending/${person.id}/history`, selectedTimeRange.days],
      queryFn: async () => {
        const res = await fetch(`/api/trending/${person.id}/history?days=${selectedTimeRange.days}`);
        if (!res.ok) return [];
        return res.json();
      },
      enabled: open && filteredPeople.length > 0,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isLoadingHistory = historyQueries.some(q => q.isLoading);

  const { trendData, usingFallbackData } = useMemo(() => {
    if (historyQueries.some(q => q.isLoading) || filteredPeople.length === 0) {
      return { trendData: [], usingFallbackData: false };
    }
    
    const allTimestamps = new Map<string, Record<string, string | number>>();
    
    filteredPeople.forEach((person, idx) => {
      const data = historyQueries[idx]?.data || [];
      
      data.forEach((point: { timestamp: string; date: string; time: string; trendScore: number }) => {
        const key = point.timestamp;
        if (!allTimestamps.has(key)) {
          const d = new Date(point.timestamp);
          const label = selectedTimeRange.days <= 7 
            ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`
            : `${d.getMonth() + 1}/${d.getDate()}`;
          allTimestamps.set(key, { 
            date: label, 
            fullDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: selectedTimeRange.days <= 7 ? 'numeric' : undefined }),
            timestamp: point.timestamp 
          });
        }
        const entry = allTimestamps.get(key)!;
        entry[person.id] = point.trendScore;
      });
    });
    
    const realData = Array.from(allTimestamps.values())
      .sort((a, b) => {
        const dateA = new Date(a.timestamp as string);
        const dateB = new Date(b.timestamp as string);
        return dateA.getTime() - dateB.getTime();
      });

    const uniqueDates = new Set(realData.map(d => (d.timestamp as string).split('T')[0]));
    const minRequiredDays = Math.min(selectedTimeRange.days, 3);
    
    if (uniqueDates.size < minRequiredDays) {
      return { 
        trendData: generateFallbackHistory(filteredPeople, selectedTimeRange.days), 
        usingFallbackData: true 
      };
    }
    
    return { trendData: realData, usingFallbackData: false };
  }, [historyQueries, filteredPeople, selectedTimeRange]);

  const toggleLine = (id: string) => {
    setVisibleLines(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl overflow-y-auto"
    >
      <div className="container mx-auto px-4 pt-[max(1.5rem,var(--safe-area-inset-top,_0px))] pb-[max(1.5rem,var(--safe-area-inset-bottom,_0px))] max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-serif font-bold">Compare Momentum</h2>
            <p className="text-sm text-muted-foreground">
              {selectedTimeRange.key === "ALL" ? "All-Time" : `${selectedTimeRange.days}-Day`} Trend Analysis
              {usingFallbackData && (
                <span className="ml-2 text-amber-600/80 dark:text-amber-400/80 text-xs">(Simulated data - collecting real history)</span>
              )}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-trends">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1 border border-border/50">
            {TIME_RANGE_OPTIONS.map(range => (
              <button
                key={range.key}
                onClick={() => setSelectedTimeRange(range)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  selectedTimeRange.key === range.key
                    ? "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-500 dark:text-cyan-300 border border-cyan-500/50 dark:border-cyan-400/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                data-testid={`trend-range-${range.key.toLowerCase()}`}
              >
                {range.label}
              </button>
            ))}
          </div>
          
          <div ref={dragScrollRef} className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1">
            {CATEGORY_OPTIONS.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  selectedCategory === cat
                    ? "bg-blue-500/25 dark:bg-blue-500/20 text-blue-500 dark:text-blue-300 border border-blue-500/50 dark:border-blue-400/40"
                    : "bg-muted/50 border border-border/50 text-muted-foreground hover:bg-muted/80"
                }`}
                data-testid={`trend-category-${cat.toLowerCase()}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4 md:p-6">
            <div className="h-[350px] md:h-[400px]">
              {isLoadingHistory ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-cyan-500 border-r-transparent"></div>
                    <p className="mt-4 text-sm text-muted-foreground">Loading trend history...</p>
                  </div>
                </div>
              ) : trendData.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-muted-foreground">No trend data available yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis 
                      dataKey="date" 
                      stroke="rgba(255,255,255,0.4)" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      interval="preserveStartEnd"
                      minTickGap={40}
                    />
                    <YAxis 
                      stroke="rgba(255,255,255,0.4)" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickFormatter={(value) => {
                        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                        if (value >= 1000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K`;
                        return value;
                      }}
                      width={50}
                    />
                    <Tooltip 
                      content={<MomentumTooltip people={filteredPeople} colors={MOMENTUM_COLORS} />}
                    />
                    {filteredPeople.map((person, idx) => (
                      visibleLines[person.id] && (
                        <Line
                          key={person.id}
                          type="monotone"
                          dataKey={person.id}
                          name={person.name}
                          stroke={MOMENTUM_COLORS[idx % MOMENTUM_COLORS.length]}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ 
                            r: 6, 
                            stroke: MOMENTUM_COLORS[idx % MOMENTUM_COLORS.length], 
                            strokeWidth: 2,
                            fill: 'rgba(0,0,0,0.8)'
                          }}
                          connectNulls
                        />
                      )
                    ))}
                  </RechartsLineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2 justify-center">
          {filteredPeople.map((person, idx) => (
            <button
              key={person.id}
              onClick={() => toggleLine(person.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                visibleLines[person.id]
                  ? "bg-muted/80 border border-border"
                  : "bg-muted/30 border border-border/30 opacity-50"
              }`}
              data-testid={`legend-toggle-${person.id}`}
            >
              <span 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: MOMENTUM_COLORS[idx % MOMENTUM_COLORS.length] }}
              />
              {person.name}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
