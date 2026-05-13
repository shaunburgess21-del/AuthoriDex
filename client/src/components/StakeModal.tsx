import { useState, useRef, useEffect } from "react";
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
import { estimateCreditsIfWin, computeEarlyBirdMultiplier } from "@/lib/parimutuel";
import {
  type ApiAmmStateBlock,
  deriveBuyQuote,
  deriveSellQuote,
  pricesFor,
  priceToPercent,
  snapshotFromApi,
} from "@/lib/ammClient";

const MISSION_HEADERS: Record<string, string> = {
  jackpot: "Predict the exact Trend Score at week's end to win the pot.",
  updown: "Will their Trend Score be higher or lower by close?",
  h2h: "Back your champion to win this weekly matchup.",
  gainer: "Pick the biggest mover — whoever gains the most % in their Trend Score wins.",
  community: "Cast your vote on this real-world prediction.",
};

/**
 * AMM markets trade continuously and pay 1 credit per winning share,
 * so the parimutuel "back your champion" / "will their score be higher"
 * framing under-sells the mechanics. We swap in a share-based mission
 * line for the two market types currently flipped to AMM (h2h, updown).
 * Gainer / jackpot / community fall through to MISSION_HEADERS until
 * their AMM flip lands in a later phase.
 */
const AMM_MISSION_HEADERS: Record<string, string> = {
  updown:
    "Buy UP or DOWN shares. Each winning share pays 1 credit at close. Trade until 5 min before close.",
  h2h: "Buy shares of your pick. Winning shares pay 1 credit each at close. Sell anytime before close.",
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
  /**
   * Sub-type for community markets: "binary" | "multi" | "updown".
   * The Yes/No badge + direction toggle are only shown for "multi" —
   * binary community markets already encode the side in the entry
   * label ("Yes" / "No") so the badge would double-print it. When
   * omitted on a community market we render the legacy badge to
   * preserve current behaviour for callers that haven't been
   * updated yet.
   */
  openMarketType?: "binary" | "multi" | "updown" | null;
  /**
   * True when this selection is a follow-up bet on a side the user has
   * already backed. Switches the modal header to "Add to your X stake"
   * and surfaces the user's previous total under the pick card.
   * Same-side only — opposite-side hedges are blocked at the call site.
   */
  isTopUp?: boolean;
  /** Total stake the user already has on this side (sum across prior bets). */
  existingStake?: number;
  /** Market open time — used to calculate the early-bird boost indicator. */
  marketStartAt?: string;
  /**
   * Phase 4 (AMM markets only):
   *   - `engine === 'amm'` flips the modal into LMSR mode: live price
   *     quote, share-based payout framing, no early-bird pill.
   *   - `ammState` is the canonical snapshot from the API; quotes are
   *     computed off it client-side so we don't round-trip on every
   *     keystroke.
   *   - `ammNetShares` is the user's current netShares for THIS entry
   *     (used to enable / disable the Sell tab).
   */
  engine?: "parimutuel" | "amm";
  ammState?: ApiAmmStateBlock | null;
  ammNetShares?: number;
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
  /**
   * AMM-only sell handler. Called with a fractional share count when
   * the user confirms in Sell mode. Parent should call
   * `/api/native-markets/:id/bet` with `actionType:'sell'`.
   */
  onConfirmAmmSell?: (shares: number) => void | Promise<void>;
  walletBalance: number;
  /** Up/Down for `updown` markets, Yes/No for `community` markets.
   *  When provided, the modal renders an in-place toggle so a misclick on
   *  the card doesn't require closing + reopening the modal. */
  onDirectionChange?: (direction: "up" | "down" | "yes" | "no") => void;
  onChangePick?: () => void;
  /**
   * AMM-only intent flag. When set to `"sell"` the modal opens with
   * the Sell tab pre-selected and rewrites the title + mission copy
   * to read as a cash-out action. Defaults to `"buy"`. The user can
   * still flip between Buy and Sell via the tab toggle inside the
   * modal — this prop only seeds the initial mode.
   */
  initialAmmMode?: "buy" | "sell";
  /**
   * Optional live AMM state from the parent. When provided, the
   * modal prefers this over the static `selection.ammState` for
   * quote computation — so as the parent's data refetches every
   * 60 s and other traders move the market, the user sees up-to-
   * date shares/avg/price-impact instead of a stale snapshot from
   * modal-open time. Server is the source of truth on execute, so
   * there's no race; this just keeps the displayed estimate honest.
   *
   * Callers that don't poll (e.g. one-shot home-page renders) can
   * omit this and the modal falls back to the frozen snapshot.
   */
  liveAmmState?: ApiAmmStateBlock | null;
}

const MIN_STAKE = 5;

export function StakeModal({
  open,
  onClose,
  selection,
  onConfirm,
  onConfirmWithMeta,
  onConfirmAmmSell,
  walletBalance,
  onDirectionChange,
  onChangePick,
  initialAmmMode,
  liveAmmState,
}: StakeModalProps) {
  const [stakeAmount, setStakeAmount] = useState("");
  const [ammMode, setAmmMode] = useState<"buy" | "sell">(initialAmmMode ?? "buy");
  const [sellShares, setSellShares] = useState("");
  // Re-seed ammMode whenever the parent's intent changes (e.g. user
  // clicks the inline Sell button on the detail page after the modal
  // has already been opened once for a Buy). Without this the modal
  // would stick to whatever mode was last selected interactively.
  useEffect(() => {
    if (open && initialAmmMode) {
      setAmmMode(initialAmmMode);
    }
  }, [open, initialAmmMode]);
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
  const isUpDown = selection.type === "updown";
  const isH2H = selection.type === "h2h";
  const isGainer = selection.type === "gainer";
  const isCommunity = selection.type === "community";
  const isAmm = selection.engine === "amm";
  const ammNetShares = Number(selection.ammNetShares ?? 0);
  const canSellAmm = isAmm && ammNetShares > 1e-6 && !!onConfirmAmmSell;
  // Prefer the parent-supplied live state when available so quotes
  // re-derive on every refetch (round-2 polish: fixes the 879→898
  // discrepancy reported in smoke testing — the snapshot frozen at
  // modal-open time goes stale fast when agents keep trading).
  const effectiveAmmState = liveAmmState ?? selection.ammState ?? null;
  const ammSnapshot = isAmm ? snapshotFromApi(effectiveAmmState) : null;
  const ammPriceMap = ammSnapshot ? pricesFor(ammSnapshot) : null;
  const ammEntryPrice =
    isAmm && ammPriceMap && selection.entryId
      ? ammPriceMap[selection.entryId] ?? null
      : null;
  /**
   * Polymarket pass: AMM binary-market helpers used by the hero tiles
   * at the top of the modal. The picked-side price is `ammEntryPrice`
   * (already defined above); the opposite side is derived from the
   * snapshot's outcomeOrder so call sites don't need to thread both
   * entry IDs. For multi-outcome AMM markets this picks whichever
   * non-selected entry comes first, which is fine because the hero
   * tiles only render for binary types (updown / h2h).
   */
  const oppositeEntryId =
    isAmm && ammSnapshot && selection.entryId
      ? (ammSnapshot.outcomeOrder ?? []).find((id) => id !== selection.entryId) ?? null
      : null;
  const ammOppositePrice =
    isAmm && ammPriceMap && oppositeEntryId
      ? ammPriceMap[oppositeEntryId] ?? null
      : null;
  const ammBuyQuote = isAmm && ammMode === "buy" && parsedAmount >= MIN_STAKE && selection.entryId
    ? deriveBuyQuote(effectiveAmmState, selection.entryId, parsedAmount)
    : null;
  const parsedSellShares = Number(sellShares);
  const ammSellQuote = isAmm && ammMode === "sell" && Number.isFinite(parsedSellShares) && parsedSellShares > 0 && selection.entryId
    ? deriveSellQuote(effectiveAmmState, selection.entryId, Math.min(parsedSellShares, ammNetShares))
    : null;
  const isCommunityNo = isCommunity && selection.direction === "no";
  // Yes/No badge + toggle is only meaningful for community-multi
  // markets. Binary community markets bake the side into the entry
  // label itself, so showing "(YES) Yes" or "(NO) No" would be
  // redundant. We default to true when openMarketType is missing so
  // legacy callers keep their current rendering.
  const isCommunityMultiSide =
    isCommunity &&
    (selection.openMarketType == null || selection.openMarketType === "multi");
  const isUp = selection.choice.includes("UP");
  const isDown = selection.choice.includes("DOWN");

  const isTopUp = !!selection.isTopUp;
  const isAmmSellMode = isAmm && ammMode === "sell";
  // Sell-mode header: the user reached this modal by clicking a Sell
  // button on the detail page (or by toggling the Sell tab inside an
  // already-open modal), so the title + mission text need to reflect
  // "cash out" intent — not "buy more shares". Builds the side label
  // off `choice` so UP/DOWN reads naturally.
  const sellHeading = (() => {
    if (!isAmmSellMode) return null;
    if (isUpDown) {
      if (isUp) return "Sell UP shares";
      if (isDown) return "Sell DOWN shares";
      return "Sell shares";
    }
    if (isH2H) return `Sell ${selection.personName ?? selection.choice} shares`;
    if (isCommunity) {
      return `Sell ${selection.direction === "no" ? "No" : "Yes"} shares`;
    }
    return "Sell shares";
  })();
  // Header copy. On a follow-up bet we surface "Add to your X stake" so users
  // know the new credits compound onto an existing position rather than
  // creating a separate one. Same-side only — opposite-side hedges are
  // blocked at the call site.
  const topUpHeading = (() => {
    if (!isTopUp) return null;
    if (isUpDown) {
      if (isUp) return "Add to your UP stake";
      if (isDown) return "Add to your DOWN stake";
      return "Add to your stake";
    }
    if (isH2H) return `Add to your ${selection.personName ?? selection.choice} stake`;
    if (isGainer) return `Add to your ${selection.choice} stake`;
    if (isCommunity) {
      return `Add to your ${selection.direction === "no" ? "No" : "Yes"} stake`;
    }
    return "Add to your stake";
  })();
  // Sell mode takes precedence over top-up because a user can only be
  // in one or the other (`isTopUp` is buy-only at the call sites).
  const dialogTitleText = sellHeading ?? topUpHeading ?? "Confirm Prediction";
  const missionText = isAmmSellMode
    ? "Cash out at the live market price. Bigger orders push the price along the curve."
    : isTopUp
      ? "Adding more credits compounds onto your existing position."
      : isAmm && AMM_MISSION_HEADERS[selection.type]
        ? AMM_MISSION_HEADERS[selection.type]
        : MISSION_HEADERS[selection.type] || "Place your prediction on this market.";

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

    const isAmmSell = isAmm && ammMode === "sell" && !!onConfirmAmmSell;
    if (isAmmSell) {
      const sharesToSell = Math.min(parsedSellShares, ammNetShares);
      if (!Number.isFinite(sharesToSell) || sharesToSell <= 0) return;
    } else {
      if (parsedAmount < MIN_STAKE || balanceAfter < 0) return;
    }

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
      let result: void | Promise<void>;
      if (isAmmSell && onConfirmAmmSell) {
        const sharesToSell = Math.min(parsedSellShares, ammNetShares);
        result = onConfirmAmmSell(sharesToSell);
      } else if (onConfirmWithMeta) {
        result = onConfirmWithMeta(parsedAmount, {
          confidence: confidence || undefined,
          thesis: thesis.trim() || undefined,
        });
      } else {
        result = onConfirm(parsedAmount);
      }

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
      setSellShares("");
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
        setSellShares("");
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
            {dialogTitleText}
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
            engine={isAmm ? "amm" : "parimutuel"}
          />
        )}

        <div className="py-2 space-y-4">
          {/* Polymarket pass: hero "Live Market" tiles for binary AMM
              markets (updown + h2h). Puts the live price front-and-centre
              so the user can confirm what they're paying per share before
              their eye even reaches the pick card.

              For Up/Down the tiles also act as the in-modal Up/Down
              toggle — clicking the opposite tile flips the selection
              without closing the modal. This conflates "show prices"
              and "switch sides" into one control, mirroring how
              Polymarket's YES/NO buttons work, and removes the
              redundant chip-on-toggle below. Top-up bets keep the
              tiles passive (no hedging — same rule as the legacy
              toggle).

              H2H tiles stay passive because H2H markets don't carry
              an `onDirectionChange` handler at the call sites yet. */}
          {isAmm && (isUpDown || isH2H) && ammPriceMap && (() => {
            const pickPrice = ammEntryPrice;
            const oppositePrice = ammOppositePrice;
            if (pickPrice == null || oppositePrice == null) return null;

            const canFlip =
              isUpDown && !!onDirectionChange && !isTopUp;

            let pickLabel: string;
            let oppositeLabel: string;
            let pickClass: string;
            let oppositeClass: string;
            // Hover tone for the muted (opposite) tile when it's
            // clickable. Brightens the tone so the affordance reads
            // even though it's the "not picked" side. Empty string
            // for the passive (H2H / top-up) case so we don't apply
            // a phantom hover effect on a non-button.
            let oppositeHoverClass = "";
            if (isUpDown) {
              pickLabel = isUp ? "UP" : "DOWN";
              oppositeLabel = isUp ? "DOWN" : "UP";
              const upTone = "border-[#00C853]/60 bg-[#00C853]/15 text-[#00C853]";
              const downTone = "border-[#FF0000]/60 bg-[#FF0000]/15 text-[#FF0000]";
              const upMuted = "border-[#00C853]/25 bg-[#00C853]/5 text-[#00C853]/70";
              const downMuted = "border-[#FF0000]/25 bg-[#FF0000]/5 text-[#FF0000]/70";
              pickClass = isUp ? upTone : downTone;
              oppositeClass = isUp ? downMuted : upMuted;
              if (canFlip) {
                oppositeHoverClass = isUp
                  ? "hover:border-[#FF0000]/60 hover:bg-[#FF0000]/10 hover:text-[#FF0000]"
                  : "hover:border-[#00C853]/60 hover:bg-[#00C853]/10 hover:text-[#00C853]";
              }
            } else {
              pickLabel = selection.personName ?? "Your pick";
              oppositeLabel = selection.opponentName ?? "Opponent";
              pickClass =
                "border-violet-500/60 bg-violet-500/15 text-violet-700 dark:text-violet-300";
              oppositeClass =
                "border-border/40 bg-muted/30 text-muted-foreground";
            }

            // Shared classes between button & div variants so the
            // visual is identical for clickable / passive renderings.
            const pickTileClass = `rounded-lg border-2 px-3 py-2.5 text-left ${pickClass}`;
            const oppositeTileClass = `rounded-lg border px-3 py-2.5 text-left transition-colors ${oppositeClass} ${oppositeHoverClass}`;

            // Inlined markup (rather than an inner component) so React
            // doesn't see a fresh component type on every parent render,
            // which would otherwise force the tile DOM to remount.
            // Round-2 polish: dropped the `opacity-70` on the cr/share
            // line because the muted-side tile already paints text at
            // `text-[<color>]/70`, and stacking opacities (0.7 × 0.7 =
            // 0.49) made the red DOWN price almost unreadable. Bumped
            // to `font-semibold` so the cr/share reads as a real datum
            // rather than a footnote.
            const pickBody = (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide truncate">
                  {pickLabel}
                </p>
                <p className="text-2xl font-bold leading-tight font-mono">
                  {priceToPercent(pickPrice, 0)}
                </p>
                <p className="text-[11px] font-mono font-semibold">
                  {pickPrice.toFixed(3)} cr/share
                </p>
              </>
            );
            const oppositeBody = (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide truncate">
                  {oppositeLabel}
                </p>
                <p className="text-2xl font-bold leading-tight font-mono">
                  {priceToPercent(oppositePrice, 0)}
                </p>
                <p className="text-[11px] font-mono font-semibold">
                  {oppositePrice.toFixed(3)} cr/share
                </p>
              </>
            );

            // .blur() after tap clears the :focus ring (some browsers
            // still paint a faint focus shadow on `<button>` after touch
            // even with `:hover` gated by hoverOnlyWhenSupported), so the
            // tile snaps cleanly back to muted styling on the new
            // opposite side.
            return (
              <div className="grid grid-cols-2 gap-2" data-testid="amm-hero-tiles">
                {canFlip ? (
                  <button
                    type="button"
                    aria-pressed
                    className={pickTileClass}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onDirectionChange(isUp ? "up" : "down");
                    }}
                    data-testid="amm-hero-tile-pick"
                  >
                    {pickBody}
                  </button>
                ) : (
                  <div className={pickTileClass} data-testid="amm-hero-tile-pick">
                    {pickBody}
                  </div>
                )}
                {canFlip ? (
                  <button
                    type="button"
                    aria-pressed={false}
                    className={oppositeTileClass}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onDirectionChange(isUp ? "down" : "up");
                    }}
                    data-testid="amm-hero-tile-opposite"
                  >
                    {oppositeBody}
                  </button>
                ) : (
                  <div className={oppositeTileClass} data-testid="amm-hero-tile-opposite">
                    {oppositeBody}
                  </div>
                )}
              </div>
            );
          })()}

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
                {isCommunityMultiSide && (
                  <span
                    className={`mr-1.5 px-1.5 py-0.5 rounded text-xs font-mono uppercase align-middle ${
                      isCommunityNo
                        ? "bg-red-500/15 text-[#FF0000]"
                        : "bg-green-500/15 text-[#00C853]"
                    }`}
                  >
                    {selection.direction === "no" ? "No" : "Yes"}
                  </span>
                )}
                <span className="text-foreground">{selection.choice}</span>
              </p>
            ) : (
              <p className="text-lg font-bold">
                <span className="text-muted-foreground text-sm font-medium mr-1.5">Your pick:</span>
                <span className="text-foreground">{selection.choice}</span>
              </p>
            )}

            {isTopUp && typeof selection.existingStake === "number" && selection.existingStake > 0 && (
              <p
                className="mt-1.5 text-xs text-muted-foreground"
                data-testid="stake-modal-existing-stake"
              >
                Currently staked: {selection.existingStake.toLocaleString()} credits.
                Adding more will be combined for the same outcome.
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

            {/* Direction toggles let a user who misclicked on the card
                flip without closing + reopening the modal — useful for a
                fresh pick. When `isTopUp` is true the user is adding to
                an existing position, so flipping the toggle would let
                them sneak past the no-hedging rule (which is enforced
                client-side at the call sites and server-side at place-bet
                time). Hide the toggle in that case so the only path to
                the other side is closing the modal and the lock-out chip
                already greys out the opposite button on the card. */}
            {/* Parimutuel-only Up/Down toggle. AMM Up/Down markets now
                use the clickable hero tiles above as the toggle, so
                rendering this row would just duplicate the same control
                with worse hierarchy. Top-up bets hide the toggle on
                both engines (no hedging). */}
            {isUpDown && onDirectionChange && !isTopUp && !isAmm && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => onDirectionChange("up")}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    isUp
                      ? "bg-[#00C853]/20 border-[#00C853]/60 text-[#00C853]"
                      : "bg-transparent border-slate-700 text-slate-600 dark:text-slate-400 hover:border-[#00C853]/40 hover:text-[#00C853]/60"
                  }`}
                  data-testid="stake-modal-toggle-up"
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
                  data-testid="stake-modal-toggle-down"
                >
                  <TrendingDown className="h-3 w-3" /> Down
                </button>
              </div>
            )}

            {/* Community-market direction toggle — mirrors the upDown one
                so a user who tapped the wrong side on the card can flip
                without closing + reopening the modal. Only relevant on
                multi-option community markets; binary community markets
                pick the side via the entry label itself. Hidden when
                isTopUp for the same no-hedging reason as native above. */}
            {isCommunity && isCommunityMultiSide && onDirectionChange && !isTopUp && (
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

          {!isAmm && selection.estimatedPayout && !isNaN(selection.estimatedPayout) && (
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

          {/* Polymarket pass: the AMM receipt (Payout / shares / final
              price) now renders BELOW the credit input so it updates
              directly under what the user is typing. Find the restyled
              block right after the input + presets. The slot here keeps
              parimutuel's Early Bird Boost pill in place below. */}

          {!isAmm && (() => {
            let startRef = selection.marketStartAt ?? selection.baselineTimestamp;
            if (!startRef && selection.endAt) {
              const d = new Date(selection.endAt);
              d.setUTCDate(d.getUTCDate() - 7);
              startRef = d.toISOString();
            }
            const boost = computeEarlyBirdMultiplier(
              new Date(),
              startRef,
              selection.bettingCutoff,
            );
            if (boost <= 1.05) return null;
            return (
              <div className="flex items-center justify-center gap-1.5 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-amber-800 dark:text-amber-300 font-medium">
                  <Star className="h-3 w-3" />
                  Early Bird Boost: {boost.toFixed(1)}x
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground">
                      <HelpCircle className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="text-xs max-w-64 space-y-1.5" side="top">
                    <p>
                      Predict earlier in the week to earn a bigger share of the winnings.
                      Monday bettors get up to 1.5x weight — the boost decays linearly to 1x at cutoff.
                    </p>
                    <p className="text-muted-foreground">
                      Boost only redistributes the losing side's pool, so correct picks always at least get their stake back.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
            );
          })()}

          {!isAmm &&
            (shouldRenderCrowdSentiment(selection.crowdSentiment) ||
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
                  {chartOpen ? "Hide" : "Show"} this week's chart
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
                  ammUpEntryId={
                    isAmm && isUpDown
                      ? isUp
                        ? selection.entryId ?? null
                        : oppositeEntryId
                      : null
                  }
                />
              )}
            </div>
          )}

          {isAmm && canSellAmm && (
            <div className="flex gap-2 rounded-md border border-border/50 p-1 bg-muted/30">
              <button
                type="button"
                onClick={() => setAmmMode("buy")}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  ammMode === "buy"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid="button-amm-tab-buy"
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setAmmMode("sell")}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  ammMode === "sell"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid="button-amm-tab-sell"
              >
                Sell · {ammNetShares.toFixed(2)} shares
              </button>
            </div>
          )}

          {isAmm && ammMode === "sell" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Shares to sell</label>
              <Input
                type="number"
                min={0}
                max={ammNetShares}
                step="any"
                placeholder={`Up to ${ammNetShares.toFixed(2)} shares`}
                value={sellShares}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setSellShares("");
                    return;
                  }
                  const n = Number(v);
                  if (!Number.isFinite(n)) {
                    setSellShares(v);
                    return;
                  }
                  setSellShares(String(Math.max(0, Math.min(n, ammNetShares))));
                }}
                className="font-mono"
                data-testid="input-amm-sell-shares"
              />
              <div className="flex gap-2">
                {[0.25, 0.5, 1].map((frac) => {
                  const amount = Math.max(0, ammNetShares * frac);
                  return (
                    <Button
                      key={frac}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSellShares(amount > 0 ? amount.toFixed(4) : "")}
                      className="flex-1"
                      data-testid={`button-sell-preset-${Math.round(frac * 100)}`}
                    >
                      {frac === 1 ? "All" : `${Math.round(frac * 100)}%`}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {isAmm ? "Credit budget" : "Stake Amount"}
                </label>
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
            </>
          )}

          {/* Polymarket pass: restyled AMM receipt. Big "Payout if win"
              number is the hero; share count + avg price are demoted to
              a secondary line. Lives directly under the input + presets
              so the receipt updates immediately as the user types — the
              same pattern Polymarket uses with their "To win $X" line.
              Slippage warning still surfaces on >=1pp moves. */}
          {isAmm && ammEntryPrice != null && (() => {
            const buyFinalPrice =
              ammMode === "buy" && ammBuyQuote && ammBuyQuote.shares > 0 && selection.entryId
                ? Number(ammBuyQuote.newPrices[selection.entryId] ?? 0)
                : null;
            const sellFinalPrice =
              ammMode === "sell" && ammSellQuote && selection.entryId
                ? Number(ammSellQuote.newPrices[selection.entryId] ?? 0)
                : null;
            const finalPrice = buyFinalPrice ?? sellFinalPrice;
            const showSlippage =
              finalPrice != null && Math.abs(finalPrice - ammEntryPrice) >= 0.01;

            const isBuyMode = ammMode === "buy";
            const hasBuyQuote = isBuyMode && ammBuyQuote && ammBuyQuote.shares > 0;
            const hasSellQuote = !isBuyMode && ammSellQuote;
            // Direction-aware label for the "shares" line so it reads
            // naturally on Up/Down ("226 UP shares") and falls back to
            // a neutral "shares" everywhere else.
            const sideShareLabel = isUpDown
              ? isUp
                ? "UP shares"
                : "DOWN shares"
              : "shares";

            // Receipt header copy switches between buy and sell to make
            // the primary number unambiguous: "Payout if win" in buy
            // mode, "Sell proceeds" in sell mode.
            const heroLabel = isBuyMode ? "PAYOUT IF WIN" : "SELL PROCEEDS";

            return (
              <div
                className="rounded-md border border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/5 px-3 py-2.5 text-xs space-y-2"
                data-testid="amm-receipt-card"
              >
                <div className="flex items-end justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {heroLabel}
                      </p>
                      {/* Live indicator: shown only when parent passed a
                          fresh ammState via `liveAmmState`. Pulsing dot
                          conveys "this estimate updates as the market
                          moves" without taking real estate. */}
                      {liveAmmState != null && (hasBuyQuote || hasSellQuote) && (
                        <span
                          className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
                          data-testid="amm-receipt-live-indicator"
                        >
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          </span>
                          Live
                        </span>
                      )}
                    </div>
                    {hasBuyQuote && ammBuyQuote ? (
                      <p className="text-2xl font-bold leading-tight font-mono text-green-700 dark:text-green-500">
                        ~{Math.floor(ammBuyQuote.shares).toLocaleString("en-US")}{" "}
                        <span className="text-base font-medium">cr</span>
                      </p>
                    ) : hasSellQuote && ammSellQuote ? (
                      <p className="text-2xl font-bold leading-tight font-mono text-green-700 dark:text-green-500">
                        +{ammSellQuote.proceeds.toLocaleString("en-US")}{" "}
                        <span className="text-base font-medium">cr</span>
                      </p>
                    ) : (
                      <p className="text-2xl font-bold leading-tight font-mono text-muted-foreground/50">
                        — cr
                      </p>
                    )}
                  </div>
                  {hasBuyQuote && ammBuyQuote && (
                    <span
                      className="shrink-0 inline-flex items-center rounded-full bg-green-500/15 text-green-700 dark:text-green-400 px-2 py-0.5 text-[10px] font-mono font-semibold"
                      data-testid="amm-receipt-net"
                    >
                      +{Math.max(0, Math.floor(ammBuyQuote.shares) - ammBuyQuote.chargeCredits).toLocaleString("en-US")} net
                    </span>
                  )}
                </div>

                {hasBuyQuote && ammBuyQuote && (
                  <p className="text-[11px] font-mono text-muted-foreground border-t border-violet-500/15 pt-1.5">
                    {ammBuyQuote.shares.toFixed(2)} {sideShareLabel}
                    <span className="text-muted-foreground/70">
                      {" · Avg price "}
                      {ammBuyQuote.pricePerShareAvg.toFixed(3)} cr/share
                    </span>
                  </p>
                )}

                {hasSellQuote && ammSellQuote && (
                  <p className="text-[11px] font-mono text-muted-foreground border-t border-violet-500/15 pt-1.5">
                    Selling {Math.min(parsedSellShares, ammNetShares).toFixed(2)} {sideShareLabel}
                    <span className="text-muted-foreground/70">
                      {" · Avg price "}
                      {/* Use the *quote's* avg (proceeds / shares)
                          instead of ammEntryPrice — that's the start
                          price, not what you actually receive. For
                          large sells the curve walks down as you go,
                          so avg < entry by a noticeable margin and
                          that gap IS where the "I lost 1 credit on
                          round-trip" credits live. Matches the buy
                          receipt's framing one row up. */}
                      {ammSellQuote.pricePerShareAvg.toFixed(3)} cr/share
                    </span>
                  </p>
                )}

                {!hasBuyQuote && !hasSellQuote && (
                  <p className="text-[11px] text-muted-foreground/70 italic border-t border-violet-500/15 pt-1.5">
                    {isBuyMode
                      ? `Enter at least ${MIN_STAKE} credits to see your potential payout.`
                      : "Enter shares to sell to see proceeds."}
                  </p>
                )}

                {/* Price impact: shown only when the order moves the LMSR
                    price by >=1pp. Mirrors Polymarket's "Avg price / max
                    price" disclosure so users twig that bigger orders
                    push the price along the curve. The avg-price line
                    above already shows the effective per-share cost; this
                    line surfaces the *post-trade* price so users see
                    where the next buyer would enter. */}
                {showSlippage && finalPrice != null && (
                  <div className="text-[10px] font-mono text-amber-700 dark:text-amber-400 flex items-center gap-1 flex-wrap">
                    <span>
                      Price impact: {priceToPercent(ammEntryPrice, 0)} → {priceToPercent(finalPrice, 0)}
                    </span>
                    <span className="text-amber-700/70 dark:text-amber-400/70">
                      ({finalPrice > ammEntryPrice ? "+" : ""}
                      {((finalPrice - ammEntryPrice) * 100).toFixed(1)} pts)
                    </span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="text-amber-700/70 dark:text-amber-400/70 hover:text-amber-700 dark:hover:text-amber-400"
                          aria-label="What is price impact?"
                        >
                          <HelpCircle className="h-3 w-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="text-xs max-w-64 space-y-1.5" side="top">
                        <p className="font-semibold">Price impact</p>
                        {hasSellQuote ? (
                          <p>
                            Big sells push the share price down as
                            they fill. Your{" "}
                            <span className="font-semibold">Avg price</span>{" "}
                            above already factors this in — it's
                            what you'll actually receive per share.
                          </p>
                        ) : (
                          <p>
                            Big buys push the share price up as
                            they fill. Your{" "}
                            <span className="font-semibold">Avg price</span>{" "}
                            above already factors this in — it's
                            what you'll actually pay per share.
                          </p>
                        )}
                        <p className="text-muted-foreground">
                          The arrow shows where the market price
                          settles after your trade.{" "}
                          <span className="italic">pts</span> =
                          percentage points (e.g. 55% → 58% is
                          +3 pts).
                        </p>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}

                {/* Spread / round-trip hint. Only on sell mode —
                    answers the common "I bought for 500, sold for
                    499, where did 1 credit go?" question. Kept
                    deliberately general so it also reads correctly
                    for users sitting on a winning or losing
                    position (where the price move dwarfs the
                    spread). Muted so it doesn't dominate; users
                    who don't care just see "sell proceeds: X" and
                    move on. */}
                {hasSellQuote && (
                  <p className="text-[10px] text-muted-foreground/70 leading-snug border-t border-violet-500/15 pt-1.5">
                    A small spread applies on every trade — selling
                    nudges the price down the curve, so proceeds
                    are a touch below the live price × shares.
                    Already factored above.
                  </p>
                )}

                {/* Live-quote disclaimer. Only shown when the parent
                    is feeding us `liveAmmState` (so the receipt is
                    actually re-deriving on each refetch) AND the
                    user has a real quote in front of them. Without
                    these guards we'd be lying ("Live estimate" while
                    the modal is using a stale snapshot) or pointless
                    ("Live estimate" next to "Enter at least 5
                    credits..."). */}
                {liveAmmState != null && (hasBuyQuote || hasSellQuote) && (
                  <p className="text-[10px] text-muted-foreground/70 leading-snug">
                    Live estimate — actual{" "}
                    {hasSellQuote ? "proceeds" : "shares"} depend on
                    the price at the moment your trade executes.
                  </p>
                )}
              </div>
            );
          })()}

          <div className="flex items-center justify-between text-xs pt-2 border-t">
            <div>
              <span className="text-muted-foreground">Current Balance: </span>
              <span className="font-mono font-medium">{walletBalance.toLocaleString('en-US')}</span>
            </div>
            {isAmm && ammMode === "sell" ? (
              <div>
                <span className="text-muted-foreground">After Sell: </span>
                <span className="font-mono font-medium text-green-700 dark:text-green-500">
                  +{(ammSellQuote?.proceeds ?? 0).toLocaleString('en-US')}
                </span>
              </div>
            ) : (
              <div>
                <span className="text-muted-foreground">{isAmm ? "After Buy: " : "After Stake: "}</span>
                <span className={`font-mono font-medium ${balanceAfter < 0 ? 'text-red-700 dark:text-red-500' : 'text-green-700 dark:text-green-500'}`}>
                  {balanceAfter >= 0 ? balanceAfter.toLocaleString('en-US') : 'Insufficient'}
                </span>
              </div>
            )}
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
            engine={isAmm ? "amm" : "parimutuel"}
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
                disabled={(() => {
                  if (submitting) return true;
                  if (isAmm && ammMode === "sell") {
                    return !parsedSellShares || parsedSellShares <= 0 || parsedSellShares > ammNetShares + 1e-6;
                  }
                  return !stakeAmount || parsedAmount < MIN_STAKE || balanceAfter < 0;
                })()}
                data-testid="button-confirm-stake"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    {isAmm && ammMode === "sell" ? "Selling…" : "Placing…"}
                  </>
                ) : (
                  isAmm && ammMode === "sell" ? "Sell" : (isAmm ? "Buy" : "Confirm")
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
