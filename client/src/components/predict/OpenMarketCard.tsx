import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Drawer } from "vaul";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { AvatarHeightHeadline } from "@/components/AvatarHeightHeadline";
import { PredictCard } from "@/components/predict/PredictCard";
import { ParticipantAvatarStack } from "@/components/predict/ParticipantAvatarStack";
import { Link, useLocation } from "wouter";
import { Check, ChevronRight, Clock, Lock, Trophy, XCircle, RotateCcw, X, ExternalLink } from "lucide-react";
import { computePayoutMultiplier, formatMultiplier } from "@/lib/parimutuel";

function MarketAvatar({ market }: { market: any }) {
  const imgUrl = market.coverImageUrl || market.linkedPersonAvatar;
  if (!imgUrl) return null;
  return (
    <Avatar className="h-20 w-20 shrink-0 rounded-md md:h-16 md:w-16">
      <AvatarImage src={imgUrl} alt={market.title} className="object-cover" />
      <AvatarFallback className="text-sm rounded-md">{(market.title || "?")[0]}</AvatarFallback>
    </Avatar>
  );
}

function MarketAvatarOrSpacer({ market }: { market: any }) {
  const imgUrl = market.coverImageUrl || market.linkedPersonAvatar;
  if (!imgUrl) {
    return <div className="h-20 w-20 shrink-0 rounded-md md:h-16 md:w-16 bg-muted/25" aria-hidden />;
  }
  return <MarketAvatar market={market} />;
}

function PayoutDetails({ marketId }: { marketId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{ totalPool: number; userStake: number; winnerPoolTotal: number; userPayout: number; remainderPolicy: string }>({
    queryKey: ['/api/markets', marketId, 'my-payout'],
    enabled: open,
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[10px] text-muted-foreground underline underline-offset-2 mt-1" data-testid="button-payout-details">
        View details
      </button>
    );
  }

  return (
    <div className="mt-1.5 text-[10px] text-muted-foreground space-y-0.5 border-t border-border/50 pt-1.5" data-testid="section-payout-details">
      {isLoading ? (
        <span>Loading...</span>
      ) : data ? (
        (() => {
          const netPL = data.userPayout - data.userStake;
          const plColor = netPL > 0 ? 'text-emerald-600 dark:text-emerald-400' : netPL < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';
          const plSign = netPL > 0 ? '+' : '';
          return (
            <>
              <div className="flex items-center justify-between gap-2"><span>Your stake</span><span className="font-mono">{data.userStake.toLocaleString()}</span></div>
              <div className="flex items-center justify-between gap-2"><span>Your payout</span><span className="font-mono font-semibold">{data.userPayout.toLocaleString()}</span></div>
              <div className="flex items-center justify-between gap-2"><span>Net P&L</span><span className={`font-mono font-semibold ${plColor}`}>{plSign}{netPL.toLocaleString()}</span></div>
              <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-border/30"><span>Total pool</span><span className="font-mono">{data.totalPool.toLocaleString()}</span></div>
              {data.winnerPoolTotal > 0 && <div className="flex items-center justify-between gap-2"><span>Winner pool</span><span className="font-mono">{data.winnerPoolTotal.toLocaleString()}</span></div>}
            </>
          );
        })()
      ) : (
        <span>Could not load details</span>
      )}
    </div>
  );
}

function UserBetResult({ betResult, isMarketClosed = false }: { betResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number; marketId?: string }; isMarketClosed?: boolean }) {
  if (!betResult) return null;
  if (betResult.result === 'pending') {
    if (!isMarketClosed) return null;
    return (
      <div className="flex items-center gap-2 text-xs font-semibold px-2 py-1.5 rounded-md mt-2 bg-muted/50 text-muted-foreground" data-testid="text-bet-awaiting">
        <Clock className="h-3.5 w-3.5" />
        Awaiting Results
        <span className="font-normal ml-auto">Picked: {betResult.entryLabel}</span>
      </div>
    );
  }
  const isResolved = betResult.result === 'won' || betResult.result === 'lost';
  return (
    <div>
      <div className={`flex items-center gap-2 text-xs font-semibold px-2 py-1.5 rounded-md mt-2 ${
        betResult.result === 'won' ? 'bg-emerald-500/15 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
        betResult.result === 'refunded' ? 'bg-yellow-500/15 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' :
        'bg-red-500/15 dark:bg-red-500/10 text-red-600 dark:text-red-400'
      }`} data-testid="text-bet-result">
        {betResult.result === 'won' && <Trophy className="h-3.5 w-3.5" />}
        {betResult.result === 'lost' && <XCircle className="h-3.5 w-3.5" />}
        {betResult.result === 'refunded' && <RotateCcw className="h-3.5 w-3.5" />}
        {betResult.result === 'won' ? `Won +${betResult.payout} credits` :
         betResult.result === 'refunded' ? `Refunded ${betResult.stakeAmount} credits` :
         `Lost ${betResult.stakeAmount} credits`}
        <span className="text-muted-foreground font-normal ml-auto">Picked: {betResult.entryLabel}</span>
      </div>
      {isResolved && betResult.marketId && <PayoutDetails marketId={betResult.marketId} />}
    </div>
  );
}

function isYesLikeLabel(label: string) {
  const l = (label || "").toLowerCase();
  return l === "yes" || l === "above";
}

function PendingBetLinkRow({ entryLabel, stakeAmount, href }: { entryLabel: string; stakeAmount: number; href: string }) {
  const yesLike = isYesLikeLabel(entryLabel);
  const accent = yesLike ? "#00C853" : "#FF0000";
  return (
    <Link
      href={href}
      className="block w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label={`View your prediction: ${entryLabel}`}
    >
      <div
        className="flex min-h-10 items-center justify-between gap-2 rounded-md border px-3 py-3 md:py-2 text-left w-full transition-colors"
        style={{
          backgroundColor: `${accent}10`,
          borderColor: `${accent}80`,
        }}
        data-testid="pending-bet-link"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 border"
            style={{ backgroundColor: `${accent}1A`, borderColor: `${accent}80` }}
          >
            <Check className="h-2.5 w-2.5" style={{ color: accent }} />
          </div>
          <div className="min-w-0 flex flex-row flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide leading-none text-foreground">Your pick</span>
            <span className="text-xs font-semibold leading-none" style={{ color: accent }}>
              {entryLabel.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-baseline gap-1 tabular-nums">
            <span className="text-[10px] text-muted-foreground">Stake</span>
            <span className="text-xs font-semibold text-foreground">{stakeAmount.toLocaleString("en-US")}</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
        </div>
      </div>
    </Link>
  );
}

function BinaryMarketCard({ market, entries, totalPool, participants, timeLabel, onNavigate, isMarketClosed, isInactive = false, inactiveMessage, userBetResult, onFilterCategory, categoryRaceMap, leaderboardCategories }: { market: any; entries: any[]; totalPool: number; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string, direction?: string) => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string> }) {
  const yesEntry = entries.find((e: any) => e.label === "Yes") || entries[0];
  const noEntry = entries.find((e: any) => e.label === "No") || entries[1];
  const yesStake = Number(yesEntry?.totalStake || 0);
  const noStake = Number(noEntry?.totalStake || 0);
  const total = yesStake + noStake || 1;
  const yesPercent = Math.round((yesStake / total) * 100);
  const noPercent = 100 - yesPercent;
  // Multipliers use raw stakes (not the rounded percent) so thin pools
  // like 1 vs 999 don't collapse to a misleading 1.9x default.
  // 0.95 haircut matches MarketDetailPage so card and detail agree.
  const yesMultiplier = +(computePayoutMultiplier(total, yesStake) * 0.95).toFixed(1);
  const noMultiplier = +(computePayoutMultiplier(total, noStake) * 0.95).toFixed(1);

  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {timeLabel}
        </Badge>
        {market.category && <InteractiveCategoryPill category={market.category} onFilter={() => onFilterCategory?.(market.category)} leaderboardCategories={leaderboardCategories} detailHref={`/markets/${market.slug}`} detailLabel="View Market Details" />}
      </div>

      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <AvatarHeightHeadline
          className="mb-2"
          text={market.title || ""}
          serif={false}
          avatar={<MarketAvatarOrSpacer market={market} />}
          titleClassName={`!font-semibold ${isInactive ? "" : "hover:!text-violet-600 dark:hover:!text-violet-400"}`}
        />
      </a>
      {market.teaser && (
        <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
          <p className={`text-sm text-muted-foreground mb-3 line-clamp-3 leading-[1.4] ${!isInactive ? 'hover:text-violet-600 dark:hover:text-violet-400' : ''} transition-colors`}>{market.teaser}</p>
        </a>
      )}

      <div className="flex flex-col max-md:mt-auto md:contents">
        <div className="pt-1 md:mt-auto md:pt-1">
          <div className="mb-2 md:mb-3">
            <ParticipantAvatarStack participants={market.recentParticipants} totalCount={participants} />
          </div>

          <div className="mb-2 md:mb-3">
            <div className="h-3 rounded-full bg-red-500/25 dark:bg-red-500/20 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all" style={{ width: `${yesPercent}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs mt-1.5">
              <span className="text-green-500 font-semibold">Yes {yesPercent}%</span>
              <span className="text-red-500 font-semibold">No {noPercent}%</span>
            </div>
          </div>
        </div>

        <div className="max-md:mt-1">
          <div className="flex items-center justify-center mb-1.5">
            <span className="text-sm font-semibold text-muted-foreground">Pool: {totalPool.toLocaleString('en-US')}</span>
          </div>

          {isMarketClosed ? (
            <Button className="w-full bg-muted text-muted-foreground cursor-not-allowed" disabled>
              <Lock className="h-4 w-4 mr-2" />
              Closed
            </Button>
          ) : userBetResult?.result === "pending" ? (
            <PendingBetLinkRow entryLabel={userBetResult.entryLabel} stakeAmount={userBetResult.stakeAmount} href={`/markets/${market.slug}`} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="!min-h-0 px-4 py-3.5 md:py-2.5 bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
                onClick={() => onNavigate(market.slug, 'yes')}
                data-testid={`button-yes-${market.slug}`}
              >
                Yes {formatMultiplier(yesMultiplier)}
              </Button>
              <Button
                className="!min-h-0 px-4 py-3.5 md:py-2.5 bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
                onClick={() => onNavigate(market.slug, 'no')}
                data-testid={`button-no-${market.slug}`}
              >
                No {formatMultiplier(noMultiplier)}
              </Button>
            </div>
          )}
          <UserBetResult betResult={userBetResult} isMarketClosed={isMarketClosed} />
        </div>
      </div>
    </PredictCard>
  );
}

/** Single row in a multi-option market — used by both the card preview
 *  and the "all options" drawer so they always render identically. */
function MultiMarketEntryRow({
  entry,
  market,
  userBet,
  hasPendingBet,
  isMarketClosed,
  showEntryPool = false,
  compact = false,
  onNavigate,
  onPickEntry,
  onBeforeNavigate,
}: {
  entry: any;
  market: any;
  userBet?: { direction: string; stakeAmount: number };
  hasPendingBet: boolean;
  isMarketClosed: boolean;
  /** Show raw entry pool credits below the row (drawer only). */
  showEntryPool?: boolean;
  /** Polymarket-style compact mode for the card preview: drop the per-side
   *  multipliers from the Yes/No buttons (just "Yes" / "No"). The drawer +
   *  URL detail page show "Yes 1.0x" / "No 1.9x" so users have the full
   *  picture once they're committed enough to scroll a list of options. */
  compact?: boolean;
  onNavigate: (slug: string, pick?: string, direction?: string) => void;
  /** Preferred handler. When provided, Yes/No clicks open an in-page stake
   *  modal instead of routing to the URL detail page. The card keeps the
   *  legacy onNavigate fallback for any consumer that hasn't wired this yet. */
  onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void;
  /** Called before onPickEntry/onNavigate so the drawer can close cleanly first. */
  onBeforeNavigate?: () => void;
}) {
  const betAccent = userBet?.direction === "no" ? "#FF0000" : "#00C853";
  const entryPool =
    Number(entry.totalStake || 0) + Number(entry.noStake || 0);

  const handlePick = (e: React.MouseEvent, direction: "yes" | "no") => {
    e.stopPropagation();
    const fire = () => {
      if (onPickEntry) {
        onPickEntry(market, entry, direction);
      } else {
        onNavigate(market.slug, entry.id, direction);
      }
    };
    if (onBeforeNavigate) {
      onBeforeNavigate();
      // Match opinion-poll drawer pattern: let the drawer animate out
      // before the stake modal opens so they don't fight for focus.
      setTimeout(fire, 320);
    } else {
      fire();
    }
  };

  // Polymarket-style: per-entry avatar placeholders dropped entirely. The
  // initial-circle was shrinking on mobile to the point names truncated to
  // a single letter (e.g. "S." for Shai Gilgeous-Alexander), which read worse
  // than just the name. The card hero image already sets the visual context.

  // Fixed-width Yes/No buttons keep the right-hand column aligned across all
  // rows. Without this, an outlier multiplier like "9.5x" pushes its row's
  // No button further right than its neighbours, breaking the grid feel.
  // 64px / 56px fits "Yes 9.9x" (worst case 4 chars + label) without wrap.
  const buttonClass =
    "shrink-0 text-center w-[60px] md:w-[64px] px-1 md:px-1.5 py-1.5 md:py-2 text-[11px] md:text-xs font-semibold rounded-md transition-colors tabular-nums";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="truncate text-[13px] md:text-[14px] font-medium">{entry.label}</div>
        {showEntryPool && (
          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            {entryPool.toLocaleString("en-US")} credits in pool
          </div>
        )}
      </div>
      <span className="text-[12px] md:text-[14px] font-mono font-semibold text-muted-foreground tabular-nums shrink-0 w-9 text-right">{entry.pct}%</span>
      {hasPendingBet && userBet ? (
        <Link
          href={`/markets/${market.slug}`}
          className="flex items-center gap-1.5 shrink-0 rounded-md border px-2 py-1.5 transition-colors"
          style={{ backgroundColor: `${betAccent}10`, borderColor: `${betAccent}80` }}
          data-testid={`pending-entry-${entry.id}`}
        >
          <Check className="h-3 w-3" style={{ color: betAccent }} />
          <span className="text-[10px] font-semibold" style={{ color: betAccent }}>Your pick</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">{userBet.stakeAmount.toLocaleString("en-US")}</span>
        </Link>
      ) : !isMarketClosed ? (
        <div className="flex gap-1 md:gap-1.5 shrink-0">
          <button
            className={`${buttonClass} bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20`}
            onClick={(e) => handlePick(e, "yes")}
            data-testid={`button-yes-${entry.id}`}
          >
            {compact ? "Yes" : `Yes ${formatMultiplier(entry.yesMultiplier)}`}
          </button>
          <button
            className={`${buttonClass} bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20`}
            onClick={(e) => handlePick(e, "no")}
            data-testid={`button-no-${entry.id}`}
          >
            {compact ? "No" : `No ${formatMultiplier(entry.noMultiplier)}`}
          </button>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground shrink-0 w-24 text-right">{entry.yesPct}% Yes / {entry.noPct}% No</span>
      )}
    </div>
  );
}

const MULTI_MARKET_PREVIEW_COUNT = 4;

function MultiMarketCard({ market, entries, participants, timeLabel, onNavigate, onPickEntry, isMarketClosed, isInactive = false, inactiveMessage, userBetResult, userBetsPerEntry, onFilterCategory, categoryRaceMap, leaderboardCategories }: { market: any; entries: any[]; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string, direction?: string) => void; onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; userBetsPerEntry?: Map<string, { direction: string; stakeAmount: number }>; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string> }) {
  const [, setLocation] = useLocation();
  const [optionsDrawerOpen, setOptionsDrawerOpen] = useState(false);

  const totalEntryStake = entries.reduce((sum: number, e: any) => sum + Number(e.totalStake || 0) + Number(e.noStake || 0), 0) || 1;
  const hasPendingResult = userBetResult?.result === "pending";

  // Per-entry parimutuel multipliers (matches binary card + detail page).
  // 0.95 haircut keeps the card and the detail page in agreement.
  // computePayoutMultiplier already falls back to DEFAULT_PAYOUT_MULTIPLIER
  // when pool or stake is 0, so no extra null-guarding is needed — empty
  // entries show "Yes 1.9x" / "No 1.9x" exactly like the binary card.
  const enriched = entries.map((e: any) => {
    const yesStake = Number(e.totalStake || 0);
    const noStake = Number(e.noStake || 0);
    const entryPool = yesStake + noStake;
    return {
      ...e,
      pct: Math.round((entryPool / totalEntryStake) * 100),
      yesPct: entryPool > 0 ? Math.round((yesStake / entryPool) * 100) : 50,
      noPct: entryPool > 0 ? 100 - Math.round((yesStake / entryPool) * 100) : 50,
      yesMultiplier: +(computePayoutMultiplier(entryPool, yesStake) * 0.95).toFixed(1),
      noMultiplier: +(computePayoutMultiplier(entryPool, noStake) * 0.95).toFixed(1),
    };
  });

  // Sort: entries the user has an active pending bet on get pinned to the
  // top (sub-sorted by pct desc), then the rest by pct desc. This mirrors the
  // opinion-poll drawer pattern so a user's pick is always immediately
  // visible without scrolling, but adapts to the prediction-market reality
  // that a single user may have several pending bets across entries.
  const rankedEntries = [...enriched].sort((a: any, b: any) => {
    const aPinned = hasPendingResult && userBetsPerEntry?.has(String(a.id)) ? 1 : 0;
    const bPinned = hasPendingResult && userBetsPerEntry?.has(String(b.id)) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return b.pct - a.pct;
  });

  const visibleEntries = rankedEntries.slice(0, MULTI_MARKET_PREVIEW_COUNT);
  const remainingCount = Math.max(0, rankedEntries.length - MULTI_MARKET_PREVIEW_COUNT);

  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {timeLabel}
        </Badge>
        {market.category && <InteractiveCategoryPill category={market.category} onFilter={() => onFilterCategory?.(market.category)} leaderboardCategories={leaderboardCategories} detailHref={`/markets/${market.slug}`} detailLabel="View Market Details" />}
      </div>

      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <AvatarHeightHeadline
          className="mb-2"
          text={market.title || ""}
          serif={false}
          avatar={<MarketAvatarOrSpacer market={market} />}
          titleClassName={`!font-semibold ${isInactive ? "" : "hover:!text-violet-600 dark:hover:!text-violet-400"}`}
        />
      </a>
      {market.teaser && (
        <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
          <p className={`text-sm text-muted-foreground mb-3 line-clamp-2 leading-[1.4] ${!isInactive ? 'hover:text-violet-600 dark:hover:text-violet-400' : ''} transition-colors`}>{market.teaser}</p>
        </a>
      )}

      <div className="mb-3 flex items-center gap-2">
        <ParticipantAvatarStack participants={market.recentParticipants} totalCount={participants} />
        {/* Polymarket-style total pool readout — gives users a quick sense of
            how much liquidity the market has accumulated. We sum across all
            entries (live stake only, excluding seed) so it tracks real money.
            Hidden when the pool is empty to avoid a noisy "0 in pool" line. */}
        {totalEntryStake > 1 && (
          <span className="text-[11px] text-muted-foreground tabular-nums" data-testid={`pool-volume-${market.slug}`}>
            {totalEntryStake.toLocaleString("en-US")} in pool
          </span>
        )}
        <Badge variant="outline" className="text-[10px] ml-auto">{entries.length} options</Badge>
      </div>

      <div className="space-y-1.5">
        {visibleEntries.map((entry: any) => {
          const entryBet = userBetsPerEntry?.get(String(entry.id));
          return (
            <MultiMarketEntryRow
              key={entry.id}
              entry={entry}
              market={market}
              userBet={entryBet}
              hasPendingBet={!!entryBet && hasPendingResult}
              isMarketClosed={isMarketClosed}
              compact
              onNavigate={onNavigate}
              onPickEntry={onPickEntry}
            />
          );
        })}
        {remainingCount > 0 && (
          <button
            type="button"
            onClick={() => setOptionsDrawerOpen(true)}
            className="w-full"
            data-testid={`link-more-options-${market.slug}`}
          >
            <p className="text-xs text-violet-600 dark:text-violet-400 text-center cursor-pointer hover:underline mt-2.5">
              +{remainingCount} more options
            </p>
          </button>
        )}
      </div>

      <UserBetResult betResult={userBetResult} isMarketClosed={isMarketClosed} />

      <Drawer.Root open={optionsDrawerOpen} onOpenChange={setOptionsDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
          <Drawer.Content
            className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[85dvh]"
            data-interactive="true"
            data-testid={`multi-market-options-drawer-${market.slug}`}
          >
            <div className="mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60" />
            <div className="flex items-center justify-between px-4 pb-2">
              <div className="min-w-0">
                <Drawer.Title className="text-sm font-semibold text-foreground truncate">All options</Drawer.Title>
                <Drawer.Description className="sr-only">All options for {market.title}</Drawer.Description>
                <p className="text-[11px] text-muted-foreground truncate">{market.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setOptionsDrawerOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-2 min-h-0 space-y-1.5">
              {rankedEntries.map((entry: any) => {
                const entryBet = userBetsPerEntry?.get(String(entry.id));
                return (
                  <MultiMarketEntryRow
                    key={entry.id}
                    entry={entry}
                    market={market}
                    userBet={entryBet}
                    hasPendingBet={!!entryBet && hasPendingResult}
                    isMarketClosed={isMarketClosed}
                    showEntryPool
                    onNavigate={onNavigate}
                    onPickEntry={onPickEntry}
                    onBeforeNavigate={() => setOptionsDrawerOpen(false)}
                  />
                );
              })}
            </div>
            <div className="border-t border-border/40 px-4 py-3">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setOptionsDrawerOpen(false);
                  setTimeout(() => setLocation(`/markets/${market.slug}`), 320);
                }}
                data-testid={`button-drawer-details-${market.slug}`}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View market details
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </PredictCard>
  );
}

function UpDownMarketCard({ market, entries, totalPool, participants, timeLabel, onNavigate, isMarketClosed, isInactive = false, inactiveMessage, userBetResult, onFilterCategory, categoryRaceMap, leaderboardCategories }: { market: any; entries: any[]; totalPool: number; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string, direction?: string) => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string> }) {
  const aboveEntry = entries.find((e: any) => e.label === "Above") || entries[0];
  const belowEntry = entries.find((e: any) => e.label === "Below") || entries[1];
  const aboveStake = Number(aboveEntry?.totalStake || 0);
  const belowStake = Number(belowEntry?.totalStake || 0);
  const total = aboveStake + belowStake || 1;
  const abovePercent = Math.round((aboveStake / total) * 100);
  const belowPercent = 100 - abovePercent;

  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          {timeLabel}
        </Badge>
        {market.category && <InteractiveCategoryPill category={market.category} onFilter={() => onFilterCategory?.(market.category)} leaderboardCategories={leaderboardCategories} detailHref={`/markets/${market.slug}`} detailLabel="View Market Details" />}
      </div>

      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <AvatarHeightHeadline
          className="mb-2"
          text={market.title || ""}
          serif={false}
          avatar={<MarketAvatarOrSpacer market={market} />}
          titleClassName={`!font-semibold ${isInactive ? "" : "hover:!text-violet-600 dark:hover:!text-violet-400"}`}
        />
      </a>
      {market.teaser && (
        <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) onNavigate(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
          <p className={`text-sm text-muted-foreground mb-3 line-clamp-3 leading-[1.4] ${!isInactive ? 'hover:text-violet-600 dark:hover:text-violet-400' : ''} transition-colors`}>{market.teaser}</p>
        </a>
      )}

      <div className="mt-auto pt-1">
        <div className="mb-2">
          <ParticipantAvatarStack participants={market.recentParticipants} totalCount={participants} />
        </div>

        <div className="mb-2">
          <div className="h-3 rounded-full bg-red-500/25 dark:bg-red-500/20 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all" style={{ width: `${abovePercent}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs mt-1.5">
            <span className="text-green-500 font-semibold">Above {abovePercent}%</span>
            <span className="text-red-500 font-semibold">Below {belowPercent}%</span>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-center mb-1.5">
          <span className="text-sm font-semibold text-muted-foreground">Pool: {totalPool.toLocaleString('en-US')}</span>
        </div>

        {isMarketClosed ? (
          <Button className="w-full bg-muted text-muted-foreground cursor-not-allowed" disabled>
            <Lock className="h-4 w-4 mr-2" />
            Closed
          </Button>
        ) : userBetResult?.result === "pending" ? (
          <PendingBetLinkRow entryLabel={userBetResult.entryLabel} stakeAmount={userBetResult.stakeAmount} href={`/markets/${market.slug}`} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="!min-h-0 px-4 py-3.5 md:py-2.5 bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
              onClick={() => onNavigate(market.slug, 'above')}
              data-testid={`button-above-${market.slug}`}
            >
              Above {abovePercent}%
            </Button>
            <Button
              className="!min-h-0 px-4 py-3.5 md:py-2.5 bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
              onClick={() => onNavigate(market.slug, 'below')}
              data-testid={`button-below-${market.slug}`}
            >
              Below {belowPercent}%
            </Button>
          </div>
        )}
        <UserBetResult betResult={userBetResult} isMarketClosed={isMarketClosed} />
      </div>
    </PredictCard>
  );
}

export function OpenMarketCard({ market, onNavigate, onPickEntry, isMarketClosed = false, userBetResult, userBetsPerEntry, onFilterCategory, categoryRaceMap, leaderboardCategories }: { market: any; onNavigate: (slug: string, pick?: string, direction?: string) => void; /** When provided, multi-option Yes/No clicks open an in-page stake modal instead of navigating to /markets/:slug. Falls through to onNavigate for binary/up-down cards. */ onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void; isMarketClosed?: boolean; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; userBetsPerEntry?: Map<string, { direction: string; stakeAmount: number }>; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string> }) {
  const entries = market.entries || [];
  const isCommunity = market.marketType === "community";
  const totalStake = entries.reduce((sum: number, e: any) => sum + Number(e.totalStake || 0) + Number(e.noStake || 0), 0);
  const totalPool = isCommunity ? totalStake : totalStake + Number(market.seedVolume || 0);
  const participants = market.activeParticipantCount || market.betCount || 0;
  const isInactive = market.visibility === "inactive";

  const endDate = market.endAt ? new Date(market.endAt) : null;
  const now = new Date();
  const daysLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;
  const timeLabel = daysLeft > 1 ? `${daysLeft}d left` : daysLeft === 1 ? "1d left" : "Closing soon";

  if (market.openMarketType === "updown") {
    return <UpDownMarketCard market={market} entries={entries} totalPool={totalPool} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} userBetResult={userBetResult} onFilterCategory={onFilterCategory} categoryRaceMap={categoryRaceMap} leaderboardCategories={leaderboardCategories} />;
  }
  if (market.openMarketType === "multi") {
    return <MultiMarketCard market={market} entries={entries} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} onPickEntry={onPickEntry} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} userBetResult={userBetResult} userBetsPerEntry={userBetsPerEntry} onFilterCategory={onFilterCategory} categoryRaceMap={categoryRaceMap} leaderboardCategories={leaderboardCategories} />;
  }
  return <BinaryMarketCard market={market} entries={entries} totalPool={totalPool} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} userBetResult={userBetResult} onFilterCategory={onFilterCategory} categoryRaceMap={categoryRaceMap} leaderboardCategories={leaderboardCategories} />;
}
