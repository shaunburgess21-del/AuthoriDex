import { useState, useMemo, useCallback, useRef } from "react";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CardDeckContainer } from "@/components/CardDeckContainer";
import { CategoryPill } from "@/components/CategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarketCycleHero } from "@/components/MarketCycleHero";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { WeeklyJackpotCard } from "@/components/predict/WeeklyJackpotCard";
import { TrendingPerson } from "@shared/schema";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { 
  TrendingUp, 
  TrendingDown, 
  Swords, 
  Trophy, 
  Users, 
  ChevronRight, 
  Search, 
  Clock,
  Zap,
  Target,
  MessageSquare,
  Star,
  Cpu,
  Landmark,
  Briefcase,
  Music2,
  Video,
  LayoutGrid,
  Lock
} from "lucide-react";
import {
  MOCK_MARKETS,
  HEAD_TO_HEAD_MARKETS,
  TOP_GAINER_MARKETS,
  type PredictionMarket,
  type HeadToHeadMarket,
  type TopGainerMarket,
} from "@/data/predict";
import { getFilterCategories } from "@shared/constants";
import { HomeSectionHeader } from "@/components/home/HomeSectionHeader";

type CategoryFilter = "all" | "favorites" | "trending" | "tech" | "politics" | "business" | "music" | "sports" | "creator";

function smartName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  if (fullName.length <= 14) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

const PREDICT_CATEGORY_FILTERS = getFilterCategories(false).map(cat => ({
  id: cat.toLowerCase() as CategoryFilter,
  label: cat
}));

type PredictSection = "All" | "World" | "Weekly Jackpot" | "Up/Down" | "Head-to-Head" | "Gainer";
const SECTION_TOGGLES: PredictSection[] = ["All", "World", "Weekly Jackpot", "Up/Down", "Head-to-Head", "Gainer"];

interface PredictDeckViewProps {
  trendingPeople: TrendingPerson[];
  isLoading: boolean;
  onExplore: () => void;
}

interface StakeModalState {
  isOpen: boolean;
  type: 'updown' | 'h2h' | 'community';
  marketId: string;
  selection: string;
  personName: string;
  multiplier?: number;
  onConfirm: () => void;
}

function UpDownCard({ 
  market, 
  onPredict,
  isClosed,
  closedMessage,
}: { 
  market: PredictionMarket; 
  onPredict: (marketId: string, direction: 'up' | 'down', personName: string, multiplier: number) => void;
  isClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
}) {
  const isUp = market.change7d >= 0;
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-violet-500/20" style={{ minHeight: '340px' }}>
      <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-fuchsia-500/5 rounded-lg" />
      
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3">
          <Badge 
            variant="outline" 
            className={isUp ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"}
          >
            {isUp ? "+" : ""}{market.change7d.toFixed(1)}%
          </Badge>
          <CategoryPill category={market.category} />
        </div>
        
        <div className="flex flex-col items-center text-center gap-2 mb-4">
          <PersonAvatar name={market.personName} avatar={market.personAvatar} size="xl" />
          <div>
            <p className="font-semibold text-base">{market.personName}</p>
            <p className="text-sm text-muted-foreground font-mono">
              {market.currentScore.toLocaleString('en-US')} pts
            </p>
          </div>
        </div>
        
        <p className="text-xs text-muted-foreground mb-3">
          Will <span className="font-semibold text-foreground">{market.personName.split(" ")[0]}</span>'s Trend Score be higher or lower than start-of-week by close?
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
        
        <div className="grid grid-cols-2 gap-2">
          <ClosedMarketActionTrigger isClosed={!!isClosed} message={closedMessage} side="top" align="start">
            <Button
              size="sm"
              variant="outline"
              className="border-green-500/30 text-green-500 hover:bg-green-500/10"
              onClick={() => onPredict(market.id, 'up', market.personName, market.upMultiplier)}
              data-testid={`button-predict-up-${market.id}`}
            >
              <TrendingUp className="h-4 w-4 mr-1" />
              Up
            </Button>
          </ClosedMarketActionTrigger>
          <ClosedMarketActionTrigger isClosed={!!isClosed} message={closedMessage} side="top" align="end">
            <Button
              size="sm"
              variant="outline"
              className="border-red-500/30 text-red-500 hover:bg-red-500/10"
              onClick={() => onPredict(market.id, 'down', market.personName, market.downMultiplier)}
              data-testid={`button-predict-down-${market.id}`}
            >
              <TrendingDown className="h-4 w-4 mr-1" />
              Down
            </Button>
          </ClosedMarketActionTrigger>
        </div>
      </div>
    </Card>
  );
}

function H2HCard({ 
  market, 
  onPredict,
  isClosed,
  closedMessage,
}: { 
  market: HeadToHeadMarket; 
  onPredict: (marketId: string, selection: 'person1' | 'person2', personName: string) => void;
  isClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
}) {
  return (
    <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-violet-500/20" style={{ minHeight: '340px' }}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-0 top-0 w-1/2 h-full bg-gradient-to-r from-blue-600/20 to-transparent" />
        <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-purple-600/20 to-transparent" />
      </div>
      
      <div className="relative z-10 p-4">
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
          <CategoryPill category={market.category} />
        </div>
        
        <div className="flex items-center justify-between mb-4">
          <ClosedMarketActionTrigger isClosed={!!isClosed} message={closedMessage} side="top" align="start">
            <div
              className={`flex flex-col items-center flex-1 ${isClosed ? "" : "cursor-pointer"} group/p1`}
              onClick={() => !isClosed && onPredict(market.id, 'person1', market.person1.name)}
            >
              <div className="relative">
                <div className="absolute -inset-3 rounded-full bg-blue-500/30 blur-md transition-opacity group-hover/p1:bg-blue-500/50" />
                <div className="relative rounded-full ring-2 ring-transparent transition-all group-hover/p1:ring-blue-500/60">
                  <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} size="xl" />
                </div>
              </div>
              <p className="text-sm font-semibold mt-2 text-center">{smartName(market.person1.name)}</p>
              <span className="text-xs text-blue-400">{market.person1Percent}%</span>
            </div>
          </ClosedMarketActionTrigger>
          
          <div className="relative mx-2">
            <div className="h-14 w-14 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
              <span className="text-sm font-bold text-slate-200">VS</span>
            </div>
          </div>
          
          <ClosedMarketActionTrigger isClosed={!!isClosed} message={closedMessage} side="top" align="end">
            <div
              className={`flex flex-col items-center flex-1 ${isClosed ? "" : "cursor-pointer"} group/p2`}
              onClick={() => !isClosed && onPredict(market.id, 'person2', market.person2.name)}
            >
              <div className="relative">
                <div className="absolute -inset-3 rounded-full bg-purple-500/30 blur-md transition-opacity group-hover/p2:bg-purple-500/50" />
                <div className="relative rounded-full ring-2 ring-transparent transition-all group-hover/p2:ring-purple-500/60">
                  <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} size="xl" />
                </div>
              </div>
              <p className="text-sm font-semibold mt-2 text-center">{smartName(market.person2.name)}</p>
              <span className="text-xs text-purple-400">{100 - market.person1Percent}%</span>
            </div>
          </ClosedMarketActionTrigger>
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
        
        <div className="grid grid-cols-2 gap-2">
          <ClosedMarketActionTrigger isClosed={!!isClosed} message={closedMessage} side="top" align="start">
            <Button 
              size="sm" 
              className="bg-[#3B82F6]/10 border border-[#3B82F6]/50 text-[#3B82F6] hover:border-[#3B82F6]/80 hover:bg-[#3B82F6]/20 py-3 md:py-2 h-auto"
              onClick={() => onPredict(market.id, 'person1', market.person1.name)}
              data-testid={`button-h2h-p1-${market.id}`}
            >
              {smartName(market.person1.name)}
            </Button>
          </ClosedMarketActionTrigger>
          <ClosedMarketActionTrigger isClosed={!!isClosed} message={closedMessage} side="top" align="end">
            <Button 
              size="sm" 
              className="bg-[#7C3AED]/10 border border-[#7C3AED]/50 text-[#7C3AED] hover:border-[#7C3AED]/80 hover:bg-[#7C3AED]/20 py-3 md:py-2 h-auto"
              onClick={() => onPredict(market.id, 'person2', market.person2.name)}
              data-testid={`button-h2h-p2-${market.id}`}
            >
              {smartName(market.person2.name)}
            </Button>
          </ClosedMarketActionTrigger>
        </div>
      </div>
    </Card>
  );
}

function CommunityCard({
  market,
  onNavigate,
}: {
  market: any;
  onNavigate: (slug: string, pick?: string) => void;
}) {
  const entries = market.entries || [];
  const totalPool = entries.reduce((sum: number, e: any) => sum + (e.totalStake || 0) + (e.seedCount || 0), 0);
  const entrySeedTotal = entries.reduce((sum: number, e: any) => sum + (e.seedCount || 0), 0);
  const participants = (market.totalParticipants || 0) + entrySeedTotal;
  
  const entry1 = entries[0];
  const entry2 = entries[1];
  const stake1 = (entry1?.totalStake || 0) + (entry1?.seedCount || 0);
  const stake2 = (entry2?.totalStake || 0) + (entry2?.seedCount || 0);
  const total = stake1 + stake2 || 1;
  const pct1 = Math.round((stake1 / total) * 100);
  const pct2 = 100 - pct1;
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-violet-500/20" style={{ minHeight: '280px' }}>
      <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-cyan-500/5 rounded-lg" />
      <div className="relative p-4 flex flex-col" style={{ minHeight: '264px' }}>
        <div className="flex items-center justify-between mb-3">
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {market.openMarketType === "updown" ? "Strike" : market.openMarketType === "multi" ? `${entries.length} options` : "Yes / No"}
          </Badge>
          {market.category && <CategoryPill category={market.category} />}
        </div>
        
        <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); onNavigate(market.slug); }} className="cursor-pointer">
          <p className="text-sm font-semibold mb-3 line-clamp-2 text-center hover:text-violet-400 transition-colors">{market.title}</p>
        </a>
        
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-3">
          <Users className="h-3 w-3" />
          <span>{participants} participants</span>
        </div>
        
        <div className="flex-1" />
        
        {entries.length === 2 && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-green-500 font-semibold">{entry1?.label} {pct1}%</span>
              <span className="text-red-500 font-semibold">{entry2?.label} {pct2}%</span>
            </div>
            <div className="h-2 rounded-full bg-red-500/20 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all" style={{ width: `${pct1}%` }} />
            </div>
          </div>
        )}
        
        {entries.length > 2 && (
          <div className="space-y-2 mb-3">
            {entries.slice(0, 1).map((entry: any) => {
              const entryStake = (entry.totalStake || 0) + (entry.seedCount || 0);
              const totalAll = entries.reduce((s: number, e: any) => s + (e.totalStake || 0) + (e.seedCount || 0), 0) || 1;
              const pct = Math.round((entryStake / totalAll) * 100);
              return (
                <div key={entry.id} className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate flex-1">{entry.label}</span>
                  <span className="text-muted-foreground font-semibold">{pct}%</span>
                </div>
              );
            })}
            {entries.length > 1 && <p className="text-xs text-muted-foreground text-center font-medium">+{entries.length - 1} more</p>}
          </div>
        )}
        
        <div className="flex items-center justify-center mb-3">
          <span className="text-sm font-semibold text-violet-500">Pool: {totalPool.toLocaleString('en-US')}</span>
        </div>
        
        <Button 
          size="sm" 
          variant="outline"
          className="w-full border-violet-500/30 text-violet-500"
          onClick={() => onNavigate(market.slug)}
          data-testid={`button-predict-${market.slug}`}
        >
          View Market
        </Button>
      </div>
    </Card>
  );
}

function GainerCard({
  market,
  onPredict,
  isClosed,
  closedMessage,
}: {
  market: TopGainerMarket;
  onPredict: (marketId: string, leaderName: string) => void;
  isClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
}) {
  const categoryLabel = market.category.charAt(0).toUpperCase() + market.category.slice(1);
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-green-500/20" style={{ minHeight: '340px' }}>
      <div className="absolute inset-0 bg-gradient-to-r from-green-500/5 via-transparent to-emerald-500/5 rounded-lg" />
      
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground">This week's gain</span>
          <CategoryPill category={market.category} />
        </div>
        
        <h3 className="text-sm font-semibold mb-3">Category Race: {categoryLabel}</h3>
        
        <div className="space-y-1.5 mb-4">
          {(() => {
            const maxGain = Math.max(...market.leaders.map(l => Math.abs(l.percentGain)), 1);
            return market.leaders.map((leader, idx) => (
              <div 
                key={leader.name}
                className={`flex items-center gap-3 p-2.5 rounded-lg relative overflow-hidden ${idx === 0 ? 'bg-gradient-to-r from-amber-500/10 to-slate-800/50 border border-amber-500/30' : 'bg-slate-800/50 border border-slate-700/30'}`}
              >
                <div className="absolute inset-y-0 left-0 bg-green-500/8 transition-all" style={{ width: `${Math.max((Math.abs(leader.percentGain) / maxGain) * 100, 5)}%` }} />
                <div className="relative flex items-center gap-2 flex-1 min-w-0">
                  {idx === 0 ? (
                    <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center">
                      <Trophy className="h-3.5 w-3.5 text-amber-400" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted/50 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-muted-foreground">#{idx + 1}</span>
                    </div>
                  )}
                  <PersonAvatar name={leader.name} avatar={leader.avatar} className="h-12 w-12" />
                  <span className="text-sm font-medium truncate">{leader.name}</span>
                </div>
                <div className="relative text-right">
                  <div className="text-sm font-semibold text-green-400">
                    +{leader.currentGain.toLocaleString('en-US')} pts
                  </div>
                  <div className="text-xs text-green-500/70 font-mono">
                    +{leader.percentGain}%
                  </div>
                </div>
              </div>
            ));
          })()}
        </div>
        
        <div className="flex items-center justify-center mb-3">
          <span className="text-sm font-semibold text-violet-400">
            Pool: {market.totalPool.toLocaleString('en-US')}
          </span>
        </div>
        
        <ClosedMarketActionTrigger isClosed={!!isClosed} message={closedMessage} side="top" align="center">
          <Button
            size="sm"
            className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500"
            onClick={() => onPredict(market.id, market.leaders[0].name)}
            data-testid={`button-gainer-predict-${market.id}`}
          >
            <ChevronRight className="h-4 w-4 mr-1.5" />
            Place Prediction
          </Button>
        </ClosedMarketActionTrigger>
      </div>
    </Card>
  );
}

function StakeModal({
  state,
  onClose,
  userCredits,
}: {
  state: StakeModalState | null;
  onClose: () => void;
  userCredits: number;
}) {
  const [stakeAmount, setStakeAmount] = useState(50);
  
  if (!state) return null;
  
  const potentialWin = state.multiplier ? Math.round(stakeAmount * state.multiplier) : stakeAmount * 2;
  
  return (
    <Dialog open={state.isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-violet-500" />
            Confirm Prediction
          </DialogTitle>
          <DialogDescription>
            {state.type === 'updown' && `Predicting ${state.selection} for ${state.personName}`}
            {state.type === 'h2h' && `Backing ${state.personName} to win`}
            {state.type === 'community' && `Selecting "${state.selection}"`}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-slate-700/30">
            <span className="text-sm text-muted-foreground">Your Balance</span>
            <span className="font-semibold text-violet-400">{userCredits.toLocaleString('en-US')} credits</span>
          </div>
          
          <div>
            <label className="text-sm font-medium mb-2 block">Stake Amount</label>
            <div className="flex gap-2">
              {[25, 50, 100, 250].map(amt => (
                <Button
                  key={amt}
                  size="sm"
                  variant={stakeAmount === amt ? "default" : "outline"}
                  className={stakeAmount === amt ? "bg-violet-600" : ""}
                  onClick={() => setStakeAmount(amt)}
                >
                  {amt}
                </Button>
              ))}
            </div>
          </div>
          
          <div className="flex items-center justify-between p-3 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <span className="text-sm">Potential Win</span>
            <span className="font-bold text-lg text-green-400">+{potentialWin.toLocaleString('en-US')}</span>
          </div>
        </div>
        
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            className="bg-gradient-to-r from-violet-600 to-fuchsia-600"
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
          >
            <Zap className="h-4 w-4 mr-1.5" />
            Confirm Prediction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PredictDeckView({ trendingPeople, isLoading, onExplore }: PredictDeckViewProps) {
  const { data: nativeUpdownData } = useQuery<any[]>({ queryKey: ['/api/native-markets/updown'] });

  const { serverBettingCutoff, serverResolutionDeadline } = useMemo(() => {
    const allNative = nativeUpdownData || [];
    const cutoffs = allNative.map((m: any) => m.bettingCutoff).filter(Boolean) as string[];
    const endAts = allNative.map((m: any) => m.endAt).filter(Boolean).map((d: string) => typeof d === "string" ? d : new Date(d).toISOString());
    cutoffs.sort();
    endAts.sort();
    return {
      serverBettingCutoff: cutoffs[0] || null,
      serverResolutionDeadline: endAts[0] || null,
    };
  }, [nativeUpdownData]);

  const marketState = useMarketCycle({ bettingCutoff: serverBettingCutoff, resolutionDeadline: serverResolutionDeadline });
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState<PredictSection>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedPerson, setSelectedPerson] = useState<TrendingPerson | null>(null);
  
  const [userCredits] = useState(1000);
  const [stakeModal, setStakeModal] = useState<StakeModalState | null>(null);
  const [predictions, setPredictions] = useState<Set<string>>(new Set());
  const pendingCycleCallbackRef = useRef<(() => void) | null>(null);
  
  const [upDownInteracted, setUpDownInteracted] = useState(false);
  const [h2hInteracted, setH2hInteracted] = useState(false);
  const [gainerInteracted, setGainerInteracted] = useState(false);
  const [communityInteracted, setCommunityInteracted] = useState(false);
  const [pendingPrediction, setPendingPrediction] = useState<string | null>(null);

  const { data: openMarketsData } = useQuery<any[]>({
    queryKey: ['/api/open-markets'],
  });
  const openMarkets = openMarketsData || [];

  const filteredUpDown = useMemo(() =>
    MOCK_MARKETS.filter(m => {
      const matchesCategory = categoryFilter === "all" || categoryFilter === "trending" || m.category === categoryFilter;
      const matchesSearch = !searchQuery || m.personName.toLowerCase().includes(searchQuery.toLowerCase());
      const notPredicted = !predictions.has(m.id);
      return matchesCategory && matchesSearch && notPredicted;
    }).sort((a: any, b: any) => categoryFilter === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0),
    [categoryFilter, searchQuery, predictions]
  );

  const filteredH2H = useMemo(() =>
    HEAD_TO_HEAD_MARKETS.filter(m => {
      const matchesCategory = categoryFilter === "all" || categoryFilter === "trending" || m.category === categoryFilter;
      const matchesSearch = !searchQuery || 
        m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.person1.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.person2.name.toLowerCase().includes(searchQuery.toLowerCase());
      const notPredicted = !predictions.has(m.id);
      return matchesCategory && matchesSearch && notPredicted;
    }).sort((a: any, b: any) => categoryFilter === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0),
    [categoryFilter, searchQuery, predictions]
  );

  const filteredCommunity = useMemo(() =>
    openMarkets.filter((m: any) => {
      const matchesCategory = categoryFilter === "all" || categoryFilter === "trending" || m.category === categoryFilter;
      const matchesSearch = !searchQuery || m.title?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    }).sort((a: any, b: any) => categoryFilter === "trending" ? ((b.seedVolume ?? 0) - (a.seedVolume ?? 0)) : 0),
    [categoryFilter, searchQuery, openMarkets]
  );

  const filteredGainer = useMemo(() =>
    TOP_GAINER_MARKETS.filter(m => {
      const matchesCategory = categoryFilter === "all" || categoryFilter === "trending" || m.category === categoryFilter;
      const matchesSearch = !searchQuery || 
        m.leaders.some(l => l.name.toLowerCase().includes(searchQuery.toLowerCase()));
      const notPredicted = !predictions.has(m.id);
      return matchesCategory && matchesSearch && notPredicted;
    }).sort((a: any, b: any) => categoryFilter === "trending" ? ((b.totalBets ?? 0) - (a.totalBets ?? 0)) : 0),
    [categoryFilter, searchQuery, predictions]
  );

  const isClosed = marketState.status !== "OPEN";
  const closedMarketMessage = useMemo(() => {
    return getClosedMarketMessage({
      bettingCutoff: serverBettingCutoff,
      resolutionDeadline: serverResolutionDeadline,
    });
  }, [serverBettingCutoff, serverResolutionDeadline]);

  const handleUpDownPredict = useCallback((marketId: string, direction: 'up' | 'down', personName: string, multiplier: number) => {
    if (isClosed) {
      toast({
        title: closedMarketMessage.title,
        description: closedMarketMessage.description,
      });
      return;
    }
    setStakeModal({
      isOpen: true,
      type: 'updown',
      marketId,
      selection: direction,
      personName,
      multiplier,
      onConfirm: () => {
        setPendingPrediction(marketId);
        setUpDownInteracted(true);
      },
    });
  }, [isClosed, toast, closedMarketMessage]);

  const handleH2HPredict = useCallback((marketId: string, selection: 'person1' | 'person2', personName: string) => {
    if (isClosed) {
      toast({
        title: closedMarketMessage.title,
        description: closedMarketMessage.description,
      });
      return;
    }
    setStakeModal({
      isOpen: true,
      type: 'h2h',
      marketId,
      selection,
      personName,
      onConfirm: () => {
        setPendingPrediction(marketId);
        setH2hInteracted(true);
      },
    });
  }, [isClosed, toast, closedMarketMessage]);

  const handleGainerPredict = useCallback((marketId: string, leaderName: string) => {
    if (isClosed) {
      toast({
        title: closedMarketMessage.title,
        description: closedMarketMessage.description,
      });
      return;
    }
    setStakeModal({
      isOpen: true,
      type: 'community',
      marketId,
      selection: leaderName,
      personName: leaderName,
      onConfirm: () => {
        setPendingPrediction(marketId);
        setGainerInteracted(true);
      },
    });
  }, [isClosed, toast, closedMarketMessage]);

  const closeStakeModal = () => {
    setStakeModal(null);
    pendingCycleCallbackRef.current = null;
  };

  const dragScrollRef1 = useDragScroll<HTMLDivElement>();
  const dragScrollRef2 = useDragScroll<HTMLDivElement>();

  const showRealWorld = activeSection === "All" || activeSection === "World";
  const showJackpot = activeSection === "All" || activeSection === "Weekly Jackpot";
  const showUpDown = activeSection === "All" || activeSection === "Up/Down";
  const showH2H = activeSection === "All" || activeSection === "Head-to-Head";
  const showGainer = activeSection === "All" || activeSection === "Gainer";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto space-y-4"
    >
      <div ref={dragScrollRef1} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
        {SECTION_TOGGLES.map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeSection === section
                ? "bg-violet-500/20 text-violet-400 border border-violet-400/40"
                : "bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent"
            }`}
            data-testid={`toggle-predict-section-${section.toLowerCase().replace(/[\s\/]/g, '-')}`}
          >
            {section === "World" && <MessageSquare className="h-3 w-3" />}
            {section === "Weekly Jackpot" && <Trophy className="h-3 w-3" />}
            {section === "Up/Down" && <TrendingUp className="h-3 w-3" />}
            {section === "Head-to-Head" && <Swords className="h-3 w-3" />}
            {section === "Gainer" && <TrendingUp className="h-3 w-3" />}
            {section}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search predictions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-9"
          data-testid="input-predict-search"
        />
      </div>

      <div ref={dragScrollRef2} className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {PREDICT_CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat.id}
            onClick={() => {
              if (cat.id === "favorites" && !user) {
                setLocation("/login");
                return;
              }
              setCategoryFilter(cat.id);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
              categoryFilter === cat.id
                ? 'bg-violet-500/20 text-violet-300 border border-violet-400/40'
                : 'bg-muted/30 border border-border/50 text-muted-foreground hover:bg-muted/50'
            }`}
            data-testid={`chip-predict-category-${cat.id}`}
            aria-label={cat.id === "favorites" ? "Favorites" : undefined}
          >
            {cat.id === "all" && <LayoutGrid className="h-3.5 w-3.5" />}
            {cat.id === "favorites" && <Star className="h-3.5 w-3.5" />}
            {cat.id === "tech" && <Cpu className="h-3.5 w-3.5" />}
            {cat.id === "politics" && <Landmark className="h-3.5 w-3.5" />}
            {cat.id === "business" && <Briefcase className="h-3.5 w-3.5" />}
            {cat.id === "music" && <Music2 className="h-3.5 w-3.5" />}
            {cat.id === "sports" && <Trophy className="h-3.5 w-3.5" />}
            {cat.id === "creator" && <Video className="h-3.5 w-3.5" />}
            {cat.id === "favorites" ? <span className="hidden md:inline">{cat.label}</span> : cat.label}
          </button>
        ))}
      </div>

      {showRealWorld && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="predict"
            icon={MessageSquare}
            title="World Markets"
            subtitle="Predict outcomes of verifiable events."
            help={{ title: "How World Markets Work", bullets: ["Bet on outcomes of real-world events using credits.", "Markets resolve based on verifiable results and trusted sources.", "Win credits proportional to the odds when you predicted."] }}
            onViewAll={onExplore}
          />
          {openMarkets.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCommunity.slice(0, activeSection === "World" ? 20 : 3).map((market: any) => (
                <CommunityCard
                  key={market.id}
                  market={market}
                  onNavigate={(slug, pick) => setLocation(`/markets/${slug}${pick ? `?pick=${pick}` : ''}`)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No real-world markets available yet
            </div>
          )}
        </div>
      )}

      <MarketCycleHero marketState={marketState} />

      {showJackpot && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="predict"
            icon={Trophy}
            title="Weekly Jackpot"
            subtitle="Closest prediction wins the pot."
            help={{ title: "How Weekly Jackpot Works", bullets: ["Predict which celebrity will be the top gainer this week.", "The closest prediction to the actual result wins the jackpot.", "Entry costs credits; the pot grows as more players join."] }}
            onViewAll={onExplore}
          />
          <WeeklyJackpotCard
            onEnterJackpot={onExplore}
            marketStatus={marketState.status}
            timeRemaining={marketState.timeRemaining}
            trendingPeople={trendingPeople}
            selectedPerson={selectedPerson}
            onSelectPerson={setSelectedPerson}
            isLoading={isLoading}
            compact={true}
          />
        </div>
      )}

      {showUpDown && filteredUpDown.length > 0 && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="predict"
            icon={TrendingUp}
            title="Up/Down Predictions"
            subtitle="Will their Trend Score rise or fall?"
            help={{ title: "How Up/Down Predictions Work", bullets: ["Predict whether a celebrity's Trend Score will go up or down.", "Higher multipliers mean bigger risk and bigger rewards.", "Markets resolve at the end of each weekly cycle."] }}
            onViewAll={onExplore}
          />
          <CardDeckContainer
            items={filteredUpDown}
            viewType="predict"
            hasInteracted={upDownInteracted}
            onAdvance={() => {
              if (pendingPrediction) {
                setPredictions(prev => new Set(prev).add(pendingPrediction));
                setPendingPrediction(null);
              }
              setUpDownInteracted(false);
            }}
            renderCard={(market) => (
              <UpDownCard
                market={market}
                onPredict={(id, dir, name, mult) => handleUpDownPredict(id, dir, name, mult)}
                isClosed={isClosed}
                closedMessage={closedMarketMessage}
              />
            )}
            emptyMessage="No up/down markets match your filters"
          />
        </div>
      )}

      {showH2H && filteredH2H.length > 0 && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="predict"
            icon={Swords}
            title="Head-to-Head Battles"
            subtitle="Who gains more this week?"
            help={{ title: "How Head-to-Head Works", bullets: ["Pick which celebrity will gain more fame this week.", "Two celebrities go head-to-head; choose your winner.", "Results resolve at the end of the weekly prediction cycle."] }}
            onViewAll={onExplore}
          />
          <CardDeckContainer
            items={filteredH2H}
            viewType="predict"
            hasInteracted={h2hInteracted}
            onAdvance={() => {
              if (pendingPrediction) {
                setPredictions(prev => new Set(prev).add(pendingPrediction));
                setPendingPrediction(null);
              }
              setH2hInteracted(false);
            }}
            renderCard={(market) => (
              <H2HCard
                market={market}
                onPredict={(id, sel, name) => handleH2HPredict(id, sel, name)}
                isClosed={isClosed}
                closedMessage={closedMarketMessage}
              />
            )}
            emptyMessage="No head-to-head markets match your filters"
          />
        </div>
      )}

      {showGainer && filteredGainer.length > 0 && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="predict"
            icon={TrendingUp}
            title="Category Races"
            subtitle="Pick the biggest mover in each category this week."
            help={{ title: "How Category Races Work", bullets: ["Pick who you think will have the highest % gain in their Trend Score by Sunday close.", "It's not about who's ranked highest — it's about who moves the most.", "The biggest mover wins the pool. Underdogs can pay big."] }}
            onViewAll={onExplore}
          />
          <CardDeckContainer
            items={filteredGainer}
            viewType="predict"
            hasInteracted={gainerInteracted}
            onAdvance={() => {
              if (pendingPrediction) {
                setPredictions(prev => new Set(prev).add(pendingPrediction));
                setPendingPrediction(null);
              }
              setGainerInteracted(false);
            }}
            renderCard={(market) => (
              <GainerCard
                market={market}
                onPredict={(id, leaderName) => handleGainerPredict(id, leaderName)}
                isClosed={isClosed}
                closedMessage={closedMarketMessage}
              />
            )}
            emptyMessage="No gainer markets match your filters"
          />
        </div>
      )}

      <div className="flex flex-col items-center gap-3 pt-4">
        <Button 
          size="lg"
          className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold px-8 shadow-lg shadow-violet-500/20"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            onExplore();
          }}
          data-testid="button-explore-markets"
        >
          Explore All Prediction Markets
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      
      <StakeModal
        state={stakeModal}
        onClose={closeStakeModal}
        userCredits={userCredits}
      />
    </motion.div>
  );
}
