import type { ReactNode } from "react";
import { ChevronRight, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WorldMarketsTeaserRailProps {
  /** Curated subset of world markets (already sorted, capped by the caller). */
  markets: Array<Record<string, any>>;
  /** Total live world-market count for the header badge. */
  liveCount: number;
  /** Shared card renderer from the Predict page (keeps bet/nav wiring identical). */
  renderMarket: (market: any) => ReactNode;
  /** Switches the page into World mode. */
  onSeeAll: () => void;
}

/**
 * Compact horizontal rail of the hottest / soonest-closing World Markets,
 * embedded inside the Weekly mode of the Predict page. This is the discovery
 * funnel for the World tab — the toggle is just the container.
 */
export function WorldMarketsTeaserRail({
  markets,
  liveCount,
  renderMarket,
  onSeeAll,
}: WorldMarketsTeaserRailProps) {
  if (markets.length === 0) return null;

  return (
    <section className="mb-10 px-1.5 md:px-0" data-testid="world-markets-teaser-rail">
      <div className="mb-3 border-t-[3px] border-t-violet-500 rounded-t-lg bg-[linear-gradient(to_bottom,rgba(139,92,246,0.12)_0%,transparent_75%)] dark:bg-[linear-gradient(to_bottom,rgba(139,92,246,0.08)_0%,transparent_75%)]">
        <div className="flex items-center justify-between gap-2 px-3 py-3 md:px-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-violet-500/15 dark:bg-violet-500/10 hidden sm:flex items-center justify-center shrink-0">
              <Scale className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-serif font-bold">World Markets</h2>
                {liveCount > 0 && (
                  <Badge
                    className="px-2 py-0.5 text-[11px] font-semibold bg-violet-500/20 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/40 dark:border-violet-400/30"
                    data-testid="world-teaser-live-badge"
                  >
                    {liveCount.toLocaleString("en-US")} live
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">
                Politics, sports, crypto &amp; global headlines
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSeeAll}
            className="shrink-0 text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 text-[14px]"
            data-testid="button-world-teaser-see-all"
          >
            See all
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      {/* Full-bleed on mobile (offsets the page container px-2 + section
          px-1.5) so cards peek from the screen edge and read as a
          scrollable rail; constrained to the grid on desktop. */}
      <div
        className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2 -mx-3.5 px-3.5 md:mx-0 md:px-0"
        data-testid="world-teaser-scroll"
      >
        {markets.map((market) => (
          <div
            key={String(market.id)}
            className="w-[85vw] max-w-[340px] sm:w-[340px] shrink-0 snap-start"
          >
            {renderMarket(market)}
          </div>
        ))}
      </div>

      <div className="text-center mt-2 md:mt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSeeAll}
          className="text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 text-[14px]"
          data-testid="button-world-teaser-see-all-footer"
        >
          See all World Markets
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </section>
  );
}
