import { useState, useRef } from "react";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Target, LogIn, Star, MessageSquarePlus, HelpCircle, Lock, Gift, Loader2, ChevronDown, ArrowRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { useReferralModal } from "@/components/referral/ReferralModalProvider";
import { navigateToLogin } from "@/lib/authReturn";
import { MarketResolutionInfo } from "@/components/predict/MarketResolutionInfo";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { WhatNeedsToHappen } from "@/components/predict/WhatNeedsToHappen";
import { OutcomePathChart } from "@/components/predict/OutcomePathChart";
import { RULES_CONTENT, RulesExplainer } from "@/components/predict/RulesContent";
import {
  type ApiAmmStateBlock,
  deriveBuyQuote,
  pricesFor,
  priceToPercent,
  snapshotFromApi,
} from "@/lib/ammClient";
import { CURRENCY, formatVox, formatVoxPrice, voxWord } from "@/lib/currency";
import { CREDIT_ACTIONS } from "@shared/credit-config";

// Referral reward derives from credit-config so the out-of-Vox nudge
// tracks the real award amount (same pattern as ReferAFriendCard).
const REFERRAL_REWARD =
  CREDIT_ACTIONS.find((a) => a.key === "referral_completed")
    ?.proposedCredits ?? 0;

/**
 * AMM mission copy — all non-jackpot StakeModal flows are LMSR now.
 * Jackpot uses its own JackpotEntryModal so it never lands here.
 */
const MISSION_HEADERS: Record<string, string> = {
  updown:
    "Buy UP or DOWN shares. Each winning share pays Ꝟ1 at close — cheaper shares pay bigger multiples. Trade until 5 min before close.",
  h2h: "Buy shares of your pick. Winning shares pay Ꝟ1 each at close — cheaper shares pay bigger multiples. Sell anytime before close.",
  gainer:
    "Buy shares of the candidate you think will gain the most. Each winning share pays Ꝟ1 at close — cheaper underdog shares pay bigger multiples.",
  community:
    "Buy Yes or No shares. Each winning share pays Ꝟ1 on resolution — cheaper shares pay bigger multiples. Sell anytime before close.",
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
  baselineScore?: number;
  baselineTimestamp?: string;
  /** AMM always voids on tie, but H2H / Up/Down detail UIs still pass
   *  this through to drive "Exact tie: refund" copy. Defaults to
   *  "refund" wherever read. */
  tieRule?: string;
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
  /**
   * AMM state for live quote computation:
   *   - `ammState` is the canonical snapshot from the API; quotes are
   *     computed off it client-side so we don't round-trip on every
   *     keystroke.
   *   - `ammNetShares` is the user's current netShares for THIS entry.
   *     Unused by the modal since selling moved to CashOutSheet, but
   *     call sites still populate it; kept for compatibility.
   *   - `engine` is kept for backward compat but always treated as AMM
   *     post-parimutuel-sunset. Future cleanup can drop it entirely.
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
   *
   * The optional `meta.maxPricePerShare` is a 5% cap above the modal's
   * live quote, applied automatically (not user-configurable). Parents
   * should forward it into the trade route so `executeBuy` can abort
   * with `slippage_exceeded` when the market moves before execution.
   * Callers that don't forward it opt out of protection.
   */
  onConfirm: (
    amount: number,
    meta?: { maxPricePerShare?: number },
  ) => void | Promise<void>;
  onConfirmWithMeta?: (
    amount: number,
    meta: { confidence?: number; thesis?: string; maxPricePerShare?: number },
  ) => void | Promise<void>;
  walletBalance: number;
  /** Up/Down for `updown` markets, Yes/No for `community` markets.
   *  When provided, the modal renders an in-place toggle so a misclick on
   *  the card doesn't require closing + reopening the modal. */
  onDirectionChange?: (direction: "up" | "down" | "yes" | "no") => void;
  onChangePick?: () => void;
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
/** Fixed quote-to-execution guard (not exposed in the UI). */
const DEFAULT_SLIPPAGE_TOLERANCE = 0.05;

export function StakeModal({
  open,
  onClose,
  selection,
  onConfirm,
  onConfirmWithMeta,
  walletBalance,
  onDirectionChange,
  onChangePick,
  liveAmmState,
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
  const { open: openReferralModal } = useReferralModal();
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
  const effectiveAmmState = liveAmmState ?? selection.ammState ?? null;
  const ammSnapshot = snapshotFromApi(effectiveAmmState);
  const ammPriceMap = ammSnapshot ? pricesFor(ammSnapshot) : null;
  const ammEntryPrice =
    ammPriceMap && selection.entryId
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
    ammSnapshot && selection.entryId
      ? (ammSnapshot.outcomeOrder ?? []).find((id) => id !== selection.entryId) ?? null
      : null;
  const ammOppositePrice =
    ammPriceMap && oppositeEntryId
      ? ammPriceMap[oppositeEntryId] ?? null
      : null;
  const ammBuyQuote = parsedAmount >= MIN_STAKE && selection.entryId
    ? deriveBuyQuote(effectiveAmmState, selection.entryId, parsedAmount)
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
  // Header copy. On a follow-up bet we surface "Add to your X stake" so users
  // know the new Vox compounds onto an existing position rather than
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
  const dialogTitleText = topUpHeading ?? "Confirm Prediction";
  const missionText = isTopUp
    ? "Adding more Vox compounds onto your existing position."
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

    if (parsedAmount < MIN_STAKE || balanceAfter < 0) return;

    let confettiOrigin: { x: number; y: number } | null = null;
    if (confirmButtonRef.current) {
      const rect = confirmButtonRef.current.getBoundingClientRect();
      confettiOrigin = {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      };
    }

    // Derive the quote-staleness cap from the live AMM price and
    // DEFAULT_SLIPPAGE_TOLERANCE. Clamp into the LMSR domain (0, 1] so
    // price * (1 + tolerance) > 1 doesn't no-op on the server.
    const maxPricePerShare =
      ammEntryPrice != null
        ? Math.min(1, ammEntryPrice * (1 + DEFAULT_SLIPPAGE_TOLERANCE))
        : undefined;

    setSubmitting(true);
    try {
      let result: void | Promise<void>;
      if (onConfirmWithMeta) {
        result = onConfirmWithMeta(parsedAmount, {
          confidence: confidence || undefined,
          thesis: thesis.trim() || undefined,
          maxPricePerShare,
        });
      } else {
        result = onConfirm(parsedAmount, { maxPricePerShare });
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
            engine="amm"
            marketKind={
              selection.type === "updown" ||
              selection.type === "h2h" ||
              selection.type === "gainer" ||
              selection.type === "jackpot"
                ? selection.type
                : undefined
            }
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
          {(isUpDown || isH2H) && ammPriceMap && (() => {
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
            // Round-2 polish: dropped the `opacity-70` on the Ꝟ/share
            // line because the muted-side tile already paints text at
            // `text-[<color>]/70`, and stacking opacities (0.7 × 0.7 =
            // 0.49) made the red DOWN price almost unreadable. Bumped
            // to `font-semibold` so the Ꝟ/share reads as a real datum
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
                  {formatVoxPrice(pickPrice, 3)}/share
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
                  {formatVoxPrice(oppositePrice, 3)}/share
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
                Currently staked: {voxWord(selection.existingStake)}.
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

            {/* Up/Down toggle for AMM Up/Down markets is rendered via the
                clickable hero tiles above this card — no separate row
                needed. Yes/No toggle for community-multi markets stays
                below. */}

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
                    isUpDown
                      ? isUp
                        ? selection.entryId ?? null
                        : oppositeEntryId
                      : null
                  }
                />
              )}
            </div>
          )}

          <>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Vox budget
                </label>
                <Input
                  type="number"
                  min={MIN_STAKE}
                  max={walletBalance}
                  placeholder="Enter Vox to stake"
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
                      title={capped < amount ? `Stakes ${formatVox(capped)} (your balance)` : undefined}
                      className="flex-1"
                      data-testid={`button-preset-${amount}`}
                    >
                      {amount}
                    </Button>
                  );
                })}
                {/* Tier 1.2: Max chip clamps to wallet balance (with a
                    hard ceiling at 99,999 so a power user with millions
                    of Vox doesn't accidentally one-click an entire
                    market). Disabled when balance is below MIN_STAKE so
                    a 0-balance user can't tap into a no-op. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={walletBalance < MIN_STAKE}
                  onClick={() => {
                    const maxStake = Math.min(walletBalance, 99999);
                    if (maxStake >= MIN_STAKE) setStakeAmount(String(maxStake));
                  }}
                  title={`Stakes ${formatVox(Math.min(walletBalance, 99999))} (capped at your balance)`}
                  className="flex-1"
                  data-testid="button-preset-max"
                >
                  Max
                </Button>
              </div>
          </>

          {/* Polymarket pass: restyled AMM receipt. Big "Payout if win"
              number is the hero; share count + avg price are demoted to
              a secondary line. Lives directly under the input + presets
              so the receipt updates immediately as the user types — the
              same pattern Polymarket uses with their "To win $X" line.
              Slippage warning still surfaces on >=1pp moves. */}
          {ammEntryPrice != null && (() => {
            const finalPrice =
              ammBuyQuote && ammBuyQuote.shares > 0 && selection.entryId
                ? Number(ammBuyQuote.newPrices[selection.entryId] ?? 0)
                : null;
            const showSlippage =
              finalPrice != null && Math.abs(finalPrice - ammEntryPrice) >= 0.01;

            const hasBuyQuote = !!(ammBuyQuote && ammBuyQuote.shares > 0);
            // Direction-aware label for the "shares" line so it reads
            // naturally on Up/Down ("226 UP shares") and falls back to
            // a neutral "shares" everywhere else.
            const sideShareLabel = isUpDown
              ? isUp
                ? "UP shares"
                : "DOWN shares"
              : "shares";

            return (
              <div
                className="rounded-md border border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/5 px-3 py-2.5 text-xs space-y-2"
                data-testid="amm-receipt-card"
              >
                <div className="flex items-end justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        PAYOUT IF WIN
                      </p>
                      {/* Live indicator: shown only when parent passed a
                          fresh ammState via `liveAmmState`. Pulsing dot
                          conveys "this estimate updates as the market
                          moves" without taking real estate. */}
                      {liveAmmState != null && hasBuyQuote && (
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
                        ~{formatVox(Math.floor(ammBuyQuote.shares))}
                      </p>
                    ) : (
                      <p className="text-2xl font-bold leading-tight font-mono text-muted-foreground/50">
                        {CURRENCY.symbol}—
                      </p>
                    )}
                  </div>
                  {hasBuyQuote && ammBuyQuote && (
                    <span
                      className="shrink-0 inline-flex items-center rounded-full bg-green-500/15 text-green-700 dark:text-green-400 px-2 py-0.5 text-[10px] font-mono font-semibold"
                      data-testid="amm-receipt-net"
                    >
                      +{CURRENCY.symbol}{Math.max(0, Math.floor(ammBuyQuote.shares) - ammBuyQuote.chargeCredits).toLocaleString("en-US")} net
                    </span>
                  )}
                </div>

                {hasBuyQuote && ammBuyQuote && (
                  <p className="text-[11px] font-mono text-muted-foreground border-t border-violet-500/15 pt-1.5">
                    {ammBuyQuote.shares.toFixed(2)} {sideShareLabel}
                    <span className="text-muted-foreground/70">
                      {" · Avg price "}
                      {formatVoxPrice(ammBuyQuote.pricePerShareAvg, 3)}/share
                    </span>
                  </p>
                )}

                {!hasBuyQuote && (
                  <p className="text-[11px] text-muted-foreground/70 italic border-t border-violet-500/15 pt-1.5">
                    Enter at least {formatVox(MIN_STAKE)} to see your potential payout.
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
                        <p>
                          Big buys push the share price up as
                          they fill. Your{" "}
                          <span className="font-semibold">Avg price</span>{" "}
                          above already factors this in — it's
                          what you'll actually pay per share.
                        </p>
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

                {/* Live-quote disclaimer. Only shown when the parent
                    is feeding us `liveAmmState` (so the receipt is
                    actually re-deriving on each refetch) AND the
                    user has a real quote in front of them. Without
                    these guards we'd be lying ("Live estimate" while
                    the modal is using a stale snapshot) or pointless
                    ("Live estimate" next to "Enter at least Ꝟ5..."). */}
                {liveAmmState != null && hasBuyQuote && (
                  <p className="text-[10px] text-muted-foreground/70 leading-snug">
                    Live estimate — actual shares depend on
                    the price at the moment your trade executes.
                  </p>
                )}
              </div>
            );
          })()}

          <div className="flex items-center justify-between text-xs pt-2 border-t">
            <div>
              <span className="text-muted-foreground">Current Balance: </span>
              <span className="font-mono font-medium">{formatVox(walletBalance)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">After Buy: </span>
              <span className={`font-mono font-medium ${balanceAfter < 0 ? 'text-red-700 dark:text-red-500' : 'text-green-700 dark:text-green-500'}`}>
                {balanceAfter >= 0 ? formatVox(balanceAfter) : 'Insufficient'}
              </span>
            </div>
          </div>

          {/* Highest-intent earn moment — the user wants to predict and
              just discovered they can't afford the entry. Phase 1 has no
              Vox sales, so instead of a Buy CTA we lead with refer-and-earn
              (both sides get Vox) plus a link to the full earn guide. Two
              trigger conditions cover both "below minimum stake" (idle) and
              "tried to over-stake" (typing). Logged-out users see the Sign
              In button instead, so this only matters once auth'd. */}
          {isLoggedIn && (walletBalance < MIN_STAKE || balanceAfter < 0) && (
            <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 dark:border-violet-500/30 dark:bg-violet-500/8 p-3 space-y-2.5">
              <div className="flex items-start gap-3">
                <Gift className="h-4 w-4 mt-0.5 shrink-0 text-violet-600 dark:text-violet-400" />
                <p className="text-xs text-muted-foreground flex-1">
                  {walletBalance < MIN_STAKE
                    ? `Out of Vox? Invite a friend — you both get ${voxWord(REFERRAL_REWARD)}.`
                    : `Not enough Vox for that stake. Invite a friend — you both get ${voxWord(REFERRAL_REWARD)}.`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="flex-1 gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                  onClick={() => {
                    onClose();
                    openReferralModal("out_of_vox");
                  }}
                  data-testid="button-refer-earn-stake"
                >
                  <Gift className="h-3.5 w-3.5" />
                  Refer &amp; earn
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    onClose();
                    setLocation("/how-it-works?tab=credits");
                  }}
                  data-testid="button-earn-more-vox-stake"
                >
                  How to earn more
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
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
            engine="amm"
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
                disabled={submitting || !stakeAmount || parsedAmount < MIN_STAKE || balanceAfter < 0}
                data-testid="button-confirm-stake"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Placing…
                  </>
                ) : (
                  "Buy"
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
        <p className="text-[10px] text-muted-foreground/60 text-center -mt-0.5">
          Vox is VoxDex&apos;s virtual currency — no cash value.
        </p>
      </DialogContent>
    </Dialog>
  );
}
