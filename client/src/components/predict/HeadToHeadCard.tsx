import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { PredictCard } from "@/components/predict/PredictCard";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import type { ParticipantPreview } from "@/components/predict/ParticipantAvatarStack";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { cn } from "@/lib/utils";
import { multiplierFromPercent, formatMultiplier } from "@/lib/parimutuel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";

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
  totalPool: number;
  person1Percent: number;
  totalBets?: number;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
  bettingCutoff?: string | null;
  /** Deterministic VoxDex model probability (percent for person1) — see `shared/h2hModel.ts`. */
  modelP1Percent?: number;
  /** Confidence bucket derived from the gap from 50/50. */
  modelConfidence?: "low" | "medium" | "high";
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
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const hasPicked = userPick === 1 || userPick === 2;
  const pickedName = userPick === 1 ? market.person1.name : userPick === 2 ? market.person2.name : "";
  const scoreDiff = (market.person1.currentScore || 0) - (market.person2.currentScore || 0);
  const pickWinning = hasPicked && (
    (userPick === 1 && scoreDiff > 0) || (userPick === 2 && scoreDiff < 0)
  );
  const pickTied = hasPicked && scoreDiff === 0;

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
  const isHot = market.totalPool > 5000 || (market.totalBets ?? market.activeParticipantCount ?? 0) > 50;

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
            {isHot && (
              <Badge variant="outline" className="text-orange-600 dark:text-orange-400 border-orange-500/40 dark:border-orange-500/30 text-[10px]">
                Hot
              </Badge>
            )}
          </div>
          <InteractiveCategoryPill
            category={market.category}
            onFilter={() => onFilterCategory?.(market.category)}
            leaderboardCategories={leaderboardCategories}
            detailHref={`/predict/h2h/${market.id}`}
            detailLabel="View Battle Details"
          />
        </div>
        <MarketCycleStrip
          bettingCutoff={market.bettingCutoff ?? null}
          resolveAt={market.endAt ?? null}
          variant="compact"
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
          <ClosedMarketActionTrigger isClosed={isMarketClosed && !hasPicked} message={closedMessage} side="top" align="center">
            <div
              className={`flex flex-col items-center flex-1 ${!hasPicked ? 'cursor-pointer' : ''}`}
              onClick={() => !hasPicked && onSelect?.(1)}
            >
              <p className="text-sm font-semibold text-center">{smartName(market.person1.name)}</p>
              <span className="text-[10px] font-mono text-muted-foreground">{market.person1.currentScore?.toLocaleString('en-US') || ''}</span>
              <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold">{market.person1Percent}%</span>
            </div>
          </ClosedMarketActionTrigger>
          <ClosedMarketActionTrigger isClosed={isMarketClosed && !hasPicked} message={closedMessage} side="top" align="center">
            <div
              className={`flex flex-col items-center flex-1 ${!hasPicked ? 'cursor-pointer' : ''}`}
              onClick={() => !hasPicked && onSelect?.(2)}
            >
              <p className="text-sm font-semibold text-center">{smartName(market.person2.name)}</p>
              <span className="text-[10px] font-mono text-muted-foreground">{market.person2.currentScore?.toLocaleString('en-US') || ''}</span>
              <span className="text-xs text-purple-600 dark:text-purple-400 font-semibold">{100 - market.person1Percent}%</span>
            </div>
          </ClosedMarketActionTrigger>
        </div>

        <div className="h-2 rounded-full overflow-hidden mb-2 flex">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400"
            style={{ width: `${market.person1Percent}%` }}
          />
          <div
            className="h-full bg-gradient-to-l from-purple-500 to-purple-400"
            style={{ width: `${100 - market.person1Percent}%` }}
          />
        </div>

        {typeof market.modelP1Percent === "number" && (
          <div className="flex items-center justify-center mb-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  data-testid={`badge-h2h-model-${market.id}`}
                  className="text-[10px] font-medium cursor-help px-2 py-0.5 border-violet-400/40 bg-violet-500/5 text-violet-700 dark:text-violet-300"
                >
                  <span className="mr-1 opacity-70">VoxDex Model:</span>
                  <span className="font-semibold">
                    {smartName(
                      market.modelP1Percent >= 50 ? market.person1.name : market.person2.name,
                    )}{" "}
                    {Math.max(market.modelP1Percent, 100 - market.modelP1Percent)}%
                  </span>
                  {market.modelConfidence && (
                    <span className="ml-1.5 opacity-70">
                      · {market.modelConfidence}
                    </span>
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[240px]">
                <p className="text-xs leading-snug">
                  Based on fame index and momentum. Not a guarantee — you're still
                  predicting.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        <div className="flex items-center justify-center mb-2">
          <span className="text-sm font-semibold text-violet-700 dark:text-violet-500">
            Pool: {market.totalPool.toLocaleString('en-US')} credits
          </span>
        </div>

        <div className="flex items-center justify-between px-2 text-[11px] font-semibold mb-2">
          <span className="text-blue-600 dark:text-blue-400">
            {smartName(market.person1.name)} {formatMultiplier(multiplierFromPercent(market.person1Percent))}
          </span>
          <span className="text-purple-600 dark:text-purple-400">
            {smartName(market.person2.name)} {formatMultiplier(multiplierFromPercent(100 - market.person1Percent))}
          </span>
        </div>

        <div className="mt-auto">
          {hasPicked ? (
            <Link
              href={`/predict/h2h/${market.id}`}
              onClick={() => setPredictReturnAnchor(`card-h2h-${market.id}`)}
              className="block w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                {userStake != null && (
                  <div className="flex shrink-0 flex-col items-end tabular-nums">
                    <span className="text-[10px] leading-none text-muted-foreground">Stake</span>
                    <span className="text-xs font-semibold leading-tight text-foreground">
                      {userStake.toLocaleString("en-US")}
                    </span>
                  </div>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <Badge
                  className={
                    pickWinning
                      ? "shrink-0 bg-green-600/20 text-green-500 border-green-500/40 dark:border-green-500/30"
                      : pickTied
                        ? "shrink-0 bg-amber-600/20 text-amber-500 border-amber-500/40 dark:border-amber-500/30"
                        : "shrink-0 bg-[#FF0000]/10 text-[#FF0000] border-[#FF0000]/50 dark:border-[#FF0000]/50"
                  }
                >
                  {pickWinning ? "Winning" : pickTied ? "Tied" : "Behind"}
                </Badge>
              </div>
            </Link>
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
