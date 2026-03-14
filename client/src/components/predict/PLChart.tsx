import { useMemo, useId } from "react";
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

interface PLPrediction {
  createdAt: string;
  result: "won" | "lost" | "refunded" | "pending";
  stakeAmount: number;
  payout: number;
}

interface PLChartProps {
  predictions: PLPrediction[];
  height?: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatAxisDate(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function PLTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  const val = pt.cumulative;
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs">
      <p className="text-muted-foreground">{formatAxisDate(pt.date)}</p>
      <p className={`font-mono font-bold text-sm ${val >= 0 ? "text-green-500" : "text-red-500"}`}>
        {val >= 0 ? "+" : ""}{val.toLocaleString("en-US")} credits
      </p>
      <p className="text-muted-foreground">{pt.label}</p>
    </div>
  );
}

export function PLChart({ predictions, height = 240 }: PLChartProps) {
  const id = useId();
  const greenGradId = `plGreenGrad-${id.replace(/:/g, "")}`;
  const redGradId = `plRedGrad-${id.replace(/:/g, "")}`;

  const chartData = useMemo(() => {
    const resolved = predictions
      .filter((p) => p.result === "won" || p.result === "lost")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (resolved.length === 0) return [];

    let cumulative = 0;
    return resolved.map((p) => {
      const pl = p.result === "won" ? p.payout - p.stakeAmount : -p.stakeAmount;
      cumulative += pl;
      return {
        date: p.createdAt,
        cumulative,
        label: p.result === "won" ? `Won +${p.payout - p.stakeAmount}` : `Lost -${p.stakeAmount}`,
      };
    });
  }, [predictions]);

  if (chartData.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground border border-border/30 rounded-lg bg-muted/10"
        style={{ height }}
      >
        Need at least 2 resolved predictions for P/L chart
      </div>
    );
  }

  const yValues = chartData.map((d) => d.cumulative);
  const yMin = Math.min(0, ...yValues);
  const yMax = Math.max(0, ...yValues);
  const padding = (yMax - yMin) * 0.15 || 100;
  const latestValue = chartData[chartData.length - 1].cumulative;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-medium text-foreground">Cumulative P/L</p>
        <p className={`text-sm font-mono font-bold ${latestValue >= 0 ? "text-green-500" : "text-red-500"}`}>
          {latestValue >= 0 ? "+" : ""}{latestValue.toLocaleString("en-US")}
        </p>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 8, left: 4, bottom: 5 }}>
            <defs>
              <linearGradient id={greenGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={redGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.08} />
            <XAxis
              dataKey="date"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              tickFormatter={formatAxisDate}
              interval={Math.max(1, Math.floor(chartData.length / 6))}
              axisLine={false}
              tickLine={false}
              tickMargin={6}
            />
            <YAxis
              domain={[Math.floor(yMin - padding), Math.ceil(yMax + padding)]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip content={<PLTooltip />} />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.4} />
            <Area
              type="monotone"
              dataKey="cumulative"
              stroke={latestValue >= 0 ? "#22c55e" : "#ef4444"}
              strokeWidth={2}
              fill={latestValue >= 0 ? `url(#${greenGradId})` : `url(#${redGradId})`}
              dot={false}
              activeDot={{
                r: 5,
                fill: latestValue >= 0 ? "#22c55e" : "#ef4444",
                stroke: "hsl(var(--background))",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
