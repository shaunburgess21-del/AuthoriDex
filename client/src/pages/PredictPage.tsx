import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { hapticSuccess, hapticError } from "@/lib/haptic";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardGridSkeleton } from "@/components/ui/card-skeletons";
import { Badge } from "@/components/ui/badge";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { useCategoryRaceMap } from "@/hooks/useCategoryRaceMap";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { UserMenu } from "@/components/UserMenu";
import { useXpBurst } from "@/components/XpBurstProvider";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer } from "vaul";
import { MarketCycleHero } from "@/components/MarketCycleHero";
import { useMarketCycle, type MarketStatus } from "@/hooks/useMarketCycle";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { JackpotEntryModal } from "@/components/JackpotEntryModal";
import { StepModal } from "@/components/StepModal";
import { PREDICT_RULES_STEPS } from "@/components/rulesStepData";
import { OverlayFilterBar } from "@/components/OverlayFilterBar";
import { ViewAllOverlayHeader } from "@/components/ViewAllOverlayHeader";
import { AvatarHeightHeadline } from "@/components/AvatarHeightHeadline";
import { WeeklyUpDownNameBlock } from "@/components/WeeklyUpDownNameBlock";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { getSupabase } from "@/lib/supabase";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { getMarketBaselineScore } from "@/lib/predict-market-baseline";
import { getCanonicalNativeCycle } from "@/lib/nativeMarketLifecycle";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { WeeklyUpDownActionButtons } from "@/components/predict/WeeklyUpDownActionButtons";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { formatSignedPercent, formatSignedPoints, getRecentActivityMarketPath } from "@/lib/predict-display";
import { computePayoutMultiplier } from "@/lib/parimutuel";
import {
  AGENT_AVATAR_FALLBACK_CLASS,
  getAvatarGradient,
  getAvatarInitials,
  HUMAN_AVATAR_FALLBACK_CLASS,
} from "@/lib/avatar";
import { useFavorites } from "@/hooks/useFavorites";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { useScrollHint } from "@/hooks/use-scroll-hint";
import { CategoryRowWithSearch } from "@/components/CategoryRowWithSearch";
import { 
  ArrowLeft, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  Target, 
  Users, 
  Trophy, 
  Wallet, 
  ListChecks,
  EyeOff,
  HelpCircle,
  ScrollText,
  Check,
  ChevronRight,
  ChevronLeft,
  Clock,
  Search,
  Lock,
  Loader2,
  Sparkles,
  Crown,
  TicketCheck,
  UserPlus,
  ChevronDown,
  Plus,
  BarChart3,
  Swords,
  Star,
  Cpu,
  Scale,
  Landmark,
  Briefcase,
  Music2,
  Video,
  LayoutGrid,
  Flame,
  RotateCcw,
  AlertTriangle,
  X,
  XCircle,
  Clapperboard,
  Gamepad2,
  UtensilsCrossed,
  Heart,
  Laugh,
  MessageSquare,
  type LucideIcon
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation, Link } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { CardSection } from "@/components/CardSection";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { UserSocialAvatar } from "@/components/UserSocialAvatar";
import { formatActivityAge } from "@/lib/formatDate";
import { getMarketCategoryLabel, normalizeMarketCategory, CATEGORIES_OPEN, OPINION_POLL_MIN_OPTIONS, OPINION_POLL_MAX_OPTIONS } from "@shared/constants";
import { buildSectionCategoryOptions } from "@/lib/sectionCategoryFilters";
import { SuggestCategorySelect, SuggestDurationPicker, OpinionOptionRow, type OpinionOptionInput } from "@/components/suggest";
import { OnboardingDrawer, type OnboardingStep, type OnboardingDrawerHandle } from "@/components/OnboardingDrawer";
import { UnifiedSectionHeader } from "@/components/UnifiedSectionHeader";
import { PredictCard } from "@/components/predict/PredictCard";
import { ParticipantAvatarStack, type ParticipantPreview } from "@/components/predict/ParticipantAvatarStack";
import { WeeklyUpDownCard, type PredictionMarket } from "@/components/predict/WeeklyUpDownCard";
import { pendingWeeklyUpDownPositionFromBet } from "@/components/predict/WeeklyUpDownYourPositionPanel";
import { HeadToHeadCard, h2hUserPickFromBet, smartName, type HeadToHeadMarket } from "@/components/predict/HeadToHeadCard";
import {
  TopGainerCard,
  categoryRacePredictionSummaryFromBet,
  type TopGainerMarket,
  type GainerCandidate,
} from "@/components/predict/TopGainerCard";
import { WeeklyJackpotHero } from "@/components/predict/WeeklyJackpotHero";
import { OpenMarketCard } from "@/components/predict/OpenMarketCard";
import { VoteSnapScrollView, type SnapItem, type SnapSectionType } from "@/components/snap-scroll/VoteSnapScrollView";
import { useIsMobile } from "@/hooks/use-mobile";
import { consumeCategoryPillBrowseIntent, isCategoryPillDrawerDismissSuppressed } from "@/components/InteractiveCategoryPill";

type SnapOpenSource = "card-tap" | "browse-button";

const PREDICT_ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    icon: Scale,
    heading: "Predict World Events",
    description: "Elections, viral moments, tech launches \u2014 call it before the crowd does.",
    gradient: "from-violet-500 to-purple-600",
    glow: "shadow-violet-500/25",
  },
  {
    icon: Target,
    heading: "Stake Your Conviction",
    description: "Back predictions with virtual credits. The bigger the pool, the bigger the potential return.",
    gradient: "from-fuchsia-500 to-pink-600",
    glow: "shadow-fuchsia-500/25",
  },
  {
    icon: Trophy,
    heading: "Claim Your Winnings",
    description: "When events resolve, winners split the pool. Be right, get rewarded.",
    gradient: "from-amber-500 to-orange-600",
    glow: "shadow-amber-500/25",
  },
] as const;


function LinkedPersonChip({ market }: { market: any }) {
  const name = market.linkedPersonName;
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-purple-600/80 dark:text-purple-400/80 bg-purple-500/15 dark:bg-purple-500/10 rounded-full px-2 py-0.5">
      <span className="opacity-60">Linked to</span> {name}
    </span>
  );
}

function FreshnessBadge({ market }: { market: any }) {
  const endAt = new Date(market.closeAt || market.endAt);
  const now = Date.now();
  const daysLeft = Math.ceil((endAt.getTime() - now) / (1000 * 60 * 60 * 24));
  const createdDaysAgo = Math.floor((now - new Date(market.createdAt).getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {createdDaysAgo <= 7 && (
        <Badge variant="outline" className="text-[10px] border-emerald-500/40 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 px-1.5 py-0">New</Badge>
      )}
      {daysLeft <= 7 && (
        <Badge variant="outline" className="text-[10px] border-amber-500/40 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 px-1.5 py-0">Closing soon</Badge>
      )}
      <span className="text-[11px] text-muted-foreground">
        {daysLeft === 1 ? "Closes tomorrow" : `Closes in ${daysLeft} days`}
      </span>
    </div>
  );
}


// Prediction Type definitions
type PredictionType = "all" | "jackpot" | "updown" | "h2h" | "gainer" | "community";
type CategoryFilter = string;


const mockMarkets: PredictionMarket[] = [
  {
    id: "market-1",
    personId: "1",
    personName: "Elon Musk",
    personAvatar: "",
    currentScore: 515809,
    baselineScore: 492100,
    startScore: 492100,
    change7d: 4.78,
    upMultiplier: 1.7,
    downMultiplier: 2.3,
    endTime: "Sun 23:59 UTC",
    totalPool: 15420,
    upPoolPercent: 58,
    category: "tech",
  },
  {
    id: "market-2",
    personId: "2",
    personName: "Taylor Swift",
    personAvatar: "",
    currentScore: 489234,
    baselineScore: 505500,
    startScore: 505500,
    change7d: -3.2,
    upMultiplier: 2.1,
    downMultiplier: 1.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 12350,
    upPoolPercent: 45,
    category: "music",
  },
  {
    id: "market-3",
    personId: "3",
    personName: "MrBeast",
    personAvatar: "",
    currentScore: 504734,
    baselineScore: 531000,
    startScore: 531000,
    change7d: -4.95,
    upMultiplier: 1.5,
    downMultiplier: 2.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 9870,
    upPoolPercent: 65,
    category: "creator",
  },
  {
    id: "market-4",
    personId: "4",
    personName: "Donald Trump",
    personAvatar: "",
    currentScore: 484531,
    baselineScore: 501300,
    startScore: 501300,
    change7d: -3.35,
    upMultiplier: 1.4,
    downMultiplier: 3.2,
    endTime: "Sun 23:59 UTC",
    totalPool: 22100,
    upPoolPercent: 72,
    category: "politics",
  },
  {
    id: "market-5",
    personId: "5",
    personName: "Kim Kardashian",
    personAvatar: "",
    currentScore: 398456,
    baselineScore: 405800,
    startScore: 405800,
    change7d: -1.8,
    upMultiplier: 2.2,
    downMultiplier: 1.7,
    endTime: "Sun 23:59 UTC",
    totalPool: 8540,
    upPoolPercent: 42,
    category: "creator",
  },
  {
    id: "market-6",
    personId: "6",
    personName: "Cristiano Ronaldo",
    personAvatar: "",
    currentScore: 445678,
    baselineScore: 436500,
    startScore: 436500,
    change7d: 2.1,
    upMultiplier: 1.9,
    downMultiplier: 2.0,
    endTime: "Sun 23:59 UTC",
    totalPool: 11200,
    upPoolPercent: 51,
    category: "sports",
  },
  {
    id: "market-7",
    personId: "7",
    personName: "Jensen Huang",
    personAvatar: "",
    currentScore: 412300,
    baselineScore: 381000,
    startScore: 381000,
    change7d: 8.2,
    upMultiplier: 1.3,
    downMultiplier: 3.1,
    endTime: "Sun 23:59 UTC",
    totalPool: 18900,
    upPoolPercent: 78,
    category: "tech",
  },
  {
    id: "market-8",
    personId: "8",
    personName: "Beyoncé",
    personAvatar: "",
    currentScore: 478200,
    baselineScore: 471100,
    startScore: 471100,
    change7d: 1.5,
    upMultiplier: 1.8,
    downMultiplier: 2.1,
    endTime: "Sun 23:59 UTC",
    totalPool: 14200,
    upPoolPercent: 52,
    category: "music",
  },
];


const headToHeadMarkets: HeadToHeadMarket[] = [
  {
    id: "h2h-1",
    title: "Drake vs Kendrick",
    person1: { name: "Drake", avatar: "", currentScore: 425600 },
    person2: { name: "Kendrick Lamar", avatar: "", currentScore: 398200 },
    category: "music",
    endTime: "Sun 23:59 UTC",
    totalPool: 28450,
    person1Percent: 42,
  },
  {
    id: "h2h-2",
    title: "Musk vs Zuckerberg",
    person1: { name: "Elon Musk", avatar: "", currentScore: 515809 },
    person2: { name: "Mark Zuckerberg", avatar: "", currentScore: 312400 },
    category: "tech",
    endTime: "Sun 23:59 UTC",
    totalPool: 19200,
    person1Percent: 68,
  },
  {
    id: "h2h-3",
    title: "Swift vs Beyoncé",
    person1: { name: "Taylor Swift", avatar: "", currentScore: 489234 },
    person2: { name: "Beyoncé", avatar: "", currentScore: 478200 },
    category: "music",
    endTime: "Sun 23:59 UTC",
    totalPool: 15780,
    person1Percent: 55,
  },
  {
    id: "h2h-4",
    title: "Ronaldo vs Messi",
    person1: { name: "Cristiano Ronaldo", avatar: "", currentScore: 445678 },
    person2: { name: "Lionel Messi", avatar: "", currentScore: 432100 },
    category: "sports",
    endTime: "Sun 23:59 UTC",
    totalPool: 34100,
    person1Percent: 48,
  },
  {
    id: "h2h-5",
    title: "Biden vs Trump",
    person1: { name: "Joe Biden", avatar: "", currentScore: 298400 },
    person2: { name: "Donald Trump", avatar: "", currentScore: 484531 },
    category: "politics",
    endTime: "Sun 23:59 UTC",
    totalPool: 45200,
    person1Percent: 38,
  },
  {
    id: "h2h-6",
    title: "Bezos vs Musk",
    person1: { name: "Jeff Bezos", avatar: "", currentScore: 287600 },
    person2: { name: "Elon Musk", avatar: "", currentScore: 515809 },
    category: "business",
    endTime: "Sun 23:59 UTC",
    totalPool: 21800,
    person1Percent: 35,
  },
];


interface RecentPredictionActivity {
  id: string;
  createdAt: string;
  stakeAmount: number;
  confidence: number | null;
  choiceLabel: string;
  marketId: string;
  marketTitle: string;
  marketSlug: string;
  marketType: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
  isPublic: boolean;
  rationale: string | null;
}

const topGainerMarkets: TopGainerMarket[] = [
  {
    id: "gainer-1",
    category: "music",
    leaders: [
      { name: "Taylor Swift", avatar: "", currentGain: 12450, percentGain: 4.2 },
      { name: "Drake", avatar: "", currentGain: 8920, percentGain: 3.8 },
      { name: "Bad Bunny", avatar: "", currentGain: 7340, percentGain: 2.9 },
    ],
    totalPool: 14200,
    endTime: "Sun 23:59 UTC",
  },
  {
    id: "gainer-2",
    category: "tech",
    leaders: [
      { name: "Jensen Huang", avatar: "", currentGain: 15780, percentGain: 8.5 },
      { name: "Elon Musk", avatar: "", currentGain: 11200, percentGain: 2.1 },
      { name: "Sam Altman", avatar: "", currentGain: 9850, percentGain: 5.2 },
    ],
    totalPool: 19800,
    endTime: "Sun 23:59 UTC",
  },
  {
    id: "gainer-3",
    category: "creator",
    leaders: [
      { name: "MrBeast", avatar: "", currentGain: 18900, percentGain: 6.1 },
      { name: "Logan Paul", avatar: "", currentGain: 12100, percentGain: 4.8 },
      { name: "KSI", avatar: "", currentGain: 8750, percentGain: 3.5 },
    ],
    totalPool: 11500,
    endTime: "Sun 23:59 UTC",
  },
  {
    id: "gainer-4",
    category: "sports",
    leaders: [
      { name: "Cristiano Ronaldo", avatar: "", currentGain: 9800, percentGain: 2.4 },
      { name: "LeBron James", avatar: "", currentGain: 8900, percentGain: 1.9 },
      { name: "Lionel Messi", avatar: "", currentGain: 7200, percentGain: 1.6 },
    ],
    totalPool: 13400,
    endTime: "Sun 23:59 UTC",
  },
];


type MarketType = "JACKPOT_EXACT" | "BINARY_TREND" | "VERSUS" | "COMMUNITY" | "GAINER";

const PREDICTION_TYPES: { id: PredictionType; label: string; mobileLabel: string; icon: React.ReactNode }[] = [
  { id: "all", label: "All Markets", mobileLabel: "All", icon: <Sparkles className="h-4 w-4" /> },
  { id: "community", label: "World", mobileLabel: "Markets", icon: <Scale className="h-4 w-4" /> },
  { id: "jackpot", label: "Weekly Jackpot", mobileLabel: "Jackpot", icon: <Crown className="h-4 w-4" /> },
  { id: "updown", label: "Up/Down", mobileLabel: "Up/Down", icon: <TrendingUp className="h-4 w-4" /> },
  { id: "h2h", label: "Head-to-Head", mobileLabel: "H2H", icon: <Swords className="h-4 w-4" /> },
  { id: "gainer", label: "Category Races", mobileLabel: "Races", icon: <BarChart3 className="h-4 w-4" /> },
];

function HorizontalScroll({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragScrollRef = useDragScroll<HTMLDivElement>();
  useScrollHint(scrollRef);
  const [scrollState, setScrollState] = useState<"start" | "middle" | "end">("start");
  
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    
    const handleScroll = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const maxScroll = scrollWidth - clientWidth;
      if (scrollLeft <= 2) {
        setScrollState("start");
      } else if (scrollLeft >= maxScroll - 2) {
        setScrollState("end");
      } else {
        setScrollState("middle");
      }
    };
    
    el.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);
  
  const maskClass = scrollState === "start" ? "scroll-mask-right" 
    : scrollState === "end" ? "scroll-mask-left" 
    : "scroll-mask-both";
  
  return (
    <div 
      ref={(node) => {
        (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        (dragScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      className={`flex gap-2 overflow-x-auto scrollbar-hide ${maskClass} ${className}`}
    >
      {children}
    </div>
  );
}

function SectionFilterBar({
  categoryFilter,
  onCategoryChange,
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search...",
  testIdPrefix,
  user,
  onAuthRequired,
  filters,
}: {
  categoryFilter: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder?: string;
  testIdPrefix: string;
  user?: any;
  onAuthRequired?: () => void;
  filters: Array<{ id: string; label: string }>;
}) {
  const handleCategoryClick = (catId: CategoryFilter) => {
    if (catId === "favorites" && !user) {
      onAuthRequired?.();
      return;
    }
    onCategoryChange(catId);
  };

  return (
    <div>
      <CategoryRowWithSearch
        searchValue={searchQuery}
        onSearchChange={onSearchChange}
        placeholder={searchPlaceholder}
        testId={`${testIdPrefix}-search`}
      >
        {filters.map((cat) => {
          const IconComponent = CATEGORY_ICONS[cat.id] || LayoutGrid;
          return (
            <button
              key={cat.id}
              onClick={() => handleCategoryClick(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
                categoryFilter === cat.id
                  ? 'bg-violet-500/25 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/50 dark:border-violet-400/40 shadow-sm shadow-violet-500/30 dark:shadow-violet-500/20'
                  : 'bg-muted/50 border border-border/60 text-muted-foreground hover:border-violet-400/30 dark:bg-slate-800/30 dark:border-slate-700/40 dark:text-slate-400 dark:hover:border-violet-400/20'
              }`}
              data-testid={cat.id === "misc" ? `${testIdPrefix}-category-custom-topic` : `${testIdPrefix}-category-${cat.id}`}
            >
              <IconComponent className="h-3.5 w-3.5" />
              {cat.label}
            </button>
          );
        })}
      </CategoryRowWithSearch>
    </div>
  );
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  all: LayoutGrid,
  favorites: Star,
  trending: Flame,
  tech: Cpu,
  politics: Landmark,
  business: Briefcase,
  sports: Trophy,
  music: Music2,
  "film-tv": Clapperboard,
  gaming: Gamepad2,
  creator: Video,
  "food-drink": UtensilsCrossed,
  comedy: Laugh,
  lifestyle: Heart,
  misc: Sparkles,
};





function GainerCandidatesDialog({
  market,
  open,
  initialCandidate,
  onClose,
  onContinue,
  isMarketClosed,
}: {
  market: TopGainerMarket | null;
  open: boolean;
  initialCandidate?: GainerCandidate | null;
  onClose: () => void;
  onContinue: (candidate: GainerCandidate) => void;
  isMarketClosed?: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !market) return;
    setSearchQuery("");
    setSelectedCandidateKey(
      initialCandidate?.entryId || initialCandidate?.personId || initialCandidate?.name || null
    );
  }, [open, market, initialCandidate]);

  if (!market) return null;
  const candidates = market.allCandidates || market.leaders;
  const categoryLabel = getMarketCategoryLabel(market.category);
  const filteredCandidates = candidates.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const selectedCandidate = candidates.find(
    (c) => (c.entryId || c.personId || c.name) === selectedCandidateKey
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            Category Race: {categoryLabel}
          </DialogTitle>
          <DialogDescription>
            Who will be the biggest mover this week?
          </DialogDescription>
        </DialogHeader>

        {isMarketClosed && (
          <div className="shrink-0 mx-4 mb-2 rounded-md bg-amber-500/15 dark:bg-amber-500/10 border border-amber-500/40 dark:border-amber-500/30 px-3 py-2 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-600 dark:text-amber-400">Entries closed Friday 23:59 UTC — Awaiting results Sunday</p>
          </div>
        )}

        <div className="shrink-0 px-4 pb-3 space-y-2">
          <div className="rounded-md bg-violet-500/8 dark:bg-violet-500/5 border border-violet-500/15 px-3 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">How it works:</strong> The winner is whoever has the highest <strong className="text-green-500">% gain</strong> in their Trend Score by Sunday close &mdash; not the highest ranked person.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${categoryLabel} candidates...`}
              className="pl-9"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {candidates.length} candidates {isMarketClosed ? "" : "\u00b7 Tap to pick, then continue"}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <div className="space-y-1.5">
            {filteredCandidates.map((candidate, idx) => {
              const candidateKey = candidate.entryId || candidate.personId || candidate.name;
              const isSelected = candidateKey === selectedCandidateKey;
              const isLeader = idx === 0 && !searchQuery;
              // Per-candidate multipliers were too noisy here: candidates with
              // ~0% backing all displayed huge but near-identical defaults
              // (e.g. four candidates at "432.0x") which read as random
              // rather than informative. The estimated payout in the stake
              // modal — where the user has actually committed to a pick —
              // is a clearer place for this number.

              return (
                <button
                  type="button"
                  key={candidateKey}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                    isSelected
                      ? "border-violet-500/70 dark:border-violet-500/60 bg-violet-500/15 dark:bg-violet-500/10"
                      : isLeader
                        ? "border-amber-500/40 dark:border-amber-500/30 hover:bg-amber-500/5"
                        : "border-transparent hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedCandidateKey(candidateKey)}
                >
                  <div className="w-6 shrink-0 text-center">
                    {isLeader ? (
                      <div className="inline-flex h-5 w-5 rounded-full bg-background/80 border border-amber-500/60 dark:border-amber-500/50 items-center justify-center">
                        <Crown className="h-3 w-3 text-amber-500" />
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-violet-700 dark:text-violet-500">{candidate.rank ? `#${candidate.rank}` : 'New'}</span>
                    )}
                  </div>
                  <PersonAvatar name={candidate.name} avatar={candidate.avatar} size="sm" />
                  <span className="text-sm flex-1 truncate">{candidate.name}</span>
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-mono font-bold ${candidate.percentGain >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {formatSignedPercent(candidate.percentGain)}
                    </p>
                    <p className={`text-[10px] font-mono ${candidate.currentGain >= 0 ? "text-muted-foreground" : "text-red-600/80 dark:text-red-400/80"}`}>
                      {formatSignedPoints(candidate.currentGain)} pts
                    </p>
                  </div>
                  {isSelected && (
                    <div className="shrink-0 h-4 w-4 rounded-full bg-violet-500 flex items-center justify-center">
                      <Check className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </button>
              );
            })}
            {filteredCandidates.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                No candidates match &ldquo;{searchQuery}&rdquo;
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t px-4 py-3 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
            disabled={!selectedCandidate}
            onClick={() => {
              if (!selectedCandidate) return;
              onContinue(selectedCandidate);
              onClose();
            }}
          >
            {selectedCandidate ? `Pick ${selectedCandidate.name.split(" ")[0]}` : "Select a candidate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SuggestMarketCard({ onClick }: { onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className="border-2 border-dashed border-violet-500/40 dark:border-violet-500/30 rounded-xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#EFEFEF] hover:bg-[#EFEFEF]/5 transition-all min-h-[200px]"
      data-testid="card-suggest-market"
    >
      <div className="h-12 w-12 rounded-full bg-violet-500/15 dark:bg-violet-500/10 flex items-center justify-center">
        <Plus className="h-6 w-6 text-violet-700 dark:text-violet-500" />
      </div>
      <p className="text-sm font-medium text-violet-700 dark:text-violet-500">Suggest a Market</p>
      <p className="text-xs text-muted-foreground text-center">Suggest a prediction for admin review</p>
    </div>
  );
}

const OVERLAY_SCROLL_PREFIX = "overlay_scroll_";
function saveOverlayScroll(name: string, scrollTop: number) {
  sessionStorage.setItem(OVERLAY_SCROLL_PREFIX + name, String(Math.round(scrollTop)));
}
function restoreOverlayScroll(name: string, el: HTMLElement | null) {
  const saved = sessionStorage.getItem(OVERLAY_SCROLL_PREFIX + name);
  if (saved && el) {
    const pos = parseInt(saved, 10);
    requestAnimationFrame(() => { el.scrollTop = pos; });
  }
}
function clearOverlayScroll(name: string) {
  sessionStorage.removeItem(OVERLAY_SCROLL_PREFIX + name);
}

function FullScreenOverlay({
  open,
  onClose,
  title,
  children,
  categoryFilter,
  onCategoryChange,
  searchQuery,
  onSearchChange,
  user,
  onAuthRequired,
  overlayName,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  categoryFilter: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  user?: any;
  onAuthRequired?: () => void;
  overlayName: string;
  categories: Array<{ value: string; label: string }>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (open) restoreOverlayScroll(overlayName, scrollRef.current);
  }, [open, overlayName]);
  
  if (!open) return null;
  
  return (
    <div ref={scrollRef} onScroll={(e) => saveOverlayScroll(overlayName, e.currentTarget.scrollTop)} className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto premium-scrollbar" data-testid="overlay-view-all">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b">
        <div className="container mx-auto px-4 py-4">
          <ViewAllOverlayHeader
            onClose={onClose}
            closeTestId="button-close-overlay"
            backTestId="button-back-overlay"
            className="flex items-center justify-between gap-2 mb-4"
          >
            <h2 className="font-serif font-bold text-xl truncate">{title}</h2>
          </ViewAllOverlayHeader>
          
          <OverlayFilterBar
            value={categoryFilter}
            onChange={(v) => onCategoryChange(v as CategoryFilter)}
            searchValue={searchQuery}
            onSearchChange={onSearchChange}
            categories={categories}
            allValue="all"
            placeholder="Search..."
            testIdPrefix="overlay-predict"
            variant="predict"
            user={user}
            onAuthRequired={onAuthRequired}
          />
        </div>
      </div>
      
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {children}
        </div>
      </div>
    </div>
  );
}


// TODO: extract to shared (Phase 2 cleanup — mirrors VotePage.tsx:260)
function toTimelineWireValue(uiValue: string): "no_deadline" | "1_week" | "1_month" | "custom" {
  switch (uiValue) {
    case "1week":  return "1_week";
    case "1month": return "1_month";
    case "custom": return "custom";
    default:       return "no_deadline";
  }
}

type MarketTypeOption = "binary" | "multi" | "updown";

function CreatePredictionModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { trigger: triggerXpBurst } = useXpBurst();
  const [title, setTitle] = useState("");
  const [marketType, setMarketType] = useState<MarketTypeOption>("binary");
  const [category, setCategory] = useState<string>("tech");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [duration, setDuration] = useState("none");
  const [customDate, setCustomDate] = useState("");
  const [multiOptions, setMultiOptions] = useState<OpinionOptionInput[]>(
    Array.from({ length: OPINION_POLL_MIN_OPTIONS }, () => ({ name: "" }))
  );
  const [underlying, setUnderlying] = useState("");
  const [metric, setMetric] = useState("");
  const [strike, setStrike] = useState("");
  const [unit, setUnit] = useState("$");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetAll = () => {
    setTitle("");
    setMarketType("binary");
    setCategory("tech");
    setDescription("");
    setSourceUrl("");
    setDuration("none");
    setCustomDate("");
    setMultiOptions(Array.from({ length: OPINION_POLL_MIN_OPTIONS }, () => ({ name: "" })));
    setUnderlying("");
    setMetric("");
    setStrike("");
    setUnit("$");
  };

  const handleTypeChange = (next: MarketTypeOption) => {
    if (next === marketType) return;
    setMarketType(next);
    if (next !== "multi") {
      setMultiOptions(Array.from({ length: OPINION_POLL_MIN_OPTIONS }, () => ({ name: "" })));
    }
    if (next !== "updown") {
      setUnderlying("");
      setMetric("");
      setStrike("");
      setUnit("$");
    }
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  const filledMultiOptions = multiOptions.filter((o) => o.name.trim().length > 0);
  const strikeNumber = strike.trim() === "" ? NaN : Number(strike);
  const canSubmit = (() => {
    if (!title.trim() || !category) return false;
    if (marketType === "multi" && filledMultiOptions.length < OPINION_POLL_MIN_OPTIONS) return false;
    if (marketType === "updown") {
      if (!underlying.trim()) return false;
      if (!strike.trim() || Number.isNaN(strikeNumber)) return false;
    }
    return true;
  })();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        openMarketType: marketType,
        category,
        description: description.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
        endAt: duration === "custom" ? (customDate || undefined) : toTimelineWireValue(duration),
      };

      if (marketType === "multi") {
        const resolvedEntries: Array<{ label: string; imageUrl?: string; personId?: string }> = [];
        for (const opt of filledMultiOptions) {
          let imageUrl = opt.imageUrl;
          if (opt.uploadedFile && !imageUrl) {
            const formData = new FormData();
            formData.append("file", opt.uploadedFile);
            const res = await fetch("/api/suggestions/upload-image", {
              method: "POST",
              body: formData,
              headers: { ...(await getAuthHeaders()) },
              credentials: "include",
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body?.error ?? `Upload failed for option: ${opt.name}`);
            }
            const { url } = await res.json();
            imageUrl = url;
          }
          resolvedEntries.push({
            label: opt.name.trim(),
            ...(imageUrl ? { imageUrl } : {}),
            ...(opt.personId ? { personId: opt.personId } : {}),
          });
        }
        payload.entries = resolvedEntries;
      }

      if (marketType === "updown") {
        payload.underlying = underlying.trim();
        payload.metric = metric.trim() || undefined;
        payload.strike = strikeNumber;
        payload.unit = unit.trim() || "$";
      }

      const suggestRes = await apiRequest("POST", "/api/suggestions", {
        type: "open_market",
        payload,
      });
      const suggestData = await suggestRes.json();
      if (suggestData?.xp?.xpAwarded) {
        triggerXpBurst(suggestData.xp.xpAwarded, undefined, suggestData.xp.reason);
      }
      resetAll();
      onClose();
      toast("Market suggested!", { description: "We'll review it shortly. You earned 5 XP!" });
    } catch (err: any) {
      toast.error("Submission failed", { description: err?.message ?? "Something went wrong. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer.Root open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[85dvh]">
          <div className="mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60" />
          <div className="flex items-center justify-between px-4 pb-2">
            <div>
              <Drawer.Title className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="h-5 w-5 text-violet-700 dark:text-violet-500" />
                Suggest a Market
              </Drawer.Title>
              <Drawer.Description className="text-xs text-muted-foreground mt-0.5">
                Suggest a prediction market for the community. Your submission will be reviewed by an admin before going live.
              </Drawer.Description>
            </div>
            <button type="button" onClick={handleClose} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors" aria-label="Close">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Title *</label>
                <span className={`text-xs ${title.length > 60 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                  {title.length}/60
                </span>
              </div>
              <Input
                placeholder="e.g., Will Taylor Swift announce a tour?"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 60))}
                data-testid="input-prediction-title"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Type *</label>
                <Select value={marketType} onValueChange={(v) => handleTypeChange(v as MarketTypeOption)}>
                  <SelectTrigger data-testid="select-prediction-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="binary">Yes/No</SelectItem>
                    <SelectItem value="multi">Multiple Choice</SelectItem>
                    <SelectItem value="updown">Above/Below</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <SuggestCategorySelect
                value={category}
                onChange={setCategory}
                data-testid="select-prediction-category"
              />
            </div>

            {marketType === "binary" && (
              <div>
                <label className="text-sm font-medium mb-1 block">Entries</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-medium text-center text-emerald-600 dark:text-emerald-400">
                    Yes
                  </div>
                  <div className="px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-medium text-center text-rose-600 dark:text-rose-400">
                    No
                  </div>
                </div>
              </div>
            )}

            {marketType === "multi" && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">
                    Options * (min {OPINION_POLL_MIN_OPTIONS}, max {OPINION_POLL_MAX_OPTIONS})
                  </label>
                  <span className="text-xs text-muted-foreground">{multiOptions.length} options</span>
                </div>
                <div className="space-y-2">
                  {multiOptions.map((opt, idx) => (
                    <OpinionOptionRow
                      key={idx}
                      value={opt}
                      onChange={(next) => {
                        const arr = [...multiOptions];
                        arr[idx] = next;
                        setMultiOptions(arr);
                      }}
                      onRemove={
                        multiOptions.length > OPINION_POLL_MIN_OPTIONS
                          ? () => setMultiOptions(multiOptions.filter((_, i) => i !== idx))
                          : undefined
                      }
                      testIdPrefix="prediction-multi"
                      index={idx}
                    />
                  ))}
                </div>
                {multiOptions.length < OPINION_POLL_MAX_OPTIONS && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMultiOptions([...multiOptions, { name: "" }])}
                    className="mt-2 text-violet-600 dark:text-violet-400"
                    data-testid="button-add-prediction-multi-option"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Option
                  </Button>
                )}
              </div>
            )}

            {marketType === "updown" && (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Entries</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-medium text-center text-emerald-600 dark:text-emerald-400">
                      Above
                    </div>
                    <div className="px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-medium text-center text-rose-600 dark:text-rose-400">
                      Below
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Asset / Subject *</label>
                  <Input
                    value={underlying}
                    onChange={(e) => setUnderlying(e.target.value)}
                    placeholder="e.g. Bitcoin, S&P 500, Tesla stock"
                    data-testid="input-prediction-underlying"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Metric (optional)</label>
                  <Input
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                    placeholder="e.g. price, market cap, revenue"
                    data-testid="input-prediction-metric"
                  />
                </div>
                <div className="grid grid-cols-[1fr_100px] gap-2">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Strike Value *</label>
                    <Input
                      type="number"
                      value={strike}
                      onChange={(e) => setStrike(e.target.value)}
                      placeholder="e.g. 100000"
                      data-testid="input-prediction-strike"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Unit</label>
                    <Input
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="$"
                      data-testid="input-prediction-unit"
                    />
                  </div>
                </div>
              </div>
            )}

            <SuggestDurationPicker
              value={duration}
              onChange={setDuration}
              customDate={customDate}
              onCustomDateChange={setCustomDate}
              testIdPrefix="prediction"
            />

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Description (optional)</label>
                <span className={`text-xs ${description.length > 200 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                  {description.length}/200
                </span>
              </div>
              <Textarea
                placeholder="Add more context for your prediction..."
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                maxLength={200}
                className="resize-none"
                data-testid="input-prediction-description"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Source URL (optional)</label>
              <Input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="Link to relevant article or source"
                data-testid="input-prediction-source-url"
              />
            </div>
          </div>

          <div className="border-t border-border/40 px-4 py-3 flex gap-2">
            <Button variant="outline" onClick={handleClose} className="flex-1" data-testid="button-cancel-prediction">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
              disabled={isSubmitting || !canSubmit}
              data-testid="button-submit-prediction"
            >
              {isSubmitting ? "Submitting…" : "Submit Suggestion"}
            </Button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export default function PredictPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { trigger: triggerXpBurst } = useXpBurst();
  const { user, profile, refreshProfile } = useAuth();
  const { favoriteIds } = useFavorites();
  const raceMap = useCategoryRaceMap();
  const leaderboardCats = useLeaderboardCategories();
  const onboardingRef = useRef<OnboardingDrawerHandle>(null);
  const [selectedType, setSelectedType] = useState<PredictionType>("all");
  const [myPositionsFilter, setMyPositionsFilter] = useState<"all" | "show-mine" | "hide-mine">("all");
  const cycleMyPositionsFilter = useCallback(() => {
    setMyPositionsFilter((prev) =>
      prev === "all" ? "show-mine" : prev === "show-mine" ? "hide-mine" : "all",
    );
  }, []);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const handleCategoryPillFilter = useCallback((category: string) => {
    setCategoryFilter(normalizeMarketCategory(category) as CategoryFilter);
  }, []);

  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [overlaySearchQuery, setOverlaySearchQuery] = useState("");
  const [overlayCategoryFilter, setOverlayCategoryFilter] = useState<CategoryFilter>("all");
  
  // Section-specific filters
  const [updownCategory, setUpdownCategory] = useState<CategoryFilter>("all");
  const [updownSearch, setUpdownSearch] = useState("");
  const [h2hCategory, setH2hCategory] = useState<CategoryFilter>("all");
  const [h2hSearch, setH2hSearch] = useState("");
  const [gainerCategory, setGainerCategory] = useState<CategoryFilter>("all");
  const [gainerSearch, setGainerSearch] = useState("");
  const [communityCategory, setCommunityCategory] = useState<CategoryFilter>("all");
  const [communitySearch, setCommunitySearch] = useState("");
  const [viewAllCategory, setViewAllCategory] = useState<string | null>(() => window.history.state?.overlay || null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState<string | null>(null);

  const isMobile = useIsMobile();
  const [snapScrollOpen, setSnapScrollOpen] = useState(false);
  const [snapScrollSection, setSnapScrollSection] = useState<SnapSectionType>("world-markets");
  const [snapScrollInitialId, setSnapScrollInitialId] = useState<string | undefined>();
  const savedSnapWindowScrollRef = useRef<number | null>(null);

  const openSuggestModal = (open: () => void) => {
    if (!user) {
      toast.error("Sign in required", { description: "Please sign in to suggest content." });
      return;
    }
    open();
  };

  const openSnapScroll = useCallback((section: SnapSectionType, itemId?: string, source: SnapOpenSource = "card-tap") => {
    if (!isMobile) return;
    if (source === "browse-button") {
      if (!consumeCategoryPillBrowseIntent()) return;
    } else if (isCategoryPillDrawerDismissSuppressed()) {
      return;
    }
    savedSnapWindowScrollRef.current = window.scrollY;
    setSnapScrollSection(section);
    setSnapScrollInitialId(itemId);
    setSnapScrollOpen(true);
    window.history.pushState({ overlay: `snap-${section}` }, "");
  }, [isMobile]);

  const closeSnapScroll = useCallback(() => {
    setSnapScrollOpen(false);
    window.history.back();
  }, []);

  useEffect(() => {
    if (!snapScrollOpen && savedSnapWindowScrollRef.current !== null) {
      const y = savedSnapWindowScrollRef.current;
      savedSnapWindowScrollRef.current = null;
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: "auto" });
      });
    }
  }, [snapScrollOpen]);

  const handleCardEmptyTap = useCallback((e: React.MouseEvent, section: SnapSectionType, itemId: string) => {
    if (!isMobile) return;
    const target = e.target as HTMLElement;
    const wrapper = e.currentTarget as HTMLElement;
    let node: HTMLElement | null = target;
    while (node && node !== wrapper) {
      if (node.matches('button, a, input, textarea, select, [role="button"], [data-interactive]')) {
        return;
      }
      node = node.parentElement;
    }
    e.stopPropagation();
    openSnapScroll(section, itemId, "card-tap");
  }, [isMobile, openSnapScroll]);

  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [townSquareCollapsed, setTownSquareCollapsed] = useState(true);
  const [gainerPickerState, setGainerPickerState] = useState<{ market: TopGainerMarket; initialCandidate?: GainerCandidate | null } | null>(null);
  
  const { data: trendingResponse, isLoading: isLoadingPeople, error: trendingError, refetch: refetchTrending } = useQuery<{ data: TrendingPerson[], totalCount: number, hasMore: boolean }>({
    queryKey: ['/api/trending?sort=rank'],
  });
  const trendingPeople = trendingResponse?.data || [];
  
  const { data: openMarketsData, isLoading: isLoadingOpenMarkets, error: openMarketsError, refetch: refetchOpenMarkets } = useQuery<any[]>({
    queryKey: ['/api/open-markets'],
  });
  const openMarkets = openMarketsData || [];

  const { data: nativeUpdownData, isLoading: updownLoading, error: updownError, refetch: refetchUpdown } = useQuery<any[]>({
    queryKey: ['/api/native-markets/updown'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const { data: nativeH2hData, isLoading: h2hLoading, error: h2hError, refetch: refetchH2h } = useQuery<any[]>({
    queryKey: ['/api/native-markets/h2h'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const { data: nativeGainerData, isLoading: gainerLoading, error: gainerError, refetch: refetchGainers } = useQuery<any[]>({
    queryKey: ['/api/native-markets/gainer'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const { data: nativeJackpotData, error: jackpotError, refetch: refetchJackpot } = useQuery<any[]>({
    queryKey: ['/api/native-markets/jackpot'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const { serverBettingCutoff, serverResolutionDeadline } = useMemo(() => {
    const allNative = [
      ...(nativeUpdownData || []),
      ...(nativeH2hData || []),
      ...(nativeGainerData || []),
      ...(nativeJackpotData || []),
    ];
    const canonical = getCanonicalNativeCycle(allNative);
    return { serverBettingCutoff: canonical.bettingCutoff, serverResolutionDeadline: canonical.resolutionDeadline };
  }, [nativeUpdownData, nativeH2hData, nativeGainerData, nativeJackpotData]);

  const marketCycle = useMarketCycle({ bettingCutoff: serverBettingCutoff, resolutionDeadline: serverResolutionDeadline });
  const isMarketClosed = marketCycle.status !== "OPEN";
  useEffect(() => {
    if (marketCycle.status !== "RESOLVED") return;

    const isAfterMondayStartUtc = () => {
      const now = new Date();
      return now.getUTCDay() !== 0;
    };
    if (!isAfterMondayStartUtc()) return;

    const refreshNativeMarkets = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void Promise.all([
        refetchUpdown(),
        refetchH2h(),
        refetchGainers(),
        refetchJackpot(),
      ]);
    };

    refreshNativeMarkets();
    window.addEventListener("focus", refreshNativeMarkets);
    document.addEventListener("visibilitychange", refreshNativeMarkets);
    return () => {
      window.removeEventListener("focus", refreshNativeMarkets);
      document.removeEventListener("visibilitychange", refreshNativeMarkets);
    };
  }, [marketCycle.status, refetchUpdown, refetchH2h, refetchGainers, refetchJackpot]);

  const closedMarketMessage = useMemo(() => {
    return getClosedMarketMessage({
      bettingCutoff: serverBettingCutoff,
      resolutionDeadline: serverResolutionDeadline,
    });
  }, [serverBettingCutoff, serverResolutionDeadline]);
  const { data: userBetsData, error: userBetsError, refetch: refetchUserBets } = useQuery<any>({
    queryKey: ['/api/me/predictions'],
    enabled: !!user,
  });
  const { data: recentActivity = [], error: recentActivityError, refetch: refetchRecentActivity } = useQuery<RecentPredictionActivity[]>({
    queryKey: ['/api/predict/recent-activity'],
    staleTime: 60_000,
    refetchInterval: 90_000,
  });

  const userBetsByMarket = useMemo(() => {
    const map = new Map<
      string,
      { result: string; payout: number; entryLabel: string; stakeAmount: number; marketId: string; entryId?: string }
    >();
    const grouped = new Map<string, any[]>();
    const betsArray = Array.isArray(userBetsData) ? userBetsData : (userBetsData as any)?.predictions ?? [];
    (betsArray).forEach((b: any) => {
      const mid = String(b.marketId);
      const arr = grouped.get(mid) || [];
      arr.push(b);
      grouped.set(mid, arr);
    });
    grouped.forEach((bets, marketId) => {
      const totalStake = bets.reduce((s: number, b: any) => s + b.stakeAmount, 0);
      const totalPayout = bets.reduce((s: number, b: any) => s + (b.payout || 0), 0);
      const uniqueEntries = new Set(bets.map((b: any) => b.entryLabel));
      const entryLabel = uniqueEntries.size === 1 ? bets[0].entryLabel : "Multiple positions";
      const uniqueEntryIds = new Set(bets.map((b: any) => b.entryId).filter(Boolean));
      const entryId = uniqueEntryIds.size === 1 ? ([...uniqueEntryIds][0] as string) : undefined;
      const results = new Set(bets.map((b: any) => b.result));
      let result = 'pending';
      if (results.has('won') && !results.has('lost')) result = 'won';
      else if (results.has('lost') && !results.has('won')) result = 'lost';
      else if (results.has('won') && results.has('lost')) result = 'won';
      else if (results.has('refunded') && results.size === 1) result = 'refunded';
      else result = bets[0].result;
      const key = String(marketId);
      map.set(key, { result, payout: totalPayout, entryLabel, stakeAmount: totalStake, marketId: key, entryId });
    });
    return map;
  }, [userBetsData]);

  const userBetsPerEntry = useMemo(() => {
    const map = new Map<string, Map<string, { direction: string; stakeAmount: number }>>();
    const betsArray = Array.isArray(userBetsData) ? userBetsData : (userBetsData as any)?.predictions ?? [];
    for (const b of betsArray as any[]) {
      if (!b.marketId || !b.entryId) continue;
      const mId = String(b.marketId);
      const eId = String(b.entryId);
      let inner = map.get(mId);
      if (!inner) { inner = new Map(); map.set(mId, inner); }
      const prev = inner.get(eId);
      inner.set(eId, {
        direction: b.direction || prev?.direction || "yes",
        stakeAmount: (prev?.stakeAmount || 0) + (b.stakeAmount || 0),
      });
    }
    return map;
  }, [userBetsData]);
  const walletCredits = profile?.predictCredits ?? 0;
  const visibleMarketIds = useMemo(() => {
    const ids = new Set<string>();
    openMarkets.forEach((m: any) => ids.add(String(m.id)));
    (nativeUpdownData || []).forEach((m: any) => ids.add(String(m.id)));
    (nativeH2hData || []).forEach((m: any) => ids.add(String(m.id)));
    (nativeGainerData || []).forEach((m: any) => ids.add(String(m.id)));
    return ids;
  }, [openMarkets, nativeUpdownData, nativeH2hData, nativeGainerData]);

  const activePredictions = useMemo(
    () => Array.from(userBetsByMarket.values()).filter(
      (bet) => bet.result === "pending" && visibleMarketIds.has(bet.marketId)
    ).length,
    [userBetsByMarket, visibleMarketIds]
  );
  useEffect(() => {
    if (activePredictions === 0 && myPositionsFilter === "show-mine") {
      setMyPositionsFilter("all");
    }
  }, [activePredictions, myPositionsFilter]);

  const predictedMarkets = useMemo(() => new Set(Array.from(userBetsByMarket.keys())), [userBetsByMarket]);
  const hydratedMarkets = useMemo((): PredictionMarket[] => {
    const dbMarkets = (nativeUpdownData || []).filter((m: any) => m.visibility === "live");
    if (dbMarkets.length > 0) {
      return dbMarkets.map((m: any) => {
        const person = m.person || {};
        const entries = m.entries || [];
        const upEntry = entries.find((e: any) => e.label?.toLowerCase() === "up");
        const downEntry = entries.find((e: any) => e.label?.toLowerCase() === "down");
        const upStake = Number(upEntry?.totalStake || 0);
        const downStake = Number(downEntry?.totalStake || 0);
        const total = upStake + downStake || 1;
        const upPercent = Math.round((upStake / total) * 100);
        const upMultiplier = computePayoutMultiplier(upStake + downStake, upStake);
        const downMultiplier = computePayoutMultiplier(upStake + downStake, downStake);
        const currentScore = Number(person.trendScore || person.fameIndex || 0);
        const baselineScore = getMarketBaselineScore(m, currentScore) ?? currentScore;
        return {
          id: m.id,
          personId: m.personId || "",
          personName: person.name || m.title?.replace(/: Up or Down\?$/, "") || "Unknown",
          personAvatar: person.avatar || "",
          currentScore,
          baselineScore,
          startScore: baselineScore,
          change7d: Number(person.change7d || 0),
          upMultiplier,
          downMultiplier,
          endTime: "",
          totalPool: upStake + downStake + Number(m.seedVolume || 0),
          upPoolPercent: upPercent || 50,
          category: normalizeMarketCategory(m.category || person.category || "misc") as CategoryFilter,
          upEntryId: upEntry?.id,
          downEntryId: downEntry?.id,
          cadence: m.cadence || "weekly",
          tieRule: m.tieRule || "refund",
          startAt: m.startAt,
          endAt: m.endAt,
          totalBets: (Number(m.activeParticipantCount || 0) || 0) + Number(m.seedConfig?.participants || 0),
          featured: m.featured || false,
          activeParticipantCount: Number(m.activeParticipantCount || 0),
          recentParticipants: m.recentParticipants || [],
          bettingCutoff: m.bettingCutoff || null,
        } as PredictionMarket;
      });
    }
    if (import.meta.env.VITE_USE_MOCK_PREDICT_DATA === "true") return mockMarkets;
    return [];
  }, [nativeUpdownData]);

  const hydratedH2H = useMemo((): HeadToHeadMarket[] => {
    const dbMarkets = (nativeH2hData || []).filter((m: any) => m.visibility === "live");
    if (dbMarkets.length > 0) {
      return dbMarkets.map((m: any) => {
        const entries = m.entries || [];
        const e1 = entries[0] || {};
        const e2 = entries[1] || {};
        const p1 = e1.person || {};
        const p2 = e2.person || {};
        const s1 = Number(e1.totalStake || 0);
        const s2 = Number(e2.totalStake || 0);
        const total = s1 + s2 || 1;
        const totalPool = entries.reduce((sum: number, entry: any) => sum + Number(entry.totalStake || 0), 0) + Number(m.seedVolume || 0);
        return {
          id: m.id,
          title: m.title || `${p1.name || "?"} vs ${p2.name || "?"}`,
          person1: { name: p1.name || e1.label || "?", avatar: p1.avatar || "", currentScore: Number(p1.trendScore || 0) },
          person2: { name: p2.name || e2.label || "?", avatar: p2.avatar || "", currentScore: Number(p2.trendScore || 0) },
          person1EntryId: e1.id,
          person2EntryId: e2.id,
          person1EntryLabel: typeof e1.label === "string" ? e1.label : undefined,
          person2EntryLabel: typeof e2.label === "string" ? e2.label : undefined,
          person1Id: e1.personId || "",
          person2Id: e2.personId || "",
          category: normalizeMarketCategory(m.category || "misc") as CategoryFilter,
          endTime: "",
          endAt: m.endAt || null,
          totalPool,
          person1Percent: (s1 + s2) === 0 ? 50 : Math.round((s1 / total) * 100),
          totalBets: (Number(m.activeParticipantCount || 0) || 0) + Number(m.seedConfig?.participants || 0),
          activeParticipantCount: Number(m.activeParticipantCount || 0),
          recentParticipants: m.recentParticipants || [],
          bettingCutoff: m.bettingCutoff || null,
          modelP1Percent: typeof m.modelP1Percent === "number" ? m.modelP1Percent : undefined,
          modelConfidence: m.modelConfidence ?? undefined,
        } as HeadToHeadMarket;
      });
    }
    if (import.meta.env.VITE_USE_MOCK_PREDICT_DATA === "true") return headToHeadMarkets;
    return [];
  }, [nativeH2hData]);

  const hydratedGainers = useMemo((): TopGainerMarket[] => {
    const dbMarkets = (nativeGainerData || []).filter((m: any) => m.visibility === "live");
    if (dbMarkets.length > 0) {
      return dbMarkets.map((m: any) => {
        const entries = m.entries || [];
        const totalPool = entries.reduce((sum: number, entry: any) => sum + Number(entry.totalStake || 0), 0) + Number(m.seedVolume || 0);
        const openingScoresMap = new Map<string, number>();
        const rawOpeningScores = (m.metadata as any)?.openingScores;
        if (Array.isArray(rawOpeningScores)) {
          for (const os of rawOpeningScores) {
            if (os.personId && os.score > 0) openingScoresMap.set(os.personId, os.score);
          }
        }

        const allCandidates: GainerCandidate[] = entries.map((e: any) => {
          const p = e.person || {};
          const currentScore = Number(p.trendScore || 0);
          const openScore = openingScoresMap.get(e.personId || "");
          const pctGain = openScore && openScore > 0
            ? ((currentScore - openScore) / openScore) * 100
            : Number(p.change7d || 0);
          const ptsAdded = openScore && openScore > 0
            ? currentScore - openScore
            : pctGain * currentScore / 100;
          return {
            name: p.name || e.label || "?",
            avatar: p.avatar || "",
            currentGain: ptsAdded,
            percentGain: Math.round(pctGain * 10) / 10,
            rank: Number(p.rank || 0),
            entryId: e.id,
            personId: e.personId || "",
            totalStake: Number(e.totalStake || 0),
          };
        }).sort((a: GainerCandidate, b: GainerCandidate) => b.percentGain - a.percentGain);

        return {
          id: m.id,
          category: normalizeMarketCategory(m.category || "misc") as CategoryFilter,
          leaders: allCandidates.slice(0, 3),
          allCandidates,
          totalPool,
          endTime: "",
          endAt: m.endAt || null,
          totalBets: (Number(m.activeParticipantCount || 0) || 0) + Number(m.seedConfig?.participants || 0),
          totalEntries: entries.length,
          candidateCount: allCandidates.length,
          activeParticipantCount: Number(m.activeParticipantCount || 0),
          recentParticipants: m.recentParticipants || [],
          bettingCutoff: m.bettingCutoff || null,
          teaser: typeof m.teaser === "string" && m.teaser.trim() ? m.teaser.trim() : null,
        } as TopGainerMarket;
      });
    }
    if (import.meta.env.VITE_USE_MOCK_PREDICT_DATA === "true") return topGainerMarkets;
    return [];
  }, [nativeGainerData]);
  
  const [selectedJackpotPerson, setSelectedJackpotPerson] = useState<TrendingPerson | null>(null);
  const [jackpotModalOpen, setJackpotModalOpen] = useState(false);
  
  useEffect(() => {
    if (trendingPeople.length > 0 && !selectedJackpotPerson) {
      const rank1Person = trendingPeople.find(p => p.rank === 1) || trendingPeople[0];
      setSelectedJackpotPerson(rank1Person);
    }
  }, [trendingPeople, selectedJackpotPerson]);

  const predictLoadErrors = useMemo(
    () =>
      [
        trendingError,
        openMarketsError,
        updownError,
        h2hError,
        gainerError,
        jackpotError,
        recentActivityError,
      ].filter(Boolean),
    [
      trendingError,
      openMarketsError,
      updownError,
      h2hError,
      gainerError,
      jackpotError,
      recentActivityError,
    ],
  );

  const showPredictMultiFailureBanner = predictLoadErrors.length >= 2;
  const firstPredictErrorMessage =
    predictLoadErrors[0] instanceof Error ? predictLoadErrors[0].message : "";

  const refetchAllPredictData = useCallback(() => {
    return Promise.all([
      refetchTrending(),
      refetchOpenMarkets(),
      refetchUpdown(),
      refetchH2h(),
      refetchGainers(),
      refetchJackpot(),
      refetchRecentActivity(),
      ...(user ? [refetchUserBets()] : []),
    ]);
  }, [
    user,
    refetchTrending,
    refetchOpenMarkets,
    refetchUpdown,
    refetchH2h,
    refetchGainers,
    refetchJackpot,
    refetchRecentActivity,
    refetchUserBets,
  ]);

  const jackpotMarketForPerson = useMemo(() => {
    if (!selectedJackpotPerson || !nativeJackpotData) return null;
    return nativeJackpotData.find(
      (m: any) => m.personId === selectedJackpotPerson.id && m.status === "OPEN" && m.visibility === "live"
    ) || null;
  }, [selectedJackpotPerson, nativeJackpotData]);

  // Server now caps jackpot eligibility at the top N most-famous people
  // (default 20) to concentrate pool depth. The picker should mirror that —
  // anyone without an active OPEN/live jackpot market is filtered out so
  // users can't navigate to a "no market available" dead end. When the
  // server-side cap changes (JACKPOT_TOP_N env var), the picker auto-adjusts
  // because it derives eligibility from the live market list.
  const jackpotEligiblePeople = useMemo(() => {
    if (!nativeJackpotData) return [];
    const eligibleIds = new Set(
      nativeJackpotData
        .filter((m: any) => m.status === "OPEN" && m.visibility === "live")
        .map((m: any) => m.personId)
        .filter(Boolean),
    );
    return (trendingPeople || []).filter((p) => eligibleIds.has(p.id));
  }, [nativeJackpotData, trendingPeople]);

  // Defensive: if the previously-selected person dropped out of eligibility
  // (server cap changed mid-week, or rankings shifted), clear the selection
  // so the UI doesn't silently show a stale picker target.
  useEffect(() => {
    if (!selectedJackpotPerson) return;
    if (!jackpotEligiblePeople.some((p) => p.id === selectedJackpotPerson.id)) {
      setSelectedJackpotPerson(null);
    }
  }, [selectedJackpotPerson, jackpotEligiblePeople]);

  // Sync global category filter to all section filters
  useEffect(() => {
    setUpdownCategory(categoryFilter);
    setH2hCategory(categoryFilter);
    setGainerCategory(categoryFilter);
    setCommunityCategory(categoryFilter);
  }, [categoryFilter]);

  const openPredictOverlay = useCallback((category: string) => {
    window.history.pushState({ overlay: category }, "");
    setViewAllCategory(category);
  }, []);

  const closePredictOverlay = useCallback(() => {
    ["community", "weekly", "h2h", "gainers"].forEach(clearOverlayScroll);
    setViewAllCategory(null);
    window.history.back();
  }, []);

  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const overlayName = e.state?.overlay || null;
      if (overlayName?.startsWith("snap-")) {
        setSnapScrollOpen(true);
        setSnapScrollSection(overlayName.replace("snap-", "") as SnapSectionType);
      } else {
        setSnapScrollOpen(false);
        setViewAllCategory(overlayName);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const handleEnterJackpot = () => {
    if (!selectedJackpotPerson) return;
    if (!user) {
      toast("Sign in required", { description: "Sign in to place predictions." });
      navigateToLogin(setLocation);
      return;
    }
    setJackpotModalOpen(true);
  };

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

      const market = hydratedMarkets.find((m) => String(m.id) === String(variables.marketId));
      let entryLabel = "Up";
      if (market) {
        if (variables.entryId === market.downEntryId) entryLabel = "Down";
        else if (variables.entryId === market.upEntryId) entryLabel = "Up";
      }

      const seededStats = {
        total: 1,
        won: 0,
        lost: 0,
        refunded: 0,
        pending: 1,
        netCredits: 0,
        winRate: 0,
        bestCategory: null,
        currentStreak: 0,
      };

      queryClient.setQueryData(["/api/me/predictions"], (old: any) => {
        const mid = String(variables.marketId);
        const newBet = {
          betId: `optimistic-${Date.now()}`,
          marketId: mid,
          entryId: variables.entryId,
          entryLabel,
          stakeAmount: variables.stakeAmount,
          result: "pending" as const,
          payout: 0,
          direction: null,
        };
        if (old == null) {
          return { predictions: [newBet], stats: seededStats };
        }
        if (Array.isArray(old)) {
          const already = old.some((b: any) => String(b.marketId) === mid);
          return already ? old : [...old, newBet];
        }
        const preds = old.predictions ?? [];
        const already = preds.some((b: any) => String(b.marketId) === mid);
        if (already) return old;
        return { ...old, predictions: [...preds, newBet] };
      });

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

  const nativeMarketBetMutation = useMutation({
    mutationFn: async ({ marketId, entryId, stakeAmount, marketType }: { marketId: string; entryId: string; stakeAmount: number; marketType: string }) => {
      const res = await apiRequest("POST", `/api/native-markets/${marketId}/bet`, { entryId, stakeAmount });
      return res.json();
    },
    onSuccess: async (data, variables) => {
      hapticSuccess();
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      toast("Prediction placed!", { description: variables.marketType === "h2h" ? "Your head-to-head prediction has been recorded." : "Your top gainer prediction has been recorded." });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: [`/api/native-markets/${variables.marketType}`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: (err: Error) => {
      hapticError();
      toast.error("Failed to place prediction", { description: err.message });
    },
  });

  const openStakeModal = () => {
    refreshProfile?.();
    setStakeModalOpen(true);
  };

  // World/community market betting via StakeModal (mirrors native markets).
  // Replaces the previous "Yes/No on the card → URL hop → inline form" flow,
  // which lacked the credits-banner UX and produced an ugly toast on
  // insufficient funds. Now the same StakeModal that powers H2H/UpDown/Gainer
  // also handles community markets — single source of truth for the credits
  // affordance, idempotent retry path, and confetti.
  const communityMarketBetMutation = useMutation({
    mutationFn: async ({ slug, entryId, stakeAmount, direction }: { slug: string; entryId: string; stakeAmount: number; direction: "yes" | "no" }) => {
      const res = await apiRequest("POST", `/api/open-markets/${slug}/bet`, { entryId, stakeAmount, direction });
      return res.json();
    },
    onSuccess: async (data: any) => {
      hapticSuccess();
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      toast("Prediction placed!", { description: "Your world-market prediction has been recorded." });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: (err: Error) => {
      hapticError();
      toast.error("Failed to place prediction", { description: err.message });
    },
  });

  const handleCommunityPickEntry = (market: any, entry: any, direction: "yes" | "no") => {
    if (market.status !== "OPEN" || market.visibility !== "live") {
      return;
    }
    if (!user) {
      toast("Sign in required", { description: "Sign in to place predictions." });
      navigateToLogin(setLocation);
      return;
    }

    const yesStake = Number(entry.totalStake || 0);
    const noStake = Number(entry.noStake || 0);
    const entryPool = yesStake + noStake;
    const sideStake = direction === "yes" ? yesStake : noStake;
    const estimatedPayout = +(computePayoutMultiplier(entryPool, sideStake) * 0.95).toFixed(1);

    setPendingSelection({
      type: "community",
      // The StakeModal heading shows "{choice}" prominently — include
      // direction so the user can't misread which side they're betting.
      choice: `${direction === "no" ? "No" : "Yes"} \u00b7 ${entry.label}`,
      marketName: market.title,
      marketId: market.id,
      entryId: entry.id,
      estimatedPayout,
      // Community markets resolve at endAt; no separate weekly betting cutoff.
      endAt: market.endAt,
      bettingCutoff: null,
      direction,
    });
    openStakeModal();
  };

  const handleUpDownSelect = (market: PredictionMarket, choice: "up" | "down") => {
    if (isMarketClosed) {
      return;
    }
    if (!user) {
      toast("Sign in required", { description: "Sign in to place predictions." });
      navigateToLogin(setLocation);
      return;
    }

    const entryId = choice === "up" ? market.upEntryId : market.downEntryId;
    if (!entryId) {
      toast.error("Market unavailable", { description: "This market is missing required entries. Please try another market." });
      return;
    }

    setPendingSelection({
      type: "updown",
      choice: choice === "up" ? "Trend Score UP" : "Trend Score DOWN",
      marketName: market.personName,
      marketId: market.id,
      startScore: market.baselineScore,
      currentScore: market.currentScore,
      crowdSentiment: choice === "up" ? market.upPoolPercent : 100 - market.upPoolPercent,
      estimatedPayout: choice === "up" ? market.upMultiplier : market.downMultiplier,
      baselineScore: market.baselineScore,
      baselineTimestamp: market.startAt,
      tieRule: market.tieRule || "refund",
      endAt: market.endAt,
      bettingCutoff: market.bettingCutoff,
    });
    openStakeModal();
  };

  const handleH2HSelect = (market: HeadToHeadMarket, person: 1 | 2) => {
    if (isMarketClosed) {
      return;
    }
    if (!user) {
      toast("Sign in required", { description: "Sign in to place predictions." });
      navigateToLogin(setLocation);
      return;
    }

    const entryId = person === 1 ? market.person1EntryId : market.person2EntryId;
    if (!entryId) {
      toast.error("Market unavailable", { description: "This market is missing required entries. Please try another market." });
      return;
    }

    const picked = person === 1 ? market.person1 : market.person2;
    const opponent = person === 1 ? market.person2 : market.person1;
    const sentiment = person === 1 ? market.person1Percent : 100 - market.person1Percent;
    const stakePool = market.totalPool || 0;
    const pickedPool = (sentiment / 100) * stakePool;
    const estimatedPayout = computePayoutMultiplier(stakePool, pickedPool);

    setPendingSelection({
      type: "h2h",
      choice: picked.name,
      marketName: market.title,
      marketId: market.id,
      entryId,
      currentScore: picked.currentScore,
      opponentScore: opponent.currentScore,
      crowdSentiment: sentiment,
      estimatedPayout,
      endAt: serverResolutionDeadline ?? undefined,
      bettingCutoff: market.bettingCutoff,
    });
    openStakeModal();
  };

  const handleGainerSelect = (market: TopGainerMarket, candidate: GainerCandidate) => {
    if (isMarketClosed) {
      return;
    }
    if (!user) {
      toast("Sign in required", { description: "Sign in to place predictions." });
      navigateToLogin(setLocation);
      return;
    }

    if (!candidate.entryId) {
      toast.error("Market unavailable", { description: "This market is missing required entries. Please try another market." });
      return;
    }

    const categoryLabel = getMarketCategoryLabel(market.category);

    const candidateStake = Number(candidate.totalStake || 0);
    const estimatedPayout = computePayoutMultiplier(market.totalPool, candidateStake);
    const crowdSentiment = market.totalPool > 0
      ? Math.round((candidateStake / market.totalPool) * 100)
      : 0;

    setPendingSelection({
      type: "gainer",
      choice: candidate.name,
      marketName: `Category Race: ${categoryLabel}`,
      marketId: market.id,
      entryId: candidate.entryId,
      currentScore: candidate.currentGain,
      confidence: undefined,
      thesis: undefined,
      candidateRank: candidate.rank,
      candidatePercentGain: candidate.percentGain,
      candidatePointsAdded: candidate.currentGain,
      crowdSentiment,
      estimatedPayout,
      endAt: serverResolutionDeadline ?? undefined,
      bettingCutoff: market.bettingCutoff,
    });
    openStakeModal();
  };

  const openGainerPicker = (market: TopGainerMarket, initialCandidate?: GainerCandidate | null) => {
    if (isMarketClosed) {
      return;
    }
    setGainerPickerState({ market, initialCandidate });
  };

  const handleConfirmStake = async (amount: number) => {
    if (!pendingSelection || !pendingSelection.marketId) {
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }

    if (pendingSelection.type === "h2h" || pendingSelection.type === "gainer") {
      if (!pendingSelection.entryId) {
        toast.error("Selection unavailable", { description: "This market selection is not available right now." });
        return;
      }
      await nativeMarketBetMutation.mutateAsync({
        marketId: pendingSelection.marketId,
        entryId: pendingSelection.entryId,
        stakeAmount: amount,
        marketType: pendingSelection.type,
      });
      return;
    }

    if (pendingSelection.type === "community") {
      if (!pendingSelection.entryId) {
        toast.error("Selection unavailable", { description: "This market selection is not available right now." });
        return;
      }
      // Community markets aren't in `hydratedMarkets` (which is upDown-only);
      // look them up in the openMarkets list to recover the slug.
      const market = openMarkets.find((m: any) => String(m.id) === String(pendingSelection.marketId));
      if (!market?.slug) {
        toast.error("Market unavailable", { description: "Could not find the selected market. Please refresh and try again." });
        setStakeModalOpen(false);
        setPendingSelection(null);
        return;
      }
      await communityMarketBetMutation.mutateAsync({
        slug: market.slug,
        entryId: pendingSelection.entryId,
        stakeAmount: amount,
        direction: pendingSelection.direction === "no" ? "no" : "yes",
      });
      return;
    }

    if (pendingSelection.type !== "updown") {
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }

    const market = hydratedMarkets.find((m) => m.id === pendingSelection.marketId);
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

    await nativeUpdownBetMutation.mutateAsync({ marketId: market.id, entryId, stakeAmount: amount });
  };

  // Section-specific filtering logic
  const matchesCategory = (cat: CategoryFilter, marketCategory: string, personId?: string) => {
    if (cat === "all") return true;
    if (cat === "trending") return true;
    if (cat === "favorites") return !!personId && favoriteIds.has(personId);
    return normalizeMarketCategory(marketCategory) === cat;
  };

  const passesMyPositionsFilter = (marketId: string) =>
    myPositionsFilter === "all" ||
    (myPositionsFilter === "show-mine" && userBetsByMarket.has(String(marketId))) ||
    (myPositionsFilter === "hide-mine" && !userBetsByMarket.has(String(marketId)));

  // Trending sort: most bet-on first, then fall back to the subject's popularity
  // (fame / trend score). Without the fallback, early-week cards with 0 bets all
  // tie and the Trending tab becomes a no-op.
  const trendingCompare = (
    aBets: number | undefined,
    bBets: number | undefined,
    aFame: number,
    bFame: number,
  ): number => {
    const betDiff = (bBets ?? 0) - (aBets ?? 0);
    if (betDiff !== 0) return betDiff;
    return bFame - aFame;
  };
  const h2hFame = (m: HeadToHeadMarket): number =>
    (m.person1?.currentScore ?? 0) + (m.person2?.currentScore ?? 0);
  const updownFame = (m: PredictionMarket): number =>
    Number(m.currentScore ?? 0);
  const gainerFame = (m: TopGainerMarket): number =>
    (m.allCandidates || m.leaders || []).reduce(
      (best, l) => Math.max(best, Number((l as any).currentScore ?? 0)),
      Number(m.totalPool ?? 0),
    );

  const filteredUpDown = hydratedMarkets.filter(m =>
    matchesCategory(updownCategory, m.category, m.personId) &&
    (!updownSearch || m.personName.toLowerCase().includes(updownSearch.toLowerCase())) &&
    passesMyPositionsFilter(m.id)
  ).sort((a, b) => updownCategory === "trending"
    ? trendingCompare(a.totalBets, b.totalBets, updownFame(a), updownFame(b))
    : 0);

  const filteredH2H = hydratedH2H.filter(m =>
    (h2hCategory === "all" || h2hCategory === "trending" ||
     (h2hCategory === "favorites" ? (favoriteIds.has(m.person1Id || "") || favoriteIds.has(m.person2Id || "")) : matchesCategory(h2hCategory, m.category))) &&
    (!h2hSearch || m.title.toLowerCase().includes(h2hSearch.toLowerCase()) ||
     m.person1.name.toLowerCase().includes(h2hSearch.toLowerCase()) ||
     m.person2.name.toLowerCase().includes(h2hSearch.toLowerCase())) &&
    passesMyPositionsFilter(m.id)
  ).sort((a, b) => h2hCategory === "trending"
    ? trendingCompare(a.totalBets, b.totalBets, h2hFame(a), h2hFame(b))
    : 0);

  const filteredGainers = hydratedGainers.filter(m =>
    (gainerCategory === "all" || gainerCategory === "trending" ||
     (gainerCategory === "favorites" ? m.leaders.some(l => l.personId && favoriteIds.has(l.personId)) : matchesCategory(gainerCategory, m.category))) &&
    (!gainerSearch || getMarketCategoryLabel(m.category).toLowerCase().includes(gainerSearch.toLowerCase()) ||
     (m.allCandidates || m.leaders).some(l => l.name.toLowerCase().includes(gainerSearch.toLowerCase()))) &&
    passesMyPositionsFilter(m.id)
  ).sort((a, b) => gainerCategory === "trending"
    ? trendingCompare(a.totalBets, b.totalBets, gainerFame(a), gainerFame(b))
    : 0);

  const hasLiveGainers = hydratedGainers.length > 0;
  const hasInactiveOnlyGainers = (nativeGainerData || []).length > 0 && !hasLiveGainers;
  const filteredOverlayGainers = hydratedGainers
    .filter(m =>
      (overlayCategoryFilter === "all" || overlayCategoryFilter === "trending" ||
       (overlayCategoryFilter === "favorites"
         ? m.leaders.some(l => l.personId && favoriteIds.has(l.personId))
         : matchesCategory(overlayCategoryFilter, m.category))) &&
      (!overlaySearchQuery || getMarketCategoryLabel(m.category).toLowerCase().includes(overlaySearchQuery.toLowerCase()) ||
       (m.allCandidates || m.leaders).some(l => l.name.toLowerCase().includes(overlaySearchQuery.toLowerCase())))
    )
    .sort((a, b) => overlayCategoryFilter === "trending"
      ? trendingCompare(a.totalBets, b.totalBets, gainerFame(a), gainerFame(b))
      : 0);
  const gainerEmptyMessage = myPositionsFilter === "show-mine"
    ? "You don't have any active Category Race positions yet"
    : hasInactiveOnlyGainers
      ? "No live Category Races are open right now"
      : hasLiveGainers
        ? "No gainers match your filters"
        : "No Category Races are available right now";

  const filteredCommunity = openMarkets.filter((m: any) =>
    (communityCategory === "all" ||
      communityCategory === "trending" ||
      (communityCategory === "favorites"
        ? !!m.personId && favoriteIds.has(m.personId)
        : normalizeMarketCategory(m.category) === communityCategory)) &&
    (!communitySearch || m.title?.toLowerCase().includes(communitySearch.toLowerCase())) &&
    passesMyPositionsFilter(m.id)
  ).sort((a: any, b: any) => communityCategory === "trending"
    ? trendingCompare(a.totalBets, b.totalBets, Number(a.totalPool ?? a.seedVolume ?? 0), Number(b.totalPool ?? b.seedVolume ?? 0))
    : 0);

  const updownCategoryFilters = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: hydratedMarkets.map((m) => m.category),
        includeFavorites: true,
        includeTrending: true,
        selectedCategory: updownCategory,
      }).map((c) => ({ id: c.value, label: c.label })),
    [hydratedMarkets, updownCategory],
  );

  const h2hCategoryFilters = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: hydratedH2H.map((m) => m.category),
        includeFavorites: true,
        includeTrending: true,
        selectedCategory: h2hCategory,
      }).map((c) => ({ id: c.value, label: c.label })),
    [hydratedH2H, h2hCategory],
  );

  const gainerCategoryFilters = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: hydratedGainers.map((m) => m.category),
        includeFavorites: true,
        includeTrending: true,
        selectedCategory: gainerCategory,
      }).map((c) => ({ id: c.value, label: c.label })),
    [hydratedGainers, gainerCategory],
  );

  const communityCategoryFilters = useMemo(
    () =>
      buildSectionCategoryOptions({
        categories: openMarkets.map((m: any) => m.category),
        includeFavorites: true,
        includeTrending: true,
        selectedCategory: communityCategory,
      }).map((c) => ({ id: c.value, label: c.label })),
    [openMarkets, communityCategory],
  );

  useEffect(() => {
    if (!updownCategoryFilters.some((c) => c.id === updownCategory)) setUpdownCategory("all");
  }, [updownCategory, updownCategoryFilters]);

  useEffect(() => {
    if (!h2hCategoryFilters.some((c) => c.id === h2hCategory)) setH2hCategory("all");
  }, [h2hCategory, h2hCategoryFilters]);

  useEffect(() => {
    if (!gainerCategoryFilters.some((c) => c.id === gainerCategory)) setGainerCategory("all");
  }, [gainerCategory, gainerCategoryFilters]);

  useEffect(() => {
    if (!communityCategoryFilters.some((c) => c.id === communityCategory)) setCommunityCategory("all");
  }, [communityCategory, communityCategoryFilters]);

  useEffect(() => {
    const currentFilters =
      viewAllCategory === "weekly"
        ? updownCategoryFilters
        : viewAllCategory === "h2h"
          ? h2hCategoryFilters
          : viewAllCategory === "gainers"
            ? gainerCategoryFilters
            : viewAllCategory === "community"
              ? communityCategoryFilters
              : null;
    if (!currentFilters) return;
    if (!currentFilters.some((c) => c.id === overlayCategoryFilter)) {
      setOverlayCategoryFilter("all");
    }
  }, [
    viewAllCategory,
    overlayCategoryFilter,
    updownCategoryFilters,
    h2hCategoryFilters,
    gainerCategoryFilters,
    communityCategoryFilters,
  ]);

  const showSection = (type: PredictionType) => selectedType === "all" || selectedType === type;

  const worldMarketSnapItems: SnapItem[] = useMemo(
    () =>
      filteredCommunity.map((m: any) => ({
        id: String(m.id),
        slug: m.slug || String(m.id),
        category: m.category || "misc",
        title: m.title || "",
      })),
    [filteredCommunity],
  );

  const updownSnapItems: SnapItem[] = useMemo(
    () =>
      filteredUpDown.map((m: any) => ({
        id: String(m.id),
        slug: String(m.id),
        category: m.category || "misc",
        title: m.personName || "",
        personId: m.personId,
        personName: m.personName,
      })),
    [filteredUpDown],
  );

  useEffect(() => {
    if (snapScrollOpen || viewAllCategory) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [snapScrollOpen, viewAllCategory]);

  return (
    <div className="min-h-screen pb-20 md:pb-0 overflow-x-clip">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  setLocation("/");
                }
              }}
              className="md:hidden"
              aria-label="Go back"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <button 
              onClick={() => {
                setLocation("/");
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="button-logo-home"
            >
              <VoxDexLogo size={32} variant="predict" />
              <span className="font-serif font-bold text-xl hidden sm:block">VoxDex</span>
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4">
              <Link href="/#leaderboard">
                <Button variant="ghost" size="sm" className="md:text-sm">Leaderboard</Button>
              </Link>
              <Link href="/vote">
                <Button variant="ghost" size="sm" className="md:text-sm">Vote</Button>
              </Link>
              <Link href="/predict">
                <Button variant="ghost" size="sm" className="text-violet-700 dark:text-violet-500 md:text-sm">Predict</Button>
              </Link>
            </div>
            {/* TODO(phase1-revenue): wire both mobile and desktop Credits pills to
                navigate to /me/credits (or similar) for credits insights + purchase
                flow via Paystack. Plan in NOTES.md. */}
            <div className="flex items-center gap-2.5 md:hidden">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-violet-500/15 dark:bg-violet-500/10 border border-violet-500/40 dark:border-violet-500/30">
                <Wallet className="h-[14px] w-[14px] text-violet-700 dark:text-violet-500" />
                <span className="font-mono font-bold text-sm">{walletCredits.toLocaleString('en-US')}</span>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRulesModalOpen("predictions")} aria-label="View predictions rules">
                <ScrollText className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="sticky top-16 z-40 bg-background/80 backdrop-blur-xl border-b">
        <div className="container mx-auto px-4 py-3 max-w-7xl flex items-center gap-3">
          <HorizontalScroll className="pb-1 flex-1 min-w-0">
            {user && !userBetsError && (
              <button
                type="button"
                onClick={cycleMyPositionsFilter}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  myPositionsFilter === "show-mine"
                    ? "bg-violet-500/25 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 border border-violet-500/50 dark:border-violet-400/40 shadow-sm shadow-violet-500/30 dark:shadow-violet-500/20"
                    : myPositionsFilter === "hide-mine"
                      ? "bg-amber-500/15 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/50 dark:border-amber-500/40"
                      : "bg-background text-muted-foreground hover:bg-muted/40 dark:hover:bg-white/5 border border-input"
                }`}
                data-testid="toggle-my-positions-pill"
              >
                {myPositionsFilter === "hide-mine" ? (
                  <EyeOff className="h-4 w-4 shrink-0" />
                ) : (
                  <ListChecks className="h-4 w-4 shrink-0" />
                )}
                {myPositionsFilter === "hide-mine"
                  ? `Hidden (${activePredictions})`
                  : `Positions (${activePredictions})`}
              </button>
            )}
            {PREDICTION_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  selectedType === type.id
                    ? 'bg-violet-500/25 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 border border-violet-500/50 dark:border-violet-400/40 shadow-sm shadow-violet-500/30 dark:shadow-violet-500/20'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-border'
                }`}
                data-testid={`toggle-type-${type.id}`}
              >
                {type.icon}
                <span className="sm:hidden">{type.mobileLabel}</span>
                <span className="hidden sm:inline">{type.label}</span>
              </button>
            ))}
          </HorizontalScroll>
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 hidden md:inline-flex" onClick={() => setRulesModalOpen("predictions")} aria-label="View predictions rules">
                  <ScrollText className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Predictions rules</TooltipContent>
            </Tooltip>
            {user && (
              <div
                className="flex items-center gap-1.5 px-3 min-h-8 rounded-md bg-violet-500/20 dark:bg-violet-500/15 border border-violet-500/40 dark:border-violet-500/30"
                data-testid="predict-desktop-credits-pill"
              >
                <Wallet className="h-[14px] w-[14px] text-violet-700 dark:text-violet-500" />
                <span className="font-mono font-bold text-xs text-violet-700 dark:text-violet-500">{walletCredits.toLocaleString('en-US')}</span>
              </div>
            )}
          </div>
          {user && userBetsError && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchUserBets()}
              className="shrink-0 text-destructive border-destructive/50"
              data-testid="button-retry-user-bets"
            >
              Retry loading bets
            </Button>
          )}
        </div>
      </div>
      <div className="container mx-auto px-4 py-8 max-w-7xl pt-[5px] pb-[5px]">
        {showPredictMultiFailureBanner && (
          <div
            className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            role="alert"
            data-testid="predict-connection-banner"
          >
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Can&apos;t load prediction data right now
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Several requests failed at once—usually the app is restarting or there was a brief network issue.
                </p>
                {firstPredictErrorMessage ? (
                  <p className="text-xs font-mono text-muted-foreground/90 mt-2 break-all">
                    {firstPredictErrorMessage}
                  </p>
                ) : null}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-destructive/50"
              onClick={() => void refetchAllPredictData()}
              data-testid="button-retry-all-predict-data"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry all
            </Button>
          </div>
        )}
        {/* World Markets Section - First */}
        {showSection("community") && (
          <section className="mb-12 mt-[5px]">
            <UnifiedSectionHeader
              title="World Markets"
              subtitle="Predict the outcome of global events"
              icon={<Scale className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
              accent="violet"
              testId="section-header-world-markets"
              actions={
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => setRulesModalOpen("community")}
                        className="text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300"
                        aria-label="How it works"
                        data-testid="button-rules-real-world-markets"
                      >
                        <HelpCircle className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">How it works</TooltipContent>
                  </Tooltip>
                  <Button 
                    onClick={() => openSuggestModal(() => setCreateModalOpen(true))}
                    className="rounded-full bg-violet-500/15 dark:bg-violet-500/10 border border-violet-500/40 dark:border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/25 dark:hover:bg-violet-500/20 hidden md:flex"
                    data-testid="button-start-prediction"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Suggest
                  </Button>
                  <Button 
                    size="icon"
                    onClick={() => openSuggestModal(() => setCreateModalOpen(true))}
                    className="rounded-full bg-violet-500/15 dark:bg-violet-500/10 border border-violet-500/40 dark:border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/25 dark:hover:bg-violet-500/20 md:hidden"
                    data-testid="button-start-prediction-mobile"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </>
              }
            >
              <SectionFilterBar
                categoryFilter={communityCategory}
                onCategoryChange={setCommunityCategory}
                searchQuery={communitySearch}
                onSearchChange={setCommunitySearch}
                searchPlaceholder="Search predictions..."
                testIdPrefix="community"
                user={user}
                onAuthRequired={() => navigateToLogin(setLocation)}
                filters={communityCategoryFilters}
              />
            </UnifiedSectionHeader>
            {openMarketsError ? (
              <Card className="p-8 text-center">
                <p className="text-destructive mb-2">Couldn&apos;t load World Markets</p>
                <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
                <Button onClick={() => refetchOpenMarkets()} data-testid="button-retry-open-markets">
                  Retry
                </Button>
              </Card>
            ) : isLoadingOpenMarkets ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-16 rounded-md" />
                      <Skeleton className="h-5 w-20 rounded-md" />
                    </div>
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <div className="flex items-center justify-between pt-2">
                      <Skeleton className="h-8 w-24 rounded-md" />
                      <Skeleton className="h-8 w-24 rounded-md" />
                    </div>
                  </Card>
                ))}
              </div>
            ) : filteredCommunity.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-community" dotActiveColor="bg-violet-500" mobileSlideMinHeight="min-h-[420px]">
                {filteredCommunity.map((market: any) => (
                  <div key={market.id} onClick={(e) => handleCardEmptyTap(e, "world-markets", String(market.id))}>
                    <OpenMarketCard 
                      market={market} 
                      onNavigate={(slug, pick, direction) => setLocation(`/markets/${slug}${pick ? `?pick=${pick}${direction ? `&direction=${direction}` : ''}` : ''}`)}
                      onPickEntry={handleCommunityPickEntry}
                      isMarketClosed={market.status !== 'OPEN'}
                      userBetResult={userBetsByMarket.get(String(market.id))}
                      userBetsPerEntry={userBetsPerEntry.get(String(market.id))}
                      onFilterCategory={handleCategoryPillFilter}
                      categoryRaceMap={raceMap}
                      leaderboardCategories={leaderboardCats}
                      onBrowseFullScreen={isMobile ? () => openSnapScroll("world-markets", String(market.id), "browse-button") : undefined}
                    />
                  </div>
                ))}
              </CardSection>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No markets available yet
              </div>
            )}
            <div className="text-center mt-2 md:mt-6">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-violet-700 dark:text-violet-500 hover:text-violet-600 dark:hover:text-violet-400 text-[14px]"
                onClick={() => openPredictOverlay("community")}
                data-testid="button-view-all-real-world"
              >
                View All Markets
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            {/* Town Square - Daily Movers style, anchored after World Markets */}
            {recentActivityError ? (
              <div className="mt-8 mb-8">
                <Card className="p-6 text-center">
                  <p className="text-destructive mb-2">Couldn&apos;t load Town Square</p>
                  <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
                  <Button onClick={() => refetchRecentActivity()} size="sm">
                    Retry
                  </Button>
                </Card>
              </div>
            ) : recentActivity.length > 0 && (
              <div className="mt-8 mb-8 min-w-0 shrink-0 rounded-xl pulse-card-blue transition-all duration-200" data-testid="town-square-card">
                <div className={`p-4 ${townSquareCollapsed ? 'pt-4 pb-4' : 'pt-5'}`}>
                  <div
                    className="flex items-center gap-3 cursor-pointer select-none group"
                    onClick={() => setTownSquareCollapsed(!townSquareCollapsed)}
                    data-testid="town-square-header"
                  >
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center pulse-icon-blue shrink-0">
                      <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-foreground dark:text-slate-100">Town Square</h3>
                      <p className="text-[10px] text-muted-foreground dark:text-slate-500 uppercase tracking-wider">Recent prediction activity across live markets</p>
                    </div>
                    <div className={`h-6 w-6 rounded-md flex items-center justify-center bg-muted/50 dark:bg-slate-700/30 transition-transform duration-200 shrink-0 ${townSquareCollapsed ? '' : 'rotate-180'}`}>
                      <ChevronDown className="h-4 w-4 text-muted-foreground dark:text-slate-400 group-hover:text-foreground dark:group-hover:text-slate-200 transition-colors" />
                    </div>
                  </div>
                  {!townSquareCollapsed && (
                    <div className="mt-4">
                      <Card className="border-border/50 dark:border-slate-700/50 bg-muted/30 dark:bg-slate-800/30">
                        <div className="divide-y divide-border/50">
                          {recentActivity.slice(0, 8).map((item) => (
                            <div
                              key={item.id}
                              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 cursor-pointer focus-within:bg-muted/30"
                              data-testid={`recent-activity-${item.id}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setLocation(getRecentActivityMarketPath(item.marketSlug, item.marketType, item.marketId));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setLocation(getRecentActivityMarketPath(item.marketSlug, item.marketType, item.marketId));
                                }
                              }}
                            >
                              <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                <UserSocialAvatar
                                  displayName={item.displayName}
                                  avatarUrl={item.avatarUrl}
                                  isAgent={item.isAgent}
                                  className="h-9 w-9 shrink-0"
                                  onClick={item.username && item.isPublic ? () => setLocation(`/u/${item.username}`) : undefined}
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="mb-1 flex items-center gap-2 flex-wrap">
                                  <button
                                    className={`text-sm font-medium ${item.username && item.isPublic ? "hover:underline cursor-pointer" : "cursor-default"}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      item.username && item.isPublic && setLocation(`/u/${item.username}`);
                                    }}
                                    aria-disabled={!(item.username && item.isPublic)}
                                  >
                                    {item.displayName}
                                  </button>
                                  <span className="text-[11px] text-muted-foreground">{formatActivityAge(item.createdAt)}</span>
                                </div>
                                <p className="text-sm text-foreground line-clamp-1 hover:underline">
                                  backed <span className="font-semibold">{item.choiceLabel}</span> on {item.marketTitle}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {item.stakeAmount.toLocaleString("en-US")} credits{!item.isAgent && item.confidence != null ? ` • ${(item.confidence * 100).toFixed(0)}% confidence` : ""}
                                </p>
                                {item.rationale && (
                                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                    "{item.rationale}"
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-border/50 px-4 py-2.5 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setLocation("/predict/activity");
                            }}
                            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors"
                          >
                            Show more activity →
                          </button>
                        </div>
                      </Card>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        <div>
        <MarketCycleHero marketState={marketCycle} />

        {showSection("jackpot") && (
          trendingError ? (
            <Card className="p-8 text-center mb-8">
              <p className="text-destructive mb-2">Couldn&apos;t load trending data</p>
              <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
              <Button onClick={() => refetchTrending()} data-testid="button-retry-trending">Retry</Button>
            </Card>
          ) : (
            <WeeklyJackpotHero 
              onEnterJackpot={handleEnterJackpot}
              marketStatus={marketCycle.status}
              timeRemaining={marketCycle.timeRemaining}
              trendingPeople={jackpotEligiblePeople}
              selectedPerson={selectedJackpotPerson}
              onSelectPerson={setSelectedJackpotPerson}
              isLoading={isLoadingPeople || nativeJackpotData === undefined}
              jackpotMarket={jackpotMarketForPerson}
              onRulesClick={() => setRulesModalOpen("jackpot")}
            />
          )
        )}

        {showSection("updown") && (
          <section className="mb-10">
            <UnifiedSectionHeader
              title="Weekly Up / Down"
              subtitle="Will their trend score be higher / lower"
              icon={<TrendingUp className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
              accent="violet"
              testId="section-header-updown"
              actions={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => setRulesModalOpen("updown")}
                      className="text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300"
                      aria-label="How it works"
                      data-testid="button-rules-weekly-up-/-down"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">How it works</TooltipContent>
                </Tooltip>
              }
            >
              <SectionFilterBar
                categoryFilter={updownCategory}
                onCategoryChange={setUpdownCategory}
                searchQuery={updownSearch}
                onSearchChange={setUpdownSearch}
                searchPlaceholder="Search celebrities..."
                testIdPrefix="updown"
                user={user}
                onAuthRequired={() => navigateToLogin(setLocation)}
                filters={updownCategoryFilters}
              />
            </UnifiedSectionHeader>
            {updownError ? (
              <Card className="p-8 text-center">
                <p className="text-destructive mb-2">Couldn&apos;t load Up/Down markets</p>
                <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
                <Button onClick={() => refetchUpdown()} data-testid="button-retry-updown">Retry</Button>
              </Card>
            ) : updownLoading ? (
              <CardGridSkeleton count={3} />
            ) : filteredUpDown.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-updown" dotActiveColor="bg-violet-500" mobileSlideMinHeight="min-h-[420px]">
                {filteredUpDown.map((market) => (
                  <div key={market.id} onClick={(e) => handleCardEmptyTap(e, "updown", String(market.id))}>
                    <WeeklyUpDownCard 
                      market={market} 
                      isMarketClosed={isMarketClosed}
                      closedMessage={closedMarketMessage}
                      onSelect={(choice) => handleUpDownSelect(market, choice)}
                      onFilterCategory={handleCategoryPillFilter}
                      categoryRaceMap={raceMap}
                      leaderboardCategories={leaderboardCats}
                      pendingPosition={pendingWeeklyUpDownPositionFromBet(userBetsByMarket.get(String(market.id)))}
                      onBrowseFullScreen={isMobile ? () => openSnapScroll("updown", String(market.id), "browse-button") : undefined}
                    />
                  </div>
                ))}
              </CardSection>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No markets match your filters
              </div>
            )}
            <div className="text-center mt-2 md:mt-6">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-violet-700 dark:text-violet-500 hover:text-violet-600 dark:hover:text-violet-400 text-[14px]"
                onClick={() => openPredictOverlay("weekly")}
                data-testid="button-view-all-updown"
              >
                View All Markets
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </section>
        )}

        {showSection("h2h") && (
          <section className="mb-10">
            <UnifiedSectionHeader
              title="Head-to-Head Battles"
              subtitle="Who will gain more points"
              icon={<Swords className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
              accent="violet"
              testId="section-header-h2h"
              actions={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => setRulesModalOpen("h2h")}
                      className="text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300"
                      aria-label="How it works"
                      data-testid="button-rules-head-to-head-battles"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">How it works</TooltipContent>
                </Tooltip>
              }
            >
              <SectionFilterBar
                categoryFilter={h2hCategory}
                onCategoryChange={setH2hCategory}
                searchQuery={h2hSearch}
                onSearchChange={setH2hSearch}
                searchPlaceholder="Search matchups..."
                testIdPrefix="h2h"
                user={user}
                onAuthRequired={() => navigateToLogin(setLocation)}
                filters={h2hCategoryFilters}
              />
            </UnifiedSectionHeader>
            {h2hError ? (
              <Card className="p-8 text-center">
                <p className="text-destructive mb-2">Couldn&apos;t load Head-to-Head markets</p>
                <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
                <Button onClick={() => refetchH2h()} data-testid="button-retry-h2h">Retry</Button>
              </Card>
            ) : h2hLoading ? (
              <CardGridSkeleton count={3} />
            ) : filteredH2H.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-h2h" dotActiveColor="bg-violet-500" mobileSlideMinHeight="min-h-[420px]">
                {filteredH2H.map((market) => {
                  const bet = userBetsByMarket.get(String(market.id));
                  const h2hUserPick = h2hUserPickFromBet(
                    market,
                    bet ? { entryLabel: bet.entryLabel, entryId: bet.entryId } : undefined
                  );
                  return (
                    <HeadToHeadCard 
                      key={market.id}
                      market={market} 
                      isMarketClosed={isMarketClosed}
                      closedMessage={closedMarketMessage}
                      onSelect={(person) => handleH2HSelect(market, person)}
                      userPick={h2hUserPick}
                      userStake={bet?.stakeAmount}
                      onFilterCategory={handleCategoryPillFilter}
                      categoryRaceMap={raceMap}
                      leaderboardCategories={leaderboardCats}
                    />
                  );
                })}
              </CardSection>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No matchups match your filters
              </div>
            )}
            <div className="text-center mt-2 md:mt-6">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-violet-700 dark:text-violet-500 hover:text-violet-600 dark:hover:text-violet-400 text-[14px]"
                onClick={() => openPredictOverlay("h2h")}
                data-testid="button-view-all-h2h"
              >
                View All Markets
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </section>
        )}

        {showSection("gainer") && (
          <section className="mb-10">
            <UnifiedSectionHeader
              title="Category Races"
              subtitle="Pick the biggest mover in each category"
              icon={<Trophy className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
              accent="violet"
              testId="section-header-gainer"
              actions={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => setRulesModalOpen("gainer")}
                      className="text-violet-600 dark:text-violet-400 hover:text-violet-600 dark:hover:text-violet-400"
                      aria-label="How it works"
                      data-testid="button-rules-category-races"
                    >
                      <HelpCircle className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs">How it works</TooltipContent>
                </Tooltip>
              }
            >
              <SectionFilterBar
                categoryFilter={gainerCategory}
                onCategoryChange={setGainerCategory}
                searchQuery={gainerSearch}
                onSearchChange={setGainerSearch}
                searchPlaceholder="Search gainers..."
                testIdPrefix="gainer"
                user={user}
                onAuthRequired={() => navigateToLogin(setLocation)}
                filters={gainerCategoryFilters}
              />
            </UnifiedSectionHeader>
            {gainerError ? (
              <Card className="p-8 text-center">
                <p className="text-destructive mb-2">Couldn&apos;t load Category Race markets</p>
                <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
                <Button onClick={() => refetchGainers()} data-testid="button-retry-gainers">Retry</Button>
              </Card>
            ) : gainerLoading ? (
              <CardGridSkeleton count={3} />
            ) : filteredGainers.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-gainer" dotActiveColor="bg-violet-500" mobileSlideMinHeight="min-h-[420px]">
                {filteredGainers.map((market) => (
                  <TopGainerCard 
                    key={market.id}
                    market={market} 
                    isMarketClosed={isMarketClosed}
                    closedMessage={closedMarketMessage}
                    onShowAllCandidates={openGainerPicker}
                    isPredicted={predictedMarkets.has(market.id)}
                    predictionSummary={categoryRacePredictionSummaryFromBet(userBetsByMarket.get(String(market.id)))}
                    isShimmering={false}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                  />
                ))}
              </CardSection>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {gainerEmptyMessage}
              </div>
            )}
            <div className="text-center mt-2 md:mt-6">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-violet-700 dark:text-violet-500 hover:text-violet-600 dark:hover:text-violet-400 text-[14px]"
                onClick={() => openPredictOverlay("gainers")}
                data-testid="button-view-all-gainer"
              >
                View All Markets
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </section>
        )}
        </div>

        <div className="text-center pb-8">
          <button 
            onClick={() => onboardingRef.current?.open()}
            className="text-sm text-muted-foreground hover:text-violet-700 dark:hover:text-violet-500 transition-colors"
          >
            <HelpCircle className="h-4 w-4 inline mr-1" />
            How it works
          </button>
        </div>
      </div>
      <OnboardingDrawer
        ref={onboardingRef}
        storageKey="authoridex_predict_first_visit"
        steps={PREDICT_ONBOARDING_STEPS}
        toastLabel="New to predictions?"
        lastStepCta="Make Your First Prediction"
        disableAutoToast={!!user}
      />
      <FullScreenOverlay
        open={viewAllCategory === "weekly"}
        onClose={closePredictOverlay}
        title="All Weekly Up/Down Markets"
        overlayName="weekly"
        categoryFilter={overlayCategoryFilter}
        onCategoryChange={setOverlayCategoryFilter}
        searchQuery={overlaySearchQuery}
        onSearchChange={setOverlaySearchQuery}
        user={user}
        onAuthRequired={() => navigateToLogin(setLocation)}
        categories={updownCategoryFilters.map((c) => ({ value: c.id, label: c.label }))}
      >
        {hydratedMarkets
          .filter(m => 
            matchesCategory(overlayCategoryFilter, m.category, m.personId) &&
            (!overlaySearchQuery || m.personName.toLowerCase().includes(overlaySearchQuery.toLowerCase()))
          )
          .sort((a, b) => overlayCategoryFilter === "trending"
            ? trendingCompare(a.totalBets, b.totalBets, updownFame(a), updownFame(b))
            : 0)
          .map((market) => (
            <WeeklyUpDownCard 
              key={market.id} 
              market={market} 
              isMarketClosed={isMarketClosed}
              closedMessage={closedMarketMessage}
              onSelect={(choice) => handleUpDownSelect(market, choice)}
              onFilterCategory={(cat) => setOverlayCategoryFilter(normalizeMarketCategory(cat) as CategoryFilter)}
              categoryRaceMap={raceMap}
              leaderboardCategories={leaderboardCats}
              pendingPosition={pendingWeeklyUpDownPositionFromBet(userBetsByMarket.get(String(market.id)))}
            />
          ))}
      </FullScreenOverlay>
      <FullScreenOverlay
        open={viewAllCategory === "h2h"}
        onClose={closePredictOverlay}
        title="All Head-to-Head Battles"
        overlayName="h2h"
        categoryFilter={overlayCategoryFilter}
        onCategoryChange={setOverlayCategoryFilter}
        searchQuery={overlaySearchQuery}
        onSearchChange={setOverlaySearchQuery}
        user={user}
        onAuthRequired={() => navigateToLogin(setLocation)}
        categories={h2hCategoryFilters.map((c) => ({ value: c.id, label: c.label }))}
      >
        {hydratedH2H
          .filter(m => 
            (overlayCategoryFilter === "all" || overlayCategoryFilter === "trending" ||
              (overlayCategoryFilter === "favorites"
                ? (favoriteIds.has(m.person1Id || "") || favoriteIds.has(m.person2Id || ""))
                : normalizeMarketCategory(m.category) === overlayCategoryFilter)) &&
            (!overlaySearchQuery || m.title.toLowerCase().includes(overlaySearchQuery.toLowerCase()))
          )
          .sort((a, b) => overlayCategoryFilter === "trending"
            ? trendingCompare(a.totalBets, b.totalBets, h2hFame(a), h2hFame(b))
            : 0)
          .map((market) => {
            const bet = userBetsByMarket.get(String(market.id));
            const h2hUserPick = h2hUserPickFromBet(
              market,
              bet ? { entryLabel: bet.entryLabel, entryId: bet.entryId } : undefined
            );
            return (
              <HeadToHeadCard 
                key={market.id} 
                market={market} 
                isMarketClosed={isMarketClosed}
                closedMessage={closedMarketMessage}
                onSelect={(person) => handleH2HSelect(market, person)}
                userPick={h2hUserPick}
                userStake={bet?.stakeAmount}
                onFilterCategory={(cat) => setOverlayCategoryFilter(normalizeMarketCategory(cat) as CategoryFilter)}
                categoryRaceMap={raceMap}
                leaderboardCategories={leaderboardCats}
              />
            );
          })}
      </FullScreenOverlay>
      <FullScreenOverlay
        open={viewAllCategory === "gainers"}
        onClose={closePredictOverlay}
        title="All Category Races"
        overlayName="gainers"
        categoryFilter={overlayCategoryFilter}
        onCategoryChange={setOverlayCategoryFilter}
        searchQuery={overlaySearchQuery}
        onSearchChange={setOverlaySearchQuery}
        user={user}
        onAuthRequired={() => navigateToLogin(setLocation)}
        categories={gainerCategoryFilters.map((c) => ({ value: c.id, label: c.label }))}
      >
        {filteredOverlayGainers.length > 0 ? (
          filteredOverlayGainers.map((market) => (
            <TopGainerCard 
              key={market.id} 
              market={market} 
              isMarketClosed={isMarketClosed}
              closedMessage={closedMarketMessage}
              onShowAllCandidates={openGainerPicker}
              isPredicted={predictedMarkets.has(market.id)}
              predictionSummary={categoryRacePredictionSummaryFromBet(userBetsByMarket.get(String(market.id)))}
              isShimmering={false}
              onFilterCategory={(cat) => setOverlayCategoryFilter(normalizeMarketCategory(cat) as CategoryFilter)}
              categoryRaceMap={raceMap}
              leaderboardCategories={leaderboardCats}
            />
          ))
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            {gainerEmptyMessage}
          </div>
        )}
      </FullScreenOverlay>
      <FullScreenOverlay
        open={viewAllCategory === "community"}
        onClose={closePredictOverlay}
        title="All World Markets"
        overlayName="community"
        categoryFilter={overlayCategoryFilter}
        onCategoryChange={setOverlayCategoryFilter}
        searchQuery={overlaySearchQuery}
        onSearchChange={setOverlaySearchQuery}
        user={user}
        onAuthRequired={() => navigateToLogin(setLocation)}
        categories={communityCategoryFilters.map((c) => ({ value: c.id, label: c.label }))}
      >
        {openMarkets
          .filter((m: any) => 
            (overlayCategoryFilter === "all" || overlayCategoryFilter === "trending" ||
              (overlayCategoryFilter === "favorites"
                ? !!m.personId && favoriteIds.has(m.personId)
                : normalizeMarketCategory(m.category) === overlayCategoryFilter)) &&
            (!overlaySearchQuery || m.title?.toLowerCase().includes(overlaySearchQuery.toLowerCase()))
          )
          .sort((a: any, b: any) => overlayCategoryFilter === "trending"
            ? trendingCompare(a.totalBets, b.totalBets, Number(a.totalPool ?? a.seedVolume ?? 0), Number(b.totalPool ?? b.seedVolume ?? 0))
            : 0)
          .map((market: any) => (
            <OpenMarketCard 
              key={market.id} 
              market={market} 
              onNavigate={(slug, pick, direction) => setLocation(`/markets/${slug}${pick ? `?pick=${pick}${direction ? `&direction=${direction}` : ''}` : ''}`)}
              onPickEntry={handleCommunityPickEntry}
              isMarketClosed={market.status !== 'OPEN'}
              userBetResult={userBetsByMarket.get(String(market.id))}
              userBetsPerEntry={userBetsPerEntry.get(String(market.id))}
              onFilterCategory={(cat) => setOverlayCategoryFilter(normalizeMarketCategory(cat) as any)}
              categoryRaceMap={raceMap}
              leaderboardCategories={leaderboardCats}
            />
          ))}
      </FullScreenOverlay>
      <StakeModal
        open={stakeModalOpen}
        onClose={() => {
          setStakeModalOpen(false);
          setPendingSelection(null);
        }}
        selection={pendingSelection}
        onConfirm={handleConfirmStake}
        walletBalance={walletCredits}
        onChangePick={pendingSelection?.type === "gainer" ? () => {
          const market = hydratedGainers.find((item) => item.id === pendingSelection.marketId);
          if (!market) return;
          const currentCandidate = (market.allCandidates || market.leaders).find((candidate) => candidate.entryId === pendingSelection.entryId);
          setStakeModalOpen(false);
          openGainerPicker(market, currentCandidate || null);
        } : undefined}
        onDirectionChange={(dir) => {
          if (!pendingSelection) return;

          if (pendingSelection.type === "updown" && (dir === "up" || dir === "down")) {
            const market = hydratedMarkets.find(m => m.id === pendingSelection.marketId);
            if (!market) return;
            setPendingSelection({
              ...pendingSelection,
              choice: dir === "up" ? "Trend Score UP" : "Trend Score DOWN",
              crowdSentiment: dir === "up" ? market.upPoolPercent : 100 - market.upPoolPercent,
              estimatedPayout: dir === "up" ? market.upMultiplier : market.downMultiplier,
            });
            return;
          }

          if (pendingSelection.type === "community" && (dir === "yes" || dir === "no")) {
            // Recompute multiplier and label for the new side without closing
            // the modal. We re-derive from the current openMarkets snapshot so
            // a stale pendingSelection picks up any pool drift since the click.
            const market = openMarkets.find((m: any) => String(m.id) === String(pendingSelection.marketId));
            const entry = market?.entries?.find((e: any) => String(e.id) === String(pendingSelection.entryId));
            if (!market || !entry) return;
            const yesStake = Number(entry.totalStake || 0);
            const noStake = Number(entry.noStake || 0);
            const entryPool = yesStake + noStake;
            const sideStake = dir === "yes" ? yesStake : noStake;
            const estimatedPayout = +(computePayoutMultiplier(entryPool, sideStake) * 0.95).toFixed(1);
            setPendingSelection({
              ...pendingSelection,
              choice: `${dir === "no" ? "No" : "Yes"} \u00b7 ${entry.label}`,
              estimatedPayout,
              direction: dir,
            });
          }
        }}
      />
      <CreatePredictionModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />
      {(["predictions", "community", "jackpot", "updown", "h2h", "gainer"] as const).map((key) => {
        const cfg = PREDICT_RULES_STEPS[key];
        return (
          <StepModal
            key={key}
            open={rulesModalOpen === key}
            onClose={() => setRulesModalOpen(null)}
            steps={cfg.steps}
            ctaLabel={cfg.ctaLabel}
            accent={cfg.accent}
          />
        );
      })}
      <GainerCandidatesDialog
        market={gainerPickerState?.market || null}
        initialCandidate={gainerPickerState?.initialCandidate || null}
        open={!!gainerPickerState}
        onClose={() => setGainerPickerState(null)}
        onContinue={(candidate) => {
          if (gainerPickerState?.market) {
            handleGainerSelect(gainerPickerState.market, candidate);
          }
        }}
        isMarketClosed={isMarketClosed}
      />
      {selectedJackpotPerson && (
        <JackpotEntryModal
          open={jackpotModalOpen}
          onClose={() => setJackpotModalOpen(false)}
          person={selectedJackpotPerson}
          marketId={jackpotMarketForPerson?.id || null}
          userCredits={walletCredits}
          bettingCutoff={jackpotMarketForPerson?.bettingCutoff || null}
          resolveAt={jackpotMarketForPerson?.endAt || null}
          isCutoffPassed={jackpotMarketForPerson?.isCutoffPassed || false}
        />
      )}

      {/* Snap Scroll Overlays (mobile only) */}
      {isMobile && (
        <>
          <VoteSnapScrollView
            open={snapScrollOpen && snapScrollSection === "world-markets"}
            onClose={closeSnapScroll}
            sectionType="world-markets"
            commentMode="card"
            items={worldMarketSnapItems}
            initialItemId={snapScrollInitialId}
            onSuggest={() => openSuggestModal(() => setCreateModalOpen(true))}
            renderCard={(item) => {
              const market = openMarkets.find((m: any) => String(m.id) === item.id);
              if (!market) return null;
              return (
                <OpenMarketCard
                  market={market}
                  onNavigate={(slug, pick, direction) => setLocation(`/markets/${slug}${pick ? `?pick=${pick}${direction ? `&direction=${direction}` : ''}` : ''}`)}
                  onPickEntry={handleCommunityPickEntry}
                  isMarketClosed={market.status !== 'OPEN'}
                  userBetResult={userBetsByMarket.get(String(market.id))}
                  userBetsPerEntry={userBetsPerEntry.get(String(market.id))}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                />
              );
            }}
          />
          <VoteSnapScrollView
            open={snapScrollOpen && snapScrollSection === "updown"}
            onClose={closeSnapScroll}
            sectionType="updown"
            commentMode="person"
            items={updownSnapItems}
            initialItemId={snapScrollInitialId}
            onSuggest={() => openSuggestModal(() => setCreateModalOpen(true))}
            renderCard={(item) => {
              const market = filteredUpDown.find((m: any) => String(m.id) === item.id);
              if (!market) return null;
              return (
                <WeeklyUpDownCard
                  market={market}
                  isMarketClosed={isMarketClosed}
                  closedMessage={closedMarketMessage}
                  onSelect={(choice) => handleUpDownSelect(market, choice)}
                  onFilterCategory={handleCategoryPillFilter}
                  categoryRaceMap={raceMap}
                  leaderboardCategories={leaderboardCats}
                  pendingPosition={pendingWeeklyUpDownPositionFromBet(userBetsByMarket.get(String(market.id)))}
                />
              );
            }}
          />
        </>
      )}
    </div>
  );
}
