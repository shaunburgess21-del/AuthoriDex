import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { RefreshCw, Share2 } from "lucide-react";
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
import { mergeDedupedRankingRows } from "@shared/insights/rankings-pagination";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { ScrollMaskedChipRow } from "@/components/ScrollMaskedChipRow";
import { PersonAvatar } from "@/components/PersonAvatar";
import { OverallRankPill } from "@/components/OverallRankPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { FilterDropdown } from "@/components/FilterDropdown";
import { navigateToLogin } from "@/lib/authReturn";
import {
  InsightsPill,
  InsightsWindowToggle,
  SOURCE_DISPLAY,
  insightsTabShadcnCardClass,
} from "./insights-ui";
import { CategoryPill, getCategoryTextColor } from "@/components/CategoryPill";
import { getMarketCategoryLabel } from "@shared/constants";
import { cn } from "@/lib/utils";
import type { InsightsRankingRow } from "@shared/insights/types";

const PILL_HINTS: Record<InsightsSource, string> = {
  fame: "Biggest Trend Score change",
  news_momentum: "News coverage is higher than their typical day",
  wiki_momentum: "Wikipedia page views are higher than their typical day",
  news: "Most news coverage",
  wiki: "Most Wikipedia page views",
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
  if (source === "news_momentum" || source === "wiki_momentum") return "Momentum";
  if (source === "search_volume") return "Searches";
  if (source === "news") return window === "7d" ? "Articles 7d" : "Articles 24h";
  if (source === "wiki") return window === "7d" ? "Views 7d" : "Views 24h";
  return SOURCE_DISPLAY[source];
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

/**
 * Joined rank-cell + avatar container, ported from the home LeaderboardRow so
 * Rankings rows get the same cohesive "rank tile glued to the avatar" look.
 */
function RankAvatarUnit({
  rank,
  name,
  avatar,
}: {
  rank: number;
  name: string;
  avatar: string | null;
}) {
  return (
    <div className="relative flex items-center rounded-lg overflow-hidden shrink-0">
      <div className="flex items-center justify-center min-w-[32px] sm:min-w-[36px] h-12 rounded-l-lg bg-muted border-r border-border dark:border-transparent dark:bg-[#101318]">
        <span className="font-mono font-semibold text-muted-foreground dark:text-slate-400 text-[16px] sm:text-[18px] tabular-nums">
          {rank}
        </span>
      </div>
      <PersonAvatar
        name={name}
        avatar={avatar}
        size="md"
        className="h-12 w-12 rounded-none rounded-r-md"
      />
    </div>
  );
}

function RankingsPersonMeta({
  category,
  rank,
}: {
  category: string | null;
  rank: number;
}) {
  return (
    <div className="mt-0.5 min-w-0">
      <div className="hidden items-center gap-1.5 md:flex flex-wrap">
        {category && <CategoryPill category={category} size="sm" />}
        <OverallRankPill rank={rank} size="xs" />
      </div>
      <p className="truncate text-[11px] leading-tight md:hidden">
        <span className="inline-flex min-w-0 items-center gap-1">
          {category && (
            <span className={cn("truncate", getCategoryTextColor(category))}>
              {getMarketCategoryLabel(category)}
            </span>
          )}
          {category && rank > 0 && (
            <span className="shrink-0 text-muted-foreground/60">·</span>
          )}
          {rank > 0 && <OverallRankPill rank={rank} size="mover" />}
        </span>
      </p>
    </div>
  );
}

function RankingsMobileMetricColumn({
  row,
  hasSecondaryCol,
  isMovers,
  isSearch,
  renderPrimary,
}: {
  row: InsightsRankingRow;
  hasSecondaryCol: boolean;
  isMovers: boolean;
  isSearch: boolean;
  renderPrimary: (row: InsightsRankingRow) => ReactNode;
}) {
  const mobileSecondaryLabel = isMovers ? "Score" : isSearch ? "MoM" : "";

  return (
    <div className="min-w-[4.5rem] max-w-[5.75rem] shrink-0 text-right sm:max-w-[6.5rem]">
      <p className="truncate text-sm font-mono font-semibold tabular-nums leading-none">
        {renderPrimary(row)}
      </p>
      {hasSecondaryCol && (
        <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground tabular-nums">
          {mobileSecondaryLabel}{" "}
          {isMovers ? (
            <span className="tabular-nums">{row.fameIndex.toLocaleString()}</span>
          ) : (
            <DeltaCell value={row.metricDelta} className="text-[10px]" />
          )}
        </p>
      )}
    </div>
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
  const [, setLocation] = useLocation();
  const [, setUrlTick] = useState(0);
  const categorySet = useLeaderboardCategories();
  const categories = categorySet ? Array.from(categorySet).sort() : [];

  // Mirror the home leaderboard freshness pill so Rankings reflects the same
  // "Updated Xm ago" cadence rather than a precise (and for Wiki/Search,
  // misleading) clock time.
  const { data: systemFreshness } = useQuery<{
    lastScoredAtFormatted: string;
    fullRefreshAtFormatted: string | null;
  }>({
    queryKey: ["/api/system/freshness"],
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
  const freshnessLabel =
    systemFreshness?.fullRefreshAtFormatted ||
    systemFreshness?.lastScoredAtFormatted ||
    "recently";

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
  const windowToggleAriaLabel =
    filters.source === "fame" ? "Movers time window" : "Time window";

  const setSource = (source: InsightsSource) => {
    logInsightsEvent("rankings", "pill_change", { source });
    writeInsightsQuery({ tab: "rankings", filters: { ...filters, source, page: 1 } });
  };

  const patchFilters = (patch: Partial<InsightsFilters>) => {
    logInsightsEvent("rankings", "filter_change", patch as Record<string, unknown>);
    writeInsightsQuery({ tab: "rankings", filters: { ...filters, ...patch, page: 1 } });
  };

  // Flatten pages into one continuous list.
  const allRows = useMemo(
    () => mergeDedupedRankingRows(data?.pages),
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;

  const { ref: loadMoreRef, isIntersecting } = useIntersectionObserver<HTMLDivElement>({
    enabled: hasNextPage && !isFetchingNextPage,
  });

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const windowToggle = showWindowControl ? (
    <InsightsWindowToggle
      value={filters.window}
      onChange={(window) => patchFilters({ window })}
      ariaLabel={windowToggleAriaLabel}
    />
  ) : null;

  const rankingsFilterCategories = useMemo(() => {
    const pinned = [
      { value: "all", label: "All Categories" },
      ...(isLoggedIn ? [{ value: "favorites", label: "Favorites" }] : []),
    ];
    const dynamic = categories
      .filter((id) => id && id !== "all" && id !== "favorites" && id !== "trending")
      .map((id) => ({ value: id, label: getMarketCategoryLabel(id) }));
    const currentCategory = filters.category;
    if (
      currentCategory &&
      currentCategory !== "all" &&
      currentCategory !== "favorites" &&
      !dynamic.some((c) => c.value === currentCategory)
    ) {
      dynamic.unshift({
        value: currentCategory,
        label: getMarketCategoryLabel(currentCategory),
      });
    }
    return [...pinned, ...dynamic];
  }, [categories, filters.category, isLoggedIn]);

  const filterDropdownValue = filters.favouritesOnly
    ? "favorites"
    : filters.category ?? "all";

  const handleFilterChange = (value: string) => {
    if (value === "all") {
      patchFilters({ category: null, favouritesOnly: false });
      return;
    }
    if (value === "favorites") {
      if (!isLoggedIn) {
        navigateToLogin(setLocation);
        return;
      }
      patchFilters({ category: null, favouritesOnly: true });
      return;
    }
    patchFilters({ category: value, favouritesOnly: false });
  };

  const filterToolbar = (
    <div className="flex items-center gap-2">
      <FilterDropdown
        value={filterDropdownValue}
        onChange={handleFilterChange}
        categories={rankingsFilterCategories}
        sortDirection={filters.sortDir}
        onSortDirectionChange={(sortDir) => patchFilters({ sortDir })}
        isActive={filterDropdownValue !== "all" || filters.sortDir !== "desc"}
        testId="rankings-filter"
      />
      {windowToggle}
    </div>
  );

  // Column model:
  // - Movers (fame): primary column is the windowed % change (the board is
  //   sorted by it); Trend Score is shown as a secondary context column.
  // - Search interest: primary column is monthly volume; MoM % change is the
  //   secondary column.
  // - Everything else: a single metric column tells the whole story.
  const isMovers = filters.source === "fame";
  const isSearch = filters.source === "search_volume";
  const hasSecondaryCol = isMovers || isSearch;

  const primaryColLabel = isMovers
    ? `${filters.window === "7d" ? "7D" : "24H"} change`
    : metricColumnLabel(filters.source, filters.window);
  const secondaryColLabel = isMovers ? "Trend Score" : isSearch ? "MoM" : "";

  const rankingsMetricColgroup = (
    <colgroup>
      <col />
      <col className="w-36" />
      {hasSecondaryCol && <col className="w-24" />}
    </colgroup>
  );

  const metricHeaderClass =
    "w-36 px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground";
  const secondaryHeaderClass =
    "w-24 px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

  const renderPrimary = (row: InsightsRankingRow) =>
    isMovers ? (
      <DeltaCell value={row.metricDelta} />
    ) : (
      <MetricCell row={row} source={filters.source} />
    );
  const renderSecondary = (row: InsightsRankingRow) =>
    isMovers ? (
      <span className="tabular-nums text-muted-foreground">
        {row.fameIndex.toLocaleString()}
      </span>
    ) : isSearch ? (
      <DeltaCell value={row.metricDelta} />
    ) : null;

  // Keep the active source pill visible in the scroll-masked row.
  const activePillRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    activePillRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [filters.source]);

  // The pills stick directly below the (separately-rendered) main insights tab
  // bar. Measure that bar's height at runtime rather than hardcoding an offset,
  // so the pills never tuck underneath it across breakpoints / font scaling.
  // SiteHeader is h-16 (64px) and the tab bar sticks at top-16.
  const [pillStickyTop, setPillStickyTop] = useState(128);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('[data-testid="insights-tab-bar"]');
    if (!bar) return;
    const update = () => setPillStickyTop(64 + bar.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(bar);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Source pills — sticky below the main insights tab bar. */}
      <div
        className="sticky z-30 -mx-1 bg-background/90 px-1 py-2 backdrop-blur-md"
        style={{ top: pillStickyTop }}
        data-testid="rankings-source-pills"
      >
        <ScrollMaskedChipRow>
          {PILL_SOURCES.map((pill) => (
            <span
              key={pill.id}
              ref={filters.source === pill.id ? activePillRef : undefined}
              className="inline-flex shrink-0"
            >
              <InsightsPill
                active={filters.source === pill.id}
                title={pill.hint}
                onClick={() => setSource(pill.id)}
              >
                {pill.label}
              </InsightsPill>
            </span>
          ))}
        </ScrollMaskedChipRow>
      </div>

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

      {data && (
        <Card className={insightsTabShadcnCardClass("rankings", "overflow-hidden")}>
          <div className="relative isolate overflow-hidden rounded-t-xl">
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
                    {activePill
                      ? ` ${
                          filters.source === "news_momentum" || filters.source === "wiki_momentum"
                            ? "="
                            : "—"
                        } ${activePill.hint}`
                      : ""}
                  </p>
                  <div
                    className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/60"
                    data-testid="rankings-freshness"
                  >
                    <RefreshCw className="h-3 w-3 shrink-0" aria-hidden />
                    <span>Updated: {freshnessLabel}</span>
                  </div>
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

          {/* Mobile toolbar — filters + primary column header */}
          <div className="border-b border-border/60 bg-muted/30 px-3 py-3 md:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">{filterToolbar}</div>
              <span className="shrink-0 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {primaryColLabel}
              </span>
            </div>
          </div>

          <CardContent className="p-0">
            {allRows.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                No results for these filters.
              </p>
            ) : (
            <>
            {/* DESKTOP — single table so filter/header cells share column widths with data */}
            <div className="hidden md:block">
              <table className="w-full table-fixed text-sm">
                {rankingsMetricColgroup}
                <thead className="bg-muted/30">
                  <tr className="border-b border-border/60">
                    <th className="pl-4 pr-2 py-3 text-left align-middle font-normal">
                      {filterToolbar}
                    </th>
                    <th className={metricHeaderClass}>{primaryColLabel}</th>
                    {hasSecondaryCol && (
                      <th className={secondaryHeaderClass}>{secondaryColLabel}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/30 hover:bg-muted/30 transition-colors"
                    >
                      <td className="pl-4 px-2 py-3">
                        <Link
                          href={`/person/${row.id}`}
                          onClick={() => logInsightsEvent("rankings", "row_click", { personId: row.id })}
                          className="flex items-center gap-3 group"
                        >
                          <RankAvatarUnit rank={idx + 1} name={row.name} avatar={row.avatar} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold group-hover:text-blue-600 dark:group-hover:text-blue-400">
                              {row.name}
                            </p>
                            <RankingsPersonMeta
                              category={row.category}
                              rank={row.rank}
                            />
                          </div>
                        </Link>
                      </td>
                      <td className="w-36 px-4 py-3 text-right font-semibold tabular-nums">
                        {renderPrimary(row)}
                      </td>
                      {hasSecondaryCol && (
                        <td className="w-24 px-4 py-3 text-right text-xs tabular-nums">
                          {renderSecondary(row)}
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
                  className="flex items-center gap-3 pl-2 pr-2 py-3.5 hover:bg-muted/30 transition-colors"
                >
                  <RankAvatarUnit rank={idx + 1} name={row.name} avatar={row.avatar} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{row.name}</p>
                    <RankingsPersonMeta category={row.category} rank={row.rank} />
                  </div>
                  <RankingsMobileMetricColumn
                    row={row}
                    hasSecondaryCol={hasSecondaryCol}
                    isMovers={isMovers}
                    isSearch={isSearch}
                    renderPrimary={renderPrimary}
                  />
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
            </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
