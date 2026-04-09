import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ClosedMarketActionTrigger } from "@/components/predict/ClosedMarketActionTrigger";
import { PredictCard } from "@/components/predict/PredictCard";
import type { ParticipantPreview } from "@/components/predict/ParticipantAvatarStack";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";
import { Clock, Check } from "lucide-react";
import { Link } from "wouter";

type CategoryFilter = "all" | "favorites" | "trending" | "tech" | "politics" | "business" | "music" | "sports" | "film-tv" | "gaming" | "creator" | "food-drink" | "lifestyle" | "misc";

export interface HeadToHeadMarket {
  id: string;
  title: string;
  person1: { name: string; avatar: string; currentScore: number };
  person2: { name: string; avatar: string; currentScore: number };
  person1EntryId?: string;
  person2EntryId?: string;
  person1Id?: string;
  person2Id?: string;
  category: CategoryFilter;
  endTime: string;
  totalPool: number;
  person1Percent: number;
  totalBets?: number;
  activeParticipantCount?: number;
  recentParticipants?: ParticipantPreview[];
  bettingCutoff?: string | null;
}

export function smartName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  if (fullName.length <= 14) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function HeadToHeadCard({
  market,
  isMarketClosed = false,
  closedMessage,
  onSelect,
  userPick,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: {
  market: HeadToHeadMarket;
  isMarketClosed?: boolean;
  closedMessage: Pick<ClosedMarketMessage, "title" | "lines">;
  onSelect?: (person: 1 | 2) => void;
  userPick?: 1 | 2 | null;
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

  return (
    <PredictCard testId={`card-h2h-${market.id}`} className={`relative overflow-hidden max-w-sm mx-auto ${isMarketClosed && !hasPicked ? 'opacity-75' : ''}`}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-0 top-0 w-1/2 h-full bg-gradient-to-r from-blue-600/20 to-transparent" />
        <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-purple-600/20 to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between mb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs cursor-help">
                <Clock className="h-3 w-3 mr-1" />
                {market.endTime}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Market closes {market.endTime}</p>
            </TooltipContent>
          </Tooltip>
          <InteractiveCategoryPill
            category={market.category}
            onFilter={() => onFilterCategory?.(market.category)}
            leaderboardCategories={leaderboardCategories}
            detailHref={`/predict/h2h/${market.id}`}
            detailLabel="View Battle Details"
          />
        </div>

        <Link
          href={`/predict/h2h/${market.id}`}
          className="relative mb-3 block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{ padding: '0 5px' }}
          aria-label={`View battle details: ${market.person1.name} vs ${market.person2.name}`}
        >
          <div className="flex" style={{ gap: '7px' }}>
            <div className="flex-1 relative">
              <div className={`rounded-lg overflow-hidden transition-all ${hasPicked && userPick === 1 ? 'ring-2 ring-green-500/70' : 'ring-2 ring-transparent'}`}>
                <PersonAvatar name={market.person1.name} avatar={market.person1.avatar} className="h-auto w-full aspect-[4/5]" />
              </div>
              {hasPicked && userPick === 1 && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10">
                  <span className="bg-green-600/90 text-white text-[8px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider whitespace-nowrap flex items-center gap-0.5">
                    <Check className="h-2.5 w-2.5" />
                    Your Pick
                  </span>
                </div>
              )}
            </div>
            <div className="flex-1 relative">
              <div className={`rounded-lg overflow-hidden transition-all ${hasPicked && userPick === 2 ? 'ring-2 ring-green-500/70' : 'ring-2 ring-transparent'}`}>
                <PersonAvatar name={market.person2.name} avatar={market.person2.avatar} className="h-auto w-full aspect-[4/5]" />
              </div>
              {hasPicked && userPick === 2 && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10">
                  <span className="bg-green-600/90 text-white text-[8px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider whitespace-nowrap flex items-center gap-0.5">
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

        <div className="flex items-center justify-center mb-2">
          <span className="text-sm font-semibold text-violet-700 dark:text-violet-500">
            Pool: {market.totalPool.toLocaleString('en-US')}
          </span>
        </div>

        <div className="mt-auto">
          {hasPicked ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-500/40 dark:border-green-500/30 bg-green-500/8 dark:bg-green-500/5 px-3 py-2">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground">Your pick</p>
                <p className="text-sm font-semibold truncate">{smartName(pickedName)}</p>
              </div>
              <Badge
                className={
                  pickWinning
                    ? "bg-green-600/20 text-green-500 border-green-500/40 dark:border-green-500/30"
                    : pickTied
                    ? "bg-amber-600/20 text-amber-500 border-amber-500/40 dark:border-amber-500/30"
                    : "bg-red-600/20 text-red-500 border-red-500/40 dark:border-red-500/30"
                }
              >
                {pickWinning ? "Winning" : pickTied ? "Tied" : "Behind"}
              </Badge>
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
