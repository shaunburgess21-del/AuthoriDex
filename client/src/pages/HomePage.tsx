import { WelcomeModal } from "@/components/WelcomeModal";
import { QuickVoteHost } from "@/components/quick-vote/QuickVoteHost";
import type { OnboardingDrawerHandle } from "@/components/OnboardingDrawer";
import { SearchBar } from "@/components/SearchBar";
import { LeaderboardRow } from "@/components/LeaderboardRow";
import { PersonInsightModal, type InsightPerson } from "@/components/PersonInsightModal";
import { VotingModal } from "@/components/VotingModal";
import {
  HomeApprovalInfoBody,
  YourVoteColumnHeaderButton,
  YourVoteInfoDialog,
  YourVoteInfoDrawer,
} from "@/components/ApprovalLeaderboardInfo";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { FilterDropdown } from "@/components/FilterDropdown";
import { PersonAvatar } from "@/components/PersonAvatar";
import { MoverRowSubtext } from "@/components/MoverRowSubtext";
import { TrendScoreLaunchpad } from "@/components/TrendScoreActionDrawer";
import { LeaderboardIntroInfoIcon } from "@/components/LeaderboardIntroInfo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useHotMoverIds } from "@/hooks/useHotMoverIds";
import { useDeferredReady } from "@/hooks/useDeferredReady";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { RANKINGS_DESCRIPTION, RANKINGS_TITLE } from "@/lib/primaryNav";
import { shareHomeLeaderboardView } from "@/lib/home-leaderboard-share";
import {
  X,
  RefreshCw,
  Share2,
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronRight,
  ChevronDown,
  LineChart,
  Users,
  Sparkles,
  Target,
  Check,
  ThumbsDown,
  Minus,
  HelpCircle,
  Loader2,
} from "lucide-react";
import { Suspense, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { OfflineUnavailable } from "@/components/OfflineUnavailable";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { isTransportFailure, shouldReplaceEmptyWithOffline } from "@/lib/networkStatus";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { TrendingPerson } from "@shared/schema";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation, useSearch, Link } from "wouter";
import { getCategoryBucketId } from "@shared/constants";
import { buildLeaderboardCategoryFilters } from "@shared/leaderboard-category-filters";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { HomeIntro } from "@/components/HomeIntro";
import { LeaderboardRowSkeleton } from "@/components/ui/card-skeletons";

const TrendGraphOverlay = lazyWithRetry(() =>
  import("@/components/home/TrendGraphOverlay").then((m) => ({
    default: m.TrendGraphOverlay,
  })),
);

type HomeView = "leaderboard" | "predict" | "vote";

// Clickable "Trend Score" column header. Doubles as the column header on every
// breakpoint and, when tapped, opens the Trend Score launchpad — a menu of
// onward actions plus an opt-in explainer (see TrendScoreLaunchpad). It sits in
// prime thumb real estate, so it answers "now what?" rather than dead-ending in
// an info panel.
function TrendScoreHeaderLabel({
  className,
  onOpen,
}: {
  className?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "inline-flex h-9 items-center rounded-md border border-border px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground/80 cursor-pointer",
        className,
      )}
      aria-label="Trend Score: actions and how it works"
      data-testid="header-trend-score-info"
    >
      Trend Score
    </button>
  );
}

/** Matches server DAILY_MOVERS_MAX / MOVERS_PULSE_TOP_N for pulse card rows. */
const PULSE_CARD_ROW_CAP = 6;

function pulseRowChangeValue(
  person: TrendingPerson,
  type: "daily" | "gainer" | "dropper",
): number | null {
  const v = type === "daily" ? person.change24h : person.change7d;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (type === "daily" && v === 0) return null;
  return v;
}

function MarketPulseCard({ 
  title, 
  icon: Icon, 
  people, 
  type,
  onOpenInsight,
  collapsed,
  onToggle
}: { 
  title: string; 
  icon: typeof TrendingUp; 
  people: TrendingPerson[]; 
  type: "daily" | "gainer" | "dropper";
  onOpenInsight: (person: TrendingPerson) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const colorConfig = {
    daily: {
      iconColor: "text-slate-300",
      cardClass: "pulse-card-blue",
      iconBgClass: "pulse-icon-blue",
      subtitle: "Risers & fallers \u00B7 24h",
    },
    gainer: {
      iconColor: "text-green-600 dark:text-green-400",
      cardClass: "pulse-card-green",
      iconBgClass: "pulse-icon-green",
      subtitle: "Momentum \u00B7 7d",
    },
    dropper: {
      iconColor: "text-red-600 dark:text-red-400",
      cardClass: "pulse-card-red",
      iconBgClass: "pulse-icon-red",
      subtitle: "Dropping \u00B7 7d",
    },
  };
  
  const { iconColor, cardClass, iconBgClass, subtitle } = colorConfig[type];
  
  return (
    <div 
      className={`w-[min(100%,20rem)] max-w-full min-w-0 shrink-0 md:w-auto md:max-w-none md:min-w-0 md:shrink h-full rounded-xl ${cardClass} transition-all duration-200`}
      data-testid={`pulse-card-${type}`}
    >
      <div className={`px-3 sm:px-4 ${collapsed ? 'py-4' : 'pt-5 pb-4'}`}>
        <div 
          className="flex items-center gap-3 cursor-pointer select-none group"
          onClick={onToggle}
          data-testid={`pulse-header-${type}`}
        >
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${iconBgClass}`}>
            <Icon className={`h-4 w-4 ${iconColor}`} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground dark:text-slate-100">{title}</h3>
            <p className="text-[10px] text-muted-foreground dark:text-slate-500 uppercase tracking-wider">{subtitle}</p>
          </div>
          <div className={`h-6 w-6 rounded-md flex items-center justify-center bg-muted/50 dark:bg-slate-700/30 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
            <ChevronDown className="h-4 w-4 text-muted-foreground dark:text-slate-400 group-hover:text-foreground dark:group-hover:text-slate-200 transition-colors" />
          </div>
        </div>
        
        {!collapsed && (() => {
          const rows = people
            .map((person) => ({
              person,
              changeValue: pulseRowChangeValue(person, type),
            }))
            .filter((row): row is { person: TrendingPerson; changeValue: number } =>
              row.changeValue !== null,
            )
            .slice(0, PULSE_CARD_ROW_CAP);

          if (rows.length === 0) {
            return (
              <p className="text-center text-xs text-muted-foreground py-4 mt-4" data-testid={`pulse-empty-${type}`}>
                No movement data right now
              </p>
            );
          }

          // Daily Movers is two separate ranked lists (risers, fallers), so the
          // number restarts at 1 for the first faller instead of running 1-6.
          // A faint per-half tint (same green/red family as the % chips) makes
          // the two "#1" rows read as deliberate rather than a numbering bug.
          const riserCount = rows.filter((r) => r.changeValue > 0).length;

          return (
          <div className="space-y-1.5 mt-4">
            {rows.map(({ person, changeValue }, idx) => {
                const isPositive = changeValue > 0;
                const displayNum =
                  type === "daily" && !isPositive ? idx - riserCount + 1 : idx + 1;
                const rowToneClass =
                  type !== "daily"
                    ? "bg-muted/40 dark:bg-slate-800/30"
                    : isPositive
                      ? "bg-green-500/[0.05] dark:bg-green-500/[0.05]"
                      : "bg-red-500/[0.05] dark:bg-red-500/[0.05]";
                return (
                  <div
                    key={person.id}
                    className={`flex items-center gap-2.5 p-2 rounded-lg hover-elevate cursor-pointer border border-border/50 dark:border-slate-700/30 transition-colors hover:border-foreground/20 dark:hover:border-slate-600/50 ${rowToneClass}`}
                    onClick={() => onOpenInsight(person)}
                    data-testid={`pulse-item-${person.id}`}
                  >
                    <div className="relative flex items-center rounded-md overflow-hidden shrink-0">
                      <div className="flex items-center justify-center min-w-[24px] self-stretch rounded-l-md bg-muted dark:bg-[#101318] border-r border-border dark:border-transparent">
                        <span className="font-mono font-semibold text-muted-foreground dark:text-slate-400 text-[12px] tabular-nums">{displayNum}</span>
                      </div>
                      <PersonAvatar
                        name={person.name}
                        avatar={person.avatar}
                        imageSlug={(person as any).imageSlug}
                        size="sm"
                        className="h-10 w-10 shrink-0 rounded-none rounded-r-md"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs truncate text-foreground dark:text-slate-200">{person.name}</p>
                      <MoverRowSubtext
                        rank={person.rank}
                        fameIndex={person.fameIndex}
                        trendScore={person.trendScore}
                      />
                    </div>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded text-xs font-mono font-medium tabular-nums ${
                        isPositive
                          ? "bg-green-500/20 dark:bg-green-500/15 text-green-600 dark:text-green-400"
                          : "bg-red-500/20 dark:bg-red-500/15 text-red-600 dark:text-red-400"
                      }`}
                    >
                      {isPositive ? "+" : ""}{changeValue.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
          </div>
          );
        })()}
      </div>
    </div>
  );
}


const PAGE_SIZE = 20;

interface TrendingResponse {
  data: TrendingPerson[];
  totalCount: number;
  hasMore: boolean;
  thresholds?: {
    rankChangeP90: number;
    deltaP90: number;
    negRankChangeP10: number;
    negDeltaP10: number;
  };
}

// InsightPerson, the momentum/why-trending UI, and the snapshot modal shell
// now live in @/components/PersonInsightModal (shared with the Insights
// "Movers" card). HomePage just builds an InsightPerson and renders the modal.

type SortDirection = "desc" | "asc";

/** Rankings share URLs (`/rankings?category=&search=&sortDir=#leaderboard`). */
function readHomeLeaderboardShareState(search: string): {
  searchQuery: string;
  category: string;
  sortDirection: SortDirection;
} {
  const params = new URLSearchParams(search);
  const rawCategory = params.get("category");
  let category = "all";
  if (rawCategory) {
    const lowered = rawCategory.toLowerCase();
    if (lowered === "trending") category = "all";
    else if (lowered === "all" || lowered === "favorites") category = lowered;
    else category = getCategoryBucketId(rawCategory);
  }
  return {
    searchQuery: params.get("search") ?? "",
    category,
    sortDirection: params.get("sortDir") === "asc" ? "asc" : "desc",
  };
}

export default function HomePage() {
  useDocumentMeta({
    title: RANKINGS_TITLE,
    description: RANKINGS_DESCRIPTION,
  });

  const urlSearch = useSearch();
  const [searchQuery, setSearchQuery] = useState(
    () => readHomeLeaderboardShareState(window.location.search).searchQuery,
  );
  const [category, setCategory] = useState(
    () => readHomeLeaderboardShareState(window.location.search).category,
  );
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { user, loading: authLoading } = useAuth();
  const categoryRegistry = useCategoryRegistry();

  const [activeView, setActiveView] = useState<HomeView>("leaderboard");
  const [trendOverlayOpen, setTrendOverlayOpen] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    () => readHomeLeaderboardShareState(window.location.search).sortDirection,
  );

  // Share links land as client navigations in the native shell. Re-read the
  // query when it changes so a warm open of `/rankings?category=&search=#leaderboard`
  // updates a Rankings page that is already mounted.
  useEffect(() => {
    const next = readHomeLeaderboardShareState(urlSearch);
    setSearchQuery(next.searchQuery);
    setCategory(next.category);
    setSortDirection(next.sortDirection);
  }, [urlSearch]);

  useEffect(() => {
    const scrollToLeaderboard = () => {
      if (window.location.hash !== "#leaderboard") return;
      requestAnimationFrame(() => {
        document.getElementById("leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    scrollToLeaderboard();
    window.addEventListener("hashchange", scrollToLeaderboard);
    return () => window.removeEventListener("hashchange", scrollToLeaderboard);
  }, []);
  const [votingModalOpen, setVotingModalOpen] = useState(false);
  const [votingPersonId, setVotingPersonId] = useState<string | null>(null);
  const [voteLeaderboardInfoOpen, setVoteLeaderboardInfoOpen] = useState(false);
  const [trendScoreLaunchpadOpen, setTrendScoreLaunchpadOpen] = useState(false);
  const [moversCollapsed, setMoversCollapsed] = useState(true);
  const welcomeOnboardingRef = useRef<OnboardingDrawerHandle>(null);
  const [selectedInsightPerson, setSelectedInsightPerson] = useState<InsightPerson | null>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    status,
    fetchStatus,
    refetch,
  } = useInfiniteQuery<TrendingResponse>({
    queryKey: ['/api/leaderboard', searchQuery, category, 'fame', sortDirection],
    queryFn: async ({ pageParam = 0 }) => {
      const queryParams = new URLSearchParams();
      if (searchQuery) queryParams.set('search', searchQuery);
      if (category !== 'all') queryParams.set('category', category);
      queryParams.set('limit', String(PAGE_SIZE));
      queryParams.set('offset', String(pageParam));
      queryParams.set('tab', 'fame');
      queryParams.set('sortDir', sortDirection);

      // Fame rows are the same for every viewer. Only Favorites needs the
      // session, so the default board does not wait on /api/config/supabase.
      const authHeaders = category === "favorites" ? await getAuthHeaders() : {};
      const response = await fetch(`/api/leaderboard?${queryParams}`, {
        credentials: "include",
        headers: authHeaders,
      });
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.data.length, 0);
      return loadedCount < lastPage.totalCount ? loadedCount : undefined;
    },
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const allPeople = useMemo(() => {
    return data?.pages.flatMap(page => page.data) ?? [];
  }, [data]);

  const totalCount = data?.pages[0]?.totalCount ?? 0;

  const { ref: loadMoreRef, isIntersecting } = useIntersectionObserver<HTMLDivElement>({
    enabled: hasNextPage && !isFetchingNextPage,
  });

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Track if this is the first render (skip scroll on initial load)
  const isFirstRender = useRef(true);
  const previousView = useRef<HomeView>(activeView);

  // Scroll to section top when toggle changes
  useEffect(() => {
    // Skip on initial render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Only scroll if the view actually changed
    if (previousView.current !== activeView) {
      previousView.current = activeView;
      
      // Get the content container and scroll to its top, accounting for sticky elements
      const contentContainer = document.querySelector('[data-content-section]');
      const toggleBar = document.querySelector('[data-toggle-bar]');
      
      if (contentContainer && toggleBar) {
        // Get the absolute position of the content container in the document
        const contentRect = contentContainer.getBoundingClientRect();
        const contentTop = window.scrollY + contentRect.top;
        
        // The sticky header is h-16 (64px) and toggle bar height
        const toggleBarRect = toggleBar.getBoundingClientRect();
        const stickyOffset = 64 + toggleBarRect.height; // header + toggle bar
        
        // Scroll so content appears right below the sticky elements
        window.scrollTo({
          top: contentTop - stickyOffset,
          behavior: 'smooth'
        });
      }
    }
  }, [activeView]);

  // Defer secondary (below-the-fold "Pulse"/freshness) queries until the
  // browser is idle so the primary leaderboard fetch + first paint aren't
  // competing with a burst of parallel requests on slow connections.
  const deferredReady = useDeferredReady();

  const { data: topGainers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/gainers'],
    enabled: deferredReady,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: topDroppers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/droppers'],
    enabled: deferredReady,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: dailyMovers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/daily'],
    enabled: deferredReady,
    refetchInterval: 5 * 60 * 1000,
  });

  const hotMoverIds = useHotMoverIds();

  // For display, just use allPeople from the API
  const displayPeople = useMemo(() => {
    return allPeople;
  }, [allPeople]);

  const { data: systemFreshness } = useQuery<{
    lastScoredAt: string;
    lastScoredAtFormatted: string;
    liveUpdatedAt: string | null;
    liveUpdatedAtFormatted: string | null;
    fullRefreshAt: string | null;
    fullRefreshAtFormatted: string | null;
  }>({
    queryKey: ['/api/system/freshness'],
    enabled: deferredReady,
    refetchInterval: 90 * 1000,
  });

  const handleVisitProfile = (personId: string) => {
    setLocation(`/person/${personId}`);
  };

  const openInsightFromTrendingPerson = (person: TrendingPerson) => {
    setSelectedInsightPerson({
      id: person.id,
      name: person.name,
      avatar: person.avatar ?? null,
      category: person.category ?? null,
      rank: (person.rank ?? null) as number | null,
      change24h: person.change24h ?? null,
      rankChange: ((person as any).rankChange ?? null) as number | null,
      hotMover: hotMoverIds.has(person.id),
    });
  };

  const handleCloseInsightPanel = () => {
    setSelectedInsightPerson(null);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setCategory("all");
  };

  const handlePullRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['/api/leaderboard'] });
    await queryClient.invalidateQueries({ queryKey: ['/api/trending/movers'] });
    await queryClient.invalidateQueries({ queryKey: ['/api/system/freshness'] });
  }, []);

  const { containerRef: pullRefreshRef, pullDistance, isRefreshing: isPullRefreshing } = usePullToRefresh({
    onRefresh: handlePullRefresh,
  });

  const hasLeaderboardData = (data?.pages?.length ?? 0) > 0;
  const network = useNetworkStatus();
  const offlineKind = shouldReplaceEmptyWithOffline({
    status,
    fetchStatus,
    transportError: isTransportFailure(error),
    offline: network.reachability === "offline",
  });
  const showLeaderboardInitialLoader = isLoading && !hasLeaderboardData;

  const hasActiveFilters = searchQuery || category !== "all";
  const resolveCategoryLabel = useCallback(
    (id: string): string => {
      const registryHit = categoryRegistry.byId.get(id);
      if (registryHit?.label) return registryHit.label;
      return categoryRegistry.getDisplayLabel(id);
    },
    [categoryRegistry],
  );
  const leaderboardFilterCategories = useMemo(
    () =>
      buildLeaderboardCategoryFilters(
        categoryRegistry.isReady ? categoryRegistry.categories : null,
        category,
      ),
    [categoryRegistry.isReady, categoryRegistry.categories, category],
  );

  const activeCategoryLabel = useMemo(() => {
    if (category === "all") return "All Categories";
    if (category === "favorites") return "Favorites";
    if (category === "trending") return "Trending";
    return resolveCategoryLabel(category);
  }, [category, resolveCategoryLabel]);

  if (offlineKind && !hasLeaderboardData) {
    return (
      <OfflineUnavailable
        kind={offlineKind}
        onRetry={offlineKind === "unreachable" ? () => { void refetch(); } : undefined}
      />
    );
  }

  const keepStaleLeaderboard =
    hasLeaderboardData && (isTransportFailure(error) || network.reachability === "offline");

  if (error && !keepStaleLeaderboard) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-muted-foreground">Failed to load trending data</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="home-shell min-h-screen pb-20 md:pb-0" ref={pullRefreshRef}>
      {(pullDistance > 0 || isPullRefreshing) && (
        <div
          className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center pointer-events-none transition-opacity"
          style={{ 
            height: `${Math.max(pullDistance, isPullRefreshing ? 48 : 0)}px`,
            opacity: Math.min(pullDistance / 40, 1),
          }}
          data-testid="pull-to-refresh-indicator"
        >
          <div className={`p-2 rounded-full bg-primary/10 backdrop-blur-sm border border-primary/20 ${isPullRefreshing ? '' : ''}`}>
            <RefreshCw className={`h-5 w-5 text-primary ${isPullRefreshing ? 'ptr-spinner' : ''}`} style={{ transform: !isPullRefreshing ? `rotate(${pullDistance * 3}deg)` : undefined }} />
          </div>
        </div>
      )}
      <SiteHeader active="rankings" backButton="none" />
      <WelcomeModal ref={welcomeOnboardingRef} />
      <QuickVoteHost surface="home" />
      {/* PRESERVED: Sticky toggle bar (Leaderboard/Vote/Predict) - commented out for future re-enable
      <div className="sticky top-16 z-40 border-b bg-gradient-to-r from-blue-500/5 via-background/95 to-blue-500/5 backdrop-blur-xl" data-toggle-bar>
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center gap-2 py-3">
            {(["leaderboard", "vote", "predict"] as HomeView[]).map((view) => {
              const icons = { leaderboard: TrendingUp, vote: Vote, predict: LineChart };
              const labels = { leaderboard: "Leaderboard", vote: "Vote", predict: "Predict" };
              const Icon = icons[view];
              return (
                <button
                  key={view}
                  onClick={() => setActiveView(view)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                    activeView === view
                      ? "bg-blue-500/25 dark:bg-blue-500/20 text-blue-500 dark:text-blue-300 border border-blue-500/50 dark:border-blue-400/40 shadow-sm shadow-blue-500/30 dark:shadow-blue-500/20"
                      : "bg-background/50 border border-border/50 text-muted-foreground hover:bg-muted/80 hover:border-blue-400/20"
                  }`}
                  data-testid={`toggle-view-${view}`}
                >
                  <Icon className="h-4 w-4" />
                  {labels[view]}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      */}
      <div className="container mx-auto min-w-0 max-w-7xl px-2 sm:px-4 pt-[18px] pb-8" data-content-section>
                            <HomeIntro />
                            <div className="flex w-full min-w-0 max-w-full gap-4 overflow-x-auto scrollbar-hide pb-6 mb-0 md:grid md:grid-cols-3 md:overflow-visible md:pb-2 md:mb-4" data-testid="market-pulse-row">
                <MarketPulseCard 
                  title="Daily Movers" 
                  icon={Activity} 
                  people={dailyMovers} 
                  type="daily"
                  onOpenInsight={openInsightFromTrendingPerson}
                  collapsed={moversCollapsed}
                  onToggle={() => setMoversCollapsed(!moversCollapsed)}
                />
                <MarketPulseCard 
                  title="Weekly Gainers" 
                  icon={TrendingUp} 
                  people={topGainers} 
                  type="gainer"
                  onOpenInsight={openInsightFromTrendingPerson}
                  collapsed={moversCollapsed}
                  onToggle={() => setMoversCollapsed(!moversCollapsed)}
                />
                <MarketPulseCard 
                  title="Weekly Droppers" 
                  icon={TrendingDown} 
                  people={topDroppers} 
                  type="dropper"
                  onOpenInsight={openInsightFromTrendingPerson}
                  collapsed={moversCollapsed}
                  onToggle={() => setMoversCollapsed(!moversCollapsed)}
                />
              </div>

              <div id="leaderboard" className="scroll-mt-24" />
              {/* Header + toolbar form one bordered rounded box; the row list below
                  is borderless so cards float on the page background. */}
              <div>
                <div className="relative isolate overflow-hidden rounded-t-xl lb-header-band text-card-foreground">
                  {/* Same accent as .pulse-card-voxdex::before: 3px top bar only; overflow clips rounded-corner lip */}
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] bg-[linear-gradient(90deg,transparent_0%,rgb(59,130,246)_50%,transparent_100%)]"
                    aria-hidden
                  />
                  <CardHeader className="relative z-[2] flex flex-col gap-4 space-y-0 pb-4 pt-5">
                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <CardTitle className="text-2xl font-serif">Leaderboard</CardTitle>
                            <LeaderboardIntroInfoIcon
                              hintEligible={!authLoading && !user}
                              testId="icon-leaderboard-intro-info"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 shrink-0 px-2 text-muted-foreground hover:text-foreground"
                            data-testid="button-home-leaderboard-share"
                            onClick={async () => {
                              try {
                                const result = await shareHomeLeaderboardView({
                                  category,
                                  searchQuery,
                                  sortDirection,
                                  categoryLabel:
                                    category !== "all" ? activeCategoryLabel : undefined,
                                });
                                toast(result === "shared" ? "Shared" : "Link copied", {
                                  description:
                                    result === "copied"
                                      ? "Leaderboard link copied to clipboard."
                                      : undefined,
                                });
                              } catch {
                                /* user cancelled */
                              }
                            }}
                          >
                            <Share2 className="h-3.5 w-3.5" />
                            Share
                          </Button>
                        </div>
                        <p
                          className="mt-1 text-sm text-muted-foreground"
                          data-testid="text-leaderboard-subtitle"
                        >
                          {category !== "all" && category !== "favorites" && activeCategoryLabel
                            ? `Live ranking of the most talked-about people in ${activeCategoryLabel}`
                            : "Live ranking of the world's most talked-about people"}
                        </p>
                        <div
                          className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/60 flex-wrap"
                          data-testid="text-leaderboard-freshness"
                        >
                          <span className="inline-flex items-center gap-1">
                            <RefreshCw className="h-3 w-3 shrink-0" aria-hidden />
                            <span>
                              Updated:{" "}
                              {systemFreshness?.fullRefreshAtFormatted ||
                                systemFreshness?.lastScoredAtFormatted ||
                                "recently"}
                            </span>
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                </div>
                <div
                  className="sticky top-16 z-30 rounded-b-xl lb-header-toolbar backdrop-blur-md"
                  data-testid="leaderboard-sticky-toolbar"
                >
                  {/* Padding mirrors the row padding (pl-2/pr-2, sm:pl-3/pr-6) so column headers align with row columns */}
                  <div className="rounded-b-xl pl-2 pr-2 sm:pl-3 sm:pr-6 py-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <FilterDropdown
                          value={category}
                          onChange={setCategory}
                          categories={leaderboardFilterCategories}
                          sortDirection={sortDirection}
                          onSortDirectionChange={setSortDirection}
                        />
                        <div className="flex-1 min-w-0 md:max-w-none lg:max-w-[400px]">
                          <SearchBar 
                            onSearch={setSearchQuery} 
                            placeholder="Search..."
                            initialValue={searchQuery}
                          />
                        </div>
                        {(displayPeople.length > 0 || showLeaderboardInitialLoader) && (
                          <div className="md:hidden shrink-0 min-w-[4.5rem] max-w-[6.5rem] flex justify-end">
                            <TrendScoreHeaderLabel onOpen={() => setTrendScoreLaunchpadOpen(true)} />
                          </div>
                        )}
                        {(displayPeople.length > 0 || showLeaderboardInitialLoader) && (
                          <div
                            className="hidden md:flex items-center gap-4 lg:gap-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground ml-auto shrink-0"
                            data-testid="leaderboard-column-header"
                          >
                            <div className="flex justify-end w-[120px] lg:w-[140px]">
                              <TrendScoreHeaderLabel onOpen={() => setTrendScoreLaunchpadOpen(true)} />
                            </div>
                            <div className="text-right w-[96px]">24h</div>
                            <div className="flex justify-end w-[88px]">
                              <YourVoteColumnHeaderButton
                                testId="button-home-your-vote-info"
                                onClick={() => setVoteLeaderboardInfoOpen(true)}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      {hasActiveFilters && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-muted-foreground">Active filters:</span>
                          {searchQuery && (
                            <Badge variant="secondary" className="gap-1">
                              Search: {searchQuery}
                              <X 
                                className="h-3 w-3 cursor-pointer" 
                                onClick={() => setSearchQuery("")}
                              />
                            </Badge>
                          )}
                          {category !== "all" && (
                            <Badge variant="secondary" className="gap-1">
                              Category: {activeCategoryLabel}
                              <X 
                                className="h-3 w-3 cursor-pointer" 
                                onClick={() => setCategory("all")}
                              />
                            </Badge>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={handleClearFilters}
                            className="h-6 text-xs"
                          >
                            Clear all
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="lb-row-list pt-2 sm:pt-3 space-y-1.5">
                    {showLeaderboardInitialLoader && (
                      <LeaderboardRowSkeleton count={8} />
                    )}
                    {displayPeople.length === 0 && !isLoading && (
                      <div className="p-8 text-center">
                        <p className="text-muted-foreground mb-3">
                          {searchQuery ? "No results found" : "No results found for current filters"}
                        </p>
                        {searchQuery && (
                          <Link href={`/vote/induction?search=${encodeURIComponent(searchQuery.trim())}`}>
                            <Button variant="outline" size="sm" data-testid="button-view-induction-list">
                              <Users className="h-4 w-4 mr-2" />
                              Search Induction Queue
                            </Button>
                          </Link>
                        )}
                      </div>
                    )}
                    {displayPeople.map((person, index) => (
                      <LeaderboardRow
                        key={person.id}
                        person={person}
                        listIndex={index}
                        activeTab="fame"
                        isHotMover={hotMoverIds.has(person.id)}
                        onOpenInsight={() => openInsightFromTrendingPerson(person)}
                        onVoteClick={() => {
                          // Rate always opens the 1–5 dialog. The approval
                          // explainer stays on the column info icon.
                          toast.dismiss();
                          setVotingPersonId(person.id);
                          setVotingModalOpen(true);
                        }}
                      />
                    ))}
                  </div>
                  
                  {/* Infinite scroll trigger element */}
                  {hasNextPage && (
                    <div 
                      ref={loadMoreRef}
                      className="p-6 text-center"
                      data-testid="infinite-scroll-trigger"
                    >
                      {isFetchingNextPage ? (
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Loading more...</span>
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-sm">
                          Showing {allPeople.length} of {totalCount}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* All loaded message */}
                  {!hasNextPage && allPeople.length > 0 && (
                    <div className="p-4 text-center text-muted-foreground text-sm space-y-2">
                      <p>Showing all {allPeople.length} results</p>
                      <p>
                        Don't see who you're looking for? Vote them onto the leaderboard via the{" "}
                        <Link href="/vote/induction" className="text-cyan-600 dark:text-cyan-400 hover:underline font-medium">Induction Queue</Link>
                        {" "}&mdash; the top candidate gets inducted every week.
                      </p>
                    </div>
                  )}
                  
                  {allPeople.length === 0 && !isLoading && (
                    <div className="p-12 text-center">
                      {searchQuery || category !== "all" ? (
                        <p className="text-muted-foreground">
                          No results found matching your filters
                        </p>
                      ) : (
                        <div className="space-y-3">
                          <RefreshCw className="h-6 w-6 text-muted-foreground/50 mx-auto animate-spin" />
                          <p className="text-muted-foreground font-medium">Leaderboard is updating...</p>
                          <p className="text-xs text-muted-foreground/60">Data refreshes automatically every hour. Check back shortly.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
      </div>
      <footer className="border-t mt-24 py-12">
        <div className="container mx-auto px-4 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            VoxDex - Real-time celebrity trending tracker powered by live data APIs
          </p>
          <button
            type="button"
            onClick={() => welcomeOnboardingRef.current?.open()}
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
            data-testid="button-footer-how-it-works-home"
          >
            <HelpCircle className="h-4 w-4 inline mr-1 align-text-bottom" />
            How it works
          </button>
        </div>
      </footer>
      {trendOverlayOpen && (
        <Suspense fallback={null}>
          <TrendGraphOverlay
            open={trendOverlayOpen}
            onClose={() => setTrendOverlayOpen(false)}
            allPeople={allPeople}
          />
        </Suspense>
      )}
      {isMobile ? (
        <YourVoteInfoDrawer
          open={voteLeaderboardInfoOpen}
          onOpenChange={setVoteLeaderboardInfoOpen}
        >
          <HomeApprovalInfoBody onNavigateLink={() => setVoteLeaderboardInfoOpen(false)} />
        </YourVoteInfoDrawer>
      ) : (
        <YourVoteInfoDialog
          open={voteLeaderboardInfoOpen}
          onOpenChange={setVoteLeaderboardInfoOpen}
        >
          <HomeApprovalInfoBody onNavigateLink={() => setVoteLeaderboardInfoOpen(false)} />
        </YourVoteInfoDialog>
      )}

      <TrendScoreLaunchpad
        open={trendScoreLaunchpadOpen}
        onOpenChange={setTrendScoreLaunchpadOpen}
        isMobile={isMobile}
      />

      <VotingModal
        open={votingModalOpen}
        onOpenChange={(nextOpen) => {
          setVotingModalOpen(nextOpen);
          if (!nextOpen) setVotingPersonId(null);
        }}
        initialPersonId={votingPersonId}
        peopleList={allPeople}
      />

      <PersonInsightModal
        person={selectedInsightPerson}
        onClose={handleCloseInsightPanel}
      />
    </div>
  );
}