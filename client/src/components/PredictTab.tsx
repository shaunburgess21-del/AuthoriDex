import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Crown, 
  Sparkles, 
  Lock, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  ChevronRight, 
  Users, 
  UserPlus, 
  BarChart3,
  Swords,
  X,
  Search,
  HelpCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PredictTabProps {
  personId: string;
  personName: string;
  personAvatar?: string;
  currentScore: number;
}

type CategoryFilter = "all" | "tech" | "politics" | "business" | "music" | "sports" | "creator";

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

interface TopGainerMarket {
  id: string;
  category: CategoryFilter;
  leaders: { name: string; avatar: string; currentGain: number; percentGain: number }[];
  totalPool: number;
  endTime: string;
}

interface CommunityMarket {
  id: string;
  creatorName: string;
  question: string;
  personName: string;
  personAvatar: string;
  totalPool: number;
  endTime: string;
  participants: number;
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
    category: "tech",
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
    category: "music",
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
    category: "tech",
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
    category: "sports",
  },
  {
    id: "community-5",
    creatorName: "PoliticsNerd",
    question: "Trump rally attendance over 50k?",
    personName: "Donald Trump",
    personAvatar: "",
    totalPool: 4200,
    endTime: "Sun 23:59 UTC",
    participants: 112,
    category: "politics",
  },
  {
    id: "community-6",
    creatorName: "ElonFanatic",
    question: "Will Tesla stock rise 5%+ this week?",
    personName: "Elon Musk",
    personAvatar: "",
    totalPool: 5600,
    endTime: "Sun 23:59 UTC",
    participants: 78,
    category: "tech",
  },
  {
    id: "community-7",
    creatorName: "SpaceEnthusiast",
    question: "SpaceX Starship test before Friday?",
    personName: "Elon Musk",
    personAvatar: "",
    totalPool: 4100,
    endTime: "Sun 23:59 UTC",
    participants: 92,
    category: "tech",
  },
  {
    id: "community-8",
    creatorName: "XPlatformFan",
    question: "Will X (Twitter) add new AI features?",
    personName: "Elon Musk",
    personAvatar: "",
    totalPool: 2850,
    endTime: "Sun 23:59 UTC",
    participants: 64,
    category: "tech",
  },
];

const BASE_JACKPOT_POOL = 50000;

function PredictCard({ 
  children, 
  className = "", 
  testId,
  onClick,
  selected = false
}: { 
  children: React.ReactNode; 
  className?: string; 
  testId?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <div 
      className={`relative group ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      data-testid={testId}
    >
      <div 
        className={`absolute -inset-[1px] rounded-xl bg-gradient-to-br from-violet-500/80 via-purple-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity ${selected ? 'opacity-100 from-violet-500 via-violet-400/50' : ''}`}
      />
      <Card className={`relative p-4 bg-card/95 backdrop-blur-sm transition-all group-hover:shadow-lg group-hover:shadow-violet-500/20 ${selected ? 'shadow-lg shadow-violet-500/30' : ''} ${className}`}>
        {children}
      </Card>
    </div>
  );
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
    <PredictCard testId={`card-weekly-${market.id}`} className={isMarketClosed ? 'opacity-75' : ''}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <PersonAvatar name={market.personName} avatar={market.personAvatar} className="h-[73px] w-[73px]" />
          <div>
            <p className="font-semibold text-sm">{market.personName}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {market.currentScore.toLocaleString('en-US')} pts
            </p>
          </div>
        </div>
        <Badge 
          variant="outline" 
          className={market.change7d >= 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}
        >
          {market.change7d >= 0 ? "+" : ""}{market.change7d.toFixed(1)}%
        </Badge>
      </div>
      
      <p className="text-xs text-muted-foreground mb-3">
        Will <span className="font-semibold text-foreground">{market.personName.split(" ")[0]}</span>'s Trend Score be higher than start-of-week by close?
      </p>
      
      <div className="h-2 rounded-full bg-muted mb-3 overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-green-500 to-green-400"
          style={{ width: `${market.upPoolPercent}%` }}
        />
      </div>
      
      <div className="flex items-center justify-between text-xs mb-3">
        <span className="text-green-500">Up {market.upMultiplier}x</span>
        <span className="text-muted-foreground">Pool: {market.totalPool.toLocaleString('en-US')}</span>
        <span className="text-red-500">Down {market.downMultiplier}x</span>
      </div>
      
      {isMarketClosed ? (
        <Button 
          size="sm" 
          className="w-full bg-muted text-muted-foreground cursor-not-allowed"
          disabled
        >
          <Lock className="h-4 w-4 mr-2" />
          Market Closed
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button 
            size="sm" 
            variant="outline" 
            className="border-green-500/30 text-green-500 hover:bg-green-500/10"
            onClick={() => onSelect?.("up")}
            data-testid={`button-up-${market.id}`}
          >
            <TrendingUp className="h-4 w-4 mr-1" />
            Up
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            className="border-red-500/30 text-red-500 hover:bg-red-500/10"
            onClick={() => onSelect?.("down")}
            data-testid={`button-down-${market.id}`}
          >
            <TrendingDown className="h-4 w-4 mr-1" />
            Down
          </Button>
        </div>
      )}
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
    <PredictCard testId={`card-h2h-${market.id}`} className={`relative overflow-hidden ${isMarketClosed ? 'opacity-75' : ''}`}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-0 top-0 w-1/2 h-full bg-gradient-to-r from-blue-600/20 to-transparent" />
        <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-purple-600/20 to-transparent" />
      </div>
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <CategoryPill category={market.category} />
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {market.endTime}
          </Badge>
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
        
        <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
          <div 
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400"
            style={{ width: `${market.person1Percent}%` }}
          />
        </div>
        
        <div className="flex items-center justify-center mb-3">
          <span className="text-sm font-semibold text-violet-500">
            Pool: {market.totalPool.toLocaleString('en-US')}
          </span>
        </div>
        
        {isMarketClosed ? (
          <Button 
            size="sm" 
            className="w-full bg-muted text-muted-foreground cursor-not-allowed"
            disabled
          >
            <Lock className="h-4 w-4 mr-2" />
            Awaiting Results
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button 
              size="sm" 
              variant="outline" 
              className="border-blue-500/30 text-blue-500 hover:bg-blue-500/10"
              onClick={() => onSelect?.(1)}
              data-testid={`button-pick1-${market.id}`}
            >
              {market.person1.name.split(" ")[0]}
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              className="border-purple-500/30 text-purple-500 hover:bg-purple-500/10"
              onClick={() => onSelect?.(2)}
              data-testid={`button-pick2-${market.id}`}
            >
              {market.person2.name.split(" ")[0]}
            </Button>
          </div>
        )}
      </div>
    </PredictCard>
  );
}

function TopGainerCard({ 
  market, 
  isMarketClosed = false,
  personName,
  onSelect
}: { 
  market: TopGainerMarket; 
  isMarketClosed?: boolean;
  personName: string;
  onSelect?: (name: string) => void;
}) {
  const personLeader = market.leaders.find(l => l.name === personName);
  const personRank = market.leaders.findIndex(l => l.name === personName) + 1;

  return (
    <PredictCard testId={`card-gainer-${market.id}`} className={`${isMarketClosed ? 'opacity-75' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <CategoryPill category={market.category} />
        <span className="text-xs text-muted-foreground">7-day gain</span>
      </div>
      
      <h3 className="font-semibold mb-3">Top Gainer: {market.category.charAt(0).toUpperCase() + market.category.slice(1)}</h3>
      
      {personLeader && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20 mb-3">
          <div className="h-6 w-6 rounded-full bg-green-500 text-white text-xs flex items-center justify-center font-bold">
            #{personRank}
          </div>
          <PersonAvatar name={personName} avatar="" size="sm" />
          <span className="text-sm flex-1 truncate font-medium">{personName}</span>
          <div className="text-right">
            <p className="text-xs font-mono font-bold text-green-500">+{personLeader.currentGain.toLocaleString('en-US')}</p>
            <p className="text-[10px] font-mono text-muted-foreground">+{personLeader.percentGain}%</p>
          </div>
        </div>
      )}
      
      <div className="space-y-2 mb-3">
        {market.leaders.map((leader, i) => (
          <div 
            key={leader.name} 
            className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${i === 0 ? 'border border-amber-500/30' : 'hover:bg-muted/50'} ${leader.name === personName ? 'opacity-50' : ''}`}
            onClick={() => onSelect?.(leader.name)}
          >
            <div className="relative">
              {i === 0 ? (
                <div className="h-5 w-5 rounded-full bg-background/80 backdrop-blur-sm border border-amber-500/50 flex items-center justify-center">
                  <Crown className="h-3 w-3 text-amber-500" />
                </div>
              ) : (
                <span className="text-xs font-bold text-violet-500 w-5 text-center">#{i + 1}</span>
              )}
            </div>
            <PersonAvatar name={leader.name} avatar={leader.avatar} size="xs" />
            <span className="text-sm flex-1 truncate">{leader.name}</span>
            <div className="text-right">
              <p className="text-xs font-mono font-bold text-green-500">+{leader.currentGain.toLocaleString('en-US')} pts</p>
              <p className="text-[10px] font-mono text-muted-foreground">+{leader.percentGain}%</p>
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-violet-500">
          Pool: {market.totalPool.toLocaleString('en-US')}
        </span>
      </div>
      
      {isMarketClosed ? (
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
          onClick={() => market.leaders.length > 0 && onSelect?.(market.leaders[0].name)}
        >
          Place Prediction
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </PredictCard>
  );
}

function CommunityCard({ 
  market, 
  onClick, 
  isMarketClosed = false 
}: { 
  market: CommunityMarket; 
  onClick: () => void; 
  isMarketClosed?: boolean;
}) {
  return (
    <PredictCard testId={`card-community-${market.id}`} className={isMarketClosed ? 'opacity-75' : ''}>
      <div className="flex items-center gap-2 mb-2">
        <Badge variant="secondary" className="text-xs">
          <UserPlus className="h-3 w-3 mr-1" />
          {market.creatorName}
        </Badge>
        <CategoryPill category={market.category} />
      </div>
      
      <p className="text-sm font-medium mb-3 line-clamp-2">{market.question}</p>
      
      <div className="flex items-center gap-2 mb-3">
        <PersonAvatar name={market.personName} avatar={market.personAvatar} size="xs" />
        <span className="text-xs text-muted-foreground">{market.personName}</span>
      </div>
      
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
        <span className="text-violet-500 font-semibold">Pool: {market.totalPool.toLocaleString('en-US')}</span>
        <span>{market.participants} participants</span>
      </div>
      
      {isMarketClosed ? (
        <Button 
          size="sm" 
          className="w-full bg-muted text-muted-foreground cursor-not-allowed"
          disabled
        >
          <Lock className="h-4 w-4 mr-2" />
          Closed
        </Button>
      ) : (
        <Button 
          size="sm" 
          variant="outline"
          className="w-full border-violet-500/30 text-violet-500"
          onClick={onClick}
          data-testid={`button-join-${market.id}`}
        >
          Join Market
        </Button>
      )}
    </PredictCard>
  );
}

function ViewAllCommunityOverlay({
  open,
  onClose,
  personName,
  markets,
  isMarketClosed
}: {
  open: boolean;
  onClose: () => void;
  personName: string;
  markets: CommunityMarket[];
  isMarketClosed: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredMarkets = markets.filter(m => 
    !searchQuery || m.question.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden" data-testid="overlay-community-predictions">
      <div className="h-full flex flex-col">
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-serif font-bold">Real-World Predictions</h2>
              <p className="text-sm text-muted-foreground">{filteredMarkets.length} predictions about {personName}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="relative z-20" data-testid="button-close-community-overlay">
              <X className="h-5 w-5" />
            </Button>
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search predictions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-community"
            />
          </div>
        </div>
        
        <ScrollArea className="flex-1 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
            {filteredMarkets.map((market) => (
              <CommunityCard
                key={market.id}
                market={market}
                onClick={() => {}}
                isMarketClosed={isMarketClosed}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function SectionHeader({ 
  icon, 
  title, 
  subtitle, 
  count,
  onViewAll,
  showViewAll = false,
  infoTooltip
}: { 
  icon: React.ReactNode;
  title: string; 
  subtitle: string;
  count?: number;
  onViewAll?: () => void;
  showViewAll?: boolean;
  infoTooltip?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-4 py-2.5 px-3 rounded-lg bg-gradient-to-r from-violet-500/5 via-transparent to-transparent border border-violet-500/10 backdrop-blur-sm">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-serif font-bold truncate">{title}</h3>
            {count !== undefined && (
              <Badge variant="secondary" className="text-xs">{count}</Badge>
            )}
            {infoTooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">{infoTooltip}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
      </div>
      {showViewAll && onViewAll && (
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onViewAll}
          className="text-violet-500 shrink-0"
          data-testid="button-view-all-community"
        >
          View all
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </div>
  );
}

export function PredictTab({ personId, personName, personAvatar, currentScore }: PredictTabProps) {
  const marketCycle = useMarketCycle();
  const isMarketClosed = marketCycle.status === "CLOSED";
  const [showPredictionModal, setShowPredictionModal] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("");
  const [exactPrediction, setExactPrediction] = useState("");
  const [showCommunityOverlay, setShowCommunityOverlay] = useState(false);

  const weeklyMarket = mockMarkets.find(m => m.personName === personName);
  
  const h2hBattles = headToHeadMarkets.filter(
    h => h.person1.name === personName || h.person2.name === personName
  );
  
  const gainerMarkets = topGainerMarkets.filter(
    g => g.leaders.some(leader => leader.name === personName)
  );
  
  const communityPredictions = communityMarkets.filter(
    c => c.personName === personName
  );

  const hasAnyMarkets = weeklyMarket || h2hBattles.length > 0 || gainerMarkets.length > 0 || communityPredictions.length > 0;

  return (
    <div className="space-y-6">
      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
            TEST MODE
          </Badge>
          <span className="text-sm text-muted-foreground">
            Predictions use virtual credits only. No real money involved.
          </span>
        </div>
      </Card>

      <div 
        className="relative overflow-hidden rounded-xl border-2 border-amber-500/50"
        style={{
          background: "linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(251, 146, 60, 0.05) 50%, transparent 100%)",
          boxShadow: "inset 0 0 20px rgba(245, 158, 11, 0.1), 0 0 30px rgba(245, 158, 11, 0.1)",
        }}
        data-testid="profile-jackpot-widget"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-orange-500/10 rounded-full blur-2xl" />
        
        <div className="relative z-10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Crown className="h-5 w-5 text-amber-500" />
            <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/40 text-xs">
              WEEKLY JACKPOT
            </Badge>
          </div>
          
          <h3 className="text-lg font-serif font-bold mb-2">
            Predict {personName}'s Exact Score
          </h3>
          
          <p className="text-sm text-muted-foreground mb-4">
            Guess the exact AuthoriDex score at week's end. Closest prediction takes the entire pot!
          </p>
          
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-3">
              <PersonAvatar name={personName} avatar={personAvatar || ""} size="md" />
              <div>
                <p className="font-semibold">{personName}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  Current: {currentScore.toLocaleString('en-US')} pts
                </p>
              </div>
            </div>
            
            <div className="h-10 w-px bg-border hidden sm:block" />
            
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Pot</p>
              <p className="text-xl font-mono font-bold text-amber-500">
                {BASE_JACKPOT_POOL.toLocaleString('en-US')}
                <span className="text-xs ml-1 text-muted-foreground">credits</span>
              </p>
            </div>
            
            <div className="h-10 w-px bg-border hidden sm:block" />
            
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Ends In</p>
              <p className="text-sm font-mono font-bold">
                {marketCycle.timeRemaining.days}d {marketCycle.timeRemaining.hours}h {marketCycle.timeRemaining.minutes}m
              </p>
            </div>
          </div>
          
          {isMarketClosed ? (
            <Button 
              className="bg-muted text-muted-foreground cursor-not-allowed"
              disabled
            >
              <Lock className="h-4 w-4 mr-2" />
              Awaiting Results
            </Button>
          ) : (
            <Button 
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30"
              onClick={() => setShowPredictionModal(true)}
              data-testid="button-profile-predict-score"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Predict Score
            </Button>
          )}
        </div>
      </div>

      <Dialog open={showPredictionModal} onOpenChange={setShowPredictionModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-500" />
              Enter Weekly Jackpot
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <PersonAvatar name={personName} avatar={personAvatar || ""} size="md" />
              <div>
                <p className="font-semibold">{personName}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  Current: {currentScore.toLocaleString('en-US')} pts
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Your Exact Score Prediction</label>
              <Input
                type="number"
                placeholder="Enter predicted score (e.g., 520000)"
                value={exactPrediction}
                onChange={(e) => setExactPrediction(e.target.value)}
                className="font-mono"
                data-testid="input-profile-exact-prediction"
              />
              <p className="text-xs text-muted-foreground">
                Predict the exact score at week's end. Closest wins the jackpot!
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Stake Amount</label>
              <Input
                type="number"
                placeholder="Enter credits to stake"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                className="font-mono"
                data-testid="input-profile-stake-amount"
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
            onClick={() => setShowPredictionModal(false)} 
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white"
            data-testid="button-profile-confirm-prediction"
          >
            Confirm Prediction
          </Button>
        </DialogContent>
      </Dialog>

      {weeklyMarket && (
        <section>
          <SectionHeader
            icon={<TrendingUp className="h-4 w-4 text-violet-400" />}
            title="Weekly Up/Down"
            subtitle="Predict if trend score goes up or down by week's end"
            infoTooltip="Will their trend score be higher than start-of-week by market close?"
          />
          <WeeklyUpDownCard market={weeklyMarket} isMarketClosed={isMarketClosed} />
        </section>
      )}

      {h2hBattles.length > 0 && (
        <section>
          <SectionHeader
            icon={<Swords className="h-4 w-4 text-violet-400" />}
            title="Head-to-Head Battles"
            subtitle={`${h2hBattles.length} battle${h2hBattles.length !== 1 ? 's' : ''} involving ${personName}`}
            count={h2hBattles.length}
            infoTooltip="Predict who will gain more trend points by week's end"
          />
          <div className={`grid gap-4 ${h2hBattles.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            {h2hBattles.map(battle => (
              <HeadToHeadCard key={battle.id} market={battle} isMarketClosed={isMarketClosed} />
            ))}
          </div>
        </section>
      )}

      {gainerMarkets.length > 0 && (
        <section>
          <SectionHeader
            icon={<BarChart3 className="h-4 w-4 text-violet-400" />}
            title="Top Gainer Predictions"
            subtitle="Raw points added leaderboard"
            count={gainerMarkets.length}
            infoTooltip="Tracks total points added, not percentage gain. Big names can add more raw points."
          />
          <div className={`grid gap-4 ${gainerMarkets.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            {gainerMarkets.map(gainer => (
              <TopGainerCard key={gainer.id} market={gainer} personName={personName} isMarketClosed={isMarketClosed} />
            ))}
          </div>
        </section>
      )}

      {communityPredictions.length > 0 && (
        <section>
          <SectionHeader
            icon={<Users className="h-4 w-4 text-violet-400" />}
            title="Real-World Predictions"
            subtitle="Markets for real-world event predictions"
            count={communityPredictions.length}
            showViewAll={communityPredictions.length > 3}
            onViewAll={() => setShowCommunityOverlay(true)}
            infoTooltip="Real-world prediction markets about this celebrity"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {communityPredictions.slice(0, 3).map(community => (
              <CommunityCard key={community.id} market={community} onClick={() => {}} isMarketClosed={isMarketClosed} />
            ))}
          </div>
        </section>
      )}

      {!hasAnyMarkets && (
        <Card className="p-8 text-center border-dashed">
          <div className="space-y-3">
            <p className="text-lg font-semibold">No active markets</p>
            <p className="text-muted-foreground">
              There are currently no prediction markets for {personName}.
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              Check back later or visit the main Prediction Markets page to explore all available markets.
            </p>
          </div>
        </Card>
      )}

      <ViewAllCommunityOverlay
        open={showCommunityOverlay}
        onClose={() => setShowCommunityOverlay(false)}
        personName={personName}
        markets={communityPredictions}
        isMarketClosed={isMarketClosed}
      />
    </div>
  );
}
