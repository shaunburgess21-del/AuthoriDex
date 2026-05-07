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
}: {
  marketId: string;
  personName: string;
  baselineScore: number;
  currentScore: number;
  isMarketClosed: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: (choice: "up" | "down") => void;
  pendingPosition?: { pick: "up" | "down" | null; stakeAmount: number } | null;
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

  return (
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
  );
}
