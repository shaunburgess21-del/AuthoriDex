import { Button } from "@/components/ui/button";
import { TrendingDown, TrendingUp, Zap } from "lucide-react";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { ClosedMarketActionTrigger } from "./ClosedMarketActionTrigger";
import { WeeklyUpDownYourPositionPanel } from "./WeeklyUpDownYourPositionPanel";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";
import { computeEarlyBirdMultiplier } from "@/lib/parimutuel";

export function WeeklyUpDownActionButtons({
  marketId,
  personName,
  baselineScore,
  currentScore,
  isMarketClosed,
  closedMessage,
  onSelect,
  pendingPosition,
  marketStartAt,
  bettingCutoff,
  engine,
  upPrice,
  downPrice,
  unrealisedPnl,
}: {
  marketId: string;
  personName: string;
  baselineScore: number;
  currentScore: number;
  isMarketClosed: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: (choice: "up" | "down") => void;
  pendingPosition?: { pick: "up" | "down" | null; stakeAmount: number } | null;
  marketStartAt?: string | null;
  bettingCutoff?: string | null;
  /** Phase 4: AMM markets price via LMSR and have no early-bird boost. */
  engine?: "parimutuel" | "amm" | string | null;
  /**
   * Polymarket pass: when set, each button surfaces the live cr/share
   * directly under its Up/Down label so users can comparison-shop the
   * sides at a glance. Parimutuel markets pass null and fall back to
   * the legacy plain-text buttons.
   */
  upPrice?: number | null;
  downPrice?: number | null;
  /**
   * Sprint 4.3: live unrealised P&L threaded into the position banner
   * so users can see "+13.41 cr" next to their Stake. Null for
   * parimutuel positions / cards where the AMM position summary
   * hasn't loaded yet.
   */
  unrealisedPnl?: number | null;
}) {
  if (!isMarketClosed && pendingPosition) {
    // Sprint 4 polish: this banner now navigates to the detail page
    // (chevron-right glyph already implies that affordance) so users
    // land on the full buy/sell/hedge surface rather than the
    // add-only top-up modal. Previously `onAddTopUp` short-circuited
    // the Link path and opened StakeModal in `isTopUp` mode, which
    // hid the Sell tab and the opposite-side flip — a regression
    // surfaced in smoke testing.
    return (
      <WeeklyUpDownYourPositionPanel
        variant="cardLink"
        href={`/predict/updown/${marketId}`}
        onLinkClick={() => setPredictReturnAnchor(`card-weekly-${marketId}`)}
        pick={pendingPosition.pick}
        personName={personName}
        baselineScore={baselineScore}
        currentScore={currentScore}
        stakeAmount={pendingPosition.stakeAmount}
        unrealisedPnl={unrealisedPnl ?? null}
      />
    );
  }

  const isAmm = engine === "amm";
  const boost = isAmm ? 1 : computeEarlyBirdMultiplier(new Date(), marketStartAt, bettingCutoff);
  const showBoostHint = !isAmm && !isMarketClosed && boost > 1.05;
  const showAmmPrices = isAmm && upPrice != null && downPrice != null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
          <Button
            className="bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20 py-3 md:py-2 h-auto flex flex-col items-center justify-center gap-0.5"
            onClick={() => onSelect?.("up")}
            data-testid={`button-up-${marketId}`}
          >
            <span className="flex items-center gap-1 leading-none">
              <TrendingUp className="h-4 w-4" />
              Up
            </span>
            {showAmmPrices && (
              <span className="text-[10px] font-mono opacity-80 leading-none">
                {upPrice.toFixed(2)} cr/share
              </span>
            )}
          </Button>
        </ClosedMarketActionTrigger>
        <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
          <Button
            className="bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 py-3 md:py-2 h-auto flex flex-col items-center justify-center gap-0.5"
            onClick={() => onSelect?.("down")}
            data-testid={`button-down-${marketId}`}
          >
            <span className="flex items-center gap-1 leading-none">
              <TrendingDown className="h-4 w-4" />
              Down
            </span>
            {showAmmPrices && (
              <span className="text-[10px] font-mono opacity-80 leading-none">
                {downPrice.toFixed(2)} cr/share
              </span>
            )}
          </Button>
        </ClosedMarketActionTrigger>
      </div>
      {showBoostHint && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400 text-center mt-1.5 flex items-center justify-center gap-1">
          <Zap className="h-3 w-3" />
          Early predictions get boosted payouts
        </p>
      )}
    </div>
  );
}
