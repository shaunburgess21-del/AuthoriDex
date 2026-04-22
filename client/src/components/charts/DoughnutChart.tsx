import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Sector,
} from "recharts";
import { cn } from "@/lib/utils";

export interface DoughnutSegment {
  /** Stable key for the segment (used as the id for onSegmentClick). */
  id?: string;
  /** Human-readable label shown in the tooltip and legend. */
  label: string;
  /** Numeric value. Zero segments are filtered out. */
  value: number;
  /** Any valid CSS color. If omitted, falls back to a theme palette. */
  color?: string;
}

interface DoughnutChartProps {
  data: DoughnutSegment[];
  /** Big number shown in the middle of the doughnut. */
  centerTitle?: string | number;
  /** Secondary label below the centerTitle (e.g. "votes"). */
  centerSubtitle?: string;
  /** Height in px. Default 220. */
  height?: number;
  /** Inner radius ratio 0..1 (default 0.6). */
  innerRadiusRatio?: number;
  /** Render a legend below the chart. Default true. */
  showLegend?: boolean;
  /**
   * Called when a segment is clicked. Receives the segment's `id` (or label
   * when id is absent). Useful for "click a slice to filter" interactions.
   */
  onSegmentClick?: (id: string) => void;
  className?: string;
}

// Theme-agnostic fallback palette. Slightly desaturated variants of the core
// VoxDex palette so doughnut segments read as polished rather than clinical.
// Segments without an explicit color cycle through in order.
const FALLBACK_COLORS = [
  "#3B82F6", // blue (softened deep blue)
  "#22D3EE", // cyan
  "#A78BFA", // violet (softened)
  "#F59E0B", // amber
  "#34D399", // emerald (softened)
  "#F472B6", // pink
  "#FB923C", // orange (softened)
  "#94A3B8", // slate (softened)
];

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: DoughnutSegment & { color: string }; value: number }>;
  total: number;
}

function DoughnutTooltip({ active, payload, total }: TooltipProps) {
  if (!active || !payload || payload.length === 0 || total <= 0) return null;
  const seg = payload[0].payload;
  const pct = ((seg.value / total) * 100).toFixed(seg.value === total ? 0 : 1);
  return (
    <div className="rounded-lg border border-zinc-700/80 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-50 shadow-xl">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: seg.color }}
        />
        <span className="font-medium">{seg.label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2 font-mono">
        <span className="font-semibold">{seg.value}</span>
        <span className="text-zinc-300">({pct}%)</span>
      </div>
    </div>
  );
}

/**
 * A theme-aware doughnut chart with a center label, optional legend, and
 * optional click-to-filter behaviour.
 */
export function DoughnutChart({
  data,
  centerTitle,
  centerSubtitle,
  height = 220,
  innerRadiusRatio = 0.6,
  showLegend = true,
  onSegmentClick,
  className,
}: DoughnutChartProps) {
  const segments = useMemo(() => {
    return data
      .filter((d) => d.value > 0)
      .map((d, i) => ({
        ...d,
        color: d.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      }));
  }, [data]);

  const total = useMemo(
    () => segments.reduce((sum, s) => sum + s.value, 0),
    [segments],
  );

  if (segments.length === 0 || total <= 0) {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center",
          className,
        )}
        style={{ height }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="4 4"
            className="text-border"
          />
        </svg>
        <span className="absolute text-xs text-muted-foreground">No data yet</span>
      </div>
    );
  }

  return (
    <div className={cn("w-full overflow-visible", className)}>
      <div
        className="relative overflow-visible ring-1 ring-black/5 dark:ring-white/10"
        style={{ height }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Tooltip
              allowEscapeViewBox={{ x: true, y: true }}
              content={(props) => <DoughnutTooltip {...(props as any)} total={total} />}
              cursor={false}
              wrapperStyle={{ zIndex: 50 }}
            />
            <Pie
              data={segments}
              dataKey="value"
              nameKey="label"
              innerRadius={`${Math.round(innerRadiusRatio * 100)}%`}
              outerRadius="95%"
              paddingAngle={segments.length > 1 ? 2 : 0}
              strokeWidth={0}
              activeShape={(p: any) => (
                <Sector
                  {...p}
                  outerRadius={p.outerRadius + 4}
                />
              )}
              isAnimationActive
              onClick={(entry: any) => {
                if (!onSegmentClick) return;
                const id = entry?.id ?? entry?.label;
                if (typeof id === "string") onSegmentClick(id);
              }}
            >
              {segments.map((seg) => (
                <Cell
                  key={seg.id ?? seg.label}
                  fill={seg.color}
                  style={{ cursor: onSegmentClick ? "pointer" : "default" }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {(centerTitle !== undefined || centerSubtitle) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerTitle !== undefined && (
              <span className="font-mono text-2xl font-bold tabular-nums leading-none sm:text-3xl">
                {centerTitle}
              </span>
            )}
            {centerSubtitle && (
              <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {centerSubtitle}
              </span>
            )}
          </div>
        )}
      </div>

      {showLegend && segments.length > 0 && (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
          {segments.map((seg) => {
            const pct = ((seg.value / total) * 100).toFixed(0);
            return (
              <li
                key={seg.id ?? seg.label}
                className={cn(
                  "inline-flex items-center gap-1.5",
                  onSegmentClick && "cursor-pointer hover:opacity-80",
                )}
                onClick={() => {
                  if (!onSegmentClick) return;
                  onSegmentClick(seg.id ?? seg.label);
                }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: seg.color }}
                />
                <span className="truncate font-medium">{seg.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {seg.value}
                  <span className="ml-1 text-muted-foreground/70">({pct}%)</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
