import { VoxDexPulse } from "@/components/VoxDexPulse";
import { WelcomeModal } from "@/components/WelcomeModal";
import type { OnboardingDrawerHandle } from "@/components/OnboardingDrawer";
import { SearchBar } from "@/components/SearchBar";
import { LeaderboardRow } from "@/components/LeaderboardRow";
import { VotingModal } from "@/components/VotingModal";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { toast } from "sonner";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { FilterDropdown } from "@/components/FilterDropdown";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill, getCategoryTextColor } from "@/components/CategoryPill";
import { VoteDeckView } from "@/components/home/VoteDeckView";
import { PredictDeckView } from "@/components/home/PredictDeckView";
import { TrendingNowFeed, type HotMover } from "@/components/TrendingNowFeed";
import { TrendScoreInfoIcon, TrendScoreInfoContent } from "@/components/TrendScoreInfo";
import { ApprovalRatingInfoIcon, ApprovalRatingInfoContent } from "@/components/ApprovalRatingInfo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { X, RefreshCw, TrendingUp, TrendingDown, Activity, ChevronRight, ChevronDown, LineChart, Vote, Trophy, Users, Sparkles, Target, Check, ThumbsDown, Minus, Star, Info, Crown, HelpCircle } from "lucide-react";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { useQuery, useQueries, useInfiniteQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { hapticSuccess, hapticError } from "@/lib/haptic";
import { useXpBurst } from "@/components/XpBurstProvider";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { getMarketBaselineScore, type MarketBaselineSource } from "@/lib/predict-market-baseline";
import { computePayoutMultiplier } from "@/lib/parimutuel";
import { TrendingPerson } from "@shared/schema";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { useIsMobile } from "@/hooks/use-mobile";
import { Loader2 } from "lucide-react";
import { useLocation, Link } from "wouter";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";

type HomeView = "leaderboard" | "predict" | "vote";
const CATEGORY_OPTIONS = ["All", "Tech", "Business", "Politics", "Sports", "Music", "Film & TV", "Gaming", "Creator", "Food & Drink", "Lifestyle"] as const;

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
      subtitle: "Movement \u00B7 24h",
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
            <h3 className="text-sm font-semibold text-foreground dark:text-slate-100">{title}</h3>
            <p className="text-[10px] text-muted-foreground dark:text-slate-500 uppercase tracking-wider">{subtitle}</p>
          </div>
          <div className={`h-6 w-6 rounded-md flex items-center justify-center bg-muted/50 dark:bg-slate-700/30 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
            <ChevronDown className="h-4 w-4 text-muted-foreground dark:text-slate-400 group-hover:text-foreground dark:group-hover:text-slate-200 transition-colors" />
          </div>
        </div>
        
        {!collapsed && (
          <div className="space-y-1.5 mt-4">
            {people
              .filter((person) => {
                const v = type === "daily" ? person.change24h : person.change7d;
                return typeof v === "number" && !isNaN(v);
              })
              .slice(0, 5)
              .map((person, idx) => {
                const changeValue = (type === "daily" ? person.change24h : person.change7d) as number;
                const isPositive = changeValue >= 0;
                return (
                  <div
                    key={person.id}
                    className="flex items-center gap-2.5 p-2 rounded-lg hover-elevate cursor-pointer bg-muted/40 dark:bg-slate-800/30 border border-border/50 dark:border-slate-700/30 transition-colors hover:border-foreground/20 dark:hover:border-slate-600/50"
                    onClick={() => onOpenInsight(person)}
                    data-testid={`pulse-item-${person.id}`}
                  >
                    <div className="relative flex items-center rounded-md overflow-hidden shrink-0">
                      <div className="flex items-center justify-center min-w-[24px] self-stretch rounded-l-md bg-muted dark:bg-[#101318] border-r border-border dark:border-transparent">
                        <span className="font-mono font-semibold text-muted-foreground dark:text-slate-400 text-[12px] tabular-nums">{idx + 1}</span>
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
                      <p className={`text-[10px] ${getCategoryTextColor(person.category ?? "")}`}>{person.category}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono font-medium tabular-nums ${
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
      // Deterministic per-(i, idx) pseudo-noise. Math.random() made the whole
      // chart jitter on every React re-render because the fallback generator
      // re-ran with new values each time; using cos with a mixed frequency
      // gives a stable "noisy" shape that doesn't change across renders.
      const noise = Math.cos(i * 1.7 + idx * 2.3) * 0.025;
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
                <span className="ml-2 text-amber-600/80 dark:text-amber-400/80 text-xs">(Simulated data - collecting real history)</span>
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
                    ? "bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-500 dark:text-cyan-300 border border-cyan-500/50 dark:border-cyan-400/40"
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
                    ? "bg-blue-500/25 dark:bg-blue-500/20 text-blue-500 dark:text-blue-300 border border-blue-500/50 dark:border-blue-400/40"
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

interface InsightPerson {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number | null;
  change24h: number | null;
  rankChange: number | null;
}

interface PersonMomentumResponse {
  signals?: {
    news?: { deltaPct?: number };
    wiki?: { deltaPct?: number };
    momentum?: { deltaPct?: number };
  };
}

interface InsightSignal {
  label: "Wiki" | "News" | "Momentum";
  deltaPct: number;
}

function InsightPanelContent({
  person,
  loading,
  error,
  growthSignals,
  coolingSignals,
  onClose,
  onViewProfile,
}: {
  person: InsightPerson;
  loading: boolean;
  error: boolean;
  growthSignals: InsightSignal[];
  coolingSignals: InsightSignal[];
  onClose: () => void;
  onViewProfile: () => void;
}) {
  const formatPct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1).replace(/\.0$/, "")}%`;
  const currentRank = typeof person.rank === "number" ? person.rank : null;
  const previousRank = currentRank != null && typeof person.rankChange === "number"
    ? currentRank + person.rankChange
    : null;
  const showRankShift = currentRank != null && previousRank != null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
        <PersonAvatar
          name={person.name}
          avatar={person.avatar}
          size="md"
          className="h-12 w-12"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate">{person.name}</p>
          {person.category && (
            <p className={`text-xs ${getCategoryTextColor(person.category)}`}>{person.category}</p>
          )}
        </div>
        {typeof person.change24h === "number" && (
          <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium tabular-nums ${
            person.change24h > 0
              ? "bg-green-500/15 text-green-600 dark:text-green-400"
              : "bg-red-500/15 text-red-600 dark:text-red-400"
          }`}>
            {person.change24h > 0 ? "+" : ""}
            {person.change24h.toFixed(1)}%
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-3 bg-background/60">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">RANK SHIFT</p>
        {showRankShift ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              Was #{previousRank} {"\u2192"} Now #{currentRank}
            </p>
            <span className={`px-2 py-0.5 rounded text-xs font-mono font-semibold ${
              (person.rankChange ?? 0) > 0
                ? "bg-green-500/15 text-green-600 dark:text-green-400"
                : (person.rankChange ?? 0) < 0
                  ? "bg-red-500/15 text-red-600 dark:text-red-400"
                  : "bg-muted text-muted-foreground"
            }`}>
              {(person.rankChange ?? 0) > 0 ? "+" : ""}
              {person.rankChange ?? 0}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Rank movement unavailable</p>
        )}
      </div>

      {loading ? (
        <div className="rounded-lg border border-border/60 p-3 bg-background/60">
          <p className="text-sm text-muted-foreground">Loading signal insights...</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border/60 p-3 bg-background/60">
          <p className="text-sm text-muted-foreground">Unable to load signal insights right now</p>
        </div>
      ) : (
        <>
          {growthSignals.length > 0 && (
            <div className="rounded-lg border border-border/60 p-3 bg-background/60">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">GROWTH SIGNALS</p>
              <div className="flex flex-wrap gap-2">
                {growthSignals.map((signal) => (
                  <span
                    key={signal.label}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400"
                  >
                    {signal.label} {formatPct(signal.deltaPct)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {coolingSignals.length > 0 && (
            <div className="rounded-lg border border-border/60 p-3 bg-background/60">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">COOLING SIGNALS</p>
              <div className="flex flex-wrap gap-2">
                {coolingSignals.map((signal) => (
                  <span
                    key={signal.label}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-500/15 text-red-600 dark:text-red-400"
                  >
                    {signal.label} {formatPct(signal.deltaPct)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onViewProfile}>
          View full profile
        </Button>
      </div>
    </div>
  );
}

type LeaderboardTab = "fame" | "approval";
type SortDirection = "desc" | "asc";

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("category");
    if (!raw) return "all";
    const lowered = raw.toLowerCase();
    if (lowered === "all" || lowered === "favorites" || lowered === "trending") return lowered;
    return normalizeMarketCategory(raw);
  });
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const leaderboardCategories = useLeaderboardCategories();

  useEffect(() => {
    if (window.location.hash === "#leaderboard") {
      requestAnimationFrame(() => {
        document.getElementById("leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);
  const [votingModalOpen, setVotingModalOpen] = useState(false);
  const [votingPersonId, setVotingPersonId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<HomeView>("leaderboard");
  const [trendOverlayOpen, setTrendOverlayOpen] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState<LeaderboardTab>("fame");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [approvalShowResults, setApprovalShowResults] = useState(false);
  const [moversCollapsed, setMoversCollapsed] = useState(true);
  const welcomeOnboardingRef = useRef<OnboardingDrawerHandle>(null);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);
  // Real wallet balance from the auth profile — was previously a
  // hardcoded `useState(10000)`, which let users on the home
  // leaderboard appear to stake credits they didn't have. The
  // PredictPage / UpDownDetailPage modals already read from
  // profile.predictCredits; the home leaderboard's predict column
  // now mirrors that single source of truth so balance + post-bet
  // validation behave identically.
  const { profile, refreshProfile } = useAuth();
  const { trigger: triggerXpBurst } = useXpBurst();
  const walletCredits = profile?.predictCredits ?? 0;

  const { data: nativeUpdownData } = useQuery<any[]>({
    queryKey: ['/api/native-markets/updown'],
  });
  const updownMarkets = useMemo(() => {
    const dbMarkets = (nativeUpdownData || []).filter((m: any) => m.visibility === "live");
    return dbMarkets.map((m: any) => {
      const person = m.person || {};
      const entries = m.entries || [];
      const upEntry = entries.find((e: any) => e.label?.toLowerCase() === "up");
      const downEntry = entries.find((e: any) => e.label?.toLowerCase() === "down");
      const upStake = Number(upEntry?.totalStake || 0);
      const downStake = Number(downEntry?.totalStake || 0);
      const total = upStake + downStake || 1;
      const upPercent = Math.round((upStake / total) * 100);
      const currentScore = Number(person.trendScore || 0);
      const baselineScore = getMarketBaselineScore(m as MarketBaselineSource, currentScore) ?? currentScore;
      return {
        id: m.id,
        personId: m.personId || "",
        personName: person.name || m.title?.replace(/: Up or Down\?$/, "") || "Unknown",
        currentScore,
        startScore: baselineScore,
        baselineScore,
        upEntryId: upEntry?.id as string | undefined,
        downEntryId: downEntry?.id as string | undefined,
        upMultiplier: computePayoutMultiplier(upStake + downStake, upStake),
        downMultiplier: computePayoutMultiplier(upStake + downStake, downStake),
        upPoolPercent: upPercent || 50,
        bettingCutoff: (m.bettingCutoff as string) || null,
        startAt: (m.startAt as string) || null,
        endAt: (m.endAt as string) || null,
        tieRule: (m.tieRule as string) || "refund",
      };
    });
  }, [nativeUpdownData]);

  const isUpdownCutoffPassed = useMemo(() => {
    const allNative = (nativeUpdownData || []) as any[];
    return allNative.some((m: any) => m.isCutoffPassed === true);
  }, [nativeUpdownData]);

  const leaderboardClosedMessage = useMemo(() => {
    const allNative = (nativeUpdownData || []) as any[];
    const firstMarket = allNative[0];
    return getClosedMarketMessage({
      bettingCutoff: firstMarket?.bettingCutoff,
      resolutionDeadline: firstMarket?.resolutionDeadline || firstMarket?.endAt,
    });
  }, [nativeUpdownData]);

  const handleLeaderboardPredict = useCallback((personId: string, direction: "up" | "down") => {
    if (isUpdownCutoffPassed) {
      return;
    }
    const market = updownMarkets.find(m => m.personId === personId);
    if (!market) {
      toast("No active market", { description: "No active prediction market for this person this week." });
      return;
    }
    const crowdSentiment = direction === "up" ? market.upPoolPercent : (100 - market.upPoolPercent);
    const estimatedPayout = direction === "up" ? market.upMultiplier : market.downMultiplier;
    setPendingSelection({
      type: "updown",
      choice: direction === "up" ? "Trend Score UP" : "Trend Score DOWN",
      marketName: market.personName,
      marketId: market.id,
      entryId: direction === "up" ? market.upEntryId : market.downEntryId,
      startScore: market.startScore,
      currentScore: market.currentScore,
      crowdSentiment,
      estimatedPayout,
      baselineScore: market.baselineScore,
      baselineTimestamp: market.startAt || undefined,
      tieRule: market.tieRule,
      endAt: market.endAt || undefined,
      bettingCutoff: market.bettingCutoff,
    });
    refreshProfile?.().catch(() => {});
    setStakeModalOpen(true);
  }, [updownMarkets, isUpdownCutoffPassed, refreshProfile]);

  // Real updown bet path, mirroring PredictPage's nativeUpdownBetMutation
  // so the home leaderboard's predict column hits the same backend
  // endpoint with the same payload, gets the same XP burst + cache
  // invalidation + balance refresh, and shows the same error toast on
  // failure. Previously this was a fake setState that just decremented
  // a hardcoded local balance without ever calling the API.
  const nativeUpdownBetMutation = useMutation({
    mutationFn: async ({ marketId, entryId, stakeAmount }: { marketId: string; entryId: string; stakeAmount: number }) => {
      const res = await apiRequest("POST", `/api/native-markets/updown/${marketId}/bet`, { entryId, stakeAmount });
      return res.json();
    },
    onSuccess: async (data, variables) => {
      hapticSuccess();
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      toast("Prediction placed!", { description: "Your weekly up/down prediction has been recorded." });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/updown"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: (err: Error) => {
      hapticError();
      toast.error("Failed to place prediction", { description: err.message });
    },
  });

  const handleConfirmStake = useCallback((amount: number) => {
    if (!pendingSelection || pendingSelection.type !== "updown" || !pendingSelection.marketId) {
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }
    const market = updownMarkets.find((m) => m.id === pendingSelection.marketId);
    if (!market) {
      toast.error("Market unavailable", { description: "Could not find the selected market. Please refresh and try again." });
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }
    const isDownPick = pendingSelection.choice.toUpperCase().includes("DOWN");
    const entryId = isDownPick ? market.downEntryId : market.upEntryId;
    if (!entryId) {
      toast.error("Selection unavailable", { description: "This market selection is not available right now." });
      return;
    }
    nativeUpdownBetMutation.mutate({ marketId: market.id, entryId, stakeAmount: amount });
  }, [pendingSelection, updownMarkets, nativeUpdownBetMutation]);
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

  const [selectedInsightPerson, setSelectedInsightPerson] = useState<InsightPerson | null>(null);

  const [pulseCollapsed, setPulseCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('voxdex_pulse_collapsed');
      // Default-collapsed for new users so all home cards open uniformly.
      // Returning users with a saved preference keep their last state.
      return saved !== null ? saved === 'true' : true;
    } catch { return true; }
  });

  const handlePulseToggle = () => {
    const next = !pulseCollapsed;
    setPulseCollapsed(next);
    try { localStorage.setItem('voxdex_pulse_collapsed', String(next)); } catch {}
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

  const {
    data: selectedInsightMomentum,
    isLoading: selectedInsightMomentumLoading,
    isError: selectedInsightMomentumError,
  } = useQuery<PersonMomentumResponse>({
    queryKey: ["/api/people", selectedInsightPerson?.id, "momentum"],
    queryFn: async () => {
      const response = await fetch(`/api/people/${selectedInsightPerson!.id}/momentum`);
      if (!response.ok) throw new Error("Failed to fetch momentum insights");
      return response.json();
    },
    enabled: !!selectedInsightPerson?.id,
    staleTime: 60_000,
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

  const { data: systemFreshness } = useQuery<{
    lastScoredAt: string;
    lastScoredAtFormatted: string;
    liveUpdatedAt: string | null;
    liveUpdatedAtFormatted: string | null;
    fullRefreshAt: string | null;
    fullRefreshAtFormatted: string | null;
  }>({
    queryKey: ['/api/system/freshness'],
    refetchInterval: 90 * 1000,
  });

  const handleVisitProfile = (personId: string) => {
    setLocation(`/person/${personId}`);
  };

  const openInsightFromHotMover = (person: HotMover) => {
    setSelectedInsightPerson({
      id: person.id,
      name: person.name,
      avatar: person.avatar,
      category: person.category,
      rank: person.rank ?? null,
      change24h: person.change24h ?? null,
      rankChange: person.rankChange ?? null,
    });
  };

  const openInsightFromTrendingPerson = (person: TrendingPerson) => {
    setSelectedInsightPerson({
      id: person.id,
      name: person.name,
      avatar: person.avatar ?? null,
      category: person.category ?? null,
      rank: ((person as any).liveRank ?? person.rank ?? null) as number | null,
      change24h: person.change24h ?? null,
      rankChange: ((person as any).rankChange ?? null) as number | null,
    });
  };

  const handleCloseInsightPanel = () => {
    setSelectedInsightPerson(null);
  };

  const handleViewInsightProfile = () => {
    if (!selectedInsightPerson) return;
    handleVisitProfile(selectedInsightPerson.id);
    setSelectedInsightPerson(null);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setCategory("all");
  };

  const handleVoteClick = (personId: string) => {
    setVotingPersonId(personId);
    setVotingModalOpen(true);
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
  const leaderboardFilterCategories = useMemo(() => {
    const pinned = [
      { value: "all", label: "All Categories" },
      { value: "favorites", label: "Favorites" },
      { value: "trending", label: "Trending" },
    ];
    const dynamic = Array.from(leaderboardCategories ?? [])
      .filter((id) => id && id !== "all" && id !== "favorites" && id !== "trending")
      .sort((a, b) => getMarketCategoryLabel(a).localeCompare(getMarketCategoryLabel(b)))
      .map((id) => ({ value: id, label: getMarketCategoryLabel(id) }));
    if (category !== "all" && category !== "favorites" && category !== "trending" && !dynamic.some((c) => c.value === category)) {
      dynamic.unshift({ value: category, label: getMarketCategoryLabel(category) });
    }
    return [...pinned, ...dynamic];
  }, [leaderboardCategories, category]);

  const activeCategoryLabel = useMemo(() => {
    if (category === "all") return "All Categories";
    if (category === "favorites") return "Favorites";
    if (category === "trending") return "Trending";
    return getMarketCategoryLabel(category);
  }, [category]);

  const insightSignals = useMemo<InsightSignal[]>(() => {
    if (!selectedInsightMomentum?.signals) return [];
    return [
      { label: "Wiki" as const, deltaPct: selectedInsightMomentum.signals.wiki?.deltaPct ?? 0 },
      { label: "News" as const, deltaPct: selectedInsightMomentum.signals.news?.deltaPct ?? 0 },
      { label: "Momentum" as const, deltaPct: selectedInsightMomentum.signals.momentum?.deltaPct ?? 0 },
    ];
  }, [selectedInsightMomentum]);

  const insightGrowthSignals = useMemo<InsightSignal[]>(
    () => insightSignals.filter((item) => Number.isFinite(item.deltaPct) && item.deltaPct > 0),
    [insightSignals]
  );

  const insightCoolingSignals = useMemo<InsightSignal[]>(
    () => insightSignals.filter((item) => Number.isFinite(item.deltaPct) && item.deltaPct < 0),
    [insightSignals]
  );

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
            className="flex items-center gap-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="button-logo-home"
          >
            <VoxDexLogo size={32} />
            <span className="font-serif font-bold text-xl">VoxDex</span>
          </button>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-blue-700 dark:text-blue-400 md:text-sm" 
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
                className="md:text-sm"
                onClick={() => {
                  setLocation("/vote");
                  window.scrollTo(0, 0);
                }} 
                data-testid="nav-vote-desktop"
              >
                Vote
              </Button>
              <Button variant="ghost" size="sm" className="md:text-sm" onClick={() => setLocation("/predict")} data-testid="nav-predict-desktop">
                Predict
              </Button>
            </div>
            <HeaderUserActions />
          </div>
        </div>
      </header>
      <VoxDexPulse collapsed={pulseCollapsed} onToggle={handlePulseToggle} />
      <WelcomeModal ref={welcomeOnboardingRef} />
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
      <div className="container mx-auto px-4 pt-0 pb-8 max-w-7xl" data-content-section>
                            <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-6 mb-0 md:grid md:grid-cols-3 md:overflow-visible md:pb-2 md:mb-4" data-testid="market-pulse-row">
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

              <div className="mb-6">
                <TrendingNowFeed
                  onOpenInsight={openInsightFromHotMover}
                  collapsed={trendingNowCollapsed}
                  onToggle={handleTrendingNowToggle}
                />
              </div>

              <div id="leaderboard" className="scroll-mt-24" />
              <Card className="overflow-hidden">
                <CardHeader className="relative flex flex-col gap-4 space-y-0 overflow-hidden rounded-t-xl bg-card/95 pb-4 pt-5">
                  <span className="pointer-events-none absolute left-0 right-0 top-0 h-[3px] bg-[linear-gradient(90deg,transparent_0%,rgb(59,130,246)_50%,transparent_100%)]" />
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-2xl font-serif">Leaderboard</CardTitle>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/60 flex-wrap" data-testid="text-leaderboard-freshness">
                        <TouchTooltip
                          content={<p>Full data refresh from Wikipedia, Mediastack, GDELT, and Google.</p>}
                          side="bottom"
                          className="text-xs max-w-[240px]"
                        >
                          <span className="inline-flex items-center gap-1 cursor-help">
                            <RefreshCw className="h-3 w-3 shrink-0 full-refresh-icon-shine" aria-hidden />
                            <span>Full: {systemFreshness?.fullRefreshAtFormatted || systemFreshness?.lastScoredAtFormatted || "recently"}</span>
                          </span>
                        </TouchTooltip>
                      </div>
                    </div>
                  </div>
                  
                </CardHeader>
                <div className="sticky top-16 z-30 border-b border-border/60 px-3 py-2.5 bg-card/95 backdrop-blur-md">
                  <div className="flex min-h-10 w-full items-stretch rounded-lg bg-muted/50 p-0.5" data-testid="toggle-leaderboard-tabs">
                    <button
                      onClick={() => handleTabClick("fame")}
                      className={`relative flex flex-1 items-center justify-center gap-2 whitespace-nowrap px-4 py-1.5 rounded-md text-[15px] font-medium transition-all ${
                        leaderboardTab === "fame"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground"
                      }`}
                      data-testid="tab-leaderboard-fame"
                    >
                      {leaderboardTab === "fame" && (
                        <span className="pointer-events-none absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#3C83F6]" />
                      )}
                      <Crown className={`h-[18px] w-[18px] ${leaderboardTab === "fame" ? "text-[#3C83F6]" : "text-muted-foreground/60"}`} />
                      Trending
                      {leaderboardTab === "fame" && (
                        <span className="text-[13px] text-muted-foreground/70">{sortDirection === "desc" ? "↓" : "↑"}</span>
                      )}
                    </button>
                    <button
                      onClick={() => handleTabClick("approval")}
                      className={`relative flex flex-1 items-center justify-center gap-2 whitespace-nowrap px-4 py-1.5 rounded-md text-[15px] font-medium transition-all ${
                        leaderboardTab === "approval"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground"
                      }`}
                      data-testid="tab-leaderboard-approval"
                    >
                      {leaderboardTab === "approval" && (
                        <span className="pointer-events-none absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#22D3EE]" />
                      )}
                      <Star className={`h-[18px] w-[18px] ${leaderboardTab === "approval" ? "text-[#22D3EE]" : "text-muted-foreground/60"}`} />
                      Approval
                      {leaderboardTab === "approval" && (
                        <span className="text-[13px] text-muted-foreground/70">{sortDirection === "desc" ? "↓" : "↑"}</span>
                      )}
                    </button>
                  </div>
                </div>
                <CardContent className="p-0">
                  <div className="pl-3 pr-4 sm:pr-6 py-4 border-b bg-muted/30">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <FilterDropdown
                          value={category}
                          onChange={setCategory}
                          categories={leaderboardFilterCategories}
                        />
                        <div className="flex-1 min-w-0">
                          <SearchBar 
                            onSearch={setSearchQuery} 
                            placeholder="Search..."
                          />
                        </div>
                        <TouchTooltip
                          content={leaderboardTab === "fame" ? <TrendScoreInfoContent /> : <ApprovalRatingInfoContent />}
                          side="bottom"
                          align="end"
                          contentClassName="max-w-[280px]"
                          showCloseButton
                        >
                          <Info
                            className={`h-4 w-4 cursor-help shrink-0 transition-colors ${leaderboardTab === "fame" ? "text-[#3C83F6]/70" : "text-[#22D3EE]/70"}`}
                            data-testid="icon-leaderboard-info"
                          />
                        </TouchTooltip>
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
                  {leaderboardTab === "fame" && (
                    <div className="px-4 sm:px-6 py-2.5 border-b bg-muted/20 flex items-center justify-end lg:hidden">
                      <TouchTooltip
                        content="Predict whether each celebrity's Trend Score will go Up or Down this week."
                        side="bottom"
                        className="text-xs max-w-[220px]"
                      >
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground cursor-help">Predict</span>
                      </TouchTooltip>
                    </div>
                  )}
                  {leaderboardTab === "approval" && (
                    <div className="px-4 sm:px-6 py-2.5 border-b border-t bg-muted/20 flex items-center sm:hidden">
                      <button
                        type="button"
                        onClick={() => setApprovalShowResults(v => !v)}
                        className="ml-auto text-[11px] font-medium uppercase tracking-wider text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 transition-colors"
                      >
                        {approvalShowResults ? "Rate" : "View Results"}
                      </button>
                    </div>
                  )}
                  {displayPeople.length > 0 && (
                    <div className="hidden lg:flex items-center gap-6 lg:gap-5 px-4 py-2 border-b text-[11px] font-medium uppercase tracking-wider text-muted-foreground" data-testid="leaderboard-column-header">
                      <div className="flex-1" />
                      {leaderboardTab === "fame" ? (
                        <>
                          <div className="text-right w-[120px] lg:w-[140px] shrink-0 flex items-center justify-end gap-1">Trend Score <TrendScoreInfoIcon testId="icon-trend-score-header" className="h-3 w-3 text-muted-foreground/40 cursor-help" /></div>
                          <div className="text-right w-[72px] lg:w-[80px] shrink-0">24h</div>
                          <div className="text-right w-[72px] lg:w-[84px] shrink-0 flex items-center justify-end gap-1">Approval <ApprovalRatingInfoIcon testId="icon-approval-header-fame" className="h-3 w-3 text-muted-foreground/40 cursor-help" /></div>
                        </>
                      ) : (
                        <>
                          <div className="text-right w-[120px] shrink-0 flex items-center justify-end gap-1">Approval <ApprovalRatingInfoIcon testId="icon-approval-header" className="h-3 w-3 text-muted-foreground/40 cursor-help" /></div>
                          <div className="text-right w-[120px] shrink-0 flex items-center justify-end gap-1">Trend Score <TrendScoreInfoIcon testId="icon-trend-score-header-approval" className="h-3 w-3 text-muted-foreground/40 cursor-help" /></div>
                        </>
                      )}
                      <div className={`${leaderboardTab === "fame" ? "w-[88px]" : "w-[72px]"} shrink-0 text-right`}>
                        {leaderboardTab === "fame" ? (
                          <TouchTooltip
                            content="Predict whether each celebrity's Trend Score will go Up or Down this week."
                            side="bottom"
                            className="text-xs max-w-[220px]"
                          >
                            <span className="cursor-help">Predict</span>
                          </TouchTooltip>
                        ) : ""}
                      </div>
                    </div>
                  )}
                  <motion.div
                    {...(isMobile
                      ? {
                          drag: "x" as const,
                          dragConstraints: { left: 0, right: 0 },
                          dragElastic: 0.15,
                          onDragEnd: (_: unknown, info: PanInfo) => {
                            const SWIPE_THRESHOLD = 60;
                            if (info.offset.x < -SWIPE_THRESHOLD && leaderboardTab === "fame") {
                              setLeaderboardTab("approval");
                              setSortDirection("desc");
                              hapticSuccess();
                            } else if (info.offset.x > SWIPE_THRESHOLD && leaderboardTab === "approval") {
                              setLeaderboardTab("fame");
                              setSortDirection("desc");
                              hapticSuccess();
                            }
                          },
                        }
                      : {})}
                  >
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
                        onOpenInsight={() => openInsightFromTrendingPerson(person)}
                        onVoteClick={() => handleVoteClick(person.id)}
                        onPredictUp={() => handleLeaderboardPredict(person.id, "up")}
                        onPredictDown={() => handleLeaderboardPredict(person.id, "down")}
                        predictionsDisabled={isUpdownCutoffPassed}
                        predictionsClosedMessage={leaderboardClosedMessage}
                        approvalShowResults={approvalShowResults}
                      />
                    ))}
                  </motion.div>
                  
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
      <AnimatePresence>
        {trendOverlayOpen && (
          <TrendGraphOverlay 
            open={trendOverlayOpen} 
            onClose={() => setTrendOverlayOpen(false)}
            allPeople={allPeople}
          />
        )}
      </AnimatePresence>
      {isMobile ? (
        <Drawer open={!!selectedInsightPerson} onOpenChange={(open) => { if (!open) handleCloseInsightPanel(); }}>
          <DrawerContent>
            {selectedInsightPerson && (
              <>
                <DrawerHeader className="text-left">
                  <DrawerTitle className="text-lg">24h Rank Movement</DrawerTitle>
                </DrawerHeader>
                <div className="px-4 pb-2">
                  <InsightPanelContent
                    person={selectedInsightPerson}
                    loading={selectedInsightMomentumLoading}
                    error={selectedInsightMomentumError}
                    growthSignals={insightGrowthSignals}
                    coolingSignals={insightCoolingSignals}
                    onClose={handleCloseInsightPanel}
                    onViewProfile={handleViewInsightProfile}
                  />
                </div>
              </>
            )}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={!!selectedInsightPerson} onOpenChange={(open) => { if (!open) handleCloseInsightPanel(); }}>
          <DialogContent className="sm:max-w-md">
            {selectedInsightPerson && (
              <>
                <DialogHeader>
                  <DialogTitle>24h Rank Movement</DialogTitle>
                </DialogHeader>
                <InsightPanelContent
                  person={selectedInsightPerson}
                  loading={selectedInsightMomentumLoading}
                  error={selectedInsightMomentumError}
                  growthSignals={insightGrowthSignals}
                  coolingSignals={insightCoolingSignals}
                  onClose={handleCloseInsightPanel}
                  onViewProfile={handleViewInsightProfile}
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
      <VotingModal
        open={votingModalOpen}
        onOpenChange={setVotingModalOpen}
        initialPersonId={votingPersonId}
        peopleList={allPeople}
      />
      <StakeModal
        open={stakeModalOpen}
        onClose={() => {
          setStakeModalOpen(false);
          setPendingSelection(null);
        }}
        selection={pendingSelection}
        onConfirm={handleConfirmStake}
        walletBalance={walletCredits}
        onDirectionChange={(dir) => {
          if (!pendingSelection || pendingSelection.type !== "updown") return;
          const market = updownMarkets.find(m => m.id === pendingSelection.marketId);
          if (!market) return;
          const crowdSentiment = dir === "up" ? market.upPoolPercent : (100 - market.upPoolPercent);
          const estimatedPayout = dir === "up" ? market.upMultiplier : market.downMultiplier;
          setPendingSelection({
            type: "updown",
            choice: dir === "up" ? "Trend Score UP" : "Trend Score DOWN",
            marketName: market.personName,
            marketId: market.id,
            entryId: dir === "up" ? market.upEntryId : market.downEntryId,
            startScore: market.startScore,
            currentScore: market.currentScore,
            crowdSentiment,
            estimatedPayout,
            baselineScore: market.baselineScore,
            baselineTimestamp: market.startAt || undefined,
            tieRule: market.tieRule,
            endAt: market.endAt || undefined,
            bettingCutoff: market.bettingCutoff,
          });
        }}
      />
    </div>
  );
}
