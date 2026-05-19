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
import { CategoryPill, getCategoryTextColor, getCategoryStyle } from "@/components/CategoryPill";
import { VoteDeckView } from "@/components/home/VoteDeckView";
import { PredictDeckView } from "@/components/home/PredictDeckView";
import { TrendingNowFeed, type HotMover } from "@/components/TrendingNowFeed";
import { TrendScoreInfoContent } from "@/components/TrendScoreInfo";
import { ApprovalRatingInfoContent } from "@/components/ApprovalRatingInfo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { tooltipSurfaceClass } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverAnchor, PopoverContent, PopoverClose } from "@/components/ui/popover";
import { useFavorites } from "@/hooks/useFavorites";
import { navigateToLogin } from "@/lib/authReturn";
import type { LucideIcon } from "lucide-react";
import {
  X,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronRight,
  ChevronDown,
  LineChart,
  Vote,
  Trophy,
  Users,
  Sparkles,
  Target,
  Check,
  ThumbsDown,
  Minus,
  Star,
  Info,
  Crown,
  HelpCircle,
  Scale,
  Swords,
  BarChart3,
  MessageSquare,
  UserPlus,
  ImageIcon,
  Loader2,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { useQuery, useQueries, useInfiniteQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders, parseApiError, queryClient } from "@/lib/queryClient";
import { useIdempotencyKey } from "@/lib/useIdempotencyKey";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { hapticSuccess, hapticError } from "@/lib/haptic";
import { useXpBurst } from "@/components/XpBurstProvider";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { getMarketBaselineScore, type MarketBaselineSource } from "@/lib/predict-market-baseline";
import { fireAmmTradeToast } from "@/lib/share-data";
import { useShareCard } from "@/contexts/ShareCardContext";
import { TrendingPerson } from "@shared/schema";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation, Link } from "wouter";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { VOTE_HUB_DEEP_LINKS, type VoteHubSectionToggle } from "@/lib/voteHubDeepLinks";

type HomeView = "leaderboard" | "predict" | "vote";
const CATEGORY_OPTIONS = ["All", "Tech", "Business", "Politics", "Sports", "Music", "Film & TV", "Gaming", "Creator", "Food & Drink", "Lifestyle"] as const;

const LEADERBOARD_PREDICT_MORE_LINKS = [
  { label: "World Markets", href: "/predict#community", icon: Scale },
  { label: "Weekly Jackpot", href: "/predict#jackpot", icon: Crown },
  { label: "Head-to-Head Battles", href: "/predict#h2h", icon: Swords },
  { label: "Category races", href: "/predict#race", icon: BarChart3 },
] as const satisfies ReadonlyArray<{ label: string; href: string; icon: LucideIcon }>;

const VOTE_HUB_LINK_ICONS: Record<VoteHubSectionToggle, LucideIcon> = {
  "Sentiment Polls": MessageSquare,
  Matchups: Swords,
  "Opinion Polls": Vote,
  "Underrated/Overrated": BarChart3,
  "Induction Queue": UserPlus,
  "Curate Profile": ImageIcon,
};

function LeaderboardDrawerNavList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/40">
      {children}
    </div>
  );
}

function LeaderboardDrawerNavLink({
  href,
  label,
  icon: Icon,
  accent,
  onNavigateLink,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  accent: "vote" | "predict";
  onNavigateLink: () => void;
}) {
  const iconTint =
    accent === "vote"
      ? "text-cyan-600 dark:text-cyan-400"
      : "text-violet-600 dark:text-violet-400";
  return (
    <Link
      href={href}
      onClick={() => onNavigateLink()}
      className="flex min-h-10 items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40" aria-hidden>
          <Icon className={cn("h-4 w-4", iconTint)} aria-hidden />
        </span>
        <span className="truncate text-sm font-medium">{label}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
    </Link>
  );
}

/** Short copy for the home leaderboard drawer only (~65% fewer words than full rules). */
function LeaderboardUpDownSnapshot() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <HelpCircle className="h-5 w-5 shrink-0 text-violet-500" aria-hidden />
        <h3 className="text-sm font-semibold">How Up/Down Works</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Each Monday we snapshot every celebrity's Trend Score — that's their{" "}
        <span className="font-medium text-foreground">baseline</span> for the week. Buy{" "}
        <span className="font-medium text-foreground">UP</span> shares if you think their score will close higher by Sunday,{" "}
        <span className="font-medium text-foreground">DOWN</span> shares if lower. Exact tie refunds everyone.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Each winning share pays{" "}
        <span className="font-medium text-foreground">1 credit</span> at close. Cheaper shares pay multiples if your side wins — and you can sell anytime before close to lock in profits.
      </p>
    </div>
  );
}

/** Short copy for the Approval leaderboard drawer (Rate / aggregate approval). */
function LeaderboardApprovalSnapshot() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Star className="h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
        <h3 className="text-sm font-semibold">Approval rating</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        The <span className="font-medium text-foreground">Approval</span> score on each row is an aggregate from the community (shown out of 5).
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Use <span className="font-medium text-foreground">Rate</span> on a row to cast your own 1–5 vote—it feeds into that person&apos;s approval rating.
      </p>
    </div>
  );
}

function LeaderboardVoteInfoBody({ onNavigateLink }: { onNavigateLink: () => void }) {
  return (
    <>
      <LeaderboardApprovalSnapshot />
      <div className="mt-6 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">More on Vote</p>
        <LeaderboardDrawerNavList>
          {VOTE_HUB_DEEP_LINKS.map(({ label, href, sectionToggle }) => (
            <LeaderboardDrawerNavLink
              key={href}
              href={href}
              label={label}
              icon={VOTE_HUB_LINK_ICONS[sectionToggle]}
              accent="vote"
              onNavigateLink={onNavigateLink}
            />
          ))}
        </LeaderboardDrawerNavList>
      </div>
    </>
  );
}

function LeaderboardPredictInfoBody({ onNavigateLink }: { onNavigateLink: () => void }) {
  return (
    <>
      <LeaderboardUpDownSnapshot />
      <div className="mt-6 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">More on Predict</p>
        <LeaderboardDrawerNavList>
          {LEADERBOARD_PREDICT_MORE_LINKS.map(({ label, href, icon }) => (
            <LeaderboardDrawerNavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              accent="predict"
              onNavigateLink={onNavigateLink}
            />
          ))}
        </LeaderboardDrawerNavList>
      </div>
    </>
  );
}

// Detects pointer:coarse devices (touchscreens/phones/tablets). Drives the
// dual-mode behaviour of the leaderboard toggle tooltips: hover-to-open on
// fine-pointer (desktop mouse/trackpad), tap-active-toggle-to-open on
// coarse. SSR-safe: defaults to false so server renders the hover variant.
function useIsCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(pointer: coarse)");
    const update = () => setIsCoarse(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isCoarse;
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
  hotMover: boolean;
}

interface InsightWhyTrendingData {
  hasContext: boolean;
  summary?: string;
}

interface PersonMomentumResponse {
  signals?: {
    news?: { deltaPct?: number };
    wiki?: { deltaPct?: number };
    momentum?: { deltaPct?: number };
    wikiMomentum?: { deltaPct?: number };
    trends?: { deltaPct?: number };
  };
  categoryRank?: {
    overall?: number | null;
    category?: string | null;
    categoryRank?: number | null;
  } | null;
}

// Chip labels (May 2026): "Momentum" renamed to "News Momentum" for
// symmetry with "Wiki Momentum". "Google Trends" added as a fifth signal
// once the SerpApi integration landed.
interface InsightSignal {
  label: "Wiki" | "News" | "News Momentum" | "Wiki Momentum" | "Google Trends";
  deltaPct: number;
}

function InsightPanelContent({
  person,
  loading,
  error,
  growthSignals,
  coolingSignals,
  categoryRank,
  onClose,
  onViewProfile,
}: {
  person: InsightPerson;
  loading: boolean;
  error: boolean;
  growthSignals: InsightSignal[];
  coolingSignals: InsightSignal[];
  categoryRank: number | null;
  onClose: () => void;
  onViewProfile: () => void;
}) {
  const formatPct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1).replace(/\.0$/, "")}%`;
  const currentRank = typeof person.rank === "number" ? person.rank : null;
  const previousRank = currentRank != null && typeof person.rankChange === "number"
    ? currentRank + person.rankChange
    : null;
  const showRankShift = currentRank != null && previousRank != null;
  const rankChange = person.rankChange ?? 0;

  const [, setLocation] = useLocation();
  const { session } = useAuth();
  const { isFavorite, isAuthenticated } = useFavorites();
  const favorited = isFavorite(person.id);
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  const handleToggleFavorite = async () => {
    if (!isAuthenticated || !session?.access_token) return;
    setFavoriteLoading(true);
    try {
      const method = favorited ? "DELETE" : "POST";
      const res = await fetch(`/api/me/favorites/${person.id}`, {
        method,
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        ...(method === "POST" ? {
          body: JSON.stringify({
            personName: person.name,
            personAvatar: person.avatar,
            personCategory: person.category,
          }),
        } : {}),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/me/favorites"] });
      toast(favorited ? "Removed from favorites" : "Added to favorites", {
        description: favorited
          ? `${person.name} has been removed from your favorites`
          : `${person.name} has been added to your favorites`,
      });
    } catch (err) {
      console.error("Error toggling favorite:", err);
      toast.error("Error", { description: "Failed to update favorite status" });
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleSignInFromTooltip = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigateToLogin(setLocation);
  };

  const favoriteButton = (
    <button
      type="button"
      onClick={handleToggleFavorite}
      disabled={!isAuthenticated || favoriteLoading}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
      data-testid="button-insight-favorite"
      className={`shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
        isAuthenticated
          ? "hover:bg-muted text-muted-foreground hover:text-foreground"
          : "text-muted-foreground/60 cursor-not-allowed"
      } ${favorited ? "text-yellow-500 hover:text-yellow-500" : ""}`}
    >
      <Star className={`h-5 w-5 ${favorited ? "fill-yellow-500" : ""}`} />
    </button>
  );

  const categoryStyle = person.category ? getCategoryStyle(person.category) : null;

  return (
    <div className="space-y-3 sm:space-y-4 sm:pt-2">
      <div className="flex items-center gap-3 px-3 py-2 sm:p-3 sm:pr-8 rounded-lg bg-muted/40 border border-border/50">
        <button
          type="button"
          onClick={onViewProfile}
          aria-label={`View ${person.name}'s profile`}
          className="shrink-0 rounded-full transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="button-insight-avatar"
        >
          <PersonAvatar
            name={person.name}
            avatar={person.avatar}
            size="lg"
            className="h-16 w-16 sm:h-20 sm:w-20"
          />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onViewProfile}
            className="block max-w-full text-left font-semibold text-xl sm:text-2xl leading-tight truncate hover:underline focus:outline-none focus:underline cursor-pointer"
            data-testid="button-insight-name"
          >
            {person.name}
          </button>
          {person.category && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className={`text-base ${getCategoryTextColor(person.category)}`}>{person.category}</span>
              {categoryRank != null && categoryRank > 0 && categoryStyle && (
                <span
                  data-vaul-no-drag
                  onPointerDown={(e) => e.stopPropagation()}
                  className="inline-flex"
                >
                  <TouchTooltip
                    content={(
                      <div className="space-y-1.5 normal-case tracking-normal">
                        <p className="font-semibold text-sm">{person.category} Rank</p>
                        <p className="text-xs text-muted-foreground">
                          {person.name}'s position within the {person.category} category, ranked against others in the same field.
                        </p>
                      </div>
                    )}
                    side="bottom"
                    align="start"
                    contentClassName="max-w-[240px]"
                    showCloseButton
                  >
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold cursor-help ${categoryStyle.bg} border ${categoryStyle.border} ${categoryStyle.text}`}
                      data-testid="text-insight-category-rank"
                    >
                      <Trophy className="h-3 w-3" />
                      #{categoryRank}
                    </span>
                  </TouchTooltip>
                </span>
              )}
            </div>
          )}
        </div>
        {isAuthenticated ? (
          favoriteButton
        ) : (
          <span
            data-vaul-no-drag
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex shrink-0"
          >
            <TouchTooltip
              content={(
                <span>
                  Sign in to favorite —{" "}
                  <button
                    type="button"
                    onClick={handleSignInFromTooltip}
                    className="underline text-primary hover:text-primary/80"
                  >
                    click here to sign in
                  </button>
                </span>
              )}
              side="left"
            >
              {favoriteButton}
            </TouchTooltip>
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">24H RANK MOVEMENT</p>
        {showRankShift ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm font-medium">
              Was #{previousRank} {"\u2192"} Now #{currentRank}
            </p>
            <div className="flex items-center gap-1.5">
              {typeof person.change24h === "number" && person.change24h !== 0 && (
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium tabular-nums ${
                  person.change24h > 0
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-red-500/15 text-red-600 dark:text-red-400"
                }`}>
                  {person.change24h > 0 ? "+" : ""}
                  {person.change24h.toFixed(1)}%
                </span>
              )}
              {rankChange === 0 ? (
                <span className="text-xs text-muted-foreground italic">No rank change</span>
              ) : (
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-semibold ${
                  rankChange > 0
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-red-500/15 text-red-600 dark:text-red-400"
                }`}>
                  {rankChange > 0 ? "+" : ""}
                  {rankChange} rank
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Rank movement unavailable</p>
        )}
      </div>

      <InsightWhyTrendingSnippet
        personId={person.id}
        hotMover={person.hotMover}
        onReadMore={() => {
          setLocation(`/person/${person.id}?scroll=why-trending`);
          onClose();
        }}
      />

      {loading ? (
        <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60">
          <p className="text-sm text-muted-foreground">Loading signal insights...</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60">
          <p className="text-sm text-muted-foreground">Unable to load signal insights right now</p>
        </div>
      ) : (
        <>
          {growthSignals.length > 0 && (
            <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60">
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
            <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60">
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
        <div className="flex flex-row gap-2 sm:contents">
          <Button
            variant="outline"
            onClick={() => {
              setLocation(`/person/${person.id}?tab=vote`);
              onClose();
            }}
            className="flex-1 sm:flex-initial bg-cyan-500/25 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/50 dark:border-cyan-400/40 shadow-sm shadow-cyan-500/30 dark:shadow-cyan-500/20 hover:bg-cyan-500/35 dark:hover:bg-cyan-500/30 hover:text-cyan-600 dark:hover:text-cyan-400"
            data-testid="button-insight-vote"
          >
            Vote
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setLocation(`/person/${person.id}?tab=predict`);
              onClose();
            }}
            className="flex-1 sm:flex-initial bg-violet-500/25 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 border border-violet-500/50 dark:border-violet-400/40 shadow-sm shadow-violet-500/30 dark:shadow-violet-500/20 hover:bg-violet-500/35 dark:hover:bg-violet-500/30 hover:text-violet-600 dark:hover:text-violet-400"
            data-testid="button-insight-predict"
          >
            Predict
          </Button>
        </div>
        <Button onClick={onViewProfile}>
          View full profile
        </Button>
      </div>
    </div>
  );
}

function InsightWhyTrendingSnippet({
  personId,
  hotMover,
  onReadMore,
}: {
  personId: string;
  hotMover: boolean;
  onReadMore: () => void;
}) {
  const url = hotMover
    ? `/api/why-trending/${personId}?hotMover=true`
    : `/api/why-trending/${personId}`;
  const queryKey = ["/api/why-trending", personId, hotMover ? "hot" : "default"];
  const { data, isLoading, isError } = useQuery<InsightWhyTrendingData>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    retry: 1,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60 space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">WHY THEY'RE TRENDING</p>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }

  if (isError || !data?.hasContext || !data.summary) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border/60 px-3 py-2 sm:p-3 bg-background/60">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">WHY THEY'RE TRENDING</p>
      <p className="text-xs leading-snug text-muted-foreground line-clamp-3" data-testid="text-insight-why-trending">
        {data.summary}
      </p>
      <div className="flex justify-end mt-1.5">
        <button
          type="button"
          onClick={onReadMore}
          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          data-testid="button-insight-why-trending-read-more"
        >
          Read more {"\u2192"}
        </button>
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
  const [votingModalOpen, setVotingModalOpen] = useState(false);
  const [votingPersonId, setVotingPersonId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<HomeView>("leaderboard");
  const [trendOverlayOpen, setTrendOverlayOpen] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState<LeaderboardTab>("fame");
  const [predictLeaderboardInfoOpen, setPredictLeaderboardInfoOpen] = useState(false);
  const [voteLeaderboardInfoOpen, setVoteLeaderboardInfoOpen] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [moversCollapsed, setMoversCollapsed] = useState(true);
  const welcomeOnboardingRef = useRef<OnboardingDrawerHandle>(null);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);
  /**
   * Sprint 5 / Phase 1.3: parity with PredictPage. The home leaderboard
   * doesn't yet surface a "Sell" affordance directly, but the StakeModal
   * itself toggles between Buy/Sell and we want the same `initialAmmMode`
   * default so behaviour is identical regardless of which page launched
   * the modal.
   */
  const [modalIntent, setModalIntent] = useState<"buy" | "sell">("buy");
  // Idempotency key for the active trade-modal intent. See
  // `client/src/lib/useIdempotencyKey.ts` for the contract.
  const tradeIdempotencyKey = useIdempotencyKey(stakeModalOpen, [
    pendingSelection?.marketId,
    pendingSelection?.entryId,
    modalIntent,
  ]);
  // Real wallet balance from the auth profile — was previously a
  // hardcoded `useState(10000)`, which let users on the home
  // leaderboard appear to stake credits they didn't have. The
  // PredictPage / UpDownDetailPage modals already read from
  // profile.predictCredits; the home leaderboard's predict column
  // now mirrors that single source of truth so balance + post-bet
  // validation behave identically.
  const { user, profile, refreshProfile } = useAuth();
  // Sprint 3.1: home leaderboard buys fire AMM trade toasts with a
  // Share action that dispatches into the global ShareCard modal.
  const { openShareCard } = useShareCard();
  const { trigger: triggerXpBurst } = useXpBurst();
  const walletCredits = profile?.predictCredits ?? 0;

  const { data: nativeUpdownData } = useQuery<any[]>({
    queryKey: ['/api/native-markets/updown'],
  });

  // Same-side / opposite-side rule for the leaderboard predict column.
  // We need each user's existing pick (if any) on the active weekly
  // market for each person so we can:
  //   1) visually grey the opposite-side button (hedges blocked), and
  //   2) treat re-clicking the picked side as a same-side top-up.
  // The leaderboard already polls /api/native-markets/updown; pairing
  // it with /api/me/predictions gives us everything per row.
  const { data: userPredictionsData } = useQuery<any>({
    queryKey: ["/api/me/predictions"],
    enabled: !!user,
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
        personAvatar: (person.imageUrl as string | null) ?? null,
        currentScore,
        startScore: baselineScore,
        baselineScore,
        upEntryId: upEntry?.id as string | undefined,
        downEntryId: downEntry?.id as string | undefined,
        upPoolPercent: upPercent || 50,
        bettingCutoff: (m.bettingCutoff as string) || null,
        startAt: (m.startAt as string) || null,
        endAt: (m.endAt as string) || null,
        engine: "amm" as const,
        ammState: (m as { ammState?: unknown }).ammState ?? null,
        category: (m.category as string | null) ?? null,
      };
    });
  }, [nativeUpdownData]);

  // Per-personId pending pick + cumulative stake on that side. Maps
  // any leaderboard row's `personId` to the user's open up/down ticket
  // so the row can render guarded buttons + the parent's predict
  // handler can branch into same-side top-up mode.
  const userUpdownPickByPerson = useMemo(() => {
    const map = new Map<
      string,
      { pick: "up" | "down"; stakeAmount: number; marketId: string }
    >();
    if (!userPredictionsData || updownMarkets.length === 0) return map;
    const betsArray = Array.isArray(userPredictionsData)
      ? userPredictionsData
      : (userPredictionsData as any)?.predictions ?? [];
    const personByMarket = new Map<string, string>();
    for (const m of updownMarkets) {
      if (m.id && m.personId) personByMarket.set(String(m.id), String(m.personId));
    }
    for (const bet of betsArray as any[]) {
      const personId = personByMarket.get(String(bet.marketId));
      if (!personId) continue;
      if (bet.result && bet.result !== "pending") continue;
      const label = (bet.entryLabel || "").toLowerCase();
      const pick: "up" | "down" | null =
        label === "up" ? "up" : label === "down" ? "down" : null;
      if (!pick) continue;
      const prev = map.get(personId);
      if (prev) {
        prev.stakeAmount += Number(bet.stakeAmount || 0);
      } else {
        map.set(personId, {
          pick,
          stakeAmount: Number(bet.stakeAmount || 0),
          marketId: String(bet.marketId),
        });
      }
    }
    return map;
  }, [userPredictionsData, updownMarkets]);

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
    // Same-side top-up vs opposite-side hedge. Visual greying on the
    // opposite chip is the primary deterrent (see LeaderboardRow); this
    // toast catches users who fire onClick before the disabled prop
    // settles in (e.g. profile data still loading).
    const existing = userUpdownPickByPerson.get(personId);
    if (existing && direction !== existing.pick) {
      hapticError();
      toast("Stick with your pick", {
        description: `You already picked ${existing.pick.toUpperCase()}. We don't allow switching sides — top up your existing pick instead.`,
      });
      return;
    }
    const isTopUp = !!existing;

    const crowdSentiment = direction === "up" ? market.upPoolPercent : (100 - market.upPoolPercent);
    setPendingSelection({
      type: "updown",
      choice: direction === "up" ? "Trend Score UP" : "Trend Score DOWN",
      marketName: market.personName,
      marketId: market.id,
      entryId: direction === "up" ? market.upEntryId : market.downEntryId,
      startScore: market.startScore,
      currentScore: market.currentScore,
      crowdSentiment,
      baselineScore: market.baselineScore,
      baselineTimestamp: market.startAt || undefined,
      endAt: market.endAt || undefined,
      bettingCutoff: market.bettingCutoff,
      isTopUp,
      existingStake: isTopUp ? existing.stakeAmount : undefined,
      engine: "amm",
      ammState: (market.ammState ?? null) as StakeSelection["ammState"],
    });
    refreshProfile?.().catch(() => {});
    setModalIntent("buy");
    setStakeModalOpen(true);
  }, [updownMarkets, isUpdownCutoffPassed, refreshProfile, userUpdownPickByPerson]);

  // Real updown bet path, mirroring PredictPage's nativeUpdownBetMutation
  // so the home leaderboard's predict column hits the same backend
  // endpoint with the same payload, gets the same XP burst + cache
  // invalidation + balance refresh, and shows the same error toast on
  // failure. Previously this was a fake setState that just decremented
  // a hardcoded local balance without ever calling the API.
  const nativeUpdownBetMutation = useMutation({
    mutationFn: async ({ marketId, entryId, stakeAmount }: { marketId: string; entryId: string; stakeAmount: number }) => {
      const res = await apiRequest(
        "POST",
        `/api/native-markets/updown/${marketId}/bet`,
        { entryId, stakeAmount },
        { idempotencyKey: tradeIdempotencyKey },
      );
      return res.json();
    },
    onSuccess: async (data, variables) => {
      hapticSuccess();
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      const market = updownMarkets.find(
        (m) => String(m.id) === String(variables.marketId),
      );
      if (market) {
        const choice =
          variables.entryId === market.downEntryId ? "DOWN" : "UP";
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        fireAmmTradeToast({
          response: data,
          actionType: "buy",
          username: profile?.username || "you",
          personName: market.personName ?? null,
          personAvatar: market.personAvatar ?? null,
          marketTitle: `${market.personName}: Up or Down?`,
          category: market.category,
          entryLabel: choice,
          direction: choice === "DOWN" ? "down" : "up",
          openShareCard,
          fallbackShareUrl: `${origin}/predict/updown/${market.id}`,
        });
      } else {
        toast("Prediction placed!", {
          description: "Your weekly up/down prediction has been recorded.",
        });
      }
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
      const { title, description } = parseApiError(err, "Failed to place prediction");
      toast.error(title, { description });
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

  /**
   * Sprint 5 / Phase 1.3: AMM sell support for the home leaderboard
   * StakeModal. Without this `StakeModal.canSellAmm` is false and the
   * Sell tab silently disappears even when the user is in an AMM
   * position. Home leaderboard only opens Up/Down markets today, so
   * we keep the wiring narrow rather than reaching for the multi-type
   * dispatch that PredictPage uses.
   */
  const homeAmmSellMutation = useMutation({
    mutationFn: async ({ marketId, entryId, shares }: { marketId: string; entryId: string; shares: number }) => {
      const res = await apiRequest(
        "POST",
        `/api/native-markets/${marketId}/bet`,
        {
          entryId,
          actionType: "sell",
          shares,
        },
        { idempotencyKey: tradeIdempotencyKey },
      );
      return res.json();
    },
    onSuccess: async (data: any) => {
      hapticSuccess();
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      const proceeds = Math.round(Number(data?.proceeds ?? 0));
      toast("Position sold", {
        description:
          proceeds > 0
            ? `Proceeds credited: +${proceeds.toLocaleString("en-US")} cr`
            : "Proceeds have been credited to your wallet.",
      });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/updown"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/amm-positions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: (err: Error) => {
      hapticError();
      const { title, description } = parseApiError(err, "Failed to sell position");
      toast.error(title, { description });
    },
  });

  const handleConfirmAmmSell = useCallback(async (shares: number) => {
    if (!pendingSelection?.marketId || !pendingSelection.entryId) {
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }
    await homeAmmSellMutation.mutateAsync({
      marketId: String(pendingSelection.marketId),
      entryId: String(pendingSelection.entryId),
      shares,
    });
  }, [pendingSelection, homeAmmSellMutation]);

  /**
   * Live AMM state for the currently-open selection. Without this the
   * StakeModal renders stale prices (cached on the original pick) for
   * the lifetime of the modal, so a fast-moving market visibly drifts
   * away from the % shown in the buy panel. Mirrors PredictPage.
   */
  const liveAmmStateForPending = useMemo(() => {
    if (!pendingSelection || pendingSelection.engine !== "amm") return null;
    const id = pendingSelection.marketId;
    const m = updownMarkets.find((entry) => String(entry?.id) === String(id));
    return (m?.ammState ?? null) as StakeSelection["ammState"] | null;
  }, [pendingSelection, updownMarkets]);
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

  // Leaderboard tab tooltips (Trending vs Approval): only the inline Info icon
  // opens the popover — never the tab pill area. Fine pointer: hover icon opens
  // with 120ms close grace into PopoverContent; pointer-down / click on icon
  // pins open (mouse-leave dismiss disabled) until X / outside click / ESC.
  // Coarse pointer: tap icon toggles. X close button is visible on both
  // platforms. useIsCoarsePointer still gates tap-vs-hover on the icon and
  // omits mouse handlers on coarse.
  const isCoarsePointer = useIsCoarsePointer();
  const [fameTooltipOpen, setFameTooltipOpen] = useState(false);
  const [approvalTooltipOpen, setApprovalTooltipOpen] = useState(false);
  const fameCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvalCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fameTooltipLeaveDismissDisabledRef = useRef(false);
  const approvalTooltipLeaveDismissDisabledRef = useRef(false);

  useEffect(() => {
    return () => {
      if (fameCloseTimerRef.current) clearTimeout(fameCloseTimerRef.current);
      if (approvalCloseTimerRef.current) clearTimeout(approvalCloseTimerRef.current);
    };
  }, []);

  const openFameTooltip = () => {
    if (fameCloseTimerRef.current) {
      clearTimeout(fameCloseTimerRef.current);
      fameCloseTimerRef.current = null;
    }
    setFameTooltipOpen(true);
  };
  const scheduleCloseFame = () => {
    if (fameCloseTimerRef.current) clearTimeout(fameCloseTimerRef.current);
    fameCloseTimerRef.current = setTimeout(() => setFameTooltipOpen(false), 120);
  };
  const openApprovalTooltip = () => {
    if (approvalCloseTimerRef.current) {
      clearTimeout(approvalCloseTimerRef.current);
      approvalCloseTimerRef.current = null;
    }
    setApprovalTooltipOpen(true);
  };
  const scheduleCloseApproval = () => {
    if (approvalCloseTimerRef.current) clearTimeout(approvalCloseTimerRef.current);
    approvalCloseTimerRef.current = setTimeout(() => setApprovalTooltipOpen(false), 120);
  };

  const handleFameTooltipOpenChange = (open: boolean) => {
    if (!open) {
      fameTooltipLeaveDismissDisabledRef.current = false;
    }
    setFameTooltipOpen(open);
  };
  const handleApprovalTooltipOpenChange = (open: boolean) => {
    if (!open) {
      approvalTooltipLeaveDismissDisabledRef.current = false;
    }
    setApprovalTooltipOpen(open);
  };

  const handleTabClick = (tab: LeaderboardTab) => {
    if (tab === leaderboardTab) {
      return;
    }
    setLeaderboardTab(tab);
    setSortDirection("desc");
    setFameTooltipOpen(false);
    setApprovalTooltipOpen(false);
    fameTooltipLeaveDismissDisabledRef.current = false;
    approvalTooltipLeaveDismissDisabledRef.current = false;
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
      hotMover: true,
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
      hotMover: false,
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

  const insightSignals = useMemo<InsightSignal[]>(() => {
    if (!selectedInsightMomentum?.signals) return [];
    return [
      { label: "Wiki" as const, deltaPct: selectedInsightMomentum.signals.wiki?.deltaPct ?? 0 },
      { label: "News" as const, deltaPct: selectedInsightMomentum.signals.news?.deltaPct ?? 0 },
      { label: "News Momentum" as const, deltaPct: selectedInsightMomentum.signals.momentum?.deltaPct ?? 0 },
      { label: "Wiki Momentum" as const, deltaPct: selectedInsightMomentum.signals.wikiMomentum?.deltaPct ?? 0 },
      { label: "Google Trends" as const, deltaPct: selectedInsightMomentum.signals.trends?.deltaPct ?? 0 },
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
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="text-2xl font-serif">Leaderboard</CardTitle>
                          </div>
                          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/60 flex-wrap" data-testid="text-leaderboard-freshness">
                            <TouchTooltip
                              content={<p>Data refresh from Wikipedia, Mediastack, GDELT, and Google.</p>}
                              side="bottom"
                              className="text-xs max-w-[240px]"
                            >
                              <span className="inline-flex items-center gap-1 cursor-help">
                                <RefreshCw className="h-3 w-3 shrink-0 full-refresh-icon-shine" aria-hidden />
                                <span>Data refresh: {systemFreshness?.liveUpdatedAtFormatted || systemFreshness?.fullRefreshAtFormatted || systemFreshness?.lastScoredAtFormatted || "recently"}</span>
                              </span>
                            </TouchTooltip>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                </div>
                <div
                  className="sticky top-16 z-30 border-b border-border/60 bg-card/95 backdrop-blur-md"
                  data-testid="leaderboard-sticky-toolbar"
                >
                  <div className="border-b border-border/60 px-3 py-2.5">
                    <div className="flex min-h-10 w-full items-stretch overflow-hidden rounded-lg bg-muted/50" data-testid="toggle-leaderboard-tabs">
                    <div
                      className={`relative flex flex-1 min-w-0 items-center justify-center rounded-l-lg rounded-r-none px-4 py-1.5 text-[15px] font-medium transition-all ${
                        leaderboardTab === "fame"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {leaderboardTab === "fame" && (
                        <span className="pointer-events-none absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#3C83F6]" />
                      )}
                      <button
                        type="button"
                        onClick={() => handleTabClick("fame")}
                        aria-label="Show Trending leaderboard"
                        className="absolute inset-0 z-0 rounded-l-lg rounded-r-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        data-testid="tab-leaderboard-fame"
                      />
                      <div className="pointer-events-none relative z-10 flex min-w-0 items-center justify-center gap-2">
                        <Crown
                          className={`h-[18px] w-[18px] shrink-0 ${leaderboardTab === "fame" ? "text-[#3C83F6]" : "text-muted-foreground/60"}`}
                        />
                        <span className="whitespace-nowrap">Trending</span>
                        {leaderboardTab === "fame" && (
                          <Popover open={fameTooltipOpen} onOpenChange={handleFameTooltipOpenChange}>
                            <PopoverAnchor asChild>
                              <button
                                type="button"
                                aria-label="Trending leaderboard info"
                                data-testid="icon-trending-toggle-info"
                                className="pointer-events-auto no-default-hover-elevate no-default-active-elevate ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#3C83F6] hover:bg-muted/50"
                                onPointerDown={() => {
                                  if (!isCoarsePointer) {
                                    fameTooltipLeaveDismissDisabledRef.current = true;
                                  }
                                }}
                                onClick={() => {
                                  if (isCoarsePointer) {
                                    handleFameTooltipOpenChange(!fameTooltipOpen);
                                  } else {
                                    fameTooltipLeaveDismissDisabledRef.current = true;
                                    handleFameTooltipOpenChange(true);
                                  }
                                }}
                                onMouseEnter={!isCoarsePointer ? openFameTooltip : undefined}
                                onMouseLeave={
                                  !isCoarsePointer
                                    ? () => {
                                        if (!fameTooltipLeaveDismissDisabledRef.current) {
                                          scheduleCloseFame();
                                        }
                                      }
                                    : undefined
                                }
                              >
                                <Info className="h-3 w-3" />
                              </button>
                            </PopoverAnchor>
                            <PopoverContent
                              side="bottom"
                              align="center"
                              className={cn(tooltipSurfaceClass, "relative max-w-[280px] pr-8")}
                              onOpenAutoFocus={(e) => e.preventDefault()}
                              onMouseEnter={!isCoarsePointer ? openFameTooltip : undefined}
                              onMouseLeave={
                                !isCoarsePointer
                                  ? () => {
                                      if (!fameTooltipLeaveDismissDisabledRef.current) {
                                        scheduleCloseFame();
                                      }
                                    }
                                  : undefined
                              }
                            >
                              <span className="sr-only">Trending leaderboard info</span>
                              <PopoverClose asChild>
                                <button
                                  type="button"
                                  aria-label="Close"
                                  data-testid="button-close-trending-tooltip"
                                  className="absolute top-2 right-2 p-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </PopoverClose>
                              <TrendScoreInfoContent />
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </div>
                    <div
                      className={`relative flex flex-1 min-w-0 items-center justify-center rounded-r-lg rounded-l-none px-4 py-1.5 text-[15px] font-medium transition-all ${
                        leaderboardTab === "approval"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {leaderboardTab === "approval" && (
                        <span className="pointer-events-none absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#22D3EE]" />
                      )}
                      <button
                        type="button"
                        onClick={() => handleTabClick("approval")}
                        aria-label="Show Approval leaderboard"
                        className="absolute inset-0 z-0 rounded-r-lg rounded-l-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        data-testid="tab-leaderboard-approval"
                      />
                      <div className="pointer-events-none relative z-10 flex min-w-0 items-center justify-center gap-2">
                        <Star
                          className={`h-[18px] w-[18px] shrink-0 ${leaderboardTab === "approval" ? "text-[#22D3EE]" : "text-muted-foreground/60"}`}
                        />
                        <span className="whitespace-nowrap">Approval</span>
                        {leaderboardTab === "approval" && (
                          <Popover open={approvalTooltipOpen} onOpenChange={handleApprovalTooltipOpenChange}>
                            <PopoverAnchor asChild>
                              <button
                                type="button"
                                aria-label="Approval leaderboard info"
                                data-testid="icon-approval-toggle-info"
                                className="pointer-events-auto no-default-hover-elevate no-default-active-elevate ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#22D3EE] hover:bg-muted/50"
                                onPointerDown={() => {
                                  if (!isCoarsePointer) {
                                    approvalTooltipLeaveDismissDisabledRef.current = true;
                                  }
                                }}
                                onClick={() => {
                                  if (isCoarsePointer) {
                                    handleApprovalTooltipOpenChange(!approvalTooltipOpen);
                                  } else {
                                    approvalTooltipLeaveDismissDisabledRef.current = true;
                                    handleApprovalTooltipOpenChange(true);
                                  }
                                }}
                                onMouseEnter={!isCoarsePointer ? openApprovalTooltip : undefined}
                                onMouseLeave={
                                  !isCoarsePointer
                                    ? () => {
                                        if (!approvalTooltipLeaveDismissDisabledRef.current) {
                                          scheduleCloseApproval();
                                        }
                                      }
                                    : undefined
                                }
                              >
                                <Info className="h-3 w-3" />
                              </button>
                            </PopoverAnchor>
                            <PopoverContent
                              side="bottom"
                              align="center"
                              className={cn(tooltipSurfaceClass, "relative max-w-[280px] pr-8")}
                              onOpenAutoFocus={(e) => e.preventDefault()}
                              onMouseEnter={!isCoarsePointer ? openApprovalTooltip : undefined}
                              onMouseLeave={
                                !isCoarsePointer
                                  ? () => {
                                      if (!approvalTooltipLeaveDismissDisabledRef.current) {
                                        scheduleCloseApproval();
                                      }
                                    }
                                  : undefined
                              }
                            >
                              <span className="sr-only">Approval leaderboard info</span>
                              <PopoverClose asChild>
                                <button
                                  type="button"
                                  aria-label="Close"
                                  data-testid="button-close-approval-tooltip"
                                  className="absolute top-2 right-2 p-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </PopoverClose>
                              <ApprovalRatingInfoContent />
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </div>
                    </div>
                  </div>
                  <div className="pl-3 pr-4 sm:pr-6 py-4 bg-muted/30">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <FilterDropdown
                          value={category}
                          onChange={setCategory}
                          categories={leaderboardFilterCategories}
                          sortDirection={sortDirection}
                          onSortDirectionChange={setSortDirection}
                        />
                        <div className="flex-1 min-w-0 lg:max-w-[400px]">
                          <SearchBar 
                            onSearch={setSearchQuery} 
                            placeholder="Search..."
                          />
                        </div>
                        {displayPeople.length > 0 && (
                          <div
                            className="hidden lg:flex items-center gap-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground ml-auto shrink-0"
                            data-testid="leaderboard-column-header"
                          >
                            {leaderboardTab === "fame" ? (
                              <>
                                <div className="text-right w-[140px]">Trend Score</div>
                                <div className="text-right w-[80px]">24h</div>
                                <div className="text-right w-[84px]">Approval</div>
                                <div className="flex justify-end w-[88px]">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 min-h-9 w-auto shrink-0 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                                    aria-label="About predicting Up or Down from the leaderboard"
                                    data-testid="button-leaderboard-predict-info"
                                    onClick={() => setPredictLeaderboardInfoOpen(true)}
                                  >
                                    Predict
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="text-right w-[100px]">Vote Count</div>
                                <div className="text-right w-[120px]">Approval</div>
                                <div className="text-right w-[120px]">Trend Score</div>
                                <div className="flex justify-end w-[88px]">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 min-h-9 w-auto shrink-0 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                                    aria-label="About approval rating and Rate on the leaderboard"
                                    data-testid="button-leaderboard-your-vote-info"
                                    onClick={() => setVoteLeaderboardInfoOpen(true)}
                                  >
                                    Your Vote
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {leaderboardTab === "fame" && (
                          <Button
                            type="button"
                            variant="outline"
                            className="lg:hidden h-9 min-h-9 w-auto shrink-0 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                            aria-label="About predicting Up or Down from the leaderboard"
                            data-testid="label-mobile-predict"
                            onClick={() => setPredictLeaderboardInfoOpen(true)}
                          >
                            Predict
                          </Button>
                        )}
                        {leaderboardTab === "approval" && (
                          <Button
                            type="button"
                            variant="outline"
                            className="lg:hidden h-9 min-h-9 w-auto shrink-0 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                            aria-label="About approval rating and Rate on the leaderboard"
                            data-testid="label-mobile-your-vote"
                            onClick={() => setVoteLeaderboardInfoOpen(true)}
                          >
                            Your Vote
                          </Button>
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
                        userPredictionPick={userUpdownPickByPerson.get(person.id)?.pick ?? null}
                        predictionsDisabled={isUpdownCutoffPassed}
                        predictionsClosedMessage={leaderboardClosedMessage}
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
                <DrawerHeader className="text-left sr-only">
                  <DrawerTitle>{selectedInsightPerson.name}</DrawerTitle>
                </DrawerHeader>
                <div className="px-3 pb-3 pt-1">
                  <InsightPanelContent
                    person={selectedInsightPerson}
                    loading={selectedInsightMomentumLoading}
                    error={selectedInsightMomentumError}
                    growthSignals={insightGrowthSignals}
                    coolingSignals={insightCoolingSignals}
                    categoryRank={selectedInsightMomentum?.categoryRank?.categoryRank ?? null}
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
                <DialogHeader className="sr-only">
                  <DialogTitle>{selectedInsightPerson.name}</DialogTitle>
                </DialogHeader>
                <InsightPanelContent
                  person={selectedInsightPerson}
                  loading={selectedInsightMomentumLoading}
                  error={selectedInsightMomentumError}
                  growthSignals={insightGrowthSignals}
                  coolingSignals={insightCoolingSignals}
                  categoryRank={selectedInsightMomentum?.categoryRank?.categoryRank ?? null}
                  onClose={handleCloseInsightPanel}
                  onViewProfile={handleViewInsightProfile}
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
      {isMobile ? (
        <Drawer open={predictLeaderboardInfoOpen} onOpenChange={setPredictLeaderboardInfoOpen}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader className="space-y-1.5 text-left">
              <DrawerTitle>Predict from the leaderboard</DrawerTitle>
              <DrawerDescription className="text-sm text-muted-foreground">
                How Up/Down works here, plus jump to a section on Predict.
              </DrawerDescription>
            </DrawerHeader>
            <div className="overflow-y-auto px-4 pb-6 pt-0">
              <LeaderboardPredictInfoBody onNavigateLink={() => setPredictLeaderboardInfoOpen(false)} />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={predictLeaderboardInfoOpen} onOpenChange={setPredictLeaderboardInfoOpen}>
          <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-md">
            <DialogHeader className="shrink-0 space-y-1.5 text-left">
              <DialogTitle>Predict from the leaderboard</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                How Up/Down works here, plus jump to a section on Predict.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-2">
              <LeaderboardPredictInfoBody onNavigateLink={() => setPredictLeaderboardInfoOpen(false)} />
            </div>
          </DialogContent>
        </Dialog>
      )}
      {isMobile ? (
        <Drawer open={voteLeaderboardInfoOpen} onOpenChange={setVoteLeaderboardInfoOpen}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader className="space-y-1.5 text-left">
              <DrawerTitle>Your vote on the leaderboard</DrawerTitle>
              <DrawerDescription className="text-sm text-muted-foreground">
                How approval works here, plus jump to a section on Vote.
              </DrawerDescription>
            </DrawerHeader>
            <div className="overflow-y-auto px-4 pb-6 pt-0">
              <LeaderboardVoteInfoBody onNavigateLink={() => setVoteLeaderboardInfoOpen(false)} />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={voteLeaderboardInfoOpen} onOpenChange={setVoteLeaderboardInfoOpen}>
          <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-md">
            <DialogHeader className="shrink-0 space-y-1.5 text-left">
              <DialogTitle>Your vote on the leaderboard</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                How approval works here, plus jump to a section on Vote.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-2">
              <LeaderboardVoteInfoBody onNavigateLink={() => setVoteLeaderboardInfoOpen(false)} />
            </div>
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
        onConfirmAmmSell={handleConfirmAmmSell}
        initialAmmMode={modalIntent}
        liveAmmState={liveAmmStateForPending}
        walletBalance={walletCredits}
        onDirectionChange={(dir) => {
          if (!pendingSelection || pendingSelection.type !== "updown") return;
          const market = updownMarkets.find(m => m.id === pendingSelection.marketId);
          if (!market) return;
          const crowdSentiment = dir === "up" ? market.upPoolPercent : (100 - market.upPoolPercent);
          setPendingSelection({
            type: "updown",
            choice: dir === "up" ? "Trend Score UP" : "Trend Score DOWN",
            marketName: market.personName,
            marketId: market.id,
            entryId: dir === "up" ? market.upEntryId : market.downEntryId,
            startScore: market.startScore,
            currentScore: market.currentScore,
            crowdSentiment,
            baselineScore: market.baselineScore,
            baselineTimestamp: market.startAt || undefined,
            endAt: market.endAt || undefined,
            bettingCutoff: market.bettingCutoff,
            engine: "amm",
            ammState: (market.ammState ?? null) as StakeSelection["ammState"],
          });
        }}
      />
    </div>
  );
}
