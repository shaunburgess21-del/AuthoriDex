import { useState, useRef } from "react";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Target, TrendingUp, TrendingDown, LogIn, Star, MessageSquarePlus, HelpCircle, Lock, CreditCard, Loader2, ChevronDown } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { MarketResolutionInfo } from "@/components/predict/MarketResolutionInfo";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { WhatNeedsToHappen } from "@/components/predict/WhatNeedsToHappen";
import { OutcomePathChart } from "@/components/predict/OutcomePathChart";
import { RULES_CONTENT, RulesExplainer } from "@/components/predict/RulesContent";
import { shouldRenderCrowdSentiment } from "@/lib/predict-display";
import { estimateCreditsIfWin } from "@/lib/parimutuel";

const MISSION_HEADERS: Record<string, string> = {
  jackpot: "Predict the exact Trend Score at week's end to win the pot.",
  updown: "Will their Trend Score be higher or lower by close?",
  h2h: "Back your champion to win this weekly matchup.",
  gainer: "Pick the biggest mover — whoever gains the most % in their Trend Score wins.",
  community: "Cast your vote on this real-world prediction.",
};

export interface StakeSelection {
  type: string;
  choice: string;
  marketName: string;
  /**
   * Person being predicted on (when applicable). Used by prose like
   * MarketResolutionInfo to render "UP wins if {personName} closes
   * above {baseline}". Falls back to `marketName` if absent, but
   * setting this avoids awkward sentences like "UP wins if Name: Up
   * or Down? closes above ..." on the Up/Down detail page.
   */
  personName?: string;
  marketId?: string;
  entryId?: string;
  startScore?: number;
  currentScore?: number;
  opponentScore?: number;
  opponentName?: string;
  crowdSentiment?: number;
  poolTotal?: number;
  estimatedPayout?: number;
  baselineScore?: number;
  baselineTimestamp?: string;
  tieRule?: string;
  resolveMethod?: string;
  endAt?: string;
  confidence?: number;
  thesis?: string;
  candidateRank?: number;
  candidatePercentGain?: number;
  candidatePointsAdded?: number;
  bettingCutoff?: string | null;
  /** Yes/No side for community-market multi-option entries.
   *  Other market types (updown/h2h/gainer/jackpot) ignore this. */
  direction?: "yes" | "no";
}

interface StakeModalProps {
  open: boolean;
  onClose: () => void;
  selection: StakeSelection | null;
  /**
   * May return a Promise. When it does, the modal awaits it before firing
   * confetti and resetting input state — so a failed bet (e.g. server 400)
   * keeps the modal open with the user's entry intact and never plays the
   * "you won" confetti on top of the parent's error toast.
   */
  onConfirm: (amount: number) => void | Promise<void>;
  onConfirmWithMeta?: (
    amount: number,
    meta: { confidence?: number; thesis?: string },
  ) => void | Promise<void>;
  walletBalance: number;
  /** Up/Down for `updown` markets, Yes/No for `community` markets.
   *  When provided, the modal renders an in-place toggle so a misclick on
   *  the card doesn't require closing + reopening the modal. */
  onDirectionChange?: (direction: "up" | "down" | "yes" | "no") => void;
  onChangePick?: () => void;
}

const MIN_STAKE = 5;

export function StakeModal({
  open,
  onClose,
  selection,
  onConfirm,
  onConfirmWithMeta,
  walletBalance,
  onDirectionChange,
  onChangePick,
}: StakeModalProps) {
  const [stakeAmount, setStakeAmount] = useState("");
  const parsedAmount = parseInt(stakeAmount) || 0;
  const balanceAfter = walletBalance - parsedAmount;
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const marketCycle = useMarketCycle({
    bettingCutoff: selection?.bettingCutoff,
    resolutionDeadline: selection?.endAt,
  });
  const { isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  const [confidence, setConfidence] = useState(0);
  const [thesis, setThesis] = useState("");
  const [showThesisSection, setShowThesisSection] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isMobile = useIsMobile();
  // Default chart closed on mobile to keep Confirm above the fold; default
  // open on desktop. Read window width directly because `useIsMobile` returns
  // false on the very first render (before its effect runs), which would
  // otherwise leave the chart open on mobile by default.
  const [chartOpen, setChartOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  });

  if (!selection) return null;

  const isCutoffPassed = selection.bettingCutoff ? marketCycle.status !== "OPEN" : false;
  const missionText = MISSION_HEADERS[selection.type] || "Place your prediction on this market.";
  const isUpDown = selection.type === "updown";
  const isH2H = selection.type === "h2h";
  const isGainer = selection.type === "gainer";
  const isCommunity = selection.type === "community";
  const isCommunityNo = isCommunity && selection.direction === "no";
  const isUp = selection.choice.includes("UP");
  const isDown = selection.choice.includes("DOWN");

  const fireConfetti = (origin: { x: number; y: number }) => {
    confetti({
      particleCount: 60,
      spread: 55,
      origin,
      colors: ["#06b6d4", "#a855f7", "#8b5cf6", "#22d3ee"],
      startVelocity: 25,
      gravity: 1.2,
      scalar: 0.8,
      ticks: 100,
    });
  };

  const handleConfirm = async () => {
    if (submitting) return;
    if (parsedAmount < MIN_STAKE || balanceAfter < 0) return;

    // Capture button position before any await: the parent typically closes
    // this modal in its mutation `onSuccess`, which unmounts the button and
    // nulls the ref before confetti would otherwise fire.
    let confettiOrigin: { x: number; y: number } | null = null;
    if (confirmButtonRef.current) {
      const rect = confirmButtonRef.current.getBoundingClientRect();
      confettiOrigin = {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      };
    }

    setSubmitting(true);
    try {
      const result = onConfirmWithMeta
        ? onConfirmWithMeta(parsedAmount, {
            confidence: confidence || undefined,
            thesis: thesis.trim() || undefined,
          })
        : onConfirm(parsedAmount);

      if (result && typeof (result as Promise<void>).then === "function") {
        await result;
      }

      if (confettiOrigin) {
        try {
          fireConfetti(confettiOrigin);
        } catch (e) {
          console.error("Confetti error:", e);
        }
      }

      setStakeAmount("");
      setConfidence(0);
      setThesis("");
      setShowThesisSection(false);
    } catch {
      // Parent surfaces its own error toast; keep the modal open with
      // the user's stake intact so they can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        setStakeAmount("");
        setConfidence(0);
        setThesis("");
        setShowThesisSection(false);
        onClose();
      }
    }}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto premium-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-violet-700 dark:text-violet-500" />
            Confirm Prediction
            {selection?.type && RULES_CONTENT[selection.type] && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-violet-500/15 dark:hover:bg-violet-500/15 dark:bg-violet-500/10 transition-colors"
                    aria-label="How it works"
                  >
                    <HelpCircle className="h-4 w-4 text-violet-700 dark:text-violet-500" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 max-h-[70vh] overflow-y-auto" side="bottom" align="end">
                  <RulesExplainer {...RULES_CONTENT[selection.type]} />
                </PopoverContent>
              </Popover>
            )}
          </DialogTitle>
          <DialogDescription>
            {missionText}
          </DialogDescription>
        </DialogHeader>

        {/* Community markets resolve any time and don't follow the weekly
            cycle, so the strip with its Friday-cutoff/Sunday-resolve fallbacks
            would show misleading info. Native (weekly) markets keep it. */}
        {!isCommunity && (
          <MarketCycleStrip
            bettingCutoff={selection.bettingCutoff ?? null}
            resolveAt={selection.endAt ?? null}
            variant="modal"
          />
        )}

        <div className="py-2 space-y-4">
          <Card className="p-3 bg-violet-500/8 dark:bg-violet-500/5 border-violet-500/20">
            <p className="text-xs text-muted-foreground mb-1">{selection.marketName}</p>
            {isUpDown ? (
              <p className="text-lg font-bold">
                <span className="text-muted-foreground text-sm font-medium mr-1.5">Your pick:</span>
                <span className="text-foreground">Trend Score </span>
                {isUp && <span className="text-[#00C853]">UP</span>}
                {isDown && <span className="text-[#FF0000]">DOWN</span>}
              </p>
            ) : isCommunity ? (
              <p className="text-lg font-bold text-balance">
                <span className="text-muted-foreground text-sm font-medium mr-1.5">Your pick:</span>
                <span
                  className={`mr-1.5 px-1.5 py-0.5 rounded text-xs font-mono uppercase align-middle ${
                    isCommunityNo
                      ? "bg-red-500/15 text-[#FF0000]"
                      : "bg-green-500/15 text-[#00C853]"
                  }`}
                >
                  {selection.direction === "no" ? "No" : "Yes"}
                </span>
                <span className="text-foreground">{selection.choice}</span>
              </p>
            ) : (
              <p className="text-lg font-bold">
                <span className="text-muted-foreground text-sm font-medium mr-1.5">Your pick:</span>
                <span className="text-foreground">{selection.choice}</span>
              </p>
            )}

            {isGainer && onChangePick && (
              <button
                type="button"
                onClick={onChangePick}
                className="mt-2 text-xs text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 transition-colors"
              >
                Change pick
              </button>
            )}

            {isUpDown && onDirectionChange && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => onDirectionChange("up")}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    isUp
                      ? "bg-[#00C853]/20 border-[#00C853]/60 text-[#00C853]"
                      : "bg-transparent border-slate-700 text-slate-600 dark:text-slate-400 hover:border-[#00C853]/40 hover:text-[#00C853]/60"
                  }`}
                >
                  <TrendingUp className="h-3 w-3" /> Up
                </button>
                <button
                  onClick={() => onDirectionChange("down")}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    isDown
                      ? "bg-[#FF0000]/20 border-[#FF0000]/60 text-[#FF0000]"
                      : "bg-transparent border-slate-700 text-slate-600 dark:text-slate-400 hover:border-[#FF0000]/40 hover:text-[#FF0000]/60"
                  }`}
                >
                  <TrendingDown className="h-3 w-3" /> Down
                </button>
              </div>
            )}

            {/* Community-market direction toggle — mirrors the upDown one
                so a user who tapped the wrong side on the card can flip
                without closing + reopening the modal. */}
            {isCommunity && onDirectionChange && (
              <div className="flex gap-2 mt-2" role="group" aria-label="Yes / No toggle">
                <button
                  type="button"
                  onClick={() => onDirectionChange("yes")}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    selection.direction !== "no"
                      ? "bg-[#00C853]/20 border-[#00C853]/60 text-[#00C853]"
                      : "bg-transparent border-slate-700 text-slate-600 dark:text-slate-400 hover:border-[#00C853]/40 hover:text-[#00C853]/60"
                  }`}
                  data-testid="stake-modal-toggle-yes"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => onDirectionChange("no")}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    selection.direction === "no"
                      ? "bg-[#FF0000]/20 border-[#FF0000]/60 text-[#FF0000]"
                      : "bg-transparent border-slate-700 text-slate-600 dark:text-slate-400 hover:border-[#FF0000]/40 hover:text-[#FF0000]/60"
                  }`}
                  data-testid="stake-modal-toggle-no"
                >
                  No
                </button>
              </div>
            )}
          </Card>

          {isUpDown && (selection.startScore != null || selection.currentScore != null) && (
            <div className="grid grid-cols-2 gap-3">
              {selection.startScore != null && (
                <Card className="p-2.5 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Baseline Score</p>
                  <p className="font-mono font-bold text-sm">{selection.startScore.toLocaleString('en-US')}</p>
                </Card>
              )}
              {selection.currentScore != null && (
                <Card className="p-2.5 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Current Score</p>
                  <p className="font-mono font-bold text-sm">{selection.currentScore.toLocaleString('en-US')}</p>
                </Card>
              )}
            </div>
          )}

          {isH2H && selection.currentScore != null && selection.opponentScore != null && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-2.5 bg-violet-500/8 dark:bg-violet-500/5 border-violet-500/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
                    {selection.personName ?? "Your pick"}
                  </p>
                  <p className="font-mono font-bold text-sm">{selection.currentScore.toLocaleString("en-US")}</p>
                </Card>
                <Card className="p-2.5 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
                    {selection.opponentName ?? "Opponent"}
                  </p>
                  <p className="font-mono font-bold text-sm">{selection.opponentScore.toLocaleString("en-US")}</p>
                </Card>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Wins if{" "}
                <span className="font-medium text-foreground">{selection.personName ?? "your pick"}</span>{" "}
                has a higher closing Trend Score than {selection.opponentName ?? "opponent"} at weekly close.
                {selection.tieRule === "refund" && " Ties refund."}
              </p>
            </>
          )}

          {isGainer && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Card className="p-2.5 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Current Rank</p>
                  <p className="font-mono font-bold text-sm">#{selection.candidateRank ?? "-"}</p>
                </Card>
                <Card className="p-2.5 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">7-Day Gain</p>
                  <p className={`font-mono font-bold text-sm ${(selection.candidatePercentGain ?? 0) >= 0 ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-500"}`}>
                    {selection.candidatePercentGain != null ? `${selection.candidatePercentGain >= 0 ? "+" : ""}${selection.candidatePercentGain.toFixed(1)}%` : "--"}
                  </p>
                </Card>
                <Card className="p-2.5 bg-muted/30 col-span-2 sm:col-span-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Points Added</p>
                  <p className={`font-mono font-bold text-sm ${(selection.candidatePointsAdded ?? 0) >= 0 ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-500"}`}>
                    {selection.candidatePointsAdded != null ? `${selection.candidatePointsAdded >= 0 ? "+" : ""}${selection.candidatePointsAdded.toLocaleString("en-US")}` : "--"}
                  </p>
                </Card>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Winner = highest % gain in Trend Score by Sunday close. Not highest ranked — biggest mover.
              </p>
            </>
          )}

          {isUpDown && selection.startScore != null && selection.currentScore != null && (() => {
            const baseline = selection.startScore as number;
            const delta = (selection.currentScore as number) - baseline;
            const pct = baseline !== 0 ? (delta / baseline) * 100 : 0;
            const isPositive = delta >= 0;
            const color = isPositive ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-500";
            return (
              <div className="flex items-center justify-center gap-2 text-xs">
                <span className="text-muted-foreground">Change since baseline:</span>
                <span className={`font-mono font-medium ${color}`}>
                  {isPositive ? "+" : ""}{delta.toLocaleString("en-US")} pts ({isPositive ? "+" : ""}{pct.toFixed(1)}%)
                </span>
              </div>
            );
          })()}

          {selection.estimatedPayout && !isNaN(selection.estimatedPayout) && (
            <p className="text-xs text-muted-foreground text-center">
              Estimated Payout:{" "}
              <span className="font-mono font-medium text-green-700 dark:text-green-500">
                {selection.estimatedPayout.toFixed(1)}x your stake
              </span>
              {parsedAmount >= MIN_STAKE && (
                <>
                  <span className="text-muted-foreground/70"> · </span>
                  <span className="font-mono font-medium text-green-700 dark:text-green-500">
                    ~{estimateCreditsIfWin(parsedAmount, selection.estimatedPayout).toLocaleString("en-US")}
                  </span>{" "}
                  credits if you win
                </>
              )}
            </p>
          )}

          {(shouldRenderCrowdSentiment(selection.crowdSentiment) ||
            (typeof selection.poolTotal === "number" && selection.poolTotal > 0)) && (
            <p className="text-xs text-muted-foreground text-center">
              {typeof selection.poolTotal === "number" && selection.poolTotal > 0 && (
                <>
                  Pool:{" "}
                  <span className="font-mono font-medium text-foreground">
                    {selection.poolTotal.toLocaleString("en-US")} credits
                  </span>
                </>
              )}
              {typeof selection.poolTotal === "number" &&
                selection.poolTotal > 0 &&
                shouldRenderCrowdSentiment(selection.crowdSentiment) && (
                  <span className="text-muted-foreground/70"> · </span>
                )}
              {shouldRenderCrowdSentiment(selection.crowdSentiment) && (
                <>
                  <span className="font-mono font-medium text-foreground">{selection.crowdSentiment}%</span>{" "}
                  backing your pick
                </>
              )}
            </p>
          )}

          {isUpDown && (() => {
            // Prose uses personName so we say "UP wins if Bieber..."
            // not "UP wins if Bieber: Up or Down? closes above ...".
            const proseName = selection.personName ?? selection.marketName;
            return (
              <div className="text-xs text-center space-y-1">
                {isUp && (
                  <p className="text-muted-foreground">
                    <span className="text-[#00C853] font-medium">UP</span> wins if <span className="font-medium text-foreground">{proseName}</span> closes above <span className="font-mono font-medium text-foreground">{(selection.startScore ?? 0).toLocaleString("en-US")}</span> at weekly close.
                  </p>
                )}
                {isDown && (
                  <p className="text-muted-foreground">
                    <span className="text-[#FF0000] font-medium">DOWN</span> wins if <span className="font-medium text-foreground">{proseName}</span> closes below <span className="font-mono font-medium text-foreground">{(selection.startScore ?? 0).toLocaleString("en-US")}</span> at weekly close.
                  </p>
                )}
                <p className="text-muted-foreground/70 italic">Exact tie: all positions refunded.</p>
              </div>
            );
          })()}

          {isUpDown && (
            <WhatNeedsToHappen
              pick={isUp ? "up" : "down"}
              baselineScore={selection.startScore || selection.baselineScore || 0}
              currentScore={selection.currentScore || 0}
              personName={selection.personName ?? selection.marketName}
              compact
              tieRule={selection.tieRule}
            />
          )}

          {isUpDown && selection.marketId && (
            <div>
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setChartOpen((v) => !v)}
                  className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 py-1"
                  data-testid="button-stake-chart-toggle"
                >
                  {chartOpen ? "Hide" : "Show"} 7-day chart
                  <ChevronDown className={`h-3 w-3 transition-transform ${chartOpen ? "rotate-180" : ""}`} />
                </button>
              )}
              {(!isMobile || chartOpen) && (
                <OutcomePathChart
                  marketId={selection.marketId}
                  baselineScore={selection.startScore || selection.baselineScore || 0}
                  currentScore={selection.currentScore || 0}
                  personName={selection.personName ?? selection.marketName}
                  compact
                  userPick={isUp ? "up" : isDown ? "down" : null}
                />
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Stake Amount</label>
            <Input
              type="number"
              min={MIN_STAKE}
              max={walletBalance}
              placeholder="Enter credits to stake"
              value={stakeAmount}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  setStakeAmount("");
                  return;
                }
                const n = parseInt(v, 10);
                if (Number.isNaN(n)) {
                  setStakeAmount(v);
                  return;
                }
                setStakeAmount(String(Math.min(Math.max(0, n), walletBalance)));
              }}
              className="font-mono"
              data-testid="input-stake"
            />
          </div>

          <div className="flex gap-2">
            {[100, 500, 1000].map((amount) => {
              const capped = Math.min(amount, walletBalance);
              return (
                <Button
                  key={amount}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStakeAmount(capped > 0 ? String(capped) : "")}
                  title={capped < amount ? `Stakes ${capped.toLocaleString("en-US")} credits (your balance)` : undefined}
                  className="flex-1"
                  data-testid={`button-preset-${amount}`}
                >
                  {amount}
                </Button>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs pt-2 border-t">
            <div>
              <span className="text-muted-foreground">Current Balance: </span>
              <span className="font-mono font-medium">{walletBalance.toLocaleString('en-US')}</span>
            </div>
            <div>
              <span className="text-muted-foreground">After Stake: </span>
              <span className={`font-mono font-medium ${balanceAfter < 0 ? 'text-red-700 dark:text-red-500' : 'text-green-700 dark:text-green-500'}`}>
                {balanceAfter >= 0 ? balanceAfter.toLocaleString('en-US') : 'Insufficient'}
              </span>
            </div>
          </div>

          {/* Highest-converting placement for the Buy Credits CTA — the
              user has explicit intent to predict and just discovered
              they can't afford the entry. Two trigger conditions cover
              both "below minimum stake" (idle state) and "tried to
              over-stake" (active typing). Logged-out users see the
              Sign In button instead, so this only matters once auth'd. */}
          {isLoggedIn && (walletBalance < MIN_STAKE || balanceAfter < 0) && (
            <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 dark:border-violet-500/30 dark:bg-violet-500/8 p-3 flex items-center gap-3">
              <CreditCard className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
              <p className="text-xs text-muted-foreground flex-1">
                {walletBalance < MIN_STAKE
                  ? "You need credits to predict."
                  : "Not enough credits for that stake."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="border-violet-500/50 text-violet-700 dark:text-violet-300 hover:bg-violet-500/15"
                onClick={() => {
                  onClose();
                  setLocation("/pricing");
                }}
                data-testid="button-buy-credits-stake"
              >
                Buy credits
              </Button>
            </div>
          )}
        </div>

        {isUpDown && (
          <MarketResolutionInfo
            baselineScore={selection.startScore || selection.baselineScore || 0}
            baselineTimestamp={selection.baselineTimestamp}
            closeTime={
              selection.endAt
                ? new Date(selection.endAt).toUTCString().replace(/ GMT$/, " UTC")
                : undefined
            }
            bettingCutoff={selection.bettingCutoff}
            tieRule={selection.tieRule || "refund"}
            personName={selection.personName ?? selection.marketName}
            compact
          />
        )}

        {/* Optional thesis / confidence section */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowThesisSection(!showThesisSection)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
          >
            <MessageSquarePlus className="h-3 w-3" />
            {showThesisSection ? "Hide your thesis" : "Add your thesis"}
          </button>

          {showThesisSection && (
            <div className="space-y-3 border border-border/40 rounded-lg p-3 bg-muted/10">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Confidence (optional)
                </label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setConfidence(confidence === level ? 0 : level)}
                      className="p-0.5 transition-transform hover:scale-110"
                    >
                      <Star
                        className={`h-5 w-5 ${
                          level <= confidence
                            ? "text-yellow-700 dark:text-yellow-500 fill-yellow-500"
                            : "text-muted-foreground/40"
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/60">How confident are you in this pick?</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Your thesis (optional)
                </label>
                <textarea
                  value={thesis}
                  onChange={(e) => setThesis(e.target.value.slice(0, 100))}
                  placeholder="Why are you making this pick? (optional)"
                  rows={2}
                  className="w-full rounded-md border border-border/40 bg-background px-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50 resize-none"
                />
                <p className="text-[10px] text-muted-foreground/60 text-right">{thesis.length}/100</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          {isLoggedIn ? (
            isCutoffPassed ? (
              <Button
                disabled
                className="flex-1 gap-1.5 opacity-60"
                data-testid="button-confirm-stake"
              >
                <Lock className="h-4 w-4" />
                Entries Closed
              </Button>
            ) : (
              <Button
                ref={confirmButtonRef}
                onClick={handleConfirm}
                className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                disabled={
                  submitting ||
                  !stakeAmount ||
                  parsedAmount < MIN_STAKE ||
                  balanceAfter < 0
                }
                data-testid="button-confirm-stake"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Placing…
                  </>
                ) : (
                  "Confirm"
                )}
              </Button>
            )
          ) : (
            <Button
              onClick={() => { onClose(); navigateToLogin(setLocation); }}
              className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white gap-1.5"
              data-testid="button-signin-stake"
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </Button>
          )}
        </div>

        {!isLoggedIn && (
          <p className="text-xs text-muted-foreground text-center -mt-1">
            Sign in to place your prediction
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
