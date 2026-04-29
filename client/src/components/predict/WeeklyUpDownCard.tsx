import { Badge } from "@/components/ui/badge";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { WeeklyUpDownNameBlock } from "@/components/WeeklyUpDownNameBlock";
import { WeeklyUpDownActionButtons } from "@/components/predict/WeeklyUpDownActionButtons";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { PredictCard } from "@/components/predict/PredictCard";
import { ParticipantAvatarStack, type ParticipantPreview } from "@/components/predict/ParticipantAvatarStack";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { Star, Flame, ListChecks } from "lucide-react";
import { Link } from "wouter";

type CategoryFilter = "all" | "favorites" | "trending" | "tech" | "politics" | "business" | "music" | "sports" | "film-tv" | "gaming" | "creator" | "food-drink" | "lifestyle" | "misc";

export interface PredictionMarket {
  id: string;
  personId: string;
  personName: string;
  personAvatar: string;
  currentScore: number;
  baselineScore: number;
  startScore: number;
  change7d: number;
  upMultiplier: number;
  downMultiplier: number;
  endTime: string;
  totalPool: number;
  upPoolPercent: number;
  category: CategoryFilter;
  upEntryId?: string;
  downEntryId?: string;
  cadence?: string;
  tieRule?: string;
  startAt?: string;
  endAt?: string;
  totalBets?: number;
  featured?: boolean;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
  bettingCutoff?: string | null;
}

export function WeeklyUpDownCard({
  market,
  isMarketClosed = false,
  closedMessage,
  onSelect,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  pendingPosition,
}: {
  market: PredictionMarket;
  isMarketClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: (choice: "up" | "down") => void;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
  /** When set and market is open, replaces Up/Down with position CTA to detail. */
  pendingPosition?: { pick: "up" | "down" | null; stakeAmount: number } | null;
}) {
  const delta = market.currentScore - market.baselineScore;
  const pctDelta = market.baselineScore > 0 ? ((delta / market.baselineScore) * 100).toFixed(1) : "0";
  const cadenceLabel = (market.cadence || "weekly").charAt(0).toUpperCase() + (market.cadence || "weekly").slice(1);

  return (
    <PredictCard
      testId={`card-weekly-${market.id}`}
      autoSize
      className={`${isMarketClosed ? "opacity-75" : ""} ${pendingPosition && !isMarketClosed ? "ring-1 ring-violet-500/35 dark:ring-violet-400/25 md:ring-inset rounded-[12px] md:rounded-xl" : ""}`}
    >
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={delta >= 0 ? "text-green-500 border-green-500/40 dark:border-green-500/30" : "text-red-500 border-red-500/40 dark:border-red-500/30"}
          >
            {delta >= 0 ? "+" : ""}{pctDelta}%
          </Badge>
          <Badge variant="outline" className="text-violet-600 dark:text-violet-400 border-violet-500/40 dark:border-violet-500/30 text-[10px]">
            {cadenceLabel}
          </Badge>
          {market.featured && (
            <Badge variant="outline" className="text-yellow-600 dark:text-yellow-400 border-yellow-500/40 dark:border-yellow-500/30 text-[10px]">
              <Star className="h-3 w-3 mr-0.5" />Featured
            </Badge>
          )}
          {(market.totalPool > 5000 || (market.totalBets ?? 0) > 50) && (
            <Badge variant="outline" className="text-orange-600 dark:text-orange-400 border-orange-500/40 dark:border-orange-500/30 text-[10px]">
              <Flame className="h-3 w-3 mr-0.5" />Hot
            </Badge>
          )}
          {market.totalPool < 100 && (
            <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/40 dark:border-amber-500/30 text-[10px]">
              Thin Pool
            </Badge>
          )}
          {pendingPosition && !isMarketClosed && (
            <Badge
              variant="outline"
              className="text-violet-700 dark:text-violet-400 border-violet-500/45 dark:border-violet-500/35 text-[10px]"
              data-testid={`badge-entered-${market.id}`}
            >
              <ListChecks className="h-3 w-3 mr-0.5 shrink-0" />
              Entered
            </Badge>
          )}
        </div>
        <InteractiveCategoryPill
          category={market.category}
          onFilter={() => onFilterCategory?.(market.category)}
          leaderboardCategories={leaderboardCategories}
          detailHref={`/predict/updown/${market.id}`}
          detailLabel="View Up/Down Details"
        />
      </div>

      <MarketCycleStrip
        bettingCutoff={market.bettingCutoff ?? null}
        resolveAt={market.endAt ?? null}
        variant="compact"
        className="mb-2"
      />

      <Link
        href={`/predict/updown/${market.id}`}
        className="block rounded-lg -mx-1 px-1 py-0.5 mb-2 hover:bg-muted/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`View details for ${market.personName} up or down market`}
      >
        <div className="flex items-start gap-3 mb-2">
          <PersonAvatar name={market.personName} avatar={market.personAvatar} className="h-20 w-20 md:h-16 md:w-16 shrink-0" />
          <div className="flex-1 min-w-0">
            <WeeklyUpDownNameBlock text={market.personName} />
            <p className="text-sm md:text-xs text-muted-foreground font-mono mt-0.5 leading-[1.4]">
              Now: {market.currentScore.toLocaleString('en-US')}
            </p>
          </div>
        </div>

        <p className="text-sm md:text-xs text-muted-foreground mb-2 leading-[1.4]">
          Will <span className="font-semibold text-foreground">{market.personName.split(" ")[0]}</span> close above or below the weekly baseline?
        </p>

        <div className="flex items-center gap-1.5 text-sm md:text-[11px] text-muted-foreground mb-0 max-md:mt-2 flex-wrap">
          <span>Baseline: <span className="font-mono text-foreground">{market.baselineScore.toLocaleString('en-US')}</span></span>
          <span className="text-muted-foreground/40">&middot;</span>
          <span>Delta: <span className={`font-mono ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>{delta >= 0 ? "+" : ""}{delta.toLocaleString('en-US')}</span></span>
          <span className="text-muted-foreground/40">&middot;</span>
          <span>Pool: <span className="font-mono text-violet-600 dark:text-violet-400">{market.totalPool.toLocaleString('en-US')}</span></span>
        </div>
      </Link>

      <div className="mt-auto">
      <div className="mb-2">
        <ParticipantAvatarStack
          participants={market.recentParticipants}
          totalCount={market.totalBets ?? market.activeParticipantCount ?? 0}
        />
      </div>

      <div className="mb-2">
          <div className="h-2.5 rounded-full bg-red-500/25 dark:bg-red-500/20 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all"
            style={{ width: `${market.upPoolPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] mt-1">
          <span className="text-green-500 font-semibold">Up {market.upMultiplier}x</span>
          <span className="text-red-500 font-semibold">Down {market.downMultiplier}x</span>
        </div>
      </div>

      <WeeklyUpDownActionButtons
        marketId={market.id}
        personName={market.personName}
        baselineScore={market.baselineScore}
        currentScore={market.currentScore}
        isMarketClosed={!!isMarketClosed}
        closedMessage={closedMessage}
        onSelect={onSelect}
        pendingPosition={pendingPosition ?? null}
      />
      </div>
    </PredictCard>
  );
}
