import { Button } from "@/components/ui/button";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { ClosedMarketActionTrigger } from "./ClosedMarketActionTrigger";
import { WeeklyUpDownYourPositionPanel } from "./WeeklyUpDownYourPositionPanel";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";
import { formatVoxPrice } from "@/lib/currency";
import { VoxText } from "@/components/VoxText";
import { useStablePress } from "@/hooks/useStablePress";
import { InfoHint } from "@/components/InfoHint";


export function WeeklyUpDownActionButtons({
  marketId,
  personName,
  baselineScore,
  currentScore,
  isMarketClosed,
  closedMessage,
  onSelect,
  onAdd,
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
  /** Opens the StakeModal in top-up mode for the user's existing pick. */
  onAdd?: () => void;
  pendingPosition?: { pick: "up" | "down" | null; stakeAmount: number } | null;
  /** AMM markets price via LMSR; each button surfaces live Ꝟ/share. */
  upPrice?: number | null;
  downPrice?: number | null;
  /** Live unrealised P&L threaded into the position banner so users can
   *  see "+Ꝟ13.41" next to their Stake. Null when the position
   *  summary hasn't loaded yet. */
  unrealisedPnl?: number | null;
}) {
  const pressUp = useStablePress(() => onSelect?.("up"));
  const pressDown = useStablePress(() => onSelect?.("down"));

  if (!isMarketClosed && pendingPosition) {
    return (
      <WeeklyUpDownYourPositionPanel
        variant="cardLink"
        href={`/predict/updown/${marketId}`}
        onLinkClick={() => setPredictReturnAnchor(`card-weekly-${marketId}`)}
        onAdd={onAdd}
        pick={pendingPosition.pick}
        personName={personName}
        baselineScore={baselineScore}
        currentScore={currentScore}
        stakeAmount={pendingPosition.stakeAmount}
        unrealisedPnl={unrealisedPnl ?? null}
        marketId={marketId}
      />
    );
  }

  // Keep the position row visible after cutoff so stake / P&L remain
  // scannable (matches H2H + Race). Only hide the Add top-up.
  if (pendingPosition) {
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
        marketId={marketId}
      />
    );
  }

  const showAmmPrices = upPrice != null && downPrice != null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
          <Button
            type="button"
            className="w-full bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20 py-3 md:py-2 h-auto flex flex-col items-center justify-center gap-0.5"
            {...(isMarketClosed ? {} : pressUp)}
            data-testid={`button-up-${marketId}`}
          >
            <span className="flex items-center gap-1 leading-none">
              <TrendingUp className="h-4 w-4" />
              Up
            </span>
            {showAmmPrices && (
              <span className="text-[10px] font-mono opacity-80 leading-none">
                <VoxText text={formatVoxPrice(upPrice)} />/share
              </span>
            )}
          </Button>
        </ClosedMarketActionTrigger>
        <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
          <Button
            type="button"
            className="w-full bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 py-3 md:py-2 h-auto flex flex-col items-center justify-center gap-0.5"
            {...(isMarketClosed ? {} : pressDown)}
            data-testid={`button-down-${marketId}`}
          >
            <span className="flex items-center gap-1 leading-none">
              <TrendingDown className="h-4 w-4" />
              Down
            </span>
            {showAmmPrices && (
              <span className="text-[10px] font-mono opacity-80 leading-none">
                <VoxText text={formatVoxPrice(downPrice)} />/share
              </span>
            )}
          </Button>
        </ClosedMarketActionTrigger>
      </div>
      {showAmmPrices ? (
        <p className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          Price per share
          <InfoHint term="shares" side="top" align="end" className="h-3 w-3" />
        </p>
      ) : null}
    </div>
  );
}
