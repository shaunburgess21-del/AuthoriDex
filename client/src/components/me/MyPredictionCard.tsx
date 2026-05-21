import { useState } from "react";
import {
  Clock,
  CheckCircle,
  XCircle,
  Target,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Share2,
  Check,
} from "lucide-react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PersonAvatar } from "@/components/PersonAvatar";
import { OutcomePathChart } from "@/components/predict/OutcomePathChart";
import { inferPredictionDirection } from "@/pages/me/predictions-utils";
import { getRecentActivityMarketPath } from "@/lib/predict-display";
import { cn } from "@/lib/utils";
import { formatVox } from "@/lib/currency";

export interface MyPredictionCardData {
  betId: string;
  marketId: string;
  marketSlug: string;
  marketTitle: string;
  marketStatus: string;
  marketType: string;
  marketCadence: string;
  marketCategory: string;
  entryLabel: string;
  stakeAmount: number;
  potentialPayout: number;
  /** Decimal odds at bet time (potentialPayout / stakeAmount). */
  oddsAtBet?: number | null;
  result: "won" | "lost" | "refunded" | "pending";
  payout: number;
  baselineScore: number;
  currentScore: number;
  betCreatedAt: string;
  personName: string | null;
  personAvatar: string | null;
  startAt: string;
  endAt: string;
  resolutionSummary?: string | null;
  hidden?: boolean;
  /** Phase 4: AMM markets render different copy (shares-based, no per-bet projection). */
  engine?: "parimutuel" | "amm" | string | null;
}

interface MyPredictionCardProps {
  prediction: MyPredictionCardData;
  profileIsPrivate?: boolean;
  onToggleVisibility?: (prediction: MyPredictionCardData, nextHidden: boolean) => void;
  isPending?: boolean;
  /** When true, the card body shows an Open-markets-style layout (countdown + projected P/L, no expand). */
  openMode?: boolean;
  onShareWin?: (prediction: MyPredictionCardData) => void;
  didJustShare?: boolean;
}

function formatScore(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

function formatDate(ts: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCountdown(iso: string): string {
  if (!iso) return "";
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return "";
  const now = Date.now();
  const diff = end - now;
  if (diff <= 0) return "Closed";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

function getStatusBadge(status: MyPredictionCardData["result"]) {
  switch (status) {
    case "pending":
      return (
        <Badge className="bg-blue-500/25 dark:bg-blue-500/20 text-blue-500 dark:text-blue-300 border-blue-500/40 dark:border-blue-500/30 gap-1">
          <Clock className="h-3 w-3" /> Active
        </Badge>
      );
    case "won":
      return (
        <Badge className="bg-green-500/25 dark:bg-green-500/20 text-green-500 dark:text-green-300 border-green-500/40 dark:border-green-500/30 gap-1">
          <CheckCircle className="h-3 w-3" /> Won
        </Badge>
      );
    case "lost":
      return (
        <Badge className="bg-red-500/25 dark:bg-red-500/20 text-red-500 dark:text-red-300 border-red-500/40 dark:border-red-500/30 gap-1">
          <XCircle className="h-3 w-3" /> Lost
        </Badge>
      );
    case "refunded":
      return (
        <Badge className="bg-zinc-500/25 dark:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-zinc-500/40 dark:border-zinc-500/30">
          Refunded
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function getDirectionIcon(direction: string, result?: MyPredictionCardData["result"]) {
  const won = result === "won";
  switch (direction) {
    case "up":
      return (
        <TrendingUp
          className={cn(
            "h-4 w-4",
            won ? "text-emerald-500 dark:text-emerald-400" : "text-green-600 dark:text-green-400",
          )}
        />
      );
    case "down":
      return (
        <TrendingDown
          className={cn(
            "h-4 w-4",
            won ? "text-emerald-500 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
          )}
        />
      );
    default:
      return <Target className="h-4 w-4 text-violet-600 dark:text-violet-400" />;
  }
}

export function MyPredictionCard({
  prediction,
  profileIsPrivate = false,
  onToggleVisibility,
  isPending = false,
  openMode = false,
  onShareWin,
  didJustShare = false,
}: MyPredictionCardProps) {
  const [, setLocation] = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const hidden = prediction.hidden === true;

  const direction = inferPredictionDirection(prediction.entryLabel);
  const delta = (prediction.currentScore || 0) - (prediction.baselineScore || 0);
  const pctDelta =
    prediction.baselineScore > 0
      ? ((delta / prediction.baselineScore) * 100).toFixed(1)
      : "0";
  const isResolved = prediction.result === "won" || prediction.result === "lost";
  const isAmm = prediction.engine === "amm";
  const payoutDisplay = isResolved
    ? prediction.payout
    : prediction.potentialPayout || prediction.payout;
  const pnl = prediction.result === "won"
    ? prediction.payout - prediction.stakeAmount
    : prediction.result === "lost"
      ? -prediction.stakeAmount
      : 0;
  const projectedPnl = prediction.result === "pending"
    ? (prediction.potentialPayout || 0) - prediction.stakeAmount
    : pnl;

  const effectivelyPublic = !profileIsPrivate && !hidden;

  const toggleLabel = hidden
    ? "Hidden from your public profile. Click to make visible."
    : profileIsPrivate
      ? "Your profile is private. This would be hidden from others."
      : "Visible on your public profile. Click to hide.";

  const marketDetailPath = getRecentActivityMarketPath(
    prediction.marketSlug,
    prediction.marketType,
    prediction.marketId,
  );

  const handleCardClick = () => {
    if (openMode) {
      if (marketDetailPath !== "/predict") {
        setLocation(marketDetailPath);
      }
      return;
    }
    setIsExpanded((v) => !v);
  };

  // Outcome-coded left border for instant scanability. Semantic, not decorative.
  const outcomeBorderClass =
    prediction.result === "won"
      ? "border-l-2 border-l-emerald-500/60"
      : prediction.result === "lost"
        ? "border-l-2 border-l-rose-500/60"
        : prediction.result === "refunded"
          ? "border-l-2 border-l-slate-500/60"
          : "border-l-2 border-l-blue-500/60";

  return (
    <Card
      className={cn(
        "group relative overflow-hidden cursor-pointer border-white/5 bg-card/60 backdrop-blur-sm",
        "transition-all duration-150",
        outcomeBorderClass,
        !hidden && "hover:border-white/10 hover:-translate-y-0.5 hover:shadow-md hover:bg-accent/5",
      )}
      data-testid={`prediction-item-${prediction.betId}`}
      data-prediction-hidden={hidden ? "true" : "false"}
      onClick={handleCardClick}
    >
      {/* Hidden state: faint diagonal stripe overlay so hidden cards read at a glance. */}
      {hidden && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 opacity-30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 6px, rgba(148,163,184,0.18) 6px 12px)",
          }}
        />
      )}

      <div
        className={cn(
          "relative p-4 sm:p-5 transition-opacity",
          hidden && "opacity-60",
        )}
      >
        <div className="flex items-start gap-3 mb-3">
          {prediction.personName && (
            <PersonAvatar
              name={prediction.personName}
              avatar={prediction.personAvatar}
              size="sm"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm leading-snug line-clamp-2">
              {prediction.marketTitle || "Prediction"}
            </p>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
              {getDirectionIcon(direction, prediction.result)}
              <span>
                Picked:{" "}
                <span className="text-foreground font-medium">
                  {prediction.entryLabel || "Unknown"}
                </span>
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0 pr-8">
            {getStatusBadge(prediction.result)}
            {!openMode && (
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded((v) => !v);
                }}
                aria-label={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        {prediction.baselineScore > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mb-3">
            <span>
              Baseline:{" "}
              <span className="font-mono text-foreground">{formatScore(prediction.baselineScore)}</span>
            </span>
            <span>
              {isResolved ? "Close" : "Current"}:{" "}
              <span className="font-mono text-foreground">{formatScore(prediction.currentScore)}</span>
            </span>
            <span
              className={cn(
                "font-mono font-medium",
                delta >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
              )}
            >
              {delta >= 0 ? "+" : ""}
              {formatScore(delta)} ({delta >= 0 ? "+" : ""}
              {pctDelta}%)
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            Stake:{" "}
            <span className="text-foreground font-medium">{formatVox(prediction.stakeAmount)}</span>
          </span>
          {payoutDisplay > 0 && (
            <span
              className={
                prediction.result === "lost"
                  ? "text-red-600 dark:text-red-400"
                  : "text-green-600 dark:text-green-400"
              }
            >
              {isResolved ? "" : "Est. "}
              {prediction.result === "lost" ? "−" : "+"}
              {formatVox(payoutDisplay)}
            </span>
          )}
          <span className="text-muted-foreground ml-auto">
            {openMode && prediction.endAt ? formatCountdown(prediction.endAt) : formatDate(prediction.betCreatedAt)}
          </span>
        </div>

        {isResolved && prediction.resolutionSummary && (
          <p
            className="mt-2 text-xs italic text-muted-foreground leading-snug"
            data-testid={`resolution-summary-${prediction.betId}`}
          >
            {prediction.resolutionSummary}
          </p>
        )}

        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {prediction.marketCategory && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {prediction.marketCategory}
            </Badge>
          )}
          {prediction.marketCadence && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {prediction.marketCadence}
            </Badge>
          )}
          {isAmm && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              title="Live-priced market — each winning share pays Ꝟ1 at settlement"
            >
              Live price
            </Badge>
          )}
          {hidden && (
            <Badge
              variant="outline"
              className="h-5 gap-1 border-foreground/20 bg-background/60 text-[10px] font-normal text-muted-foreground"
            >
              <EyeOff className="h-3 w-3" /> Hidden
            </Badge>
          )}
          {!hidden && profileIsPrivate && (
            <Badge
              variant="outline"
              className="h-5 gap-1 border-foreground/20 bg-background/60 text-[10px] font-normal text-muted-foreground"
            >
              <EyeOff className="h-3 w-3" /> Profile private
            </Badge>
          )}
          {effectivelyPublic && onToggleVisibility && (
            <Badge
              variant="outline"
              className="h-5 gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] font-normal text-emerald-600 dark:text-emerald-300"
            >
              <Eye className="h-3 w-3" /> Public
            </Badge>
          )}
          {openMode && projectedPnl !== 0 && (
            <Badge
              variant="outline"
              className={cn(
                "h-5 gap-1 text-[10px] font-normal",
                projectedPnl >= 0
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
              )}
            >
              {projectedPnl >= 0 ? "+" : ""}
              {projectedPnl.toLocaleString()} projected
            </Badge>
          )}
          {prediction.result === "won" && onShareWin && !openMode && (
            <button
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
                "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
                "hover:border-amber-500/50 hover:bg-amber-500/20 hover:text-amber-500 dark:hover:text-amber-200",
              )}
              title="Share this win"
              onClick={(e) => {
                e.stopPropagation();
                onShareWin(prediction);
              }}
            >
              {didJustShare ? (
                <Check className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
              ) : (
                <Share2 className="h-3 w-3" />
              )}
              {didJustShare ? "Copied" : "Share Win"}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!openMode && isExpanded && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-t border-border/50 bg-muted/5 p-4 space-y-4">
              {prediction.marketId && prediction.marketType === "native" && (
                <OutcomePathChart
                  marketId={prediction.marketId}
                  baselineScore={prediction.baselineScore}
                  currentScore={prediction.currentScore}
                  personName={prediction.personName || "Person"}
                  compact
                  userPick={direction === "up" ? "up" : direction === "down" ? "down" : null}
                />
              )}

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1">
                  <p className="text-muted-foreground">Change since baseline</p>
                  <p
                    className={cn(
                      "font-mono font-semibold",
                      delta >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {delta >= 0 ? "+" : ""}
                    {delta.toLocaleString("en-US")} ({delta >= 0 ? "+" : ""}
                    {pctDelta}%)
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Market Window</p>
                  <p className="text-foreground">
                    {formatDate(prediction.startAt)} — {formatDate(prediction.endAt)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Market Status</p>
                  <p className="text-foreground capitalize">{prediction.marketStatus}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Market Type</p>
                  <p className="text-foreground capitalize">{prediction.marketType}</p>
                </div>
              </div>

              {marketDetailPath !== "/predict" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocation(marketDetailPath);
                  }}
                >
                  View Market
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Visibility toggle sits outside the body wrapper so it stays crisp when the card
         is hidden (body fades to opacity-60). Hit target padded to >=44px for touch. */}
      {onToggleVisibility && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(prediction, !hidden);
              }}
              disabled={isPending}
              aria-pressed={hidden}
              aria-label={hidden ? "Make visible on public profile" : "Hide from public profile"}
              className={cn(
                "absolute right-1.5 top-1.5 z-10 inline-flex h-11 w-11 items-center justify-center rounded-md",
                "text-muted-foreground transition-opacity duration-150",
                "hover:bg-muted/60 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100",
                "disabled:cursor-not-allowed disabled:opacity-50",
                hidden
                  ? "opacity-100 text-foreground/80"
                  : "opacity-40 hover:opacity-100 group-hover:opacity-100",
              )}
              data-testid={`toggle-visibility-${prediction.betId}`}
            >
              {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[220px] text-xs">
            {toggleLabel}
          </TooltipContent>
        </Tooltip>
      )}
    </Card>
  );
}
