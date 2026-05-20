import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface WorldMarketsStickyHeaderProps {
  liveMarketCount?: number;
}

export function WorldMarketsStickyHeader({ liveMarketCount = 0 }: WorldMarketsStickyHeaderProps) {
  const liveLabel =
    liveMarketCount > 0
      ? `${liveMarketCount.toLocaleString("en-US")} live`
      : "Open markets";

  return (
    <div
      style={{
        marginLeft: "calc(-50vw + 50%)",
        marginRight: "calc(-50vw + 50%)",
        paddingLeft: "calc(50vw - 50%)",
        paddingRight: "calc(50vw - 50%)",
      }}
      className="sticky top-16 z-[41] relative mb-6 min-h-16 border-y border-white/10 bg-background backdrop-blur-sm"
      data-testid="world-markets-sticky-header"
      data-sticky-predict-bar
    >
      <div className="relative z-10 px-2 py-3 md:px-6 md:py-4">
        <div className="flex min-w-0 flex-row flex-nowrap items-center justify-center gap-3 md:justify-between md:gap-4">
          <div className="flex min-w-0 shrink items-stretch gap-2 md:grid md:grid-cols-[auto_1fr] md:grid-rows-[auto_auto] md:items-center md:gap-x-3 md:gap-y-0">
            <div
              className="hidden shrink-0 rounded-lg bg-violet-500/15 md:row-span-2 md:flex md:h-full md:w-auto md:aspect-square items-center justify-center"
              aria-hidden
            >
              <Scale className="size-5 text-violet-600 dark:text-violet-400 md:size-6" />
            </div>
            <p className="min-w-0 truncate text-base font-semibold text-foreground md:col-start-2 md:row-start-1 md:text-lg md:font-bold">
              Predict the real world
            </p>
            <p className="hidden min-w-0 truncate text-sm text-muted-foreground md:col-start-2 md:row-start-2 md:block md:text-base">
              Politics, sports, crypto &amp; global headlines — beyond the weekly scoreboard
            </p>
          </div>

          <Badge
            className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-violet-500/25 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 border border-violet-500/50 dark:border-violet-400/40"
            data-testid="world-markets-sticky-live-badge"
          >
            {liveLabel}
          </Badge>
        </div>
      </div>
    </div>
  );
}
