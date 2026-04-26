import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import type { MarketStatus } from "@/hooks/useMarketCycle";
import { TrendingPerson } from "@shared/schema";
import {
  Crown,
  HelpCircle,
  Clock,
  Lock,
  Search,
  ChevronDown,
  TicketCheck,
  Trophy,
} from "lucide-react";

function CelebritySearchModal({
  open,
  onOpenChange,
  trendingPeople,
  selectedPerson,
  onSelectPerson,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trendingPeople: TrendingPerson[];
  selectedPerson: TrendingPerson | null;
  onSelectPerson: (person: TrendingPerson) => void;
  isLoading: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPeople = (trendingPeople || []).filter((person) =>
    person.name.toLowerCase().includes(searchQuery.toLowerCase()),
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
          <DialogDescription>Choose who you want to predict for the Weekly Jackpot</DialogDescription>
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
                  type="button"
                  onClick={() => handleSelectPerson(person)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors ${
                    selectedPerson?.id === person.id
                      ? "bg-amber-500/15 dark:bg-amber-500/10 border border-amber-500/40 dark:border-amber-500/30"
                      : ""
                  }`}
                  data-testid={`modal-option-person-${person.id}`}
                >
                  <PersonAvatar name={person.name} avatar={person.avatar || ""} size="sm" />
                  <div className="flex-1 text-left">
                    <p className="font-medium text-sm">{person.name}</p>
                    <p className="text-xs text-muted-foreground">{person.rank ? `Rank #${person.rank}` : "New"}</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">
                    {Math.round(person.trendScore).toLocaleString("en-US")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type WeeklyJackpotProfilePerson = {
  id: string;
  name: string;
  avatar: string;
  rank?: number | null;
};

type BrowseProps = {
  variant?: "browse";
  trendingPeople: TrendingPerson[];
  selectedPerson: TrendingPerson | null;
  onSelectPerson: (person: TrendingPerson) => void;
  isLoading: boolean;
};

type ProfileProps = {
  variant: "profile";
  profilePerson: WeeklyJackpotProfilePerson;
};

export type WeeklyJackpotHeroProps = {
  onEnterJackpot: () => void;
  marketStatus: MarketStatus;
  timeRemaining: { days: number; hours: number; minutes: number; seconds: number };
  jackpotMarket: any | null;
  onRulesClick: () => void;
} & (BrowseProps | ProfileProps);

export function WeeklyJackpotHero(props: WeeklyJackpotHeroProps) {
  const {
    onEnterJackpot,
    marketStatus,
    timeRemaining,
    jackpotMarket,
    onRulesClick,
  } = props;

  const isProfile = props.variant === "profile";
  const profilePerson = isProfile ? props.profilePerson : null;
  const trendingPeople = !isProfile ? props.trendingPeople : [];
  const selectedPerson = !isProfile ? props.selectedPerson : null;
  const onSelectPerson = !isProfile ? props.onSelectPerson : () => {};
  const isLoadingPeople = !isProfile ? props.isLoading : false;

  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const { session, loading: authLoading } = useAuth();
  const marketId = jackpotMarket?.id ?? null;
  const isAuthReady = !!session?.access_token && !authLoading;

  const personIdForLastWinner = isProfile ? profilePerson!.id : selectedPerson?.id ?? null;

  const { data: userJackpotEntriesData } = useQuery({
    queryKey: ["/api/native-markets", marketId, "jackpot-entries", session?.access_token],
    queryFn: async () => {
      if (!marketId) return { entries: [] };
      const sb = await getSupabase();
      const {
        data: { session: currentSession },
      } = await sb.auth.getSession();
      const headers: Record<string, string> = {};
      if (currentSession?.access_token) headers["Authorization"] = `Bearer ${currentSession.access_token}`;
      const res = await fetch(`/api/native-markets/${marketId}/jackpot-entries`, { headers, credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load entries: ${res.status}`);
      return res.json();
    },
    enabled: !!marketId && isAuthReady,
    staleTime: 30_000,
  });

  const myJackpotEntryCount = userJackpotEntriesData?.entries?.length ?? 0;

  const { data: lastWinnerData } = useQuery({
    queryKey: ["/api/native-markets/jackpot-last-winner", personIdForLastWinner],
    queryFn: async () => {
      if (!personIdForLastWinner) return { hasResult: false };
      const res = await fetch(`/api/native-markets/jackpot-last-winner/${personIdForLastWinner}`);
      return res.json();
    },
    enabled: !!personIdForLastWinner,
    staleTime: 5 * 60 * 1000,
  });

  const poolSize = useMemo(() => {
    if (!jackpotMarket) return 0;
    const entries = jackpotMarket.entries || [];
    return entries.reduce((sum: number, e: any) => sum + (e.totalStake || 0), 0);
  }, [jackpotMarket]);

  const entryCount = jackpotMarket?.totalBets || jackpotMarket?.activeParticipantCount || 0;

  const timerLabel = marketStatus === "ENTRIES_CLOSED" ? "Results In" : "Time Remaining";

  const canEnter = isProfile ? !!profilePerson : !!selectedPerson;

  const renderCTA = () => {
    if (marketStatus === "RESOLVED") {
      return (
        <Button size="lg" className="bg-muted text-muted-foreground cursor-not-allowed" disabled>
          <Lock className="h-5 w-5 mr-2" />
          Market Resolved
        </Button>
      );
    }
    if (marketStatus === "ENTRIES_CLOSED") {
      return (
        <Button size="lg" className="bg-muted text-muted-foreground cursor-not-allowed" disabled>
          <Clock className="h-5 w-5 mr-2" />
          Entries Closed — Results Sunday
        </Button>
      );
    }
    return (
      <Button
        size="lg"
        className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30"
        onClick={onEnterJackpot}
        disabled={!canEnter}
        data-testid={isProfile ? "button-profile-predict-score" : "button-enter-jackpot"}
      >
        <Crown className="h-5 w-5 mr-2" />
        Enter Jackpot — 100 Credits
      </Button>
    );
  };

  const personRow = isProfile && profilePerson ? (
    <div
      className="w-full max-w-md flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-amber-500/50 dark:border-amber-500/40 bg-background/80 backdrop-blur-sm"
      data-testid="profile-jackpot-person-static"
    >
      <div className="flex items-center gap-3 min-w-0">
        <PersonAvatar name={profilePerson.name} avatar={profilePerson.avatar || ""} size="sm" />
        <div className="text-left min-w-0">
          <p className="font-semibold truncate">{profilePerson.name}</p>
          <p className="text-xs text-muted-foreground">
            {profilePerson.rank != null ? `Rank #${profilePerson.rank}` : "New"}
          </p>
        </div>
      </div>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setSearchModalOpen(true)}
      className="w-full max-w-md flex items-center justify-between gap-2 px-4 py-3 rounded-lg border-2 border-amber-500/50 dark:border-amber-500/40 bg-background/80 backdrop-blur-sm hover:border-amber-500/70 dark:hover:border-amber-500/60 transition-colors"
      data-testid="dropdown-jackpot-person"
    >
      <div className="flex items-center gap-3">
        {selectedPerson ? (
          <>
            <PersonAvatar name={selectedPerson.name} avatar={selectedPerson.avatar || ""} size="sm" />
            <div className="text-left">
              <p className="font-semibold">{selectedPerson.name}</p>
              <p className="text-xs text-muted-foreground">{selectedPerson.rank ? `Rank #${selectedPerson.rank}` : "New"}</p>
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">{isLoadingPeople ? "Loading..." : "Select a celebrity"}</span>
        )}
      </div>
      <ChevronDown className="h-5 w-5 text-amber-500 shrink-0" />
    </button>
  );

  return (
    <div
      className="relative overflow-hidden rounded-2xl mb-8 border-2 border-amber-500/60 dark:border-amber-500/50 jackpot-hero-bg"
      data-testid="weekly-jackpot-hero"
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl" />
      <div className="relative z-10 p-6 md:p-8">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="h-6 w-6 text-amber-500" />
              <Badge className="bg-amber-500/25 dark:bg-amber-500/20 text-amber-700 dark:text-amber-500 border-amber-500/50 dark:border-amber-500/40">
                WEEKLY JACKPOT
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-amber-500/60 hover:text-amber-500"
                    onClick={onRulesClick}
                    aria-label="How the Jackpot works"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>How it works</TooltipContent>
              </Tooltip>
            </div>

            <div className="mb-4">{personRow}</div>

            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto lg:mx-0">Predict the exact Trend Score. Closest wins the jackpot!</p>

            {renderCTA()}
            {myJackpotEntryCount > 0 && (
              <p
                className="mt-3 flex items-start gap-2 text-xs text-muted-foreground max-w-md"
                data-testid="text-jackpot-user-entered-hint"
              >
                <TicketCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600/80 dark:text-amber-400/80" aria-hidden />
                <span>
                  You&apos;re in with {myJackpotEntryCount} prediction{myJackpotEntryCount !== 1 ? "s" : ""} this week — Enter
                  again to add another.
                </span>
              </p>
            )}
          </div>

          <div className="flex w-full flex-col items-start gap-3 lg:w-auto lg:items-end">
            {marketStatus !== "RESOLVED" && (
              <div className="flex w-full flex-col items-start gap-1 lg:items-end lg:gap-2">
                <p className="shrink-0 text-xs text-muted-foreground lg:text-right">{timerLabel}</p>
                <div className="flex gap-2 lg:justify-end">
                  {[
                    { value: timeRemaining.days, label: "d" },
                    { value: timeRemaining.hours, label: "h" },
                    { value: timeRemaining.minutes, label: "m" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-baseline gap-0.5">
                      <span className="font-mono text-2xl font-bold text-amber-500">{item.value}</span>
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex w-full flex-col items-start gap-1 lg:items-end">
              <p className="text-sm font-semibold text-amber-500 lg:text-right">
                Pool: {poolSize > 0 ? poolSize.toLocaleString() : "0"} credits
              </p>
              {entryCount > 0 && (
                <p className="text-xs text-muted-foreground lg:text-right">
                  {entryCount} {entryCount === 1 ? "entry" : "entries"}
                </p>
              )}
            </div>
          </div>
        </div>
        {lastWinnerData?.hasResult && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/8 dark:bg-amber-500/5 border border-amber-500/20 mb-2">
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">
              <Trophy className="h-3 w-3 inline mr-1" />
              Last week&apos;s result
            </p>
            <p className="text-sm">
              {lastWinnerData.winnerUsername ? (
                <>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">@{lastWinnerData.winnerUsername}</span>
                  {" guessed "}
                  <span className="font-bold">{Number(lastWinnerData.winningPrediction).toLocaleString()}</span>
                  {" (actual: "}
                  <span className="font-bold">{Number(lastWinnerData.actualScore).toLocaleString()}</span>
                  {lastWinnerData.margin === 0 ? " — EXACT match!" : `, off by ${Number(lastWinnerData.margin).toLocaleString()}`}
                  {") and won "}
                  <span className="font-bold text-amber-600 dark:text-amber-400">{Number(lastWinnerData.payout).toLocaleString()} credits</span>
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
      {!isProfile && (
        <CelebritySearchModal
          open={searchModalOpen}
          onOpenChange={setSearchModalOpen}
          trendingPeople={trendingPeople}
          selectedPerson={selectedPerson}
          onSelectPerson={onSelectPerson}
          isLoading={isLoadingPeople}
        />
      )}
    </div>
  );
}
