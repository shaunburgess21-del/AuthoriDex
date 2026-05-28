import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Drawer } from "vaul";
import { ChevronLeft, ChevronRight, Filter, Share2 } from "lucide-react";
import { toast } from "sonner";
import { shareInsightsView } from "@/lib/insights-share";
import {
  type InsightsFilters,
  type InsightsSource,
  writeInsightsQuery,
  parseFilters,
} from "@shared/insights/filters";
import { useInsightsRankings } from "@/lib/insights-hooks";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { InsightsPill, SOURCE_DISPLAY, DRIVER_DISPLAY } from "./insights-ui";
import { CategoryPill } from "@/components/CategoryPill";
import { cn } from "@/lib/utils";
import type { InsightsPrimaryDriver } from "@shared/insights/types";

const PILL_SOURCES: Array<{ id: InsightsSource; label: string; hint: string }> = [
  { id: "news_momentum", label: "News Momentum", hint: "Biggest press surge" },
  { id: "wiki_momentum", label: "Wiki Momentum", hint: "Biggest curiosity spike" },
  { id: "velocity", label: "Velocity", hint: "Fastest risers" },
  { id: "mass", label: "Mass", hint: "Established attention" },
  { id: "fame", label: "Fame Index", hint: "Composite rank score" },
  { id: "news", label: "News", hint: "Most press attention" },
  { id: "wiki", label: "Wiki", hint: "Most Wikipedia attention" },
  { id: "search_volume", label: "Search Interest", hint: "Most-searched on Google" },
];

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function formatSortValue(
  source: InsightsSource,
  row: {
    sortValue: number;
    newsMomentum: { ratio: number | null };
    wikiMomentum: { ratio: number | null };
    fameIndex: number;
    velocityScore: number;
    massScore: number;
  },
): string {
  if (source === "news_momentum" || source === "wiki_momentum") {
    const ratio =
      source === "wiki_momentum" ? row.wikiMomentum.ratio : row.newsMomentum.ratio;
    return ratio != null ? `${ratio.toFixed(2)}×` : "—";
  }
  if (source === "fame") return String(row.fameIndex);
  if (source === "velocity") return row.velocityScore.toFixed(1);
  if (source === "mass") return row.massScore.toFixed(1);
  if (source === "search_volume") {
    return row.sortValue > 0 ? `${formatCompact(row.sortValue)}/mo` : "—";
  }
  return row.sortValue.toFixed(1);
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
  const { data, isLoading, isError } = useInsightsRankings(filters);
  const activePill = PILL_SOURCES.find((p) => p.id === filters.source);

  const setSource = (source: InsightsSource) => {
    logInsightsEvent("rankings", "pill_change", { source });
    writeInsightsQuery({ tab: "rankings", filters: { ...filters, source, page: 1 } });
  };

  const patchFilters = (patch: Partial<InsightsFilters>) => {
    logInsightsEvent("rankings", "filter_change", patch as Record<string, unknown>);
    writeInsightsQuery({ tab: "rankings", filters: { ...filters, ...patch, page: 1 } });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / filters.limit)) : 1;

  const filterControls = (
    <div className="flex flex-wrap gap-3 items-center text-sm">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Window
        <select
          className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs"
          value={filters.window}
          onChange={(e) => patchFilters({ window: e.target.value as InsightsFilters["window"] })}
        >
          <option value="24h">24h change</option>
          <option value="7d">7d change</option>
        </select>
      </label>
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
              {c}
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

  return (
    <div className="space-y-4 md:space-y-5">
      <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 md:px-4">
        <p className="text-xs text-muted-foreground">
          Sorted by{" "}
          <span className="font-medium text-foreground">{SOURCE_DISPLAY[filters.source]}</span>
          {activePill ? ` — ${activePill.hint}` : ""}
          {data?.asOf && (
            <span className="hidden sm:inline">
              {" "}
              · as of {new Date(data.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </p>
      </div>

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

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <Button variant="outline" size="sm" className="md:hidden" onClick={() => setFilterOpen(true)}>
          <Filter className="h-4 w-4 mr-1.5" />
          Filters
        </Button>
        <div className="hidden md:block flex-1">{filterControls}</div>
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

      {data && data.rows.length > 0 && (
        <>
          <div className="hidden md:block overflow-hidden rounded-xl border border-border/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium w-14">Rank</th>
                  <th className="px-4 py-3 font-medium">Person</th>
                  <th className="px-4 py-3 font-medium w-28">Driver</th>
                  <th className="px-4 py-3 font-medium text-right w-24">
                    {SOURCE_DISPLAY[filters.source]}
                  </th>
                  <th className="px-4 py-3 font-medium text-right w-20">Fame</th>
                  <th className="px-4 py-3 font-medium text-right w-20">Δ</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/30 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-muted-foreground tabular-nums">
                      #{row.rank}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/person/${row.id}`}
                        onClick={() => logInsightsEvent("rankings", "row_click", { personId: row.id })}
                        className="flex items-center gap-3 group"
                      >
                        <PersonAvatar name={row.name} avatar={row.avatar} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                            {row.name}
                          </p>
                          {row.category && (
                            <CategoryPill category={row.category} size="sm" className="mt-0.5" />
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {DRIVER_DISPLAY[row.primaryDriver as InsightsPrimaryDriver] ?? row.primaryDriver}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formatSortValue(filters.source, row)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {row.fameIndex}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs">
                      {row.change24h != null ? (
                        <span
                          className={cn(
                            row.change24h > 0 && "text-green-600 dark:text-green-400",
                            row.change24h < 0 && "text-red-500",
                          )}
                        >
                          {row.change24h > 0 ? "+" : ""}
                          {row.change24h.toFixed(1)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2">
            {data.rows.map((row) => (
              <Link
                key={row.id}
                href={`/person/${row.id}`}
                onClick={() => logInsightsEvent("rankings", "row_click", { personId: row.id })}
                className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-card/50 hover:bg-muted/30 transition-colors"
              >
                <span className="text-sm font-mono text-muted-foreground w-8 shrink-0">#{row.rank}</span>
                <PersonAvatar name={row.name} avatar={row.avatar} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{row.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {DRIVER_DISPLAY[row.primaryDriver as InsightsPrimaryDriver] ?? row.primaryDriver}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">
                    {formatSortValue(filters.source, row)}
                  </p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    FI {row.fameIndex}
                    {row.change24h != null
                      ? ` · ${row.change24h > 0 ? "+" : ""}${row.change24h.toFixed(1)}%`
                      : ""}
                  </p>
                </div>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Page {filters.page} of {totalPages} · {data.total} people
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page <= 1}
                  onClick={() => patchFilters({ page: filters.page - 1 })}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.page >= totalPages}
                  onClick={() => patchFilters({ page: filters.page + 1 })}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {data && data.rows.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12 rounded-xl border border-dashed border-border/50">
          No results for these filters.
        </p>
      )}
    </div>
  );
}
