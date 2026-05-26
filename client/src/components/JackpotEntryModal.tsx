import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";
import { Crown, Check, X, Loader2, Lock, TicketCheck, HelpCircle, Wallet } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RULES_CONTENT, RulesExplainer } from "@/components/predict/RulesContent";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { getClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { useIsMobile } from "@/hooks/use-mobile";
import { useXpBurst } from "@/components/XpBurstProvider";
import { ChevronDown } from "lucide-react";
import type { TrendingPerson } from "@shared/schema";
import { formatVox } from "@/lib/currency";

interface JackpotEntry {
  betId: string;
  predictedScore: number;
  placedAt: string;
}

interface JackpotEntryModalProps {
  open: boolean;
  onClose: () => void;
  person: TrendingPerson;
  marketId: string | null;
  userCredits: number;
  bettingCutoff: string | null;
  /** Sunday 23:59 UTC resolution time so the cycle strip can show "Results …". */
  resolveAt?: string | null;
  isCutoffPassed: boolean;
}

const JACKPOT_TICKET_COST = 100;

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function JackpotEntryModal({
  open,
  onClose,
  person,
  marketId,
  userCredits,
  bettingCutoff,
  resolveAt,
  isCutoffPassed,
}: JackpotEntryModalProps) {
  const { session, loading, refreshProfile, isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { trigger: triggerXpBurst } = useXpBurst();
  const [scoreInput, setScoreInput] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [suggestions, setSuggestions] = useState<number[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastPrediction, setLastPrediction] = useState<number | null>(null);
  const [showAllEntries, setShowAllEntries] = useState(false);
  const isMobile = useIsMobile();

  const parsedScore = useMemo(() => {
    const cleaned = scoreInput.replace(/,/g, "");
    const num = parseInt(cleaned, 10);
    return isNaN(num) || num <= 0 ? null : num;
  }, [scoreInput]);

  const isAuthReady = !!session?.access_token && !loading;
  const closedMarketMessage = useMemo(() => {
    return getClosedMarketMessage({
      bettingCutoff,
    });
  }, [bettingCutoff]);

  const { data: takenData } = useQuery({
    // Auth-scoped cache key: use a stable flag (isAuthReady) rather than the
    // raw access_token. Including the token makes the cache churn on every
    // token refresh and leaks it into React DevTools/cache snapshots.
    queryKey: ["/api/native-markets", marketId, "jackpot-taken-numbers", isAuthReady],
    queryFn: async () => {
      if (!marketId) return { takenNumbers: [] };
      const sb = await getSupabase();
      const { data: { session: currentSession } } = await sb.auth.getSession();
      const headers: Record<string, string> = {};
      if (currentSession?.access_token) headers["Authorization"] = `Bearer ${currentSession.access_token}`;
      const res = await fetch(`/api/native-markets/${marketId}/jackpot-taken-numbers`, {
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load taken numbers: ${res.status}`);
      return res.json();
    },
    enabled: open && !!marketId && isAuthReady,
    refetchInterval: 30000,
  });

  const { data: userEntries, refetch: refetchEntries } = useQuery({
    queryKey: ["/api/native-markets", marketId, "jackpot-entries", isAuthReady],
    queryFn: async () => {
      if (!marketId) return { entries: [], totalPool: 0, totalEntries: 0 };
      const sb = await getSupabase();
      const { data: { session } } = await sb.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/native-markets/${marketId}/jackpot-entries`, { headers, credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load entries: ${res.status}`);
      return res.json();
    },
    enabled: open && !!marketId && isAuthReady,
  });

  const takenNumbers = useMemo(() => new Set<number>(takenData?.takenNumbers || []), [takenData]);

  useEffect(() => {
    if (!parsedScore || !open) {
      setAvailabilityStatus("idle");
      setSuggestions([]);
      return;
    }
    setAvailabilityStatus("checking");
    const timeout = setTimeout(() => {
      if (takenNumbers.has(parsedScore)) {
        setAvailabilityStatus("taken");
        const nearby: number[] = [];
        for (const offset of [1, -1, 2, -2, 5, -5, 10, -10]) {
          const candidate = parsedScore + offset;
          if (candidate > 0 && !takenNumbers.has(candidate)) {
            nearby.push(candidate);
            if (nearby.length >= 3) break;
          }
        }
        setSuggestions(nearby);
      } else {
        setAvailabilityStatus("available");
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [parsedScore, takenNumbers, open]);

  const betMutation = useMutation({
    mutationFn: async (predictedScore: number) => {
      const sb = await getSupabase();
      const { data: { session } } = await sb.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

      const res = await fetch(`/api/native-markets/${marketId}/jackpot-bet`, {
        method: "POST",
        headers,
        body: JSON.stringify({ predictedScore }),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        const err: any = new Error(data.message || "Failed to place entry");
        err.code = data.error;
        err.suggestions = data.suggestions;
        throw err;
      }
      return data;
    },
    onSuccess: (data) => {
      setLastPrediction(data.predictedScore);
      setShowSuccess(true);
      setScoreInput("");
      setAvailabilityStatus("idle");
      setSuggestions([]);
      queryClient.invalidateQueries({ queryKey: ["/api/native-markets", marketId, "jackpot-taken-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/native-markets", marketId, "jackpot-entries"] });
      // Profile/Vox balance lives in AuthContext, not in a React Query
      // cache — the previous `["/api/user/profile"]` invalidation did
      // nothing. Pull a fresh profile so the user's balance reflects
      // the ticket cost.
      refreshProfile().catch((err) => console.warn("[JackpotEntryModal] refreshProfile failed", err));
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
    },
    onError: (error: any) => {
      if (error.code === "NUMBER_TAKEN") {
        setAvailabilityStatus("taken");
        if (error.suggestions?.length) setSuggestions(error.suggestions);
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets", marketId, "jackpot-taken-numbers"] });
        return;
      }
      toast.error("Entry failed", { description: error.message || "Could not place jackpot entry" });
    },
  });

  const handleSubmit = () => {
    if (!parsedScore || !marketId || availabilityStatus === "taken") return;
    betMutation.mutate(parsedScore);
  };

  const handleScoreChange = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    if (digits === "") {
      setScoreInput("");
      return;
    }
    const num = parseInt(digits, 10);
    setScoreInput(formatNumber(num));
  };

  const handleClose = useCallback(() => {
    setShowSuccess(false);
    setLastPrediction(null);
    setScoreInput("");
    setAvailabilityStatus("idle");
    onClose();
  }, [onClose]);

  const handleEnterAnother = () => {
    setShowSuccess(false);
    setLastPrediction(null);
    setScoreInput("");
    setAvailabilityStatus("idle");
  };

  const canSubmit = parsedScore && marketId && availabilityStatus === "available" && userCredits >= JACKPOT_TICKET_COST && !betMutation.isPending && !isCutoffPassed;

  const existingEntries = userEntries?.entries || [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Weekly Jackpot Entry
            <Popover>
              <PopoverTrigger asChild>
                <button className="ml-auto inline-flex items-center justify-center rounded-full h-6 w-6 hover:bg-muted transition-colors" aria-label="How the Jackpot works">
                  <HelpCircle className="h-4 w-4 text-amber-500/60" />
                </button>
              </PopoverTrigger>
              {/* onWheel: Radix Dialog wraps its content in
                  react-remove-scroll, which preventDefaults wheel
                  events on anything outside its allowed scroll
                  tree. PopoverContent is portaled to <body>, so it
                  falls outside that tree and native wheel scroll is
                  blocked — only the scrollbar drag works. We
                  manually advance scrollTop here so the wheel still
                  scrolls the rules content even though the native
                  scroll is suppressed. */}
              <PopoverContent
                className="w-80 max-h-[70vh] overflow-y-auto"
                side="bottom"
                align="end"
                onWheel={(e) => {
                  e.currentTarget.scrollTop += e.deltaY;
                }}
              >
                <RulesExplainer {...RULES_CONTENT.jackpot} />
              </PopoverContent>
            </Popover>
          </DialogTitle>
          <DialogDescription>
            Predict {person.name}'s exact closing Trend Score
          </DialogDescription>
        </DialogHeader>

        {!marketId ? (
          <div className="text-center py-6">
            <Crown className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold mb-1">No Jackpot Available</p>
            <p className="text-sm text-muted-foreground">
              There is no active jackpot market for {person.name} this week. Check back soon!
            </p>
          </div>
        ) : isCutoffPassed ? (
          <div className="text-center py-6">
            <Lock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold mb-1">{closedMarketMessage.title}</p>
            <div className="text-sm text-muted-foreground mb-4 space-y-2">
              {closedMarketMessage.lines.map((line, idx) => (
                <p key={`jackpot-closed-line-${idx}`}>{line}</p>
              ))}
            </div>
            {existingEntries.length > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-xs font-medium text-amber-500 mb-2">Your predictions</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {existingEntries.map((e: JackpotEntry) => (
                    <Badge key={e.betId} variant="outline" className="border-amber-500/40 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 font-mono">
                      {formatNumber(e.predictedScore)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : showSuccess && lastPrediction ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <TicketCheck className="h-8 w-8 text-green-500" />
            </div>
            <p className="font-semibold text-lg mb-1">Entry Confirmed!</p>
            <p className="text-muted-foreground text-sm mb-3">
              You predicted <span className="font-bold text-foreground">{formatNumber(lastPrediction)}</span> for {person.name}
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Results announced Sunday at 23:59 UTC.
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={handleEnterAnother}>
                Enter Another
              </Button>
              <Button onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="px-3 py-2 rounded-lg bg-muted/50">
              <MarketCycleStrip
                bettingCutoff={bettingCutoff}
                resolveAt={resolveAt ?? null}
                variant="modal"
                engine="parimutuel"
              />
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <PersonAvatar name={person.name} avatar={person.avatar || ""} size="md" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{person.name}</p>
                {typeof person.rank === "number" && person.rank > 0 && (
                  <p className="text-xs text-muted-foreground">Rank #{person.rank}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Current Score</p>
                <p className="text-lg font-bold font-mono text-amber-500">
                  {formatNumber(Math.round(person.trendScore))}
                </p>
              </div>
            </div>

            {(userEntries?.totalPool > 0 || userEntries?.totalEntries > 0) && (
              <p className="text-xs text-muted-foreground text-center" data-testid="text-jackpot-pool">
                {userEntries.totalPool > 0 && (
                  <>
                    Pool:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {formatVox(userEntries.totalPool)}
                    </span>
                  </>
                )}
                {userEntries.totalPool > 0 && userEntries.totalEntries > 0 && (
                  <span className="text-muted-foreground/70"> · </span>
                )}
                {userEntries.totalEntries > 0 && (
                  <>
                    <span className="font-mono font-medium text-foreground">
                      {formatNumber(userEntries.totalEntries)}
                    </span>{" "}
                    {userEntries.totalEntries === 1 ? "entry" : "entries"}
                  </>
                )}
              </p>
            )}

            <p className="text-xs text-muted-foreground text-center">
              Closest exact score at{" "}
              <span className="font-medium text-foreground">Sunday 23:59 UTC</span> wins the pot. Ties split.
            </p>

            {/* Score input */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Your predicted closing score
              </label>
              <div className="relative">
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 600,421"
                  value={scoreInput}
                  onChange={(e) => handleScoreChange(e.target.value)}
                  className={`bg-background/50 pr-10 text-lg font-mono ${
                    availabilityStatus === "taken"
                      ? "border-red-500/50 focus-visible:ring-red-500/30"
                      : availabilityStatus === "available"
                        ? "border-green-500/50 focus-visible:ring-green-500/30"
                        : ""
                  }`}
                  data-testid="input-jackpot-score"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {availabilityStatus === "checking" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {availabilityStatus === "available" && <Check className="h-4 w-4 text-green-500" />}
                  {availabilityStatus === "taken" && <X className="h-4 w-4 text-red-500" />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                What will their Trend Score be at Sunday 23:59 UTC?
              </p>
              {availabilityStatus === "taken" && (
                <div className="mt-2 p-2 rounded bg-red-500/5 border border-red-500/20">
                  <p className="text-xs text-red-600 dark:text-red-400 mb-1">That number is already claimed.</p>
                  {suggestions.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">Try:</span>
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 underline cursor-pointer"
                          onClick={() => handleScoreChange(String(s))}
                        >
                          {formatNumber(s)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {existingEntries.length > 0 && (() => {
              const collapsed = isMobile && !showAllEntries && existingEntries.length > 3;
              const visible = collapsed ? existingEntries.slice(0, 3) : existingEntries;
              return (
                <div className="pt-2 border-t" data-testid="section-jackpot-existing-entries">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Your predictions ({existingEntries.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {visible.map((e: JackpotEntry) => (
                      <Badge
                        key={e.betId}
                        variant="outline"
                        className="border-amber-500/40 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 font-mono"
                      >
                        {formatNumber(e.predictedScore)}
                      </Badge>
                    ))}
                  </div>
                  {isMobile && existingEntries.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setShowAllEntries((v) => !v)}
                      className="mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                      data-testid="button-jackpot-show-all-entries"
                    >
                      {collapsed ? `Show all (${existingEntries.length})` : "Show fewer"}
                      <ChevronDown className={`h-3 w-3 transition-transform ${collapsed ? "" : "rotate-180"}`} />
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Entry details */}
            <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Entry cost</span>
                <span className="font-semibold">{formatVox(JACKPOT_TICKET_COST)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Your balance</span>
                <span className={`font-semibold ${userCredits < JACKPOT_TICKET_COST ? "text-red-600 dark:text-red-400" : ""}`}>
                  {formatVox(userCredits)}
                </span>
              </div>
            </div>

            {/* Mirror StakeModal: only nudge to /pricing once the user is
                authenticated. Logged-out viewers shouldn't see a "Buy
                Vox" affordance — they need the Sign In path first,
                and /checkout is a no-op for them anyway. */}
            {isLoggedIn && userCredits < JACKPOT_TICKET_COST && (
              <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 dark:border-violet-500/30 dark:bg-violet-500/8 p-3 flex items-center gap-3">
                <Wallet className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                <p className="text-xs text-muted-foreground flex-1">
                  Need at least {formatVox(JACKPOT_TICKET_COST)} to enter.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-violet-500/50 text-violet-700 dark:text-violet-300 hover:bg-violet-500/15"
                  onClick={() => {
                    handleClose();
                    setLocation("/pricing");
                  }}
                  data-testid="button-buy-credits-jackpot"
                >
                  Buy Vox
                </Button>
              </div>
            )}

            {/* Submit */}
            <Button
              className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30"
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-testid="button-submit-jackpot"
            >
              {betMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Crown className="h-4 w-4 mr-2" />
              )}
              Enter Jackpot — Ꝟ100
            </Button>
            <p className="text-[10px] text-muted-foreground/60 text-center -mt-0.5">
              Vox is VoxDex&apos;s virtual currency — no cash value.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
