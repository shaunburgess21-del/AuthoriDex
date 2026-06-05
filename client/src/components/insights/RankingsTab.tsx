import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Drawer } from "vaul";
import { Filter, Share2 } from "lucide-react";
import { toast } from "sonner";
import { shareInsightsView } from "@/lib/insights-share";
import {
  type InsightsFilters,
  type InsightsSource,
  type InsightsWindow,
  INSIGHTS_SOURCE_VALUES,
  writeInsightsQuery,
  parseFilters,
} from "@shared/insights/filters";
import { useInsightsRankings } from "@/lib/insights-hooks";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { PersonAvatar } from "@/components/PersonAvatar";
import { OverallRankPill } from "@/components/OverallRankPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { InsightsPill, SOURCE_DISPLAY } from "./insights-ui";
import { CategoryPill } from "@/components/CategoryPill";
import { getMarketCategoryLabel } from "@shared/constants";
import { cn } from "@/lib/utils";
import type { InsightsRankingRow } from "@shared/insights/types";

const PILL_HINTS: Record<InsightsSource, string> = {
  fame: "Same ranking as the home leaderboard",
  news_momentum: "Biggest news surge",
  wiki_momentum: "Biggest curiosity spike",
  news: "Most news coverage",
  wiki: "Most Wikipedia attention",
  search_volume: "Most-searched on Google",
};

const PILL_SOURCES: Array<{ id: InsightsSource; label: string; hint: string }> =
  INSIGHTS_SOURCE_VALUES.map((id) => ({
    id,
    label: SOURCE_DISPLAY[id],
    hint: PILL_HINTS[id],
  }));

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function formatSortValue(source: InsightsSource, row: InsightsRankingRow): string {
  if (source === "news_momentum") {
    const r = row.newsMomentum.ratio;
    return r != null ? `${r.toFixed(2)}×` : "—";
  }
  if (source === "wiki_momentum") {
    const r = row.wikiMomentum.ratio;
    return r != null ? `${r.toFixed(2)}×` : "—";
  }
  if (source === "fame") return row.fameIndex.toLocaleString();
  if (source === "search_volume") {
    return row.sortValue > 0 ? `${formatCompact(row.sortValue)}/mo` : "—";
  }
  return row.sortValue > 0 ? formatCompact(row.sortValue) : "—";
}

function metricSuffix(row: InsightsRankingRow): { suffix: string; tooltip?: string } {
  // Only show a suffix when it's a useful disambiguator. The Wiki 7d sum
  // doesn't need one (column header already says "Wikipedia (7d)") — but
  // news 7d does, because the value is an estimate (daily avg × 7), not a
  // true article count.
  if (row.metricKind === "weekly_estimate") {
    return {
      suffix: "(est.)",
      tooltip:
        "Estimated 7-day total from the trailing daily average. " +
        "News counts are 24-hour rolling totals, so a true weekly sum would double-count.",
    };
  }
  return { suffix: "" };
}

function metricColumnLabel(source: InsightsSource, window: InsightsWindow): string {
  if (source === "news") return window === "7d" ? "News (7d est.)" : "News (24h)";
  if (source === "wiki") return window === "7d" ? "Wikipedia (7d)" : "Wikipedia (24h)";
  return SOURCE_DISPLAY[source];
}

function deltaColumnLabel(row: InsightsRankingRow | undefined, window: InsightsWindow): string {
  if (row?.metricDeltaKind === "mom") return "MoM";
  return window === "7d" ? "7D" : "24H";
}

function DeltaCell({ value, className }: { value: number | null; className?: string }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }
  return (
    <span
      className={cn(
        "tabular-nums",
        value > 0 && "text-green-600 dark:text-green-400",
        value < 0 && "text-red-500",
        className,
      )}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

function MetricCell({ row, source }: { row: InsightsRankingRow; source: InsightsSource }) {
  const { suffix, tooltip } = metricSuffix(row);
  return (
    <span title={tooltip} className="inline-flex items-baseline gap-1">
      <span>{formatSortValue(source, row)}</span>
      {suffix && (
        <span className="text-[10px] font-normal text-muted-foreground">{suffix}</span>
      )}
    </span>
  );
}

export function RankingsTab() {
  const { isLoggedIn } = useAuth();
  const [filterOpen, setFilterOpen] = useState(false);
  const [, setUrlTick] = useState(0);
  const categorySet = useLeaderboardCategories();
  const categories = categorySet ? Array.from(categorySet).sort() : [];

  useEffect(() => {
    const onUrl = () => setUrlTick((t) => t + 1);
    window.addEventListener("popstate", onUrl);
    return () => window.removeEventListener("popstate", onUrl);
  }, []);

  const filters = parseFilters(window.location.search);
  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInsightsRankings(filters);
  const activePill = PILL_SOURCES.find((p) => p.id === filters.source);

  // Search interest is monthly-only; the 24h / 7d window doesn't apply there.
  // For momentum tabs the ratio is inherently 7d-normalised, so the window
  // toggle would mislead.
  const showWindowControl =
    filters.source !== "search_volume" &&
    filters.source !== "news_momentum" &&
    filters.source !== "wiki_momentum";

  const setSource = (source: InsightsSource) => {
    logInsightsEvent("rankings", "pill_change", { source });
    writeInsightsQuery({ tab: "rankings", filters: { ...filters, source, page: 1 } });
  };

  const patchFilters = (patch: Partial<InsightsFilters>) => {
    logInsightsEvent("rankings", "filter_change", patch as Record<string, unknown>);
    writeInsightsQuery({ tab: "rankings", filters: { ...filters, ...patch, page: 1 } });
  };

  // Flatten pages into one continuous list.
  const allRows = useMemo<InsightsRankingRow[]>(
    () => data?.pages.flatMap((p) => p.rows) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;
  const asOf = data?.pages[0]?.asOf ?? null;

  const { ref: loadMoreRef, isIntersecting } = useIntersectionObserver<HTMLDivElement>({
    enabled: hasNextPage && !isFetchingNextPage,
  });

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filterControls = (
    <div className="flex flex-wrap gap-3 items-center text-sm">
      {showWindowControl && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          % change window
          <select
            className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs"
            value={filters.window}
            onChange={(e) => patchFilters({ window: e.target.value as InsightsFilters["window"] })}
          >
            <option value="24h">24h</option>
            <option value="7d">7d</option>
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Category
        <select
          className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs max-w-[140px]"
          value={filters.category ?? ""}
          onChange={(e) => patchFilters({ category: e.target.value || null })}
        >
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {getMarketCategoryLabel(c)}
            </option>
          ))}
        </select>
      </label>
      {isLoggedIn && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={filters.favouritesOnly}
            onChange={(e) => patchFilters({ favouritesOnly: e.target.checked })}
          />
          Favourites only
        </label>
      )}
    </div>
  );

  // Only the Trend Score tab carries a % delta column — for the other tabs
  // the single metric column is the whole story (no Trend Score / delta).
  const showDelta = filters.source === "fame";

  return (
    <div className="space-y-4 md:space-y-5">
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
        {PILL_SOURCES.map((pill) => (
          <InsightsPill
            key={pill.id}
            active={filters.source === pill.id}
            title={pill.hint}
            onClick={() => setSource(pill.id)}
          >
            {pill.label}
          </InsightsPill>
        ))}
      </div>

      <Drawer.Root open={filterOpen} onOpenChange={setFilterOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-50" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 rounded-t-xl bg-background p-4 pb-24 max-h-[85vh]">
            <Drawer.Title className="font-semibold mb-4">Filters</Drawer.Title>
            <div className="space-y-4">{filterControls}</div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      )}
      {isError && (
        <p className="text-sm text-destructive">Could not load rankings. Try again shortly.</p>
      )}

      {data && allRows.length > 0 && (
        <Card className="overflow-hidden">
          {/* Grey top strip — matches Daily Movers (neutral), not the blue
              home leaderboard or cyan approval leaderboard. */}
          <div className="relative isolate overflow-hidden rounded-t-xl">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] bg-[linear-gradient(90deg,transparent_0%,rgba(148,163,184,0.6)_50%,transparent_100%)]"
              aria-hidden
            />
            <CardHeader className="relative z-[2] gap-3 space-y-0 bg-card/95 pb-4 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-2xl font-serif flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-muted-foreground" aria-hidden />
                    Rankings
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground/80">
                    Sorted by{" "}
                    <span className="font-medium text-foreground">
                      {SOURCE_DISPLAY[filters.source]}
                    </span>
                    {activePill ? ` — ${activePill.hint}` : ""}
                    {asOf && (
                      <span className="hidden sm:inline">
                        {" "}
                        · as of{" "}
                        {new Date(asOf).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </p>
                  {filters.source === "search_volume" && (
                    <p className="text-[11px] text-muted-foreground/70 mt-1.5 leading-relaxed">
                      Google search interest is reported monthly — the change shown is
                      month-over-month.
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  onClick={async () => {
                    try {
                      const result = await shareInsightsView({
                        tab: "rankings",
                        filters,
                        title: `VoxDex Insights — ${SOURCE_DISPLAY[filters.source]}`,
                        surface: "rankings",
                        telemetryParams: { source: filters.source, category: filters.category },
                      });
                      toast(result === "shared" ? "Shared" : "Link copied", {
                        description:
                          result === "copied" ? "Insights link copied to clipboard." : undefined,
                      });
                    } catch {
                      /* cancelled */
                    }
                  }}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
              </div>
            </CardHeader>
          </div>

          {/* Toolbar — filters (desktop inline / mobile drawer) */}
          <div className="border-b border-border/60 bg-muted/30 px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              className="md:hidden"
              onClick={() => setFilterOpen(true)}
            >
              <Filter className="h-4 w-4 mr-1.5" />
              Filters
            </Button>
            <div className="hidden md:block">{filterControls}</div>
          </div>

          <CardContent className="p-0">
            {/* DESKTOP — table */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pl-4 pr-2 py-3 font-medium w-12" aria-label="Rank" />
                    <th className="px-2 py-3 font-medium" aria-label="Person" />
                    <th className="px-4 py-3 font-medium text-right w-36">
                      {metricColumnLabel(filters.source, filters.window)}
                    </th>
                    {showDelta && (
                      <th className="px-4 py-3 font-medium text-right w-20">
                        {deltaColumnLabel(allRows[0], filters.window)}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/30 hover:bg-muted/30 transition-colors"
                    >
                      <td className="pl-4 pr-2 py-3 text-center font-semibold text-base tabular-nums text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-3">
                        <Link
                          href={`/person/${row.id}`}
                          onClick={() => logInsightsEvent("rankings", "row_click", { personId: row.id })}
                          className="flex items-center gap-3 group"
                        >
                          <PersonAvatar name={row.name} avatar={row.avatar} size="md" />
                          <div className="min-w-0">
                            <p className="font-medium truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                              {row.name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {row.category && <CategoryPill category={row.category} size="sm" />}
                              <OverallRankPill rank={row.rank} size="xs" />
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        <MetricCell row={row} source={filters.source} />
                      </td>
                      {showDelta && (
                        <td className="px-4 py-3 text-right text-xs">
                          <DeltaCell value={row.metricDelta} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* MOBILE — stacked rows */}
            <div className="md:hidden divide-y divide-border/30">
              {allRows.map((row, idx) => (
                <Link
                  key={row.id}
                  href={`/person/${row.id}`}
                  onClick={() => logInsightsEvent("rankings", "row_click", { personId: row.id })}
                  className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
                >
                  <span className="text-base font-semibold text-muted-foreground w-6 shrink-0 text-center tabular-nums">
                    {idx + 1}
                  </span>
                  <PersonAvatar name={row.name} avatar={row.avatar} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{row.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {row.category && <CategoryPill category={row.category} size="sm" />}
                      <OverallRankPill rank={row.rank} size="xs" />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">
                      <MetricCell row={row} source={filters.source} />
                    </p>
                    {showDelta && (
                      <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                        <DeltaCell value={row.metricDelta} className="text-[10px]" />
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {/* Infinite-scroll sentinel + load state */}
            <div
              ref={loadMoreRef}
              className="px-4 py-3 text-center border-t border-border/30"
              data-testid="rankings-load-more"
            >
              {isFetchingNextPage ? (
                <p className="text-xs text-muted-foreground">Loading more…</p>
              ) : hasNextPage ? (
                <p className="text-xs text-muted-foreground/70">Scroll for more</p>
              ) : (
                <p className="text-xs text-muted-foreground/70">
                  Showing all {total} {total === 1 ? "person" : "people"}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {data && allRows.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12 rounded-xl border border-dashed border-border/50">
          No results for these filters.
        </p>
      )}
    </div>
  );
}
