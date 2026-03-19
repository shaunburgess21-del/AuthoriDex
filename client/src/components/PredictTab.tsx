import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { MarketCycleHero } from "@/components/MarketCycleHero";
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
  HelpCircle,
  Loader2
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { normalizeMarketCategory } from "@shared/constants";

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
  baselineScore: number;
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
  person1Id?: string;
  person2Id?: string;
  category: CategoryFilter;
  endTime: string;
  totalPool: number;
  person1Percent: number;
}

interface TopGainerMarket {
  id: string;
  category: CategoryFilter;
  leaders: { name: string; avatar: string; currentGain: number; percentGain: number; personId?: string }[];
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
  relatedPersonIds?: string[];
}


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
  const delta = market.currentScore - market.baselineScore;
  const pctDelta = market.baselineScore > 0 ? ((delta / market.baselineScore) * 100).toFixed(1) : "0";

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
      
      <p className="text-xs text-muted-foreground mb-2 leading-[1.4]">
        Will <span className="font-semibold text-foreground">{market.personName.split(" ")[0]}</span> close above or below the weekly baseline?
      </p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mb-2 px-0.5">
        <span>Baseline: <span className="font-mono text-foreground">{market.baselineScore.toLocaleString('en-US')}</span></span>
        <span>Now: <span className="font-mono text-foreground">{market.currentScore.toLocaleString('en-US')}</span></span>
        <span>Delta: <span className={`font-mono ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>{delta >= 0 ? "+" : ""}{delta.toLocaleString('en-US')}</span></span>
        <span>Pool: <span className="font-mono text-violet-400">{market.totalPool.toLocaleString('en-US')}</span></span>
      </div>
      
      <div className="h-2 rounded-full bg-muted mb-3 overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-green-500 to-green-400"
          style={{ width: `${market.upPoolPercent}%` }}
        />
      </div>
      
      <div className="flex items-center justify-between text-xs mb-3">
        <span className="text-green-500">Up {market.upMultiplier}x</span>
        <span className="text-muted-foreground">({pctDelta}%)</span>
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
        </div>
        
        <div className="relative mb-4" style={{ padding: '0 5px' }}>
          <div className="flex" style={{ gap: '7px' }}>
            <div
              className={`flex-1 relative ${!isMarketClosed ? 'cursor-pointer group/p1' : ''}`}
              onClick={() => !isMarketClosed && onSelect?.(1)}
            >
              <div className="absolute -inset-4 rounded-md bg-blue-500/20 blur-lg pointer-events-none transition-opacity group-hover/p1:bg-blue-500/40" />
              <div className="rounded-lg overflow-hidden ring-2 ring-transparent transition-all group-hover/p1:ring-blue-500/60">
                <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} className="h-auto w-full aspect-square" />
              </div>
            </div>
            <div
              className={`flex-1 relative ${!isMarketClosed ? 'cursor-pointer group/p2' : ''}`}
              onClick={() => !isMarketClosed && onSelect?.(2)}
            >
              <div className="absolute -inset-4 rounded-md bg-purple-500/20 blur-lg pointer-events-none transition-opacity group-hover/p2:bg-purple-500/40" />
              <div className="rounded-lg overflow-hidden ring-2 ring-transparent transition-all group-hover/p2:ring-purple-500/60">
                <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} className="h-auto w-full aspect-square" />
              </div>
            </div>
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
              <span className="text-xs font-bold text-slate-200">VS</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center justify-between px-2 mb-2">
          <div
            className={`flex flex-col items-center flex-1 ${!isMarketClosed ? 'cursor-pointer hover:opacity-80' : ''} transition-opacity`}
            onClick={() => !isMarketClosed && onSelect?.(1)}
          >
            <p className="text-sm font-semibold text-center">{market.person1.name.split(" ")[0]}</p>
            <span className="text-xs text-blue-400">{market.person1Percent}%</span>
          </div>
          <div
            className={`flex flex-col items-center flex-1 ${!isMarketClosed ? 'cursor-pointer hover:opacity-80' : ''} transition-opacity`}
            onClick={() => !isMarketClosed && onSelect?.(2)}
          >
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
      
      <h3 className="font-semibold mb-3">Category Race: {market.category.charAt(0).toUpperCase() + market.category.slice(1)}</h3>
      
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
              <h2 className="text-lg font-serif font-bold">World Predictions</h2>
              <p className="text-sm text-muted-foreground">{filteredMarkets.length} predictions about {personName}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="relative z-20" aria-label="Close" data-testid="button-close-community-overlay">
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
        <div className="h-8 w-8 rounded-lg bg-violet-500/10 hidden sm:flex items-center justify-center shrink-0">
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
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Help">
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

  const { data: nativeUpdownData, isLoading: updownLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/updown'] });
  const { data: nativeH2hData, isLoading: h2hLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/h2h'] });
  const { data: nativeGainerData, isLoading: gainerLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/gainer'] });
  const { data: nativeJackpotData, isLoading: jackpotLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/jackpot'] });
  const { data: openMarketsData, isLoading: openMarketsLoading } = useQuery<any[]>({ queryKey: ['/api/open-markets'] });

  const isLoading = updownLoading || h2hLoading || gainerLoading || jackpotLoading || openMarketsLoading;

  const weeklyMarket = useMemo((): PredictionMarket | undefined => {
    const toTimestamp = (value: unknown, fallback: number) => {
      if (!value) return fallback;
      const ts = Date.parse(String(value));
      return Number.isFinite(ts) ? ts : fallback;
    };

    const candidateMarkets = (nativeUpdownData || [])
      .filter((m: any) => m.visibility === "live" && m.personId === personId)
      .slice()
      .sort((a: any, b: any) => {
        const aEnd = toTimestamp(a.endAt, Number.POSITIVE_INFINITY);
        const bEnd = toTimestamp(b.endAt, Number.POSITIVE_INFINITY);
        if (aEnd !== bEnd) return aEnd - bEnd;

        const aCreated = toTimestamp(a.createdAt, 0);
        const bCreated = toTimestamp(b.createdAt, 0);
        if (aCreated !== bCreated) return bCreated - aCreated;

        return String(a.id || "").localeCompare(String(b.id || ""));
      });

    const m = candidateMarkets[0];
    if (!m) return undefined;

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
    const cs = Number(person.trendScore || person.fameIndex || 0);
    const storedBaseline = m.metadata?.openingScore?.score;
    const fallbackBaseline = cs - Math.floor(cs * (Number(person.change7d || 0) / 100));
    const baselineScore = storedBaseline ? Number(storedBaseline) : fallbackBaseline;
    return {
      id: m.id,
      personId: m.personId || "",
      personName: person.name || m.title?.replace(/: Up or Down\?$/, "") || "Unknown",
      personAvatar: person.avatar || "",
      currentScore: cs,
      baselineScore,
      startScore: baselineScore,
      change7d: Number(person.change7d || 0),
      upMultiplier,
      downMultiplier,
      endTime: "Sun 23:59 UTC",
      totalPool: upStake + downStake + Number(m.seedVolume || 0),
      upPoolPercent: upPercent || 50,
      category: normalizeMarketCategory(m.category || person.category || "misc") as CategoryFilter,
    };
  }, [nativeUpdownData, personId]);

  const h2hBattles = useMemo((): HeadToHeadMarket[] => {
    const dbMarkets = (nativeH2hData || []).filter((m: any) => m.visibility === "live");
    const all: HeadToHeadMarket[] = dbMarkets.map((m: any) => {
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
        person1Id: e1.personId || "",
        person2Id: e2.personId || "",
        category: normalizeMarketCategory(m.category || "misc") as CategoryFilter,
        endTime: "Sun 23:59 UTC",
        totalPool,
        person1Percent: (s1 + s2) === 0 ? 50 : Math.round((s1 / total) * 100),
      };
    });
    return all.filter(h => h.person1Id === personId || h.person2Id === personId);
  }, [nativeH2hData, personId]);

  const gainerMarkets = useMemo((): TopGainerMarket[] => {
    const dbMarkets = (nativeGainerData || []).filter((m: any) => m.visibility === "live");
    const all: TopGainerMarket[] = dbMarkets.map((m: any) => {
      const entries = m.entries || [];
      const totalPool = entries.reduce((sum: number, entry: any) => sum + Number(entry.totalStake || 0), 0) + Number(m.seedVolume || 0);
      return {
        id: m.id,
        category: normalizeMarketCategory(m.category || "misc") as CategoryFilter,
        leaders: entries.slice(0, 3).map((e: any) => {
          const p = e.person || {};
          return {
            name: p.name || e.label || "?",
            avatar: p.avatar || "",
            currentGain: Number(p.change7d || 0) * Number(p.trendScore || 0) / 100,
            percentGain: Number(p.change7d || 0),
            personId: e.personId || "",
          };
        }),
        totalPool,
        endTime: "Sun 23:59 UTC",
      };
    });
    return all.filter(g => g.leaders.some(l => l.personId === personId));
  }, [nativeGainerData, personId]);

  const communityPredictions = useMemo((): CommunityMarket[] => {
    const markets = (openMarketsData || []).filter((m: any) => m.visibility === "live");
    return markets
      .filter((m: any) => m.personId === personId || (m.relatedPersonIds || []).includes(personId))
      .map((m: any) => {
        const entries = m.entries || [];
        const totalPool = entries.reduce((sum: number, entry: any) => sum + Number(entry.totalStake || 0), 0) + Number(m.seedVolume || 0);
        return {
          id: m.id,
          creatorName: m.linkedPersonName || "Community",
          question: m.title || "",
          personName: m.linkedPersonName || personName,
          personAvatar: m.linkedPersonAvatar || "",
          totalPool,
          endTime: "Sun 23:59 UTC",
          participants: m.activeParticipantCount || 0,
          category: normalizeMarketCategory(m.category || "misc") as CategoryFilter,
          relatedPersonIds: m.relatedPersonIds || [],
        };
      });
  }, [openMarketsData, personId, personName]);

  const jackpotMarket = useMemo(() => {
    if (!nativeJackpotData) return null;
    return nativeJackpotData.find(
      (m: any) => m.personId === personId && m.status === "OPEN" && m.visibility === "live"
    ) || null;
  }, [nativeJackpotData, personId]);

  const jackpotPoolSize = useMemo(() => {
    if (!jackpotMarket) return 0;
    const entries = jackpotMarket.entries || [];
    return entries.reduce((sum: number, e: any) => sum + Number(e.totalStake || 0), 0) + Number(jackpotMarket.seedVolume || 0);
  }, [jackpotMarket]);

  const hasAnyMarkets = weeklyMarket || h2hBattles.length > 0 || gainerMarkets.length > 0 || communityPredictions.length > 0 || jackpotMarket;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
        <span className="ml-2 text-sm text-muted-foreground">Loading prediction markets...</span>
      </div>
    );
  }

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

      {/* World Markets (Open Markets) */}
      <section>
        <SectionHeader
          icon={<Users className="h-4 w-4 text-violet-400" />}
          title="World Markets"
          subtitle="Predict the outcome of verifiable global events"
          count={communityPredictions.length || undefined}
          showViewAll={communityPredictions.length > 3}
          onViewAll={() => setShowCommunityOverlay(true)}
          infoTooltip="Prediction markets about real-world events involving this person"
        />
        {communityPredictions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {communityPredictions.slice(0, 3).map((community) => (
              <CommunityCard
                key={community.id}
                market={community}
                onClick={() => {}}
                isMarketClosed={isMarketClosed}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No real-world markets for {personName} yet.
          </div>
        )}
      </section>

      {/* Sticky weekly countdown timer */}
      <MarketCycleHero marketState={marketCycle} />

      {/* Weekly Jackpot - person specific */}
      <section>
        <SectionHeader
          icon={<Crown className="h-4 w-4 text-amber-400" />}
          title="Weekly Jackpot"
          subtitle="Predict this week's exact Trend Score"
          infoTooltip="Closest prediction to the final score wins the jackpot pot"
        />

        {jackpotMarket ? (
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
            Guess the exact VoxDex score at week's end. Closest prediction takes the entire pot!
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
                {jackpotPoolSize.toLocaleString('en-US')}
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
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No weekly jackpot market for {personName} yet.
          </div>
        )}

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
      </section>

      {/* Up/Down Predictions */}
      <section>
        <SectionHeader
          icon={<TrendingUp className="h-4 w-4 text-violet-400" />}
          title="Up/Down Predictions"
          subtitle="Will their trend score end the week up or down?"
          infoTooltip="Predict whether their trend score finishes the week above or below the starting value"
        />
        {weeklyMarket ? (
          <WeeklyUpDownCard market={weeklyMarket} isMarketClosed={isMarketClosed} />
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No weekly Up/Down market for {personName} yet.
          </div>
        )}
      </section>

      {/* Head-to-Head Battles */}
      <section>
        <SectionHeader
          icon={<Swords className="h-4 w-4 text-violet-400" />}
          title="Head-to-Head Battles"
          subtitle="Predict who will gain more trend points"
          count={h2hBattles.length || undefined}
          infoTooltip="Face-off markets matching this person against another rival"
        />
        {h2hBattles.length > 0 ? (
          <div className={`grid gap-4 ${h2hBattles.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            {h2hBattles.map((battle) => (
              <HeadToHeadCard key={battle.id} market={battle} isMarketClosed={isMarketClosed} />
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No head-to-head battles involving {personName} yet.
          </div>
        )}
      </section>

      {/* Category Races */}
      <section>
        <SectionHeader
          icon={<BarChart3 className="h-4 w-4 text-violet-400" />}
          title="Category Races"
          subtitle="Pick the biggest mover in each category"
          count={gainerMarkets.length || undefined}
          infoTooltip="The winner is whoever has the highest % gain in their Trend Score by Sunday close — not the highest ranked person."
        />
        {gainerMarkets.length > 0 ? (
          <div className={`grid gap-4 ${gainerMarkets.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            {gainerMarkets.map((gainer) => (
              <TopGainerCard
                key={gainer.id}
                market={gainer}
                personName={personName}
                isMarketClosed={isMarketClosed}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No top gainer markets featuring {personName} yet.
          </div>
        )}
      </section>

      {/* Fallback when there are no markets at all */}
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

      {/* View-all overlay for World Markets */}
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
