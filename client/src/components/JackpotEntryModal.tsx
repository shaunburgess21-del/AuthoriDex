import { useState, useEffect, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";
import { Crown, Check, X, Loader2, Lock, TicketCheck, HelpCircle } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RULES_CONTENT, RulesExplainer } from "@/components/predict/RulesContent";
import type { TrendingPerson } from "@shared/schema";

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
  isCutoffPassed,
}: JackpotEntryModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scoreInput, setScoreInput] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [suggestions, setSuggestions] = useState<number[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastPrediction, setLastPrediction] = useState<number | null>(null);

  const parsedScore = useMemo(() => {
    const cleaned = scoreInput.replace(/,/g, "");
    const num = parseInt(cleaned, 10);
    return isNaN(num) || num <= 0 ? null : num;
  }, [scoreInput]);

  const { data: takenData } = useQuery({
    queryKey: ["/api/native-markets", marketId, "jackpot-taken-numbers"],
    queryFn: async () => {
      if (!marketId) return { takenNumbers: [] };
      const res = await fetch(`/api/native-markets/${marketId}/jackpot-taken-numbers`);
      if (!res.ok) throw new Error(`Failed to load taken numbers: ${res.status}`);
      return res.json();
    },
    enabled: open && !!marketId,
    refetchInterval: 30000,
  });

  const { data: userEntries, refetch: refetchEntries } = useQuery({
    queryKey: ["/api/native-markets", marketId, "jackpot-entries"],
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
    enabled: open && !!marketId,
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
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    },
    onError: (error: any) => {
      if (error.code === "NUMBER_TAKEN") {
        setAvailabilityStatus("taken");
        if (error.suggestions?.length) setSuggestions(error.suggestions);
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets", marketId, "jackpot-taken-numbers"] });
        return;
      }
      toast({
        title: "Entry failed",
        description: error.message || "Could not place jackpot entry",
        variant: "destructive",
      });
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
              <PopoverContent className="w-80 max-h-[70vh] overflow-y-auto" side="bottom" align="end">
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
            <p className="font-semibold mb-1">Entries Closed</p>
            <p className="text-sm text-muted-foreground mb-4">
              Jackpot entries close Friday at 23:59 UTC. Results will be announced Sunday at 23:59 UTC.
            </p>
            {existingEntries.length > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-xs font-medium text-amber-500 mb-2">Your predictions</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {existingEntries.map((e: JackpotEntry) => (
                    <Badge key={e.betId} variant="outline" className="border-amber-500/30 text-amber-400 font-mono">
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
            {/* Person context */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <PersonAvatar name={person.name} avatar={person.avatar || ""} size="md" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{person.name}</p>
                <p className="text-xs text-muted-foreground">Rank #{person.rank}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Current Score</p>
                <p className="text-lg font-bold font-mono text-amber-500">
                  {formatNumber(Math.round(person.trendScore))}
                </p>
              </div>
            </div>

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
                  <p className="text-xs text-red-400 mb-1">That number is already claimed.</p>
                  {suggestions.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">Try:</span>
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          className="text-xs text-amber-400 hover:text-amber-300 underline cursor-pointer"
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

            {/* Entry details */}
            <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Entry cost</span>
                <span className="font-semibold">{JACKPOT_TICKET_COST} credits</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Your balance</span>
                <span className={`font-semibold ${userCredits < JACKPOT_TICKET_COST ? "text-red-400" : ""}`}>
                  {formatNumber(userCredits)} credits
                </span>
              </div>
            </div>

            {userCredits < JACKPOT_TICKET_COST && (
              <p className="text-xs text-red-400 text-center">
                You need at least {JACKPOT_TICKET_COST} credits to enter.
              </p>
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
              Enter Jackpot — 100 Credits
            </Button>

            {/* Existing entries */}
            {existingEntries.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Your predictions ({existingEntries.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {existingEntries.map((e: JackpotEntry) => (
                    <Badge key={e.betId} variant="outline" className="border-amber-500/30 text-amber-400 font-mono">
                      {formatNumber(e.predictedScore)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
