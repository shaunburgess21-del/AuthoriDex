import { Button } from "@/components/ui/button";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { ClosedMarketActionTrigger } from "./ClosedMarketActionTrigger";

export function WeeklyUpDownActionButtons({
  marketId,
  isMarketClosed,
  closedMessage,
  onSelect,
}: {
  marketId: string;
  isMarketClosed: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: (choice: "up" | "down") => void;
}) {
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
