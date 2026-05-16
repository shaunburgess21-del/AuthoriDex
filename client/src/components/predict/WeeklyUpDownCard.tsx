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
import { Activity, Star, ListChecks } from "lucide-react";
import { Link } from "wouter";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";
import { type ApiAmmStateBlock, pricesFor, snapshotFromApi } from "@/lib/ammClient";
import { formatVolumeCredits } from "@/lib/formatNumber";

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
  endTime: string;
  upPoolPercent: number;
  category: CategoryFilter;
  upEntryId?: string;
  downEntryId?: string;
  cadence?: string;
  startAt?: string;
  endAt?: string;
  totalBets?: number;
  featured?: boolean;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
  bettingCutoff?: string | null;
  /** Always 'amm' for weekly Up/Down post-sunset. Kept as a typed
   *  field because callers/snapshots still emit it. */
  engine?: "amm" | string | null;
  /** Live AMM state snapshot from `/api/native-markets/updown`. */
  ammState?: ApiAmmStateBlock | null;
  /**
   * Cumulative credits users have spent buying shares on this market
   * (mirrors `ammState.totalUserCreditsIn`). Powers the Polymarket-
   * style "1.2K cr vol" chip on the card and feeds the default sort
   * on the Up/Down feed.
   */
  volume?: number;
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
  onBrowseFullScreen,
  unrealisedPnl = null,
}: {
  market: PredictionMarket;
  isMarketClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: (choice: "up" | "down") => void;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
  pendingPosition?: { pick: "up" | "down" | null; stakeAmount: number } | null;
  onBrowseFullScreen?: () => void;
  /**
   * AMM live unrealised P&L for the current user's open position on
   * this market. Threaded through to the position banner so the card
   * can read `[Winning] +13.41 cr   Stake 100`. Null when no position
   * summary has loaded yet.
   */
  unrealisedPnl?: number | null;
}) {
  const delta = market.currentScore - market.baselineScore;
  const pctDelta = market.baselineScore > 0 ? ((delta / market.baselineScore) * 100).toFixed(1) : "0";
  const cadenceLabel = (market.cadence || "weekly").charAt(0).toUpperCase() + (market.cadence || "weekly").slice(1);

  // Parimutuel sunset: every non-jackpot native Up/Down market is AMM.
  // Prices come from the AMM snapshot; the cadence strip and labels
  // hardcode the AMM variant.
  const ammSnapshot = snapshotFromApi(market.ammState ?? null);
  const ammPrices = ammSnapshot ? pricesFor(ammSnapshot) : null;
  let upPoolPercent = market.upPoolPercent;
  let upPrice = 0;
  let downPrice = 0;
  if (ammPrices && market.upEntryId && market.downEntryId) {
    const pUp = Number(ammPrices[market.upEntryId] ?? 0);
    const pDown = Number(ammPrices[market.downEntryId] ?? 0);
    const total = pUp + pDown;
    if (total > 0) {
      upPoolPercent = Math.round((pUp / total) * 100);
      upPrice = pUp;
      downPrice = pDown;
    }
  }

  return (
    <PredictCard
      testId={`card-weekly-${market.id}`}
      className={`${isMarketClosed ? "opacity-75" : ""} ${pendingPosition && !isMarketClosed ? "ring-1 ring-violet-500/35 dark:ring-violet-400/25 md:ring-inset rounded-[12px] md:rounded-xl" : ""}`}
    >
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-violet-600 dark:text-violet-400 border-violet-500/40 dark:border-violet-500/30 text-[10px]">
            {cadenceLabel}
          </Badge>
          {market.featured && (
            <Badge variant="outline" className="text-yellow-600 dark:text-yellow-400 border-yellow-500/40 dark:border-yellow-500/30 text-[10px]">
              <Star className="h-3 w-3 mr-0.5" />Featured
            </Badge>
          )}
          {!isMarketClosed && (
            <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/40 dark:border-emerald-500/30 text-[10px]">
              <Activity className="h-3 w-3 mr-0.5" />LIVE
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
          onBrowseFullScreen={onBrowseFullScreen}
        />
      </div>

      <MarketCycleStrip
        bettingCutoff={market.bettingCutoff ?? null}
        resolveAt={market.endAt ?? null}
        variant="compact"
        engine="amm"
        className="mb-2"
      />

      <Link
        href={`/predict/updown/${market.id}`}
        onClick={() => setPredictReturnAnchor(`card-weekly-${market.id}`)}
        className="block rounded-lg -mx-1 px-1 py-0.5 mb-2 hover:bg-muted/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`View details for ${market.personName} up or down market`}
      >
        <div className="flex items-center gap-3 mb-2">
          <PersonAvatar name={market.personName} avatar={market.personAvatar} className="h-20 w-20 md:h-16 md:w-16 shrink-0" />
          <div className="flex-1 min-w-0">
            <WeeklyUpDownNameBlock text={market.personName} />
          </div>
        </div>

        <p className="text-sm md:text-xs text-muted-foreground mb-2 leading-[1.4]">
          Will <span className="font-semibold text-foreground">{market.personName.split(" ")[0]}</span> close above or below the weekly baseline?
        </p>

        <div className="sm:hidden text-sm text-muted-foreground space-y-1 mt-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span>Baseline: <span className="font-mono text-foreground">{market.baselineScore.toLocaleString('en-US')}</span></span>
            <span className="text-muted-foreground/40">&middot;</span>
            <span>Current: <span className="font-mono text-foreground">{market.currentScore.toLocaleString('en-US')}</span></span>
          </div>
          <div>
            <span>Change: <span className={`font-mono ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>{delta >= 0 ? "+" : ""}{delta.toLocaleString('en-US')} ({delta >= 0 ? "+" : ""}{pctDelta}%)</span></span>
          </div>
        </div>

        <div className="hidden sm:block text-[11px] text-muted-foreground space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span>Baseline: <span className="font-mono text-foreground">{market.baselineScore.toLocaleString('en-US')}</span></span>
            <span className="text-muted-foreground/40">&middot;</span>
            <span>Current: <span className="font-mono text-foreground">{market.currentScore.toLocaleString('en-US')}</span></span>
            <span className="text-muted-foreground/40">&middot;</span>
            <span>Change: <span className={`font-mono ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>{delta >= 0 ? "+" : ""}{delta.toLocaleString('en-US')} ({delta >= 0 ? "+" : ""}{pctDelta}%)</span></span>
          </div>
        </div>
      </Link>

      <div className="mt-auto">
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <ParticipantAvatarStack
          participants={market.recentParticipants}
          totalCount={market.totalBets ?? market.activeParticipantCount ?? 0}
          engine="amm"
        />
        {(() => {
          const volText = formatVolumeCredits(market.volume);
          if (!volText) return null;
          return (
            <span className="text-xs text-muted-foreground">
              <span className="text-muted-foreground/40">·</span>{" "}
              <span className="font-mono">{volText}</span> vol
            </span>
          );
        })()}
      </div>

      <div className="mb-2">
          <div className="h-2.5 rounded-full bg-red-500/25 dark:bg-red-500/20 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all"
            style={{ width: `${upPoolPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] mt-1">
          <span className="text-green-500 font-semibold">Up {Math.round(upPrice * 100)}%</span>
          <span className="text-red-500 font-semibold">Down {Math.round(downPrice * 100)}%</span>
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
        upPrice={upPrice}
        downPrice={downPrice}
        unrealisedPnl={unrealisedPnl}
      />
      </div>
    </PredictCard>
  );
}
