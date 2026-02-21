import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryPill } from "@/components/CategoryPill";
import { UserMenu } from "@/components/UserMenu";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MarketCycleHero } from "@/components/MarketCycleHero";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { useQuery } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
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
  Globe,
  Scale,
  Landmark,
  Briefcase,
  Music2,
  Video,
  LayoutGrid,
  Flame,
  type LucideIcon
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation, Link } from "wouter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { CardSection } from "@/components/CardSection";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";

function MarketAvatar({ market }: { market: any }) {
  const imgUrl = market.coverImageUrl || market.linkedPersonAvatar;
  if (!imgUrl) return null;
  return (
    <Avatar className="h-10 w-10 shrink-0 rounded-md">
      <AvatarImage src={imgUrl} alt={market.title} className="object-cover" />
      <AvatarFallback className="text-xs rounded-md">{(market.title || "?")[0]}</AvatarFallback>
    </Avatar>
  );
}

// Prediction Type definitions
type PredictionType = "all" | "jackpot" | "updown" | "h2h" | "gainer" | "community";
type CategoryFilter = "all" | "favorites" | "trending" | "tech" | "politics" | "business" | "music" | "sports" | "creator" | "misc";

interface PredictionMarket {
  id: string;
  personId: string;
  personName: string;
  personAvatar: string;
  currentScore: number;
  startScore: number;
  change7d: number;
  upMultiplier: number;
  downMultiplier: number;
  endTime: string;
  totalPool: number;
  upPoolPercent: number;
  category: CategoryFilter;
}

const mockMarkets: PredictionMarket[] = [
  {
    id: "market-1",
    personId: "1",
    personName: "Elon Musk",
    personAvatar: "",
    currentScore: 515809,
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
  category: CategoryFilter;
  endTime: string;
  totalPool: number;
  person1Percent: number;
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

interface TopGainerMarket {
  id: string;
  category: CategoryFilter;
  leaders: { name: string; avatar: string; currentGain: number; percentGain: number }[];
  totalPool: number;
  endTime: string;
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

const FIRST_VISIT_KEY = "authoridex_predict_first_visit";

const PREDICTION_TYPES: { id: PredictionType; label: string; mobileLabel: string; icon: React.ReactNode }[] = [
  { id: "all", label: "All Markets", mobileLabel: "All", icon: <Sparkles className="h-4 w-4" /> },
  { id: "community", label: "Real-World", mobileLabel: "Markets", icon: <Scale className="h-4 w-4" /> },
  { id: "jackpot", label: "Weekly Jackpot", mobileLabel: "Jackpot", icon: <Crown className="h-4 w-4" /> },
  { id: "updown", label: "Up/Down", mobileLabel: "Up/Down", icon: <TrendingUp className="h-4 w-4" /> },
  { id: "h2h", label: "Head-to-Head", mobileLabel: "H2H", icon: <Swords className="h-4 w-4" /> },
  { id: "gainer", label: "Top Gainer", mobileLabel: "Gainer", icon: <BarChart3 className="h-4 w-4" /> },
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
  onViewAll, 
  onRulesClick,
  rulesTitle 
}: { 
  title: string; 
  children?: React.ReactNode; 
  onViewAll?: () => void;
  onRulesClick?: () => void;
  rulesTitle?: string;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gradient-to-r from-violet-500/5 via-violet-500/10 to-transparent border border-violet-500/20 backdrop-blur-sm mt-[15px] mb-[15px]">
      <div className="flex-1 min-w-0">
        <h2 className="text-lg sm:text-xl font-serif font-bold truncate">{title}</h2>
        {children}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        {onRulesClick && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7"
                onClick={onRulesClick}
                data-testid={`button-rules-${title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <HelpCircle className="h-4 w-4 text-violet-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>How it works</TooltipContent>
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
  includeCustomTopic = false
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
    </div>
  );
}

function RulesModal({ 
  open, 
  onClose, 
  title, 
  description,
  steps 
}: { 
  open: boolean; 
  onClose: () => void; 
  title: string;
  description: string;
  steps: { icon: React.ReactNode; title: string; description: string }[];
}) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-violet-500" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                {step.icon}
              </div>
              <div>
                <h4 className="font-semibold text-sm">{step.title}</h4>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
        
        <Button onClick={onClose} className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600">
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  );
}

const BASE_CATEGORY_FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "trending", label: "Trending" },
  { id: "tech", label: "Tech" },
  { id: "politics", label: "Politics" },
  { id: "business", label: "Business" },
  { id: "music", label: "Music" },
  { id: "sports", label: "Sports" },
  { id: "creator", label: "Creator" },
];

const CATEGORY_ICONS: Record<CategoryFilter, LucideIcon> = {
  all: LayoutGrid,
  favorites: Star,
  trending: Flame,
  tech: Cpu,
  politics: Landmark,
  business: Briefcase,
  music: Music2,
  sports: Trophy,
  creator: Video,
  misc: Sparkles,
};

const CATEGORY_FILTERS_WITH_CUSTOM: { id: CategoryFilter; label: string }[] = [
  ...BASE_CATEGORY_FILTERS,
  { id: "misc", label: "Custom Topic" },
];

const getPredictCategoryFilters = (includeCustomTopic: boolean) => 
  includeCustomTopic ? CATEGORY_FILTERS_WITH_CUSTOM : BASE_CATEGORY_FILTERS;

const CATEGORY_FILTERS = BASE_CATEGORY_FILTERS;

function FirstTimeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Zap className="h-6 w-6 text-violet-500" />
            Welcome to Prediction Markets
          </DialogTitle>
          <DialogDescription>
            Use virtual credits to predict who's trending next
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <Target className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <h4 className="font-semibold text-sm">1. Pick a Market</h4>
              <p className="text-xs text-muted-foreground">
                Choose from Weekly Up/Down, Head-to-Head battles, or Category Races
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <h4 className="font-semibold text-sm">2. Back Your Prediction</h4>
              <p className="text-xs text-muted-foreground">
                Stake virtual credits on your pick. Your potential return depends on the pool.
              </p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              <Trophy className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <h4 className="font-semibold text-sm">3. Win from the Pool</h4>
              <p className="text-xs text-muted-foreground">
                If you're right, you share the pool with other winners based on your stake.
              </p>
            </div>
          </div>
          
          <Card className="p-3 bg-violet-500/5 border-violet-500/20">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-violet-500">Parimutuel System:</span> You're betting against other users, not the house. The bigger the pool, the bigger the potential returns!
            </p>
          </Card>
        </div>
        
        <Button onClick={onClose} className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white" data-testid="button-get-started">
          Get Started
        </Button>
      </DialogContent>
    </Dialog>
  );
}

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
      className={`relative group h-full ${onClick && !inactive ? 'cursor-pointer' : ''} ${inactive ? 'cursor-default' : ''}`}
      onClick={inactive ? undefined : onClick}
      data-testid={testId}
    >
      <div 
        className={`absolute -inset-[1px] rounded-xl border border-violet-500/60 transition-opacity pointer-events-none ${
          inactive 
            ? 'opacity-0' 
            : `opacity-0 group-hover:opacity-100 ${selected ? 'opacity-100 border-violet-500' : ''}`
        }`}
      />
      <Card className={`relative p-4 bg-card/95 backdrop-blur-sm transition-all h-full flex flex-col ${
        inactive 
          ? 'opacity-50 grayscale-[40%]' 
          : `group-hover:shadow-lg group-hover:shadow-violet-500/20 ${selected ? 'shadow-lg shadow-violet-500/30' : ''}`
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
  onSelect
}: { 
  market: PredictionMarket; 
  isMarketClosed?: boolean;
  onSelect?: (choice: "up" | "down") => void;
}) {
  return (
    <PredictCard testId={`card-weekly-${market.id}`} className={`min-h-[300px] ${isMarketClosed ? 'opacity-75' : ''}`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <Badge 
          variant="outline" 
          className={market.change7d >= 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}
        >
          {market.change7d >= 0 ? "+" : ""}{market.change7d.toFixed(1)}%
        </Badge>
        <CategoryPill category={market.category} />
      </div>
      
      <div className="flex items-center gap-3 mb-2">
        <PersonAvatar name={market.personName} avatar={market.personAvatar} className="h-[73px] w-[73px]" />
        <div>
          <p className="font-semibold text-sm">{market.personName}</p>
          <p className="text-xs text-muted-foreground font-mono">
            {market.currentScore.toLocaleString()} pts
          </p>
        </div>
      </div>
      
      <p className="text-xs text-muted-foreground mb-2">
        Will <span className="font-semibold text-foreground">{market.personName.split(" ")[0]}</span>'s Trend Score be higher or lower than start-of-week by close?
      </p>
      
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Users className="h-3.5 w-3.5" />
        <span>{market.totalPool > 0 ? Math.ceil(market.totalPool / 100) : 0} participants</span>
      </div>
      
      <div className="mb-2">
        <div className="h-3 rounded-full bg-red-500/20 overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all"
            style={{ width: `${market.upPoolPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs mt-1.5">
          <span className="text-green-500 font-semibold">Up {market.upMultiplier}x</span>
          <span className="text-red-500 font-semibold">Down {market.downMultiplier}x</span>
        </div>
      </div>
      
      <div className="flex items-center justify-center mb-1.5">
        <span className="text-sm font-semibold text-violet-500">Pool: {market.totalPool.toLocaleString()}</span>
      </div>
      
      <div className="mt-auto">
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
              className="bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
              onClick={() => onSelect?.("up")}
              data-testid={`button-up-${market.id}`}
            >
              <TrendingUp className="h-4 w-4 mr-1" />
              Up
            </Button>
            <Button 
              className="bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
              onClick={() => onSelect?.("down")}
              data-testid={`button-down-${market.id}`}
            >
              <TrendingDown className="h-4 w-4 mr-1" />
              Down
            </Button>
          </div>
        )}
      </div>
    </PredictCard>
  );
}

function HeadToHeadCard({ 
  market, 
  isMarketClosed = false,
  onSelect
}: { 
  market: HeadToHeadMarket; 
  isMarketClosed?: boolean;
  onSelect?: (person: 1 | 2) => void;
}) {
  return (
    <PredictCard testId={`card-h2h-${market.id}`} className={`relative overflow-hidden min-h-[320px] ${isMarketClosed ? 'opacity-75' : ''}`}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-0 top-0 w-1/2 h-full bg-gradient-to-r from-blue-600/20 to-transparent" />
        <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-purple-600/20 to-transparent" />
      </div>
      
      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3">
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {market.endTime}
          </Badge>
          <CategoryPill category={market.category} />
        </div>
        
        <div className="relative mb-4" style={{ padding: '0 5px' }}>
          <div className="flex" style={{ gap: '7px' }}>
            <div className="flex-1 relative">
              <div className="absolute -inset-4 rounded-md bg-blue-500/20 blur-lg pointer-events-none" />
              <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} className="h-auto w-full aspect-square" />
            </div>
            <div className="flex-1 relative">
              <div className="absolute -inset-4 rounded-md bg-purple-500/20 blur-lg pointer-events-none" />
              <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} className="h-auto w-full aspect-square" />
            </div>
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
              <span className="text-xs font-bold text-slate-200">VS</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center justify-between px-2 mb-2">
          <div className="flex flex-col items-center flex-1">
            <p className="text-sm font-semibold text-center">{market.person1.name.split(" ")[0]}</p>
            <span className="text-xs text-blue-400">{market.person1Percent}%</span>
          </div>
          <div className="flex flex-col items-center flex-1">
            <p className="text-sm font-semibold text-center">{market.person2.name.split(" ")[0]}</p>
            <span className="text-xs text-purple-400">{100 - market.person1Percent}%</span>
          </div>
        </div>
        
        <div className="h-2 rounded-full overflow-hidden mb-3 flex">
          <div 
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400"
            style={{ width: `${market.person1Percent}%` }}
          />
          <div 
            className="h-full bg-gradient-to-l from-purple-500 to-purple-400"
            style={{ width: `${100 - market.person1Percent}%` }}
          />
        </div>
        
        <div className="flex items-center justify-center mb-3">
          <span className="text-sm font-semibold text-violet-500">
            Pool: {market.totalPool.toLocaleString()}
          </span>
        </div>
        
        <div className="mt-auto">
          {isMarketClosed ? (
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
                className="bg-[#3B82F6]/10 border border-[#3B82F6]/50 text-[#3B82F6] hover:border-[#3B82F6]/80 hover:bg-[#3B82F6]/20"
                onClick={() => onSelect?.(1)}
                data-testid={`button-pick1-${market.id}`}
              >
                {market.person1.name.split(" ")[0]}
              </Button>
              <Button 
                className="bg-[#7C3AED]/10 border border-[#7C3AED]/50 text-[#7C3AED] hover:border-[#7C3AED]/80 hover:bg-[#7C3AED]/20"
                onClick={() => onSelect?.(2)}
                data-testid={`button-pick2-${market.id}`}
              >
                {market.person2.name.split(" ")[0]}
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
  onSelect,
  isPredicted = false,
  isShimmering = false
}: { 
  market: TopGainerMarket; 
  isMarketClosed?: boolean;
  onSelect?: (name: string) => void;
  isPredicted?: boolean;
  isShimmering?: boolean;
}) {
  const handlePlacePrediction = () => {
    if (market.leaders.length > 0) {
      onSelect?.(market.leaders[0].name);
    }
  };

  return (
    <PredictCard testId={`card-gainer-${market.id}`} className={`${isMarketClosed ? 'opacity-75' : ''} ${isShimmering ? 'shimmer-once' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">7-day gain</span>
        <CategoryPill category={market.category} />
      </div>
      
      <h3 className="font-semibold mb-3">Top Gainer: {market.category.charAt(0).toUpperCase() + market.category.slice(1)}</h3>
      
      <div className="space-y-2 mb-3">
        {market.leaders.map((leader, i) => (
          <div 
            key={leader.name} 
            className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${i === 0 ? 'border border-amber-500/30' : 'hover:bg-muted/50'}`}
            onClick={() => onSelect?.(leader.name)}
          >
            <div className="relative">
              {i === 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="h-5 w-5 rounded-full bg-background/80 backdrop-blur-sm border border-amber-500/50 flex items-center justify-center cursor-help">
                      <Crown className="h-3 w-3 text-amber-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Rank is determined by market share at close time</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-xs font-bold text-violet-500 w-5 text-center">#{i + 1}</span>
              )}
            </div>
            <PersonAvatar name={leader.name} avatar={leader.avatar} size="sm" />
            <span className="text-sm flex-1 truncate">{leader.name}</span>
            <div className="text-right">
              <p className="text-xs font-mono font-bold text-green-500">+{leader.currentGain.toLocaleString()} pts</p>
              <p className="text-[10px] font-mono text-muted-foreground">+{leader.percentGain}%</p>
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-violet-500">
          Pool: {market.totalPool.toLocaleString()}
        </span>
      </div>
      
      <div className="mt-auto">
        {isPredicted ? (
          <Button 
            size="sm" 
            className="w-full bg-green-600/20 text-green-500 border border-green-500/30"
            disabled
          >
            Predicted
          </Button>
        ) : isMarketClosed ? (
          <Button 
            size="sm" 
            className="w-full bg-muted text-muted-foreground cursor-not-allowed"
            disabled
          >
            <Lock className="h-4 w-4 mr-2" />
            Awaiting Results
          </Button>
        ) : (
          <Button 
            size="sm" 
            className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
            data-testid={`button-place-prediction-${market.id}`}
            onClick={handlePlacePrediction}
          >
            Place Prediction
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </PredictCard>
  );
}

function OpenMarketCard({ market, onNavigate, isMarketClosed = false }: { market: any; onNavigate: (slug: string, pick?: string) => void; isMarketClosed?: boolean }) {
  const entries = market.entries || [];
  const totalStake = entries.reduce((sum: number, e: any) => sum + (e.totalStake || 0), 0);
  const totalPool = totalStake + Number(market.seedVolume || 0);
  const entrySeedTotal = entries.reduce((sum: number, e: any) => sum + (e.seedCount || 0), 0);
  const participants = (market.betCount || 0) + entrySeedTotal;
  const isInactive = market.visibility === "inactive";
  
  const endDate = market.endAt ? new Date(market.endAt) : null;
  const now = new Date();
  const daysLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;
  const timeLabel = daysLeft > 1 ? `${daysLeft}d left` : daysLeft === 1 ? "1d left" : "Closing soon";

  if (market.openMarketType === "updown") {
    return <UpDownMarketCard market={market} entries={entries} totalPool={totalPool} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} />;
  }
  if (market.openMarketType === "multi") {
    return <MultiMarketCard market={market} entries={entries} totalPool={totalPool} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} />;
  }
  return <BinaryMarketCard market={market} entries={entries} totalPool={totalPool} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} />;
}

function BinaryMarketCard({ market, entries, totalPool, participants, timeLabel, onNavigate, isMarketClosed, isInactive = false, inactiveMessage }: { market: any; entries: any[]; totalPool: number; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string) => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string }) {
  const yesEntry = entries.find((e: any) => e.label === "Yes") || entries[0];
  const noEntry = entries.find((e: any) => e.label === "No") || entries[1];
  const yesStake = (yesEntry?.totalStake || 0) + (yesEntry?.seedCount || 0);
  const noStake = (noEntry?.totalStake || 0) + (noEntry?.seedCount || 0);
  const total = yesStake + noStake || 1;
  const yesPercent = Math.round((yesStake / total) * 100);
  const noPercent = 100 - yesPercent;
  
  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`min-h-[300px] ${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {timeLabel}
        </Badge>
        {market.category && <CategoryPill category={market.category} />}
      </div>
      
      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <div className="flex items-center gap-3 mb-2">
          <MarketAvatar market={market} />
          <p className={`text-sm font-semibold line-clamp-2 ${isInactive ? '' : 'hover:text-violet-400'} transition-colors`}>{market.title}</p>
        </div>
      </a>
      {market.teaser && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{market.teaser}</p>}
      
      <div className="mt-auto pt-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Users className="h-3.5 w-3.5" />
          <span>{participants} participants</span>
        </div>
        
        <div className="mb-2">
          <div className="h-3 rounded-full bg-red-500/20 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all" style={{ width: `${yesPercent}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs mt-1.5">
            <span className="text-green-500 font-semibold">Yes {yesPercent}%</span>
            <span className="text-red-500 font-semibold">No {noPercent}%</span>
          </div>
        </div>
      </div>
      
      <div>
        <div className="flex items-center justify-center mb-1.5">
          <span className="text-sm font-semibold text-violet-500">Pool: {totalPool.toLocaleString()}</span>
        </div>
        
        {isMarketClosed ? (
          <Button className="w-full bg-muted text-muted-foreground cursor-not-allowed" disabled>
            <Lock className="h-4 w-4 mr-2" />
            Closed
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button className="bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20" onClick={() => onNavigate(market.slug, 'yes')} data-testid={`button-yes-${market.slug}`}>
              Yes {yesPercent}%
            </Button>
            <Button className="bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20" onClick={() => onNavigate(market.slug, 'no')} data-testid={`button-no-${market.slug}`}>
              No {noPercent}%
            </Button>
          </div>
        )}
      </div>
    </PredictCard>
  );
}

function MultiMarketCard({ market, entries, totalPool, participants, timeLabel, onNavigate, isMarketClosed, isInactive = false, inactiveMessage }: { market: any; entries: any[]; totalPool: number; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string) => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string }) {
  const sortedEntries = [...entries].sort((a: any, b: any) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const totalEntryStake = entries.reduce((sum: number, e: any) => sum + (e.totalStake || 0) + (e.seedCount || 0), 0) || 1;
  
  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`min-h-[300px] ${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {timeLabel}
        </Badge>
        {market.category && <CategoryPill category={market.category} />}
      </div>
      
      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <div className="flex items-center gap-3 mb-2">
          <MarketAvatar market={market} />
          <p className={`text-sm font-semibold line-clamp-2 ${isInactive ? '' : 'hover:text-violet-400'} transition-colors`}>{market.title}</p>
        </div>
      </a>
      {market.teaser && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{market.teaser}</p>}
      
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Users className="h-3.5 w-3.5" />
        <span>{participants} participants</span>
        <Badge variant="outline" className="text-[10px] ml-auto">{entries.length} options</Badge>
      </div>
      
      <div className="space-y-2 mb-2">
        {sortedEntries.slice(0, 2).map((entry: any) => {
          const entryStake = (entry.totalStake || 0) + (entry.seedCount || 0);
          const pct = Math.round((entryStake / totalEntryStake) * 100);
          return (
            <div key={entry.id} className="flex items-center gap-3">
              {entry.imageUrl && (
                <Avatar className="h-8 w-8 shrink-0 rounded-md">
                  <AvatarImage src={entry.imageUrl} alt={entry.label} className="object-cover" />
                  <AvatarFallback className="text-[10px] rounded-md">{entry.label?.[0]}</AvatarFallback>
                </Avatar>
              )}
              <span className="text-sm font-medium truncate flex-1 min-w-0">{entry.label}</span>
              <div className="w-24 h-2.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm font-semibold text-muted-foreground w-10 text-right">{pct}%</span>
            </div>
          );
        })}
        {entries.length > 2 && <p className="text-xs text-muted-foreground text-center font-medium">+{entries.length - 2} more</p>}
      </div>
      
      <div className="mt-auto">
        <div className="flex items-center justify-center mb-1.5">
          <span className="text-sm font-semibold text-violet-500">Pool: {totalPool.toLocaleString()}</span>
        </div>
        
        <Button className="w-full bg-[#7C3AED]/10 border border-[#7C3AED]/50 text-[#7C3AED] hover:border-[#7C3AED]/80 hover:bg-[#7C3AED]/20" onClick={() => onNavigate(market.slug)} disabled={isMarketClosed} data-testid={`button-predict-${market.slug}`}>
          {isMarketClosed ? "Closed" : "Make Prediction"}
        </Button>
      </div>
    </PredictCard>
  );
}

function UpDownMarketCard({ market, entries, totalPool, participants, timeLabel, onNavigate, isMarketClosed, isInactive = false, inactiveMessage }: { market: any; entries: any[]; totalPool: number; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string) => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string }) {
  const aboveEntry = entries.find((e: any) => e.label === "Above") || entries[0];
  const belowEntry = entries.find((e: any) => e.label === "Below") || entries[1];
  const aboveStake = (aboveEntry?.totalStake || 0) + (aboveEntry?.seedCount || 0);
  const belowStake = (belowEntry?.totalStake || 0) + (belowEntry?.seedCount || 0);
  const total = aboveStake + belowStake || 1;
  const abovePercent = Math.round((aboveStake / total) * 100);
  const belowPercent = 100 - abovePercent;
  
  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`min-h-[300px] ${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {timeLabel}
        </Badge>
        {market.category && <CategoryPill category={market.category} />}
      </div>
      
      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <div className="flex items-center gap-3 mb-2">
          <MarketAvatar market={market} />
          <p className={`text-sm font-semibold line-clamp-2 ${isInactive ? '' : 'hover:text-violet-400'} transition-colors`}>{market.title}</p>
        </div>
      </a>
      
      {market.underlying && (
        <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          <div className="text-xs">
            <span className="text-muted-foreground">{market.underlying} {market.metric}: </span>
            <span className="font-semibold">{market.unit}{Number(market.strike).toLocaleString()}</span>
          </div>
        </div>
      )}
      
      <div className="mt-auto pt-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Users className="h-3.5 w-3.5" />
          <span>{participants} participants</span>
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
          <span className="text-sm font-semibold text-violet-500">Pool: {totalPool.toLocaleString()}</span>
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
      </div>
    </PredictCard>
  );
}

function SuggestMarketCard({ onClick }: { onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className="border-2 border-dashed border-violet-500/30 rounded-xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-all min-h-[200px]"
      data-testid="card-suggest-market"
    >
      <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center">
        <Plus className="h-6 w-6 text-violet-500" />
      </div>
      <p className="text-sm font-medium text-violet-500">Suggest a Market</p>
      <p className="text-xs text-muted-foreground text-center">Create your own prediction for the community</p>
    </div>
  );
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
  onAuthRequired
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
}) {
  const dragScrollRef = useDragScroll<HTMLDivElement>();
  useScrollHint(dragScrollRef);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  
  if (!open) return null;
  
  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto premium-scrollbar" data-testid="overlay-view-all">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif font-bold text-xl">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-overlay">
              <X className="h-5 w-5" />
            </Button>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9"
                data-testid="input-overlay-search"
              />
            </div>
            
            <div ref={dragScrollRef} className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
              {CATEGORY_FILTERS.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    if (cat.id === "favorites" && !user) {
                      onAuthRequired?.();
                      return;
                    }
                    onCategoryChange(cat.id);
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all backdrop-blur-sm flex items-center gap-1.5 ${
                    categoryFilter === cat.id
                      ? 'bg-violet-500/20 text-violet-300 border border-violet-400/40 shadow-sm shadow-violet-500/20'
                      : 'bg-background/50 border border-border/50 text-muted-foreground hover:bg-muted/80 hover:border-violet-400/20'
                  }`}
                  data-testid={`chip-overlay-${cat.id}`}
                  aria-label={cat.id === "favorites" ? "Favorites" : undefined}
                >
                  {cat.id === "favorites" && <Star className="h-3.5 w-3.5" />}
                  {cat.id === "favorites" ? <span className="hidden md:inline">{cat.label}</span> : cat.label}
                </button>
              ))}
            </div>
          </div>
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

const MISSION_HEADERS: Record<string, string> = {
  jackpot: "Predict the exact Trend Score at week's end to win the pot.",
  updown: "Will their Trend Score be higher or lower by close?",
  h2h: "Back your champion to win this weekly matchup.",
  race: "Predict the #1 top performer to win.",
  gainer: "Predict the #1 top performer to win.",
  community: "Cast your vote on this real-world prediction.",
};

function StakeModal({
  open,
  onClose,
  selection,
  onConfirm,
  walletBalance,
  onConfirmWithAnimation
}: {
  open: boolean;
  onClose: () => void;
  selection: { type: string; choice: string; marketName: string; marketId?: string; startScore?: number; currentScore?: number; crowdSentiment?: number; estimatedPayout?: number } | null;
  onConfirm: (amount: number) => void;
  walletBalance: number;
  onConfirmWithAnimation?: (amount: number, marketId?: string) => void;
}) {
  const [stakeAmount, setStakeAmount] = useState("");
  const parsedAmount = parseInt(stakeAmount) || 0;
  const balanceAfter = walletBalance - parsedAmount;
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  
  if (!selection) return null;
  
  const missionText = MISSION_HEADERS[selection.type] || "Place your prediction on this market.";
  const showJackpotWarning = selection.type === "jackpot";
  
  const triggerConfetti = () => {
    if (confirmButtonRef.current) {
      const rect = confirmButtonRef.current.getBoundingClientRect();
      const x = (rect.left + rect.width / 2) / window.innerWidth;
      const y = (rect.top + rect.height / 2) / window.innerHeight;
      
      confetti({
        particleCount: 60,
        spread: 55,
        origin: { x, y },
        colors: ['#06b6d4', '#a855f7', '#8b5cf6', '#22d3ee'],
        startVelocity: 25,
        gravity: 1.2,
        scalar: 0.8,
        ticks: 100,
      });
    }
  };
  
  const handleConfirm = () => {
    if (parsedAmount > 0 && balanceAfter >= 0) {
      try {
        triggerConfetti();
      } catch (e) {
        console.error("Confetti error:", e);
      }
      onConfirm(parsedAmount);
      setStakeAmount("");
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-sm premium-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-violet-500" />
            Confirm Prediction
          </DialogTitle>
          <DialogDescription>
            {missionText}
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <Card className="p-3 bg-violet-500/5 border-violet-500/20">
            <p className="text-xs text-muted-foreground mb-1">Market</p>
            <p className="text-sm font-semibold text-foreground">{selection.marketName}</p>
            <p className="text-lg font-bold mt-1 text-[#00c853]">{selection.choice}</p>
          </Card>
          
          {showJackpotWarning && (
            <p className="text-xs text-amber-500 text-center flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" />
              Predictions lock Thursday 5 PM UTC
            </p>
          )}
          
          {(selection.startScore || selection.currentScore) && (
            <div className="grid grid-cols-2 gap-3">
              {selection.startScore && (
                <Card className="p-2.5 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Start Score</p>
                  <p className="font-mono font-bold text-sm">{selection.startScore.toLocaleString()}</p>
                </Card>
              )}
              {selection.currentScore && (
                <Card className="p-2.5 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Current Score</p>
                  <p className="font-mono font-bold text-sm">{selection.currentScore.toLocaleString()}</p>
                </Card>
              )}
            </div>
          )}
          
          {selection.estimatedPayout && !isNaN(selection.estimatedPayout) && (
            <p className="text-xs text-muted-foreground text-center">
              Estimated Payout: <span className="font-mono font-medium text-green-500">{selection.estimatedPayout.toFixed(1)}x</span>
            </p>
          )}
          
          {selection.crowdSentiment && (
            <p className="text-xs text-muted-foreground text-center">
              Crowd Sentiment: <span className="font-mono font-medium text-foreground">{selection.crowdSentiment}% predict this outcome</span>
            </p>
          )}
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Stake Amount</label>
            <Input
              type="number"
              placeholder="Enter credits to stake"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="font-mono"
              data-testid="input-stake"
            />
          </div>
          
          <div className="flex gap-2">
            {[100, 500, 1000].map((amount) => (
              <Button
                key={amount}
                variant="outline"
                size="sm"
                onClick={() => setStakeAmount(amount.toString())}
                className="flex-1"
                data-testid={`button-preset-${amount}`}
              >
                {amount}
              </Button>
            ))}
          </div>
          
          <div className="flex items-center justify-between text-xs pt-2 border-t">
            <div>
              <span className="text-muted-foreground">Current Balance: </span>
              <span className="font-mono font-medium">{walletBalance.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">After Stake: </span>
              <span className={`font-mono font-medium ${balanceAfter < 0 ? 'text-red-500' : 'text-green-500'}`}>
                {balanceAfter >= 0 ? balanceAfter.toLocaleString() : 'Insufficient'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            ref={confirmButtonRef}
            onClick={handleConfirm}
            className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
            disabled={!stakeAmount || parsedAmount <= 0 || balanceAfter < 0}
            data-testid="button-confirm-stake"
          >
            Confirm
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
            Start a Prediction
          </DialogTitle>
          <DialogDescription>
            Create a market for the community to predict on
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
            Create Market
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
                  <span className="text-xs font-mono text-muted-foreground">{Math.round(person.trendScore).toLocaleString()}</span>
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
  isLoading
}: {
  onEnterJackpot: () => void;
  isMarketClosed: boolean;
  timeRemaining: { days: number; hours: number; minutes: number; seconds: number };
  trendingPeople: TrendingPerson[];
  selectedPerson: TrendingPerson | null;
  onSelectPerson: (person: TrendingPerson) => void;
  isLoading: boolean;
}) {
  const [searchModalOpen, setSearchModalOpen] = useState(false);

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
            ) : (
              <Button 
                size="lg"
                className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30"
                onClick={onEnterJackpot}
                disabled={!selectedPerson}
                data-testid="button-enter-jackpot"
              >
                <Crown className="h-5 w-5 mr-2" />
                Enter Jackpot
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
              Pool: 50,000+ credits
            </p>
          </div>
        </div>
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
  const { user } = useAuth();
  const [showFirstTimeModal, setShowFirstTimeModal] = useState(false);
  const [selectedType, setSelectedType] = useState<PredictionType>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
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
  const [walletCredits, setWalletCredits] = useState(10000);
  const [activePredictions, setActivePredictions] = useState(0);
  const [viewAllCategory, setViewAllCategory] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState<string | null>(null);
  
  const [pendingSelection, setPendingSelection] = useState<{
    type: string;
    choice: string;
    marketName: string;
    marketId?: string;
    startScore?: number;
    currentScore?: number;
    crowdSentiment?: number;
    estimatedPayout?: number;
  } | null>(null);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [predictedMarkets, setPredictedMarkets] = useState<Set<string>>(new Set());
  const [shimmeringMarket, setShimmeringMarket] = useState<string | null>(null);
  
  const RULES_CONTENT: Record<string, { title: string; description: string; steps: { icon: React.ReactNode; title: string; description: string }[] }> = {
    updown: {
      title: "How Up/Down Works",
      description: "Predict if someone's trend score will go up or down this week",
      steps: [
        { icon: <TrendingUp className="h-4 w-4 text-violet-500" />, title: "Pick a Direction", description: "Choose UP if you think their trend score will increase, or DOWN if you think it will decrease." },
        { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Stake Your Credits", description: "The more you stake, the more you can win. Your potential return depends on the pool split." },
        { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Wait for Results", description: "When the market closes Sunday 23:59 UTC, winners split the pool proportionally." },
      ]
    },
    h2h: {
      title: "How Head-to-Head Works",
      description: "Predict who will gain more trend points this week",
      steps: [
        { icon: <Swords className="h-4 w-4 text-violet-500" />, title: "Pick Your Winner", description: "Choose which person you think will gain more trend points by the end of the week." },
        { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Stake Your Credits", description: "Your potential multiplier depends on how many others picked the same side." },
        { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Winner Takes the Pool", description: "If your pick gains more points, you split the total pool with other winners." },
      ]
    },
    gainer: {
      title: "How Top Gainer Works",
      description: "Predict which celebrity will add the most raw points",
      steps: [
        { icon: <BarChart3 className="h-4 w-4 text-violet-500" />, title: "Raw Points Focus", description: "This market tracks total points ADDED, not percentage gain. Big names can add more raw points." },
        { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Pick Your Horse", description: "Choose who you think will add the most absolute trend points this week." },
        { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Winner Determined by Data", description: "The person with the highest raw point increase when the market closes wins." },
      ]
    },
    community: {
      title: "Real-World Markets",
      description: "These markets track verifiable global events (e.g., elections, business acquisitions, viral moments). Predictions are settled based on definitive public outcomes.",
      steps: [
        { icon: <Globe className="h-4 w-4 text-violet-500" />, title: "Verifiable Events", description: "Markets are based on real-world outcomes that can be publicly verified - elections, acquisitions, viral milestones, and more." },
        { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Yes/No Predictions", description: "Each market has a clear binary outcome. Stake your credits on what you believe will happen." },
        { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Public Resolution", description: "Markets are settled based on definitive public information. Winners split the pool proportionally." },
      ]
    }
  };
  
  const marketCycle = useMarketCycle();
  const isMarketClosed = marketCycle.status === "CLOSED";
  
  const { data: trendingResponse, isLoading: isLoadingPeople } = useQuery<{ data: TrendingPerson[], totalCount: number, hasMore: boolean }>({
    queryKey: ['/api/trending?sort=rank'],
  });
  const trendingPeople = trendingResponse?.data || [];
  
  const { data: openMarketsData, isLoading: isLoadingOpenMarkets } = useQuery<any[]>({
    queryKey: ['/api/open-markets'],
  });
  const openMarkets = openMarketsData || [];

  const { data: nativeUpdownData } = useQuery<any[]>({
    queryKey: ['/api/native-markets/updown'],
  });
  const { data: nativeH2hData } = useQuery<any[]>({
    queryKey: ['/api/native-markets/h2h'],
  });
  const { data: nativeGainerData } = useQuery<any[]>({
    queryKey: ['/api/native-markets/gainer'],
  });

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
        return {
          id: m.id,
          personId: m.personId || "",
          personName: person.name || m.title?.replace(/: Up or Down\?$/, "") || "Unknown",
          personAvatar: person.avatar || "",
          currentScore: Number(person.trendScore || 0),
          startScore: Number(person.trendScore || 0) - Math.floor(Number(person.trendScore || 0) * (Number(person.change7d || 0) / 100)),
          change7d: Number(person.change7d || 0),
          upMultiplier,
          downMultiplier,
          endTime: "Sun 23:59 UTC",
          totalPool: Number(m.seedVolume || 0),
          upPoolPercent: upPercent || 50,
          category: (m.category || person.category || "misc") as CategoryFilter,
          totalBets: Number(m.seedConfig?.participants || 0),
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
        return {
          id: m.id,
          title: m.title || `${p1.name || "?"} vs ${p2.name || "?"}`,
          person1: { name: p1.name || e1.label || "?", avatar: p1.avatar || "", currentScore: Number(p1.trendScore || 0) },
          person2: { name: p2.name || e2.label || "?", avatar: p2.avatar || "", currentScore: Number(p2.trendScore || 0) },
          category: (m.category || "misc") as CategoryFilter,
          endTime: "Sun 23:59 UTC",
          totalPool: Number(m.seedVolume || 0),
          person1Percent: Math.round((s1 / total) * 100) || 50,
          totalBets: Number(m.seedConfig?.participants || 0),
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
        return {
          id: m.id,
          category: (m.category || "misc") as CategoryFilter,
          leaders: entries.slice(0, 3).map((e: any) => {
            const p = e.person || {};
            return {
              name: p.name || e.label || "?",
              avatar: p.avatar || "",
              currentGain: Math.abs(Number(p.change7d || 0) * Number(p.trendScore || 0) / 100),
              percentGain: Math.abs(Number(p.change7d || 0)),
            };
          }),
          totalPool: Number(m.seedVolume || 0),
          endTime: "Sun 23:59 UTC",
          totalBets: Number(m.seedConfig?.participants || 0),
        } as TopGainerMarket;
      });
    }
    if (import.meta.env.VITE_USE_MOCK_PREDICT_DATA === "true") return topGainerMarkets;
    return [];
  }, [nativeGainerData]);
  
  const [selectedJackpotPerson, setSelectedJackpotPerson] = useState<TrendingPerson | null>(null);
  
  useEffect(() => {
    if (trendingPeople.length > 0 && !selectedJackpotPerson) {
      const rank1Person = trendingPeople.find(p => p.rank === 1) || trendingPeople[0];
      setSelectedJackpotPerson(rank1Person);
    }
  }, [trendingPeople, selectedJackpotPerson]);

  useEffect(() => {
    const hasVisited = localStorage.getItem(FIRST_VISIT_KEY);
    if (!hasVisited) {
      setShowFirstTimeModal(true);
    }
  }, []);

  // Sync global category filter to all section filters
  useEffect(() => {
    setUpdownCategory(categoryFilter);
    setH2hCategory(categoryFilter);
    setGainerCategory(categoryFilter);
    setCommunityCategory(categoryFilter);
  }, [categoryFilter]);

  const handleCloseFirstTimeModal = () => {
    localStorage.setItem(FIRST_VISIT_KEY, "true");
    setShowFirstTimeModal(false);
  };

  const handleEnterJackpot = () => {
    if (!selectedJackpotPerson) return;
    setPendingSelection({
      type: "jackpot",
      choice: `Predict exact score for ${selectedJackpotPerson.name}`,
      marketName: "Weekly Jackpot",
      marketId: "jackpot",
      startScore: selectedJackpotPerson.trendScore - Math.floor(selectedJackpotPerson.trendScore * 0.02),
      currentScore: selectedJackpotPerson.trendScore,
      crowdSentiment: 12,
      estimatedPayout: 8.5
    });
    setStakeModalOpen(true);
  };

  const handleUpDownSelect = (market: PredictionMarket, choice: "up" | "down") => {
    const crowdSentiment = choice === "up" ? market.upPoolPercent : (100 - market.upPoolPercent);
    const estimatedPayout = choice === "up" ? market.upMultiplier : market.downMultiplier;
    setPendingSelection({
      type: "updown",
      choice: choice === "up" ? "Trend Score UP" : "Trend Score DOWN",
      marketName: market.personName,
      marketId: market.id,
      startScore: market.startScore,
      currentScore: market.currentScore,
      crowdSentiment,
      estimatedPayout
    });
    setStakeModalOpen(true);
  };

  const handleH2HSelect = (market: HeadToHeadMarket, person: 1 | 2) => {
    const chosenPerson = person === 1 ? market.person1 : market.person2;
    const crowdSentiment = person === 1 ? market.person1Percent : (100 - market.person1Percent);
    const estimatedPayout = person === 1 ? (100 / market.person1Percent) : (100 / (100 - market.person1Percent));
    setPendingSelection({
      type: "h2h",
      choice: chosenPerson.name,
      marketName: market.title,
      marketId: market.id,
      currentScore: chosenPerson.currentScore,
      crowdSentiment,
      estimatedPayout: Math.round(estimatedPayout * 10) / 10
    });
    setStakeModalOpen(true);
  };

  const handleGainerSelect = (market: TopGainerMarket, name: string) => {
    const leader = market.leaders.find(l => l.name === name);
    const leaderIndex = market.leaders.findIndex(l => l.name === name);
    const crowdSentiment = leaderIndex === 0 ? 45 : leaderIndex === 1 ? 32 : 23;
    const estimatedPayout = Math.round((100 / crowdSentiment) * 10) / 10;
    setPendingSelection({
      type: "gainer",
      choice: name,
      marketName: `Top Gainer: ${market.category}`,
      marketId: market.id,
      currentScore: leader?.currentGain,
      crowdSentiment,
      estimatedPayout
    });
    setStakeModalOpen(true);
  };

  const handleConfirmStake = (amount: number) => {
    const marketId = pendingSelection?.marketId;
    
    setWalletCredits(prev => prev - amount);
    setActivePredictions(prev => prev + 1);
    
    if (marketId) {
      setPredictedMarkets(prev => new Set(prev).add(marketId));
      setShimmeringMarket(marketId);
      setTimeout(() => setShimmeringMarket(null), 800);
    }
    
    setStakeModalOpen(false);
    setPendingSelection(null);
    toast({
      title: "Prediction placed!",
      description: `You staked ${amount} credits.`,
    });
  };

  const handleCreatePrediction = (data: { title: string; type: string; category: CategoryFilter; description: string }) => {
    toast({
      title: "Market created!",
      description: "Your prediction is now live for the community.",
    });
  };

  // Section-specific filtering logic
  const filteredUpDown = hydratedMarkets.filter(m => 
    (updownCategory === "all" || updownCategory === "trending" || m.category === updownCategory) &&
    (!updownSearch || m.personName.toLowerCase().includes(updownSearch.toLowerCase()))
  ).sort((a: any, b: any) => updownCategory === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0);

  const filteredH2H = hydratedH2H.filter(m => 
    (h2hCategory === "all" || h2hCategory === "trending" || m.category === h2hCategory) &&
    (!h2hSearch || m.title.toLowerCase().includes(h2hSearch.toLowerCase()) || 
     m.person1.name.toLowerCase().includes(h2hSearch.toLowerCase()) ||
     m.person2.name.toLowerCase().includes(h2hSearch.toLowerCase()))
  ).sort((a: any, b: any) => h2hCategory === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0);

  const filteredGainers = hydratedGainers.filter(m => 
    (gainerCategory === "all" || gainerCategory === "trending" || m.category === gainerCategory) &&
    (!gainerSearch || m.category.toLowerCase().includes(gainerSearch.toLowerCase()) ||
     m.leaders.some(l => l.name.toLowerCase().includes(gainerSearch.toLowerCase())))
  ).sort((a: any, b: any) => gainerCategory === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0);

  const filteredCommunity = openMarkets.filter((m: any) => 
    (communityCategory === "all" || communityCategory === "trending" || m.category === communityCategory) &&
    (!communitySearch || m.title?.toLowerCase().includes(communitySearch.toLowerCase()))
  ).sort((a: any, b: any) => communityCategory === "trending" ? ((b.seedVolume ?? 0) - (a.seedVolume ?? 0)) : 0);

  const showSection = (type: PredictionType) => selectedType === "all" || selectedType === type;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
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
              <AuthoriDexLogo size={32} />
              <span className="font-serif font-bold text-xl hidden sm:block">AuthoriDex</span>
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
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="sticky top-16 z-40 bg-background/80 backdrop-blur-xl border-b">
        <div className="container mx-auto px-4 py-3 max-w-7xl">
          <HorizontalScroll className="pb-1">
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
        </div>
      </div>
      <div className="container mx-auto px-4 py-4 max-w-7xl">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative w-full sm:w-[163px] sm:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search markets..."
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-global-search"
            />
          </div>
          
          <HorizontalScroll className="sm:pb-0">
            {CATEGORY_FILTERS.map((cat) => {
              const IconComponent = CATEGORY_ICONS[cat.id];
              const isIconOnly = cat.id === "favorites";
              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    if (cat.id === "favorites" && !user) {
                      setLocation("/login");
                      return;
                    }
                    setCategoryFilter(cat.id);
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all backdrop-blur-sm flex items-center gap-1.5 ${
                    categoryFilter === cat.id
                      ? 'bg-violet-500/20 text-violet-300 border border-violet-400/40 shadow-sm shadow-violet-500/20'
                      : 'bg-background/50 border border-border/50 text-muted-foreground hover:bg-muted/80 hover:border-violet-400/20'
                  }`}
                  data-testid={`chip-category-${cat.id}`}
                  aria-label={isIconOnly ? cat.label : undefined}
                >
                  <IconComponent className="h-3.5 w-3.5" />
                  {isIconOnly ? <span className="hidden md:inline">{cat.label}</span> : cat.label}
                </button>
              );
            })}
          </HorizontalScroll>
        </div>

        <div className="flex items-center gap-4 mb-6 md:hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/30">
            <Wallet className="h-4 w-4 text-violet-500" />
            <span className="font-mono font-bold text-sm">{walletCredits.toLocaleString()}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/30 text-violet-500">TEST</Badge>
          </div>
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{activePredictions} active</span>
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 max-w-7xl">
        {/* SECTION HEADER: Open Markets (Real-World Predictions) */}
        {showSection("community") && (
          <div className="relative overflow-hidden mb-6">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-transparent" />
            <div className="relative py-4">
              <div className="text-center">
                <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2" data-testid="text-open-markets-title">
                  Open Markets
                </h2>
                <p className="text-muted-foreground max-w-2xl mx-auto mb-3">Predict the outcome of any topic.</p>
                <button
                  onClick={() => setRulesModalOpen("community")}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 hover:border-violet-500/30 transition-all cursor-pointer"
                  data-testid="button-prediction-rules"
                >
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  <span className="text-sm text-violet-400 font-medium">How It Works</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Real-World Markets Section - Now First */}
        {showSection("community") && (
          <section className="mb-12">
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gradient-to-r from-violet-500/5 via-violet-500/10 to-transparent border border-violet-500/20 backdrop-blur-sm mt-[15px] mb-[15px]">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg sm:text-xl font-serif font-bold truncate">Real-World Markets</h2>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">Predict the outcome of verifiable global events</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7"
                      onClick={() => setRulesModalOpen("community")}
                      data-testid="button-rules-real-world-markets"
                    >
                      <HelpCircle className="h-4 w-4 text-violet-500" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>How it works</TooltipContent>
                </Tooltip>
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateModalOpen(true)}
                  className="border-violet-500/30 text-violet-500"
                  data-testid="button-start-prediction"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Suggest</span>
                </Button>
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
            />
            {isLoadingOpenMarkets ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredCommunity.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-community" dotActiveColor="bg-violet-500">
                {filteredCommunity.map((market: any) => (
                  <OpenMarketCard 
                    key={market.id} 
                    market={market} 
                    onNavigate={(slug, pick) => setLocation(`/markets/${slug}${pick ? `?pick=${pick}` : ''}`)}
                    isMarketClosed={market.status !== 'OPEN'}
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
                onClick={() => setViewAllCategory("community")}
                data-testid="button-view-all-real-world"
              >
                View All Markets
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </section>
        )}

        {/* SECTION HEADER: Predict the Trend Score (Official Markets) */}
        {(showSection("jackpot") || showSection("updown") || showSection("h2h") || showSection("gainer")) && (
          <div className="relative overflow-hidden mb-6">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-transparent" />
            <div className="relative py-4">
              <div className="text-center">
                <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2" data-testid="text-fame-score-title">Predict the Trend Score</h2>
                <p className="text-muted-foreground max-w-2xl mx-auto mb-3">Forecast celebrity trend score movements.</p>
                <button
                  onClick={() => setShowFirstTimeModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 hover:border-violet-500/30 transition-all cursor-pointer"
                  data-testid="button-how-scoring-works"
                >
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  <span className="text-sm text-violet-400 font-medium">How It Works</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div>
        <MarketCycleHero marketState={marketCycle} />

        {showSection("jackpot") && (
          <WeeklyJackpotHero 
            onEnterJackpot={handleEnterJackpot}
            isMarketClosed={isMarketClosed}
            timeRemaining={marketCycle.timeRemaining}
            trendingPeople={trendingPeople}
            selectedPerson={selectedJackpotPerson}
            onSelectPerson={setSelectedJackpotPerson}
            isLoading={isLoadingPeople}
          />
        )}

        {showSection("updown") && (
          <section className="mb-10">
            <SectionHeader
              title="Weekly Up / Down"
              onRulesClick={() => setRulesModalOpen("updown")}
            >
              <p className="text-xs sm:text-sm text-muted-foreground truncate">Will their trend score be higher / lower</p>
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
            />
            {filteredUpDown.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-updown" dotActiveColor="bg-violet-500">
                {filteredUpDown.map((market) => (
                  <WeeklyUpDownCard 
                    key={market.id} 
                    market={market} 
                    isMarketClosed={isMarketClosed}
                    onSelect={(choice) => handleUpDownSelect(market, choice)}
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
                onClick={() => setViewAllCategory("weekly")}
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
              onRulesClick={() => setRulesModalOpen("h2h")}
            >
              <p className="text-xs sm:text-sm text-muted-foreground truncate">Who will gain more points</p>
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
            />
            {filteredH2H.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-h2h" dotActiveColor="bg-violet-500">
                {filteredH2H.map((market) => (
                  <HeadToHeadCard 
                    key={market.id} 
                    market={market} 
                    isMarketClosed={isMarketClosed}
                    onSelect={(person) => handleH2HSelect(market, person)}
                  />
                ))}
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
                onClick={() => setViewAllCategory("h2h")}
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
              title="Top Gainer Predictions"
              onRulesClick={() => setRulesModalOpen("gainer")}
            >
              <p className="text-xs sm:text-sm text-muted-foreground truncate">Who will gain the most points</p>
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
            />
            {filteredGainers.length > 0 ? (
              <CardSection desktopLimit={9} gap="gap-4" testIdPrefix="section-gainer" dotActiveColor="bg-violet-500">
                {filteredGainers.map((market) => (
                  <TopGainerCard 
                    key={market.id} 
                    market={market} 
                    isMarketClosed={isMarketClosed}
                    onSelect={(name) => handleGainerSelect(market, name)}
                    isPredicted={predictedMarkets.has(market.id)}
                    isShimmering={shimmeringMarket === market.id}
                  />
                ))}
              </CardSection>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No gainers match your filters
              </div>
            )}
            <div className="flex justify-center mt-6">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-violet-500 hover:text-violet-400 text-[14px]"
                onClick={() => setViewAllCategory("gainers")}
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
            onClick={() => setShowFirstTimeModal(true)}
            className="text-sm text-muted-foreground hover:text-violet-500 transition-colors"
          >
            <HelpCircle className="h-4 w-4 inline mr-1" />
            How it works
          </button>
        </div>
      </div>
      <FirstTimeModal 
        open={showFirstTimeModal} 
        onClose={handleCloseFirstTimeModal} 
      />
      <FullScreenOverlay
        open={viewAllCategory === "weekly"}
        onClose={() => setViewAllCategory(null)}
        title="All Weekly Up/Down Markets"
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
            />
          ))}
      </FullScreenOverlay>
      <FullScreenOverlay
        open={viewAllCategory === "h2h"}
        onClose={() => setViewAllCategory(null)}
        title="All Head-to-Head Battles"
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
          .map((market) => (
            <HeadToHeadCard 
              key={market.id} 
              market={market} 
              isMarketClosed={isMarketClosed}
              onSelect={(person) => handleH2HSelect(market, person)}
            />
          ))}
      </FullScreenOverlay>
      <FullScreenOverlay
        open={viewAllCategory === "gainers"}
        onClose={() => setViewAllCategory(null)}
        title="All Top Gainer Predictions"
        categoryFilter={overlayCategoryFilter}
        onCategoryChange={setOverlayCategoryFilter}
        searchQuery={overlaySearchQuery}
        onSearchChange={setOverlaySearchQuery}
        user={user}
        onAuthRequired={() => setLocation("/login")}
      >
        {hydratedGainers
          .filter(m => 
            (overlayCategoryFilter === "all" || overlayCategoryFilter === "trending" || m.category === overlayCategoryFilter) &&
            (!overlaySearchQuery || m.category.toLowerCase().includes(overlaySearchQuery.toLowerCase()))
          )
          .map((market) => (
            <TopGainerCard 
              key={market.id} 
              market={market} 
              isMarketClosed={isMarketClosed}
              onSelect={(name) => handleGainerSelect(market, name)}
              isPredicted={predictedMarkets.has(market.id)}
              isShimmering={shimmeringMarket === market.id}
            />
          ))}
      </FullScreenOverlay>
      <FullScreenOverlay
        open={viewAllCategory === "community"}
        onClose={() => setViewAllCategory(null)}
        title="All Real-World Markets"
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
          .sort((a: any, b: any) => overlayCategoryFilter === "trending" ? ((b.seedVolume ?? 0) - (a.seedVolume ?? 0)) : 0)
          .map((market: any) => (
            <OpenMarketCard 
              key={market.id} 
              market={market} 
              onNavigate={(slug, pick) => setLocation(`/markets/${slug}${pick ? `?pick=${pick}` : ''}`)}
              isMarketClosed={market.status !== 'OPEN'}
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
