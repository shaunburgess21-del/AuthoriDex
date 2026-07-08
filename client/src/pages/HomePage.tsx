import { VoxDexPulse } from "@/components/VoxDexPulse";
import { WelcomeModal } from "@/components/WelcomeModal";
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
import { TrendingNowFeed, type HotMover } from "@/components/TrendingNowFeed";
import { TrendScoreLaunchpad } from "@/components/TrendScoreActionDrawer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useHotMoverIds } from "@/hooks/useHotMoverIds";
import { useDeferredReady } from "@/hooks/useDeferredReady";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
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
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { useQuery, useQueries, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { TrendingPerson } from "@shared/schema";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation, Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getMarketCategoryLabel, normalizeMarketCategory, CANONICAL_CATEGORIES } from "@shared/constants";

type HomeView = "leaderboard" | "predict" | "vote";
const CATEGORY_OPTIONS: string[] = ["All", ...CANONICAL_CATEGORIES.map((c) => c.label)];

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
      className={`min-w-[280px] md:min-w-0 shrink-0 md:shrink h-full rounded-xl ${cardClass} transition-all duration-200`}
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
          );
        })()}
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

// InsightPerson, the momentum/why-trending UI, and the snapshot modal shell
// now live in @/components/PersonInsightModal (shared with the Insights
// "Movers" card). HomePage just builds an InsightPerson and renders the modal.

type SortDirection = "desc" | "asc";

export default function HomePage() {
  useDocumentMeta({
    title: "VoxDex | Vox Populi - Indexed",
    description:
      "VoxDex turns the voice of the people into a living, real-time index. Vote, predict, and weigh in on the figures and topics shaping global conversation. — make your voice heard, one vote at a time.",
  });

  const [searchQuery, setSearchQuery] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("search") ?? "";
  });
  const [category, setCategory] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("category");
    if (!raw) return "all";
    const lowered = raw.toLowerCase();
    if (lowered === "trending") return "all";
    if (lowered === "all" || lowered === "favorites") return lowered;
    return normalizeMarketCategory(raw);
  });
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const leaderboardCategories = useLeaderboardCategories();
  const categoryRegistry = useCategoryRegistry();

  useEffect(() => {
    if (window.location.hash === "#leaderboard") {
      requestAnimationFrame(() => {
        document.getElementById("leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);
  const [activeView, setActiveView] = useState<HomeView>("leaderboard");
  const [trendOverlayOpen, setTrendOverlayOpen] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("sortDir") === "asc" ? "asc" : "desc";
  });
  const [votingModalOpen, setVotingModalOpen] = useState(false);
  const [votingPersonId, setVotingPersonId] = useState<string | null>(null);
  const [voteLeaderboardInfoOpen, setVoteLeaderboardInfoOpen] = useState(false);
  const [trendScoreLaunchpadOpen, setTrendScoreLaunchpadOpen] = useState(false);
  const [moversCollapsed, setMoversCollapsed] = useState(true);
  const welcomeOnboardingRef = useRef<OnboardingDrawerHandle>(null);
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
    queryKey: ['/api/leaderboard', searchQuery, category, 'fame', sortDirection],
    queryFn: async ({ pageParam = 0 }) => {
      const queryParams = new URLSearchParams();
      if (searchQuery) queryParams.set('search', searchQuery);
      if (category !== 'all') queryParams.set('category', category);
      queryParams.set('limit', String(PAGE_SIZE));
      queryParams.set('offset', String(pageParam));
      queryParams.set('tab', 'fame');
      queryParams.set('sortDir', sortDirection);

      const authHeaders = await getAuthHeaders();
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

  const openInsightFromHotMover = (person: HotMover) => {
    setSelectedInsightPerson({
      id: person.id,
      name: person.name,
      avatar: person.avatar,
      category: person.category,
      rank: person.rank ?? null,
      change24h: person.change24h ?? null,
      rankChange: person.rankChange ?? null,
      hotMover: true,
    });
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
  const leaderboardFilterCategories = useMemo(() => {
    const pinned = [
      { value: "all", label: "All Categories" },
      { value: "favorites", label: "Favorites" },
    ];
    const dynamic = Array.from(leaderboardCategories ?? [])
      .filter((id) => id && id !== "all" && id !== "favorites" && id !== "trending")
      .sort((a, b) => resolveCategoryLabel(a).localeCompare(resolveCategoryLabel(b)))
      .map((id) => ({ value: id, label: resolveCategoryLabel(id) }));
    if (category !== "all" && category !== "favorites" && category !== "trending" && !dynamic.some((c) => c.value === category)) {
      dynamic.unshift({ value: category, label: resolveCategoryLabel(category) });
    }
    return [...pinned, ...dynamic];
  }, [leaderboardCategories, category, resolveCategoryLabel]);

  const activeCategoryLabel = useMemo(() => {
    if (category === "all") return "All Categories";
    if (category === "favorites") return "Favorites";
    if (category === "trending") return "Trending";
    return resolveCategoryLabel(category);
  }, [category, resolveCategoryLabel]);

  if (showLeaderboardInitialLoader) {
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
      <SiteHeader
        active="home"
        backButton="none"
        onHomeClick={() => {
          setActiveView("leaderboard");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
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
      <div className="container mx-auto px-2 sm:px-4 pt-0 pb-8 max-w-7xl" data-content-section>
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
              <Card className="overflow-visible">
                <div className="relative isolate overflow-hidden rounded-t-xl">
                  {/* Same accent as .pulse-card-voxdex::before: 3px top bar only; overflow clips rounded-corner lip */}
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] bg-[linear-gradient(90deg,transparent_0%,rgb(59,130,246)_50%,transparent_100%)]"
                    aria-hidden
                  />
                  <CardHeader className="relative z-[2] flex flex-col gap-4 space-y-0 bg-card/95 pb-4 pt-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-2xl font-serif">Leaderboard</CardTitle>
                          </div>
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
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 shrink-0"
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
                          <span className="hidden sm:inline">Share</span>
                        </Button>
                      </div>
                    </CardHeader>
                </div>
                <div
                  className="sticky top-16 z-30 border-b border-border/60 bg-card/95 backdrop-blur-md"
                  data-testid="leaderboard-sticky-toolbar"
                >
                  <div className="pl-2 pr-2 sm:pl-3 sm:pr-6 py-4 bg-muted/30">
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
                        {displayPeople.length > 0 && (
                          <div className="md:hidden shrink-0 min-w-[4.5rem] max-w-[6.5rem] flex justify-end">
                            <TrendScoreHeaderLabel onOpen={() => setTrendScoreLaunchpadOpen(true)} />
                          </div>
                        )}
                        {displayPeople.length > 0 && (
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
                <CardContent className="p-0">
                  <div>
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
                    {displayPeople.map((person) => (
                      <LeaderboardRow
                        key={person.id}
                        person={person}
                        activeTab="fame"
                        isHotMover={hotMoverIds.has(person.id)}
                        onOpenInsight={() => openInsightFromTrendingPerson(person)}
                        onVoteClick={() => {
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
                    <div className="p-4 border-t text-center text-muted-foreground text-sm space-y-2">
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
                </CardContent>
              </Card>
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
        onOpenChange={setVotingModalOpen}
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