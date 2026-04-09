import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
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
import { getCanonicalNativeCycle } from "@/lib/nativeMarketLifecycle";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { PredictCard } from "@/components/predict/PredictCard";
import { WeeklyUpDownCard, type PredictionMarket } from "@/components/predict/WeeklyUpDownCard";
import { HeadToHeadCard, type HeadToHeadMarket } from "@/components/predict/HeadToHeadCard";
import { TopGainerCard, type TopGainerMarket, type GainerCandidate } from "@/components/predict/TopGainerCard";
import { OpenMarketCard } from "@/components/predict/OpenMarketCard";
import { WeeklyJackpotHero } from "@/components/predict/WeeklyJackpotHero";
import { RulesModal, RULES_CONTENT } from "@/components/predict/RulesContent";
import { useCategoryRaceMap } from "@/hooks/useCategoryRaceMap";
import { useLeaderboardCategories } from "@/hooks/useLeaderboardCategories";
import {
  Crown,
  Lock,
  TrendingUp,
  ChevronRight,
  Scale,
  Swords,
  Search,
  HelpCircle,
  Loader2,
  Trophy,
  Check,
} from "lucide-react";
import { UnifiedSectionHeader } from "@/components/UnifiedSectionHeader";
import { normalizeMarketCategory, getMarketCategoryLabel } from "@shared/constants";

interface PredictTabProps {
  personId: string;
  personName: string;
  personAvatar?: string;
  currentScore: number;
  personRank?: number | null;
}

/** Center 1–2 cards; use 3-column grid when there are 3+ cards. */
function predictSectionGridClass(n: number): { container: string; item: string } {
  if (n <= 0) return { container: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", item: "" };
  if (n === 1) return { container: "flex justify-center", item: "w-full max-w-sm" };
  if (n === 2) return { container: "flex flex-col sm:flex-row flex-wrap justify-center gap-4", item: "w-full max-w-sm" };
  return { container: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", item: "" };
}

type CategoryFilter = "all" | "favorites" | "trending" | "tech" | "politics" | "business" | "music" | "sports" | "film-tv" | "gaming" | "creator" | "food-drink" | "lifestyle" | "misc";

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
            <Trophy className="h-5 w-5 text-amber-700 dark:text-amber-500" />
            Category Race: {categoryLabel}
          </DialogTitle>
          <DialogDescription>
            Who will be the biggest mover this week?
          </DialogDescription>
        </DialogHeader>

        {isMarketClosed && (
          <div className="shrink-0 mx-4 mb-2 rounded-md bg-amber-500/15 dark:bg-amber-500/10 border border-amber-500/40 dark:border-amber-500/30 px-3 py-2 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-500 shrink-0" />
            <p className="text-xs text-amber-600 dark:text-amber-400">Entries closed Friday 23:59 UTC — Awaiting results Sunday</p>
          </div>
        )}

        <div className="shrink-0 px-4 pb-3 space-y-2">
          <div className="rounded-md bg-violet-500/8 dark:bg-violet-500/5 border border-violet-500/15 px-3 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">How it works:</strong> The winner is whoever has the highest <strong className="text-green-700 dark:text-green-500">% gain</strong> in their Trend Score by Sunday close &mdash; not the highest ranked person.
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
                      ? "border-violet-500/60 bg-violet-500/15 dark:bg-violet-500/10"
                      : isLeader
                        ? "border-amber-500/40 dark:border-amber-500/30 hover:bg-amber-500/8 dark:hover:bg-amber-500/8 dark:bg-amber-500/5"
                        : "border-transparent hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedCandidateKey(candidateKey)}
                >
                  <div className="w-6 shrink-0 text-center">
                    {isLeader ? (
                      <div className="inline-flex h-5 w-5 rounded-full bg-background/80 border border-amber-500/60 dark:border-amber-500/50 items-center justify-center">
                        <Crown className="h-3 w-3 text-amber-700 dark:text-amber-500" />
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-violet-700 dark:text-violet-500">#{candidate.rank || (idx + 1)}</span>
                    )}
                  </div>
                  <PersonAvatar name={candidate.name} avatar={candidate.avatar} size="sm" />
                  <span className="text-sm flex-1 truncate">{candidate.name}</span>
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-mono font-bold ${candidate.percentGain >= 0 ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-500"}`}>
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
  const actions = (
    <div className="flex items-center gap-2">
      {infoTooltip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300" aria-label="How it works">
              <HelpCircle className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="bg-popover dark:bg-slate-900/95 border-border dark:border-slate-700 text-popover-foreground dark:text-slate-200 text-xs max-w-xs">
            {infoTooltip}
          </TooltipContent>
        </Tooltip>
      )}
      {showViewAll && onViewAll && (
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onViewAll}
          className="text-violet-700 dark:text-violet-500 shrink-0"
          data-testid="button-view-all-community"
        >
          View all
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </div>
  );

  return (
    <UnifiedSectionHeader
      title={title}
      titleAddon={count !== undefined ? <Badge variant="secondary" className="text-xs">{count}</Badge> : undefined}
      subtitle={subtitle}
      icon={icon}
      accent="violet"
      actions={actions}
    />
  );
}

export function PredictTab({ personId, personName, personAvatar, currentScore, personRank }: PredictTabProps) {
  const [jackpotModalOpen, setJackpotModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState<string | null>(null);
  const [gainerPickerState, setGainerPickerState] = useState<{ market: TopGainerMarket; initialCandidate?: GainerCandidate | null } | null>(null);
  const [visibleWorldCount, setVisibleWorldCount] = useState(3);

  const { data: nativeUpdownData, isLoading: updownLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/updown'] });
  const { data: nativeH2hData, isLoading: h2hLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/h2h'] });
  const { data: nativeGainerData, isLoading: gainerLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/gainer'] });
  const { data: nativeJackpotData, isLoading: jackpotLoading } = useQuery<any[]>({ queryKey: ['/api/native-markets/jackpot'] });

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

  const openMarketsForPerson = useMemo(() => {
    return (openMarketsData || [])
      .filter((m: any) => m.visibility === "live")
      .filter((m: any) => m.personId === personId || (m.relatedPersonIds || []).includes(personId));
  }, [openMarketsData, personId]);

  const jackpotMarket = useMemo(() => {
    if (!nativeJackpotData) return null;
    return nativeJackpotData.find(
      (m: any) => m.personId === personId && m.status === "OPEN" && m.visibility === "live"
    ) || null;
  }, [nativeJackpotData, personId]);

  const hasAnyMarkets = weeklyMarket || h2hBattles.length > 0 || gainerMarkets.length > 0 || openMarketsForPerson.length > 0 || jackpotMarket;

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

  const openMarketBets = useMemo(() => {
    const map = new Map<string, { result: string; payout: number; entryLabel: string; stakeAmount: number; marketId: string }>();
    const betsArray = Array.isArray(userPredictionsData) ? userPredictionsData : (userPredictionsData as any)?.predictions ?? [];
    const grouped = new Map<string, any[]>();
    for (const b of betsArray) {
      const arr = grouped.get(b.marketId) || [];
      arr.push(b);
      grouped.set(b.marketId, arr);
    }
    grouped.forEach((bets, marketId) => {
      const totalStake = bets.reduce((s: number, b: any) => s + b.stakeAmount, 0);
      const totalPayout = bets.reduce((s: number, b: any) => s + (b.payout || 0), 0);
      const uniqueEntries = new Set(bets.map((b: any) => b.entryLabel));
      const entryLabel = uniqueEntries.size === 1 ? bets[0].entryLabel : "Multiple positions";
      const results = new Set(bets.map((b: any) => b.result));
      let result = "pending";
      if (results.has("won") && !results.has("lost")) result = "won";
      else if (results.has("lost") && !results.has("won")) result = "lost";
      else if (results.has("won") && results.has("lost")) result = "won";
      else if (results.has("refunded") && results.size === 1) result = "refunded";
      else result = bets[0].result;
      map.set(marketId, { result, payout: totalPayout, entryLabel, stakeAmount: totalStake, marketId });
    });
    return map;
  }, [userPredictionsData]);

  const categoryRaceMap = useCategoryRaceMap();
  const leaderboardCategories = useLeaderboardCategories();
  const handleCategoryFilter = (_category: string) => setLocation("/predict");

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
      endAt: serverResolutionDeadline ?? undefined,
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
      endAt: serverResolutionDeadline ?? undefined,
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
      endAt: serverResolutionDeadline ?? undefined,
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
        <Loader2 className="h-6 w-6 animate-spin text-violet-700 dark:text-violet-500" />
        <span className="ml-2 text-sm text-muted-foreground">Loading prediction markets...</span>
      </div>
    );
  }

  const worldCards = openMarketsForPerson.slice(0, visibleWorldCount);
  const worldGrid = predictSectionGridClass(worldCards.length);
  const h2hGrid = predictSectionGridClass(h2hBattles.length);
  const gainerGrid = predictSectionGridClass(gainerMarkets.length);

  return (
    <div className="space-y-6">
      {/* World Markets (Open Markets) */}
      {openMarketsForPerson.length > 0 && (
        <section>
          <SectionHeader
            icon={<Scale className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
            title="World Markets"
            subtitle="Predict the outcome of global events"
            count={openMarketsForPerson.length || undefined}
            infoTooltip="Prediction markets about real-world events involving this person"
          />
          <div className={worldGrid.container}>
            {worldCards.map((market: any) => (
              <div key={market.id} className={worldGrid.item}>
                <OpenMarketCard
                  market={market}
                  onNavigate={(slug, pick, direction) =>
                    setLocation(`/markets/${slug}${pick ? `?pick=${pick}${direction ? `&direction=${direction}` : ''}` : ''}`)
                  }
                  isMarketClosed={market.status !== "OPEN"}
                  userBetResult={openMarketBets.get(market.id)}
                  onFilterCategory={handleCategoryFilter}
                  categoryRaceMap={categoryRaceMap}
                  leaderboardCategories={leaderboardCategories}
                />
              </div>
            ))}
          </div>
          {openMarketsForPerson.length > visibleWorldCount && (
            <div className="flex justify-center mt-4">
              <Button variant="outline" size="sm" onClick={() => setVisibleWorldCount(c => c + 3)}>
                Load more
              </Button>
            </div>
          )}
        </section>
      )}

      <MarketCycleHero marketState={marketCycle} constrainedWidth />

      {/* Weekly Jackpot — same hero as main Predict page; static person row (no celebrity picker) */}
      <section data-testid="profile-jackpot-widget">
        {jackpotMarket ? (
          <WeeklyJackpotHero
            variant="profile"
            profilePerson={{
              id: personId,
              name: personName,
              avatar: personAvatar || "",
              rank: personRank,
            }}
            onEnterJackpot={() => setJackpotModalOpen(true)}
            marketStatus={marketCycle.status}
            timeRemaining={marketCycle.timeRemaining}
            jackpotMarket={jackpotMarket}
            onRulesClick={() => setRulesModalOpen("jackpot")}
          />
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
          icon={<TrendingUp className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
          title="Weekly Up / Down"
          subtitle="Will their trend score be higher / lower"
          infoTooltip="Predict whether their trend score finishes the week above or below the starting value"
        />
        {weeklyMarket ? (
          <WeeklyUpDownCard
            market={weeklyMarket}
            isMarketClosed={isMarketClosed}
            closedMessage={closedMarketMessage}
            onSelect={(choice) => handleUpDownSelect(weeklyMarket, choice)}
            onFilterCategory={handleCategoryFilter}
            categoryRaceMap={categoryRaceMap}
            leaderboardCategories={leaderboardCategories}
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
          icon={<Swords className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
          title="Head-to-Head Battles"
          subtitle="Who will gain more points"
          count={h2hBattles.length || undefined}
          infoTooltip="Face-off markets matching this person against another rival"
        />
        {h2hBattles.length > 0 ? (
          <div className={h2hGrid.container}>
            {h2hBattles.map((battle) => {
              const bet = userBetsByMarket.get(battle.id);
              const h2hUserPick = bet
                ? bet.entryLabel === battle.person1.name ? 1 as const
                : bet.entryLabel === battle.person2.name ? 2 as const
                : null
                : null;
              return (
                <div key={battle.id} className={h2hGrid.item}>
                  <HeadToHeadCard
                    market={battle}
                    isMarketClosed={isMarketClosed}
                    closedMessage={closedMarketMessage}
                    onSelect={(person) => handleH2HSelect(battle, person)}
                    userPick={h2hUserPick}
                    onFilterCategory={handleCategoryFilter}
                    categoryRaceMap={categoryRaceMap}
                    leaderboardCategories={leaderboardCategories}
                  />
                </div>
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
          icon={<Trophy className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
          title="Category Races"
          subtitle="Pick the biggest mover in each category"
          count={gainerMarkets.length || undefined}
          infoTooltip="The winner is whoever has the highest % gain in their Trend Score by Sunday close — not the highest ranked person."
        />
        {gainerMarkets.length > 0 ? (
          <div className={gainerGrid.container}>
            {gainerMarkets.map((gainer) => (
              <div key={gainer.id} className={gainerGrid.item}>
                <TopGainerCard
                  market={gainer}
                  isMarketClosed={isMarketClosed}
                  closedMessage={closedMarketMessage}
                  onShowAllCandidates={openGainerPicker}
                  isPredicted={userBetsByMarket.has(gainer.id)}
                  onFilterCategory={handleCategoryFilter}
                  categoryRaceMap={categoryRaceMap}
                  leaderboardCategories={leaderboardCategories}
                />
              </div>
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

      {rulesModalOpen && RULES_CONTENT[rulesModalOpen] && (
        <RulesModal
          open={!!rulesModalOpen}
          onClose={() => setRulesModalOpen(null)}
          title={RULES_CONTENT[rulesModalOpen].title}
          description={RULES_CONTENT[rulesModalOpen].description}
          steps={RULES_CONTENT[rulesModalOpen].steps}
        />
      )}
    </div>
  );
}
