import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

interface FameSnapshot {
  timestamp: string;
  fameIndex: number;
}

/**
 * 24h fame-score line chart used by the admin Score Breakdown dialog.
 * Lives in its own file so AdminDashboard's chunk doesn't pull in
 * vendor-recharts — this was the dashboard's only recharts usage
 * (Phase 3+4 B6). Loaded via React.lazy from AdminDashboard.
 */
export function AdminFameHistoryChart({ snapshots }: { snapshots: FameSnapshot[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={snapshots.map(s => ({
        ...s,
        time: new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }))}>
        <XAxis 
          dataKey="time" 
          tick={{ fontSize: 10 }} 
          interval="preserveStartEnd"
          stroke="hsl(var(--muted-foreground))"
        />
        <YAxis 
          tick={{ fontSize: 10 }}
          tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}K` : val}
          stroke="hsl(var(--muted-foreground))"
          domain={['auto', 'auto']}
        />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: 'hsl(var(--popover))', 
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
            fontSize: '12px'
          }}
          formatter={(value: number) => [value.toLocaleString(), "Fame Index (Final)"]}
          labelFormatter={(label) => `Time: ${label}`}
        />
        <Line 
          type="monotone" 
          dataKey="fameIndex" 
          stroke="hsl(263, 70%, 50%)" 
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
