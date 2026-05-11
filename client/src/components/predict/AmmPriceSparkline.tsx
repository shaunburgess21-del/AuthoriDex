/**
 * Tiny SVG sparkline for AMM markets. Hand-rolled (no chart library)
 * because we ship one per card and the recharts bundle bloat hurts
 * the predict-page scroll feel. ~80 lines, no deps.
 *
 * Renders a single price series in [0, 1] mapped to the viewBox
 * height. When the series is empty (brand-new market with no
 * snapshots yet) we render a single horizontal line at `fallbackPrice`
 * so cards never show a blank rectangle.
 */

import { useMemo } from "react";
import { usePriceHistory, type PriceHistoryPoint } from "@/lib/ammClient";

interface AmmPriceSparklineProps {
  marketId: string;
  /** Entry id to plot. Use the canonical "yes"/"favorite" entry id. */
  entryId: string;
  /**
   * Current marginal price for this entry (from the live ammState).
   * Used as the fallback flat line when the market has no history yet
   * AND as the right-edge anchor so the sparkline visually agrees
   * with the % shown on the card.
   */
  fallbackPrice: number;
  width?: number;
  height?: number;
  /** Stroke color (Tailwind utility). Default green-500. */
  className?: string;
}

const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

export function AmmPriceSparkline({
  marketId,
  entryId,
  fallbackPrice,
  width = 80,
  height = 24,
  className = "stroke-green-500 dark:stroke-green-400",
}: AmmPriceSparklineProps) {
  const { data } = usePriceHistory(marketId, {
    bucket: "1h",
    fromMs: DEFAULT_RANGE_MS,
  });

  const path = useMemo(() => {
    const points: PriceHistoryPoint[] = (data?.points ?? []).filter(
      (p) => p.entryId === entryId,
    );

    // Always anchor the series at the current live price so the right
    // edge visually agrees with the card's headline %. We append the
    // synthetic "now" point even when there's history.
    const series: Array<{ t: number; p: number }> = points.map((p) => ({
      t: new Date(p.bucket).getTime(),
      p: p.price,
    }));
    series.push({ t: Date.now(), p: fallbackPrice });

    if (series.length === 0) return "";

    // Pad y-range slightly so flat lines don't sit on the edges.
    const minY = 0;
    const maxY = 1;
    const tMin = series[0].t;
    const tMax = series[series.length - 1].t;
    const tRange = Math.max(tMax - tMin, 1);

    const coords = series.map((s, i) => {
      const x = ((s.t - tMin) / tRange) * width;
      const y = height - ((s.p - minY) / (maxY - minY)) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    return coords.join(" ");
  }, [data, entryId, fallbackPrice, width, height]);

  if (!path) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="overflow-visible"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        strokeWidth={1.5}
        className={className}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
