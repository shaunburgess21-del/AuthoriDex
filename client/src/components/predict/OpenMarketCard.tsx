import { useState } from "react";
import { Drawer } from "vaul";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { AvatarHeightHeadline } from "@/components/AvatarHeightHeadline";
import { PredictCard } from "@/components/predict/PredictCard";
import { ParticipantAvatarStack } from "@/components/predict/ParticipantAvatarStack";
import { useLocation } from "wouter";
import { Check, Clock, Lock, Trophy, XCircle, RotateCcw, X, ExternalLink, Plus } from "lucide-react";
import { resolveMarketHeadlineImageUrl } from "@/lib/predictMarketImage";
import { pricesFor, snapshotFromApi, type ApiAmmStateBlock } from "@/lib/ammClient";
import { worldMarketShare } from "@/lib/share";
import { formatVox, formatVoxCompact, voxWord } from "@/lib/currency";
import { setPredictReturnAnchor } from "@/lib/predictReturnAnchor";
import { isCommunityTradingClosed } from "@/lib/marketClosedMessaging";
import { formatMarketCountdown } from "@/lib/marketCountdown";
import { isOtherStyleOutcomeLabel } from "@shared/lib/other-outcome";
import { PositionSummaryRow, formatPickLabel } from "@/components/predict/PositionSummaryRow";
import { cn } from "@/lib/utils";

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
  // payout on `marketBets` already encodes the final Vox and the
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
      {betResult.result === 'won' ? `Won +${voxWord(betResult.payout)}` :
       betResult.result === 'refunded' ? `Refunded ${voxWord(betResult.stakeAmount)}` :
       `Lost ${voxWord(betResult.stakeAmount)}`}
      <span className="text-muted-foreground font-normal ml-auto">Picked: {betResult.entryLabel}</span>
    </div>
  );
}

function isYesLikeLabel(label: string) {
  const l = (label || "").toLowerCase();
  return l === "yes" || l === "above";
}

function normalizeEntryLabel(label: unknown) {
  return String(label || "").trim();
}

function isClassicYesNoLabels(leftLabel: string, rightLabel: string) {
  return leftLabel.toLowerCase() === "yes" && rightLabel.toLowerCase() === "no";
}

/** Resolve binary sides by Yes/No label when present; otherwise display order. */
function resolveBinaryEntries(entries: any[]) {
  const byLabel = (wanted: string) =>
    entries.find((e: any) => normalizeEntryLabel(e?.label).toLowerCase() === wanted);
  const leftEntry = byLabel("yes") || entries[0];
  const rightEntry =
    byLabel("no") ||
    entries.find((e: any) => e && e !== leftEntry) ||
    entries[1];
  return { leftEntry, rightEntry };
}

type BinarySideStyle = {
  textClass: string;
  buttonClass: string;
  accent: string;
};

function binarySideStyles(isYesNo: boolean): { left: BinarySideStyle; right: BinarySideStyle } {
  if (isYesNo) {
    return {
      left: {
        textClass: "text-green-600 dark:text-green-500",
        buttonClass:
          "bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20",
        accent: "#00C853",
      },
      right: {
        textClass: "text-red-600 dark:text-red-500",
        buttonClass:
          "bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20",
        accent: "#FF0000",
      },
    };
  }

  // Match native H2H blue / violet so neither side reads as "bad".
  return {
    left: {
      textClass: "text-blue-600 dark:text-blue-400",
      buttonClass:
        "bg-[#3B82F6]/10 border border-[#3B82F6]/50 text-[#3B82F6] hover:border-[#3B82F6]/80 hover:bg-[#3B82F6]/20",
      accent: "#3B82F6",
    },
    right: {
      textClass: "text-purple-600 dark:text-purple-400",
      buttonClass:
        "bg-[#7C3AED]/10 border border-[#7C3AED]/50 text-[#7C3AED] hover:border-[#7C3AED]/80 hover:bg-[#7C3AED]/20",
      accent: "#7C3AED",
    },
  };
}

function binaryLabelTextClass(label: string) {
  const len = label.trim().length;
  if (len > 24) return "text-[10px]";
  if (len > 16) return "text-xs";
  return "";
}

/** Resolve which entry/direction to top up from aggregated bet rows. */
function resolvePendingTopUpTarget(
  entries: any[],
  userBetResult: { entryLabel: string },
  userBetsPerEntry?: Map<string, { yesStake: number; noStake: number }>,
): { entry: any; direction: "yes" | "no" } | null {
  const label = (userBetResult.entryLabel || "").trim().toLowerCase();
  if (label && label !== "multiple positions") {
    const byLabel = entries.find((e) => (e.label || "").trim().toLowerCase() === label);
    if (byLabel) {
      const stakes = userBetsPerEntry?.get(String(byLabel.id));
      const direction: "yes" | "no" =
        stakes && stakes.noStake > stakes.yesStake
          ? "no"
          : stakes && stakes.noStake > 0 && stakes.yesStake === 0
            ? "no"
            : "yes";
      return { entry: byLabel, direction };
    }
  }

  if (!userBetsPerEntry) return null;

  let resolved: { entry: any; direction: "yes" | "no" } | null = null;
  for (const [eId, stakes] of userBetsPerEntry) {
    const direction: "yes" | "no" | null =
      stakes.noStake > stakes.yesStake
        ? "no"
        : stakes.yesStake > 0
          ? "yes"
          : stakes.noStake > 0
            ? "no"
            : null;
    if (!direction) continue;
    const entry = entries.find((e: any) => String(e.id) === eId);
    if (!entry) continue;
    if (resolved) return null;
    resolved = { entry, direction };
  }
  return resolved;
}

function PendingBetLinkRow({
  entryLabel,
  stakeAmount,
  href,
  onTopUp,
  onLinkClick,
  unrealisedPnl,
  accentColor,
}: {
  entryLabel: string;
  stakeAmount: number;
  href: string;
  /** When provided, shows + Add for in-place top-up (StakeModal). */
  onTopUp?: () => void;
  /** Fired right before wouter navigates so the parent can stash a predict-return anchor. */
  onLinkClick?: () => void;
  /** AMM unrealised P&L. Shown next to Stake. */
  unrealisedPnl?: number | null;
  /** Override accent when the pick isn't a classic Yes/No (e.g. England vs Argentina). */
  accentColor?: string;
}) {
  const yesLike = isYesLikeLabel(entryLabel);
  const accent = accentColor || (yesLike ? "#00C853" : "#FF0000");

  return (
    <PositionSummaryRow
      pickLabel={formatPickLabel(entryLabel)}
      stakeAmount={stakeAmount}
      unrealisedPnl={unrealisedPnl ?? null}
      href={href}
      onLinkClick={onLinkClick}
      onAdd={onTopUp}
      addAriaLabel={`Add to your ${entryLabel} pick`}
      linkAriaLabel={`View your prediction: ${entryLabel}`}
      accentShellClassName="hover:brightness-110"
      shellStyle={{
        backgroundColor: `${accent}10`,
        borderColor: `${accent}80`,
      }}
      icon={
        <div
          className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 border"
          style={{ backgroundColor: `${accent}1A`, borderColor: `${accent}80` }}
        >
          <Check className="h-2.5 w-2.5" style={{ color: accent }} />
        </div>
      }
      testId="pending-bet-link"
      addTestId="pending-bet-add"
    />
  );
}

function openMarketPredictCardProps(
  slug: string,
  isMarketClosed: boolean,
  isInactive: boolean | undefined,
  inactiveMessage: string | undefined,
) {
  return {
    autoSize: true as const,
    testId: `card-market-${slug}`,
    className: isMarketClosed && !isInactive ? "opacity-75" : "",
    inactive: isInactive,
    inactiveMessage,
  };
}

/** Prefer AMM net cost basis over gross buy stakes (matches Weekly cards). */
function resolveDisplayStake(
  grossStake: number | undefined,
  netCreditsIn: number | null | undefined,
): number {
  if (typeof netCreditsIn === "number" && Number.isFinite(netCreditsIn) && netCreditsIn >= 0) {
    return Math.round(netCreditsIn);
  }
  return grossStake ?? 0;
}

function WorldMarketViewDetailsLink({
  slug,
  isInactive,
  onNavigate,
}: {
  slug: string;
  isInactive: boolean;
  onNavigate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!isInactive) onNavigate();
      }}
      disabled={isInactive}
      className={`mt-2.5 inline-flex items-center justify-center w-full min-h-10 md:min-h-0 px-0.5 text-xs md:text-sm font-semibold transition-colors whitespace-nowrap ${
        isInactive
          ? "text-muted-foreground cursor-default"
          : "text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 cursor-pointer"
      }`}
      data-testid={`link-view-details-${slug}`}
      aria-label="View market details"
    >
      View details →
    </button>
  );
}

type OpenMarketCardSharedProps = {
  market: any;
  entries: any[];
  participants: number;
  timeLabel: string;
  timeUrgent?: boolean;
  onNavigate: (slug: string, pick?: string, direction?: string) => void;
  onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void;
  isMarketClosed: boolean;
  isInactive?: boolean;
  inactiveMessage?: string;
  userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number };
  userBetsPerEntry?: Map<string, { yesStake: number; noStake: number }>;
  onFilterCategory?: (cat: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onBrowseFullScreen?: () => void;
  categoryMenuDisabled?: boolean;
  unrealisedPnl?: number | null;
  /** AMM net cost basis — preferred stake display when present. */
  netCreditsIn?: number | null;
  /** Open-leg count for multi rollup ("Multiple picks"). */
  positionCount?: number;
};

function BinaryMarketCard({
  market,
  entries,
  participants,
  timeLabel,
  timeUrgent = false,
  onNavigate,
  onPickEntry,
  isMarketClosed,
  isInactive = false,
  inactiveMessage,
  userBetResult,
  userBetsPerEntry,
  onFilterCategory,
  leaderboardCategories,
  onBrowseFullScreen,
  categoryMenuDisabled = false,
  unrealisedPnl,
  netCreditsIn,
}: OpenMarketCardSharedProps) {
  const rememberAnchor = () => rememberCommunityCardAnchor(market?.id);
  const navigateWithAnchor = (slug: string, pick?: string, direction?: string) => {
    rememberAnchor();
    onNavigate(slug, pick, direction);
  };
  const volumeRaw = Number((market as any)?.volume ?? 0);
  const volumeLabel = volumeRaw > 0 ? formatVoxCompact(volumeRaw) : null;
  const ammSnap = snapshotFromApi((market.ammState as ApiAmmStateBlock | null | undefined) ?? null);
  const ammPrices = ammSnap ? pricesFor(ammSnap) : null;
  const { leftEntry, rightEntry } = resolveBinaryEntries(entries);
  const leftLabel = normalizeEntryLabel(leftEntry?.label) || "Yes";
  const rightLabel = normalizeEntryLabel(rightEntry?.label) || "No";
  const isYesNoMarket = isClassicYesNoLabels(leftLabel, rightLabel);
  const sideStyles = binarySideStyles(isYesNoMarket);
  const leftPrice = ammPrices && leftEntry?.id ? Number(ammPrices[leftEntry.id] ?? 0) : 0;
  const leftPercent = Math.max(0, Math.min(100, Math.round(leftPrice * 100)));
  const rightPercent = Math.max(0, 100 - leftPercent);
  const pendingAccent = (() => {
    if (!userBetResult?.entryLabel) return undefined;
    const pick = userBetResult.entryLabel.trim().toLowerCase();
    if (pick === leftLabel.toLowerCase()) return sideStyles.left.accent;
    if (pick === rightLabel.toLowerCase()) return sideStyles.right.accent;
    return undefined;
  })();
  const navigateToSide = (entry: any, legacyPick: "yes" | "no") => {
    const raw = entry?.id || normalizeEntryLabel(entry?.label) || legacyPick;
    navigateWithAnchor(market.slug, encodeURIComponent(String(raw)));
  };
  const displayStake = resolveDisplayStake(userBetResult?.stakeAmount, netCreditsIn);

  return (
    <PredictCard
      {...openMarketPredictCardProps(market.slug, isMarketClosed, isInactive, inactiveMessage)}
    >
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              timeUrgent && "text-amber-700 dark:text-amber-400 border-amber-500/50",
            )}
          >
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
        {market.category && (
          <InteractiveCategoryPill
            category={market.category}
            onFilter={() => onFilterCategory?.(market.category)}
            leaderboardCategories={leaderboardCategories}
            detailHref={`/markets/${market.slug}`}
            detailLabel="View Market Details"
            onBrowseFullScreen={onBrowseFullScreen}
            share={market.slug ? worldMarketShare(market.slug, market.title) : undefined}
            reactionTarget={{ surfaceType: "market_world", targetId: String(market.id) }}
            menuDisabled={categoryMenuDisabled}
          />
        )}
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
          <p className={`text-sm text-muted-foreground mb-3 line-clamp-2 leading-[1.4] ${!isInactive ? "hover:text-violet-600 dark:hover:text-violet-400" : ""} transition-colors`}>{market.teaser}</p>
        </a>
      )}

      <div className="mt-auto">
        <div className="mb-2">
          <ParticipantAvatarStack participants={market.recentParticipants} totalCount={participants} />
        </div>

        <div className="mb-2">
          {isYesNoMarket ? (
            <div className="h-3 rounded-full bg-red-500/25 dark:bg-red-500/20 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all"
                style={{ width: `${leftPercent}%` }}
              />
            </div>
          ) : (
            <div className="h-3 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all"
                style={{ width: `${leftPercent}%` }}
              />
              <div
                className="h-full bg-gradient-to-l from-purple-500 to-purple-400 transition-all"
                style={{ width: `${rightPercent}%` }}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-xs mt-1.5 min-w-0">
            <span
              className={`${sideStyles.left.textClass} font-semibold truncate max-w-[48%] ${binaryLabelTextClass(leftLabel)}`}
              title={`${leftLabel} ${leftPercent}%`}
            >
              {leftLabel} {leftPercent}%
            </span>
            <span
              className={`${sideStyles.right.textClass} font-semibold truncate max-w-[48%] text-right ${binaryLabelTextClass(rightLabel)}`}
              title={`${rightLabel} ${rightPercent}%`}
            >
              {rightLabel} {rightPercent}%
            </span>
          </div>
        </div>

        <div>
          {isMarketClosed ? (
            <Button className="w-full bg-muted text-muted-foreground cursor-not-allowed" disabled>
              <Lock className="h-4 w-4 mr-2" />
              Closed
            </Button>
          ) : userBetResult?.result === "pending" ? (
            (() => {
              const topUpTarget =
                onPickEntry
                  ? resolvePendingTopUpTarget(entries, userBetResult, userBetsPerEntry)
                  : null;
              return (
                <PendingBetLinkRow
                  entryLabel={userBetResult.entryLabel}
                  stakeAmount={displayStake}
                  href={`/markets/${market.slug}`}
                  onLinkClick={rememberAnchor}
                  onTopUp={
                    topUpTarget && onPickEntry
                      ? () => onPickEntry(market, topUpTarget.entry, topUpTarget.direction)
                      : undefined
                  }
                  unrealisedPnl={unrealisedPnl ?? null}
                  accentColor={pendingAccent}
                />
              );
            })()
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                className={`!min-h-0 h-auto px-3 py-3 md:py-2.5 min-w-0 truncate ${sideStyles.left.buttonClass} ${binaryLabelTextClass(leftLabel)}`}
                onClick={() => {
                  if (onPickEntry && leftEntry) {
                    onPickEntry(market, leftEntry, "yes");
                  } else {
                    navigateToSide(leftEntry, "yes");
                  }
                }}
                data-testid={`button-yes-${market.slug}`}
                aria-label={`Pick ${leftLabel}`}
                title={`${leftLabel} ${leftPercent}%`}
              >
                {leftLabel} {leftPercent}%
              </Button>
              <Button
                className={`!min-h-0 h-auto px-3 py-3 md:py-2.5 min-w-0 truncate ${sideStyles.right.buttonClass} ${binaryLabelTextClass(rightLabel)}`}
                onClick={() => {
                  if (onPickEntry && rightEntry) {
                    onPickEntry(market, rightEntry, "yes");
                  } else {
                    navigateToSide(rightEntry, "no");
                  }
                }}
                data-testid={`button-no-${market.slug}`}
                aria-label={`Pick ${rightLabel}`}
                title={`${rightLabel} ${rightPercent}%`}
              >
                {rightLabel} {rightPercent}%
              </Button>
            </div>
          )}
          {userBetResult?.result !== "pending" && (
            <WorldMarketViewDetailsLink
              slug={market.slug}
              isInactive={!!isInactive}
              onNavigate={() => navigateWithAnchor(market.slug)}
            />
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
  /** Show raw entry pool Vox below the row (drawer only). */
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
  // rows. Single-line "Yes pct%" label and colour (#00C853 brand green)
  // match the binary + Up/Down card Yes buttons so the three card
  // variants are visually consistent.
  const buttonClass =
    "shrink-0 text-center w-[92px] md:w-[104px] px-1 md:px-1.5 py-1.5 md:py-2 rounded-md transition-colors tabular-nums flex items-center justify-center";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-1 -mx-1 py-0.5",
        hasPendingBet && userDirection && "bg-violet-500/8 dark:bg-violet-500/5",
      )}
    >
      <div className="flex-1 min-w-0">
        <div
          className={`truncate text-[13px] md:text-[14px] font-medium ${
            isOtherStyleOutcomeLabel(entry.label) ? "text-muted-foreground italic" : ""
          }`}
        >
          {entry.label}
        </div>
        {showEntryPool && (
          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            {voxWord(entryPool)} in pool
            {hasPendingBet && userStake > 0 ? ` · Your stake ${formatVox(userStake)}` : ""}
          </div>
        )}
      </div>
      {hasPendingBet && userBet && userDirection ? (
        // Card preview: lightweight check + pct marker (stake lives in
        // the footer PositionSummaryRow / drawer). Drawer keeps Add.
        <>
          <span className="text-[11px] md:text-[12px] font-mono font-semibold text-muted-foreground tabular-nums shrink-0">
            {entry.pct}%
          </span>
          <div
            className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 border border-violet-500/50 bg-violet-500/15"
            data-testid={`pending-entry-${entry.id}`}
            aria-label={`Your pick on ${entry.label}`}
          >
            <Check className="h-2.5 w-2.5 text-violet-600 dark:text-violet-400" />
          </div>
          {showEntryPool && onPickEntry && !isMarketClosed && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(e) => handlePick(e, userDirection)}
              className="h-auto gap-0.5 min-h-10 px-2 py-1.5"
              data-testid={`pending-entry-add-${entry.id}`}
              aria-label={`Add to your ${userDirection.toUpperCase()} pick`}
            >
              <Plus className="h-3 w-3" />
              <span className="hidden min-[360px]:inline text-[10px]">Add</span>
            </Button>
          )}
        </>
      ) : !isMarketClosed ? (
        <div className="flex shrink-0">
          <button
            className={`${buttonClass} bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20`}
            onClick={(e) => handlePick(e, "yes")}
            data-testid={`button-buy-${entry.id}`}
          >
            <span className="text-[11px] md:text-xs font-semibold leading-none">Yes {entry.pct}%</span>
          </button>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground shrink-0 w-24 text-right">{entry.pct}%</span>
      )}
    </div>
  );
}

const MULTI_MARKET_PREVIEW_COUNT = 3;

function MultiMarketCard({
  market,
  entries,
  participants,
  timeLabel,
  timeUrgent = false,
  onNavigate,
  onPickEntry,
  isMarketClosed,
  isInactive = false,
  inactiveMessage,
  userBetResult,
  userBetsPerEntry,
  onFilterCategory,
  leaderboardCategories,
  onBrowseFullScreen,
  categoryMenuDisabled = false,
  unrealisedPnl,
  netCreditsIn,
  positionCount = 0,
}: OpenMarketCardSharedProps) {
  const [, setLocation] = useLocation();
  const [optionsDrawerOpen, setOptionsDrawerOpen] = useState(false);
  const rememberAnchor = () => rememberCommunityCardAnchor(market?.id);
  const navigateWithAnchor = (slug: string, pick?: string, direction?: string) => {
    rememberAnchor();
    onNavigate(slug, pick, direction);
  };

  const volumeRaw = Number((market as any)?.volume ?? 0);
  const volumeLabel = volumeRaw > 0 ? formatVoxCompact(volumeRaw) : null;
  const ammSnap = snapshotFromApi((market.ammState as ApiAmmStateBlock | null | undefined) ?? null);
  const ammPrices = ammSnap ? pricesFor(ammSnap) : null;

  const hasPendingResult = userBetResult?.result === "pending";
  const displayStake = resolveDisplayStake(userBetResult?.stakeAmount, netCreditsIn);
  const multiPickLabel = formatPickLabel(
    positionCount > 1 ? "Multiple positions" : userBetResult?.entryLabel,
  );

  // Single-outcome top-up target for the footer + Add button.
  const singleTopUpTarget =
    hasPendingResult && onPickEntry && positionCount <= 1 && userBetResult
      ? resolvePendingTopUpTarget(entries, userBetResult, userBetsPerEntry)
      : null;

  const enriched = entries.map((e: any) => {
    const ammPrice = ammPrices ? Number(ammPrices[e.id] ?? 0) : 0;
    return {
      ...e,
      pct: Math.max(0, Math.min(100, Math.round(ammPrice * 100))),
      ammPrice,
    };
  });

  const rankedEntries = [...enriched].sort((a: any, b: any) => {
    const aPinned = hasPendingResult && userBetsPerEntry?.has(String(a.id)) ? 1 : 0;
    const bPinned = hasPendingResult && userBetsPerEntry?.has(String(b.id)) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    const aOther = isOtherStyleOutcomeLabel(a.label) ? 1 : 0;
    const bOther = isOtherStyleOutcomeLabel(b.label) ? 1 : 0;
    if (aOther !== bOther) return aOther - bOther;
    return b.pct - a.pct;
  });

  const visibleEntries = rankedEntries.slice(0, MULTI_MARKET_PREVIEW_COUNT);
  const remainingCount = Math.max(0, rankedEntries.length - MULTI_MARKET_PREVIEW_COUNT);

  const openOptionsDrawer = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOptionsDrawerOpen(true);
  };

  return (
    <PredictCard
      {...openMarketPredictCardProps(market.slug, isMarketClosed, isInactive, inactiveMessage)}
    >
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              timeUrgent && "text-amber-700 dark:text-amber-400 border-amber-500/50",
            )}
          >
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
        {market.category && (
          <InteractiveCategoryPill
            category={market.category}
            onFilter={() => onFilterCategory?.(market.category)}
            leaderboardCategories={leaderboardCategories}
            detailHref={`/markets/${market.slug}`}
            detailLabel="View Market Details"
            onBrowseFullScreen={onBrowseFullScreen}
            share={market.slug ? worldMarketShare(market.slug, market.title) : undefined}
            reactionTarget={{ surfaceType: "market_world", targetId: String(market.id) }}
            menuDisabled={categoryMenuDisabled}
          />
        )}
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
          <p className={`text-sm text-muted-foreground mb-3 line-clamp-2 leading-[1.4] ${!isInactive ? "hover:text-violet-600 dark:hover:text-violet-400" : ""} transition-colors`}>{market.teaser}</p>
        </a>
      )}

      <div className="mb-2">
        <ParticipantAvatarStack participants={market.recentParticipants} totalCount={participants} />
      </div>

      <div className="mt-auto">
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
        </div>

        {/* When the user has an open pick, the PositionSummaryRow below
            is the primary CTA — keep only a compact "+N more / options"
            strip so mobile doesn't stack three chrome rows. */}
        {hasPendingResult ? (
          remainingCount > 0 ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={openOptionsDrawer}
                className="text-left min-h-10 md:min-h-0 flex items-center"
                data-testid={`link-more-options-${market.slug}`}
                aria-label={`Show ${remainingCount} more options`}
              >
                <span className="text-xs text-violet-600 dark:text-violet-400 hover:underline">
                  +{remainingCount} more
                </span>
              </button>
              <button
                type="button"
                onClick={openOptionsDrawer}
                className="min-h-10 md:min-h-0 flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30"
                data-testid={`button-options-count-${market.slug}`}
                aria-label={`Show all ${entries.length} options`}
              >
                <Badge variant="outline" className="text-[10px] shrink-0 pointer-events-none">
                  {entries.length} options
                </Badge>
              </button>
            </div>
          ) : null
        ) : (
          <div className="mt-2.5 grid grid-cols-3 items-center gap-1 max-md:gap-0.5 md:gap-2">
            <div className="min-w-0">
              {remainingCount > 0 && (
                <button
                  type="button"
                  onClick={openOptionsDrawer}
                  className="text-left w-full min-h-10 md:min-h-0 flex items-center max-md:-ml-1 max-md:pl-1"
                  data-testid={`link-more-options-${market.slug}`}
                  aria-label={`Show ${remainingCount} more options`}
                >
                  <span className="text-xs text-violet-600 dark:text-violet-400 hover:underline truncate">
                    +{remainingCount} more
                  </span>
                </button>
              )}
            </div>
            <div className="min-w-0 text-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isInactive) navigateWithAnchor(market.slug);
                }}
                disabled={isInactive}
                className={`inline-flex items-center justify-center w-full min-h-10 md:min-h-0 px-0.5 text-xs md:text-sm font-semibold transition-colors whitespace-nowrap ${isInactive ? "text-muted-foreground cursor-default" : "text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 cursor-pointer"}`}
                data-testid={`link-view-details-${market.slug}`}
                aria-label="View market details"
              >
                View details →
              </button>
            </div>
            <div className="min-w-0 flex justify-end">
              <button
                type="button"
                onClick={openOptionsDrawer}
                className="min-h-10 md:min-h-0 flex items-center justify-end rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                data-testid={`button-options-count-${market.slug}`}
                aria-label={`Show all ${entries.length} options`}
              >
                <Badge variant="outline" className="text-[10px] shrink-0 max-w-full truncate pointer-events-none">
                  {entries.length} options
                </Badge>
              </button>
            </div>
          </div>
        )}

        {hasPendingResult && userBetResult && (
          <div className="mt-2.5">
            <PositionSummaryRow
              pickLabel={multiPickLabel}
              stakeAmount={displayStake}
              unrealisedPnl={unrealisedPnl ?? null}
              href={`/markets/${market.slug}`}
              onLinkClick={rememberAnchor}
              onAdd={
                singleTopUpTarget && onPickEntry
                  ? () => onPickEntry(market, singleTopUpTarget.entry, singleTopUpTarget.direction)
                  : undefined
              }
              addAriaLabel={
                singleTopUpTarget
                  ? `Add to your ${singleTopUpTarget.entry.label} pick`
                  : undefined
              }
              linkAriaLabel={`View your pick: ${multiPickLabel}`}
              testId={`community-card-position-${market.slug}`}
              addTestId={`community-card-add-${market.slug}`}
            />
          </div>
        )}

        <UserBetResult betResult={userBetResult} isMarketClosed={isMarketClosed} />
      </div>

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

function UpDownMarketCard({
  market,
  entries,
  participants,
  timeLabel,
  timeUrgent = false,
  onNavigate,
  onPickEntry,
  isMarketClosed,
  isInactive = false,
  inactiveMessage,
  userBetResult,
  userBetsPerEntry,
  onFilterCategory,
  leaderboardCategories,
  onBrowseFullScreen,
  categoryMenuDisabled = false,
  unrealisedPnl,
  netCreditsIn,
}: OpenMarketCardSharedProps) {
  const rememberAnchor = () => rememberCommunityCardAnchor(market?.id);
  const navigateWithAnchor = (slug: string, pick?: string, direction?: string) => {
    rememberAnchor();
    onNavigate(slug, pick, direction);
  };
  const aboveEntry = entries.find((e: any) => e.label === "Above") || entries[0];
  const belowEntry = entries.find((e: any) => e.label === "Below") || entries[1];
  const ammSnap = snapshotFromApi((market.ammState as ApiAmmStateBlock | null | undefined) ?? null);
  const ammPrices = ammSnap ? pricesFor(ammSnap) : null;
  const abovePrice = ammPrices && aboveEntry?.id ? Number(ammPrices[aboveEntry.id] ?? 0) : 0;
  const belowPrice = ammPrices && belowEntry?.id ? Number(ammPrices[belowEntry.id] ?? 0) : 0;
  const abovePercent = Math.max(0, Math.min(100, Math.round(abovePrice * 100)));
  const belowPercent = Math.max(0, Math.min(100, Math.round(belowPrice * 100)));
  const volumeRaw = Number((market as any)?.volume ?? 0);
  const volumeLabel = volumeRaw > 0 ? formatVoxCompact(volumeRaw) : null;
  const displayStake = resolveDisplayStake(userBetResult?.stakeAmount, netCreditsIn);

  return (
    <PredictCard
      {...openMarketPredictCardProps(market.slug, isMarketClosed, isInactive, inactiveMessage)}
    >
      <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              timeUrgent && "text-amber-700 dark:text-amber-400 border-amber-500/50",
            )}
          >
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
        {market.category && (
          <InteractiveCategoryPill
            category={market.category}
            onFilter={() => onFilterCategory?.(market.category)}
            leaderboardCategories={leaderboardCategories}
            detailHref={`/markets/${market.slug}`}
            detailLabel="View Market Details"
            onBrowseFullScreen={onBrowseFullScreen}
            share={market.slug ? worldMarketShare(market.slug, market.title) : undefined}
            reactionTarget={{ surfaceType: "market_world", targetId: String(market.id) }}
            menuDisabled={categoryMenuDisabled}
          />
        )}
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
          <p className={`text-sm text-muted-foreground mb-3 line-clamp-2 leading-[1.4] ${!isInactive ? "hover:text-violet-600 dark:hover:text-violet-400" : ""} transition-colors`}>{market.teaser}</p>
        </a>
      )}

      <div className="mt-auto">
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

        <div>
          {isMarketClosed ? (
            <Button className="w-full bg-muted text-muted-foreground cursor-not-allowed" disabled>
              <Lock className="h-4 w-4 mr-2" />
              Closed
            </Button>
          ) : userBetResult?.result === "pending" ? (
            (() => {
              const topUpTarget =
                onPickEntry
                  ? resolvePendingTopUpTarget(entries, userBetResult, userBetsPerEntry)
                  : null;
              return (
                <PendingBetLinkRow
                  entryLabel={userBetResult.entryLabel}
                  stakeAmount={displayStake}
                  href={`/markets/${market.slug}`}
                  onLinkClick={rememberAnchor}
                  onTopUp={
                    topUpTarget && onPickEntry
                      ? () => onPickEntry(market, topUpTarget.entry, topUpTarget.direction)
                      : undefined
                  }
                  unrealisedPnl={unrealisedPnl ?? null}
                />
              );
            })()
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="!min-h-0 h-auto px-4 py-3 md:py-2.5 bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
                onClick={() => {
                  if (onPickEntry && aboveEntry) {
                    onPickEntry(market, aboveEntry, "yes");
                  } else {
                    navigateWithAnchor(market.slug, "above");
                  }
                }}
                data-testid={`button-above-${market.slug}`}
              >
                Above {abovePercent}%
              </Button>
              <Button
                className="!min-h-0 h-auto px-4 py-3 md:py-2.5 bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
                onClick={() => {
                  if (onPickEntry && belowEntry) {
                    onPickEntry(market, belowEntry, "yes");
                  } else {
                    navigateWithAnchor(market.slug, "below");
                  }
                }}
                data-testid={`button-below-${market.slug}`}
              >
                Below {belowPercent}%
              </Button>
            </div>
          )}
          {userBetResult?.result !== "pending" && (
            <WorldMarketViewDetailsLink
              slug={market.slug}
              isInactive={!!isInactive}
              onNavigate={() => navigateWithAnchor(market.slug)}
            />
          )}
          <UserBetResult betResult={userBetResult} isMarketClosed={isMarketClosed} />
        </div>
      </div>
    </PredictCard>
  );
}

export function OpenMarketCard({
  market,
  onNavigate,
  onPickEntry,
  isMarketClosed = false,
  userBetResult,
  userBetsPerEntry,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  onBrowseFullScreen,
  categoryMenuDisabled = false,
  unrealisedPnl,
  netCreditsIn = null,
  positionCount = 0,
}: {
  market: any;
  onNavigate: (slug: string, pick?: string, direction?: string) => void;
  onPickEntry?: (market: any, entry: any, direction: "yes" | "no") => void;
  isMarketClosed?: boolean;
  userBetResult?: { result: string; payout: number; entryLabel: string; stakeAmount: number };
  userBetsPerEntry?: Map<string, { yesStake: number; noStake: number }>;
  onFilterCategory?: (cat: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onBrowseFullScreen?: () => void;
  categoryMenuDisabled?: boolean;
  unrealisedPnl?: number | null;
  /** AMM net cost basis for stake display (preferred over gross buy stakes). */
  netCreditsIn?: number | null;
  /** Number of open AMM legs (multi rollup → "Multiple picks"). */
  positionCount?: number;
}) {
  const entries = market.entries || [];
  const participants = market.activeParticipantCount || market.betCount || 0;
  const isInactive = market.visibility === "inactive";
  const tradingClosed = isMarketClosed || isCommunityTradingClosed(market);

  // Countdown to trading cutoff (closeAt), falling back to endAt.
  const cutoff = market.closeAt || market.endAt || null;
  const countdown = tradingClosed
    ? { label: "Closed", isUrgent: false }
    : formatMarketCountdown(cutoff);
  const timeLabel = countdown.label || "Closing soon";
  const timeUrgent = countdown.isUrgent;

  const shared: OpenMarketCardSharedProps = {
    market,
    entries,
    participants,
    timeLabel,
    timeUrgent,
    onNavigate,
    onPickEntry,
    isMarketClosed: tradingClosed || isInactive,
    isInactive,
    inactiveMessage: market.inactiveMessage,
    userBetResult,
    userBetsPerEntry,
    onFilterCategory,
    categoryRaceMap,
    leaderboardCategories,
    onBrowseFullScreen,
    categoryMenuDisabled,
    unrealisedPnl,
    netCreditsIn,
    positionCount,
  };

  if (market.openMarketType === "updown") {
    return <UpDownMarketCard {...shared} />;
  }
  if (market.openMarketType === "multi") {
    return <MultiMarketCard {...shared} />;
  }
  return <BinaryMarketCard {...shared} />;
}
