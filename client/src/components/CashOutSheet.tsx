import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Banknote, HelpCircle, Loader2, Lock } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import {
  type ApiAmmStateBlock,
  deriveSellQuote,
  pricesFor,
  priceToPercent,
  snapshotFromApi,
} from "@/lib/ammClient";
import { CURRENCY, formatVox, formatVoxDelta, formatVoxPrice } from "@/lib/currency";

/** Mirror of StakeModal's fixed quote-to-execution guard. */
const SLIPPAGE_TOLERANCE = 0.05;

/**
 * Everything the sheet needs to cash out ONE position. Pages build this
 * from the per-entry position rows they already render (netShares,
 * netCreditsIn, avgEntryPrice all come from /api/me/amm-positions or the
 * page's own position query).
 */
export interface CashOutSelection {
  marketId: string;
  entryId: string;
  /** "UP" / "DOWN" / person name / "Yes — …" — the side the user holds. */
  sideLabel: string;
  /** Colors the side label. "up" green, "down" red, "neutral" violet. */
  sideTone?: "up" | "down" | "neutral";
  /** e.g. "Ed Sheeran: Up or Down?" */
  marketName: string;
  netShares: number;
  netCreditsIn: number;
  avgEntryPrice: number;
  bettingCutoff?: string | null;
  endAt?: string | null;
  /** Snapshot taken when the sheet opened; fallback when no live state. */
  ammState?: ApiAmmStateBlock | null;
  /** Optional status chip, e.g. Winning / Behind / Leading. */
  statusLabel?: string | null;
  statusTone?: "positive" | "negative" | "warning" | null;
}

interface CashOutSheetProps {
  open: boolean;
  onClose: () => void;
  selection: CashOutSelection | null;
  /**
   * Live AMM state from the parent's polling query. Preferred over the
   * frozen `selection.ammState` so the proceeds estimate tracks the
   * market while the sheet is open.
   */
  liveAmmState?: ApiAmmStateBlock | null;
  /**
   * Sell executor — parent owns the mutation (endpoints differ between
   * native and community markets). `meta.minPricePerShare` is the 5%
   * slippage floor; forward it to the server.
   */
  onConfirmSell: (
    shares: number,
    meta?: { minPricePerShare?: number },
  ) => void | Promise<void>;
}

const SIDE_TONE_CLASS: Record<string, string> = {
  up: "text-[#00C853]",
  down: "text-[#FF0000]",
  neutral: "text-violet-700 dark:text-violet-400",
};

const STATUS_TONE_CLASS: Record<string, string> = {
  positive:
    "bg-green-600/20 text-green-700 dark:text-green-500 border-green-500/40 dark:border-green-500/30",
  negative:
    "bg-red-600/20 text-red-700 dark:text-red-500 border-red-500/40 dark:border-red-500/30",
  warning:
    "bg-amber-600/20 text-amber-700 dark:text-amber-500 border-amber-500/40 dark:border-amber-500/30",
};

/**
 * Dedicated cash-out sheet — the single sell surface for AMM positions.
 *
 * Deliberately tiny compared to StakeModal: no outcome switcher, no
 * chart, no resolution rules. Just the user's position, an amount, and
 * a live proceeds estimate. Defaults to selling ALL shares so the
 * proceeds figure is visible with zero typing (the dominant case).
 */
export function CashOutSheet({
  open,
  onClose,
  selection,
  liveAmmState,
  onConfirmSell,
}: CashOutSheetProps) {
  const [sellShares, setSellShares] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const marketCycle = useMarketCycle({
    bettingCutoff: selection?.bettingCutoff,
    resolutionDeadline: selection?.endAt,
  });

  const netShares = Number(selection?.netShares ?? 0);

  // Pre-fill "All" on every open so the proceeds hero renders instantly.
  useEffect(() => {
    if (open && netShares > 0) {
      setSellShares(netShares.toFixed(4));
    }
  }, [open, netShares]);

  if (!selection) return null;

  const isClosed = selection.bettingCutoff ? marketCycle.status !== "OPEN" : false;
  const effectiveAmmState = liveAmmState ?? selection.ammState ?? null;
  const ammSnapshot = snapshotFromApi(effectiveAmmState);
  const priceMap = ammSnapshot ? pricesFor(ammSnapshot) : null;
  const entryPrice = priceMap ? priceMap[selection.entryId] ?? null : null;

  const parsedShares = Number(sellShares);
  const sharesToSell =
    Number.isFinite(parsedShares) && parsedShares > 0
      ? Math.min(parsedShares, netShares)
      : 0;
  const quote =
    sharesToSell > 0
      ? deriveSellQuote(effectiveAmmState, selection.entryId, sharesToSell)
      : null;

  // Full-position value uses quoteSell proceeds (server-canonical P&L),
  // not marginal MTM — LMSR convexity means netShares × spot overstates
  // what cashing out actually returns.
  const fullPositionQuote =
    netShares > 0
      ? deriveSellQuote(effectiveAmmState, selection.entryId, netShares)
      : null;
  const currentValue = fullPositionQuote ? fullPositionQuote.proceeds : null;
  const unrealisedPnl =
    currentValue != null ? currentValue - selection.netCreditsIn : null;
  // P&L of the slice being sold: proceeds vs the proportional cost basis.
  const soldCostBasis =
    netShares > 0 ? selection.netCreditsIn * (sharesToSell / netShares) : 0;
  const sellPnl = quote ? quote.proceeds - soldCostBasis : null;

  const finalPrice = quote ? Number(quote.newPrices[selection.entryId] ?? 0) : null;
  const showImpact =
    entryPrice != null && finalPrice != null && Math.abs(finalPrice - entryPrice) >= 0.01;

  const sideToneClass = SIDE_TONE_CLASS[selection.sideTone ?? "neutral"];
  const pnlClass = (v: number) =>
    v >= 0 ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-500";

  // "I'm winning, why don't I profit?" education. When the live price
  // sits within ~2pp of the user's avg entry, cashing out nets roughly
  // breakeven minus the spread — which surprises anyone who bought a
  // favorite that stayed a favorite. Only shown for the flat case;
  // clearly-up or clearly-down positions don't need the lesson.
  const isFlatVsEntry =
    entryPrice != null &&
    selection.avgEntryPrice > 0 &&
    Math.abs(entryPrice - selection.avgEntryPrice) < 0.02;

  const handleConfirm = async () => {
    if (submitting || sharesToSell <= 0) return;
    // Mirror StakeModal: floor against quoted avg fill (what the server
    // validates), not marginal spot. Sell avg is below marginal due to
    // LMSR convexity — a marginal × 0.95 floor can falsely reject a
    // same-state cash-out. Fall back to spot if no quote yet.
    const slippageBasis = quote?.pricePerShareAvg ?? entryPrice ?? null;
    const minPricePerShare =
      slippageBasis != null
        ? Math.max(1e-6, slippageBasis * (1 - SLIPPAGE_TOLERANCE))
        : undefined;
    setSubmitting(true);
    try {
      const result = onConfirmSell(sharesToSell, { minPricePerShare });
      if (result && typeof (result as Promise<void>).then === "function") {
        await result;
      }
      setSellShares("");
      onClose();
    } catch {
      // Parent surfaces its own error toast; keep the sheet open with
      // the user's amount intact so they can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setSellShares("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto premium-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-violet-700 dark:text-violet-500" />
            <span>
              Cash out — <span className={sideToneClass}>{selection.sideLabel}</span>
            </span>
          </DialogTitle>
          <DialogDescription>{selection.marketName}</DialogDescription>
        </DialogHeader>

        <div className="py-1 space-y-4">
          {/* Position summary */}
          <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Your position
              </p>
              {selection.statusLabel && (
                <Badge
                  className={`text-[10px] ${STATUS_TONE_CLASS[selection.statusTone ?? "warning"]}`}
                >
                  {selection.statusLabel}
                </Badge>
              )}
            </div>
            <p className="text-sm font-semibold">
              <span className={sideToneClass}>{selection.sideLabel}</span>
              <span className="text-muted-foreground font-normal">
                {" "}· {netShares.toFixed(2)} shares
              </span>
            </p>
            <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-border/40">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</p>
                <p className="font-mono font-semibold">
                  {formatVoxPrice(selection.netCreditsIn, 0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Value now
                </p>
                <p className="font-mono font-semibold">
                  {currentValue != null ? `~${formatVoxPrice(currentValue)}` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">P&L</p>
                <p
                  className={`font-mono font-semibold ${
                    unrealisedPnl != null ? pnlClass(unrealisedPnl) : ""
                  }`}
                >
                  {unrealisedPnl != null ? formatVoxDelta(unrealisedPnl) : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Amount to cash out</label>
              <span className="text-[11px] text-muted-foreground font-mono">
                avg entry {formatVoxPrice(selection.avgEntryPrice, 3)}/share
              </span>
            </div>
            <Input
              type="number"
              min={0}
              max={netShares}
              step="any"
              placeholder={`Up to ${netShares.toFixed(2)} shares`}
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
                setSellShares(String(Math.max(0, Math.min(n, netShares))));
              }}
              className="font-mono"
              data-testid="input-cashout-shares"
            />
            <div className="flex gap-2">
              {[0.25, 0.5, 1].map((frac) => {
                const amount = Math.max(0, netShares * frac);
                const isActive =
                  sharesToSell > 0 && Math.abs(sharesToSell - amount) < 1e-4;
                return (
                  <Button
                    key={frac}
                    type="button"
                    variant={isActive ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setSellShares(amount > 0 ? amount.toFixed(4) : "")}
                    className="flex-1"
                    data-testid={`button-cashout-preset-${Math.round(frac * 100)}`}
                  >
                    {frac === 1 ? "All" : `${Math.round(frac * 100)}%`}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Proceeds */}
          <div
            className="rounded-md border border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/5 px-3 py-2.5 text-xs space-y-2"
            data-testid="cashout-receipt-card"
          >
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                You'll receive
              </p>
              {liveAmmState != null && quote && (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Live
                </span>
              )}
            </div>
            {quote ? (
              <p className="text-2xl font-bold leading-tight font-mono text-green-700 dark:text-green-500">
                ~{formatVox(quote.proceeds)}
                {sellPnl != null && (
                  <span className={`ml-2 text-sm font-semibold ${pnlClass(sellPnl)}`}>
                    ({formatVoxDelta(sellPnl)} vs cost)
                  </span>
                )}
              </p>
            ) : (
              <p className="text-2xl font-bold leading-tight font-mono text-muted-foreground/50">
                {CURRENCY.symbol}—
              </p>
            )}
            {quote ? (
              <p className="text-[11px] font-mono text-muted-foreground border-t border-violet-500/15 pt-1.5">
                Selling {sharesToSell.toFixed(2)} shares
                <span className="text-muted-foreground/70">
                  {" · Avg price "}
                  {formatVoxPrice(quote.pricePerShareAvg, 3)}/share
                </span>
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground/70 italic border-t border-violet-500/15 pt-1.5">
                Enter an amount to see your proceeds.
              </p>
            )}

            {showImpact && entryPrice != null && finalPrice != null && (
              <div className="text-[10px] font-mono text-amber-700 dark:text-amber-400 flex items-center gap-1 flex-wrap">
                <span>
                  Price impact: {priceToPercent(entryPrice, 0)} →{" "}
                  {priceToPercent(finalPrice, 0)}
                </span>
                <span className="text-amber-700/70 dark:text-amber-400/70">
                  ({finalPrice > entryPrice ? "+" : ""}
                  {((finalPrice - entryPrice) * 100).toFixed(1)} pts)
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
                      Big sells push the share price down as they fill. The{" "}
                      <span className="font-semibold">Avg price</span> above already
                      factors this in — it's what you'll actually receive per share.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {quote && isFlatVsEntry && (
              <p
                className="text-[10px] text-muted-foreground leading-snug border-t border-violet-500/15 pt-1.5"
                data-testid="text-cashout-flat-entry-hint"
              >
                Your entry price matches the market — profit from cashing out
                comes when the odds move further in your favor after you buy.
              </p>
            )}

            {quote && (
              <p className="text-[10px] text-muted-foreground/70 leading-snug border-t border-violet-500/15 pt-1.5">
                Live estimate — a small spread applies on every trade, and actual
                proceeds depend on the price at the moment your cash-out executes.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          {isClosed ? (
            <Button disabled className="flex-1 gap-1.5 opacity-60" data-testid="button-confirm-cashout">
              <Lock className="h-4 w-4" />
              Trading Closed
            </Button>
          ) : (
            <Button
              onClick={handleConfirm}
              className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
              // `!quote` also guards the no-AMM-state window (e.g. the
              // Predictions page before its market fetch resolves) so a
              // sell can never fire without a visible number + slippage
              // floor derived from a live price.
              disabled={submitting || sharesToSell <= 0 || sharesToSell > netShares + 1e-6 || !quote}
              data-testid="button-confirm-cashout"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Cashing out…
                </>
              ) : quote ? (
                `Cash out ~${formatVox(quote.proceeds)}`
              ) : (
                "Cash out"
              )}
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/60 text-center -mt-0.5">
          Vox is VoxDex&apos;s virtual currency — no cash value.
        </p>
      </DialogContent>
    </Dialog>
  );
}
