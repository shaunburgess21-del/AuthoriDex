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
}) {
  if (!isMarketClosed && pendingPosition) {
    return (
      <WeeklyUpDownYourPositionPanel
        variant="cardLink"
        href={`/predict/updown/${marketId}`}
        onLinkClick={() => setPredictReturnAnchor(`card-weekly-${marketId}`)}
        // When PredictPage hands us an `onSelect`, route the panel tap
        // through it so the StakeModal pops in same-side top-up mode
        // without a detail-page round-trip. Older callers without
        // `onSelect` still get the legacy link-to-detail behaviour.
        onAddTopUp={onSelect ? (pick) => onSelect(pick) : undefined}
        pick={pendingPosition.pick}
        personName={personName}
        baselineScore={baselineScore}
        currentScore={currentScore}
        stakeAmount={pendingPosition.stakeAmount}
      />
    );
  }

  const isAmm = engine === "amm";
  const boost = isAmm ? 1 : computeEarlyBirdMultiplier(new Date(), marketStartAt, bettingCutoff);
  const showBoostHint = !isAmm && !isMarketClosed && boost > 1.05;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
          <Button
            className="bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20 py-3 md:py-2 h-auto"
            onClick={() => onSelect?.("up")}
            data-testid={`button-up-${marketId}`}
          >
            <TrendingUp className="h-4 w-4 mr-1" />
            Up
          </Button>
        </ClosedMarketActionTrigger>
        <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
          <Button
            className="bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 py-3 md:py-2 h-auto"
            onClick={() => onSelect?.("down")}
            data-testid={`button-down-${marketId}`}
          >
            <TrendingDown className="h-4 w-4 mr-1" />
            Down
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
