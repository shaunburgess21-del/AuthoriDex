import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid } from "lucide-react";
import { DoughnutChart, type DoughnutSegment } from "@/components/charts/DoughnutChart";
import { getCategoryHexColor, CategoryPill } from "@/components/CategoryPill";
import type { InsightsCategoryMix } from "@shared/insights/types";
import { buildCategoryMix } from "@shared/insights/category-mix";
import { getAuthHeaders } from "@/lib/queryClient";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightsEmptyState } from "./insights-ui";

interface TopCategoryMixTileProps {
  mix?: InsightsCategoryMix | null;
}

async function fetchTopCategoryMixFallback(): Promise<InsightsCategoryMix> {
  const headers = await getAuthHeaders();
  const res = await fetch("/api/leaderboard?tab=fame&limit=50", {
    credentials: "include",
    headers,
  });
  if (!res.ok) throw new Error("Failed to load leaderboard for category mix");
  const json = (await res.json()) as { data?: Array<{ category?: string | null; rank?: number | null }> };
  return buildCategoryMix(json.data ?? []);
}

function hasCategoryMixData(mix?: InsightsCategoryMix | null): mix is InsightsCategoryMix {
  return Boolean(mix && mix.topN > 0 && mix.segments.length > 0);
}

export function TopCategoryMixTile({ mix }: TopCategoryMixTileProps) {
  const categoryRegistry = useCategoryRegistry();
  const needsFallback = !hasCategoryMixData(mix);
  const { data: fallbackMix, isLoading, isError } = useQuery({
    queryKey: ["/api/leaderboard", "category-mix-top50"],
    queryFn: fetchTopCategoryMixFallback,
    enabled: needsFallback,
    staleTime: 90_000,
  });

  const resolvedMix = hasCategoryMixData(mix) ? mix : fallbackMix;
  const segments = resolvedMix?.segments ?? [];
  const topN = resolvedMix?.topN ?? 0;

  const doughnutSegments: DoughnutSegment[] = useMemo(
    () =>
      segments.map((row) => {
        const colorKey = categoryRegistry.resolveCanonicalId(row.category);
        return {
          id: row.category,
          label: row.label,
          value: row.count,
          color: getCategoryHexColor(row.category, colorKey),
        };
      }),
    [segments, categoryRegistry],
  );

  const maxCount = useMemo(
    () => Math.max(...segments.map((row) => row.count), 1),
    [segments],
  );
  const leader = segments[0];

  if (needsFallback && isLoading) {
    return <Skeleton className="h-56 w-full rounded-lg" />;
  }

  if (needsFallback && isError) {
    return <InsightsEmptyState message="Could not load category breakdown. Try again shortly." />;
  }

  if (!hasCategoryMixData(resolvedMix)) {
    return <InsightsEmptyState message="Not enough leaderboard data for a category breakdown yet." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground tabular-nums">{topN}</span> ranked
        </span>
        <span>
          <span className="font-semibold text-foreground tabular-nums">{segments.length}</span>{" "}
          {segments.length === 1 ? "category" : "categories"}
        </span>
        {leader ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            Leading:
            <CategoryPill
              category={leader.category}
              canonicalIdOverride={categoryRegistry.resolveCanonicalId(leader.category)}
              displayLabel={categoryRegistry.getDisplayLabel(leader.category)}
              size="sm"
            />
            <span className="font-semibold text-foreground tabular-nums">
              {leader.count} ({leader.pct}%)
            </span>
          </span>
        ) : null}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground mb-3">Category share</p>
          <DoughnutChart
            data={doughnutSegments}
            centerTitle={topN}
            centerSubtitle={`top ${topN}`}
            height={200}
            innerRadiusRatio={0.62}
          />
          {leader ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Largest slice: {leader.label} ({leader.count})
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground mb-3">By count</p>
          <ul className="space-y-2.5">
            {segments.map((row) => {
              const barPct = Math.round((row.count / maxCount) * 100);
              const colorKey = categoryRegistry.resolveCanonicalId(row.category);
              const color = getCategoryHexColor(row.category, colorKey);
              return (
                <li key={row.category}>
                  <div className="flex items-center justify-between gap-2 text-xs mb-1">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                      <span className="font-medium truncate">{row.label}</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {row.count}
                      <span className="ml-1 text-muted-foreground/70">({row.pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(4, barPct)}%`,
                        background: `linear-gradient(90deg, ${color}cc, ${color}99)`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {leader ? (
            <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
              Dominating: {leader.label} ({leader.count} of {topN})
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
