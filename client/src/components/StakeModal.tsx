import { useState, useRef } from "react";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Target, Clock, TrendingUp, TrendingDown, LogIn, Star, MessageSquarePlus, HelpCircle } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { MarketResolutionInfo } from "@/components/predict/MarketResolutionInfo";
import { WhatNeedsToHappen } from "@/components/predict/WhatNeedsToHappen";
import { OutcomePathChart } from "@/components/predict/OutcomePathChart";
import { RULES_CONTENT, RulesExplainer } from "@/components/predict/RulesContent";
import { shouldRenderCrowdSentiment } from "@/lib/predict-display";

const MISSION_HEADERS: Record<string, string> = {
  jackpot: "Predict the exact Trend Score at week's end to win the pot.",
  updown: "Will their Trend Score be higher or lower by close?",
  h2h: "Back your champion to win this weekly matchup.",
  race: "Predict the #1 top performer to win.",
  gainer: "Predict the #1 top performer to win.",
  community: "Cast your vote on this real-world prediction.",
};

export interface StakeSelection {
  type: string;
  choice: string;
  marketName: string;
  marketId?: string;
  entryId?: string;
  startScore?: number;
  currentScore?: number;
  opponentScore?: number;
  crowdSentiment?: number;
  estimatedPayout?: number;
  baselineScore?: number;
  baselineTimestamp?: string;
  tieRule?: string;
  resolveMethod?: string;
  endAt?: string;
  confidence?: number;
  thesis?: string;
}

interface StakeModalProps {
  open: boolean;
  onClose: () => void;
  selection: StakeSelection | null;
  onConfirm: (amount: number) => void;
  onConfirmWithMeta?: (amount: number, meta: { confidence?: number; thesis?: string }) => void;
  walletBalance: number;
  onDirectionChange?: (direction: "up" | "down") => void;
}

function formatCountdown(days: number, hours: number, minutes: number, seconds: number): string {
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  parts.push(`${hours}h`);
  parts.push(`${String(minutes).padStart(2, "0")}m`);
  parts.push(`${String(seconds).padStart(2, "0")}s`);
  return parts.join(" ");
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
}: StakeModalProps) {
  const [stakeAmount, setStakeAmount] = useState("");
  const parsedAmount = parseInt(stakeAmount) || 0;
  const balanceAfter = walletBalance - parsedAmount;
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const marketCycle = useMarketCycle();
  const { isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  const [confidence, setConfidence] = useState(0);
  const [thesis, setThesis] = useState("");
  const [showThesisSection, setShowThesisSection] = useState(false);

  if (!selection) return null;

  const missionText = MISSION_HEADERS[selection.type] || "Place your prediction on this market.";
  const showJackpotWarning = selection.type === "jackpot";
  const isUpDown = selection.type === "updown";
  const isH2H = selection.type === "h2h";
  const isUp = selection.choice.includes("UP");
  const isDown = selection.choice.includes("DOWN");

  const triggerConfetti = () => {
    if (confirmButtonRef.current) {
      const rect = confirmButtonRef.current.getBoundingClientRect();
      const x = (rect.left + rect.width / 2) / window.innerWidth;
      const y = (rect.top + rect.height / 2) / window.innerHeight;

      confetti({
        particleCount: 60,
        spread: 55,
        origin: { x, y },
        colors: ['#06b6d4', '#a855f7', '#8b5cf6', '#22d3ee'],
        startVelocity: 25,
        gravity: 1.2,
        scalar: 0.8,
        ticks: 100,
      });
    }
  };

  const handleConfirm = () => {
    if (parsedAmount >= MIN_STAKE && balanceAfter >= 0) {
      try {
        triggerConfetti();
      } catch (e) {
        console.error("Confetti error:", e);
      }

      if (onConfirmWithMeta) {
        onConfirmWithMeta(parsedAmount, {
          confidence: confidence || undefined,
          thesis: thesis.trim() || undefined,
        });
      } else {
        onConfirm(parsedAmount);
      }

      setStakeAmount("");
      setConfidence(0);
      setThesis("");
      setShowThesisSection(false);
    }
  };

  const { days, hours, minutes, seconds, totalSeconds } = marketCycle.timeRemaining;
  const countdownText = formatCountdown(days, hours, minutes, seconds);
  const urgencyColor =
    marketCycle.urgencyLevel === "critical" ? "text-red-400" :
    marketCycle.urgencyLevel === "warning" ? "text-amber-400" :
    "text-muted-foreground";

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
            <Target className="h-5 w-5 text-violet-500" />
            Confirm Prediction
            {selection?.type && RULES_CONTENT[selection.type] && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-violet-500/10 transition-colors"
                    aria-label="How it works"
                  >
                    <HelpCircle className="h-4 w-4 text-violet-500" />
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

        {totalSeconds > 0 && (
          <div className={`flex items-center justify-center gap-1.5 text-xs ${urgencyColor}`}>
            <Clock className="h-3 w-3" />
            <span>Market closes in <span className="font-mono font-medium">{countdownText}</span></span>
          </div>
        )}

        <div className="py-2 space-y-4">
          <Card className="p-3 bg-violet-500/5 border-violet-500/20">
            <p className="text-xs text-muted-foreground mb-1">Market</p>
            <p className="text-sm font-semibold text-foreground">{selection.marketName}</p>
            {isUpDown ? (
              <p className="text-lg font-bold mt-1">
                <span className="text-white">Trend Score </span>
                {isUp && <span className="text-[#00C853]">UP</span>}
                {isDown && <span className="text-[#FF0000]">DOWN</span>}
              </p>
            ) : (
              <p className="text-lg font-bold mt-1 text-[#00c853]">{selection.choice}</p>
            )}

            {isUpDown && onDirectionChange && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => onDirectionChange("up")}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    isUp
                      ? "bg-[#00C853]/20 border-[#00C853]/60 text-[#00C853]"
                      : "bg-transparent border-slate-700 text-slate-400 hover:border-[#00C853]/40 hover:text-[#00C853]/60"
                  }`}
                >
                  <TrendingUp className="h-3 w-3" /> Up
                </button>
                <button
                  onClick={() => onDirectionChange("down")}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    isDown
                      ? "bg-[#FF0000]/20 border-[#FF0000]/60 text-[#FF0000]"
                      : "bg-transparent border-slate-700 text-slate-400 hover:border-[#FF0000]/40 hover:text-[#FF0000]/60"
                  }`}
                >
                  <TrendingDown className="h-3 w-3" /> Down
                </button>
              </div>
            )}
          </Card>

          {showJackpotWarning && (
            <p className="text-xs text-amber-500 text-center flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" />
              Predictions lock Thursday 5 PM UTC
            </p>
          )}

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
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-2.5 bg-muted/30">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Your Pick Score</p>
                <p className="font-mono font-bold text-sm">{selection.currentScore.toLocaleString("en-US")}</p>
              </Card>
              <Card className="p-2.5 bg-muted/30">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Opponent Score</p>
                <p className="font-mono font-bold text-sm">{selection.opponentScore.toLocaleString("en-US")}</p>
              </Card>
            </div>
          )}

          {isUpDown && selection.startScore != null && selection.currentScore != null && (() => {
            const baseline = selection.startScore as number;
            const delta = (selection.currentScore as number) - baseline;
            const pct = baseline !== 0 ? (delta / baseline) * 100 : 0;
            const isPositive = delta >= 0;
            const color = isPositive ? "text-green-500" : "text-red-500";
            return (
              <div className="flex items-center justify-center gap-2 text-xs">
                <span className="text-muted-foreground">Delta vs Baseline:</span>
                <span className={`font-mono font-medium ${color}`}>
                  {isPositive ? "+" : ""}{delta.toLocaleString("en-US")} pts ({isPositive ? "+" : ""}{pct.toFixed(1)}%)
                </span>
              </div>
            );
          })()}

          {selection.estimatedPayout && !isNaN(selection.estimatedPayout) && (
            <p className="text-xs text-muted-foreground text-center">
              Estimated Payout: <span className="font-mono font-medium text-green-500">{selection.estimatedPayout.toFixed(1)}x</span>
            </p>
          )}

          {shouldRenderCrowdSentiment(selection.crowdSentiment) && (
            <p className="text-xs text-muted-foreground text-center">
              Crowd Sentiment: <span className="font-mono font-medium text-foreground">{selection.crowdSentiment}% of the pool is backing this outcome</span>
            </p>
          )}

          {isUpDown && (
            <div className="text-xs text-center space-y-1">
              {isUp && (
                <p className="text-muted-foreground">
                  <span className="text-[#00C853] font-medium">UP</span> wins if <span className="font-medium text-foreground">{selection.marketName}</span> closes above <span className="font-mono font-medium text-foreground">{(selection.startScore ?? 0).toLocaleString("en-US")}</span> at weekly close.
                </p>
              )}
              {isDown && (
                <p className="text-muted-foreground">
                  <span className="text-[#FF0000] font-medium">DOWN</span> wins if <span className="font-medium text-foreground">{selection.marketName}</span> closes below <span className="font-mono font-medium text-foreground">{(selection.startScore ?? 0).toLocaleString("en-US")}</span> at weekly close.
                </p>
              )}
              <p className="text-muted-foreground/70 italic">Exact tie: all positions refunded.</p>
            </div>
          )}

          {isUpDown && (
            <WhatNeedsToHappen
              pick={isUp ? "up" : "down"}
              baselineScore={selection.startScore || selection.baselineScore || 0}
              currentScore={selection.currentScore || 0}
              personName={selection.marketName}
              compact
            />
          )}

          {isUpDown && selection.marketId && (
            <OutcomePathChart
              marketId={selection.marketId}
              baselineScore={selection.startScore || selection.baselineScore || 0}
              currentScore={selection.currentScore || 0}
              personName={selection.marketName}
              compact
              userPick={isUp ? "up" : isDown ? "down" : null}
            />
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Stake Amount</label>
            <Input
              type="number"
              placeholder="Enter credits to stake"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="font-mono"
              data-testid="input-stake"
            />
          </div>

          <div className="flex gap-2">
            {[100, 500, 1000].map((amount) => (
              <Button
                key={amount}
                variant="outline"
                size="sm"
                onClick={() => setStakeAmount(amount.toString())}
                className="flex-1"
                data-testid={`button-preset-${amount}`}
              >
                {amount}
              </Button>
            ))}
          </div>

          <div className="flex items-center justify-between text-xs pt-2 border-t">
            <div>
              <span className="text-muted-foreground">Current Balance: </span>
              <span className="font-mono font-medium">{walletBalance.toLocaleString('en-US')}</span>
            </div>
            <div>
              <span className="text-muted-foreground">After Stake: </span>
              <span className={`font-mono font-medium ${balanceAfter < 0 ? 'text-red-500' : 'text-green-500'}`}>
                {balanceAfter >= 0 ? balanceAfter.toLocaleString('en-US') : 'Insufficient'}
              </span>
            </div>
          </div>
        </div>

        {isUpDown && (
          <MarketResolutionInfo
            baselineScore={selection.startScore || selection.baselineScore || 0}
            baselineTimestamp={selection.baselineTimestamp}
            tieRule={selection.tieRule || "refund"}
            personName={selection.marketName}
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
                            ? "text-yellow-500 fill-yellow-500"
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
            <Button
              ref={confirmButtonRef}
              onClick={handleConfirm}
              className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
              disabled={!stakeAmount || parsedAmount < MIN_STAKE || balanceAfter < 0}
              data-testid="button-confirm-stake"
            >
              Confirm
            </Button>
          ) : (
            <Button
              onClick={() => { onClose(); setLocation("/login"); }}
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
