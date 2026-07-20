import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { Globe, Loader2, X } from "lucide-react";
import {
  SentimentColumnHeaderButton,
  SentimentInfoBody,
  SentimentInfoDialog,
  SentimentInfoDrawer,
} from "@/components/WebSentimentLeaderboardInfo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/SearchBar";
import { FilterDropdown } from "@/components/FilterDropdown";
import { WebSentimentLeaderboardRow } from "./WebSentimentLeaderboardRow";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatRelativeTime } from "@/lib/formatDate";
import { insightsCrowdBoardCardClass, InsightsCrowdTopAccentBar } from "./insights-ui";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
import { normalizeMarketCategory } from "@shared/constants";
import type { WebSentimentSortDir } from "@shared/insights/web-sentiment-filters";

const PAGE_SIZE = 20;

interface WebSentimentRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  positivePct: number;
  positive: number;
  negative: number;
  total: number;
  carriedForward: boolean;
  leaderboardRank: number;
}

interface WebSentimentPagePayload {
  rows: WebSentimentRow[];
  total: number;
  hasMore: boolean;
  asOf: string | null;
  minOpinionated: number;
}

export function WebSentimentTab() {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { isLoggedIn } = useAuth();
  const leaderboardCategories = useLeaderboardCategories();
  const categoryRegistry = useCategoryRegistry();

  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState(() => {
    if (typeof window === "undefined") return "all";
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("category");
    if (!raw) return "all";
    const lowered = raw.toLowerCase();
    if (lowered === "trending") return "all";
    if (lowered === "all" || lowered === "favorites") return lowered;
    return normalizeMarketCategory(raw);
  });
  const [sortDirection, setSortDirection] = useState<WebSentimentSortDir>("desc");
  const [sentimentInfoOpen, setSentimentInfoOpen] = useState(false);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery<WebSentimentPagePayload>({
    queryKey: ["/api/insights/crowd/web-sentiment", searchQuery, category, sortDirection],
    queryFn: async ({ pageParam = 0 }) => {
      const queryParams = new URLSearchParams();
      if (searchQuery) queryParams.set("search", searchQuery);
      if (category !== "all") queryParams.set("category", category);
      queryParams.set("sortDir", sortDirection);
      queryParams.set("limit", String(PAGE_SIZE));
      queryParams.set("offset", String(pageParam));

      const response = await fetch(`/api/insights/crowd/web-sentiment?${queryParams}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch");
      const json = await response.json();
      return json.data as WebSentimentPagePayload;
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.rows.length, 0);
      return loadedCount < lastPage.total ? loadedCount : undefined;
    },
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const allRows = useMemo(() => data?.pages.flatMap((page) => page.rows) ?? [], [data]);
  const totalCount = data?.pages[0]?.total ?? 0;
  const asOf = data?.pages[0]?.asOf ?? null;
  const hasCarriedForward = allRows.some((r) => r.carriedForward);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const sentinel = document.getElementById("web-sentiment-infinite-sentinel");
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        fetchNextPage();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, allRows.length]);

  const resolveCategoryLabel = useCallback(
    (id: string): string => {
      const registryHit = categoryRegistry.byId.get(id);
      if (registryHit?.label) return registryHit.label;
      return categoryRegistry.getDisplayLabel(id);
    },
    [categoryRegistry],
  );

  const leaderboardFilterCategories = useMemo(() => {
    const pinned = [
      { value: "all", label: "All Categories" },
      { value: "favorites", label: "Favorites" },
    ];
    const dynamic = Array.from(leaderboardCategories ?? [])
      .filter((id) => id && id !== "all" && id !== "favorites" && id !== "trending")
      .sort((a, b) => resolveCategoryLabel(a).localeCompare(resolveCategoryLabel(b)))
      .map((id) => ({ value: id, label: resolveCategoryLabel(id) }));
    if (
      category !== "all" &&
      category !== "favorites" &&
      category !== "trending" &&
      !dynamic.some((c) => c.value === category)
    ) {
      dynamic.unshift({ value: category, label: resolveCategoryLabel(category) });
    }
    return [...pinned, ...dynamic];
  }, [leaderboardCategories, category, resolveCategoryLabel]);

  const activeCategoryLabel = useMemo(() => {
    if (category === "all") return "All Categories";
    if (category === "favorites") return "Favorites";
    return resolveCategoryLabel(category);
  }, [category, resolveCategoryLabel]);

  const handleCategoryChange = (value: string) => {
    if (value === "favorites" && !isLoggedIn) {
      navigateToLogin(setLocation);
      return;
    }
    setCategory(value);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setCategory("all");
  };

  const hasActiveFilters = !!searchQuery || category !== "all";
  const hasAnyRows = totalCount > 0;

  if (isError) {
    return (
      <Card className={insightsCrowdBoardCardClass()}>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Failed to load the web sentiment leaderboard.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Single wrapper so CrowdTab's space-y-4 doesn't add a gap between the
          header/toolbar card and the row list. */}
      <div>
      <Card className={insightsCrowdBoardCardClass()}>
        <div className="relative isolate overflow-hidden rounded-t-xl">
          <InsightsCrowdTopAccentBar />
          <CardHeader className="relative z-[2] flex flex-col gap-4 space-y-0 bg-card/95 pb-4 pt-5">
            <div className="flex-1">
              <CardTitle className="text-2xl font-serif flex items-center gap-2">
                <Globe className="h-5 w-5 text-[#22D3EE]" aria-hidden />
                Web Sentiment
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground/70 max-w-xl">
                The balance of positive vs negative mentions across news sites, blogs, and forums.
              </p>
            </div>
          </CardHeader>
        </div>

        <div
          className="rounded-b-xl bg-card/95"
          data-testid="web-sentiment-toolbar"
        >
          {/* Padding mirrors the row padding (pl-2/pr-2, sm:pl-3/pr-6) so column headers align with row columns */}
          <div className="rounded-b-xl pl-2 pr-2 sm:pl-3 sm:pr-6 py-4 bg-muted/30">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FilterDropdown
                  value={category}
                  onChange={handleCategoryChange}
                  categories={leaderboardFilterCategories}
                  sortDirection={sortDirection}
                  onSortDirectionChange={setSortDirection}
                  isActive={category !== "all" || sortDirection !== "desc"}
                  testId="web-sentiment-filter"
                />
                <div className="flex-1 min-w-0 lg:max-w-[400px]">
                  <SearchBar onSearch={setSearchQuery} placeholder="Search..." />
                </div>
                {allRows.length > 0 && (
                  <div
                    className="hidden lg:flex items-center gap-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground ml-auto shrink-0"
                    data-testid="web-sentiment-column-header"
                  >
                    <div className="w-[96px] text-right">Breakdown</div>
                    <div className="flex justify-end w-[120px]">
                      <SentimentColumnHeaderButton onClick={() => setSentimentInfoOpen(true)} />
                    </div>
                    <div className="text-right w-[100px]">Mentions</div>
                  </div>
                )}
                <SentimentColumnHeaderButton
                  className="lg:hidden"
                  testId="label-mobile-web-sentiment"
                  onClick={() => setSentimentInfoOpen(true)}
                />
              </div>
              {hasActiveFilters && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">Active filters:</span>
                  {searchQuery && (
                    <Badge variant="secondary" className="gap-1">
                      Search: {searchQuery}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setSearchQuery("")} />
                    </Badge>
                  )}
                  {category !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      Category: {activeCategoryLabel}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setCategory("all")} />
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleClearFilters} className="h-6 text-xs">
                    Clear all
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

      </Card>

      {/* Row list floats on the page background — border stops at the toolbar above. */}
      <div>
          {isLoading && allRows.length === 0 ? (
            <div className="p-12 text-center">
              <Loader2 className="h-6 w-6 text-muted-foreground/50 mx-auto animate-spin" />
              <p className="mt-3 text-sm text-muted-foreground">Loading web sentiment…</p>
            </div>
          ) : !hasAnyRows && !isLoading ? (
            <div className="p-12 text-center">
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "No results found"
                  : "No profiles have enough opinionated web citations yet."}
              </p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" className="mt-3" onClick={handleClearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="lb-row-list pt-2 sm:pt-3 space-y-1.5">
                {allRows.map((row) => (
                  <WebSentimentLeaderboardRow
                    key={row.id}
                    row={row}
                    displayRank={row.leaderboardRank}
                  />
                ))}
              </div>

              {hasNextPage && (
                <div
                  id="web-sentiment-infinite-sentinel"
                  className="p-6 text-center"
                  data-testid="web-sentiment-infinite-scroll-trigger"
                >
                  {isFetchingNextPage ? (
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading more...</span>
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-sm">
                      Showing {allRows.length} of {totalCount}
                    </div>
                  )}
                </div>
              )}

              {!hasNextPage && allRows.length > 0 && (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  Showing all {allRows.length} results
                </div>
              )}
            </>
          )}

          {asOf && (
            <div className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Updated {formatRelativeTime(asOf)}
                {hasCarriedForward
                  ? " · some rows carry forward the last available web reading"
                  : ""}
                {" · "}
                DataForSEO ingest runs weekly
              </p>
            </div>
          )}
      </div>
      </div>

      {isMobile ? (
        <SentimentInfoDrawer open={sentimentInfoOpen} onOpenChange={setSentimentInfoOpen}>
          <SentimentInfoBody />
        </SentimentInfoDrawer>
      ) : (
        <SentimentInfoDialog open={sentimentInfoOpen} onOpenChange={setSentimentInfoOpen}>
          <SentimentInfoBody />
        </SentimentInfoDialog>
      )}
    </>
  );
}
