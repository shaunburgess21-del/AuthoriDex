import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MarketCycleHero } from "@/components/MarketCycleHero";
import { useMarketCycle } from "@/hooks/useMarketCycle";
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
  Clock,
  Search,
  Lock,
  Sparkles,
  Crown,
  UserPlus
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLocation, Link } from "wouter";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

interface PredictionMarket {
  id: string;
  personId: string;
  personName: string;
  personAvatar: string;
  currentScore: number;
  change7d: number;
  upMultiplier: number;
  downMultiplier: number;
  endTime: string;
  totalPool: number;
  upPoolPercent: number;
}

const mockMarkets: PredictionMarket[] = [
  {
    id: "market-1",
    personId: "1",
    personName: "Elon Musk",
    personAvatar: "",
    currentScore: 515809,
    change7d: 4.78,
    upMultiplier: 1.7,
    downMultiplier: 2.3,
    endTime: "Sun 23:59 UTC",
    totalPool: 15420,
    upPoolPercent: 58,
  },
  {
    id: "market-2",
    personId: "2",
    personName: "Taylor Swift",
    personAvatar: "",
    currentScore: 489234,
    change7d: -3.2,
    upMultiplier: 2.1,
    downMultiplier: 1.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 12350,
    upPoolPercent: 45,
  },
  {
    id: "market-3",
    personId: "3",
    personName: "MrBeast",
    personAvatar: "",
    currentScore: 504734,
    change7d: -4.95,
    upMultiplier: 1.5,
    downMultiplier: 2.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 9870,
    upPoolPercent: 65,
  },
  {
    id: "market-4",
    personId: "4",
    personName: "Donald Trump",
    personAvatar: "",
    currentScore: 484531,
    change7d: -3.35,
    upMultiplier: 1.4,
    downMultiplier: 3.2,
    endTime: "Sun 23:59 UTC",
    totalPool: 22100,
    upPoolPercent: 72,
  },
  {
    id: "market-5",
    personId: "5",
    personName: "Kim Kardashian",
    personAvatar: "",
    currentScore: 398456,
    change7d: -1.8,
    upMultiplier: 2.2,
    downMultiplier: 1.7,
    endTime: "Sun 23:59 UTC",
    totalPool: 8540,
    upPoolPercent: 42,
  },
  {
    id: "market-6",
    personId: "6",
    personName: "Cristiano Ronaldo",
    personAvatar: "",
    currentScore: 445678,
    change7d: 2.1,
    upMultiplier: 1.9,
    downMultiplier: 2.0,
    endTime: "Sun 23:59 UTC",
    totalPool: 11200,
    upPoolPercent: 51,
  },
];

interface HeadToHeadMarket {
  id: string;
  title: string;
  person1: { name: string; avatar: string };
  person2: { name: string; avatar: string };
  category: string;
  endTime: string;
  totalPool: number;
  person1Percent: number;
}

const headToHeadMarkets: HeadToHeadMarket[] = [
  {
    id: "h2h-1",
    title: "Drake vs Kendrick",
    person1: { name: "Drake", avatar: "" },
    person2: { name: "Kendrick Lamar", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 28450,
    person1Percent: 42,
  },
  {
    id: "h2h-2",
    title: "Musk vs Zuckerberg",
    person1: { name: "Elon Musk", avatar: "" },
    person2: { name: "Mark Zuckerberg", avatar: "" },
    category: "Tech",
    endTime: "Sun 23:59 UTC",
    totalPool: 19200,
    person1Percent: 68,
  },
  {
    id: "h2h-3",
    title: "Swift vs Beyoncé",
    person1: { name: "Taylor Swift", avatar: "" },
    person2: { name: "Beyoncé", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 15780,
    person1Percent: 55,
  },
  {
    id: "h2h-4",
    title: "Ronaldo vs Messi",
    person1: { name: "Cristiano Ronaldo", avatar: "" },
    person2: { name: "Lionel Messi", avatar: "" },
    category: "Sports",
    endTime: "Sun 23:59 UTC",
    totalPool: 34100,
    person1Percent: 48,
  },
];

interface CategoryRaceMarket {
  id: string;
  title: string;
  category: string;
  topContenders: { name: string; avatar: string }[];
  endTime: string;
  totalPool: number;
  timeRemaining: string;
}

const categoryRaceMarkets: CategoryRaceMarket[] = [
  {
    id: "race-1",
    title: "Top Music Gainer",
    category: "Music",
    topContenders: [
      { name: "Taylor Swift", avatar: "" },
      { name: "Drake", avatar: "" },
      { name: "The Weeknd", avatar: "" },
    ],
    endTime: "Sun 23:59 UTC",
    totalPool: 18900,
    timeRemaining: "2d 14h",
  },
  {
    id: "race-2",
    title: "Tech Leader Race",
    category: "Tech",
    topContenders: [
      { name: "Elon Musk", avatar: "" },
      { name: "Jensen Huang", avatar: "" },
      { name: "Sam Altman", avatar: "" },
    ],
    endTime: "Sun 23:59 UTC",
    totalPool: 22400,
    timeRemaining: "2d 14h",
  },
  {
    id: "race-3",
    title: "Sports Star Showdown",
    category: "Sports",
    topContenders: [
      { name: "Cristiano Ronaldo", avatar: "" },
      { name: "LeBron James", avatar: "" },
      { name: "Lionel Messi", avatar: "" },
    ],
    endTime: "Sun 23:59 UTC",
    totalPool: 16500,
    timeRemaining: "2d 14h",
  },
];

interface TopGainerMarket {
  id: string;
  category: string;
  leaders: { name: string; avatar: string; currentGain: number }[];
  totalPool: number;
  endTime: string;
}

const topGainerMarkets: TopGainerMarket[] = [
  {
    id: "gainer-1",
    category: "Music",
    leaders: [
      { name: "Taylor Swift", avatar: "", currentGain: 12450 },
      { name: "Drake", avatar: "", currentGain: 8920 },
      { name: "Bad Bunny", avatar: "", currentGain: 7340 },
    ],
    totalPool: 14200,
    endTime: "Sun 23:59 UTC",
  },
  {
    id: "gainer-2",
    category: "Tech",
    leaders: [
      { name: "Jensen Huang", avatar: "", currentGain: 15780 },
      { name: "Elon Musk", avatar: "", currentGain: 11200 },
      { name: "Sam Altman", avatar: "", currentGain: 9850 },
    ],
    totalPool: 19800,
    endTime: "Sun 23:59 UTC",
  },
  {
    id: "gainer-3",
    category: "Entertainment",
    leaders: [
      { name: "MrBeast", avatar: "", currentGain: 18900 },
      { name: "Logan Paul", avatar: "", currentGain: 12100 },
      { name: "KSI", avatar: "", currentGain: 8750 },
    ],
    totalPool: 11500,
    endTime: "Sun 23:59 UTC",
  },
];

// Jackpot data
const jackpotData = {
  personName: "Elon Musk",
  personAvatar: "",
  currentScore: 515809,
  totalPool: 50000,
  endTime: "Sun 23:59 UTC",
};

// Community markets
interface CommunityMarket {
  id: string;
  creatorName: string;
  question: string;
  personName: string;
  personAvatar: string;
  totalPool: number;
  endTime: string;
  participants: number;
}

const communityMarkets: CommunityMarket[] = [
  {
    id: "community-1",
    creatorName: "CryptoKing99",
    question: "Will Elon tweet about Dogecoin this week?",
    personName: "Elon Musk",
    personAvatar: "",
    totalPool: 3420,
    endTime: "Sun 23:59 UTC",
    participants: 47,
  },
  {
    id: "community-2",
    creatorName: "SwiftieForever",
    question: "Taylor Swift album announcement before month end?",
    personName: "Taylor Swift",
    personAvatar: "",
    totalPool: 2890,
    endTime: "Sun 23:59 UTC",
    participants: 89,
  },
  {
    id: "community-3",
    creatorName: "TechWatcher",
    question: "Jensen Huang keynote will break 1M views in 24h?",
    personName: "Jensen Huang",
    personAvatar: "",
    totalPool: 1560,
    endTime: "Sun 23:59 UTC",
    participants: 23,
  },
  {
    id: "community-4",
    creatorName: "SportsGuru",
    question: "Ronaldo will post about Al Nassr victory?",
    personName: "Cristiano Ronaldo",
    personAvatar: "",
    totalPool: 2100,
    endTime: "Sun 23:59 UTC",
    participants: 56,
  },
];

type MarketType = "JACKPOT_EXACT" | "BINARY_TREND" | "VERSUS" | "COMMUNITY";

const FIRST_VISIT_KEY = "famedex_predict_first_visit";

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

function ViewAllModal({ 
  open, 
  onClose, 
  title, 
  children 
}: { 
  open: boolean; 
  onClose: () => void; 
  title: string;
  children: React.ReactNode;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search markets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            data-testid="input-search-markets"
          />
        </div>
        
        <div className="flex-1 overflow-y-auto">
          <div className="grid gap-4 sm:grid-cols-2">
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PredictionModalProps {
  open: boolean;
  onClose: () => void;
  marketType: MarketType;
  personName?: string;
  currentScore?: number;
  isUserGenerated?: boolean;
}

function PredictionModal({ open, onClose, marketType, personName, currentScore, isUserGenerated }: PredictionModalProps) {
  const [stakeAmount, setStakeAmount] = useState("");
  const [exactPrediction, setExactPrediction] = useState("");

  const getTitle = () => {
    switch (marketType) {
      case "JACKPOT_EXACT":
        return "Enter Weekly Jackpot";
      case "BINARY_TREND":
        return "Place Your Prediction";
      case "VERSUS":
        return "Head-to-Head Prediction";
      case "COMMUNITY":
        return "Community Market";
      default:
        return "Place Prediction";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {marketType === "JACKPOT_EXACT" ? (
              <Crown className="h-5 w-5 text-amber-500" />
            ) : (
              <Target className="h-5 w-5 text-violet-500" />
            )}
            {getTitle()}
          </DialogTitle>
          {isUserGenerated && (
            <Badge variant="secondary" className="w-fit mt-2">
              <UserPlus className="h-3 w-3 mr-1" />
              User Created
            </Badge>
          )}
        </DialogHeader>

        <div className="space-y-4 py-4">
          {personName && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <PersonAvatar name={personName} avatar="" size="md" />
              <div>
                <p className="font-semibold">{personName}</p>
                {currentScore && (
                  <p className="text-xs text-muted-foreground font-mono">
                    Current: {currentScore.toLocaleString()} pts
                  </p>
                )}
              </div>
            </div>
          )}

          {marketType === "JACKPOT_EXACT" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Your Exact Score Prediction</label>
              <Input
                type="number"
                placeholder="Enter predicted score (e.g., 520000)"
                value={exactPrediction}
                onChange={(e) => setExactPrediction(e.target.value)}
                className="font-mono"
                data-testid="input-exact-prediction"
              />
              <p className="text-xs text-muted-foreground">
                Predict the exact score at week's end. Closest wins the jackpot!
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Stake Amount</label>
            <Input
              type="number"
              placeholder="Enter credits to stake"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="font-mono"
              data-testid="input-stake-amount"
            />
          </div>

          <div className="flex gap-2 pt-2">
            {[100, 500, 1000].map((amount) => (
              <Button
                key={amount}
                variant="outline"
                size="sm"
                onClick={() => setStakeAmount(amount.toString())}
                className="flex-1"
              >
                {amount}
              </Button>
            ))}
          </div>
        </div>

        <Button 
          onClick={onClose} 
          className={`w-full ${marketType === "JACKPOT_EXACT" 
            ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white" 
            : "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"}`}
          data-testid="button-confirm-prediction"
        >
          Confirm Prediction
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function WeeklyJackpotHero({ 
  onEnterJackpot, 
  isMarketClosed,
  timeRemaining 
}: { 
  onEnterJackpot: () => void; 
  isMarketClosed: boolean;
  timeRemaining: { days: number; hours: number; minutes: number; seconds: number };
}) {
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
            
            <h2 className="text-2xl md:text-3xl font-serif font-bold mb-2">
              Predict {jackpotData.personName}'s Exact Score
            </h2>
            
            <p className="text-muted-foreground mb-4 max-w-lg">
              Guess the exact FameDex score at week's end. Closest prediction takes the entire pot!
            </p>
            
            <div className="flex items-center gap-6 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Current Pot</p>
                <p className="text-3xl font-mono font-bold text-amber-500">
                  {jackpotData.totalPool.toLocaleString()}
                  <span className="text-sm ml-1 text-muted-foreground">credits</span>
                </p>
              </div>
              
              <div className="h-12 w-px bg-border" />
              
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Ends In</p>
                <p className="text-lg font-mono font-bold">
                  {timeRemaining.days}d {timeRemaining.hours}h {timeRemaining.minutes}m
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col items-center gap-3">
            <PersonAvatar name={jackpotData.personName} avatar="" size="lg" />
            <p className="text-sm font-mono text-muted-foreground">
              Current: {jackpotData.currentScore.toLocaleString()} pts
            </p>
            
            {isMarketClosed ? (
              <Button 
                size="lg" 
                className="bg-muted text-muted-foreground cursor-not-allowed"
                disabled
              >
                <Lock className="h-5 w-5 mr-2" />
                Awaiting Results
              </Button>
            ) : (
              <Button 
                size="lg" 
                className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30"
                onClick={onEnterJackpot}
                data-testid="button-enter-jackpot"
              >
                <Sparkles className="h-5 w-5 mr-2" />
                Enter Jackpot
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CommunityCard({ market, onClick, isMarketClosed = false }: { market: CommunityMarket; onClick: () => void; isMarketClosed?: boolean }) {
  return (
    <div 
      className={`relative overflow-visible group cursor-pointer ${isMarketClosed ? 'opacity-75' : ''}`}
      onClick={!isMarketClosed ? onClick : undefined}
    >
      <Card 
        className="p-4 rounded-xl border border-border/30 bg-card/50 group-hover:border-violet-500/30 group-hover:translate-y-[-2px] group-hover:shadow-md transition-all duration-200 ease-out"
        data-testid={`card-community-${market.id}`}
      >
        <div className="flex items-start justify-between mb-3">
          <Badge variant="secondary" className="text-[10px]">
            <UserPlus className="h-3 w-3 mr-1" />
            User Created
          </Badge>
          <span className="text-[10px] text-muted-foreground">{market.creatorName}</span>
        </div>
        
        <div className="flex items-center gap-3 mb-3">
          <PersonAvatar name={market.personName} avatar={market.personAvatar} size="sm" />
          <p className="text-sm font-medium line-clamp-2">{market.question}</p>
        </div>
        
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">{market.totalPool.toLocaleString()} credits</span>
          <span>{market.participants} participants</span>
        </div>
      </Card>
    </div>
  );
}

function PredictCard({ children, className = "", testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div className="relative overflow-visible group">
      <div 
        className="absolute -top-[3px] left-0 right-0 h-1 rounded-t-xl bg-transparent group-hover:bg-[#8B5CF6] transition-all duration-200 ease-out z-20"
        style={{ boxShadow: "0 0 0 transparent" }}
      />
      <Card 
        className={`p-4 rounded-xl border border-border/50 group-hover:border-violet-500/40 group-hover:translate-y-[-2px] group-hover:shadow-lg group-hover:shadow-violet-500/20 transition-all duration-200 ease-out relative overflow-visible ${className}`}
        data-testid={testId}
      >
        {children}
      </Card>
    </div>
  );
}

function WeeklyUpDownCard({ market, isMarketClosed = false }: { market: PredictionMarket; isMarketClosed?: boolean }) {
  return (
    <PredictCard testId={`card-market-${market.id}`} className={`min-w-[280px] ${isMarketClosed ? 'opacity-75' : ''}`}>
      <div className="flex items-center gap-3 mb-3">
        <PersonAvatar name={market.personName} avatar={market.personAvatar} size="md" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{market.personName}</h3>
          <p className="text-xs text-muted-foreground font-mono">
            {market.currentScore.toLocaleString()} pts
          </p>
        </div>
        <Badge 
          variant="outline" 
          className={market.change7d >= 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}
        >
          {market.change7d >= 0 ? "+" : ""}{market.change7d.toFixed(1)}%
        </Badge>
      </div>
      
      <div className="h-8 w-full bg-muted/30 rounded-lg mb-3 overflow-hidden flex">
        <div 
          className="h-full bg-gradient-to-r from-green-500/20 to-green-500/40 flex items-center justify-center"
          style={{ width: `${market.upPoolPercent}%` }}
        >
          <span className="text-[10px] font-mono text-green-500">{market.upPoolPercent}%</span>
        </div>
        <div 
          className="h-full bg-gradient-to-r from-red-500/40 to-red-500/20 flex items-center justify-center"
          style={{ width: `${100 - market.upPoolPercent}%` }}
        >
          <span className="text-[10px] font-mono text-red-500">{100 - market.upPoolPercent}%</span>
        </div>
      </div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#8B5CF6] font-semibold">
          Pool: {market.totalPool.toLocaleString()} credits
        </span>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {market.endTime}
        </span>
      </div>
      
      {isMarketClosed ? (
        <Button 
          size="sm" 
          className="w-full bg-muted text-muted-foreground cursor-not-allowed"
          disabled
          data-testid={`button-awaiting-${market.id}`}
        >
          <Lock className="h-4 w-4 mr-2" />
          Awaiting Results
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button 
            size="sm" 
            className="flex-1 bg-green-600 text-white"
            data-testid={`button-up-${market.id}`}
          >
            <TrendingUp className="h-4 w-4 mr-1" />
            Up {market.upMultiplier}x
          </Button>
          <Button 
            size="sm" 
            className="flex-1 bg-red-600 text-white"
            data-testid={`button-down-${market.id}`}
          >
            <TrendingDown className="h-4 w-4 mr-1" />
            Down {market.downMultiplier}x
          </Button>
        </div>
      )}
    </PredictCard>
  );
}

function HeadToHeadCard({ market, isMarketClosed = false }: { market: HeadToHeadMarket; isMarketClosed?: boolean }) {
  return (
    <PredictCard testId={`card-h2h-${market.id}`} className={`min-w-[300px] ${isMarketClosed ? 'opacity-75' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <Badge variant="secondary" className="text-xs">{market.category}</Badge>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {market.endTime}
        </span>
      </div>
      
      <div className="flex items-center justify-center gap-4 mb-4">
        <div className="text-center">
          <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} size="md" />
          <p className="text-sm font-medium mt-1 truncate max-w-[80px]">{market.person1.name}</p>
          <p className="text-xs text-green-500 font-mono">{market.person1Percent}%</p>
        </div>
        
        <div className="h-12 w-12 rounded-full bg-[#8B5CF6]/20 flex items-center justify-center border border-[#8B5CF6]/40">
          <span className="text-sm font-bold text-[#8B5CF6]">VS</span>
        </div>
        
        <div className="text-center">
          <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} size="md" />
          <p className="text-sm font-medium mt-1 truncate max-w-[80px]">{market.person2.name}</p>
          <p className="text-xs text-red-500 font-mono">{100 - market.person1Percent}%</p>
        </div>
      </div>
      
      <div className="h-2 w-full bg-muted/30 rounded-full mb-3 overflow-hidden flex">
        <div 
          className="h-full bg-green-500"
          style={{ width: `${market.person1Percent}%` }}
        />
        <div 
          className="h-full bg-red-500"
          style={{ width: `${100 - market.person1Percent}%` }}
        />
      </div>
      
      <div className="text-center mb-3">
        <span className="text-sm font-semibold text-[#8B5CF6]">
          Pool: {market.totalPool.toLocaleString()} credits
        </span>
      </div>
      
      {isMarketClosed ? (
        <Button 
          size="sm" 
          className="w-full bg-muted text-muted-foreground cursor-not-allowed"
          disabled
          data-testid={`button-awaiting-h2h-${market.id}`}
        >
          <Lock className="h-4 w-4 mr-2" />
          Awaiting Results
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 border-green-500/30 text-green-500">
            {market.person1.name.split(" ")[0]}
          </Button>
          <Button size="sm" variant="outline" className="flex-1 border-red-500/30 text-red-500">
            {market.person2.name.split(" ")[0]}
          </Button>
        </div>
      )}
    </PredictCard>
  );
}

function CategoryRaceCard({ market, isMarketClosed = false }: { market: CategoryRaceMarket; isMarketClosed?: boolean }) {
  return (
    <PredictCard testId={`card-race-${market.id}`} className={`min-w-[280px] ${isMarketClosed ? 'opacity-75' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <Badge variant="secondary" className="text-xs">{market.category}</Badge>
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {market.timeRemaining}
        </Badge>
      </div>
      
      <h3 className="font-semibold mb-3">{market.title}</h3>
      
      <div className="flex items-center gap-2 mb-3">
        {market.topContenders.map((contender, i) => (
          <div key={contender.name} className="flex items-center">
            <div className="relative">
              <PersonAvatar name={contender.name} avatar={contender.avatar} size="sm" />
              <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-[#8B5CF6] text-white text-[10px] flex items-center justify-center font-bold">
                {i + 1}
              </div>
            </div>
          </div>
        ))}
        <span className="text-xs text-muted-foreground">+more</span>
      </div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-[#8B5CF6]">
          Pool: {market.totalPool.toLocaleString()}
        </span>
      </div>
      
      {isMarketClosed ? (
        <Button 
          size="sm" 
          className="w-full bg-muted text-muted-foreground cursor-not-allowed"
          disabled
          data-testid={`button-awaiting-race-${market.id}`}
        >
          <Lock className="h-4 w-4 mr-2" />
          Awaiting Results
        </Button>
      ) : (
        <Button 
          size="sm" 
          className="w-full bg-gradient-to-r from-[#4C1D95] to-[#8B5CF6] text-white shadow-lg shadow-[#8B5CF6]/30"
          data-testid={`button-enter-race-${market.id}`}
        >
          Enter Race
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </PredictCard>
  );
}

function TopGainerCard({ market, isMarketClosed = false }: { market: TopGainerMarket; isMarketClosed?: boolean }) {
  return (
    <PredictCard testId={`card-gainer-${market.id}`} className={`min-w-[280px] ${isMarketClosed ? 'opacity-75' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <Badge variant="secondary" className="text-xs">{market.category}</Badge>
        <span className="text-xs text-muted-foreground">7-day gain</span>
      </div>
      
      <h3 className="font-semibold mb-3">Top Gainer: {market.category}</h3>
      
      <div className="space-y-2 mb-3">
        {market.leaders.map((leader, i) => (
          <div key={leader.name} className="flex items-center gap-2">
            <span className="text-xs font-bold text-[#8B5CF6] w-4">#{i + 1}</span>
            <PersonAvatar name={leader.name} avatar={leader.avatar} size="xs" />
            <span className="text-sm flex-1 truncate">{leader.name}</span>
            <span className="text-xs font-mono text-green-500">+{leader.currentGain.toLocaleString()}</span>
          </div>
        ))}
      </div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-[#8B5CF6]">
          Pool: {market.totalPool.toLocaleString()}
        </span>
      </div>
      
      {isMarketClosed ? (
        <Button 
          size="sm" 
          className="w-full bg-muted text-muted-foreground cursor-not-allowed"
          disabled
          data-testid={`button-awaiting-gainer-${market.id}`}
        >
          <Lock className="h-4 w-4 mr-2" />
          Awaiting Results
        </Button>
      ) : (
        <Button 
          size="sm" 
          className="w-full bg-gradient-to-r from-[#4C1D95] to-[#8B5CF6] text-white shadow-lg shadow-[#8B5CF6]/30"
          data-testid={`button-place-prediction-${market.id}`}
        >
          Place Prediction
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </PredictCard>
  );
}

function CarouselSection({ 
  title, 
  subtitle, 
  onViewAll, 
  children 
}: { 
  title: string; 
  subtitle: string; 
  onViewAll: () => void;
  children: React.ReactNode;
}) {
  const sliderSettings = {
    dots: false,
    infinite: false,
    speed: 300,
    slidesToShow: 3,
    slidesToScroll: 1,
    arrows: true,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 2,
        }
      },
      {
        breakpoint: 640,
        settings: {
          slidesToShow: 1,
        }
      }
    ]
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-serif font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onViewAll}
          className="text-violet-500"
        >
          View All
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      
      <div className="predict-carousel -mx-2">
        <Slider {...sliderSettings}>
          {children}
        </Slider>
      </div>
    </section>
  );
}

export default function PredictPage() {
  const [, setLocation] = useLocation();
  const [showFirstTimeModal, setShowFirstTimeModal] = useState(false);
  const [viewAllCategory, setViewAllCategory] = useState<string | null>(null);
  const [balance] = useState(10000);
  const [activePredictions] = useState(0);
  const marketCycle = useMarketCycle();
  const isMarketClosed = marketCycle.status === "CLOSED";
  
  const [predictionModal, setPredictionModal] = useState<{
    open: boolean;
    type: MarketType;
    personName?: string;
    currentScore?: number;
    isUserGenerated?: boolean;
  }>({ open: false, type: "BINARY_TREND" });

  useEffect(() => {
    const hasVisited = localStorage.getItem(FIRST_VISIT_KEY);
    if (!hasVisited) {
      setShowFirstTimeModal(true);
    }
  }, []);

  const handleCloseFirstTimeModal = () => {
    localStorage.setItem(FIRST_VISIT_KEY, "true");
    setShowFirstTimeModal(false);
  };

  const handleOpenHowItWorks = () => {
    setShowFirstTimeModal(true);
  };

  const handleEnterJackpot = () => {
    setPredictionModal({
      open: true,
      type: "JACKPOT_EXACT",
      personName: jackpotData.personName,
      currentScore: jackpotData.currentScore,
    });
  };

  const handleCommunityClick = (market: CommunityMarket) => {
    setPredictionModal({
      open: true,
      type: "COMMUNITY",
      personName: market.personName,
      isUserGenerated: true,
    });
  };

  const handleClosePredictionModal = () => {
    setPredictionModal({ ...predictionModal, open: false });
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setLocation("/")}
              className="md:hidden"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#4C1D95] to-[#8B5CF6] flex items-center justify-center shadow-lg shadow-[#8B5CF6]/30">
                <span className="text-white font-bold font-serif text-lg">F</span>
              </div>
              <span className="font-serif font-bold text-xl">FameDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm">Home</Button>
              </Link>
              <Link href="/vote">
                <Button variant="ghost" size="sm">Vote</Button>
              </Link>
              <Link href="/predict">
                <Button variant="ghost" size="sm" className="text-[#8B5CF6]">Predict</Button>
              </Link>
              <Link href="/me">
                <Button variant="ghost" size="sm">Me</Button>
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-6 bg-gradient-to-r from-[#4C1D95]/30 via-[#8B5CF6]/20 to-transparent rounded-xl p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Zap className="h-8 w-8 text-[#8B5CF6]" style={{ filter: 'drop-shadow(0 0 8px rgba(139, 92, 246, 0.5))' }} />
              <h1 className="text-3xl font-serif font-bold" data-testid="text-predict-title">
                Prediction Markets
              </h1>
            </div>
            <button 
              onClick={handleOpenHowItWorks}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-[#8B5CF6] transition-colors"
              data-testid="button-how-it-works"
            >
              <HelpCircle className="h-4 w-4" />
              How it works
            </button>
          </div>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Back your insight on who's really moving. Pool your predictions with others - the bigger the pot, the bigger the returns.
          </p>
        </div>

        <MarketCycleHero marketState={marketCycle} />

        {/* Weekly Jackpot Hero */}
        <WeeklyJackpotHero 
          onEnterJackpot={handleEnterJackpot}
          isMarketClosed={isMarketClosed}
          timeRemaining={marketCycle.timeRemaining}
        />

        <Card className="p-4 mb-8 bg-muted/30 border-muted">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30 px-3 py-1">
                TEST MODE
              </Badge>
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[#8B5CF6]" />
                <span className="font-mono font-bold">{balance.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">credits</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono font-bold">{activePredictions}</span>
              <span className="text-xs text-muted-foreground">active predictions</span>
            </div>
          </div>
        </Card>

        <CarouselSection
          title="Weekly Up / Down"
          subtitle="Will their trend score be higher or lower this week?"
          onViewAll={() => setViewAllCategory("weekly")}
        >
          {mockMarkets.map((market) => (
            <div key={market.id} className="px-2 pt-[10px] pb-[10px]">
              <WeeklyUpDownCard market={market} isMarketClosed={isMarketClosed} />
            </div>
          ))}
        </CarouselSection>

        <CarouselSection
          title="Head-to-Head Battles"
          subtitle="Curated matchups - who will gain more?"
          onViewAll={() => setViewAllCategory("h2h")}
        >
          {headToHeadMarkets.map((market) => (
            <div key={market.id} className="px-2 pt-[10px] pb-[10px]">
              <HeadToHeadCard market={market} isMarketClosed={isMarketClosed} />
            </div>
          ))}
        </CarouselSection>

        <CarouselSection
          title="Category Races"
          subtitle="Competition within sectors - pick the winner"
          onViewAll={() => setViewAllCategory("races")}
        >
          {categoryRaceMarkets.map((market) => (
            <div key={market.id} className="px-2 pt-[10px] pb-[10px]">
              <CategoryRaceCard market={market} isMarketClosed={isMarketClosed} />
            </div>
          ))}
        </CarouselSection>

        <CarouselSection
          title="Top Gainer Predictions"
          subtitle="Who will gain the most raw points in 7 days?"
          onViewAll={() => setViewAllCategory("gainers")}
        >
          {topGainerMarkets.map((market) => (
            <div key={market.id} className="px-2 pt-[10px] pb-[10px]">
              <TopGainerCard market={market} isMarketClosed={isMarketClosed} />
            </div>
          ))}
        </CarouselSection>

        {/* Community Predictions Section */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-serif font-bold">Community Predictions</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">User-suggested markets from the community</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {communityMarkets.map((market) => (
              <CommunityCard 
                key={market.id} 
                market={market} 
                onClick={() => handleCommunityClick(market)}
                isMarketClosed={isMarketClosed}
              />
            ))}
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            More markets added daily. Pool sizes update in real-time.
          </p>
        </div>
      </div>
      <FirstTimeModal 
        open={showFirstTimeModal} 
        onClose={handleCloseFirstTimeModal} 
      />
      <ViewAllModal
        open={viewAllCategory === "weekly"}
        onClose={() => setViewAllCategory(null)}
        title="All Weekly Up/Down Markets"
      >
        {mockMarkets.map((market) => (
          <WeeklyUpDownCard key={market.id} market={market} isMarketClosed={isMarketClosed} />
        ))}
      </ViewAllModal>
      <ViewAllModal
        open={viewAllCategory === "h2h"}
        onClose={() => setViewAllCategory(null)}
        title="All Head-to-Head Battles"
      >
        {headToHeadMarkets.map((market) => (
          <HeadToHeadCard key={market.id} market={market} isMarketClosed={isMarketClosed} />
        ))}
      </ViewAllModal>
      <ViewAllModal
        open={viewAllCategory === "races"}
        onClose={() => setViewAllCategory(null)}
        title="All Category Races"
      >
        {categoryRaceMarkets.map((market) => (
          <CategoryRaceCard key={market.id} market={market} isMarketClosed={isMarketClosed} />
        ))}
      </ViewAllModal>
      <ViewAllModal
        open={viewAllCategory === "gainers"}
        onClose={() => setViewAllCategory(null)}
        title="All Top Gainer Predictions"
      >
        {topGainerMarkets.map((market) => (
          <TopGainerCard key={market.id} market={market} isMarketClosed={isMarketClosed} />
        ))}
      </ViewAllModal>
      <PredictionModal
        open={predictionModal.open}
        onClose={handleClosePredictionModal}
        marketType={predictionModal.type}
        personName={predictionModal.personName}
        currentScore={predictionModal.currentScore}
        isUserGenerated={predictionModal.isUserGenerated}
      />
      <style>{`
        .predict-carousel .slick-track {
          display: flex;
          gap: 0;
        }
        .predict-carousel .slick-slide {
          height: auto;
        }
        .predict-carousel .slick-slide > div {
          height: 100%;
        }
        .predict-carousel .slick-prev,
        .predict-carousel .slick-next {
          z-index: 10;
          width: 32px;
          height: 32px;
        }
        .predict-carousel .slick-prev {
          left: -8px;
        }
        .predict-carousel .slick-next {
          right: -8px;
        }
        .predict-carousel .slick-prev:before,
        .predict-carousel .slick-next:before {
          color: rgb(139 92 246);
          font-size: 24px;
        }
        .predict-carousel .slick-disabled:before {
          opacity: 0.25;
        }
      `}</style>
    </div>
  );
}
