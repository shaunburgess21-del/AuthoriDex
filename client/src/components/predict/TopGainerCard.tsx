import { Badge } from "@/components/ui/badge";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { CategoryRaceCandidateRow } from "@/components/predict/CategoryRaceCandidateRow";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { PredictCard } from "@/components/predict/PredictCard";
import type { ParticipantPreview } from "@/components/predict/ParticipantAvatarStack";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { getMarketCategoryLabel, normalizeMarketCategory, type FilterCategory } from "@shared/constants";
import { Link } from "wouter";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";
import { categoryRaceShare } from "@/lib/share";
import { formatVoxCompact } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import {
  PositionSummaryRow,
  POSITION_SUMMARY_SHELL_CLASS,
} from "@/components/predict/PositionSummaryRow";

export type CategoryRaceEntryStakes = Map<string, { yesStake: number; noStake: number }>;

type CategoryFilter = FilterCategory;

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

/** Build card footer copy from aggregated `/api/me/predictions` row for this market.
 *  Prefer AMM `netCreditsIn` when provided so partial sells don't inflate Stake. */
export function categoryRacePredictionSummaryFromBet(
  bet: { entryLabel: string; stakeAmount: number } | undefined,
  netCreditsIn?: number | null,
): CategoryRacePredictionSummary | null {
  if (!bet) return null;
  const stake =
    typeof netCreditsIn === "number" && Number.isFinite(netCreditsIn) && netCreditsIn >= 0
      ? Math.round(netCreditsIn)
      : bet.stakeAmount;
  return {
    pickLabel: bet.entryLabel === "Multiple positions" ? "Multiple picks" : bet.entryLabel,
    stakeAmount: stake,
  };
}

/** Re-export shared shell class for any local callers / tests. */
export const FOOTER_SHELL_CLASS = POSITION_SUMMARY_SHELL_CLASS;

export function TopGainerCard({
  market,
  isMarketClosed = false,
  closedMessage,
  onSelectCandidate,
  highlightedEntryId = null,
  entryStakes,
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
  onSelectCandidate?: (market: TopGainerMarket, candidate: GainerCandidate) => void;
  highlightedEntryId?: string | null;
  /** Per-entry stake totals for this market — drives backed-row highlight. */
  entryStakes?: CategoryRaceEntryStakes;
  isPredicted?: boolean;
  predictionSummary?: CategoryRacePredictionSummary | null;
  /**
   * Live unrealised P&L for the user's open position(s) on this race.
   * Single-pick: top-leg P&L. Multiple picks: pass the summed totals
   * from `positionTotalsByMarket` so the footer matches the stake rollup.
   */
  unrealisedPnl?: number | null;
  isShimmering?: boolean;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const candidates = market.allCandidates ?? market.leaders;
  const volumeLabel = formatVoxCompact(market.volume ?? 0);
  const raceDetailHref = `/predict/race/${market.id}`;

  const navigateToRaceDetail = () => {
    setPredictReturnAnchor(`card-gainer-${market.id}`);
  };

  const backedCandidate = (() => {
    if (predictionSummary?.pickLabel === "Multiple picks") return null;

    if (predictionSummary?.pickLabel) {
      const byLabel = candidates.find((c) => c.name === predictionSummary.pickLabel);
      if (byLabel?.entryId && (entryStakes?.get(byLabel.entryId)?.yesStake ?? 0) > 0) {
        return byLabel;
      }
    }

    if (highlightedEntryId) {
      const match = candidates.find((c) => c.entryId === highlightedEntryId);
      if (match) return match;
    }

    if (entryStakes) {
      const staked = candidates.filter(
        (c) => c.entryId && (entryStakes.get(c.entryId)?.yesStake ?? 0) > 0,
      );
      if (staked.length === 1) return staked[0];
    }

    return null;
  })();

  const showAddButton = !isMarketClosed && !!onSelectCandidate && !!backedCandidate;

  return (
    <PredictCard
      autoSize
      testId={`card-gainer-${market.id}`}
      className={`${isMarketClosed ? "opacity-75" : ""} ${isShimmering ? "shimmer-once" : ""}`}
    >
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
            detailHref={raceDetailHref}
            detailLabel="View Race Details"
            share={
              market.id
                ? categoryRaceShare(market.id, getMarketCategoryLabel(market.category))
                : undefined
            }
            reactionTarget={{ surfaceType: "market_gainer", targetId: String(market.id) }}
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

      {market.teaser?.trim() ? (
        <Link
          href={raceDetailHref}
          onClick={navigateToRaceDetail}
          className="block mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
        >
          <p className="text-sm text-muted-foreground line-clamp-2 leading-[1.4] hover:text-violet-600 dark:hover:text-violet-400 transition-colors">
            {market.teaser.trim()}
          </p>
        </Link>
      ) : null}

      <div className="space-y-1.5 mb-1">
        {candidates.map((candidate, i) => {
          const candidateKey = candidate.entryId || candidate.personId || candidate.name;
          const hasPosition =
            !!candidate.entryId && (entryStakes?.get(candidate.entryId)?.yesStake ?? 0) > 0;
          const isSelected =
            (!!highlightedEntryId && candidate.entryId === highlightedEntryId) || hasPosition;
          const rowNonInteractive = isMarketClosed || (isPredicted && hasPosition);

          return (
            <CategoryRaceCandidateRow
              key={candidateKey}
              candidate={candidate}
              rankIndex={i}
              isSelected={isSelected}
              nonInteractive={rowNonInteractive}
              isMarketClosed={isMarketClosed}
              closedMessage={closedMessage}
              onSelect={
                rowNonInteractive
                  ? undefined
                  : () => onSelectCandidate?.(market, candidate)
              }
              size="card"
              testId={`gainer-candidate-${market.id}-${candidateKey}`}
            />
          );
        })}
      </div>

      <div className="mt-auto pt-1">
        {isPredicted ? (
          <PositionSummaryRow
            pickLabel={predictionSummary?.pickLabel ?? "View position"}
            stakeAmount={predictionSummary?.stakeAmount ?? null}
            unrealisedPnl={unrealisedPnl}
            href={raceDetailHref}
            onLinkClick={navigateToRaceDetail}
            onAdd={showAddButton ? () => onSelectCandidate!(market, backedCandidate!) : undefined}
            addAriaLabel={
              backedCandidate ? `Add to your ${backedCandidate.name} stake` : undefined
            }
            linkAriaLabel={
              predictionSummary?.pickLabel
                ? `View your pick: ${predictionSummary.pickLabel}`
                : "View your race pick"
            }
            testId={`button-gainer-your-pick-${market.id}`}
            addTestId={`button-gainer-add-${market.id}`}
          />
        ) : (
          <Link
            href={raceDetailHref}
            onClick={navigateToRaceDetail}
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-testid={`button-gainer-view-details-${market.id}`}
            aria-label="View race details"
          >
            <div
              className={cn(
                FOOTER_SHELL_CLASS,
                "justify-center border-border/50 bg-muted/30 hover:bg-muted/45 dark:hover:bg-muted/40",
              )}
            >
              <span className="text-sm font-medium text-foreground">View race details</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </div>
          </Link>
        )}
      </div>
    </PredictCard>
  );
}
