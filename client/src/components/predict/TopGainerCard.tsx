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
import { formatVox, formatVoxCompact, formatVoxDelta } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { Check, ChevronRight } from "lucide-react";

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

const FOOTER_SHELL_CLASS =
  "flex min-h-10 items-center gap-2 rounded-lg border px-3 py-3 md:py-2 transition-colors w-full";

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
  const candidates = market.allCandidates ?? market.leaders;
  const volumeLabel = formatVoxCompact(market.volume ?? 0);
  const raceDetailHref = `/predict/race/${market.id}`;

  const navigateToRaceDetail = () => {
    setPredictReturnAnchor(`card-gainer-${market.id}`);
  };

  const hasPnl = unrealisedPnl != null && Number.isFinite(unrealisedPnl);
  const pnlValue = hasPnl ? (unrealisedPnl as number) : 0;
  const pnlIsZero = hasPnl && Math.abs(pnlValue) < 0.005;
  const pnlClass = !hasPnl || pnlIsZero
    ? "text-muted-foreground"
    : pnlValue >= 0
      ? "text-green-700 dark:text-green-400"
      : "text-red-700 dark:text-red-400";
  const pnlText = !hasPnl ? null : formatVoxDelta(pnlValue);

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
          <Link
            href={raceDetailHref}
            onClick={navigateToRaceDetail}
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-testid={`button-gainer-your-pick-${market.id}`}
            aria-label={
              predictionSummary?.pickLabel
                ? `View your pick: ${predictionSummary.pickLabel}`
                : "View your race pick"
            }
          >
            <div
              className={cn(
                FOOTER_SHELL_CLASS,
                "border-violet-500/40 dark:border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/5 hover:bg-violet-500/12 dark:hover:bg-violet-500/10",
              )}
            >
              <Check className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[11px] leading-none text-muted-foreground">Your pick</p>
                <p className="truncate text-sm font-semibold leading-tight text-foreground">
                  {predictionSummary?.pickLabel ?? "View position"}
                </p>
              </div>
              {pnlText && (
                <span className={cn("text-xs font-semibold font-mono tabular-nums shrink-0", pnlClass)}>
                  {pnlText}
                </span>
              )}
              {predictionSummary != null && (
                <div className="flex shrink-0 flex-col items-end tabular-nums">
                  <span className="text-[10px] leading-none text-muted-foreground">Stake</span>
                  <span className="text-xs font-semibold leading-tight text-foreground">
                    {formatVox(predictionSummary.stakeAmount)}
                  </span>
                </div>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </div>
          </Link>
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
