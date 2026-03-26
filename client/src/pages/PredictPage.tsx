import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { useCategoryRaceMap } from "@/hooks/useCategoryRaceMap";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import { UserMenu } from "@/components/UserMenu";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MarketCycleHero } from "@/components/MarketCycleHero";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { JackpotEntryModal } from "@/components/JackpotEntryModal";
import { RulesModal, RULES_CONTENT } from "@/components/predict/RulesContent";
import { OverlayFilterBar } from "@/components/OverlayFilterBar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { formatSignedPercent, formatSignedPoints, getRecentActivityMarketPath } from "@/lib/predict-display";
import {
  AGENT_AVATAR_FALLBACK_CLASS,
  getAvatarGradient,
  getAvatarInitials,
  HUMAN_AVATAR_FALLBACK_CLASS,
} from "@/lib/avatar";
import { useFavorites } from "@/hooks/useFavorites";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { useScrollHint } from "@/hooks/use-scroll-hint";
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
  HelpCircle,
  X,
  Check,
  ChevronRight,
  ChevronLeft,
  Clock,
  Search,
  Lock,
  Loader2,
  Sparkles,
  Crown,
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
  XCircle,
  Clapperboard,
  Gamepad2,
  UtensilsCrossed,
  Heart,
  MessageSquare,
  type LucideIcon
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation, Link } from "wouter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { CardSection } from "@/components/CardSection";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { UserSocialAvatar } from "@/components/UserSocialAvatar";
import { formatActivityAge } from "@/lib/formatDate";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { OnboardingDrawer, type OnboardingStep, type OnboardingDrawerHandle } from "@/components/OnboardingDrawer";

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

function MarketAvatar({ market }: { market: any }) {
  const imgUrl = market.coverImageUrl || market.linkedPersonAvatar;
  if (!imgUrl) return null;
  return (
    <Avatar className="h-[52px] w-[52px] shrink-0 rounded-md">
      <AvatarImage src={imgUrl} alt={market.title} className="object-cover" />
      <AvatarFallback className="text-sm rounded-md">{(market.title || "?")[0]}</AvatarFallback>
    </Avatar>
  );
}

function LinkedPersonChip({ market }: { market: any }) {
  const name = market.linkedPersonName;
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-purple-400/80 bg-purple-500/10 rounded-full px-2 py-0.5">
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
        <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 px-1.5 py-0">New</Badge>
      )}
      {daysLeft <= 7 && (
        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 px-1.5 py-0">Closing soon</Badge>
      )}
      <span className="text-[11px] text-muted-foreground">
        {daysLeft === 1 ? "Closes tomorrow" : `Closes in ${daysLeft} days`}
      </span>
    </div>
  );
}

function ParticipantAvatarStack({
  participants = [],
  totalCount = 0,
}: {
  participants?: ParticipantPreview[];
  totalCount?: number;
}) {
  if (participants.length === 0 && totalCount <= 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className="flex -space-x-2">
        {participants.slice(0, 3).map((participant) => (
          <Avatar
            key={`${participant.userId}-${participant.username || participant.displayName}`}
            className="h-6 w-6 border-2 border-background"
          >
            {participant.avatarUrl && !participant.isAgent ? (
              <AvatarImage src={participant.avatarUrl} alt={participant.displayName} />
            ) : (
              <AvatarFallback
                className={`text-[10px] ${getAvatarGradient(participant.displayName)} ${
                  participant.isAgent
                    ? AGENT_AVATAR_FALLBACK_CLASS
                    : HUMAN_AVATAR_FALLBACK_CLASS
                }`}
              >
                {getAvatarInitials(participant.displayName)}
              </AvatarFallback>
            )}
          </Avatar>
        ))}
      </div>
      <span>{totalCount} participant{totalCount === 1 ? "" : "s"}</span>
    </div>
  );
}

// Prediction Type definitions
type PredictionType = "all" | "jackpot" | "updown" | "h2h" | "gainer" | "community";
type CategoryFilter = "all" | "favorites" | "trending" | "tech" | "politics" | "business" | "music" | "sports" | "film-tv" | "gaming" | "creator" | "food-drink" | "lifestyle" | "misc";

interface PredictionMarket {
  id: string;
  personId: string;
  personName: string;
  personAvatar: string;
  currentScore: number;
  baselineScore: number;
  startScore: number;
  change7d: number;
  upMultiplier: number;
  downMultiplier: number;
  endTime: string;
  totalPool: number;
  upPoolPercent: number;
  category: CategoryFilter;
  upEntryId?: string;
  downEntryId?: string;
  cadence?: string;
  tieRule?: string;
  startAt?: string;
  endAt?: string;
  totalBets?: number;
  featured?: boolean;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
}

interface ParticipantPreview {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
}

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

interface HeadToHeadMarket {
  id: string;
  title: string;
  person1: { name: string; avatar: string; currentScore: number };
  person2: { name: string; avatar: string; currentScore: number };
  person1EntryId?: string;
  person2EntryId?: string;
  person1Id?: string;
  person2Id?: string;
  category: CategoryFilter;
  endTime: string;
  totalPool: number;
  person1Percent: number;
  totalBets?: number;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
}

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

type GainerCandidate = {
  name: string;
  avatar: string;
  currentGain: number;
  percentGain: number;
  rank?: number;
  entryId?: string;
  personId?: string;
};

interface TopGainerMarket {
  id: string;
  category: CategoryFilter;
  leaders: GainerCandidate[];
  allCandidates?: GainerCandidate[];
  totalPool: number;
  endTime: string;
  totalEntries?: number;
  candidateCount?: number;
  totalBets?: number;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
}

function smartName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  if (fullName.length <= 14) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

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

function SectionHeader({ 
  title, 
  children, 
  icon,
  onViewAll, 
  onRulesClick,
  rulesTitle 
}: { 
  title: string; 
  children?: React.ReactNode; 
  icon?: React.ReactNode;
  onViewAll?: () => void;
  onRulesClick?: () => void;
  rulesTitle?: string;
}) {
  return (
    <div className="relative mb-[15px] py-3 px-4 rounded-lg bg-gradient-to-r from-violet-500/5 via-violet-500/10 to-transparent border border-violet-500/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="h-10 w-10 rounded-lg bg-violet-500/10 hidden sm:flex items-center justify-center shrink-0">
              {icon}
            </div>
          )}
          <div>
            <h2 className="text-xl font-serif font-bold">{title}</h2>
            {children}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onRulesClick && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={onRulesClick}
                  className="text-violet-400 hover:text-violet-300"
                  aria-label="How it works"
                  data-testid={`button-rules-${title.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <HelpCircle className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="bg-slate-900/95 border-slate-700 text-slate-200 text-xs">How it works</TooltipContent>
            </Tooltip>
          )}
          {onViewAll && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-violet-500 hover:text-violet-400"
              onClick={onViewAll}
            >
              View All
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
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
  includeCustomTopic = false,
  showSearch = true
}: {
  categoryFilter: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder?: string;
  testIdPrefix: string;
  user?: any;
  onAuthRequired?: () => void;
  includeCustomTopic?: boolean;
  showSearch?: boolean;
}) {
  const dragScrollRef = useDragScroll<HTMLDivElement>();
  useScrollHint(dragScrollRef);

  const handleCategoryClick = (catId: CategoryFilter) => {
    if (catId === "favorites" && !user) {
      onAuthRequired?.();
      return;
    }
    onCategoryChange(catId);
  };

  const filters = getPredictCategoryFilters(includeCustomTopic);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
      <div ref={dragScrollRef} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 sm:pb-0">
        {filters.map((cat) => {
          const IconComponent = CATEGORY_ICONS[cat.id];
          const isIconOnly = cat.id === "favorites";
          return (
            <button
              key={cat.id}
              onClick={() => handleCategoryClick(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
                categoryFilter === cat.id
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-400/40 shadow-sm shadow-violet-500/20'
                  : 'bg-slate-800/30 border border-slate-700/40 text-slate-400 hover:border-violet-400/20'
              }`}
              data-testid={cat.id === "misc" ? `${testIdPrefix}-category-custom-topic` : `${testIdPrefix}-category-${cat.id}`}
              aria-label={isIconOnly ? cat.label : undefined}
            >
              <IconComponent className="h-3.5 w-3.5" />
              {isIconOnly ? (
                <span className="hidden md:inline">{cat.label}</span>
              ) : (
                cat.label
              )}
            </button>
          );
        })}
      </div>
      {showSearch && (
        <div className="relative sm:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 h-8 w-full sm:w-48 bg-slate-800/30 border-slate-700/40"
            data-testid={`${testIdPrefix}-search`}
          />
        </div>
      )}
    </div>
  );
}

const BASE_CATEGORY_FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "trending", label: "Trending" },
  { id: "tech", label: "Tech" },
  { id: "politics", label: "Politics" },
  { id: "business", label: "Business" },
  { id: "sports", label: "Sports" },
  { id: "music", label: "Music" },
  { id: "film-tv", label: "Film & TV" },
  { id: "gaming", label: "Gaming" },
  { id: "creator", label: "Creator" },
  { id: "food-drink", label: "Food & Drink" },
  { id: "lifestyle", label: "Lifestyle" },
];

const CATEGORY_ICONS: Record<CategoryFilter, LucideIcon> = {
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
  lifestyle: Heart,
  misc: Sparkles,
};

const CATEGORY_FILTERS_WITH_CUSTOM: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "trending", label: "Trending" },
  { id: "tech", label: "Tech" },
  { id: "politics", label: "Politics" },
  { id: "business", label: "Business" },
  { id: "sports", label: "Sports" },
  { id: "music", label: "Music" },
  { id: "film-tv", label: "Film & TV" },
  { id: "gaming", label: "Gaming" },
  { id: "creator", label: "Creator" },
  { id: "misc", label: "Misc" },
  { id: "food-drink", label: "Food & Drink" },
  { id: "lifestyle", label: "Lifestyle" },
];

const getPredictCategoryFilters = (includeCustomTopic: boolean) => 
  includeCustomTopic ? CATEGORY_FILTERS_WITH_CUSTOM : BASE_CATEGORY_FILTERS;

const CATEGORY_FILTERS = BASE_CATEGORY_FILTERS;

function PredictCard({ 
  children, 
  className = "", 
  testId,
  onClick,
  selected = false,
  inactive = false,
  inactiveMessage,
}: { 
  children: React.ReactNode; 
  className?: string; 
  testId?: string;
  onClick?: () => void;
  selected?: boolean;
  inactive?: boolean;
  inactiveMessage?: string;
}) {
  const cardContent = (
    <div 
      className={`relative group h-full overflow-visible ${onClick && !inactive ? 'cursor-pointer' : ''} ${inactive ? 'cursor-default' : ''}`}
      onClick={inactive ? undefined : onClick}
      data-testid={testId}
    >
      {/* Inset ring lives on Card so it is never clipped by grid neighbors (absolute -inset was cut off on the right of left-column cards). */}
      <Card className={`relative p-4 bg-card/95 backdrop-blur-sm transition-all h-full flex flex-col rounded-none md:rounded-xl min-h-[390px] md:min-h-0 border-0 md:border md:border-transparent shadow-none md:shadow-sm ${
        inactive 
          ? 'opacity-50 grayscale-[40%]' 
          : `md:ring-inset md:ring-1 md:ring-transparent md:transition-[box-shadow,ring-color] md:group-hover:ring-[#EFEFEF]/50 md:group-hover:shadow-lg md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] ${selected ? 'md:ring-[#EFEFEF]/50 shadow-lg shadow-[0_8px_32px_rgba(239,239,239,0.14)]' : ''}`
      } ${className}`}>
        {inactive && (
          <div className="absolute top-3 right-3 z-10">
            <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-500 bg-amber-500/10">
              <Clock className="h-3 w-3 mr-1" />
              {inactiveMessage || "Coming Soon"}
            </Badge>
          </div>
        )}
        <div className="flex flex-col flex-1">
          {children}
        </div>
      </Card>
    </div>
  );

  if (inactive) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {cardContent}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px]">
          <p className="text-xs">{inactiveMessage || "This market is coming soon. Stay tuned!"}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return cardContent;
}

function WeeklyUpDownCard({ 
  market, 
  isMarketClosed = false,
  onSelect,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: { 
  market: PredictionMarket; 
  isMarketClosed?: boolean;
  onSelect?: (choice: "up" | "down") => void;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const delta = market.currentScore - market.baselineScore;
  const pctDelta = market.baselineScore > 0 ? ((delta / market.baselineScore) * 100).toFixed(1) : "0";
  const cadenceLabel = (market.cadence || "weekly").charAt(0).toUpperCase() + (market.cadence || "weekly").slice(1);

  return (
    <PredictCard testId={`card-weekly-${market.id}`} className={`${isMarketClosed ? 'opacity-75' : ''}`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Badge 
            variant="outline" 
            className={delta >= 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}
          >
            {delta >= 0 ? "+" : ""}{pctDelta}%
          </Badge>
          <Badge variant="outline" className="text-violet-400 border-violet-500/30 text-[10px]">
            {cadenceLabel}
          </Badge>
          {market.featured && (
            <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 text-[10px]">
              <Star className="h-3 w-3 mr-0.5" />Featured
            </Badge>
          )}
          {(market.totalPool > 5000 || (market.totalBets ?? 0) > 50) && (
            <Badge variant="outline" className="text-orange-400 border-orange-500/30 text-[10px]">
              <Flame className="h-3 w-3 mr-0.5" />Hot
            </Badge>
          )}
          {market.totalPool < 100 && (
            <Badge variant="outline" className="text-amber-400 border-amber-500/30 text-[10px]">
              Thin Pool
            </Badge>
          )}
        </div>
        <InteractiveCategoryPill
          category={market.category}
          onFilter={() => onFilterCategory?.(market.category)}
          leaderboardCategories={leaderboardCategories}
          detailHref={`/predict/updown/${market.id}`}
          detailLabel="View Up/Down Details"
        />
      </div>
      
      <Link
        href={`/predict/updown/${market.id}`}
        className="block rounded-lg -mx-1 px-1 py-0.5 mb-2 hover:bg-muted/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`View details for ${market.personName} up or down market`}
      >
        <div className="flex items-center gap-3 mb-2">
          <PersonAvatar name={market.personName} avatar={market.personAvatar} className="h-20 w-20 md:h-16 md:w-16" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[18px] leading-tight">{market.personName}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Now: {market.currentScore.toLocaleString('en-US')}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-2 leading-[1.4]">
          Will <span className="font-semibold text-foreground">{market.personName.split(" ")[0]}</span> close above or below the weekly baseline?
        </p>

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0 flex-wrap">
          <span>Baseline: <span className="font-mono text-foreground">{market.baselineScore.toLocaleString('en-US')}</span></span>
          <span className="text-muted-foreground/40">&middot;</span>
          <span>Delta: <span className={`font-mono ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>{delta >= 0 ? "+" : ""}{delta.toLocaleString('en-US')}</span></span>
          <span className="text-muted-foreground/40">&middot;</span>
          <span>Pool: <span className="font-mono text-violet-400">{market.totalPool.toLocaleString('en-US')}</span></span>
        </div>
      </Link>
      
      <div className="mt-auto">
      <div className="mb-2">
        <ParticipantAvatarStack
          participants={market.recentParticipants}
          totalCount={market.totalBets ?? market.activeParticipantCount ?? 0}
        />
      </div>
      
      <div className="mb-2">
        <div className="h-2.5 rounded-full bg-red-500/20 overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all"
            style={{ width: `${market.upPoolPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] mt-1">
          <span className="text-green-500 font-semibold">Up {market.upMultiplier}x</span>
          <span className="text-red-500 font-semibold">Down {market.downMultiplier}x</span>
        </div>
      </div>
      
      <div>
        {isMarketClosed ? (
          <Button 
            className="w-full bg-muted text-muted-foreground cursor-not-allowed"
            disabled
          >
            <Lock className="h-4 w-4 mr-2" />
            Market Closed
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button 
              className="bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20 py-3 md:py-2 h-auto"
              onClick={() => onSelect?.("up")}
              data-testid={`button-up-${market.id}`}
            >
              <TrendingUp className="h-4 w-4 mr-1" />
              Up
            </Button>
            <Button 
              className="bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 py-3 md:py-2 h-auto"
              onClick={() => onSelect?.("down")}
              data-testid={`button-down-${market.id}`}
            >
              <TrendingDown className="h-4 w-4 mr-1" />
              Down
            </Button>
          </div>
        )}
      </div>
      </div>
    </PredictCard>
  );
}

function HeadToHeadCard({ 
  market, 
  isMarketClosed = false,
  onSelect,
  userPick,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: { 
  market: HeadToHeadMarket; 
  isMarketClosed?: boolean;
  onSelect?: (person: 1 | 2) => void;
  userPick?: 1 | 2 | null;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const hasPicked = userPick === 1 || userPick === 2;
  const pickedName = userPick === 1 ? market.person1.name : userPick === 2 ? market.person2.name : "";
  const scoreDiff = (market.person1.currentScore || 0) - (market.person2.currentScore || 0);
  const pickWinning = hasPicked && (
    (userPick === 1 && scoreDiff > 0) || (userPick === 2 && scoreDiff < 0)
  );
  const pickTied = hasPicked && scoreDiff === 0;

  return (
    <PredictCard testId={`card-h2h-${market.id}`} className={`relative overflow-hidden max-w-sm mx-auto ${isMarketClosed && !hasPicked ? 'opacity-75' : ''}`}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-0 top-0 w-1/2 h-full bg-gradient-to-r from-blue-600/20 to-transparent" />
        <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-purple-600/20 to-transparent" />
      </div>
      
      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs cursor-help">
                <Clock className="h-3 w-3 mr-1" />
                {market.endTime}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Market closes {market.endTime}</p>
            </TooltipContent>
          </Tooltip>
          <InteractiveCategoryPill
            category={market.category}
            onFilter={() => onFilterCategory?.(market.category)}
            leaderboardCategories={leaderboardCategories}
            detailHref={`/predict/h2h/${market.id}`}
            detailLabel="View Battle Details"
          />
        </div>
        
        <Link
          href={`/predict/h2h/${market.id}`}
          className="relative mb-3 block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:opacity-95 transition-opacity"
          style={{ padding: '0 5px' }}
          aria-label={`View battle details: ${market.person1.name} vs ${market.person2.name}`}
        >
          <div className="flex" style={{ gap: '7px' }}>
            <div
              className={`flex-1 relative ${hasPicked && userPick !== 1 ? 'opacity-50' : ''}`}
            >
              <div className={`absolute -inset-4 rounded-md blur-lg pointer-events-none transition-opacity ${hasPicked && userPick === 1 ? 'bg-green-500/20' : 'bg-blue-500/20'}`} />
              <div className={`rounded-lg overflow-hidden transition-all ${hasPicked && userPick === 1 ? 'ring-2 ring-green-500/70' : 'ring-2 ring-transparent'}`}>
                <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} className="h-auto w-full aspect-[4/5]" />
              </div>
              {hasPicked && userPick === 1 && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10">
                  <span className="bg-green-600/90 text-white text-[8px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider whitespace-nowrap flex items-center gap-0.5">
                    <Check className="h-2.5 w-2.5" />
                    Your Pick
                  </span>
                </div>
              )}
            </div>
            <div
              className={`flex-1 relative ${hasPicked && userPick !== 2 ? 'opacity-50' : ''}`}
            >
              <div className={`absolute -inset-4 rounded-md blur-lg pointer-events-none transition-opacity ${hasPicked && userPick === 2 ? 'bg-green-500/20' : 'bg-purple-500/20'}`} />
              <div className={`rounded-lg overflow-hidden transition-all ${hasPicked && userPick === 2 ? 'ring-2 ring-green-500/70' : 'ring-2 ring-transparent'}`}>
                <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} className="h-auto w-full aspect-[4/5]" />
              </div>
              {hasPicked && userPick === 2 && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10">
                  <span className="bg-green-600/90 text-white text-[8px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider whitespace-nowrap flex items-center gap-0.5">
                    <Check className="h-2.5 w-2.5" />
                    Your Pick
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
            <div className="h-14 w-14 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
              <span className="text-sm font-bold text-slate-200">VS</span>
            </div>
          </div>
        </Link>
        
        <div className="flex items-center justify-between px-2 mb-2">
          <div
            className={`flex flex-col items-center flex-1 ${!isMarketClosed && !hasPicked ? 'cursor-pointer hover:opacity-80' : ''} transition-opacity`}
            onClick={() => !isMarketClosed && !hasPicked && onSelect?.(1)}
          >
            <p className="text-sm font-semibold text-center">{smartName(market.person1.name)}</p>
            <span className="text-[10px] font-mono text-muted-foreground">{market.person1.currentScore?.toLocaleString('en-US') || ''}</span>
            <span className="text-xs text-blue-400 font-semibold">{market.person1Percent}%</span>
          </div>
          <div
            className={`flex flex-col items-center flex-1 ${!isMarketClosed && !hasPicked ? 'cursor-pointer hover:opacity-80' : ''} transition-opacity`}
            onClick={() => !isMarketClosed && !hasPicked && onSelect?.(2)}
          >
            <p className="text-sm font-semibold text-center">{smartName(market.person2.name)}</p>
            <span className="text-[10px] font-mono text-muted-foreground">{market.person2.currentScore?.toLocaleString('en-US') || ''}</span>
            <span className="text-xs text-purple-400 font-semibold">{100 - market.person1Percent}%</span>
          </div>
        </div>
        
        <div className="h-2 rounded-full overflow-hidden mb-2 flex">
          <div 
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400"
            style={{ width: `${market.person1Percent}%` }}
          />
          <div 
            className="h-full bg-gradient-to-l from-purple-500 to-purple-400"
            style={{ width: `${100 - market.person1Percent}%` }}
          />
        </div>
        
        <div className="flex items-center justify-center mb-2">
          <span className="text-sm font-semibold text-violet-500">
            Pool: {market.totalPool.toLocaleString('en-US')}
          </span>
        </div>
        
        <div className="mt-auto">
          {hasPicked ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground">Your pick</p>
                <p className="text-sm font-semibold truncate">{smartName(pickedName)}</p>
              </div>
              <Badge
                className={
                  pickWinning
                    ? "bg-green-600/20 text-green-500 border-green-500/30"
                    : pickTied
                    ? "bg-amber-600/20 text-amber-500 border-amber-500/30"
                    : "bg-red-600/20 text-red-500 border-red-500/30"
                }
              >
                {pickWinning ? "Winning" : pickTied ? "Tied" : "Behind"}
              </Badge>
            </div>
          ) : isMarketClosed ? (
            <Button 
              className="w-full bg-muted text-muted-foreground cursor-not-allowed"
              disabled
            >
              <Lock className="h-4 w-4 mr-2" />
              Awaiting Results
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button 
                className="bg-[#3B82F6]/10 border border-[#3B82F6]/50 text-[#3B82F6] hover:border-[#3B82F6]/80 hover:bg-[#3B82F6]/20 py-3 md:py-2 h-auto"
                onClick={() => onSelect?.(1)}
                data-testid={`button-pick1-${market.id}`}
              >
                {smartName(market.person1.name)}
              </Button>
              <Button 
                className="bg-[#7C3AED]/10 border border-[#7C3AED]/50 text-[#7C3AED] hover:border-[#7C3AED]/80 hover:bg-[#7C3AED]/20 py-3 md:py-2 h-auto"
                onClick={() => onSelect?.(2)}
                data-testid={`button-pick2-${market.id}`}
              >
                {smartName(market.person2.name)}
              </Button>
            </div>
          )}
        </div>
      </div>
    </PredictCard>
  );
}

function TopGainerCard({ 
  market, 
  isMarketClosed = false,
  onShowAllCandidates,
  isPredicted = false,
  isShimmering = false,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: { 
  market: TopGainerMarket; 
  isMarketClosed?: boolean;
  onShowAllCandidates?: (market: TopGainerMarket, initialCandidate?: GainerCandidate) => void;
  isPredicted?: boolean;
  isShimmering?: boolean;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const visibleCandidateCount = market.candidateCount ?? market.allCandidates?.length ?? market.totalEntries ?? market.leaders.length;
  const canPick = !isMarketClosed && !isPredicted;

  const handlePlacePrediction = () => {
    onShowAllCandidates?.(market);
  };

  return (
    <PredictCard testId={`card-gainer-${market.id}`} className={`${isMarketClosed ? 'opacity-75' : ''} ${isShimmering ? 'shimmer-once' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground flex items-center gap-1 cursor-help border-b border-dashed border-muted-foreground/40">
              <TrendingUp className="h-3 w-3" />
              Biggest Mover Wins
              <HelpCircle className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[240px]">
            <p className="text-xs">Pick who will have the highest % gain in their Trend Score this week. The biggest mover wins, not the highest ranked.</p>
          </TooltipContent>
        </Tooltip>
        <InteractiveCategoryPill
          category={market.category}
          onFilter={() => onFilterCategory?.(market.category)}
          raceMarketId={categoryRaceMap?.get(normalizeMarketCategory(market.category))}
          leaderboardCategories={leaderboardCategories}
        />
      </div>
      
      <Link
        href={`/predict/race/${market.id}`}
        className="text-[16px] font-semibold mb-2 leading-[1.4] inline-flex items-center gap-1 text-foreground hover:text-violet-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
      >
        Category Race: {getMarketCategoryLabel(market.category)}
        <span className="text-violet-400 font-normal" aria-hidden>
          ›
        </span>
      </Link>
      
      <div className="space-y-1.5 mb-3">
        {(() => {
          const maxGain = Math.max(...market.leaders.map(l => Math.abs(l.percentGain)), 1);
          return market.leaders.map((leader, i) => (
            <div 
              key={leader.name} 
              className={`flex items-center gap-2.5 p-2 rounded-lg transition-colors relative overflow-hidden ${canPick ? 'cursor-pointer' : ''} ${i === 0 ? 'bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/30' : canPick ? 'hover:bg-muted/50' : ''}`}
              onClick={() => {
                if (!canPick) return;
                onShowAllCandidates?.(market, leader);
              }}
            >
              <div className="absolute inset-y-0 left-0 bg-green-500/8 transition-all" style={{ width: `${Math.max((Math.abs(leader.percentGain) / maxGain) * 100, 5)}%` }} />
              <div className="relative flex items-center gap-2.5 flex-1 min-w-0">
                {i === 0 ? (
                  <div className="h-6 w-6 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center shrink-0">
                    <Crown className="h-3.5 w-3.5 text-amber-400" />
                  </div>
                ) : (
                  <div className="h-6 w-6 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-violet-400">#{leader.rank || (i + 1)}</span>
                  </div>
                )}
                <PersonAvatar name={leader.name} avatar={leader.avatar} className="h-12 w-12" />
                <span className="text-sm font-medium flex-1 truncate">{leader.name}</span>
              </div>
              <div className="relative text-right shrink-0">
                <p className={`text-sm font-mono font-bold ${leader.percentGain >= 0 ? 'text-green-500' : 'text-red-500'}`}>{formatSignedPercent(leader.percentGain)}</p>
                <p className={`text-[10px] font-mono ${leader.currentGain >= 0 ? 'text-muted-foreground' : 'text-red-400/80'}`}>
                  {formatSignedPoints(leader.currentGain)} pts added
                </p>
              </div>
            </div>
          ));
        })()}
        {visibleCandidateCount > 3 && (
          <button
            className="text-xs text-violet-400 hover:text-violet-300 text-center mt-1 w-full cursor-pointer transition-colors"
            onClick={(e) => { e.stopPropagation(); onShowAllCandidates?.(market); }}
          >
            View all {visibleCandidateCount} candidates
          </button>
        )}
      </div>
      
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-violet-500">
          Pool: {market.totalPool.toLocaleString('en-US')}
        </span>
      </div>
      
      <div className="mt-auto space-y-2">
        {isPredicted ? (
          <Button 
            className="w-full bg-green-600/20 text-green-500 border border-green-500/30 py-3 md:py-2 h-auto"
            disabled
          >
            Predicted
          </Button>
        ) : isMarketClosed ? (
          <Button 
            className="w-full bg-muted text-muted-foreground cursor-not-allowed"
            disabled
          >
            <Lock className="h-4 w-4 mr-2" />
            Awaiting Results
          </Button>
        ) : (
          <Button 
            className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-3 md:py-2 h-auto"
            data-testid={`button-place-prediction-${market.id}`}
            onClick={handlePlacePrediction}
          >
            Choose Candidate
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </PredictCard>
  );
}

function GainerCandidatesDialog({
  market,
  open,
  initialCandidate,
  onClose,
  onContinue,
}: {
  market: TopGainerMarket | null;
  open: boolean;
  initialCandidate?: GainerCandidate | null;
  onClose: () => void;
  onContinue: (candidate: GainerCandidate) => void;
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

        <div className="shrink-0 px-4 pb-3 space-y-2">
          <div className="rounded-md bg-violet-500/5 border border-violet-500/15 px-3 py-2">
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
            {candidates.length} candidates &middot; Tap to pick, then continue
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <div className="space-y-1.5">
            {filteredCandidates.map((candidate, idx) => {
              const candidateKey = candidate.entryId || candidate.personId || candidate.name;
              const isSelected = candidateKey === selectedCandidateKey;
              const isLeader = idx === 0 && !searchQuery;

              return (
                <button
                  type="button"
                  key={candidateKey}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                    isSelected
                      ? "border-violet-500/60 bg-violet-500/10"
                      : isLeader
                        ? "border-amber-500/30 hover:bg-amber-500/5"
                        : "border-transparent hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedCandidateKey(candidateKey)}
                >
                  <div className="w-6 shrink-0 text-center">
                    {isLeader ? (
                      <div className="inline-flex h-5 w-5 rounded-full bg-background/80 border border-amber-500/50 items-center justify-center">
                        <Crown className="h-3 w-3 text-amber-500" />
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-violet-500">#{candidate.rank || (idx + 1)}</span>
                    )}
                  </div>
                  <PersonAvatar name={candidate.name} avatar={candidate.avatar} size="sm" />
                  <span className="text-sm flex-1 truncate">{candidate.name}</span>
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-mono font-bold ${candidate.percentGain >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {formatSignedPercent(candidate.percentGain)}
                    </p>
                    <p className={`text-[10px] font-mono ${candidate.currentGain >= 0 ? "text-muted-foreground" : "text-red-400/80"}`}>
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

function PayoutDetails({ marketId }: { marketId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{ totalPool: number; userStake: number; winnerPoolTotal: number; userPayout: number; remainderPolicy: string }>({
    queryKey: ['/api/markets', marketId, 'my-payout'],
    enabled: open,
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[10px] text-muted-foreground underline underline-offset-2 mt-1" data-testid="button-payout-details">
        View details
      </button>
    );
  }

  return (
    <div className="mt-1.5 text-[10px] text-muted-foreground space-y-0.5 border-t border-border/50 pt-1.5" data-testid="section-payout-details">
      {isLoading ? (
        <span>Loading...</span>
      ) : data ? (
        (() => {
          const netPL = data.userPayout - data.userStake;
          const plColor = netPL > 0 ? 'text-emerald-400' : netPL < 0 ? 'text-red-400' : 'text-muted-foreground';
          const plSign = netPL > 0 ? '+' : '';
          return (
            <>
              <div className="flex items-center justify-between gap-2"><span>Your stake</span><span className="font-mono">{data.userStake.toLocaleString()}</span></div>
              <div className="flex items-center justify-between gap-2"><span>Your payout</span><span className="font-mono font-semibold">{data.userPayout.toLocaleString()}</span></div>
              <div className="flex items-center justify-between gap-2"><span>Net P&L</span><span className={`font-mono font-semibold ${plColor}`}>{plSign}{netPL.toLocaleString()}</span></div>
              <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-border/30"><span>Total pool</span><span className="font-mono">{data.totalPool.toLocaleString()}</span></div>
              {data.winnerPoolTotal > 0 && <div className="flex items-center justify-between gap-2"><span>Winner pool</span><span className="font-mono">{data.winnerPoolTotal.toLocaleString()}</span></div>}
            </>
          );
        })()
      ) : (
        <span>Could not load details</span>
      )}
    </div>
  );
}

function UserBetResult({ betResult, isMarketClosed = false }: { betResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number; marketId?: string }; isMarketClosed?: boolean }) {
  if (!betResult) return null;
  if (betResult.result === 'pending') {
    if (!isMarketClosed) return null;
    return (
      <div className="flex items-center gap-2 text-xs font-semibold px-2 py-1.5 rounded-md mt-2 bg-muted/50 text-muted-foreground" data-testid="text-bet-awaiting">
        <Clock className="h-3.5 w-3.5" />
        Awaiting Results
        <span className="font-normal ml-auto">Picked: {betResult.entryLabel}</span>
      </div>
    );
  }
  const isResolved = betResult.result === 'won' || betResult.result === 'lost';
  return (
    <div>
      <div className={`flex items-center gap-2 text-xs font-semibold px-2 py-1.5 rounded-md mt-2 ${
        betResult.result === 'won' ? 'bg-emerald-500/10 text-emerald-400' :
        betResult.result === 'refunded' ? 'bg-yellow-500/10 text-yellow-400' :
        'bg-red-500/10 text-red-400'
      }`} data-testid="text-bet-result">
        {betResult.result === 'won' && <Trophy className="h-3.5 w-3.5" />}
        {betResult.result === 'lost' && <XCircle className="h-3.5 w-3.5" />}
        {betResult.result === 'refunded' && <RotateCcw className="h-3.5 w-3.5" />}
        {betResult.result === 'won' ? `Won +${betResult.payout} credits` :
         betResult.result === 'refunded' ? `Refunded ${betResult.stakeAmount} credits` :
         `Lost ${betResult.stakeAmount} credits`}
        <span className="text-muted-foreground font-normal ml-auto">Picked: {betResult.entryLabel}</span>
      </div>
      {isResolved && betResult.marketId && <PayoutDetails marketId={betResult.marketId} />}
    </div>
  );
}

function OpenMarketCard({ market, onNavigate, isMarketClosed = false, userBetResult, onFilterCategory, categoryRaceMap, leaderboardCategories }: { market: any; onNavigate: (slug: string, pick?: string, direction?: string) => void; isMarketClosed?: boolean; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string> }) {
  const entries = market.entries || [];
  const isCommunity = market.marketType === "community";
  const totalStake = entries.reduce((sum: number, e: any) => sum + (e.totalStake || 0), 0);
  const totalPool = isCommunity ? totalStake : totalStake + Number(market.seedVolume || 0);
  const participants = market.activeParticipantCount || market.betCount || 0;
  const isInactive = market.visibility === "inactive";
  
  const endDate = market.endAt ? new Date(market.endAt) : null;
  const now = new Date();
  const daysLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;
  const timeLabel = daysLeft > 1 ? `${daysLeft}d left` : daysLeft === 1 ? "1d left" : "Closing soon";

  if (market.openMarketType === "updown") {
    return <UpDownMarketCard market={market} entries={entries} totalPool={totalPool} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} userBetResult={userBetResult} onFilterCategory={onFilterCategory} categoryRaceMap={categoryRaceMap} leaderboardCategories={leaderboardCategories} />;
  }
  if (market.openMarketType === "multi") {
    return <MultiMarketCard market={market} entries={entries} totalPool={totalPool} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} userBetResult={userBetResult} onFilterCategory={onFilterCategory} categoryRaceMap={categoryRaceMap} leaderboardCategories={leaderboardCategories} />;
  }
  return <BinaryMarketCard market={market} entries={entries} totalPool={totalPool} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} userBetResult={userBetResult} onFilterCategory={onFilterCategory} categoryRaceMap={categoryRaceMap} leaderboardCategories={leaderboardCategories} />;
}

function BinaryMarketCard({ market, entries, totalPool, participants, timeLabel, onNavigate, isMarketClosed, isInactive = false, inactiveMessage, userBetResult, onFilterCategory, categoryRaceMap, leaderboardCategories }: { market: any; entries: any[]; totalPool: number; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string, direction?: string) => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string> }) {
  const yesEntry = entries.find((e: any) => e.label === "Yes") || entries[0];
  const noEntry = entries.find((e: any) => e.label === "No") || entries[1];
  const yesStake = yesEntry?.totalStake || 0;
  const noStake = noEntry?.totalStake || 0;
  const total = yesStake + noStake || 1;
  const yesPercent = Math.round((yesStake / total) * 100);
  const noPercent = 100 - yesPercent;
  
  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {timeLabel}
        </Badge>
        {market.category && <InteractiveCategoryPill category={market.category} onFilter={() => onFilterCategory?.(market.category)} leaderboardCategories={leaderboardCategories} detailHref={`/markets/${market.slug}`} detailLabel="View Market Details" />}
      </div>
      
      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <div className="flex items-center gap-3 mb-2">
          <MarketAvatar market={market} />
          <p className={`text-[16px] leading-[1.4] font-semibold line-clamp-2 ${isInactive ? '' : 'hover:text-violet-400'} transition-colors`}>{market.title}</p>
        </div>
      </a>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <LinkedPersonChip market={market} />
        <FreshnessBadge market={market} />
      </div>
      {market.teaser && <p className="text-sm text-muted-foreground mb-3 line-clamp-2 leading-[1.4]">{market.teaser}</p>}
      
      {/* Mobile: mt-2 only — avoids a large empty band between teaser and split bar (md+ keeps mt-auto spacer) */}
      <div className="mt-2 md:mt-auto md:pt-1">
        <div className="mb-2 md:mb-3">
          <ParticipantAvatarStack participants={market.recentParticipants} totalCount={participants} />
        </div>
        
        <div className="mb-2 md:mb-3">
          <div className="h-3 rounded-full bg-red-500/20 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all" style={{ width: `${yesPercent}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs mt-1.5">
            <span className="text-green-500 font-semibold">Yes {yesPercent}%</span>
            <span className="text-red-500 font-semibold">No {noPercent}%</span>
          </div>
        </div>
      </div>
      
      <div className="max-md:mt-1">
        <div className="flex items-center justify-center mb-1.5">
          <span className="text-sm font-semibold text-muted-foreground">Pool: {totalPool.toLocaleString('en-US')}</span>
        </div>
        
        {isMarketClosed ? (
          <Button className="w-full bg-muted text-muted-foreground cursor-not-allowed" disabled>
            <Lock className="h-4 w-4 mr-2" />
            Closed
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {/* Match UnderratedOverratedCard mobile tap targets: py-3.5; compact on md+ */}
            <Button
              className="!min-h-0 px-4 py-3.5 md:py-2.5 bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
              onClick={() => onNavigate(market.slug, 'yes')}
              data-testid={`button-yes-${market.slug}`}
            >
              Yes {yesPercent}%
            </Button>
            <Button
              className="!min-h-0 px-4 py-3.5 md:py-2.5 bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
              onClick={() => onNavigate(market.slug, 'no')}
              data-testid={`button-no-${market.slug}`}
            >
              No {noPercent}%
            </Button>
          </div>
        )}
        <UserBetResult betResult={userBetResult} isMarketClosed={isMarketClosed} />
      </div>
    </PredictCard>
  );
}

function MultiMarketCard({ market, entries, totalPool, participants, timeLabel, onNavigate, isMarketClosed, isInactive = false, inactiveMessage, userBetResult, onFilterCategory, categoryRaceMap, leaderboardCategories }: { market: any; entries: any[]; totalPool: number; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string, direction?: string) => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string> }) {
  const totalEntryStake = entries.reduce((sum: number, e: any) => sum + (e.totalStake || 0), 0) || 1;
  const rankedEntries = [...entries]
    .map((e: any) => ({ ...e, pct: Math.round(((e.totalStake || 0) / totalEntryStake) * 100) }))
    .sort((a: any, b: any) => b.pct - a.pct);

  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {timeLabel}
        </Badge>
        {market.category && <InteractiveCategoryPill category={market.category} onFilter={() => onFilterCategory?.(market.category)} leaderboardCategories={leaderboardCategories} detailHref={`/markets/${market.slug}`} detailLabel="View Market Details" />}
      </div>

      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <div className="flex items-center gap-3 mb-2">
          <MarketAvatar market={market} />
          <p className={`text-[16px] leading-[1.4] font-semibold line-clamp-2 ${isInactive ? '' : 'hover:text-violet-400'} transition-colors`}>{market.title}</p>
        </div>
      </a>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <LinkedPersonChip market={market} />
        <FreshnessBadge market={market} />
      </div>
      {market.teaser && (
        <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
          <p className={`text-sm text-muted-foreground mb-3 line-clamp-2 leading-[1.4] ${!isInactive ? 'hover:text-violet-400' : ''} transition-colors`}>{market.teaser}</p>
        </a>
      )}

      <div className="mb-3 flex items-center gap-2">
        <ParticipantAvatarStack participants={market.recentParticipants} totalCount={participants} />
        <Badge variant="outline" className="text-[10px] ml-auto">{entries.length} options</Badge>
      </div>

      <div className="space-y-1.5 mb-2">
        {rankedEntries.slice(0, 4).map((entry: any) => {
          const noPct = 100 - entry.pct;
          return (
            <div key={entry.id} className="flex items-center gap-2">
              {entry.imageUrl ? (
                <Avatar className="h-7 w-7 shrink-0 rounded-md">
                  <AvatarImage src={entry.imageUrl} alt={entry.label} className="object-cover" />
                  <AvatarFallback className="text-[9px] rounded-md">{entry.label?.[0]}</AvatarFallback>
                </Avatar>
              ) : (
                <div className="h-7 w-7 shrink-0 rounded-md bg-muted/40 flex items-center justify-center">
                  <span className="text-[10px] font-semibold text-muted-foreground">{entry.label?.[0]}</span>
                </div>
              )}
              <span className="text-[13px] font-medium truncate flex-1 min-w-0">{entry.label}</span>
              <span className="text-[13px] font-mono font-semibold text-muted-foreground w-9 text-right shrink-0">{entry.pct}%</span>
              {!isMarketClosed ? (
                <div className="flex gap-1 shrink-0">
                  <button
                    className="px-2 py-1 text-[11px] font-semibold rounded bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); onNavigate(market.slug, entry.id, 'yes'); }}
                    data-testid={`button-yes-${entry.id}`}
                  >
                    Yes
                  </button>
                  <button
                    className="px-2 py-1 text-[11px] font-semibold rounded bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 transition-colors"
                    onClick={(e) => { e.stopPropagation(); onNavigate(market.slug, entry.id, 'no'); }}
                    data-testid={`button-no-${entry.id}`}
                  >
                    No
                  </button>
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground shrink-0 w-14 text-right">{noPct}% No</span>
              )}
            </div>
          );
        })}
        {entries.length > 4 && <button className="text-xs text-violet-400 hover:text-violet-300 text-center mt-1 w-full cursor-pointer transition-colors font-medium" onClick={(e) => { e.stopPropagation(); onNavigate(market.slug); }}>+{entries.length - 4} more</button>}
      </div>

      <div className="mt-auto">
        <div className="flex items-center justify-center mb-1">
          <span className="text-sm font-semibold text-muted-foreground">Pool: {totalPool.toLocaleString('en-US')}</span>
        </div>
        <UserBetResult betResult={userBetResult} isMarketClosed={isMarketClosed} />
      </div>
    </PredictCard>
  );
}

function UpDownMarketCard({ market, entries, totalPool, participants, timeLabel, onNavigate, isMarketClosed, isInactive = false, inactiveMessage, userBetResult, onFilterCategory, categoryRaceMap, leaderboardCategories }: { market: any; entries: any[]; totalPool: number; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string, direction?: string) => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string> }) {
  const aboveEntry = entries.find((e: any) => e.label === "Above") || entries[0];
  const belowEntry = entries.find((e: any) => e.label === "Below") || entries[1];
  const aboveStake = aboveEntry?.totalStake || 0;
  const belowStake = belowEntry?.totalStake || 0;
  const total = aboveStake + belowStake || 1;
  const abovePercent = Math.round((aboveStake / total) * 100);
  const belowPercent = 100 - abovePercent;
  
  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {timeLabel}
        </Badge>
        {market.category && <InteractiveCategoryPill category={market.category} onFilter={() => onFilterCategory?.(market.category)} leaderboardCategories={leaderboardCategories} detailHref={`/markets/${market.slug}`} detailLabel="View Market Details" />}
      </div>
      
      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <div className="flex items-center gap-3 mb-2">
          <MarketAvatar market={market} />
          <p className={`text-[16px] leading-[1.4] font-semibold line-clamp-2 ${isInactive ? '' : 'hover:text-violet-400'} transition-colors`}>{market.title}</p>
        </div>
      </a>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <LinkedPersonChip market={market} />
        <FreshnessBadge market={market} />
      </div>
      {market.teaser && <p className="text-sm text-muted-foreground mb-3 line-clamp-2 leading-[1.4]">{market.teaser}</p>}
      
      {market.underlying && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          <div className="text-xs">
            <span className="text-muted-foreground">{market.underlying} {market.metric}: </span>
            <span className="font-semibold">{market.unit}{Number(market.strike).toLocaleString('en-US')}</span>
          </div>
        </div>
      )}
      
      <div className="mt-auto pt-1">
        <div className="mb-2">
          <ParticipantAvatarStack participants={market.recentParticipants} totalCount={participants} />
        </div>
        
        <div className="mb-2">
          <div className="h-3 rounded-full bg-red-500/20 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all" style={{ width: `${abovePercent}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs mt-1.5">
            <span className="text-green-500 font-semibold">Above {abovePercent}%</span>
            <span className="text-red-500 font-semibold">Below {belowPercent}%</span>
          </div>
        </div>
      </div>
      
      <div>
        <div className="flex items-center justify-center mb-1.5">
          <span className="text-sm font-semibold text-muted-foreground">Pool: {totalPool.toLocaleString('en-US')}</span>
        </div>
        
        {isMarketClosed ? (
          <Button className="w-full bg-muted text-muted-foreground cursor-not-allowed" disabled>
            <Lock className="h-4 w-4 mr-2" />
            Closed
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button className="bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20" onClick={() => onNavigate(market.slug, 'above')} data-testid={`button-above-${market.slug}`}>
              Above {abovePercent}%
            </Button>
            <Button className="bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20" onClick={() => onNavigate(market.slug, 'below')} data-testid={`button-below-${market.slug}`}>
              Below {belowPercent}%
            </Button>
          </div>
        )}
        <UserBetResult betResult={userBetResult} isMarketClosed={isMarketClosed} />
      </div>
    </PredictCard>
  );
}

function SuggestMarketCard({ onClick }: { onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className="border-2 border-dashed border-violet-500/30 rounded-xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#EFEFEF] hover:bg-[#EFEFEF]/5 transition-all min-h-[200px]"
      data-testid="card-suggest-market"
    >
      <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center">
        <Plus className="h-6 w-6 text-violet-500" />
      </div>
      <p className="text-sm font-medium text-violet-500">Suggest a Market</p>
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
  overlayName
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
  
  const predictCategories = CATEGORY_FILTERS.map((c) => ({ value: c.id, label: c.label }));
  
  return (
    <div ref={scrollRef} onScroll={(e) => saveOverlayScroll(overlayName, e.currentTarget.scrollTop)} className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto premium-scrollbar" data-testid="overlay-view-all">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif font-bold text-xl">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" data-testid="button-close-overlay">
              <X className="h-5 w-5" />
            </Button>
          </div>
          
          <OverlayFilterBar
            value={categoryFilter}
            onChange={(v) => onCategoryChange(v as CategoryFilter)}
            searchValue={searchQuery}
            onSearchChange={onSearchChange}
            categories={predictCategories}
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


function CreatePredictionModal({
  open,
  onClose,
  onSubmit
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { title: string; type: string; category: CategoryFilter; description: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("binary");
  const [category, setCategory] = useState<CategoryFilter>("tech");
  const [description, setDescription] = useState("");
  
  const handleSubmit = () => {
    if (title.trim() && description.trim()) {
      onSubmit({ title, type, category, description });
      setTitle("");
      setType("binary");
      setCategory("tech");
      setDescription("");
      onClose();
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-violet-500" />
            Suggest a Market
          </DialogTitle>
          <DialogDescription>
            Suggest a prediction market for the community. Your submission will be reviewed by an admin before going live.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input
              placeholder="e.g., Will Taylor Swift announce a tour?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-prediction-title"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="select-prediction-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="binary">Yes/No</SelectItem>
                  <SelectItem value="multi">Multiple Choice</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <Select value={category} onValueChange={(v) => setCategory(v as CategoryFilter)}>
                <SelectTrigger data-testid="select-prediction-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_FILTERS.filter(c => c.id !== "all").map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              placeholder="Add more context for your prediction..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              className="resize-none"
              data-testid="input-prediction-description"
            />
            <p className="text-xs text-muted-foreground text-right">{description.length}/200</p>
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
            disabled={!title.trim() || !description.trim()}
            data-testid="button-submit-prediction"
          >
            Submit Suggestion
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CelebritySearchModal({
  open,
  onOpenChange,
  trendingPeople,
  selectedPerson,
  onSelectPerson,
  isLoading
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trendingPeople: TrendingPerson[];
  selectedPerson: TrendingPerson | null;
  onSelectPerson: (person: TrendingPerson) => void;
  isLoading: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  
  const filteredPeople = (trendingPeople || []).filter(person =>
    person.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectPerson = (person: TrendingPerson) => {
    onSelectPerson(person);
    onOpenChange(false);
    setSearchQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Select Celebrity
          </DialogTitle>
          <DialogDescription>
            Choose who you want to predict for the Weekly Jackpot
          </DialogDescription>
        </DialogHeader>
        
        <div className="px-4 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              autoFocus
              data-testid="input-jackpot-search-modal"
            />
          </div>
        </div>
        
        <div className="h-[350px] overflow-y-auto">
          <div className="p-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-r-transparent" />
              </div>
            ) : filteredPeople.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No results found</p>
            ) : (
              filteredPeople.map((person) => (
                <button
                  key={person.id}
                  onClick={() => handleSelectPerson(person)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors ${
                    selectedPerson?.id === person.id ? 'bg-amber-500/10 border border-amber-500/30' : ''
                  }`}
                  data-testid={`modal-option-person-${person.id}`}
                >
                  <PersonAvatar name={person.name} avatar={person.avatar || ""} size="sm" />
                  <div className="flex-1 text-left">
                    <p className="font-medium text-sm">{person.name}</p>
                    <p className="text-xs text-muted-foreground">Rank #{person.rank}</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{Math.round(person.trendScore).toLocaleString('en-US')}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WeeklyJackpotHero({ 
  onEnterJackpot, 
  isMarketClosed,
  timeRemaining,
  trendingPeople,
  selectedPerson,
  onSelectPerson,
  isLoading,
  jackpotMarket,
  onRulesClick,
}: {
  onEnterJackpot: () => void;
  isMarketClosed: boolean;
  timeRemaining: { days: number; hours: number; minutes: number; seconds: number };
  trendingPeople: TrendingPerson[];
  selectedPerson: TrendingPerson | null;
  onSelectPerson: (person: TrendingPerson) => void;
  isLoading: boolean;
  jackpotMarket: any | null;
  onRulesClick: () => void;
}) {
  const [searchModalOpen, setSearchModalOpen] = useState(false);

  const { data: lastWinnerData } = useQuery({
    queryKey: ["/api/native-markets/jackpot-last-winner", selectedPerson?.id],
    queryFn: async () => {
      if (!selectedPerson?.id) return { hasResult: false };
      const res = await fetch(`/api/native-markets/jackpot-last-winner/${selectedPerson.id}`);
      return res.json();
    },
    enabled: !!selectedPerson?.id,
    staleTime: 5 * 60 * 1000,
  });

  const poolSize = useMemo(() => {
    if (!jackpotMarket) return 0;
    const entries = jackpotMarket.entries || [];
    return entries.reduce((sum: number, e: any) => sum + (e.totalStake || 0), 0);
  }, [jackpotMarket]);

  const entryCount = jackpotMarket?.totalBets || jackpotMarket?.activeParticipantCount || 0;

  const isCutoffPassed = useMemo(() => {
    if (!jackpotMarket?.endAt) return false;
    const cutoff = new Date(new Date(jackpotMarket.endAt).getTime() - 48 * 60 * 60 * 1000);
    return new Date() > cutoff;
  }, [jackpotMarket]);

  return (
    <div 
      className="relative overflow-hidden rounded-2xl mb-8 border-2 border-amber-500/50"
      style={{
        background: "linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(251, 146, 60, 0.05) 50%, transparent 100%)",
        boxShadow: "inset 0 0 30px rgba(245, 158, 11, 0.1), 0 0 40px rgba(245, 158, 11, 0.15)",
      }}
      data-testid="weekly-jackpot-hero"
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl" />
      <div className="relative z-10 p-6 md:p-8">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="h-6 w-6 text-amber-500" />
              <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/40">
                WEEKLY JACKPOT
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-500/60 hover:text-amber-500" onClick={onRulesClick} aria-label="How the Jackpot works">
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>How it works</TooltipContent>
              </Tooltip>
            </div>
            
            <div className="mb-4">
              <button
                onClick={() => setSearchModalOpen(true)}
                className="w-full max-w-md flex items-center justify-between gap-2 px-4 py-3 rounded-lg border-2 border-amber-500/40 bg-background/80 backdrop-blur-sm hover:border-amber-500/60 transition-colors"
                data-testid="dropdown-jackpot-person"
              >
                <div className="flex items-center gap-3">
                  {selectedPerson ? (
                    <>
                      <PersonAvatar name={selectedPerson.name} avatar={selectedPerson.avatar || ""} size="sm" />
                      <div className="text-left">
                        <p className="font-semibold">{selectedPerson.name}</p>
                        <p className="text-xs text-muted-foreground">Rank #{selectedPerson.rank}</p>
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {isLoading ? "Loading..." : "Select a celebrity"}
                    </span>
                  )}
                </div>
                <ChevronDown className="h-5 w-5 text-amber-500" />
              </button>
            </div>
            
            <p className="text-sm text-muted-foreground mb-4 max-w-md">Predict the exact Trend Score. Closest wins the jackpot!</p>
            
            {isMarketClosed ? (
              <Button size="lg" className="bg-muted text-muted-foreground cursor-not-allowed" disabled>
                <Lock className="h-5 w-5 mr-2" />
                Market Closed
              </Button>
            ) : isCutoffPassed ? (
              <Button size="lg" className="bg-muted text-muted-foreground cursor-not-allowed" disabled>
                <Lock className="h-5 w-5 mr-2" />
                Entries Closed — Results Sunday
              </Button>
            ) : (
              <Button 
                size="lg"
                className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30"
                onClick={onEnterJackpot}
                disabled={!selectedPerson}
                data-testid="button-enter-jackpot"
              >
                <Crown className="h-5 w-5 mr-2" />
                Enter Jackpot — 100 Credits
              </Button>
            )}
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <p className="text-xs text-muted-foreground">Time Remaining</p>
            <div className="flex gap-2">
              {[
                { value: timeRemaining.days, label: 'd' },
                { value: timeRemaining.hours, label: 'h' },
                { value: timeRemaining.minutes, label: 'm' },
              ].map((item, i) => (
                <div key={i} className="flex items-baseline gap-0.5">
                  <span className="font-mono text-2xl font-bold text-amber-500">{item.value}</span>
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
            <p className="text-sm font-semibold text-amber-500 mt-2">
              Pool: {poolSize > 0 ? poolSize.toLocaleString() : "0"} credits
            </p>
            {entryCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {entryCount} {entryCount === 1 ? "entry" : "entries"}
              </p>
            )}
          </div>
        </div>
        {lastWinnerData?.hasResult && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 mx-6 md:mx-8 mb-2">
            <p className="text-xs text-amber-400 font-medium mb-1">
              <Trophy className="h-3 w-3 inline mr-1" />
              Last week's result
            </p>
            <p className="text-sm">
              {lastWinnerData.winnerUsername ? (
                <>
                  <span className="font-semibold text-amber-400">@{lastWinnerData.winnerUsername}</span>
                  {" guessed "}
                  <span className="font-bold">{Number(lastWinnerData.winningPrediction).toLocaleString()}</span>
                  {" (actual: "}
                  <span className="font-bold">{Number(lastWinnerData.actualScore).toLocaleString()}</span>
                  {lastWinnerData.margin === 0 ? " — EXACT match!" : `, off by ${Number(lastWinnerData.margin).toLocaleString()}`}
                  {") and won "}
                  <span className="font-bold text-amber-400">{Number(lastWinnerData.payout).toLocaleString()} credits</span>
                </>
              ) : (
                <>
                  Actual score: <span className="font-bold">{Number(lastWinnerData.actualScore).toLocaleString()}</span>
                  {" — No entries last week"}
                </>
              )}
            </p>
          </div>
        )}
      </div>
      <CelebritySearchModal
        open={searchModalOpen}
        onOpenChange={setSearchModalOpen}
        trendingPeople={trendingPeople}
        selectedPerson={selectedPerson}
        onSelectPerson={onSelectPerson}
        isLoading={isLoading}
      />
    </div>
  );
}

export default function PredictPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, profile, refreshProfile } = useAuth();
  const { favoriteIds } = useFavorites();
  const raceMap = useCategoryRaceMap();
  const leaderboardCats = useLeaderboardCategories();
  const onboardingRef = useRef<OnboardingDrawerHandle>(null);
  const [selectedType, setSelectedType] = useState<PredictionType>("all");
  const [showMyPositions, setShowMyPositions] = useState(false);
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
  
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [townSquareCollapsed, setTownSquareCollapsed] = useState(true);
  const [gainerPickerState, setGainerPickerState] = useState<{ market: TopGainerMarket; initialCandidate?: GainerCandidate | null } | null>(null);
  
  const marketCycle = useMarketCycle();
  const isMarketClosed = marketCycle.status === "CLOSED";
  
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
  });
  const { data: nativeH2hData, isLoading: h2hLoading, error: h2hError, refetch: refetchH2h } = useQuery<any[]>({
    queryKey: ['/api/native-markets/h2h'],
  });
  const { data: nativeGainerData, isLoading: gainerLoading, error: gainerError, refetch: refetchGainers } = useQuery<any[]>({
    queryKey: ['/api/native-markets/gainer'],
  });
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
    const map = new Map<string, { result: string; payout: number; entryLabel: string; stakeAmount: number; marketId: string }>();
    const grouped = new Map<string, any[]>();
    const betsArray = Array.isArray(userBetsData) ? userBetsData : (userBetsData as any)?.predictions ?? [];
    (betsArray).forEach((b: any) => {
      const arr = grouped.get(b.marketId) || [];
      arr.push(b);
      grouped.set(b.marketId, arr);
    });
    grouped.forEach((bets, marketId) => {
      const totalStake = bets.reduce((s: number, b: any) => s + b.stakeAmount, 0);
      const totalPayout = bets.reduce((s: number, b: any) => s + (b.payout || 0), 0);
      const uniqueEntries = new Set(bets.map((b: any) => b.entryLabel));
      const entryLabel = uniqueEntries.size === 1 ? bets[0].entryLabel : "Multiple positions";
      const results = new Set(bets.map((b: any) => b.result));
      let result = 'pending';
      if (results.has('won') && !results.has('lost')) result = 'won';
      else if (results.has('lost') && !results.has('won')) result = 'lost';
      else if (results.has('won') && results.has('lost')) result = 'won';
      else if (results.has('refunded') && results.size === 1) result = 'refunded';
      else result = bets[0].result;
      map.set(marketId, { result, payout: totalPayout, entryLabel, stakeAmount: totalStake, marketId });
    });
    return map;
  }, [userBetsData]);
  const walletCredits = profile?.predictCredits ?? 0;
  const visibleMarketIds = useMemo(() => {
    const ids = new Set<string>();
    openMarkets.forEach((m: any) => ids.add(m.id));
    (nativeUpdownData || []).forEach((m: any) => ids.add(m.id));
    (nativeH2hData || []).forEach((m: any) => ids.add(m.id));
    (nativeGainerData || []).forEach((m: any) => ids.add(m.id));
    return ids;
  }, [openMarkets, nativeUpdownData, nativeH2hData, nativeGainerData]);

  const activePredictions = useMemo(
    () => Array.from(userBetsByMarket.values()).filter(
      (bet) => bet.result === "pending" && visibleMarketIds.has(bet.marketId)
    ).length,
    [userBetsByMarket, visibleMarketIds]
  );
  useEffect(() => {
    if (activePredictions === 0 && showMyPositions) {
      setShowMyPositions(false);
    }
  }, [activePredictions, showMyPositions]);

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
        const upMultiplier = upStake > 0 ? +(total / upStake).toFixed(1) : 2.0;
        const downMultiplier = downStake > 0 ? +(total / downStake).toFixed(1) : 2.0;
        const currentScore = Number(person.trendScore || person.fameIndex || 0);
        const storedBaseline = m.metadata?.openingScore?.score;
        const fallbackBaseline = currentScore - Math.floor(currentScore * (Number(person.change7d || 0) / 100));
        const baselineScore = storedBaseline ? Number(storedBaseline) : fallbackBaseline;
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
          endTime: "Sun 23:59 UTC",
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
          person1Id: e1.personId || "",
          person2Id: e2.personId || "",
          category: normalizeMarketCategory(m.category || "misc") as CategoryFilter,
          endTime: "Sun 23:59 UTC",
          totalPool,
          person1Percent: (s1 + s2) === 0 ? 50 : Math.round((s1 / total) * 100),
          totalBets: (Number(m.activeParticipantCount || 0) || 0) + Number(m.seedConfig?.participants || 0),
          activeParticipantCount: Number(m.activeParticipantCount || 0),
          recentParticipants: m.recentParticipants || [],
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
          };
        }).sort((a: GainerCandidate, b: GainerCandidate) => b.percentGain - a.percentGain);

        return {
          id: m.id,
          category: normalizeMarketCategory(m.category || "misc") as CategoryFilter,
          leaders: allCandidates.slice(0, 3),
          allCandidates,
          totalPool,
          endTime: "Sun 23:59 UTC",
          totalBets: (Number(m.activeParticipantCount || 0) || 0) + Number(m.seedConfig?.participants || 0),
          totalEntries: entries.length,
          candidateCount: allCandidates.length,
          activeParticipantCount: Number(m.activeParticipantCount || 0),
          recentParticipants: m.recentParticipants || [],
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

  const { data: nativeJackpotData, error: jackpotError, refetch: refetchJackpot } = useQuery<any[]>({
    queryKey: ['/api/native-markets/jackpot'],
  });

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
      setViewAllCategory(e.state?.overlay || null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const handleEnterJackpot = () => {
    if (!selectedJackpotPerson) return;
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to place predictions." });
      setLocation("/login");
      return;
    }
    setJackpotModalOpen(true);
  };

  const nativeUpdownBetMutation = useMutation({
    mutationFn: async ({ marketId, entryId, stakeAmount }: { marketId: string; entryId: string; stakeAmount: number }) => {
      const res = await apiRequest("POST", `/api/native-markets/updown/${marketId}/bet`, { entryId, stakeAmount });
      return res.json();
    },
    onSuccess: async () => {
      toast({
        title: "Prediction placed!",
        description: "Your weekly up/down prediction has been recorded.",
      });
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
      toast({
        title: "Failed to place prediction",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const nativeMarketBetMutation = useMutation({
    mutationFn: async ({ marketId, entryId, stakeAmount, marketType }: { marketId: string; entryId: string; stakeAmount: number; marketType: string }) => {
      const res = await apiRequest("POST", `/api/native-markets/${marketId}/bet`, { entryId, stakeAmount });
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      toast({
        title: "Prediction placed!",
        description: variables.marketType === "h2h" ? "Your head-to-head prediction has been recorded." : "Your top gainer prediction has been recorded.",
      });
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
      toast({
        title: "Failed to place prediction",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const openStakeModal = () => {
    refreshProfile?.();
    setStakeModalOpen(true);
  };

  const handleUpDownSelect = (market: PredictionMarket, choice: "up" | "down") => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Sign in to place predictions.",
      });
      setLocation("/login");
      return;
    }

    const entryId = choice === "up" ? market.upEntryId : market.downEntryId;
    if (!entryId) {
      toast({
        title: "Market unavailable",
        description: "This market is missing required entries. Please try another market.",
        variant: "destructive",
      });
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
    });
    openStakeModal();
  };

  const handleH2HSelect = (market: HeadToHeadMarket, person: 1 | 2) => {
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to place predictions." });
      setLocation("/login");
      return;
    }

    const entryId = person === 1 ? market.person1EntryId : market.person2EntryId;
    if (!entryId) {
      toast({ title: "Market unavailable", description: "This market is missing required entries. Please try another market.", variant: "destructive" });
      return;
    }

    const picked = person === 1 ? market.person1 : market.person2;
    const opponent = person === 1 ? market.person2 : market.person1;
    const sentiment = person === 1 ? market.person1Percent : 100 - market.person1Percent;
    const stakePool = market.totalPool || 1;
    const pickedPool = (sentiment / 100) * stakePool || 1;
    const estimatedPayout = Math.round((stakePool / pickedPool) * 10) / 10;

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
    });
    openStakeModal();
  };

  const handleGainerSelect = (market: TopGainerMarket, candidate: GainerCandidate) => {
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to place predictions." });
      setLocation("/login");
      return;
    }

    if (!candidate.entryId) {
      toast({ title: "Market unavailable", description: "This market is missing required entries. Please try another market.", variant: "destructive" });
      return;
    }

    const categoryLabel = getMarketCategoryLabel(market.category);

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
    });
    openStakeModal();
  };

  const handleConfirmStake = (amount: number) => {
    if (!pendingSelection || !pendingSelection.marketId) {
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }

    if (pendingSelection.type === "h2h" || pendingSelection.type === "gainer") {
      if (!pendingSelection.entryId) {
        toast({ title: "Selection unavailable", description: "This market selection is not available right now.", variant: "destructive" });
        return;
      }
      nativeMarketBetMutation.mutate({ marketId: pendingSelection.marketId, entryId: pendingSelection.entryId, stakeAmount: amount, marketType: pendingSelection.type });
      return;
    }

    if (pendingSelection.type !== "updown") {
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }

    const market = hydratedMarkets.find((m) => m.id === pendingSelection.marketId);
    if (!market) {
      toast({
        title: "Market unavailable",
        description: "Could not find the selected market. Please refresh and try again.",
        variant: "destructive",
      });
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }

    const isDownPick = pendingSelection.choice.toUpperCase().includes("DOWN");
    const entryId = isDownPick ? market.downEntryId : market.upEntryId;
    if (!entryId) {
      toast({
        title: "Selection unavailable",
        description: "This market selection is not available right now.",
        variant: "destructive",
      });
      return;
    }

    nativeUpdownBetMutation.mutate({ marketId: market.id, entryId, stakeAmount: amount });
  };

  const handleCreatePrediction = (data: { title: string; type: string; category: CategoryFilter; description: string }) => {
    toast({
      title: "Suggestion submitted!",
      description: "Your market suggestion has been submitted for admin review.",
    });
  };

  // Section-specific filtering logic
  const matchesCategory = (cat: CategoryFilter, marketCategory: string, personId?: string) => {
    if (cat === "all") return true;
    if (cat === "trending") return true;
    if (cat === "favorites") return !!personId && favoriteIds.has(personId);
    return normalizeMarketCategory(marketCategory) === cat;
  };

  const filteredUpDown = hydratedMarkets.filter(m =>
    (showMyPositions || matchesCategory(updownCategory, m.category, m.personId)) &&
    (!updownSearch || m.personName.toLowerCase().includes(updownSearch.toLowerCase())) &&
    (!showMyPositions || userBetsByMarket.has(m.id))
  ).sort((a: any, b: any) => updownCategory === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0);

  const filteredH2H = hydratedH2H.filter(m =>
    (showMyPositions || h2hCategory === "all" || h2hCategory === "trending" ||
     (h2hCategory === "favorites" ? (favoriteIds.has(m.person1Id || "") || favoriteIds.has(m.person2Id || "")) : matchesCategory(h2hCategory, m.category))) &&
    (!h2hSearch || m.title.toLowerCase().includes(h2hSearch.toLowerCase()) ||
     m.person1.name.toLowerCase().includes(h2hSearch.toLowerCase()) ||
     m.person2.name.toLowerCase().includes(h2hSearch.toLowerCase())) &&
    (!showMyPositions || userBetsByMarket.has(m.id))
  ).sort((a: any, b: any) => h2hCategory === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0);

  const filteredGainers = hydratedGainers.filter(m =>
    (showMyPositions || gainerCategory === "all" || gainerCategory === "trending" ||
     (gainerCategory === "favorites" ? m.leaders.some(l => l.personId && favoriteIds.has(l.personId)) : matchesCategory(gainerCategory, m.category))) &&
    (!gainerSearch || getMarketCategoryLabel(m.category).toLowerCase().includes(gainerSearch.toLowerCase()) ||
     (m.allCandidates || m.leaders).some(l => l.name.toLowerCase().includes(gainerSearch.toLowerCase()))) &&
    (!showMyPositions || userBetsByMarket.has(m.id))
  ).sort((a: any, b: any) => gainerCategory === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0);

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
    .sort((a: any, b: any) => overlayCategoryFilter === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0);
  const gainerEmptyMessage = showMyPositions
    ? "You don't have any active Category Race positions yet"
    : hasInactiveOnlyGainers
      ? "No live Category Races are open right now"
      : hasLiveGainers
        ? "No gainers match your filters"
        : "No Category Races are available right now";

  const filteredCommunity = openMarkets.filter((m: any) =>
    (showMyPositions || communityCategory === "all" || communityCategory === "trending" || m.category === communityCategory) &&
    (!communitySearch || m.title?.toLowerCase().includes(communitySearch.toLowerCase())) &&
    (!showMyPositions || userBetsByMarket.has(m.id))
  ).sort((a: any, b: any) => communityCategory === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0);

  const showSection = (type: PredictionType) => selectedType === "all" || selectedType === type;

  return (
    <div className="min-h-screen pb-20 md:pb-0 overflow-x-hidden">
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
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              data-testid="button-logo-home"
            >
              <VoxDexLogo size={32} variant="predict" />
              <span className="font-serif font-bold text-xl hidden sm:block">VoxDex</span>
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4">
              <Link href="/#leaderboard">
                <Button variant="ghost" size="sm">Leaderboard</Button>
              </Link>
              <Link href="/vote">
                <Button variant="ghost" size="sm">Vote</Button>
              </Link>
              <Link href="/predict">
                <Button variant="ghost" size="sm" className="text-violet-500">Predict</Button>
              </Link>
            </div>
            <div className="flex items-center gap-2.5 md:hidden">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-violet-500/10 border border-violet-500/30">
                <Wallet className="h-[14px] w-[14px] text-violet-500" />
                <span className="font-mono font-bold text-sm">{walletCredits.toLocaleString('en-US')}</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <ListChecks className="h-[14px] w-[14px]" />
                <span className="text-sm">{activePredictions}</span>
              </div>
            </div>
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="sticky top-16 z-40 bg-background/80 backdrop-blur-xl border-b">
        <div className="container mx-auto px-4 py-3 max-w-7xl flex items-center gap-3">
          <HorizontalScroll className="pb-1 flex-1 min-w-0">
            {PREDICTION_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all min-w-fit ${
                  selectedType === type.id
                    ? 'bg-violet-500/20 text-violet-400 border border-violet-400/40 shadow-sm shadow-violet-500/20'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                }`}
                data-testid={`toggle-type-${type.id}`}
              >
                {type.icon}
                <span className="sm:hidden">{type.mobileLabel}</span>
                <span className="hidden sm:inline">{type.label}</span>
              </button>
            ))}
          </HorizontalScroll>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setRulesModalOpen("predictions")} aria-label="How predictions work">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>How predictions work</TooltipContent>
          </Tooltip>
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
          {user && activePredictions > 0 && !userBetsError && (
            <Button
              variant={showMyPositions ? "default" : "outline"}
              size="sm"
              onClick={() => setShowMyPositions(!showMyPositions)}
              className={`whitespace-nowrap shrink-0 ${showMyPositions ? 'bg-violet-500 hover:bg-violet-600 text-white' : ''}`}
              data-testid="toggle-my-positions"
            >
              <Wallet className="h-3.5 w-3.5 mr-1.5" />
              My Positions ({activePredictions})
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
            <div className="relative mb-[15px] py-3 px-4 rounded-lg bg-gradient-to-r from-violet-500/5 via-violet-500/10 to-transparent border border-violet-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-violet-500/10 hidden sm:flex items-center justify-center shrink-0">
                    <Scale className="h-5 w-5 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-serif font-bold">World Markets</h2>
                    <p className="text-sm text-muted-foreground">Predict the outcome of global events</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => setRulesModalOpen("community")}
                        className="text-violet-400 hover:text-violet-300"
                        aria-label="How it works"
                        data-testid="button-rules-real-world-markets"
                      >
                        <HelpCircle className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-slate-900/95 border-slate-700 text-slate-200 text-xs">How it works</TooltipContent>
                  </Tooltip>
                  <Button 
                    onClick={() => setCreateModalOpen(true)}
                    className="rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 hidden md:flex"
                    data-testid="button-start-prediction"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Suggest
                  </Button>
                  <Button 
                    size="icon"
                    onClick={() => setCreateModalOpen(true)}
                    className="rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 md:hidden"
                    data-testid="button-start-prediction-mobile"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            <SectionFilterBar
              categoryFilter={communityCategory}
              onCategoryChange={setCommunityCategory}
              searchQuery={communitySearch}
              onSearchChange={setCommunitySearch}
              searchPlaceholder="Search predictions..."
              testIdPrefix="community"
              user={user}
              onAuthRequired={() => setLocation("/login")}
              includeCustomTopic={true}
              showSearch={false}
            />
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
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-community" dotActiveColor="bg-violet-500">
                {filteredCommunity.map((market: any) => (
                  <OpenMarketCard 
                    key={market.id} 
                    market={market} 
                    onNavigate={(slug, pick, direction) => setLocation(`/markets/${slug}${pick ? `?pick=${pick}${direction ? `&direction=${direction}` : ''}` : ''}`)}
                    isMarketClosed={market.status !== 'OPEN'}
                    userBetResult={userBetsByMarket.get(market.id)}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                  />
                ))}
              </CardSection>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No markets available yet
              </div>
            )}
            <div className="flex justify-center mt-6">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-violet-500 hover:text-violet-400 text-[14px]"
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
                      <MessageSquare className="h-4 w-4 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-slate-100">Town Square</h3>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider">Recent prediction activity across live markets</p>
                    </div>
                    <div className={`h-6 w-6 rounded-md flex items-center justify-center bg-slate-700/30 transition-transform duration-200 shrink-0 ${townSquareCollapsed ? '' : 'rotate-180'}`}>
                      <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                    </div>
                  </div>
                  {!townSquareCollapsed && (
                    <div className="mt-4">
                      <Card className="border-slate-700/50 bg-slate-800/30">
                        <div className="divide-y divide-border/50">
                          {recentActivity.slice(0, 8).map((item) => (
                            <div
                              key={item.id}
                              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 cursor-pointer focus-within:bg-muted/30"
                              data-testid={`recent-activity-${item.id}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setLocation(getRecentActivityMarketPath(item.marketSlug, item.marketType));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setLocation(getRecentActivityMarketPath(item.marketSlug, item.marketType));
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
                                  {item.stakeAmount.toLocaleString("en-US")} credits{item.confidence != null ? ` • ${(item.confidence * 100).toFixed(0)}% confidence` : ""}
                                </p>
                                {item.rationale && !item.isAgent && (
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
                            className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
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
              isMarketClosed={isMarketClosed}
              timeRemaining={marketCycle.timeRemaining}
              trendingPeople={trendingPeople}
              selectedPerson={selectedJackpotPerson}
              onSelectPerson={setSelectedJackpotPerson}
              isLoading={isLoadingPeople}
              jackpotMarket={jackpotMarketForPerson}
              onRulesClick={() => setRulesModalOpen("jackpot")}
            />
          )
        )}

        {showSection("updown") && (
          <section className="mb-10">
            <SectionHeader
              title="Weekly Up / Down"
              icon={<TrendingUp className="h-5 w-5 text-violet-400" />}
              onRulesClick={() => setRulesModalOpen("updown")}
            >
              <p className="text-sm text-muted-foreground">Will their trend score be higher / lower</p>
            </SectionHeader>
            <SectionFilterBar
              categoryFilter={updownCategory}
              onCategoryChange={setUpdownCategory}
              searchQuery={updownSearch}
              onSearchChange={setUpdownSearch}
              searchPlaceholder="Search celebrities..."
              testIdPrefix="updown"
              user={user}
              onAuthRequired={() => setLocation("/login")}
              showSearch={false}
            />
            {updownError ? (
              <Card className="p-8 text-center">
                <p className="text-destructive mb-2">Couldn&apos;t load Up/Down markets</p>
                <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
                <Button onClick={() => refetchUpdown()} data-testid="button-retry-updown">Retry</Button>
              </Card>
            ) : updownLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-8 w-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredUpDown.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-updown" dotActiveColor="bg-violet-500">
                {filteredUpDown.map((market) => (
                  <WeeklyUpDownCard 
                    key={market.id} 
                    market={market} 
                    isMarketClosed={isMarketClosed}
                    onSelect={(choice) => handleUpDownSelect(market, choice)}
                    onFilterCategory={handleCategoryPillFilter}
                    categoryRaceMap={raceMap}
                    leaderboardCategories={leaderboardCats}
                  />
                ))}
              </CardSection>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No markets match your filters
              </div>
            )}
            <div className="flex justify-center mt-6">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-violet-500 hover:text-violet-400 text-[14px]"
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
            <SectionHeader
              title="Head-to-Head Battles"
              icon={<Swords className="h-5 w-5 text-violet-400" />}
              onRulesClick={() => setRulesModalOpen("h2h")}
            >
              <p className="text-sm text-muted-foreground">Who will gain more points</p>
            </SectionHeader>
            <SectionFilterBar
              categoryFilter={h2hCategory}
              onCategoryChange={setH2hCategory}
              searchQuery={h2hSearch}
              onSearchChange={setH2hSearch}
              searchPlaceholder="Search matchups..."
              testIdPrefix="h2h"
              user={user}
              onAuthRequired={() => setLocation("/login")}
              showSearch={false}
            />
            {h2hError ? (
              <Card className="p-8 text-center">
                <p className="text-destructive mb-2">Couldn&apos;t load Head-to-Head markets</p>
                <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
                <Button onClick={() => refetchH2h()} data-testid="button-retry-h2h">Retry</Button>
              </Card>
            ) : h2hLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-8 w-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredH2H.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-h2h" dotActiveColor="bg-violet-500">
                {filteredH2H.map((market) => {
                  const bet = userBetsByMarket.get(market.id);
                  const h2hUserPick = bet
                    ? bet.entryLabel === market.person1.name ? 1 as const
                    : bet.entryLabel === market.person2.name ? 2 as const
                    : null
                    : null;
                  return (
                    <HeadToHeadCard 
                      key={market.id} 
                      market={market} 
                      isMarketClosed={isMarketClosed}
                      onSelect={(person) => handleH2HSelect(market, person)}
                      userPick={h2hUserPick}
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
            <div className="flex justify-center mt-6">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-violet-500 hover:text-violet-400 text-[14px]"
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
            <SectionHeader
              title="Category Races"
              icon={<Trophy className="h-5 w-5 text-violet-400" />}
              onRulesClick={() => setRulesModalOpen("gainer")}
            >
              <p className="text-sm text-muted-foreground">Pick the biggest mover in each category</p>
            </SectionHeader>
            <SectionFilterBar
              categoryFilter={gainerCategory}
              onCategoryChange={setGainerCategory}
              searchQuery={gainerSearch}
              onSearchChange={setGainerSearch}
              searchPlaceholder="Search gainers..."
              testIdPrefix="gainer"
              user={user}
              onAuthRequired={() => setLocation("/login")}
              showSearch={false}
            />
            {gainerError ? (
              <Card className="p-8 text-center">
                <p className="text-destructive mb-2">Couldn&apos;t load Category Race markets</p>
                <p className="text-muted-foreground text-sm mb-4">Please try again in a moment.</p>
                <Button onClick={() => refetchGainers()} data-testid="button-retry-gainers">Retry</Button>
              </Card>
            ) : gainerLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-8 w-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredGainers.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-gainer" dotActiveColor="bg-violet-500">
                {filteredGainers.map((market) => (
                  <TopGainerCard 
                    key={market.id} 
                    market={market} 
                    isMarketClosed={isMarketClosed}
                    onShowAllCandidates={(pickedMarket, initialCandidate) => setGainerPickerState({ market: pickedMarket, initialCandidate })}
                    isPredicted={predictedMarkets.has(market.id)}
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
            <div className="flex justify-center mt-6">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-violet-500 hover:text-violet-400 text-[14px]"
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
            className="text-sm text-muted-foreground hover:text-violet-500 transition-colors"
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
        onAuthRequired={() => setLocation("/login")}
      >
        {hydratedMarkets
          .filter(m => 
            (overlayCategoryFilter === "all" || overlayCategoryFilter === "trending" || m.category === overlayCategoryFilter) &&
            (!overlaySearchQuery || m.personName.toLowerCase().includes(overlaySearchQuery.toLowerCase()))
          )
          .sort((a: any, b: any) => overlayCategoryFilter === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0)
          .map((market) => (
            <WeeklyUpDownCard 
              key={market.id} 
              market={market} 
              isMarketClosed={isMarketClosed}
              onSelect={(choice) => handleUpDownSelect(market, choice)}
              onFilterCategory={(cat) => setOverlayCategoryFilter(normalizeMarketCategory(cat) as CategoryFilter)}
              categoryRaceMap={raceMap}
              leaderboardCategories={leaderboardCats}
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
        onAuthRequired={() => setLocation("/login")}
      >
        {hydratedH2H
          .filter(m => 
            (overlayCategoryFilter === "all" || overlayCategoryFilter === "trending" || m.category === overlayCategoryFilter) &&
            (!overlaySearchQuery || m.title.toLowerCase().includes(overlaySearchQuery.toLowerCase()))
          )
          .sort((a: any, b: any) => overlayCategoryFilter === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0)
          .map((market) => {
            const bet = userBetsByMarket.get(market.id);
            const h2hUserPick = bet
              ? bet.entryLabel === market.person1.name ? 1 as const
              : bet.entryLabel === market.person2.name ? 2 as const
              : null
              : null;
            return (
              <HeadToHeadCard 
                key={market.id} 
                market={market} 
                isMarketClosed={isMarketClosed}
                onSelect={(person) => handleH2HSelect(market, person)}
                userPick={h2hUserPick}
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
        onAuthRequired={() => setLocation("/login")}
      >
        {filteredOverlayGainers.length > 0 ? (
          filteredOverlayGainers.map((market) => (
            <TopGainerCard 
              key={market.id} 
              market={market} 
              isMarketClosed={isMarketClosed}
              onShowAllCandidates={(pickedMarket, initialCandidate) => setGainerPickerState({ market: pickedMarket, initialCandidate })}
              isPredicted={predictedMarkets.has(market.id)}
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
        onAuthRequired={() => setLocation("/login")}
      >
        {openMarkets
          .filter((m: any) => 
            (overlayCategoryFilter === "all" || overlayCategoryFilter === "trending" || m.category === overlayCategoryFilter) &&
            (!overlaySearchQuery || m.title?.toLowerCase().includes(overlaySearchQuery.toLowerCase()))
          )
          .sort((a: any, b: any) => overlayCategoryFilter === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0)
          .map((market: any) => (
            <OpenMarketCard 
              key={market.id} 
              market={market} 
              onNavigate={(slug, pick, direction) => setLocation(`/markets/${slug}${pick ? `?pick=${pick}${direction ? `&direction=${direction}` : ''}` : ''}`)}
              isMarketClosed={market.status !== 'OPEN'}
              userBetResult={userBetsByMarket.get(market.id)}
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
          setGainerPickerState({ market, initialCandidate: currentCandidate || null });
        } : undefined}
        onDirectionChange={(dir) => {
          if (!pendingSelection || pendingSelection.type !== "updown") return;
          const marketId = pendingSelection.marketId;
          const market = hydratedMarkets.find(m => m.id === marketId);
          if (!market) return;
          setPendingSelection({
            ...pendingSelection,
            choice: dir === "up" ? "Trend Score UP" : "Trend Score DOWN",
            crowdSentiment: dir === "up" ? market.upPoolPercent : 100 - market.upPoolPercent,
            estimatedPayout: dir === "up" ? market.upMultiplier : market.downMultiplier,
          });
        }}
      />
      <CreatePredictionModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleCreatePrediction}
      />
      {rulesModalOpen && RULES_CONTENT[rulesModalOpen] && (
        <RulesModal
          open={!!rulesModalOpen}
          onClose={() => setRulesModalOpen(null)}
          title={RULES_CONTENT[rulesModalOpen].title}
          description={RULES_CONTENT[rulesModalOpen].description}
          steps={RULES_CONTENT[rulesModalOpen].steps}
        />
      )}
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
      />
      {selectedJackpotPerson && (
        <JackpotEntryModal
          open={jackpotModalOpen}
          onClose={() => setJackpotModalOpen(false)}
          person={selectedJackpotPerson}
          marketId={jackpotMarketForPerson?.id || null}
          userCredits={walletCredits}
          bettingCutoff={jackpotMarketForPerson?.endAt ? new Date(new Date(jackpotMarketForPerson.endAt).getTime() - 48 * 60 * 60 * 1000).toISOString() : null}
          isCutoffPassed={jackpotMarketForPerson?.endAt ? new Date() > new Date(new Date(jackpotMarketForPerson.endAt).getTime() - 48 * 60 * 60 * 1000) : false}
        />
      )}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-t md:hidden">
        <div className="flex items-center justify-around h-16">
          <Link href="/">
            <button className="flex flex-col items-center gap-1 px-4 py-2 text-muted-foreground">
              <Target className="h-5 w-5" />
              <span className="text-xs">Home</span>
            </button>
          </Link>
          <Link href="/vote">
            <button className="flex flex-col items-center gap-1 px-4 py-2 text-muted-foreground">
              <Users className="h-5 w-5" />
              <span className="text-xs">Vote</span>
            </button>
          </Link>
          <Link href="/predict">
            <button className="flex flex-col items-center gap-1 px-4 py-2 text-violet-500">
              <Zap className="h-5 w-5" />
              <span className="text-xs">Predict</span>
            </button>
          </Link>
          <Link href="/me">
            <button className="flex flex-col items-center gap-1 px-4 py-2 text-muted-foreground">
              <Trophy className="h-5 w-5" />
              <span className="text-xs">Me</span>
            </button>
          </Link>
        </div>
      </nav>
    </div>
  );
}
