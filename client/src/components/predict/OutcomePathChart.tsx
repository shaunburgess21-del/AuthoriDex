import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface OutcomePathChartProps {
  marketId: string;
  baselineScore: number;
  currentScore: number;
  personName: string;
  height?: number;
  compact?: boolean;
  userPick?: "up" | "down" | null;
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
    enteredScore: number;
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
  const delta = baseline ? score - baseline : 0;
  const pct = baseline && baseline > 0 ? ((delta / baseline) * 100).toFixed(2) : "0";
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <p className="text-muted-foreground">{formatTooltipTime(point.timestamp)}</p>
      <p className="font-mono font-bold text-sm">{formatScore(score)}</p>
      {baseline && (
        <p className={`font-semibold ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>
          {delta >= 0 ? "+" : ""}{formatScore(delta)} ({delta >= 0 ? "+" : ""}{pct}%) vs baseline
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
}: OutcomePathChartProps) {
  const { data, isLoading } = useQuery<MarketHistory>({
    queryKey: [`/api/native-markets/${marketId}/history`],
    enabled: !!marketId,
    staleTime: 60_000,
  });

  const chartData = useMemo(() => {
    if (!data?.history || data.history.length === 0) return [];
    return data.history.map((h) => ({
      timestamp: h.timestamp,
      fameIndex: h.fameIndex,
    }));
  }, [data]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const scores = chartData.map((d) => d.fameIndex);
    if (baselineScore) scores.push(baselineScore);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const padding = (max - min) * 0.15 || 1000;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData, baselineScore]);

  const tickInterval = useMemo(() => {
    return Math.max(1, Math.floor(chartData.length / (compact ? 4 : 6)));
  }, [chartData, compact]);

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
            Delta:{" "}
            <span className={`font-mono font-medium ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>
              {delta >= 0 ? "+" : ""}{formatScore(delta)} ({delta >= 0 ? "+" : ""}{pctDelta}%)
            </span>
          </span>
        </div>
      )}

      <div style={{ height: compact ? 140 : height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 8, left: compact ? 0 : 4, bottom: 5 }}>
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
              domain={yDomain as [number, number]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
              axisLine={false}
              tickLine={false}
              width={compact ? 36 : 44}
              mirror={compact}
            />
            <Tooltip content={<ChartTooltip baseline={baselineScore} />} />
            {baselineScore > 0 && (
              <ReferenceLine
                y={baselineScore}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="6 3"
                strokeOpacity={0.5}
                label={compact ? undefined : { value: "Baseline", position: "right", fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              />
            )}
            <Area
              type="monotone"
              dataKey="fameIndex"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill={`url(#aboveBaseline-${marketId})`}
              dot={false}
              activeDot={{
                r: compact ? 3 : 5,
                fill: "hsl(var(--primary))",
                stroke: "hsl(var(--background))",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </AreaChart>
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
