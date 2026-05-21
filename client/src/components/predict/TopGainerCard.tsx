import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { PredictCard } from "@/components/predict/PredictCard";
import type { ParticipantPreview } from "@/components/predict/ParticipantAvatarStack";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { formatSignedPercent, formatSignedPoints } from "@/lib/predict-display";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { Crown, ChevronRight, Check } from "lucide-react";
import { Link } from "wouter";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";
import { cn } from "@/lib/utils";
import { formatVox, formatVoxCompact, formatVoxDelta } from "@/lib/currency";

type CategoryFilter = "all" | "favorites" | "trending" | "tech" | "politics" | "business" | "music" | "sports" | "film-tv" | "gaming" | "creator" | "food-drink" | "lifestyle" | "misc";

export type GainerCandidate = {
  name: string;
  avatar: string;
  currentGain: number;
  percentGain: number;
  rank?: number;
  entryId?: string;
  personId?: string;
  /** Sum of user stakes on this candidate's entry — used for live payout multipliers. */
  totalStake?: number;
};

export interface TopGainerMarket {
  id: string;
  category: CategoryFilter;
  leaders: GainerCandidate[];
  allCandidates?: GainerCandidate[];
  endTime: string;
  endAt?: string | null;
  startAt?: string | null;
  totalEntries?: number;
  candidateCount?: number;
  totalBets?: number;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
  bettingCutoff?: string | null;
  teaser?: string | null;
  /** Always 'amm' for native races post-sunset. */
  engine?: "amm" | string;
  /** LMSR state block. */
  ammState?: unknown;
  /**
   * Total AMM Vox in for the market. Drives a Polymarket-style
   * "Ꝟ1.2K vol" chip on the card.
   */
  volume?: number;
}

export type CategoryRacePredictionSummary = { pickLabel: string; stakeAmount: number };

/** Build card footer copy from aggregated `/api/me/predictions` row for this market. */
export function categoryRacePredictionSummaryFromBet(
  bet: { entryLabel: string; stakeAmount: number } | undefined
): CategoryRacePredictionSummary | null {
  if (!bet) return null;
  return {
    pickLabel: bet.entryLabel === "Multiple positions" ? "Multiple picks" : bet.entryLabel,
    stakeAmount: bet.stakeAmount,
  };
}

const PREDICTED_CTA_BASE =
  "w-full flex min-h-10 items-center gap-2 px-4 py-3 md:py-2 rounded-md bg-muted/40 border border-border text-sm font-medium text-foreground dark:bg-white/5 dark:border-white/40 dark:text-white transition-all duration-300 hover:border-foreground/40 hover:bg-muted/60 dark:hover:border-white/80 dark:hover:bg-white/15";

export function TopGainerCard({
  market,
  isMarketClosed = false,
  closedMessage,
  onShowAllCandidates,
  isPredicted = false,
  predictionSummary = null,
  unrealisedPnl = null,
  isShimmering = false,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: {
  market: TopGainerMarket;
  isMarketClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onShowAllCandidates?: (market: TopGainerMarket, initialCandidate?: GainerCandidate) => void;
  isPredicted?: boolean;
  predictionSummary?: CategoryRacePredictionSummary | null;
  /**
   * Live unrealised P&L for the user's largest AMM position on this
   * race. Race users can hold positions on multiple candidates at
   * once — we surface the top-position P&L here for the banner
   * readout. Null for "Multiple picks" pending state where one P&L
   * number would be misleading, and for cards whose AMM position
   * summary hasn't loaded yet.
   */
  unrealisedPnl?: number | null;
  isShimmering?: boolean;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const visibleCandidateCount = market.candidateCount ?? market.allCandidates?.length ?? market.totalEntries ?? market.leaders.length;
  const canPick = !isPredicted;
  const volumeLabel = formatVoxCompact(market.volume ?? 0);

  /**
   * AMM P&L delta. Suppressed entirely for "Multiple picks" pending
   * state where a single P&L number would be misleading (it
   * represents only the top position, not the aggregate). The
   * sub-cent zero clamp is folded into `formatVoxDelta`; we still
   * compute the raw value here to drive the colour class.
   */
  const isMultiplePicks = predictionSummary?.pickLabel === "Multiple picks";
  const hasPnl = !isMultiplePicks && unrealisedPnl != null && Number.isFinite(unrealisedPnl);
  const pnlValue = hasPnl ? (unrealisedPnl as number) : 0;
  const pnlIsZero = hasPnl && Math.abs(pnlValue) < 0.005;
  const pnlClass = !hasPnl || pnlIsZero
    ? "text-muted-foreground"
    : pnlValue >= 0
      ? "text-green-700 dark:text-green-400"
      : "text-red-700 dark:text-red-400";
  const pnlText = !hasPnl ? null : formatVoxDelta(pnlValue);

  const handlePlacePrediction = () => {
    onShowAllCandidates?.(market);
  };

  return (
    <PredictCard testId={`card-gainer-${market.id}`} className={`${isMarketClosed ? 'opacity-75' : ''} ${isShimmering ? 'shimmer-once' : ''}`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-violet-600 dark:text-violet-400 border-violet-500/40 dark:border-violet-500/30 text-[10px]">
            Weekly
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {volumeLabel && (
            <Badge
              variant="outline"
              className="text-[10px] tabular-nums text-muted-foreground border-border/50"
              data-testid={`gainer-card-volume-${market.id}`}
            >
              {volumeLabel} vol
            </Badge>
          )}
          <InteractiveCategoryPill
            category={market.category}
            onFilter={() => onFilterCategory?.(market.category)}
            raceMarketId={categoryRaceMap?.get(normalizeMarketCategory(market.category))}
            leaderboardCategories={leaderboardCategories}
          />
        </div>
      </div>
      <MarketCycleStrip
        bettingCutoff={market.bettingCutoff ?? null}
        resolveAt={market.endAt ?? null}
        variant="compact"
        className="mb-2"
        engine="amm"
      />

      <Link
        href={`/predict/race/${market.id}`}
        onClick={() => setPredictReturnAnchor(`card-gainer-${market.id}`)}
        className="group text-[16px] font-semibold mb-2 leading-[1.4] inline-flex items-center gap-1 text-foreground hover:text-violet-600 dark:hover:text-violet-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
      >
        Category Race: {getMarketCategoryLabel(market.category)}
        <span className="font-normal text-inherit opacity-80" aria-hidden>
          ›
        </span>
      </Link>

      {market.teaser?.trim() ? (
        <Link
          href={`/predict/race/${market.id}`}
          onClick={() => setPredictReturnAnchor(`card-gainer-${market.id}`)}
          className="block mb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
        >
          <p className="text-sm text-muted-foreground line-clamp-2 leading-[1.4] hover:text-violet-600 dark:hover:text-violet-400 transition-colors">
            {market.teaser.trim()}
          </p>
        </Link>
      ) : null}

      <div className="space-y-1.5 mb-3">
        {(() => {
          const maxGain = Math.max(...market.leaders.map(l => Math.abs(l.percentGain)), 1);
          return market.leaders.map((leader, i) => (
            <div
              key={leader.name}
              className={`flex items-center gap-2.5 p-2 rounded-lg transition-colors relative overflow-hidden ${canPick ? 'cursor-pointer' : ''} ${i === 0 ? 'bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/40 dark:border-amber-500/30' : canPick ? 'hover:bg-muted/50' : ''}`}
              onClick={() => {
                if (!canPick) return;
                onShowAllCandidates?.(market, leader);
              }}
            >
              <div className="absolute inset-y-0 left-0 bg-green-500/8 transition-all" style={{ width: `${Math.max((Math.abs(leader.percentGain) / maxGain) * 100, 5)}%` }} />
              <div className="relative flex items-center gap-2.5 flex-1 min-w-0">
                {i === 0 ? (
                  <div className="h-6 w-6 rounded-full bg-amber-500/25 dark:bg-amber-500/20 border border-amber-500/60 dark:border-amber-500/50 flex items-center justify-center shrink-0">
                    <Crown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  </div>
                ) : (
                  <div className="h-6 w-6 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">{leader.rank ? `#${leader.rank}` : 'New'}</span>
                  </div>
                )}
                <PersonAvatar name={leader.name} avatar={leader.avatar} className="h-12 w-12" />
                <span className="text-sm font-medium flex-1 truncate">{leader.name}</span>
              </div>
              <div className="relative text-right shrink-0">
                <p className={`text-sm font-mono font-bold ${leader.percentGain >= 0 ? 'text-green-500' : 'text-red-500'}`}>{formatSignedPercent(leader.percentGain)}</p>
                <p className={`text-[10px] font-mono ${leader.currentGain >= 0 ? 'text-muted-foreground' : 'text-red-600/80 dark:text-red-400/80'}`}>
                  {formatSignedPoints(leader.currentGain)} pts added
                </p>
              </div>
            </div>
          ));
        })()}
        {visibleCandidateCount > 3 && (
          <button
            className="text-xs text-violet-600 dark:text-violet-400 hover:text-violet-600 dark:hover:text-violet-400 text-center mt-1 w-full cursor-pointer transition-colors"
            onClick={(e) => { e.stopPropagation(); onShowAllCandidates?.(market); }}
          >
            View all {visibleCandidateCount} candidates
          </button>
        )}
      </div>

      <div className="mt-auto space-y-2">
        {isPredicted ? (
          <Link
            href={`/predict/race/${market.id}`}
            onClick={() => setPredictReturnAnchor(`card-gainer-${market.id}`)}
            className="block w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-testid={`link-predicted-gainer-${market.id}`}
            aria-label={
              predictionSummary
                ? `View Category Race ${getMarketCategoryLabel(market.category)}: your pick ${predictionSummary.pickLabel}, stake ${predictionSummary.stakeAmount}`
                : `View Category Race ${getMarketCategoryLabel(market.category)} prediction`
            }
          >
            {predictionSummary ? (
              <div className={PREDICTED_CTA_BASE}>
                <Check className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-none text-muted-foreground">Your pick</p>
                  <p className="truncate text-sm font-semibold leading-tight text-foreground">
                    {predictionSummary.pickLabel}
                  </p>
                </div>
                {pnlText ? (
                  <span className={cn("text-xs font-semibold font-mono tabular-nums shrink-0", pnlClass)}>
                    {pnlText}
                  </span>
                ) : null}
                <div className="flex shrink-0 flex-col items-end tabular-nums">
                  <span className="text-[10px] leading-none text-muted-foreground">Stake</span>
                  <span className="text-xs font-semibold leading-tight text-foreground">
                    {formatVox(predictionSummary.stakeAmount)}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </div>
            ) : (
              <div className={PREDICTED_CTA_BASE}>
                <Check className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-none text-muted-foreground">Your pick</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </div>
            )}
          </Link>
        ) : (
          <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
            <Button
              className="w-full min-h-10 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white py-3 md:py-2 h-auto"
              data-testid={`button-place-prediction-${market.id}`}
              onClick={handlePlacePrediction}
            >
              Choose Candidate
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </ClosedMarketActionTrigger>
        )}
      </div>
    </PredictCard>
  );
}
