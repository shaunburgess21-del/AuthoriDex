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

export function TopGainerCard({
  market,
  isMarketClosed = false,
  closedMessage,
  onSelectCandidate,
  highlightedEntryId = null,
  isPredicted = false,
  predictionSummary: _predictionSummary = null,
  unrealisedPnl: _unrealisedPnl = null,
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
  const canPick = !isPredicted;
  const volumeLabel = formatVoxCompact(market.volume ?? 0);

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
          href={`/predict/race/${market.id}`}
          onClick={() => setPredictReturnAnchor(`card-gainer-${market.id}`)}
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
          const isSelected = !!highlightedEntryId && candidate.entryId === highlightedEntryId;

          return (
            <CategoryRaceCandidateRow
              key={candidateKey}
              candidate={candidate}
              rankIndex={i}
              isSelected={isSelected}
              nonInteractive={!canPick}
              isMarketClosed={isMarketClosed}
              closedMessage={closedMessage}
              onSelect={
                canPick
                  ? () => onSelectCandidate?.(market, candidate)
                  : undefined
              }
              size="card"
              testId={`gainer-candidate-${market.id}-${candidateKey}`}
            />
          );
        })}
      </div>
    </PredictCard>
  );
}
