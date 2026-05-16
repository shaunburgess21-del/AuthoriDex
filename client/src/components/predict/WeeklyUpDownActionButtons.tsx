import { Button } from "@/components/ui/button";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { ClosedMarketActionTrigger } from "./ClosedMarketActionTrigger";
import { WeeklyUpDownYourPositionPanel } from "./WeeklyUpDownYourPositionPanel";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";

export function WeeklyUpDownActionButtons({
  marketId,
  personName,
  baselineScore,
  currentScore,
  isMarketClosed,
  closedMessage,
  onSelect,
  pendingPosition,
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
  /** AMM markets price via LMSR; each button surfaces live cr/share. */
  upPrice?: number | null;
  downPrice?: number | null;
  /** Live unrealised P&L threaded into the position banner so users can
   *  see "+13.41 cr" next to their Stake. Null when the position
   *  summary hasn't loaded yet. */
  unrealisedPnl?: number | null;
}) {
  if (!isMarketClosed && pendingPosition) {
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

  const showAmmPrices = upPrice != null && downPrice != null;

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
    </div>
  );
}
