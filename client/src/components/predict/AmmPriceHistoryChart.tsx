/**
 * Full-fidelity AMM price chart for detail pages. Uses recharts (the
 * same lib our other detail-page charts use) and supports an arbitrary
 * number of outcome series. Binary markets (updown / h2h) render two
 * lines; multi-outcome community / gainer markets render one line per
 * outcome.
 *
 * Empty data behaviour: if the market hasn't been sampled yet the
 * chart renders a flat line at `fallbackPrices` so users on brand-new
 * markets see something meaningful (the live LMSR price) instead of
 * a blank rectangle.
 *
 * Data source: `/api/markets/:id/price-history?bucket=5m&from=-7d`,
 * polled every 60s while the page is visible. The endpoint already
 * buckets server-side, so we just plot whatever it returns.
 */

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { usePriceHistory } from "@/lib/ammClient";
import { formatVoxPrice } from "@/lib/currency";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatAxisTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function formatTooltipTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export interface AmmPriceHistoryChartSeries {
  entryId: string;
  label: string;
  /** Tailwind hex (e.g. "#10b981"). Recharts strokes accept raw colors. */
  color: string;
}

export interface AmmPriceHistoryChartProps {
  marketId: string;
  series: AmmPriceHistoryChartSeries[];
  /** Live prices keyed by entryId. Used as right-edge anchor + empty-state. */
  livePrices: Record<string, number>;
  /** Time range in ms; default 7 days. */
  fromMs?: number;
  height?: number;
  bucket?: "5m" | "1h" | "1d";
}

interface ChartRow {
  bucket: string;
  // Dynamic per-series price keyed by entryId.
  [entryId: string]: string | number;
}

function ChartTooltip({ active, payload, series }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const ts = payload[0].payload.bucket;
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-xl text-xs space-y-0.5">
      <p className="text-muted-foreground">{formatTooltipTime(ts)}</p>
      {series.map((s: AmmPriceHistoryChartSeries) => {
        const p = payload[0].payload[s.entryId] as number | undefined;
        if (typeof p !== "number") return null;
        return (
          <p key={s.entryId} className="font-mono">
            <span style={{ color: s.color }}>● </span>
            {s.label}{" "}
            <span className="font-semibold">{(p * 100).toFixed(1)}%</span>
            <span className="text-muted-foreground/70"> · {formatVoxPrice(p, 3)}</span>
          </p>
        );
      })}
    </div>
  );
}

const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

export function AmmPriceHistoryChart({
  marketId,
  series,
  livePrices,
  fromMs = DEFAULT_RANGE_MS,
  height = 220,
  bucket = "5m",
}: AmmPriceHistoryChartProps) {
  const { data, isLoading } = usePriceHistory(marketId, {
    bucket,
    fromMs,
    refetchMs: 60_000,
  });

  const rows = useMemo<ChartRow[]>(() => {
    // Pivot points -> rows keyed by bucket timestamp.
    const byBucket = new Map<string, ChartRow>();
    for (const p of data?.points ?? []) {
      const row = byBucket.get(p.bucket) ?? { bucket: p.bucket };
      row[p.entryId] = p.price;
      byBucket.set(p.bucket, row);
    }
    const ordered = Array.from(byBucket.values()).sort(
      (a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime(),
    );

    // Anchor right edge to live prices so the chart agrees with the
    // headline Live Market panel. Without this a market with no
    // recent trades would lag the live %.
    const liveRow: ChartRow = { bucket: new Date().toISOString() };
    for (const s of series) {
      const lp = livePrices[s.entryId];
      if (typeof lp === "number") liveRow[s.entryId] = lp;
    }
    ordered.push(liveRow);

    // Forward-fill missing series values per row so a quiet outcome's
    // line doesn't drop out for buckets where only the other side
    // moved. recharts treats undefined as "break the line", which
    // looks broken on what is really just a stable price.
    const lastSeen: Record<string, number> = {};
    for (const row of ordered) {
      for (const s of series) {
        if (typeof row[s.entryId] === "number") {
          lastSeen[s.entryId] = row[s.entryId] as number;
        } else if (typeof lastSeen[s.entryId] === "number") {
          row[s.entryId] = lastSeen[s.entryId];
        }
      }
    }

    return ordered;
  }, [data, series, livePrices]);

  if (isLoading) {
    return <Skeleton style={{ height }} className="w-full" />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis
          dataKey="bucket"
          tickFormatter={formatAxisTime}
          tick={{ fontSize: 10 }}
          minTickGap={32}
        />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
          tick={{ fontSize: 10 }}
          width={36}
        />
        <Tooltip content={<ChartTooltip series={series} />} />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          iconType="line"
          align="right"
          verticalAlign="top"
          height={20}
        />
        {series.map((s) => (
          <Line
            key={s.entryId}
            dataKey={s.entryId}
            name={s.label}
            stroke={s.color}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
            type="monotone"
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
