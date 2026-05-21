import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  Crown,
  HelpCircle,
  Plus,
  RotateCcw,
  Share2,
  Target,
  Trophy,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { formatTimeAgo } from "@/lib/formatDate";
import { getUpDownWinningState, UP_DOWN_STATE_LABELS } from "@/lib/updownState";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { CURRENCY, formatVox } from "@/lib/currency";

/**
 * Unified "My Position" card for every market detail page.
 *
 * Why this lives in a single component:
 *   - Each detail page used to roll its own "your prediction" surface,
 *     and the surfaces had drifted (jackpot showed multiple tickets but
 *     no live current score; race used a dead /api/me/bets endpoint;
 *     up/down had a bespoke panel; community had a pill-list summary).
 *   - The notification "Betting closes in 5h" deep-links straight here,
 *     so the page needs to instantly answer: "what's my position right
 *     now, how is it doing, and can I still take action".
 *
 * Per market type the card pivots its body:
 *   - `jackpot`  → list of (predictedScore, off-by, stake) tickets,
 *                  each row colour-keyed by closeness; CTA = "Add another"
 *   - `updown`   → baseline → current arrow, my pick, P/L direction
 *   - `h2h`      → my pick, who's leading right now
 *   - `race`/`gainer` → rank/pct-gain on my pick (kept loose since the
 *                  parent already shows the leaderboard)
 *   - `community`→ yes/no pill, entry label, payout-at-bet
 *
 * The header is always: live currentScore (if person-linked) +
 * baseline + delta. That's the universally-relevant signal.
 */

interface MyPositionBet {
  betId: string;
  entryId: string;
  entryLabel: string | null;
  entryPersonId: string | null;
  entryDisplayOrder: number | null;
  entryResolutionStatus: string | null;
  stakeAmount: number;
  potentialPayout: number | null;
  payoutAmount: number | null;
  status: string;
  direction: string;
  confidence: number | null;
  predictedScore: number | null;
  thesis: string | null;
  placedAt: string;
  settledAt: string | null;
}

interface MyPositionResponse {
  market: {
    id: string;
    marketType: string;
    /**
     * Sub-type used by community markets: "binary" | "multi" | "updown".
     * Used here to gate Yes/No labelling — only community-multi markets
     * carry a Yes/No-per-entry semantic. Native markets and binary
     * community markets render just the entry label.
     */
    openMarketType?: "binary" | "multi" | "updown" | null;
    status: string;
    slug: string | null;
    title: string;
    baselineScore: number | null;
    startAt: string | null;
    endAt: string | null;
    closeAt: string | null;
    personId: string | null;
    tieRule?: string | null;
  };
  currentScore: number | null;
  totalStake: number;
  betCount: number;
  bets: MyPositionBet[];
}

export interface MyPositionCardProps {
  marketId: string;
  /** Hint for body rendering. Falls back to the response's marketType. */
  marketType?: string;
  /**
   * Hint for the rendering mode. Falls back to the response's status.
   * Threaded through so the parent can render the result variant
   * synchronously (without waiting for /my-position to resolve), which
   * matters when the user lands on a deep-linked resolved page from a
   * notification — they shouldn't see the open-state header flash.
   */
  marketStatus?: string;
  /**
   * Click handler for the per-kind primary CTA. Parent owns the
   * actual flow (opens StakeModal / focuses jackpot input / etc.) so
   * this card stays presentational.
   */
  onAddEntry?: () => void;
  /** Override the default CTA label per page if needed. */
  ctaLabel?: string;
  /** Hide the CTA entirely (e.g. resolved markets). */
  hideCta?: boolean;
  /**
   * `engine === "amm"` shortcut from the caller. Post-parimutuel-sunset
   * every non-jackpot market is AMM, so this is effectively
   * `marketType !== "jackpot"`. Used to gate the persistent Share
   * affordance on the position header: jackpot tickets render their
   * own share entry point inside `JackpotBody`, so we suppress the
   * header button there to avoid duplicating it.
   */
  isAmm?: boolean;
  /**
   * Sprint 3.1 — persistent Share affordance for AMM open positions.
   *
   * When provided AND the position is still open, the header renders
   * a small Share2 icon button. Clicking calls the parent's handler,
   * which is expected to dispatch a `position` share-card payload
   * into the global ShareCardModal via `useShareCard()`. Jackpot
   * tickets render via `JackpotBody` instead of `EstimatedPayoutColumn`,
   * which has its own share entry point and so does not call this.
   */
  onShare?: () => void;
  className?: string;
}

const FRESH_INTERVAL_MS = 60_000;

export function MyPositionCard({
  marketId,
  marketType: marketTypeHint,
  marketStatus: marketStatusHint,
  onAddEntry,
  ctaLabel,
  hideCta,
  isAmm,
  onShare,
  className,
}: MyPositionCardProps) {
  const { isLoggedIn } = useAuth();

  const { data, isError } = useQuery<MyPositionResponse>({
    queryKey: ["/api/markets", marketId, "my-position"],
    enabled: !!marketId && isLoggedIn,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/markets/${marketId}/my-position`);
      return res.json();
    },
    // Auto-refresh while the user is looking at the page so "current
    // score" feels live without manual reload. 60s matches the bell
    // counts polling cadence for consistency.
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.hidden) return false;
      const status = (query.state.data as MyPositionResponse | undefined)?.market?.status;
      // Don't keep polling resolved markets — nothing's changing.
      if (status && status !== "OPEN") return false;
      return FRESH_INTERVAL_MS;
    },
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
  });

  if (!isLoggedIn) return null;
  if (isError) return null;

  // Deliberately silent during the initial fetch: most market visits
  // the user has zero bets on, so showing a skeleton would just flash a
  // box that disappears half a second later. Returning null until we
  // have data avoids that flicker; once data lands the card snaps in
  // (or stays absent if betCount === 0).
  const position = data;
  if (!position || position.betCount === 0) return null;

  const marketType = marketTypeHint ?? position.market.marketType;
  const status = marketStatusHint ?? position.market.status;
  const isOpen = status === "OPEN";
  const isResolved = status === "RESOLVED";
  const isVoid = status === "VOID";
  const showResult = isResolved || isVoid;
  const showCta = !hideCta && isOpen && onAddEntry;

  // Resolved/void markets share a single "Your Result" surface across
  // every market type. The per-kind bodies above are tuned for the
  // open-state UX (live score deltas, jackpot ticket distance, etc.)
  // and would mislead once the result is in.
  return (
    <Card
      className={cn(
        "p-4 mb-4",
        showResult
          ? "border-amber-500/30 dark:border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/[0.04]"
          : "border-violet-500/30 dark:border-violet-500/20 bg-violet-500/5 dark:bg-violet-500/[0.04]",
        className,
      )}
      data-testid="card-my-position"
    >
      {/* Header: identity + entry count + total stake (open), with
          aggregated Net/Payout summary on the right when resolved. The
          per-kind body below carries the live "Estimated payout" so we
          don't duplicate the hero's Current/Delta block here. */}
      <PositionHeader
        betCount={position.betCount}
        totalStake={position.totalStake}
        bets={position.bets}
        showResult={showResult}
        isVoid={isVoid}
        onShare={isAmm && isOpen ? onShare : undefined}
      />

      {/* Body: per-kind details for open markets, settled summary for
          resolved/void. */}
      <div className="mt-4">
        {showResult ? (
          <ResultBody position={position} isVoid={isVoid} />
        ) : marketType === "jackpot" ? (
          <JackpotBody position={position} />
        ) : marketType === "updown" ? (
          <UpDownBody position={position} />
        ) : marketType === "h2h" ? (
          <H2HBody position={position} />
        ) : marketType === "race" || marketType === "gainer" ? (
          <RaceBody position={position} />
        ) : (
          <GenericBody position={position} />
        )}
      </div>

      {showCta && (
        <Button
          variant="outline"
          className="w-full mt-4 border-violet-500/40 dark:border-violet-500/30 hover:bg-violet-500/10"
          onClick={onAddEntry}
          data-testid="button-my-position-cta"
        >
          <Plus className="h-4 w-4 mr-2" />
          {ctaLabel ?? defaultCtaLabel(marketType)}
        </Button>
      )}
    </Card>
  );
}

function defaultCtaLabel(marketType: string): string {
  switch (marketType) {
    case "jackpot":
      return "Add another entry";
    case "updown":
    case "h2h":
    case "race":
    case "gainer":
      return "Increase your stake";
    default:
      return "Place another prediction";
  }
}

interface PositionHeaderProps {
  betCount: number;
  totalStake: number;
  bets?: MyPositionBet[];
  showResult?: boolean;
  isVoid?: boolean;
  /**
   * Sprint 3.1 — when defined, render a Share2 icon button next to
   * the result/payout block. Parent gates this on AMM + open already.
   */
  onShare?: () => void;
}

function PositionHeader({
  betCount,
  totalStake,
  bets,
  showResult,
  isVoid,
  onShare,
}: PositionHeaderProps) {
  // Aggregate per-bet payout/profit across the user's settled bets
  // for the right-aligned summary on resolved markets. For active
  // markets we keep the original live-score block intact.
  const settled = useMemo(() => {
    if (!showResult || !bets || bets.length === 0) {
      return null;
    }
    let payout = 0;
    let profit = 0;
    let wonCount = 0;
    let lostCount = 0;
    let refundCount = 0;
    for (const bet of bets) {
      const stake = bet.stakeAmount ?? 0;
      const betPayout = bet.payoutAmount ?? 0;
      payout += betPayout;
      if (bet.status === "won") {
        profit += betPayout - stake;
        wonCount += 1;
      } else if (bet.status === "lost") {
        profit += -stake;
        lostCount += 1;
      } else if (bet.status === "refunded") {
        refundCount += 1;
      }
    }
    return { payout, profit, wonCount, lostCount, refundCount };
  }, [bets, showResult]);

  // Result-aware accent: amber for resolved, violet for open. Mirrors
  // the card border/background switch in MyPositionCard so the icon
  // chip doesn't visually fight the surrounding card.
  const iconChipClass = showResult
    ? "bg-amber-500/15 dark:bg-amber-500/10 border border-amber-500/40 dark:border-amber-500/30"
    : "bg-violet-500/15 dark:bg-violet-500/10 border border-violet-500/40 dark:border-violet-500/30";
  const iconColor = showResult
    ? "text-amber-600 dark:text-amber-400"
    : "text-violet-700 dark:text-violet-400";
  const heading = showResult
    ? isVoid
      ? "Your Refund"
      : "Your Result"
    : "Your Position";

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={cn("h-9 w-9 rounded-full flex items-center justify-center shrink-0", iconChipClass)}>
          {showResult ? (
            isVoid ? (
              <RotateCcw className={cn("h-[18px] w-[18px]", iconColor)} />
            ) : (
              <Trophy className={cn("h-[18px] w-[18px]", iconColor)} />
            )
          ) : (
            <Target className={cn("h-[18px] w-[18px]", iconColor)} />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-semibold text-sm leading-tight">{heading}</h3>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono leading-none">
              {betCount} {betCount === 1 ? "entry" : "entries"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            <Wallet className="h-3 w-3 inline-block mr-1 -mt-0.5" />
            <span className="font-mono tabular-nums">{formatVox(totalStake)}</span> staked
          </p>
        </div>
      </div>

      {!showResult && onShare && (
        // Sprint 3.1: persistent Share affordance for AMM open
        // positions. Lives next to the header rather than inside the
        // body so it survives the per-kind layout switches (UpDown vs
        // Race etc.) and never competes with the live-payout chip.
        // Tooltip is the discovery hint — the icon alone could read
        // as "send" or "navigate" without context.
        <TouchTooltip content="Share this position">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0 border-violet-500/30 hover:bg-violet-500/10"
            onClick={onShare}
            aria-label="Share this position"
            data-testid="button-share-position"
          >
            <Share2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </Button>
        </TouchTooltip>
      )}

      {showResult && settled && (
        <div className="text-right shrink-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
            {isVoid ? "Refunded" : "Net"}
          </p>
          <p
            className={cn(
              "font-mono font-bold text-sm sm:text-base tabular-nums leading-tight mt-0.5",
              !isVoid && settled.profit > 0 && "text-emerald-600 dark:text-emerald-400",
              !isVoid && settled.profit < 0 && "text-red-600 dark:text-red-400",
              (isVoid || settled.profit === 0) && "text-muted-foreground",
            )}
            data-testid="text-my-position-net"
          >
            {isVoid
              ? formatVox(settled.payout)
              : `${settled.profit > 0 ? "+" : settled.profit < 0 ? "\u2212" : ""}${CURRENCY.symbol}${Math.abs(settled.profit).toLocaleString("en-US")}`}
          </p>
          {!isVoid && (
            <p className="text-[11px] text-muted-foreground tabular-nums leading-none mt-0.5">
              Payout {formatVox(settled.payout)}
            </p>
          )}
        </div>
      )}

    </div>
  );
}

// One settled summary body for every market type. Per-kind nuance
// stops mattering once the bet has settled — what the user wants is
// "did I win/lose, what was my pick, what did each entry pay out".
function ResultBody({
  position,
  isVoid,
}: {
  position: MyPositionResponse;
  isVoid?: boolean;
}) {
  const bets = position.bets;
  return (
    <div className="space-y-1.5">
      {bets.map((bet) => {
        const stake = bet.stakeAmount ?? 0;
        const payout = bet.payoutAmount ?? 0;
        const status = bet.status;
        const isWon = status === "won";
        const isLost = status === "lost";
        const isRefund = status === "refunded";
        const profit = isWon ? payout - stake : isLost ? -stake : 0;
        const signedProfit = profit > 0
          ? `+${CURRENCY.symbol}${profit.toLocaleString("en-US")}`
          : profit < 0
            ? `\u2212${CURRENCY.symbol}${Math.abs(profit).toLocaleString("en-US")}`
            : `${CURRENCY.symbol}0`;
        // Jackpot bets carry their predicted score in metadata; the
        // entry label for jackpot is just "Jackpot" so we surface the
        // predicted number instead to keep rows distinguishable.
        const isJackpot = position.market.marketType === "jackpot";
        const titleLabel = isJackpot && bet.predictedScore != null
          ? bet.predictedScore.toLocaleString("en-US")
          : (bet.entryLabel ?? "—");
        // Yes/No prefixes are only meaningful for community-multi markets
        // (Polymarket-style "vote No on USA"). Native markets all carry
        // direction='yes' as a column default and binary community
        // markets already encode the side in the entry label, so we
        // suppress the prefix everywhere else.
        const isCommunityMulti =
          position.market.marketType === "community" &&
          position.market.openMarketType === "multi";
        const directionPrefix =
          isCommunityMulti && bet.direction
            ? bet.direction === "no"
              ? "No on "
              : bet.direction === "yes"
                ? "Yes on "
                : ""
            : "";
        return (
          <div
            key={bet.betId}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm border",
              isWon && "bg-emerald-500/8 dark:bg-emerald-500/5 border-emerald-500/30",
              isLost && "bg-background/40 border-border/40 opacity-90",
              isRefund && "bg-muted/30 border-border/40",
              !isWon && !isLost && !isRefund && "bg-background/40 border-border/40",
            )}
            data-testid={`row-my-position-result-${bet.betId}`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span
                className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide",
                  isWon && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
                  isLost && "bg-red-500/15 text-red-700 dark:text-red-300",
                  isRefund && "bg-muted text-muted-foreground",
                  !isWon && !isLost && !isRefund && "bg-muted text-muted-foreground",
                )}
              >
                {isWon ? "Won" : isLost ? "Lost" : isRefund ? "Refund" : status}
              </span>
              <span className="text-sm font-medium truncate">
                {directionPrefix}
                {titleLabel}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 text-right">
              <span className="block">
                Stake {formatVox(stake)}
                {(isWon || isLost) && (
                  <span className="ml-1 opacity-70">→ {formatVox(payout)}</span>
                )}
              </span>
              {(isWon || isLost) && (
                <span
                  className={cn(
                    "block font-mono",
                    profit > 0 && "text-emerald-600 dark:text-emerald-400",
                    profit < 0 && "text-red-600 dark:text-red-400",
                    profit === 0 && "text-muted-foreground",
                  )}
                >
                  Net {signedProfit}
                </span>
              )}
            </span>
          </div>
        );
      })}
      {isVoid && (
        <p className="text-[11px] text-muted-foreground italic pt-1">
          Market voided — your stake was refunded.
        </p>
      )}
    </div>
  );
}

// ---------- Body variants ----------

function JackpotBody({ position }: { position: MyPositionResponse }) {
  const current = position.currentScore;

  // Sort tickets by closeness to current score (best chance first)
  // when we have a current score to compare against. Falls back to
  // newest-first (the API's default order) otherwise.
  const sorted = useMemo(() => {
    if (current == null) return position.bets;
    return [...position.bets].sort((a, b) => {
      const ad = a.predictedScore != null ? Math.abs(a.predictedScore - current) : Infinity;
      const bd = b.predictedScore != null ? Math.abs(b.predictedScore - current) : Infinity;
      return ad - bd;
    });
  }, [position.bets, current]);

  return (
    <div className="space-y-1.5">
      {sorted.map((bet, idx) => {
        const score = bet.predictedScore;
        const offBy = score != null && current != null ? Math.abs(score - current) : null;
        const direction = score != null && current != null ? Math.sign(score - current) : 0;
        const isClosest = idx === 0 && current != null;

        return (
          <div
            key={bet.betId}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm",
              isClosest
                ? "bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/30"
                : "bg-background/40 border border-border/40",
            )}
            data-testid={`row-jackpot-ticket-${bet.betId}`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              {isClosest ? (
                <Crown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <Trophy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="font-mono font-semibold tabular-nums">
                {score != null ? score.toLocaleString("en-US") : "—"}
              </span>
              {offBy != null && (
                <span
                  className={cn(
                    "text-[10px] tabular-nums px-1.5 py-0.5 rounded font-medium",
                    direction === 0 && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
                    direction !== 0 && isClosest && "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                    direction !== 0 && !isClosest && "bg-muted/60 text-muted-foreground",
                  )}
                  title={
                    direction === 0
                      ? "Exact match with current score"
                      : direction > 0
                        ? `Predicted ${Math.round(offBy).toLocaleString("en-US")} above current`
                        : `Predicted ${Math.round(offBy).toLocaleString("en-US")} below current`
                  }
                >
                  {direction === 0
                    ? "EXACT"
                    : `${direction > 0 ? "+" : "−"}${Math.round(offBy).toLocaleString("en-US")}`}
                </span>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
              {formatVox(bet.stakeAmount)} · {formatTimeAgo(bet.placedAt)}
            </span>
          </div>
        );
      })}
      {current != null && sorted.length > 1 && (
        <p className="text-[10px] text-muted-foreground pt-1 px-1 leading-snug">
          Sorted by distance from <span className="font-medium">today's</span> score. The winner is whoever's closest to the score at <span className="font-medium">Sunday's close</span> — these positions can shift before then.
        </p>
      )}
    </div>
  );
}

/**
 * Right-aligned payout column shared by UpDown / H2H / Race open
 * bodies. Every market routed through this card is AMM (the jackpot
 * has its own body) and each winning share pays exactly Ꝟ1 at
 * resolution. We just show "Payout if win" with no live-multiplier
 * or drift chips.
 */
function EstimatedPayoutColumn({ atEntryPayout }: { atEntryPayout: number }) {
  return (
    <div className="text-right shrink-0 min-w-[5.5rem]">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
        Payout if win
      </p>
      <p
        className="font-mono font-semibold text-sm tabular-nums text-violet-600 dark:text-violet-400 leading-tight mt-0.5"
        data-testid="text-my-position-amm-payout"
      >
        {formatVox(atEntryPayout)}
      </p>
      <p className="text-[10px] text-muted-foreground/70 leading-none mt-1">
        {CURRENCY.symbol}1 per share
      </p>
    </div>
  );
}

function UpDownBody({ position }: { position: MyPositionResponse }) {
  const bet = position.bets[0];
  if (!bet) return null;

  const pickLabel = (bet.entryLabel ?? "").toLowerCase();
  const isUp = pickLabel.includes("up");
  const isDown = pickLabel.includes("down");
  const pick = isUp ? "up" : isDown ? "down" : null;

  const current = position.currentScore;
  const baseline = position.market.baselineScore;
  const tieRule = position.market.tieRule ?? "refund";

  const state =
    pick != null && current != null && baseline != null
      ? getUpDownWinningState({
          pick,
          currentScore: current,
          baselineScore: baseline,
          tieRule,
        })
      : null;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold border",
            isUp && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
            isDown && "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40",
            !isUp && !isDown && "bg-muted text-muted-foreground border-border",
          )}
        >
          {isUp ? <ArrowUpRight className="h-3 w-3" /> : isDown ? <ArrowDownRight className="h-3 w-3" /> : null}
          You picked {bet.entryLabel ?? "—"}
        </span>
        {state != null && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              state === "winning" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
              state === "behind" && "border-red-500/40 text-red-700 dark:text-red-400",
              state === "tied" && "border-amber-500/40 text-amber-700 dark:text-amber-400",
            )}
          >
            {UP_DOWN_STATE_LABELS[state]}
          </Badge>
        )}
      </div>
      <EstimatedPayoutColumn atEntryPayout={bet.potentialPayout ?? 0} />
    </div>
  );
}

function H2HBody({ position }: { position: MyPositionResponse }) {
  const bet = position.bets[0];
  if (!bet) return null;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
          You picked
        </span>
        <span className="text-sm font-semibold truncate" data-testid="text-my-position-h2h-pick">
          {bet.entryLabel ?? "—"}
        </span>
      </div>
      <EstimatedPayoutColumn atEntryPayout={bet.potentialPayout ?? 0} />
    </div>
  );
}

function RaceBody({ position }: { position: MyPositionResponse }) {
  // Race detail page already renders a leaderboard with rank info, so
  // this body stays minimal — just confirm the pick + payout. The
  // parent's leaderboard answers "how am I doing right now".
  const bet = position.bets[0];
  if (!bet) return null;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
          Backing
        </span>
        <span className="text-sm font-semibold truncate" data-testid="text-my-position-race-pick">
          {bet.entryLabel ?? "—"}
        </span>
      </div>
      <EstimatedPayoutColumn atEntryPayout={bet.potentialPayout ?? 0} />
    </div>
  );
}

function GenericBody({ position }: { position: MyPositionResponse }) {
  // Yes/No badge is only meaningful for community-multi markets where
  // each entry has Polymarket-style Yes/No betting. For binary community
  // markets the entry label is already "Yes" or "No", so the badge would
  // double-print the side ("(YES) No" was the bug we're fixing).
  const showDirectionBadge =
    position.market.marketType === "community" &&
    position.market.openMarketType === "multi";

  return (
    <div className="space-y-1.5">
      {position.bets.map((bet) => {
        const isYes = bet.direction === "yes" || !bet.direction;
        return (
          <div
            key={bet.betId}
            className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm bg-background/40 border border-border/40"
          >
            <div className="flex items-center gap-2 min-w-0">
              {showDirectionBadge && (
                <span
                  className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                    isYes
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-red-500/15 text-red-700 dark:text-red-400",
                  )}
                >
                  {isYes ? "Yes" : "No"}
                </span>
              )}
              <span className="text-sm font-medium truncate">{bet.entryLabel ?? "—"}</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
              {formatVox(bet.stakeAmount)}
              {bet.potentialPayout != null && (
                <span className="opacity-70"> → {formatVox(bet.potentialPayout)}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Re-export the query key the parent should invalidate after placing
 * a new bet so the card refreshes immediately. Kept as a function so
 * we never typo the key shape across pages.
 */
export const myPositionQueryKey = (marketId: string) => ["/api/markets", marketId, "my-position"] as const;
