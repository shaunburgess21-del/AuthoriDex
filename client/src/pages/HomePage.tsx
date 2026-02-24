import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { LeaderboardRow, getExceptionalIndicator } from "@/components/LeaderboardRow";
import type { PercentileThresholds } from "@/components/LeaderboardRow";
import { VotingModal } from "@/components/VotingModal";
import { UserMenu } from "@/components/UserMenu";
import { FilterDropdown } from "@/components/FilterDropdown";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { VoteDeckView } from "@/components/home/VoteDeckView";
import { PredictDeckView } from "@/components/home/PredictDeckView";
import { TrendingNowFeed } from "@/components/TrendingNowFeed";
import { TrendScoreInfoIcon, TrendScoreInfoContent } from "@/components/TrendScoreInfo";
import { ApprovalRatingInfoIcon, ApprovalRatingInfoContent } from "@/components/ApprovalRatingInfo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { X, RefreshCw, TrendingUp, TrendingDown, Activity, ChevronRight, ChevronDown, LineChart, Vote, Trophy, Zap, Users, Sparkles, Target, Check, ThumbsDown, Minus, Rocket, Flame, Star, Info, Crown } from "lucide-react";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { useQuery, useQueries, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TrendingPerson } from "@shared/schema";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { Loader2 } from "lucide-react";
import { useLocation, Link } from "wouter";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";
import { motion, AnimatePresence } from "framer-motion";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type HomeView = "leaderboard" | "predict" | "vote";
const CATEGORY_OPTIONS = ["All", "Tech", "Music", "Politics", "Sports", "Creator"] as const;

function MarketPulseCard({ 
  title, 
  icon: Icon, 
  people, 
  type,
  onPersonClick,
  collapsed,
  onToggle
}: { 
  title: string; 
  icon: typeof TrendingUp; 
  people: TrendingPerson[]; 
  type: "daily" | "gainer" | "dropper";
  onPersonClick: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const colorConfig = {
    daily: {
      iconColor: "text-blue-400",
      cardClass: "pulse-card-blue",
      iconBgClass: "pulse-icon-blue",
      subtitle: "Movement \u00B7 24h",
    },
    gainer: {
      iconColor: "text-green-400",
      cardClass: "pulse-card-green",
      iconBgClass: "pulse-icon-green",
      subtitle: "Momentum \u00B7 7d",
    },
    dropper: {
      iconColor: "text-red-400",
      cardClass: "pulse-card-red",
      iconBgClass: "pulse-icon-red",
      subtitle: "Dropping \u00B7 7d",
    },
  };
  
  const { iconColor, cardClass, iconBgClass, subtitle } = colorConfig[type];
  
  return (
    <div 
      className={`min-w-[280px] md:min-w-0 shrink-0 md:shrink h-full rounded-xl ${cardClass} transition-all duration-200`}
      data-testid={`pulse-card-${type}`}
    >
      <div className={`p-4 ${collapsed ? 'pt-4 pb-4' : 'pt-5'}`}>
        <div 
          className="flex items-center gap-3 cursor-pointer select-none group"
          onClick={onToggle}
          data-testid={`pulse-header-${type}`}
        >
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${iconBgClass}`}>
            <Icon className={`h-4 w-4 ${iconColor}`} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">{subtitle}</p>
          </div>
          <div className={`h-6 w-6 rounded-md flex items-center justify-center bg-slate-700/30 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
            <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
          </div>
        </div>
        
        {!collapsed && (
          <div className="space-y-1.5 mt-4">
            {people.slice(0, 5).map((person, idx) => {
              const changeValue = type === "daily" ? person.change24h : person.change7d;
              if (changeValue === undefined || changeValue === null || isNaN(changeValue)) return null;
              const isPositive = changeValue >= 0;
              return (
                <div
                  key={person.id}
                  className="flex items-center gap-2.5 p-2 rounded-lg hover-elevate cursor-pointer bg-slate-800/30 border border-slate-700/30 transition-colors hover:border-slate-600/50"
                  onClick={() => onPersonClick(person.id)}
                  data-testid={`pulse-item-${person.id}`}
                >
                  <span className="font-mono font-bold text-slate-500 w-4 text-center text-[14px]">{idx + 1}</span>
                  <PersonAvatar name={person.name} avatar={person.avatar} imageSlug={(person as any).imageSlug} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs truncate text-slate-200">{person.name}</p>
                    <p className="text-[10px] text-slate-500">{person.category}</p>
                  </div>
                  <span 
                    className={`px-2 py-0.5 rounded text-xs font-mono font-medium tabular-nums ${
                      isPositive 
                        ? "bg-green-500/15 text-green-400" 
                        : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    {isPositive ? "+" : ""}{changeValue.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const TIME_RANGE_OPTIONS = [
  { key: "7D", label: "7D", days: 7 },
  { key: "30D", label: "30D", days: 30 },
  { key: "90D", label: "90D", days: 90 },
  { key: "ALL", label: "ALL", days: 365 },
] as const;

const MOMENTUM_COLORS = [
  "#22D3EE", // Cyan - matches AuthoriDex teal theme
  "#A855F7", // Violet - ties to Predict page purple
  "#10B981", // Emerald - growth, positivity
  "#F59E0B", // Amber - warm, distinct
  "#F43F5E", // Rose - attention, clear contrast
];

function generateFallbackHistory(
  people: TrendingPerson[],
  days: number
): Record<string, string | number>[] {
  const now = Date.now();
  const dataPoints: Record<string, string | number>[] = [];
  const pointsPerDay = days <= 7 ? 4 : days <= 30 ? 2 : 1;
  const totalPoints = Math.min(days * pointsPerDay, 100);
  const intervalMs = (days * 24 * 60 * 60 * 1000) / totalPoints;

  for (let i = totalPoints - 1; i >= 0; i--) {
    const timestamp = new Date(now - i * intervalMs);
    const entry: Record<string, string | number> = {
      date: `${timestamp.getMonth() + 1}/${timestamp.getDate()}`,
      fullDate: timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      timestamp: timestamp.toISOString(),
    };

    people.forEach((person, idx) => {
      const baseScore = person.trendScore || 50000 + idx * 10000;
      const variation = Math.sin((i / totalPoints) * Math.PI * 2 + idx) * 0.15;
      const trend = (1 - i / totalPoints) * 0.1 * (idx % 2 === 0 ? 1 : -1);
      const noise = (Math.random() - 0.5) * 0.05;
      entry[person.id] = Math.round(baseScore * (1 + variation + trend + noise));
    });

    dataPoints.push(entry);
  }

  return dataPoints;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: string;
  people: TrendingPerson[];
  colors: string[];
}

function MomentumTooltip({ active, payload, label, people, colors }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const sortedPayload = [...payload].sort((a, b) => (b.value || 0) - (a.value || 0));

  return (
    <div className="bg-black/90 backdrop-blur-sm border border-white/10 rounded-lg p-3 shadow-xl min-w-[180px]">
      <p className="text-xs text-muted-foreground mb-2 font-medium border-b border-white/10 pb-2">{label}</p>
      <div className="space-y-1.5">
        {sortedPayload.map((entry, idx) => {
          const personIdx = people.findIndex(p => p.id === entry.dataKey);
          const color = colors[personIdx % colors.length];
          const formattedValue = entry.value >= 1000000 
            ? `${(entry.value / 1000000).toFixed(1)}M` 
            : entry.value >= 1000 
              ? `${(entry.value / 1000).toFixed(1)}K` 
              : entry.value;
          
          return (
            <div key={entry.dataKey} className="flex items-center gap-2">
              <span 
                className="w-2.5 h-2.5 rounded-full shrink-0" 
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-white/80 flex-1 truncate">{entry.name}</span>
              <span className="text-xs font-mono font-medium text-white">{formattedValue}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendGraphOverlay({
  open,
  onClose,
  allPeople
}: {
  open: boolean;
  onClose: () => void;
  allPeople: TrendingPerson[];
}) {
  const dragScrollRef = useDragScroll<HTMLDivElement>();
  const [selectedCategory, setSelectedCategory] = useState<typeof CATEGORY_OPTIONS[number]>("All");
  const [selectedTimeRange, setSelectedTimeRange] = useState<typeof TIME_RANGE_OPTIONS[number]>(TIME_RANGE_OPTIONS[0]);
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({});

  const filteredPeople = selectedCategory === "All" 
    ? allPeople.slice(0, 5)
    : allPeople.filter(p => p.category?.toLowerCase() === selectedCategory.toLowerCase()).slice(0, 5);

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    filteredPeople.forEach(p => { initial[p.id] = true; });
    setVisibleLines(initial);
  }, [selectedCategory, allPeople]);

  const historyQueries = useQueries({
    queries: filteredPeople.map(person => ({
      queryKey: [`/api/trending/${person.id}/history`, selectedTimeRange.days],
      queryFn: async () => {
        const res = await fetch(`/api/trending/${person.id}/history?days=${selectedTimeRange.days}`);
        if (!res.ok) return [];
        return res.json();
      },
      enabled: open && filteredPeople.length > 0,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isLoadingHistory = historyQueries.some(q => q.isLoading);

  const { trendData, usingFallbackData } = useMemo(() => {
    if (historyQueries.some(q => q.isLoading) || filteredPeople.length === 0) {
      return { trendData: [], usingFallbackData: false };
    }
    
    const allTimestamps = new Map<string, Record<string, string | number>>();
    
    filteredPeople.forEach((person, idx) => {
      const data = historyQueries[idx]?.data || [];
      
      data.forEach((point: { timestamp: string; date: string; time: string; trendScore: number }) => {
        const key = point.timestamp;
        if (!allTimestamps.has(key)) {
          const d = new Date(point.timestamp);
          const label = selectedTimeRange.days <= 7 
            ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`
            : `${d.getMonth() + 1}/${d.getDate()}`;
          allTimestamps.set(key, { 
            date: label, 
            fullDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: selectedTimeRange.days <= 7 ? 'numeric' : undefined }),
            timestamp: point.timestamp 
          });
        }
        const entry = allTimestamps.get(key)!;
        entry[person.id] = point.trendScore;
      });
    });
    
    const realData = Array.from(allTimestamps.values())
      .sort((a, b) => {
        const dateA = new Date(a.timestamp as string);
        const dateB = new Date(b.timestamp as string);
        return dateA.getTime() - dateB.getTime();
      });

    const uniqueDates = new Set(realData.map(d => (d.timestamp as string).split('T')[0]));
    const minRequiredDays = Math.min(selectedTimeRange.days, 3);
    
    if (uniqueDates.size < minRequiredDays) {
      return { 
        trendData: generateFallbackHistory(filteredPeople, selectedTimeRange.days), 
        usingFallbackData: true 
      };
    }
    
    return { trendData: realData, usingFallbackData: false };
  }, [historyQueries, filteredPeople, selectedTimeRange]);

  const toggleLine = (id: string) => {
    setVisibleLines(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl overflow-y-auto"
    >
      <div className="container mx-auto px-4 py-6 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-serif font-bold">Compare Momentum</h2>
            <p className="text-sm text-muted-foreground">
              {selectedTimeRange.key === "ALL" ? "All-Time" : `${selectedTimeRange.days}-Day`} Trend Analysis
              {usingFallbackData && (
                <span className="ml-2 text-amber-400/80 text-xs">(Simulated data - collecting real history)</span>
              )}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-trends">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1 border border-border/50">
            {TIME_RANGE_OPTIONS.map(range => (
              <button
                key={range.key}
                onClick={() => setSelectedTimeRange(range)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  selectedTimeRange.key === range.key
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                data-testid={`trend-range-${range.key.toLowerCase()}`}
              >
                {range.label}
              </button>
            ))}
          </div>
          
          <div ref={dragScrollRef} className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1">
            {CATEGORY_OPTIONS.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  selectedCategory === cat
                    ? "bg-blue-500/20 text-blue-300 border border-blue-400/40"
                    : "bg-muted/50 border border-border/50 text-muted-foreground hover:bg-muted/80"
                }`}
                data-testid={`trend-category-${cat.toLowerCase()}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4 md:p-6">
            <div className="h-[350px] md:h-[400px]">
              {isLoadingHistory ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-cyan-500 border-r-transparent"></div>
                    <p className="mt-4 text-sm text-muted-foreground">Loading trend history...</p>
                  </div>
                </div>
              ) : trendData.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-muted-foreground">No trend data available yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis 
                      dataKey="date" 
                      stroke="rgba(255,255,255,0.4)" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      interval="preserveStartEnd"
                      minTickGap={40}
                    />
                    <YAxis 
                      stroke="rgba(255,255,255,0.4)" 
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickFormatter={(value) => {
                        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                        if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                        return value;
                      }}
                      width={50}
                    />
                    <Tooltip 
                      content={<MomentumTooltip people={filteredPeople} colors={MOMENTUM_COLORS} />}
                    />
                    {filteredPeople.map((person, idx) => (
                      visibleLines[person.id] && (
                        <Line
                          key={person.id}
                          type="monotone"
                          dataKey={person.id}
                          name={person.name}
                          stroke={MOMENTUM_COLORS[idx % MOMENTUM_COLORS.length]}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ 
                            r: 6, 
                            stroke: MOMENTUM_COLORS[idx % MOMENTUM_COLORS.length], 
                            strokeWidth: 2,
                            fill: 'rgba(0,0,0,0.8)'
                          }}
                          connectNulls
                        />
                      )
                    ))}
                  </RechartsLineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2 justify-center">
          {filteredPeople.map((person, idx) => (
            <button
              key={person.id}
              onClick={() => toggleLine(person.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                visibleLines[person.id]
                  ? "bg-muted/80 border border-border"
                  : "bg-muted/30 border border-border/30 opacity-50"
              }`}
              data-testid={`legend-toggle-${person.id}`}
            >
              <span 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: MOMENTUM_COLORS[idx % MOMENTUM_COLORS.length] }}
              />
              {person.name}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
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

type LeaderboardTab = "fame" | "approval";
type SortDirection = "desc" | "asc";

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [, setLocation] = useLocation();
  const [votingModalOpen, setVotingModalOpen] = useState(false);
  const [votingPersonId, setVotingPersonId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<HomeView>("leaderboard");
  const [trendOverlayOpen, setTrendOverlayOpen] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState<LeaderboardTab>("fame");
  const [showVoteTip, setShowVoteTip] = useState(() => {
    try {
      return localStorage.getItem("authoridex-vote-tip-dismissed") !== "1" && localStorage.getItem("authoridex-has-ever-voted") !== "1";
    } catch { return false; }
  });

  useEffect(() => {
    const handleEverVoted = () => setShowVoteTip(false);
    window.addEventListener("authoridex-ever-voted", handleEverVoted);
    return () => window.removeEventListener("authoridex-ever-voted", handleEverVoted);
  }, []);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [moversCollapsed, setMoversCollapsed] = useState(true);
  const [trendingNowCollapsed, setTrendingNowCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('trending_now_collapsed');
      return saved !== null ? saved === 'true' : true;
    } catch { return true; }
  });

  const handleTrendingNowToggle = () => {
    const next = !trendingNowCollapsed;
    setTrendingNowCollapsed(next);
    try { localStorage.setItem('trending_now_collapsed', String(next)); } catch {}
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery<TrendingResponse>({
    queryKey: ['/api/leaderboard', searchQuery, category, leaderboardTab, sortDirection],
    queryFn: async ({ pageParam = 0 }) => {
      const queryParams = new URLSearchParams();
      if (searchQuery) queryParams.set('search', searchQuery);
      if (category !== 'all') queryParams.set('category', category);
      queryParams.set('limit', String(PAGE_SIZE));
      queryParams.set('offset', String(pageParam));
      queryParams.set('tab', leaderboardTab);
      queryParams.set('sortDir', sortDirection);
      
      const response = await fetch(`/api/leaderboard?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.data.length, 0);
      return loadedCount < lastPage.totalCount ? loadedCount : undefined;
    },
    initialPageParam: 0,
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

  const { data: topGainers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/gainers'],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: topDroppers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/droppers'],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: dailyMovers = [] } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending/movers/daily'],
    refetchInterval: 5 * 60 * 1000,
  });

  // Handler for tab clicks: toggle sort direction if same tab clicked again
  const handleTabClick = (tab: LeaderboardTab) => {
    if (tab === leaderboardTab) {
      setSortDirection(prev => prev === "desc" ? "asc" : "desc");
    } else {
      setLeaderboardTab(tab);
      setSortDirection("desc"); // Reset to desc when switching tabs
    }
  };

  // For display, just use allPeople from the API
  const displayPeople = useMemo(() => {
    return allPeople;
  }, [allPeople]);

  const percentileThresholds = useMemo(() => {
    const thresholds = data?.pages[0]?.thresholds;
    if (!thresholds) return undefined;
    return thresholds as PercentileThresholds;
  }, [data]);

  const exceptionalIds = useMemo(() => {
    if (!percentileThresholds) return new Set<string>();
    const candidates = displayPeople
      .filter(p => {
        const ind = getExceptionalIndicator(p as any, percentileThresholds);
        return ind != null;
      })
      .map(p => p.id);
    return new Set(candidates);
  }, [displayPeople, percentileThresholds]);

  const { data: systemFreshness } = useQuery<{
    lastScoredAt: string;
    lastScoredAtFormatted: string;
    liveUpdatedAt: string | null;
    liveUpdatedAtFormatted: string | null;
    fullRefreshAt: string | null;
    fullRefreshAtFormatted: string | null;
  }>({
    queryKey: ['/api/system/freshness'],
    refetchInterval: 30 * 1000,
  });

  const handleVisitProfile = (personId: string) => {
    setLocation(`/person/${personId}`);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setCategory("all");
  };

  const handleVoteClick = (personId: string) => {
    setVotingPersonId(personId);
    setVotingModalOpen(true);
  };

  const handleHeroCastVote = () => {
    if (allPeople.length > 0) {
      setVotingPersonId(allPeople[0].id);
      setVotingModalOpen(true);
    }
  };

  const handlePullRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['/api/leaderboard'] });
    await queryClient.invalidateQueries({ queryKey: ['/api/trending/movers'] });
    await queryClient.invalidateQueries({ queryKey: ['/api/system/freshness'] });
  }, []);

  const { containerRef: pullRefreshRef, pullDistance, isRefreshing: isPullRefreshing } = usePullToRefresh({
    onRefresh: handlePullRefresh,
  });

  const hasActiveFilters = searchQuery || category !== "all";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-500 border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading trending data...</p>
        </div>
      </div>
    );
  }

  if (error) {
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
    <div className="min-h-screen pb-20 md:pb-0" ref={pullRefreshRef}>
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
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <button 
            onClick={() => {
              setActiveView("leaderboard");
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-logo-home"
          >
            <AuthoriDexLogo size={32} />
            <span className="font-serif font-bold text-xl">AuthoriDex</span>
          </button>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-blue-400" 
                onClick={() => {
                  setActiveView("leaderboard");
                  document.getElementById("leaderboard")?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                data-testid="nav-leaderboard-desktop"
              >
                Leaderboard
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setLocation("/vote");
                  window.scrollTo(0, 0);
                }} 
                data-testid="nav-vote-desktop"
              >
                Vote
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/predict")} data-testid="nav-predict-desktop">
                Predict
              </Button>
            </div>
            <UserMenu />
          </div>
        </div>
      </header>
      <HeroSection onCastVoteClick={handleHeroCastVote} onPredictClick={() => setLocation("/predict")} />
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
                      ? "bg-blue-500/20 text-blue-300 border border-blue-400/40 shadow-sm shadow-blue-500/20"
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
      <div className="container mx-auto px-4 py-8 max-w-7xl" data-content-section>
                            <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 mb-4 md:grid md:grid-cols-3 md:overflow-visible" data-testid="market-pulse-row">
                <MarketPulseCard 
                  title="Daily Movers" 
                  icon={Activity} 
                  people={dailyMovers} 
                  type="daily"
                  onPersonClick={handleVisitProfile}
                  collapsed={moversCollapsed}
                  onToggle={() => setMoversCollapsed(!moversCollapsed)}
                />
                <MarketPulseCard 
                  title="Weekly Gainers" 
                  icon={TrendingUp} 
                  people={topGainers} 
                  type="gainer"
                  onPersonClick={handleVisitProfile}
                  collapsed={moversCollapsed}
                  onToggle={() => setMoversCollapsed(!moversCollapsed)}
                />
                <MarketPulseCard 
                  title="Weekly Droppers" 
                  icon={TrendingDown} 
                  people={topDroppers} 
                  type="dropper"
                  onPersonClick={handleVisitProfile}
                  collapsed={moversCollapsed}
                  onToggle={() => setMoversCollapsed(!moversCollapsed)}
                />
              </div>

              <div className="mb-[22px]">
                <TrendingNowFeed
                  onPersonClick={handleVisitProfile}
                  collapsed={trendingNowCollapsed}
                  onToggle={handleTrendingNowToggle}
                />
              </div>

              <div id="leaderboard" className="scroll-mt-24" />
              <Card>
                <CardHeader className="flex flex-col gap-4 space-y-0 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-2xl font-serif">Leaderboards</CardTitle>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/60 flex-wrap" data-testid="text-leaderboard-freshness">
                        <TouchTooltip
                          content={<p>Fast-lane updates every 10 min using votes and profile views (no external API calls).</p>}
                          side="bottom"
                          className="text-xs max-w-[240px]"
                        >
                          <span className="inline-flex items-center gap-1 cursor-help">
                            <Zap className="h-3 w-3 text-green-400" />
                            <span>Live: {systemFreshness?.liveUpdatedAtFormatted || "pending"}</span>
                          </span>
                        </TouchTooltip>
                        <span className="text-muted-foreground/40">|</span>
                        <TouchTooltip
                          content={<p>Full data refresh from Wikipedia, GDELT, and Google using external APIs.</p>}
                          side="bottom"
                          className="text-xs max-w-[240px]"
                        >
                          <span className="inline-flex items-center gap-1 cursor-help">
                            <RefreshCw className="h-3 w-3" />
                            <span>Full: {systemFreshness?.fullRefreshAtFormatted || systemFreshness?.lastScoredAtFormatted || "recently"}</span>
                          </span>
                        </TouchTooltip>
                      </div>
                    </div>
                  </div>
                  
                </CardHeader>
                <div className="sticky top-16 z-30 border-b border-border/60 px-4 sm:px-6 py-2 bg-card/95 backdrop-blur-md">
                  <div className="flex items-center gap-2">
                    <div className="inline-flex items-center rounded-lg bg-muted/50 p-0.5" data-testid="toggle-leaderboard-tabs">
                      <button
                        onClick={() => handleTabClick("fame")}
                        className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-1 rounded-md text-[13px] font-medium transition-all ${
                          leaderboardTab === "fame"
                            ? "bg-background shadow-sm text-foreground"
                            : "text-muted-foreground"
                        }`}
                        data-testid="tab-leaderboard-fame"
                      >
                        {leaderboardTab === "fame" && (
                          <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#3C83F6]" />
                        )}
                        <Crown className={`h-3.5 w-3.5 ${leaderboardTab === "fame" ? "text-[#3C83F6]" : "text-muted-foreground/60"}`} />
                        Trending
                        {leaderboardTab === "fame" && (
                          <span className="text-[11px] text-muted-foreground/70">{sortDirection === "desc" ? "↓" : "↑"}</span>
                        )}
                      </button>
                      <button
                        onClick={() => handleTabClick("approval")}
                        className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-1 rounded-md text-[13px] font-medium transition-all ${
                          leaderboardTab === "approval"
                            ? "bg-background shadow-sm text-foreground"
                            : "text-muted-foreground"
                        }`}
                        data-testid="tab-leaderboard-approval"
                      >
                        {leaderboardTab === "approval" && (
                          <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#22D3EE]" />
                        )}
                        <Star className={`h-3.5 w-3.5 ${leaderboardTab === "approval" ? "text-[#22D3EE]" : "text-muted-foreground/60"}`} />
                        Approval
                        {leaderboardTab === "approval" && (
                          <span className="text-[11px] text-muted-foreground/70">{sortDirection === "desc" ? "↓" : "↑"}</span>
                        )}
                      </button>
                    </div>
                    <TouchTooltip
                      content={leaderboardTab === "fame" ? <TrendScoreInfoContent /> : <ApprovalRatingInfoContent />}
                      side="bottom"
                      align="end"
                      contentClassName="max-w-[280px]"
                      showCloseButton
                    >
                      <Info
                        className={`h-3.5 w-3.5 cursor-help shrink-0 ${leaderboardTab === "fame" ? "text-[#3C83F6]/60" : "text-[#22D3EE]/60"}`}
                        data-testid="icon-leaderboard-info"
                      />
                    </TouchTooltip>
                  </div>
                </div>
                <CardContent className="p-0">
                  <div className="px-6 py-4 border-b bg-muted/30">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <FilterDropdown value={category} onChange={setCategory} />
                        <div className="flex-1">
                          <SearchBar 
                            onSearch={setSearchQuery} 
                            placeholder="Search..."
                          />
                        </div>
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
                              Category: {category}
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
                  {leaderboardTab === "fame" && percentileThresholds && (
                    <div className="px-4 sm:px-6 py-2.5 border-b bg-muted/20 flex items-center gap-4 flex-wrap text-[11px] text-muted-foreground" data-testid="indicator-legend">
                      <TouchTooltip content="Big score surge combined with a major rank jump" side="bottom" className="text-xs max-w-[200px]">
                        <span className="inline-flex items-center gap-1 cursor-help" data-testid="legend-breakout">
                          <Rocket className="h-3 w-3 text-orange-400" />
                          Breakout
                        </span>
                      </TouchTooltip>
                      <TouchTooltip content="Top percentile score spike or rank jump in the last 24 hours" side="bottom" className="text-xs max-w-[200px]">
                        <span className="inline-flex items-center gap-1 cursor-help" data-testid="legend-surging">
                          <Flame className="h-3 w-3 text-yellow-400" />
                          Surging
                        </span>
                      </TouchTooltip>
                      <TouchTooltip content="Fading momentum or dropping in rank" side="bottom" className="text-xs max-w-[200px]">
                        <span className="inline-flex items-center gap-1 cursor-help opacity-80" data-testid="legend-cooling">
                          <TrendingDown className="h-3 w-3 text-sky-300" />
                          Cooling
                        </span>
                      </TouchTooltip>
                    </div>
                  )}
                  {showVoteTip && (
                    <div className="mx-4 sm:mx-6 my-2 px-3 py-2.5 rounded-md bg-primary/5 border border-primary/15 flex items-center justify-between gap-3" data-testid="vote-tip-banner">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Star className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>Tap <span className="font-medium text-foreground">Rate</span> next to any name to cast your vote</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground/60"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowVoteTip(false);
                          try { localStorage.setItem("authoridex-vote-tip-dismissed", "1"); } catch {}
                        }}
                        aria-label="Dismiss tip"
                        data-testid="button-dismiss-vote-tip"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  {displayPeople.length > 0 && (
                    <div className="hidden lg:flex items-center gap-4 px-4 py-2 border-b text-[11px] font-medium uppercase tracking-wider text-muted-foreground" data-testid="leaderboard-column-header">
                      <div className="flex-1" />
                      {leaderboardTab === "fame" ? (
                        <>
                          <div className="text-right w-[120px] shrink-0 flex items-center justify-end gap-1">Trend Score <TrendScoreInfoIcon testId="icon-trend-score-header" className="h-3 w-3 text-muted-foreground/40 cursor-help" /></div>
                          <div className="text-right w-[72px] shrink-0">24h</div>
                          <div className="text-right w-[72px] shrink-0 flex items-center justify-end gap-1">Approval <ApprovalRatingInfoIcon testId="icon-approval-header-fame" className="h-3 w-3 text-muted-foreground/40 cursor-help" /></div>
                        </>
                      ) : (
                        <>
                          <div className="text-right w-[120px] shrink-0 flex items-center justify-end gap-1">Approval <ApprovalRatingInfoIcon testId="icon-approval-header" className="h-3 w-3 text-muted-foreground/40 cursor-help" /></div>
                          <div className="text-right w-[120px] shrink-0 flex items-center justify-end gap-1">Trend Score <TrendScoreInfoIcon testId="icon-trend-score-header-approval" className="h-3 w-3 text-muted-foreground/40 cursor-help" /></div>
                        </>
                      )}
                      <div className="w-[68px] shrink-0" />
                    </div>
                  )}
                  <div>
                    {displayPeople.length === 0 && !isLoading && (
                      <div className="p-8 text-center">
                        <p className="text-muted-foreground mb-3">
                          {searchQuery ? "No results found" : "No results found for current filters"}
                        </p>
                        {searchQuery && (
                          <Link href="/vote?section=induction">
                            <Button variant="outline" size="sm" data-testid="button-view-induction-list">
                              <Users className="h-4 w-4 mr-2" />
                              View Induction List
                            </Button>
                          </Link>
                        )}
                      </div>
                    )}
                    {displayPeople.map((person) => (
                      <LeaderboardRow
                        key={person.id}
                        person={person}
                        activeTab={leaderboardTab}
                        onVisitProfile={() => handleVisitProfile(person.id)}
                        onVoteClick={() => handleVoteClick(person.id)}
                        showExceptional={exceptionalIds.has(person.id)}
                        thresholds={percentileThresholds}
                      />
                    ))}
                  </div>
                  
                  {/* Infinite scroll trigger element */}
                  {hasNextPage && (
                    <div 
                      ref={loadMoreRef}
                      className="p-6 border-t text-center"
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
                    <div className="p-4 border-t text-center text-muted-foreground text-sm">
                      Showing all {allPeople.length} results
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
                </CardContent>
              </Card>
          {/* PRESERVED: Vote and Predict toggle sections - commented out for future re-enable
          {activeView === "predict" && (
            <>
              <PredictDeckView 
                trendingPeople={allPeople} 
                isLoading={isLoading}
                onExplore={() => setLocation("/predict")} 
              />
            </>
          )}

          {activeView === "vote" && (
            <VoteDeckView 
              onExplore={() => setLocation("/vote")} 
            />
          )}
          */}
      </div>
      <footer className="border-t mt-24 py-12">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground">
            AuthoriDex - Real-time celebrity trending tracker powered by live data APIs
          </p>
        </div>
      </footer>
      <AnimatePresence>
        {trendOverlayOpen && (
          <TrendGraphOverlay 
            open={trendOverlayOpen} 
            onClose={() => setTrendOverlayOpen(false)}
            allPeople={allPeople}
          />
        )}
      </AnimatePresence>
      <VotingModal 
        open={votingModalOpen} 
        onOpenChange={setVotingModalOpen}
        initialPersonId={votingPersonId}
        peopleList={allPeople}
      />
    </div>
  );
}
