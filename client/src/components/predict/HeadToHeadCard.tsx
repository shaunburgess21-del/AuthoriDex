import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { PredictCard } from "@/components/predict/PredictCard";
import { AmmPriceSparkline } from "@/components/predict/AmmPriceSparkline";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import type { ParticipantPreview } from "@/components/predict/ParticipantAvatarStack";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { cn } from "@/lib/utils";
import { type ApiAmmStateBlock, pricesFor, snapshotFromApi } from "@/lib/ammClient";
import { Activity, Check, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";
import { formatVolumeCredits } from "@/lib/formatNumber";

type CategoryFilter = "all" | "favorites" | "trending" | "tech" | "politics" | "business" | "music" | "sports" | "film-tv" | "gaming" | "creator" | "food-drink" | "lifestyle" | "misc";

export interface HeadToHeadMarket {
  id: string;
  title: string;
  person1: { name: string; avatar: string; currentScore: number };
  person2: { name: string; avatar: string; currentScore: number };
  person1EntryId?: string;
  person2EntryId?: string;
  /** Market entry `label` when it differs from `person.name` (for matching `/api/me/predictions` entryLabel). */
  person1EntryLabel?: string;
  person2EntryLabel?: string;
  person1Id?: string;
  person2Id?: string;
  category: CategoryFilter;
  endTime: string;
  endAt?: string | null;
  startAt?: string | null;
  person1Percent: number;
  totalBets?: number;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
  bettingCutoff?: string | null;
  /** Deterministic VoxDex model probability (percent for person1) — see `shared/h2hModel.ts`. */
  modelP1Percent?: number;
  /** Confidence bucket derived from the gap from 50/50. */
  modelConfidence?: "low" | "medium" | "high";
  /** Always 'amm' for native H2H post-sunset. Kept typed so call
   *  sites that still pass it don't break. */
  engine?: "amm" | string | null;
  /** Live AMM state snapshot from the list endpoint. */
  ammState?: ApiAmmStateBlock | null;
  /**
   * Total AMM credits in for the market. Drives a Polymarket-style
   * "1.2K cr vol" chip on the card.
   */
  volume?: number;
}

export function smartName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  if (fullName.length <= 14) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** Minimal market slice needed to resolve a user pick from prediction rows. */
export type H2hPickResolutionMarket = Pick<
  HeadToHeadMarket,
  "person1" | "person2" | "person1EntryId" | "person2EntryId" | "person1EntryLabel" | "person2EntryLabel"
>;

/** Resolve which side the user picked from aggregated `/api/me/predictions` data (entryId preferred; then labels). */
export function h2hUserPickFromBet(
  market: H2hPickResolutionMarket,
  bet: { entryLabel: string; entryId?: string | null } | undefined
): 1 | 2 | null {
  if (!bet) return null;
  if (bet.entryLabel === "Multiple positions") return null;
  const id = bet.entryId?.trim();
  if (id && market.person1EntryId && id === market.person1EntryId) return 1;
  if (id && market.person2EntryId && id === market.person2EntryId) return 2;
  const norm = (s: string) => s.trim();
  const label = norm(bet.entryLabel);
  if (label === norm(market.person1.name)) return 1;
  if (label === norm(market.person2.name)) return 2;
  const l1 = market.person1EntryLabel != null ? norm(market.person1EntryLabel) : "";
  const l2 = market.person2EntryLabel != null ? norm(market.person2EntryLabel) : "";
  if (l1 && label === l1) return 1;
  if (l2 && label === l2) return 2;
  return null;
}

export function HeadToHeadCard({
  market,
  isMarketClosed = false,
  closedMessage,
  onSelect,
  userPick,
  userStake,
  unrealisedPnl = null,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: {
  market: HeadToHeadMarket;
  isMarketClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: (person: 1 | 2) => void;
  userPick?: 1 | 2 | null;
  /** Aggregated stake for this market when the user has a pick (optional). */
  userStake?: number;
  /**
   * Live unrealised P&L (credits) for the user's open AMM position on
   * this market. Replaces the legacy "Winning / Behind" pill which
   * was anchored to the trend score crossing the baseline — that
   * signal can disagree with the AMM odds (the score dipped but the
   * market is pricing your side to win), so P&L is the truer "where
   * do I stand?" readout. Null when the position summary hasn't
   * loaded yet, in which case we fall back to a stake-only row with
   * no status pill at all (rather than a misleading score-based one).
   */
  unrealisedPnl?: number | null;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const hasPicked = userPick === 1 || userPick === 2;
  const pickedName = userPick === 1 ? market.person1.name : userPick === 2 ? market.person2.name : "";
  const volumeLabel = formatVolumeCredits(market.volume ?? 0);

  /**
   * AMM P&L delta + sub-cent zero clamp. `-0.0001 cr` rounds to
   * "-0.00 cr" via `.toFixed(2)`, which reads as a bug; we clamp
   * anything inside half a cent of zero to a neutral "0.00 cr" with
   * no sign prefix. Mirrors the WeeklyUpDownYourPositionPanel banner.
   */
  const hasPnl = unrealisedPnl != null && Number.isFinite(unrealisedPnl);
  const pnlValue = hasPnl ? (unrealisedPnl as number) : 0;
  const pnlIsZero = hasPnl && Math.abs(pnlValue) < 0.005;
  const pnlClass = !hasPnl || pnlIsZero
    ? "text-muted-foreground"
    : pnlValue >= 0
      ? "text-green-700 dark:text-green-400"
      : "text-red-700 dark:text-red-400";
  const pnlText = !hasPnl
    ? null
    : pnlIsZero
      ? "0.00 cr"
      : `${pnlValue >= 0 ? "+" : ""}${pnlValue.toFixed(2)} cr`;

  const pickAccentShell =
    userPick === 1
      ? "bg-[#3B82F6]/10 border-[#3B82F6]/50 hover:bg-[#3B82F6]/20 hover:border-[#3B82F6]/80"
      : "bg-[#7C3AED]/10 border-[#7C3AED]/50 hover:bg-[#7C3AED]/20 hover:border-[#7C3AED]/80";
  const pickAccentIconClass = userPick === 1 ? "text-[#3B82F6]" : "text-[#7C3AED]";
  const pickAvatarRing = userPick === 1 ? "ring-[#3B82F6]/70" : "ring-[#7C3AED]/70";
  const pickChipClass =
    userPick === 1
      ? "bg-[#3B82F6]/90 text-white border border-[#3B82F6]"
      : "bg-[#7C3AED]/90 text-white border border-[#7C3AED]";

  // Parimutuel sunset: every native H2H is AMM. Probability comes from
  // the live LMSR prices in the AMM snapshot.
  const ammSnapshot = snapshotFromApi(market.ammState ?? null);
  const ammPrices = ammSnapshot ? pricesFor(ammSnapshot) : null;
  let person1Percent = market.person1Percent;
  if (ammPrices && market.person1EntryId && market.person2EntryId) {
    const p1 = Number(ammPrices[market.person1EntryId] ?? 0);
    const p2 = Number(ammPrices[market.person2EntryId] ?? 0);
    const total = p1 + p2;
    if (total > 0) {
      person1Percent = Math.round((p1 / total) * 100);
    }
  }
  const person2Percent = 100 - person1Percent;
  const ammP1Price = ammPrices && market.person1EntryId ? ammPrices[market.person1EntryId] : null;
  const ammP2Price = ammPrices && market.person2EntryId ? ammPrices[market.person2EntryId] : null;

  return (
    <PredictCard testId={`card-h2h-${market.id}`} className={`relative overflow-hidden max-w-sm mx-auto ${isMarketClosed && !hasPicked ? 'opacity-75' : ''}`}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-0 top-0 w-1/2 h-full bg-gradient-to-r from-blue-600/20 to-transparent" />
        <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-purple-600/20 to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-violet-600 dark:text-violet-400 border-violet-500/40 dark:border-violet-500/30 text-[10px]">
              Weekly
            </Badge>
            {!isMarketClosed && (
              <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/40 dark:border-emerald-500/30 text-[10px]">
                <Activity className="h-3 w-3 mr-0.5" />LIVE
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {volumeLabel && (
              <Badge
                variant="outline"
                className="text-[10px] tabular-nums text-muted-foreground border-border/50"
                data-testid={`h2h-card-volume-${market.id}`}
              >
                {volumeLabel} vol
              </Badge>
            )}
            <InteractiveCategoryPill
              category={market.category}
              onFilter={() => onFilterCategory?.(market.category)}
              leaderboardCategories={leaderboardCategories}
              detailHref={`/predict/h2h/${market.id}`}
              detailLabel="View Battle Details"
            />
          </div>
        </div>
        <MarketCycleStrip
          bettingCutoff={market.bettingCutoff ?? null}
          resolveAt={market.endAt ?? null}
          variant="compact"
          engine="amm"
          className="mb-2"
        />

        <Link
          href={`/predict/h2h/${market.id}`}
          onClick={() => setPredictReturnAnchor(`card-h2h-${market.id}`)}
          className="relative mb-3 block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{ padding: '0 5px' }}
          aria-label={`View battle details: ${market.person1.name} vs ${market.person2.name}`}
        >
          <div className="flex" style={{ gap: '7px' }}>
            <div className="flex-1 relative">
              <div
                className={cn(
                  "rounded-lg overflow-hidden transition-all ring-2",
                  hasPicked && userPick === 1 ? pickAvatarRing : "ring-transparent"
                )}
              >
                <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} className="h-auto w-full aspect-[4/5]" />
              </div>
              {hasPicked && userPick === 1 && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10">
                  <span
                    className={cn(
                      "text-[8px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider whitespace-nowrap flex items-center gap-0.5",
                      pickChipClass
                    )}
                  >
                    <Check className="h-2.5 w-2.5" />
                    Your Pick
                  </span>
                </div>
              )}
            </div>
            <div className="flex-1 relative">
              <div
                className={cn(
                  "rounded-lg overflow-hidden transition-all ring-2",
                  hasPicked && userPick === 2 ? pickAvatarRing : "ring-transparent"
                )}
              >
                <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} className="h-auto w-full aspect-[4/5]" />
              </div>
              {hasPicked && userPick === 2 && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10">
                  <span
                    className={cn(
                      "text-[8px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider whitespace-nowrap flex items-center gap-0.5",
                      pickChipClass
                    )}
                  >
                    <Check className="h-2.5 w-2.5" />
                    Your Pick
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
            <div className="h-14 w-14 rounded-full bg-gradient-to-br from-muted to-card dark:from-slate-700 dark:to-slate-900 border-2 border-border dark:border-slate-500 flex items-center justify-center shadow-lg">
              <span className="text-sm font-bold text-foreground dark:text-slate-200">VS</span>
            </div>
          </div>
        </Link>

        <div className="flex items-center justify-between px-2 mb-2">
          {/* Score-row tiles: clickable for fresh picks AND same-side
              top-ups; greyed when the user picked the opposite side
              (opposite-side hedges blocked at the call site). */}
          {(() => {
            const p1Active = !hasPicked || userPick === 1;
            const p1Disabled = hasPicked && userPick !== 1;
            return (
              <ClosedMarketActionTrigger isClosed={isMarketClosed && !hasPicked} message={closedMessage} side="top" align="center">
                <div
                  className={cn(
                    "flex flex-col items-center flex-1",
                    p1Active && "cursor-pointer",
                    p1Disabled && "opacity-40 cursor-not-allowed",
                  )}
                  onClick={() => p1Active && onSelect?.(1)}
                  aria-disabled={p1Disabled || undefined}
                >
                  <p className="text-sm font-semibold text-center">{smartName(market.person1.name)}</p>
                  <span className="text-[10px] font-mono text-muted-foreground">{market.person1.currentScore?.toLocaleString('en-US') || ''}</span>
                  <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">{person1Percent}%</span>
                </div>
              </ClosedMarketActionTrigger>
            );
          })()}
          {(() => {
            const p2Active = !hasPicked || userPick === 2;
            const p2Disabled = hasPicked && userPick !== 2;
            return (
              <ClosedMarketActionTrigger isClosed={isMarketClosed && !hasPicked} message={closedMessage} side="top" align="center">
                <div
                  className={cn(
                    "flex flex-col items-center flex-1",
                    p2Active && "cursor-pointer",
                    p2Disabled && "opacity-40 cursor-not-allowed",
                  )}
                  onClick={() => p2Active && onSelect?.(2)}
                  aria-disabled={p2Disabled || undefined}
                >
                  <p className="text-sm font-semibold text-center">{smartName(market.person2.name)}</p>
                  <span className="text-[10px] font-mono text-muted-foreground">{market.person2.currentScore?.toLocaleString('en-US') || ''}</span>
                  <span className="text-xs text-purple-600 dark:text-purple-400 font-semibold">{person2Percent}%</span>
                </div>
              </ClosedMarketActionTrigger>
            );
          })()}
        </div>

        <div className="h-2 rounded-full overflow-hidden mb-2 flex">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400"
            style={{ width: `${person1Percent}%` }}
          />
          <div
            className="h-full bg-gradient-to-l from-purple-500 to-purple-400"
            style={{ width: `${person2Percent}%` }}
          />
        </div>

        {ammP1Price != null && ammP2Price != null && (
          // Name is already shown above in big text. We show per-share
          // price here as muted secondary info so the headline %% stays
          // primary, with a small sparkline of the person-1 series so
          // users get a 7-day price feel at a glance.
          <div className="flex items-center justify-between px-2 text-[10px] mb-2 text-muted-foreground">
            <span>{ammP1Price.toFixed(3)} cr/share</span>
            {market.person1EntryId && (
              <AmmPriceSparkline
                marketId={market.id}
                entryId={market.person1EntryId}
                fallbackPrice={ammP1Price}
                width={56}
                height={16}
                className="stroke-blue-500 dark:stroke-blue-400"
              />
            )}
            <span>{ammP2Price.toFixed(3)} cr/share</span>
          </div>
        )}

        <div className="mt-auto">
          {hasPicked ? (
            <div className="flex items-stretch gap-2">
              {/* Primary tap = same-side top-up via parent's StakeModal.
                  Falls back to the detail-page link for legacy callers
                  that didn't wire onSelect. */}
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(userPick as 1 | 2)}
                  className="flex-1 block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  data-testid={`button-h2h-topup-${market.id}`}
                  aria-label={`Add to your ${smartName(pickedName)} stake`}
                >
                  <div
                    className={cn(
                      "flex min-h-10 items-center gap-2 rounded-lg border px-3 py-3 md:py-2 transition-colors",
                      pickAccentShell
                    )}
                  >
                    <Check className={cn("h-4 w-4 shrink-0", pickAccentIconClass)} />
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-[11px] leading-none text-muted-foreground">Your pick</p>
                      <p className="truncate text-sm font-semibold leading-tight text-foreground">{smartName(pickedName)}</p>
                    </div>
                    {pnlText && (
                      <span className={cn("text-xs font-semibold font-mono tabular-nums shrink-0", pnlClass)}>
                        {pnlText}
                      </span>
                    )}
                    {userStake != null && (
                      <div className="flex shrink-0 flex-col items-end tabular-nums">
                        <span className="text-[10px] leading-none text-muted-foreground">Stake</span>
                        <span className="text-xs font-semibold leading-tight text-foreground">
                          {userStake.toLocaleString("en-US")}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              ) : (
                <Link
                  href={`/predict/h2h/${market.id}`}
                  onClick={() => setPredictReturnAnchor(`card-h2h-${market.id}`)}
                  className="flex-1 block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  data-testid={`link-h2h-your-pick-${market.id}`}
                  aria-label={`View head-to-head details: your pick ${smartName(pickedName)}`}
                >
                  <div
                    className={cn(
                      "flex min-h-10 items-center gap-2 rounded-lg border px-3 py-3 md:py-2 transition-colors",
                      pickAccentShell
                    )}
                  >
                    <Check className={cn("h-4 w-4 shrink-0", pickAccentIconClass)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-none text-muted-foreground">Your pick</p>
                      <p className="truncate text-sm font-semibold leading-tight text-foreground">{smartName(pickedName)}</p>
                    </div>
                    {pnlText && (
                      <span className={cn("text-xs font-semibold font-mono tabular-nums shrink-0", pnlClass)}>
                        {pnlText}
                      </span>
                    )}
                    {userStake != null && (
                      <div className="flex shrink-0 flex-col items-end tabular-nums">
                        <span className="text-[10px] leading-none text-muted-foreground">Stake</span>
                        <span className="text-xs font-semibold leading-tight text-foreground">
                          {userStake.toLocaleString("en-US")}
                        </span>
                      </div>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </div>
                </Link>
              )}
              {/* Secondary "View details" affordance — keeps the
                  detail-page link reachable when the primary tap is
                  the top-up flow. */}
              {onSelect && (
                <Link
                  href={`/predict/h2h/${market.id}`}
                  onClick={() => setPredictReturnAnchor(`card-h2h-${market.id}`)}
                  className="shrink-0 flex items-center justify-center px-2 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  data-testid={`link-h2h-details-${market.id}`}
                  aria-label="View head-to-head details"
                >
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
                <Button
                  className="bg-[#3B82F6]/10 border border-[#3B82F6]/50 text-[#3B82F6] hover:border-[#3B82F6]/80 hover:bg-[#3B82F6]/20 py-3 md:py-2 h-auto"
                  onClick={() => onSelect?.(1)}
                  data-testid={`button-pick1-${market.id}`}
                >
                  {smartName(market.person1.name)}
                </Button>
              </ClosedMarketActionTrigger>
              <ClosedMarketActionTrigger isClosed={isMarketClosed} message={closedMessage} side="top" align="center">
                <Button
                  className="bg-[#7C3AED]/10 border border-[#7C3AED]/50 text-[#7C3AED] hover:border-[#7C3AED]/80 hover:bg-[#7C3AED]/20 py-3 md:py-2 h-auto"
                  onClick={() => onSelect?.(2)}
                  data-testid={`button-pick2-${market.id}`}
                >
                  {smartName(market.person2.name)}
                </Button>
              </ClosedMarketActionTrigger>
            </div>
          )}
        </div>
      </div>
    </PredictCard>
  );
}
