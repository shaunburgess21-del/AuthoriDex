import { useState, useMemo, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CardDeckContainer } from "@/components/CardDeckContainer";
import { CategoryPill } from "@/components/CategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { MarketCycleHero } from "@/components/MarketCycleHero";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { WeeklyJackpotCard } from "@/components/predict/WeeklyJackpotCard";
import { TrendingPerson } from "@shared/schema";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
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
  Star
} from "lucide-react";
import {
  MOCK_MARKETS,
  HEAD_TO_HEAD_MARKETS,
  TOP_GAINER_MARKETS,
  COMMUNITY_MARKETS,
  type PredictionMarket,
  type HeadToHeadMarket,
  type TopGainerMarket,
  type CommunityMarket,
} from "@/data/predict";
import { getFilterCategories } from "@shared/constants";

type CategoryFilter = "all" | "favorites" | "tech" | "politics" | "business" | "entertainment" | "sports" | "creator";

const PREDICT_CATEGORY_FILTERS = getFilterCategories(false).map(cat => ({
  id: cat.toLowerCase() as CategoryFilter,
  label: cat
}));

type PredictSection = "All" | "Real-World" | "Weekly Jackpot" | "Up/Down" | "Head-to-Head" | "Gainer";
const SECTION_TOGGLES: PredictSection[] = ["All", "Real-World", "Weekly Jackpot", "Up/Down", "Head-to-Head", "Gainer"];

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
  onPredict 
}: { 
  market: PredictionMarket; 
  onPredict: (marketId: string, direction: 'up' | 'down', personName: string, multiplier: number) => void;
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
              {market.currentScore.toLocaleString()} pts
            </p>
          </div>
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
          <span className="text-muted-foreground">Pool: {market.totalPool.toLocaleString()}</span>
          <span className="text-red-500">Down {market.downMultiplier}x</span>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
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
        </div>
      </div>
    </Card>
  );
}

function H2HCard({ 
  market, 
  onPredict 
}: { 
  market: HeadToHeadMarket; 
  onPredict: (marketId: string, selection: 'person1' | 'person2', personName: string) => void;
}) {
  return (
    <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-violet-500/20" style={{ minHeight: '340px' }}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-0 top-0 w-1/2 h-full bg-gradient-to-r from-blue-600/20 to-transparent" />
        <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-purple-600/20 to-transparent" />
      </div>
      
      <div className="relative z-10 p-4">
        <div className="flex items-center justify-between mb-3">
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {market.endTime}
          </Badge>
          <CategoryPill category={market.category} />
        </div>
        
        <div className="flex items-center justify-between mb-4">
          <div className="flex flex-col items-center flex-1">
            <div className="relative">
              <div className="absolute -inset-3 rounded-full bg-blue-500/30 blur-md" />
              <div className="relative">
                <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} size="xl" />
              </div>
            </div>
            <p className="text-sm font-semibold mt-2 text-center">{market.person1.name.split(" ")[0]}</p>
            <span className="text-xs text-blue-400">{market.person1Percent}%</span>
          </div>
          
          <div className="relative mx-2">
            <div className="h-14 w-14 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
              <span className="text-sm font-bold text-slate-200">VS</span>
            </div>
          </div>
          
          <div className="flex flex-col items-center flex-1">
            <div className="relative">
              <div className="absolute -inset-3 rounded-full bg-purple-500/30 blur-md" />
              <div className="relative">
                <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} size="xl" />
              </div>
            </div>
            <p className="text-sm font-semibold mt-2 text-center">{market.person2.name.split(" ")[0]}</p>
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
            Pool: {market.totalPool.toLocaleString()}
          </span>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <Button 
            size="sm" 
            variant="outline" 
            className="border-blue-500/30 text-blue-500 hover:bg-blue-500/10"
            onClick={() => onPredict(market.id, 'person1', market.person1.name)}
            data-testid={`button-h2h-p1-${market.id}`}
          >
            {market.person1.name.split(" ")[0]}
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            className="border-purple-500/30 text-purple-500 hover:bg-purple-500/10"
            onClick={() => onPredict(market.id, 'person2', market.person2.name)}
            data-testid={`button-h2h-p2-${market.id}`}
          >
            {market.person2.name.split(" ")[0]}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CommunityCard({
  market,
  onPredict,
}: {
  market: CommunityMarket;
  onPredict: (marketId: string, optionId: string, optionText: string) => void;
}) {
  // Use options data if available, otherwise calculate from seed
  const yesOption = market.options.find(o => o.id === 'yes' || o.text.toLowerCase() === 'yes');
  const noOption = market.options.find(o => o.id === 'no' || o.text.toLowerCase() === 'no');
  const yesPercent = yesOption?.percent ?? 50;
  const noPercent = noOption?.percent ?? 50;
  const yesOdds = (100 / yesPercent).toFixed(2);
  const noOdds = (100 / noPercent).toFixed(2);
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-violet-500/20" style={{ minHeight: '340px' }}>
      <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-cyan-500/5 rounded-lg" />
      
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3">
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            3d left
          </Badge>
          <CategoryPill category={market.category} />
        </div>
        
        <div className="flex flex-col items-center text-center mb-3">
          <PersonAvatar name={market.personName} avatar={market.personAvatar} size="xl" />
          <span className="text-sm font-medium mt-2">{market.personName}</span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            <span>{market.participants} participants</span>
          </div>
        </div>
        
        <p className="text-sm font-semibold mb-3 line-clamp-2 text-center">{market.question}</p>
        
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-green-500 font-semibold">Yes {yesPercent}%</span>
            <span className="text-red-500 font-semibold">No {noPercent}%</span>
          </div>
          <div className="h-2 rounded-full bg-red-500/20 overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all"
              style={{ width: `${yesPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
            <span>{yesOdds}x return</span>
            <span>{noOdds}x return</span>
          </div>
        </div>
        
        <div className="flex items-center justify-center mb-3">
          <span className="text-sm font-semibold text-violet-500">
            Pool: {market.totalPool.toLocaleString()}
          </span>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <Button 
            size="sm" 
            variant="outline"
            className="border-green-500/30 text-green-500 hover:bg-green-500/10"
            onClick={() => onPredict(market.id, 'yes', 'Yes')}
            data-testid={`button-community-yes-${market.id}`}
          >
            Yes
          </Button>
          <Button 
            size="sm" 
            variant="outline"
            className="border-red-500/30 text-red-500 hover:bg-red-500/10"
            onClick={() => onPredict(market.id, 'no', 'No')}
            data-testid={`button-community-no-${market.id}`}
          >
            No
          </Button>
        </div>
      </div>
    </Card>
  );
}

function GainerCard({
  market,
  onPredict,
}: {
  market: TopGainerMarket;
  onPredict: (marketId: string, leaderName: string) => void;
}) {
  const categoryLabel = market.category.charAt(0).toUpperCase() + market.category.slice(1);
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-green-500/20" style={{ minHeight: '340px' }}>
      <div className="absolute inset-0 bg-gradient-to-r from-green-500/5 via-transparent to-emerald-500/5 rounded-lg" />
      
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground">7-day gain</span>
          <CategoryPill category={market.category} />
        </div>
        
        <h3 className="text-sm font-semibold mb-3">Top Gainer: {categoryLabel}</h3>
        
        <div className="space-y-2 mb-4">
          {market.leaders.map((leader, idx) => (
            <div 
              key={leader.name}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/30"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {idx === 0 && (
                  <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <Trophy className="h-3.5 w-3.5 text-amber-400" />
                  </div>
                )}
                {idx !== 0 && (
                  <span className="w-6 h-6 flex items-center justify-center text-xs text-muted-foreground">
                    #{idx + 1}
                  </span>
                )}
                <PersonAvatar name={leader.name} avatar={leader.avatar} size="lg" />
                <span className="text-sm font-medium truncate">{leader.name}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-green-400">
                  +{leader.currentGain.toLocaleString()} pts
                </div>
                <div className="text-xs text-green-500/70">
                  +{leader.percentGain}%
                </div>
              </div>
            </div>
          ))}
        </div>
        
        <div className="flex items-center justify-center mb-3">
          <span className="text-sm font-semibold text-violet-400">
            Pool: {market.totalPool.toLocaleString()}
          </span>
        </div>
        
        <Button
          size="sm"
          className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500"
          onClick={() => onPredict(market.id, market.leaders[0].name)}
          data-testid={`button-gainer-predict-${market.id}`}
        >
          <ChevronRight className="h-4 w-4 mr-1.5" />
          Place Prediction
        </Button>
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
            <span className="font-semibold text-violet-400">{userCredits.toLocaleString()} credits</span>
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
            <span className="font-bold text-lg text-green-400">+{potentialWin.toLocaleString()}</span>
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
  const marketState = useMarketCycle();
  const { user } = useAuth();
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

  const filteredUpDown = useMemo(() =>
    MOCK_MARKETS.filter(m => {
      const matchesCategory = categoryFilter === "all" || m.category === categoryFilter;
      const matchesSearch = !searchQuery || m.personName.toLowerCase().includes(searchQuery.toLowerCase());
      const notPredicted = !predictions.has(m.id);
      return matchesCategory && matchesSearch && notPredicted;
    }),
    [categoryFilter, searchQuery, predictions]
  );

  const filteredH2H = useMemo(() =>
    HEAD_TO_HEAD_MARKETS.filter(m => {
      const matchesCategory = categoryFilter === "all" || m.category === categoryFilter;
      const matchesSearch = !searchQuery || 
        m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.person1.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.person2.name.toLowerCase().includes(searchQuery.toLowerCase());
      const notPredicted = !predictions.has(m.id);
      return matchesCategory && matchesSearch && notPredicted;
    }),
    [categoryFilter, searchQuery, predictions]
  );

  const filteredCommunity = useMemo(() =>
    COMMUNITY_MARKETS.filter(m => {
      const matchesCategory = categoryFilter === "all" || m.category === categoryFilter;
      const matchesSearch = !searchQuery || m.question.toLowerCase().includes(searchQuery.toLowerCase());
      const notPredicted = !predictions.has(m.id);
      return matchesCategory && matchesSearch && notPredicted;
    }),
    [categoryFilter, searchQuery, predictions]
  );

  const filteredGainer = useMemo(() =>
    TOP_GAINER_MARKETS.filter(m => {
      const matchesCategory = categoryFilter === "all" || m.category === categoryFilter;
      const matchesSearch = !searchQuery || 
        m.leaders.some(l => l.name.toLowerCase().includes(searchQuery.toLowerCase()));
      const notPredicted = !predictions.has(m.id);
      return matchesCategory && matchesSearch && notPredicted;
    }),
    [categoryFilter, searchQuery, predictions]
  );

  const handleUpDownPredict = useCallback((marketId: string, direction: 'up' | 'down', personName: string, multiplier: number) => {
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
  }, []);

  const handleH2HPredict = useCallback((marketId: string, selection: 'person1' | 'person2', personName: string) => {
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
  }, []);

  const handleCommunityPredict = useCallback((marketId: string, optionId: string, optionText: string) => {
    setStakeModal({
      isOpen: true,
      type: 'community',
      marketId,
      selection: optionText,
      personName: optionText,
      onConfirm: () => {
        setPendingPrediction(marketId);
        setCommunityInteracted(true);
      },
    });
  }, []);

  const handleGainerPredict = useCallback((marketId: string, leaderName: string) => {
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
  }, []);

  const closeStakeModal = () => {
    setStakeModal(null);
    pendingCycleCallbackRef.current = null;
  };

  const showRealWorld = activeSection === "All" || activeSection === "Real-World";
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
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
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
            {section === "Real-World" && <MessageSquare className="h-3 w-3" />}
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

      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
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
            {cat.id === "favorites" && <Star className="h-3.5 w-3.5" />}
            {cat.id === "favorites" ? <span className="hidden md:inline">{cat.label}</span> : cat.label}
          </button>
        ))}
      </div>

      {showRealWorld && filteredCommunity.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold">Real-World Markets</h3>
          </div>
          <CardDeckContainer
            items={filteredCommunity}
            viewType="predict"
            hasInteracted={communityInteracted}
            onAdvance={() => {
              if (pendingPrediction) {
                setPredictions(prev => new Set(prev).add(pendingPrediction));
                setPendingPrediction(null);
              }
              setCommunityInteracted(false);
            }}
            renderCard={(market) => (
              <CommunityCard
                market={market}
                onPredict={(id, optId, optText) => handleCommunityPredict(id, optId, optText)}
              />
            )}
            emptyMessage="No real-world markets match your filters"
          />
        </div>
      )}

      <MarketCycleHero marketState={marketState} />

      {showJackpot && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold">Weekly Jackpot</h3>
          </div>
          <WeeklyJackpotCard
            onEnterJackpot={onExplore}
            isMarketClosed={marketState.status === "CLOSED"}
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
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-violet-400" />
            <h3 className="text-sm font-semibold">Up/Down Markets</h3>
          </div>
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
              />
            )}
            emptyMessage="No up/down markets match your filters"
          />
        </div>
      )}

      {showH2H && filteredH2H.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-violet-400" />
            <h3 className="text-sm font-semibold">Head-to-Head</h3>
          </div>
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
              />
            )}
            emptyMessage="No head-to-head markets match your filters"
          />
        </div>
      )}

      {showGainer && filteredGainer.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-400" />
            <h3 className="text-sm font-semibold">Top Gainer Predictions</h3>
          </div>
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
