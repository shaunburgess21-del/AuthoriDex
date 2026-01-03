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
  MessageSquare
} from "lucide-react";
import {
  MOCK_MARKETS,
  HEAD_TO_HEAD_MARKETS,
  CATEGORY_RACE_MARKETS,
  COMMUNITY_MARKETS,
  CATEGORY_FILTERS,
  type PredictionMarket,
  type HeadToHeadMarket,
  type CategoryRaceMarket,
  type CommunityMarket,
  type CategoryFilter,
} from "@/data/predict";

type PredictSection = "All" | "Weekly Jackpot" | "Up/Down" | "Head-to-Head" | "Category Races" | "Community";
const SECTION_TOGGLES: PredictSection[] = ["All", "Weekly Jackpot", "Up/Down", "Head-to-Head", "Category Races", "Community"];

interface PredictDeckViewProps {
  trendingPeople: TrendingPerson[];
  isLoading: boolean;
  onExplore: () => void;
}

interface StakeModalState {
  isOpen: boolean;
  type: 'updown' | 'h2h' | 'race' | 'community';
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
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-violet-500/20">
      <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-fuchsia-500/5 rounded-lg" />
      
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2">
            <PersonAvatar name={market.personName} avatar={market.personAvatar} size="md" />
            <div>
              <h3 className="font-semibold text-sm">{market.personName}</h3>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{market.endTime}</span>
              </div>
            </div>
          </div>
          <CategoryPill category={market.category} />
        </div>
        
        <div className="flex items-center justify-between mb-3 px-2 py-1.5 rounded-lg bg-slate-800/50">
          <span className="text-xs text-muted-foreground">7d trend</span>
          <span className={`text-sm font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
            {isUp ? '+' : ''}{market.change7d.toFixed(2)}%
          </span>
        </div>
        
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <Users className="h-3 w-3" />
          <span>{market.totalPool.toLocaleString()} credits staked</span>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="border-green-500/30 text-green-400 hover:bg-green-500/10"
            onClick={() => onPredict(market.id, 'up', market.personName, market.upMultiplier)}
            data-testid={`button-predict-up-${market.id}`}
          >
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Up {market.upMultiplier.toFixed(1)}x
          </Button>
          <Button
            variant="outline"
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            onClick={() => onPredict(market.id, 'down', market.personName, market.downMultiplier)}
            data-testid={`button-predict-down-${market.id}`}
          >
            <TrendingDown className="h-4 w-4 mr-1.5" />
            Down {market.downMultiplier.toFixed(1)}x
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
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-violet-500/20">
      <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-fuchsia-500/5 rounded-lg" />
      
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <span className="text-sm font-semibold">{market.title}</span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{market.endTime}</span>
            </div>
            <CategoryPill category={market.category} />
          </div>
        </div>
        
        <div className="flex items-stretch gap-3">
          <button
            onClick={() => onPredict(market.id, 'person1', market.person1.name)}
            className="flex-1 rounded-lg border border-violet-500/30 bg-slate-800/50 p-3 hover:border-violet-500/50 transition-all cursor-pointer"
            data-testid={`button-h2h-p1-${market.id}`}
          >
            <div className="flex flex-col items-center gap-2">
              <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} size="md" />
              <span className="font-medium text-sm text-center">{market.person1.name}</span>
              <Badge variant="outline" className="bg-violet-500/10 text-violet-300 border-violet-400/30 text-xs">
                {market.person1Percent}%
              </Badge>
            </div>
          </button>
          
          <div className="flex items-center justify-center w-10 shrink-0">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg">
              <Swords className="h-4 w-4 text-white" />
            </div>
          </div>
          
          <button
            onClick={() => onPredict(market.id, 'person2', market.person2.name)}
            className="flex-1 rounded-lg border border-fuchsia-500/30 bg-slate-800/50 p-3 hover:border-fuchsia-500/50 transition-all cursor-pointer"
            data-testid={`button-h2h-p2-${market.id}`}
          >
            <div className="flex flex-col items-center gap-2">
              <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} size="md" />
              <span className="font-medium text-sm text-center">{market.person2.name}</span>
              <Badge variant="outline" className="bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-400/30 text-xs">
                {100 - market.person1Percent}%
              </Badge>
            </div>
          </button>
        </div>
        
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3 justify-center">
          <Users className="h-3 w-3" />
          <span>{market.totalPool.toLocaleString()} credits staked</span>
        </div>
      </div>
    </Card>
  );
}

function RaceCard({
  race,
  onPredict,
}: {
  race: CategoryRaceMarket;
  onPredict: (raceId: string, runnerName: string) => void;
}) {
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-violet-500/20">
      <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-amber-500/5 rounded-lg" />
      
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold">{race.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {race.timeRemaining}
            </Badge>
            <CategoryPill category={race.category} />
          </div>
        </div>
        
        <div className="space-y-2">
          {race.runners.slice(0, 4).map((runner, idx) => (
            <button
              key={runner.name}
              onClick={() => onPredict(race.id, runner.name)}
              className="w-full flex items-center gap-2 p-2 rounded-lg bg-slate-800/50 border border-slate-700/30 hover:border-violet-500/40 transition-all cursor-pointer"
              data-testid={`button-race-${race.id}-${idx}`}
            >
              <span className="text-xs font-mono text-muted-foreground w-4">{idx + 1}</span>
              <PersonAvatar name={runner.name} avatar={runner.avatar} size="sm" />
              <span className="flex-1 text-left text-sm font-medium truncate">{runner.name}</span>
              <Badge variant="outline" className="text-xs bg-slate-700/30">
                {runner.marketShare}%
              </Badge>
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3 justify-center">
          <Users className="h-3 w-3" />
          <span>{race.totalPool.toLocaleString()} credits staked</span>
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
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-violet-500/20">
      <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-cyan-500/5 rounded-lg" />
      
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>by {market.creatorName}</span>
          </div>
          <CategoryPill category={market.category} />
        </div>
        
        <h3 className="font-semibold text-base mb-4">{market.question}</h3>
        
        <div className="flex gap-2">
          {market.options.map((option) => (
            <Button
              key={option.id}
              variant="outline"
              className="flex-1 border-violet-500/30 hover:bg-violet-500/10"
              onClick={() => onPredict(market.id, option.id, option.text)}
              data-testid={`button-community-${market.id}-${option.id}`}
            >
              {option.text}
              <Badge variant="outline" className="ml-2 text-xs">{option.percent}%</Badge>
            </Button>
          ))}
        </div>
        
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3" />
            <span>{market.totalPool.toLocaleString()} credits</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            <span>{market.endTime}</span>
          </div>
        </div>
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
            {state.type === 'race' && `Backing ${state.personName} to top the race`}
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
  const [raceInteracted, setRaceInteracted] = useState(false);
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

  const filteredRaces = useMemo(() =>
    CATEGORY_RACE_MARKETS.filter(r => {
      const matchesCategory = categoryFilter === "all" || r.category === categoryFilter;
      const matchesSearch = !searchQuery || r.title.toLowerCase().includes(searchQuery.toLowerCase());
      const notPredicted = !predictions.has(r.id);
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

  const handleRacePredict = useCallback((raceId: string, runnerName: string) => {
    setStakeModal({
      isOpen: true,
      type: 'race',
      marketId: raceId,
      selection: runnerName,
      personName: runnerName,
      onConfirm: () => {
        setPendingPrediction(raceId);
        setRaceInteracted(true);
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

  const closeStakeModal = () => {
    setStakeModal(null);
    pendingCycleCallbackRef.current = null;
  };

  const showJackpot = activeSection === "All" || activeSection === "Weekly Jackpot";
  const showUpDown = activeSection === "All" || activeSection === "Up/Down";
  const showH2H = activeSection === "All" || activeSection === "Head-to-Head";
  const showRaces = activeSection === "All" || activeSection === "Category Races";
  const showCommunity = activeSection === "All" || activeSection === "Community";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-2xl mx-auto space-y-4"
    >
      <MarketCycleHero marketState={marketState} />
      
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
            {section === "Weekly Jackpot" && <Trophy className="h-3 w-3" />}
            {section === "Up/Down" && <TrendingUp className="h-3 w-3" />}
            {section === "Head-to-Head" && <Swords className="h-3 w-3" />}
            {section === "Category Races" && <Trophy className="h-3 w-3" />}
            {section === "Community" && <MessageSquare className="h-3 w-3" />}
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
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategoryFilter(cat.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              categoryFilter === cat.id
                ? 'bg-violet-500/20 text-violet-300 border border-violet-400/40'
                : 'bg-muted/30 border border-border/50 text-muted-foreground hover:bg-muted/50'
            }`}
            data-testid={`chip-predict-category-${cat.id}`}
          >
            {cat.label}
          </button>
        ))}
      </div>

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

      {showRaces && filteredRaces.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold">Category Races</h3>
          </div>
          <CardDeckContainer
            items={filteredRaces}
            viewType="predict"
            hasInteracted={raceInteracted}
            onAdvance={() => {
              if (pendingPrediction) {
                setPredictions(prev => new Set(prev).add(pendingPrediction));
                setPendingPrediction(null);
              }
              setRaceInteracted(false);
            }}
            renderCard={(race) => (
              <RaceCard
                race={race}
                onPredict={(id, name) => handleRacePredict(id, name)}
              />
            )}
            emptyMessage="No category races match your filters"
          />
        </div>
      )}

      {showCommunity && filteredCommunity.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold">Community Markets</h3>
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
            emptyMessage="No community markets match your filters"
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
