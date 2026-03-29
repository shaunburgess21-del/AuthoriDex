import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { JackpotEntryModal } from "@/components/JackpotEntryModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { MarketCycleHero } from "@/components/MarketCycleHero";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatSignedPercent, formatSignedPoints } from "@/lib/predict-display";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { WeeklyUpDownActionButtons } from "@/components/predict/WeeklyUpDownActionButtons";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { 
  Crown, 
  Sparkles, 
  Lock, 
  TrendingUp,
  Clock, 
  ChevronRight, 
  Users, 
  UserPlus, 
  BarChart3,
  Swords,
  Search,
  HelpCircle,
  Loader2,
  Trophy,
  Check
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ViewAllOverlayHeader } from "@/components/ViewAllOverlayHeader";
import { normalizeMarketCategory, getMarketCategoryLabel } from "@shared/constants";

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
  upEntryId?: string;
  downEntryId?: string;
  startAt?: string;
  endAt?: string;
  tieRule?: string;
}

interface HeadToHeadMarket {
  id: string;
  title: string;
  person1: { name: string; avatar: string; currentScore: number };
  person2: { name: string; avatar: string; currentScore: number };
  person1Id?: string;
  person2Id?: string;
  person1EntryId: string;
  person2EntryId: string;
  category: CategoryFilter;
  endTime: string;
  totalPool: number;
  person1Percent: number;
}

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

function smartName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  if (fullName.length <= 14) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
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
      className={`relative group overflow-visible ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      data-testid={testId}
    >
      <Card className={`relative p-4 bg-card/95 backdrop-blur-sm transition-all ring-inset ring-1 ring-transparent group-hover:ring-[#EFEFEF]/50 group-hover:shadow-lg group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] ${selected ? 'ring-[#EFEFEF]/50 shadow-lg shadow-[0_8px_32px_rgba(239,239,239,0.14)]' : ''} ${className}`}>
        {children}
      </Card>
    </div>
  );
}

function WeeklyUpDownCard({ 
  market, 
  isMarketClosed = false,
  closedMessage,
  onSelect
}: { 
  market: PredictionMarket; 
  isMarketClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: (choice: "up" | "down") => void;
}) {
  const delta = market.currentScore - market.baselineScore;
  const pctDelta = market.baselineScore > 0 ? ((delta / market.baselineScore) * 100).toFixed(1) : "0";

  return (
    <PredictCard testId={`card-weekly-${market.id}`} className={isMarketClosed ? 'opacity-75' : ''}>
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
          <Badge 
            variant="outline" 
            className={delta >= 0 ? "text-green-500 border-green-500/30 shrink-0" : "text-red-500 border-red-500/30 shrink-0"}
          >
            {delta >= 0 ? "+" : ""}{pctDelta}%
          </Badge>
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

      <div className="h-2.5 rounded-full bg-red-500/20 overflow-hidden mb-1.5">
        <div 
          className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all"
          style={{ width: `${market.upPoolPercent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] mb-2">
        <span className="text-green-500 font-semibold">Up {market.upMultiplier}x</span>
        <span className="text-red-500 font-semibold">Down {market.downMultiplier}x</span>
      </div>
      
      <WeeklyUpDownActionButtons
        marketId={market.id}
        isMarketClosed={!!isMarketClosed}
        closedMessage={closedMessage}
        onSelect={onSelect}
      />
    </PredictCard>
  );
}

function HeadToHeadCard({ 
  market, 
  isMarketClosed = false,
  closedMessage,
  onSelect,
  userPick,
}: { 
  market: HeadToHeadMarket; 
  isMarketClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: (person: 1 | 2) => void;
  userPick?: 1 | 2 | null;
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
          <CategoryPill category={market.category} />
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
          <ClosedMarketActionTrigger isClosed={isMarketClosed && !hasPicked} message={closedMessage} side="top" align="center">
            <div
              className={`flex flex-col items-center flex-1 ${!hasPicked ? 'cursor-pointer hover:opacity-80' : ''} transition-opacity`}
              onClick={() => !hasPicked && onSelect?.(1)}
            >
              <p className="text-sm font-semibold text-center">{smartName(market.person1.name)}</p>
              <span className="text-[10px] font-mono text-muted-foreground">{market.person1.currentScore?.toLocaleString('en-US') || ''}</span>
              <span className="text-xs text-blue-400 font-semibold">{market.person1Percent}%</span>
            </div>
          </ClosedMarketActionTrigger>
          <ClosedMarketActionTrigger isClosed={isMarketClosed && !hasPicked} message={closedMessage} side="top" align="center">
            <div
              className={`flex flex-col items-center flex-1 ${!hasPicked ? 'cursor-pointer hover:opacity-80' : ''} transition-opacity`}
              onClick={() => !hasPicked && onSelect?.(2)}
            >
              <p className="text-sm font-semibold text-center">{smartName(market.person2.name)}</p>
              <span className="text-[10px] font-mono text-muted-foreground">{market.person2.currentScore?.toLocaleString('en-US') || ''}</span>
              <span className="text-xs text-purple-400 font-semibold">{100 - market.person1Percent}%</span>
            </div>
          </ClosedMarketActionTrigger>
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
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
                <Button 
                  className="bg-[#3B82F6]/10 border border-[#3B82F6]/50 text-[#3B82F6] hover:border-[#3B82F6]/80 hover:bg-[#3B82F6]/20 py-3 md:py-2 h-auto"
                  onClick={() => onSelect?.(1)}
                  data-testid={`button-pick1-${market.id}`}
                >
                  {smartName(market.person1.name)}
                </Button>
              </ClosedMarketActionTrigger>
              <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
                <Button 
                  className="bg-[#7C3AED]/10 border border-[#7C3AED]/50 text-[#7C3AED] hover:border-[#7C3AED]/80 hover:bg-[#7C3AED]/20 py-3 md:py-2 h-auto"
                  onClick={() => onSelect?.(2)}
                  data-testid={`button-pick2-${market.id}`}
                >
                  {smartName(market.person2.name)}
                </Button>
              </ClosedMarketActionTrigger>
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
  closedMessage,
  onShowAllCandidates,
}: { 
  market: TopGainerMarket; 
  isMarketClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onShowAllCandidates?: (market: TopGainerMarket, initialCandidate?: GainerCandidate) => void;
}) {
  const visibleCandidateCount = market.candidateCount ?? market.allCandidates?.length ?? market.totalEntries ?? market.leaders.length;
  const canPick = true;

  return (
    <PredictCard testId={`card-gainer-${market.id}`} className={`${isMarketClosed ? 'opacity-75' : ''}`}>
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
        <CategoryPill category={market.category} />
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
        <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
          <Button 
            className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-3 md:py-2 h-auto"
            data-testid={`button-place-prediction-${market.id}`}
            onClick={() => onShowAllCandidates?.(market)}
          >
            Choose Candidate
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </ClosedMarketActionTrigger>
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
          <div className="shrink-0 mx-4 mb-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-400">Entries closed Friday 23:59 UTC — Awaiting results Sunday</p>
          </div>
        )}

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
            {candidates.length} candidates {isMarketClosed ? "" : "\u00b7 Tap to pick, then continue"}
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
          <ViewAllOverlayHeader
            onClose={onClose}
            closeTestId="button-close-community-overlay"
            backTestId="button-back-community-overlay"
            className="flex items-center justify-between gap-2 mb-4"
          >
            <div className="min-w-0">
              <h2 className="text-lg font-serif font-bold truncate">World Predictions</h2>
              <p className="text-sm text-muted-foreground">{filteredMarkets.length} predictions about {personName}</p>
            </div>
          </ViewAllOverlayHeader>
          
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
  const [jackpotModalOpen, setJackpotModalOpen] = useState(false);
  const [showCommunityOverlay, setShowCommunityOverlay] = useState(false);
  const [gainerPickerState, setGainerPickerState] = useState<{ market: TopGainerMarket; initialCandidate?: GainerCandidate | null } | null>(null);

  const { data: nativeUpdownData, isLoading: updownLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/updown'] });
  const { data: nativeH2hData, isLoading: h2hLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/h2h'] });
  const { data: nativeGainerData, isLoading: gainerLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/gainer'] });
  const { data: nativeJackpotData, isLoading: jackpotLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/jackpot'] });

  const { serverBettingCutoff, serverResolutionDeadline } = useMemo(() => {
    const allNative = [...(nativeUpdownData || []), ...(nativeH2hData || []), ...(nativeGainerData || [])];
    const cutoffs = allNative.map((m: any) => m.bettingCutoff).filter(Boolean) as string[];
    const endAts = allNative.map((m: any) => m.endAt).filter(Boolean).map((d: string) => typeof d === "string" ? d : new Date(d).toISOString());
    cutoffs.sort();
    endAts.sort();
    return {
      serverBettingCutoff: cutoffs[0] || null,
      serverResolutionDeadline: endAts[0] || null,
    };
  }, [nativeUpdownData, nativeH2hData, nativeGainerData]);

  const marketCycle = useMarketCycle({ bettingCutoff: serverBettingCutoff, resolutionDeadline: serverResolutionDeadline });
  const isMarketClosed = marketCycle.status !== "OPEN";
  const closedMarketMessage = useMemo(() => {
    return getClosedMarketMessage({
      bettingCutoff: serverBettingCutoff,
      resolutionDeadline: serverResolutionDeadline,
    });
  }, [serverBettingCutoff, serverResolutionDeadline]);
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
      upEntryId: upEntry?.id,
      downEntryId: downEntry?.id,
      startAt: m.startAt,
      endAt: m.endAt,
      tieRule: m.metadata?.tieRule ?? "refund",
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
        person1EntryId: e1.id,
        person2EntryId: e2.id,
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
        totalEntries: entries.length,
        candidateCount: allCandidates.length,
      };
    });
    return all.filter(g => (g.allCandidates || g.leaders).some(l => l.personId === personId));
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

  const { user, profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const walletCredits = profile?.predictCredits ?? 0;

  const { data: userPredictionsData } = useQuery<any>({
    queryKey: ["/api/me/predictions"],
    enabled: !!user,
  });

  const userBetsByMarket = useMemo(() => {
    const map = new Map<string, { entryLabel: string; entryId?: string }>();
    const betsArray = Array.isArray(userPredictionsData)
      ? userPredictionsData
      : (userPredictionsData as any)?.predictions ?? [];
    for (const b of betsArray) {
      if (b.marketId && !map.has(b.marketId)) {
        map.set(b.marketId, { entryLabel: b.entryLabel, entryId: b.entryId });
      }
    }
    return map;
  }, [userPredictionsData]);

  const updownBetMutation = useMutation({
    mutationFn: async ({ marketId, entryId, stakeAmount }: { marketId: string; entryId: string; stakeAmount: number }) => {
      const res = await apiRequest("POST", `/api/native-markets/updown/${marketId}/bet`, { entryId, stakeAmount });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Prediction placed!", description: "Your weekly up/down prediction has been recorded." });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile?.(),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/updown"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: () => {
      toast({ title: "Failed to place prediction", variant: "destructive" });
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
        description: variables.marketType === "h2h" ? "Your head-to-head prediction has been recorded." : "Your prediction has been recorded.",
      });
      setStakeModalOpen(false);
      setPendingSelection(null);
      await Promise.all([
        refreshProfile?.(),
        queryClient.invalidateQueries({ queryKey: [`/api/native-markets/${variables.marketType}`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
    },
    onError: () => {
      toast({ title: "Failed to place prediction", variant: "destructive" });
    },
  });

  const handleUpDownSelect = (market: PredictionMarket, choice: "up" | "down") => {
    if (isMarketClosed) {
      return;
    }
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to place predictions." });
      setLocation("/login");
      return;
    }
    const entryId = choice === "up" ? market.upEntryId : market.downEntryId;
    if (!entryId) {
      toast({ title: "Market unavailable", description: "This market is missing required entries. Please try another market.", variant: "destructive" });
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
      tieRule: market.tieRule ?? "refund",
      endAt: market.endAt,
      bettingCutoff: serverBettingCutoff,
    });
    setStakeModalOpen(true);
  };

  const handleH2HSelect = (market: HeadToHeadMarket, person: 1 | 2) => {
    if (isMarketClosed) {
      return;
    }
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
      bettingCutoff: serverBettingCutoff,
    });
    setStakeModalOpen(true);
  };

  const handleGainerSelect = (market: TopGainerMarket, candidate: GainerCandidate) => {
    if (isMarketClosed) {
      return;
    }
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
      candidateRank: candidate.rank,
      candidatePercentGain: candidate.percentGain,
      candidatePointsAdded: candidate.currentGain,
      bettingCutoff: serverBettingCutoff,
    });
    setStakeModalOpen(true);
  };

  const openGainerPicker = (market: TopGainerMarket, initialCandidate?: GainerCandidate | null) => {
    if (isMarketClosed) {
      return;
    }
    setGainerPickerState({ market, initialCandidate });
  };

  const handleConfirmStake = (amount: number) => {
    if (!pendingSelection || !pendingSelection.marketId) {
      setStakeModalOpen(false);
      setPendingSelection(null);
      return;
    }
    if (pendingSelection.type === "gainer" && pendingSelection.entryId) {
      nativeMarketBetMutation.mutate({
        marketId: pendingSelection.marketId,
        entryId: pendingSelection.entryId,
        stakeAmount: amount,
        marketType: "gainer",
      });
      return;
    }
    if (pendingSelection.type === "h2h" && pendingSelection.entryId) {
      nativeMarketBetMutation.mutate({
        marketId: pendingSelection.marketId,
        entryId: pendingSelection.entryId,
        stakeAmount: amount,
        marketType: "h2h",
      });
      return;
    }
    if (pendingSelection.type === "updown") {
      const entryId = pendingSelection.choice.toUpperCase().includes("UP") ? weeklyMarket?.upEntryId : weeklyMarket?.downEntryId;
      if (!entryId) {
        toast({ title: "Market unavailable", description: "Missing entry. Please try again.", variant: "destructive" });
        setStakeModalOpen(false);
        setPendingSelection(null);
        return;
      }
      updownBetMutation.mutate({
        marketId: pendingSelection.marketId,
        entryId,
        stakeAmount: amount,
      });
    }
  };

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

      {/* Sticky weekly countdown timer — constrained to same width as profile toggles / page container */}
      <MarketCycleHero marketState={marketCycle} constrainedWidth />

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
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {marketCycle.status === "ENTRIES_CLOSED" ? "Results In" : "Entries Close In"}
              </p>
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
              <Clock className="h-4 w-4 mr-2" />
              Entries Closed — Results Sunday
            </Button>
          ) : (
            <Button 
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30"
              onClick={() => setJackpotModalOpen(true)}
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

      <JackpotEntryModal
        open={jackpotModalOpen}
        onClose={() => setJackpotModalOpen(false)}
        person={{ id: personId, name: personName, avatar: personAvatar || "", trendScore: currentScore } as any}
        marketId={jackpotMarket?.id || null}
        userCredits={walletCredits}
        bettingCutoff={jackpotMarket?.bettingCutoff || null}
        isCutoffPassed={jackpotMarket?.isCutoffPassed || false}
      />
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
          <WeeklyUpDownCard
            market={weeklyMarket}
            isMarketClosed={isMarketClosed}
            closedMessage={closedMarketMessage}
            onSelect={(choice) => handleUpDownSelect(weeklyMarket, choice)}
          />
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
            {h2hBattles.map((battle) => {
              const bet = userBetsByMarket.get(battle.id);
              const h2hUserPick = bet
                ? bet.entryLabel === battle.person1.name ? 1 as const
                : bet.entryLabel === battle.person2.name ? 2 as const
                : null
                : null;
              return (
                <HeadToHeadCard
                  key={battle.id}
                  market={battle}
                  isMarketClosed={isMarketClosed}
                  closedMessage={closedMarketMessage}
                  onSelect={(person) => handleH2HSelect(battle, person)}
                  userPick={h2hUserPick}
                />
              );
            })}
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
                isMarketClosed={isMarketClosed}
                closedMessage={closedMarketMessage}
                onShowAllCandidates={openGainerPicker}
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

      <StakeModal
        open={stakeModalOpen}
        onClose={() => { setStakeModalOpen(false); setPendingSelection(null); }}
        selection={pendingSelection}
        onConfirm={handleConfirmStake}
        walletBalance={walletCredits}
      />
    </div>
  );
}
