import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { PredictCard } from "@/components/predict/PredictCard";
import type { ParticipantPreview } from "@/components/predict/ParticipantAvatarStack";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { formatSignedPercent, formatSignedPoints } from "@/lib/predict-display";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { TrendingUp, Crown, HelpCircle, ChevronRight, Check } from "lucide-react";
import { Link } from "wouter";

type CategoryFilter = "all" | "favorites" | "trending" | "tech" | "politics" | "business" | "music" | "sports" | "film-tv" | "gaming" | "creator" | "food-drink" | "lifestyle" | "misc";

export type GainerCandidate = {
  name: string;
  avatar: string;
  currentGain: number;
  percentGain: number;
  rank?: number;
  entryId?: string;
  personId?: string;
};

export interface TopGainerMarket {
  id: string;
  category: CategoryFilter;
  leaders: GainerCandidate[];
  allCandidates?: GainerCandidate[];
  totalPool: number;
  endTime: string;
  totalEntries?: number;
  candidateCount?: number;
  totalBets?: number;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
  bettingCutoff?: string | null;
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

function findPickRacePlace(market: TopGainerMarket, pickLabel: string): number | null {
  if (pickLabel === "Multiple picks") return null;
  const list =
    market.allCandidates ?? [...market.leaders].sort((a, b) => b.percentGain - a.percentGain);
  const idx = list.findIndex((c) => c.name === pickLabel);
  if (idx === -1) return null;
  return idx + 1;
}

/** e.g. 2 → "2nd Place", 11 → "11th Place" */
function formatOrdinalPlace(n: number): string {
  const j = n % 10;
  const k = n % 100;
  let suffix: string;
  if (j === 1 && k !== 11) suffix = "st";
  else if (j === 2 && k !== 12) suffix = "nd";
  else if (j === 3 && k !== 13) suffix = "rd";
  else suffix = "th";
  return `${n}${suffix} Place`;
}

function categoryRaceStandingLabel(place: number): string {
  if (place === 1) return "Winning";
  return formatOrdinalPlace(place);
}

function categoryRaceStandingBadgeClass(place: number): string {
  if (place === 1) {
    return "shrink-0 border bg-green-600/20 text-green-500 border-green-500/40 dark:border-green-500/30";
  }
  if (place === 2 || place === 3) {
    return "shrink-0 border bg-[#FF9100]/10 text-[#FF9100] border-[#FF9100]/50";
  }
  return "shrink-0 border bg-red-600/20 text-[#FF0000] border-red-500/40 dark:border-red-500/30";
}

export function TopGainerCard({
  market,
  isMarketClosed = false,
  closedMessage,
  onShowAllCandidates,
  isPredicted = false,
  predictionSummary = null,
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
  isShimmering?: boolean;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const visibleCandidateCount = market.candidateCount ?? market.allCandidates?.length ?? market.totalEntries ?? market.leaders.length;
  const canPick = !isPredicted;
  const racePlace = predictionSummary ? findPickRacePlace(market, predictionSummary.pickLabel) : null;

  const handlePlacePrediction = () => {
    onShowAllCandidates?.(market);
  };

  return (
    <PredictCard testId={`card-gainer-${market.id}`} className={`${isMarketClosed ? 'opacity-75' : ''} ${isShimmering ? 'shimmer-once' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground flex items-center gap-1 cursor-help border-b border-dashed border-muted-foreground/40">
              <TrendingUp className="h-3 w-3" />
              Biggest Mover Wins
              <HelpCircle className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[240px]">
            <p className="text-xs">Pick who will have the highest % gain in their Trend Score this week. The biggest mover wins, not the highest ranked.</p>
          </TooltipContent>
        </Tooltip>
        <InteractiveCategoryPill
          category={market.category}
          onFilter={() => onFilterCategory?.(market.category)}
          raceMarketId={categoryRaceMap?.get(normalizeMarketCategory(market.category))}
          leaderboardCategories={leaderboardCategories}
        />
      </div>

      <Link
        href={`/predict/race/${market.id}`}
        className="text-[16px] font-semibold mb-2 leading-[1.4] inline-flex items-center gap-1 text-foreground hover:text-violet-500 dark:hover:text-violet-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
      >
        Category Race: {getMarketCategoryLabel(market.category)}
        <span className="text-violet-600 dark:text-violet-400 font-normal" aria-hidden>
          ›
        </span>
      </Link>

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
            className="text-xs text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 text-center mt-1 w-full cursor-pointer transition-colors"
            onClick={(e) => { e.stopPropagation(); onShowAllCandidates?.(market); }}
          >
            View all {visibleCandidateCount} candidates
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-violet-700 dark:text-violet-500">
          Pool: {market.totalPool.toLocaleString('en-US')}
        </span>
      </div>

      <div className="mt-auto space-y-2">
        {isPredicted ? (
          <Link
            href={`/predict/race/${market.id}`}
            className="block w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-testid={`link-predicted-gainer-${market.id}`}
            aria-label={
              predictionSummary
                ? `View Category Race ${getMarketCategoryLabel(market.category)}: your pick ${predictionSummary.pickLabel}, stake ${predictionSummary.stakeAmount}${racePlace != null ? `, ${categoryRaceStandingLabel(racePlace)}` : ""}`
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
                <div className="flex shrink-0 flex-col items-end tabular-nums">
                  <span className="text-[10px] leading-none text-muted-foreground">Stake</span>
                  <span className="text-xs font-semibold leading-tight text-foreground">
                    {predictionSummary.stakeAmount.toLocaleString("en-US")}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {racePlace != null && (
                  <Badge className={categoryRaceStandingBadgeClass(racePlace)}>
                    {categoryRaceStandingLabel(racePlace)}
                  </Badge>
                )}
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
