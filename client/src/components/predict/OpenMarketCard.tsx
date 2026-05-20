import { useState } from "react";
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
import { resolveMarketHeadlineImageUrl } from "@/lib/predictMarketImage";
import { pricesFor, snapshotFromApi, type ApiAmmStateBlock } from "@/lib/ammClient";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";
import { formatVolumeCredits } from "@/lib/formatNumber";

/**
 * Sprint 5 / Phase 0: build the predict-page return anchor key for a
 * given community market. Matches the prefix `PredictPage` parses in
 * its back-button restore effect (`card-community-{marketId}`). Native
 * cards (WeeklyUpDownCard, HeadToHeadCard, TopGainerCard) already do
 * this in-line; community cards historically didn't, so back-navigation
 * from /markets/:slug landed at the top of /predict.
 */
function rememberCommunityCardAnchor(marketId: string | number | undefined | null) {
  if (marketId == null) return;
  setPredictReturnAnchor(`card-community-${marketId}`);
}

function MarketAvatar({ market }: { market: any }) {
  const imgUrl = resolveMarketHeadlineImageUrl(market);
  if (!imgUrl) return null;
  return (
    <Avatar className="h-20 w-20 shrink-0 rounded-md md:h-16 md:w-16">
      <AvatarImage src={imgUrl} alt={market.title} className="object-cover" />
      <AvatarFallback className="text-sm rounded-md">{(market.title || "?")[0]}</AvatarFallback>
    </Avatar>
  );
}

function MarketAvatarOrSpacer({ market }: { market: any }) {
  const imgUrl = resolveMarketHeadlineImageUrl(market);
  if (!imgUrl) {
    return <div className="h-20 w-20 shrink-0 rounded-md md:h-16 md:w-16 bg-muted/25" aria-hidden />;
  }
  return <MarketAvatar market={market} />;
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
  // Parimutuel sunset: resolved community markets are AMM, so the
  // payout on `marketBets` already encodes the final credits and the
  // "Total pool / Winner pool" breakdown no longer applies. We just
  // surface the badge and the user's pick.
  return (
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
  );
}

function isYesLikeLabel(label: string) {
  const l = (label || "").toLowerCase();
  return l === "yes" || l === "above";
}

function PendingBetLinkRow({ entryLabel, stakeAmount, href, onTopUp, onLinkClick, unrealisedPnl }: { entryLabel: string; stakeAmount: number; href: string; /** When provided, the row becomes a button that triggers an in-place top-up modal instead of navigating to the detail page. Mirrors the native pattern (WeeklyUpDownYourPositionPanel). */ onTopUp?: () => void; /** Fired right before wouter navigates so the parent can stash a predict-return anchor. */ onLinkClick?: () => void; /** AMM unrealised P&L (`buy.netShares × livePrice − costBasis`). Shown next to Stake. */ unrealisedPnl?: number | null }) {
  const yesLike = isYesLikeLabel(entryLabel);
  const accent = yesLike ? "#00C853" : "#FF0000";

  // P&L delta with the same sub-cent zero clamp we apply on Up/Down +
  // H2H + Race cards. Hidden when `unrealisedPnl` is unavailable.
  const hasPnl = typeof unrealisedPnl === "number" && Number.isFinite(unrealisedPnl);
  const pnlValue = hasPnl ? (unrealisedPnl as number) : 0;
  const pnlIsZero = Math.abs(pnlValue) < 0.005;
  const pnlClass = pnlIsZero
    ? "text-muted-foreground"
    : pnlValue >= 0
      ? "text-green-700 dark:text-green-500"
      : "text-red-700 dark:text-red-500";
  const pnlText = !hasPnl
    ? null
    : pnlIsZero
      ? "0.00 cr"
      : `${pnlValue >= 0 ? "+" : ""}${pnlValue.toFixed(2)} cr`;

  const inner = (
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
        {pnlText && (
          <span className={`text-xs font-semibold font-mono tabular-nums ${pnlClass}`} data-testid="pending-bet-pnl">
            {pnlText}
          </span>
        )}
        <div className="flex items-baseline gap-1 tabular-nums">
          <span className="text-[10px] text-muted-foreground">Stake</span>
          <span className="text-xs font-semibold text-foreground">{stakeAmount.toLocaleString("en-US")}</span>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
      </div>
    </div>
  );

  if (onTopUp) {
    return (
      <button
        type="button"
        onClick={onTopUp}
        className="block w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:brightness-110 transition-[filter]"
        aria-label={`Top up your ${entryLabel} pick`}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={href}
      onClick={onLinkClick}
      className="block w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label={`View your prediction: ${entryLabel}`}
    >
      {inner}
    </Link>
  );
}

function BinaryMarketCard({ market, entries, participants, timeLabel, onNavigate, onPickEntry, isMarketClosed, isInactive = false, inactiveMessage, userBetResult, userBetsPerEntry, onFilterCategory, categoryRaceMap, leaderboardCategories, onBrowseFullScreen, unrealisedPnl }: { market: any; entries: any[]; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string, direction?: string) => void; /** When provided, tapping the "Your pick" pin opens the StakeModal in topUp mode instead of routing to the detail page. */ onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; userBetsPerEntry?: Map<string, { yesStake: number; noStake: number }>; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string>; onBrowseFullScreen?: () => void; /** AMM unrealised P&L for the user's top position on this market. */ unrealisedPnl?: number | null }) {
  const rememberAnchor = () => rememberCommunityCardAnchor(market?.id);
  const navigateWithAnchor = (slug: string, pick?: string, direction?: string) => {
    rememberAnchor();
    onNavigate(slug, pick, direction);
  };
  // Parimutuel sunset: every community market is AMM. Volume chip
  // mirrors H2H / Race using `market.volume` (projected by the
  // /api/open-markets feed from `ammState.totalUserCreditsIn`).
  const volumeRaw = Number((market as any)?.volume ?? 0);
  const volumeLabel = volumeRaw > 0 ? formatVolumeCredits(volumeRaw) : null;
  const ammSnap = snapshotFromApi((market.ammState as ApiAmmStateBlock | null | undefined) ?? null);
  const ammPrices = ammSnap ? pricesFor(ammSnap) : null;
  const yesEntry = entries.find((e: any) => e.label === "Yes") || entries[0];
  const noEntry = entries.find((e: any) => e.label === "No") || entries[1];
  // AMM markets price each share class via LMSR. We map prices to %
  // for the bar and the button label.
  const ammYesPrice = ammPrices && yesEntry?.id ? Number(ammPrices[yesEntry.id] ?? 0) : 0;
  const ammNoPrice = ammPrices && noEntry?.id ? Number(ammPrices[noEntry.id] ?? 0) : 0;
  const yesPercent = Math.max(0, Math.min(100, Math.round(ammYesPrice * 100)));
  const noPercent = Math.max(0, Math.min(100, Math.round(ammNoPrice * 100)));

  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {timeLabel}
          </Badge>
          {volumeLabel && (
            <Badge
              variant="outline"
              className="text-[10px] tabular-nums text-muted-foreground border-border/50"
              data-testid={`community-card-volume-${market.slug}`}
            >
              {volumeLabel} vol
            </Badge>
          )}
        </div>
        {market.category && <InteractiveCategoryPill category={market.category} onFilter={() => onFilterCategory?.(market.category)} leaderboardCategories={leaderboardCategories} detailHref={`/markets/${market.slug}`} detailLabel="View Market Details" onBrowseFullScreen={onBrowseFullScreen} />}
      </div>

      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) navigateWithAnchor(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <AvatarHeightHeadline
          className="mb-2"
          text={market.title || ""}
          serif={false}
          avatar={<MarketAvatarOrSpacer market={market} />}
          titleClassName={`!font-semibold ${isInactive ? "" : "hover:!text-violet-600 dark:hover:!text-violet-400"}`}
        />
      </a>
      {market.teaser && (
        <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) navigateWithAnchor(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
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
          {isMarketClosed ? (
            <Button className="w-full bg-muted text-muted-foreground cursor-not-allowed" disabled>
              <Lock className="h-4 w-4 mr-2" />
              Closed
            </Button>
          ) : userBetResult?.result === "pending" ? (
            (() => {
              // Wire the pin to top-up parity with native cards: when we
              // can identify the picked entry from userBetsPerEntry and
              // onPickEntry is provided, the pin opens the StakeModal in
              // topUp mode for the user's existing direction. Otherwise
              // we fall through to the legacy detail-page link.
              let pickedEntry: any = null;
              let pickedDirection: "yes" | "no" = "yes";
              if (userBetsPerEntry && onPickEntry) {
                for (const [eId, stakes] of userBetsPerEntry) {
                  const dir = stakes.noStake > stakes.yesStake ? "no" : (stakes.yesStake > 0 ? "yes" : (stakes.noStake > 0 ? "no" : null));
                  if (dir) {
                    const found = entries.find((e: any) => String(e.id) === eId);
                    if (found) {
                      pickedEntry = found;
                      pickedDirection = dir;
                      break;
                    }
                  }
                }
              }
              return (
                <PendingBetLinkRow
                  entryLabel={userBetResult.entryLabel}
                  stakeAmount={userBetResult.stakeAmount}
                  href={`/markets/${market.slug}`}
                  onLinkClick={rememberAnchor}
                  onTopUp={pickedEntry && onPickEntry ? () => onPickEntry(market, pickedEntry, pickedDirection) : undefined}
                  unrealisedPnl={unrealisedPnl ?? null}
                />
              );
            })()
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="!min-h-0 h-auto px-4 py-3 md:py-2.5 bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20 flex flex-col items-center justify-center gap-0.5"
                onClick={() => {
                  if (onPickEntry && yesEntry) {
                    onPickEntry(market, yesEntry, "yes");
                  } else {
                    navigateWithAnchor(market.slug, "yes");
                  }
                }}
                data-testid={`button-yes-${market.slug}`}
              >
                <span className="leading-none">Yes {yesPercent}%</span>
                <span className="text-[10px] font-mono opacity-80 leading-none">
                  {ammYesPrice.toFixed(2)} cr/share
                </span>
              </Button>
              <Button
                className="!min-h-0 h-auto px-4 py-3 md:py-2.5 bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 flex flex-col items-center justify-center gap-0.5"
                onClick={() => {
                  if (onPickEntry && noEntry) {
                    onPickEntry(market, noEntry, "yes");
                  } else {
                    navigateWithAnchor(market.slug, "no");
                  }
                }}
                data-testid={`button-no-${market.slug}`}
              >
                <span className="leading-none">No {noPercent}%</span>
                <span className="text-[10px] font-mono opacity-80 leading-none">
                  {ammNoPrice.toFixed(2)} cr/share
                </span>
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
  onNavigate,
  onPickEntry,
  onBeforeNavigate,
}: {
  entry: any;
  market: any;
  /**
   * Per-entry user position split by direction. Under the no-hedging
   * rule only one side is ever populated for new bets; legacy hedge
   * holders may still have both — we pick the dominant side for the
   * pin so it shows something sensible.
   */
  userBet?: { yesStake: number; noStake: number };
  hasPendingBet: boolean;
  isMarketClosed: boolean;
  /** Show raw entry pool credits below the row (drawer only). */
  showEntryPool?: boolean;
  onNavigate: (slug: string, pick?: string, direction?: string) => void;
  /** Preferred handler. When provided, Yes/No clicks open an in-page stake
   *  modal instead of routing to the URL detail page. The card keeps the
   *  legacy onNavigate fallback for any consumer that hasn't wired this yet. */
  onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void;
  /** Called before onPickEntry/onNavigate so the drawer can close cleanly first. */
  onBeforeNavigate?: () => void;
}) {
  // Pick the dominant side for the pin. New bets only ever populate one
  // direction; legacy hedge holders see whichever side they have more
  // stake on so the pin is a reasonable shorthand.
  const userDirection: "yes" | "no" | null = userBet
    ? userBet.noStake > userBet.yesStake
      ? "no"
      : userBet.yesStake > 0
        ? "yes"
        : userBet.noStake > 0
          ? "no"
          : null
    : null;
  const userStake =
    userDirection === "yes" ? userBet?.yesStake ?? 0
    : userDirection === "no" ? userBet?.noStake ?? 0
    : 0;
  const betAccent = userDirection === "no" ? "#FF0000" : "#00C853";
  const entryPool =
    Number(entry.totalStake || 0) + Number(entry.noStake || 0);

  const handlePick = (e: React.MouseEvent, direction: "yes" | "no") => {
    e.stopPropagation();
    const fire = () => {
      if (onPickEntry) {
        onPickEntry(market, entry, direction);
      } else {
        rememberCommunityCardAnchor(market?.id);
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

  // Fixed-width Yes button keeps the right-hand column aligned across all
  // rows. Two-line label ("Yes pct%" on top, "X.XX cr/share" below) and
  // colour (#00C853 brand green) match the binary + Up/Down card Yes
  // buttons exactly so the three card variants are visually consistent.
  // Width is sized to fit the worst-case mono "1.00 cr/share" string +
  // padding on both desktop and mobile.
  const buttonClass =
    "shrink-0 text-center w-[92px] md:w-[104px] px-1 md:px-1.5 py-1.5 md:py-2 rounded-md transition-colors tabular-nums flex flex-col items-center justify-center gap-0.5";

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
      {hasPendingBet && userBet && userDirection ? (
        // Pin doubles as the top-up trigger. When onPickEntry is wired
        // (PredictPage / PredictTab) we open the StakeModal directly with
        // the user's existing direction so the modal lands in topUp mode
        // — matches the native pattern (e.g. WeeklyUpDownYourPositionPanel).
        // Falls back to the detail-page link when no callback is wired
        // (e.g. SSR or list views that haven't been migrated yet).
        // The leading pct span keeps current market price visible even
        // when the row's button is replaced by the pin — multi cards
        // don't have a per-row progress bar like binary cards do, and the
        // market-level P&L banner only shows the user's TOP position, so
        // without this span users with multiple open picks lose all per-
        // outcome price visibility.
        <>
          <span className="text-[11px] md:text-[12px] font-mono font-semibold text-muted-foreground tabular-nums shrink-0">
            {entry.pct}%
          </span>
          {onPickEntry && !isMarketClosed ? (
            <button
              type="button"
              onClick={(e) => handlePick(e, userDirection)}
              className="flex items-center gap-1.5 shrink-0 rounded-md border px-2 py-1.5 transition-colors hover:brightness-110"
              style={{ backgroundColor: `${betAccent}10`, borderColor: `${betAccent}80` }}
              data-testid={`pending-entry-${entry.id}`}
              aria-label={`Top up your ${userDirection.toUpperCase()} pick`}
            >
              <Check className="h-3 w-3" style={{ color: betAccent }} />
              <span className="text-[10px] font-semibold" style={{ color: betAccent }}>Your pick</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{userStake.toLocaleString("en-US")}</span>
            </button>
          ) : (
            <Link
              href={`/markets/${market.slug}`}
              onClick={() => rememberCommunityCardAnchor(market?.id)}
              className="flex items-center gap-1.5 shrink-0 rounded-md border px-2 py-1.5 transition-colors"
              style={{ backgroundColor: `${betAccent}10`, borderColor: `${betAccent}80` }}
              data-testid={`pending-entry-${entry.id}`}
            >
              <Check className="h-3 w-3" style={{ color: betAccent }} />
              <span className="text-[10px] font-semibold" style={{ color: betAccent }}>Your pick</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{userStake.toLocaleString("en-US")}</span>
            </Link>
          )}
        </>
      ) : !isMarketClosed ? (
        // Parimutuel sunset: every community market is AMM. Each
        // outcome is its own share class, so the row gets a single
        // YES-only Buy button (Buy NO on multi is deferred pending an
        // engine extension — LMSR has no native NO shares). Wording +
        // colour intentionally mirror the binary Yes button so the
        // three card variants read consistently: "Yes {pct}%" on top,
        // "{X.XX} cr/share" below, identical in both the card preview
        // and the drawer view so users see the same information
        // regardless of surface.
        <div className="flex shrink-0">
          <button
            className={`${buttonClass} bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20`}
            onClick={(e) => handlePick(e, "yes")}
            data-testid={`button-buy-${entry.id}`}
          >
            <span className="text-[11px] md:text-xs font-semibold leading-none">Yes {entry.pct}%</span>
            <span className="text-[9px] md:text-[10px] font-mono opacity-80 leading-none">
              {Number(entry.ammPrice ?? 0).toFixed(2)} cr/share
            </span>
          </button>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground shrink-0 w-24 text-right">{entry.pct}%</span>
      )}
    </div>
  );
}

const MULTI_MARKET_PREVIEW_COUNT = 4;

function MultiMarketCard({ market, entries, participants, timeLabel, onNavigate, onPickEntry, isMarketClosed, isInactive = false, inactiveMessage, userBetResult, userBetsPerEntry, onFilterCategory, categoryRaceMap, leaderboardCategories, onBrowseFullScreen, unrealisedPnl }: { market: any; entries: any[]; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string, direction?: string) => void; onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; userBetsPerEntry?: Map<string, { yesStake: number; noStake: number }>; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string>; onBrowseFullScreen?: () => void; /** AMM unrealised P&L for the user's top position on this market. */ unrealisedPnl?: number | null }) {
  const [, setLocation] = useLocation();
  const [optionsDrawerOpen, setOptionsDrawerOpen] = useState(false);
  const rememberAnchor = () => rememberCommunityCardAnchor(market?.id);
  const navigateWithAnchor = (slug: string, pick?: string, direction?: string) => {
    rememberAnchor();
    onNavigate(slug, pick, direction);
  };

  // Parimutuel sunset: every community market is AMM. Volume chip
  // mirrors H2H / Race using `market.volume`.
  const volumeRaw = Number((market as any)?.volume ?? 0);
  const volumeLabel = volumeRaw > 0 ? formatVolumeCredits(volumeRaw) : null;
  const hasPnl = typeof unrealisedPnl === "number" && Number.isFinite(unrealisedPnl);
  const pnlValue = hasPnl ? (unrealisedPnl as number) : 0;
  const pnlIsZero = Math.abs(pnlValue) < 0.005;
  const pnlClass = pnlIsZero
    ? "text-muted-foreground"
    : pnlValue >= 0
      ? "text-green-700 dark:text-green-500"
      : "text-red-700 dark:text-red-500";
  const pnlText = !hasPnl
    ? null
    : pnlIsZero
      ? "0.00 cr"
      : `${pnlValue >= 0 ? "+" : ""}${pnlValue.toFixed(2)} cr`;
  const ammSnap = snapshotFromApi((market.ammState as ApiAmmStateBlock | null | undefined) ?? null);
  const ammPrices = ammSnap ? pricesFor(ammSnap) : null;

  const hasPendingResult = userBetResult?.result === "pending";

  // AMM markets price each outcome as its own share class. `pct` is
  // the LMSR marginal price so the bars + sort order match the live
  // market.
  const enriched = entries.map((e: any) => {
    const ammPrice = ammPrices ? Number(ammPrices[e.id] ?? 0) : 0;
    return {
      ...e,
      pct: Math.max(0, Math.min(100, Math.round(ammPrice * 100))),
      ammPrice,
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
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {timeLabel}
          </Badge>
          {/* Volume chip mirrors H2H + Race + Up/Down.
              `formatVolumeCredits` already returns "N cr" so we only
              suffix " vol" (avoiding a duplicate "cr cr"). */}
          {volumeLabel && (
            <Badge
              variant="outline"
              className="text-[10px] tabular-nums text-muted-foreground border-border/50"
              data-testid={`community-card-volume-${market.slug}`}
            >
              {volumeLabel} vol
            </Badge>
          )}
        </div>
        {market.category && <InteractiveCategoryPill category={market.category} onFilter={() => onFilterCategory?.(market.category)} leaderboardCategories={leaderboardCategories} detailHref={`/markets/${market.slug}`} detailLabel="View Market Details" onBrowseFullScreen={onBrowseFullScreen} />}
      </div>

      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) navigateWithAnchor(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <AvatarHeightHeadline
          className="mb-2"
          text={market.title || ""}
          serif={false}
          avatar={<MarketAvatarOrSpacer market={market} />}
          titleClassName={`!font-semibold ${isInactive ? "" : "hover:!text-violet-600 dark:hover:!text-violet-400"}`}
        />
      </a>
      {market.teaser && (
        <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) navigateWithAnchor(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
          <p className={`text-sm text-muted-foreground mb-3 line-clamp-2 leading-[1.4] ${!isInactive ? 'hover:text-violet-600 dark:hover:text-violet-400' : ''} transition-colors`}>{market.teaser}</p>
        </a>
      )}

      <div className="mb-3 flex items-center gap-2">
        <ParticipantAvatarStack participants={market.recentParticipants} totalCount={participants} />
        <Badge variant="outline" className="text-[10px] ml-auto">{entries.length} options</Badge>
      </div>

      {/* AMM unrealised P&L banner for community markets where the
          user holds a position. Multi-outcome markets can have
          positions on several entries, but a single market-level P&L
          still has signal value — we show the TOP position P&L
          (PredictPage's `ammPositionByMarket` already picks the
          largest currentValue), which mirrors the Race pattern. */}
      {hasPnl && pnlText && (
        <div
          className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2"
          data-testid={`community-card-pnl-${market.slug}`}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Your position
          </span>
          <span className={`text-xs font-semibold font-mono tabular-nums ${pnlClass}`}>
            {pnlText}
          </span>
        </div>
      )}

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
              onNavigate={navigateWithAnchor}
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
                    onNavigate={navigateWithAnchor}
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

function UpDownMarketCard({ market, entries, participants, timeLabel, onNavigate, onPickEntry, isMarketClosed, isInactive = false, inactiveMessage, userBetResult, onFilterCategory, categoryRaceMap, leaderboardCategories, onBrowseFullScreen, unrealisedPnl }: { market: any; entries: any[]; participants: number; timeLabel: string; onNavigate: (slug: string, pick?: string, direction?: string) => void; /** When provided, Above/Below clicks open the StakeModal in-place via PredictPage's handleCommunityPickEntry. Falls back to onNavigate (full route push to /markets/:slug) when not wired. Mirrors the binary/multi pattern. */ onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void; isMarketClosed: boolean; isInactive?: boolean; inactiveMessage?: string; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string>; onBrowseFullScreen?: () => void; /** AMM unrealised P&L for the user's position on this market. */ unrealisedPnl?: number | null }) {
  const rememberAnchor = () => rememberCommunityCardAnchor(market?.id);
  const navigateWithAnchor = (slug: string, pick?: string, direction?: string) => {
    rememberAnchor();
    onNavigate(slug, pick, direction);
  };
  // Parimutuel sunset: every community market is AMM, including the
  // community-built Above/Below up-down format. Prices come from the
  // AMM snapshot, volume from `market.volume`.
  const aboveEntry = entries.find((e: any) => e.label === "Above") || entries[0];
  const belowEntry = entries.find((e: any) => e.label === "Below") || entries[1];
  const ammSnap = snapshotFromApi((market.ammState as ApiAmmStateBlock | null | undefined) ?? null);
  const ammPrices = ammSnap ? pricesFor(ammSnap) : null;
  const abovePrice = ammPrices && aboveEntry?.id ? Number(ammPrices[aboveEntry.id] ?? 0) : 0;
  const belowPrice = ammPrices && belowEntry?.id ? Number(ammPrices[belowEntry.id] ?? 0) : 0;
  const abovePercent = Math.max(0, Math.min(100, Math.round(abovePrice * 100)));
  const belowPercent = Math.max(0, Math.min(100, Math.round(belowPrice * 100)));
  const volumeRaw = Number((market as any)?.volume ?? 0);
  const volumeLabel = volumeRaw > 0 ? formatVolumeCredits(volumeRaw) : null;
  const hasPnl = typeof unrealisedPnl === "number" && Number.isFinite(unrealisedPnl);
  const pnlValue = hasPnl ? (unrealisedPnl as number) : 0;
  const pnlIsZero = Math.abs(pnlValue) < 0.005;
  const pnlClass = pnlIsZero
    ? "text-muted-foreground"
    : pnlValue >= 0
      ? "text-green-700 dark:text-green-500"
      : "text-red-700 dark:text-red-500";
  const pnlText = !hasPnl
    ? null
    : pnlIsZero
      ? "0.00 cr"
      : `${pnlValue >= 0 ? "+" : ""}${pnlValue.toFixed(2)} cr`;

  return (
    <PredictCard testId={`card-market-${market.slug}`} className={`${isMarketClosed && !isInactive ? 'opacity-75' : ''}`} inactive={isInactive} inactiveMessage={inactiveMessage}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {timeLabel}
          </Badge>
          {volumeLabel && (
            <Badge
              variant="outline"
              className="text-[10px] tabular-nums text-muted-foreground border-border/50"
              data-testid={`community-card-volume-${market.slug}`}
            >
              {volumeLabel} vol
            </Badge>
          )}
        </div>
        {market.category && <InteractiveCategoryPill category={market.category} onFilter={() => onFilterCategory?.(market.category)} leaderboardCategories={leaderboardCategories} detailHref={`/markets/${market.slug}`} detailLabel="View Market Details" onBrowseFullScreen={onBrowseFullScreen} />}
      </div>

      <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) navigateWithAnchor(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
        <AvatarHeightHeadline
          className="mb-2"
          text={market.title || ""}
          serif={false}
          avatar={<MarketAvatarOrSpacer market={market} />}
          titleClassName={`!font-semibold ${isInactive ? "" : "hover:!text-violet-600 dark:hover:!text-violet-400"}`}
        />
      </a>
      {market.teaser && (
        <a href={`/markets/${market.slug}`} onClick={(e) => { e.preventDefault(); if (!isInactive) navigateWithAnchor(market.slug); }} className={isInactive ? "cursor-default" : "cursor-pointer"}>
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

        {hasPnl && pnlText && (
          <div
            className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2"
            data-testid={`community-card-pnl-${market.slug}`}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Your position
            </span>
            <span className={`text-xs font-semibold font-mono tabular-nums ${pnlClass}`}>
              {pnlText}
            </span>
          </div>
        )}
      </div>

      <div>
        {isMarketClosed ? (
          <Button className="w-full bg-muted text-muted-foreground cursor-not-allowed" disabled>
            <Lock className="h-4 w-4 mr-2" />
            Closed
          </Button>
        ) : userBetResult?.result === "pending" ? (
          <PendingBetLinkRow
            entryLabel={userBetResult.entryLabel}
            stakeAmount={userBetResult.stakeAmount}
            href={`/markets/${market.slug}`}
            onLinkClick={rememberAnchor}
            unrealisedPnl={unrealisedPnl ?? null}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="!min-h-0 h-auto px-4 py-3 md:py-2.5 bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20 flex flex-col items-center justify-center gap-0.5"
              onClick={() => {
                if (onPickEntry && aboveEntry) {
                  onPickEntry(market, aboveEntry, "yes");
                } else {
                  navigateWithAnchor(market.slug, "above");
                }
              }}
              data-testid={`button-above-${market.slug}`}
            >
              <span className="leading-none">Above {abovePercent}%</span>
              <span className="text-[10px] font-mono opacity-80 leading-none">
                {abovePrice.toFixed(2)} cr/share
              </span>
            </Button>
            <Button
              className="!min-h-0 h-auto px-4 py-3 md:py-2.5 bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20 flex flex-col items-center justify-center gap-0.5"
              onClick={() => {
                if (onPickEntry && belowEntry) {
                  onPickEntry(market, belowEntry, "yes");
                } else {
                  navigateWithAnchor(market.slug, "below");
                }
              }}
              data-testid={`button-below-${market.slug}`}
            >
              <span className="leading-none">Below {belowPercent}%</span>
              <span className="text-[10px] font-mono opacity-80 leading-none">
                {belowPrice.toFixed(2)} cr/share
              </span>
            </Button>
          </div>
        )}
        <UserBetResult betResult={userBetResult} isMarketClosed={isMarketClosed} />
      </div>
    </PredictCard>
  );
}

export function OpenMarketCard({ market, onNavigate, onPickEntry, isMarketClosed = false, userBetResult, userBetsPerEntry, onFilterCategory, categoryRaceMap, leaderboardCategories, onBrowseFullScreen, unrealisedPnl }: { market: any; onNavigate: (slug: string, pick?: string, direction?: string) => void; /** When provided, Buy clicks on any card variant (binary / multi / up-down) open the StakeModal in-place via PredictPage's handleCommunityPickEntry instead of routing to /markets/:slug. Each sub-card falls back to onNavigate when onPickEntry isn't wired so SSR / list views without the modal still work. */ onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void; isMarketClosed?: boolean; userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number }; userBetsPerEntry?: Map<string, { yesStake: number; noStake: number }>; onFilterCategory?: (cat: string) => void; categoryRaceMap?: Map<string, string>; leaderboardCategories?: Set<string>; onBrowseFullScreen?: () => void; /** AMM unrealised P&L for the user's top position. Threaded through to Binary + Multi + UpDown sub-cards. */ unrealisedPnl?: number | null }) {
  const entries = market.entries || [];
  const participants = market.activeParticipantCount || market.betCount || 0;
  const isInactive = market.visibility === "inactive";

  const endDate = market.endAt ? new Date(market.endAt) : null;
  const now = new Date();
  const daysLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;
  const timeLabel = daysLeft > 1 ? `${daysLeft}d left` : daysLeft === 1 ? "1d left" : "Closing soon";

  if (market.openMarketType === "updown") {
    return <UpDownMarketCard market={market} entries={entries} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} onPickEntry={onPickEntry} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} userBetResult={userBetResult} onFilterCategory={onFilterCategory} categoryRaceMap={categoryRaceMap} leaderboardCategories={leaderboardCategories} onBrowseFullScreen={onBrowseFullScreen} unrealisedPnl={unrealisedPnl} />;
  }
  if (market.openMarketType === "multi") {
    return <MultiMarketCard market={market} entries={entries} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} onPickEntry={onPickEntry} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} userBetResult={userBetResult} userBetsPerEntry={userBetsPerEntry} onFilterCategory={onFilterCategory} categoryRaceMap={categoryRaceMap} leaderboardCategories={leaderboardCategories} onBrowseFullScreen={onBrowseFullScreen} unrealisedPnl={unrealisedPnl} />;
  }
  return <BinaryMarketCard market={market} entries={entries} participants={participants} timeLabel={timeLabel} onNavigate={onNavigate} onPickEntry={onPickEntry} isMarketClosed={isMarketClosed || isInactive} isInactive={isInactive} inactiveMessage={market.inactiveMessage} userBetResult={userBetResult} userBetsPerEntry={userBetsPerEntry} onFilterCategory={onFilterCategory} categoryRaceMap={categoryRaceMap} leaderboardCategories={leaderboardCategories} onBrowseFullScreen={onBrowseFullScreen} unrealisedPnl={unrealisedPnl} />;
}
