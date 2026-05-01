import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Crown,
  Loader2,
  Plus,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { formatTimeAgo } from "@/lib/formatDate";

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
    status: string;
    slug: string | null;
    title: string;
    baselineScore: number | null;
    startAt: string | null;
    endAt: string | null;
    closeAt: string | null;
    personId: string | null;
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
   * Click handler for the per-kind primary CTA. Parent owns the
   * actual flow (opens StakeModal / focuses jackpot input / etc.) so
   * this card stays presentational.
   */
  onAddEntry?: () => void;
  /** Override the default CTA label per page if needed. */
  ctaLabel?: string;
  /** Hide the CTA entirely (e.g. resolved markets). */
  hideCta?: boolean;
  className?: string;
}

const FRESH_INTERVAL_MS = 60_000;

export function MyPositionCard({
  marketId,
  marketType: marketTypeHint,
  onAddEntry,
  ctaLabel,
  hideCta,
  className,
}: MyPositionCardProps) {
  const { isLoggedIn } = useAuth();

  const { data, isLoading, isError } = useQuery<MyPositionResponse>({
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
  if (isLoading) {
    return (
      <Card className={cn("p-4 mb-4 border-border/40 bg-muted/5", className)}>
        <div className="flex items-center gap-3 mb-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }

  const position = data;
  if (!position || position.betCount === 0) return null;

  const marketType = marketTypeHint ?? position.market.marketType;
  const isOpen = position.market.status === "OPEN";
  const showCta = !hideCta && isOpen && onAddEntry;

  return (
    <Card
      className={cn(
        "p-4 mb-4 border-violet-500/30 dark:border-violet-500/20 bg-violet-500/5 dark:bg-violet-500/[0.04]",
        className,
      )}
      data-testid="card-my-position"
    >
      {/* Header: live score + delta */}
      <PositionHeader
        currentScore={position.currentScore}
        baselineScore={position.market.baselineScore}
        marketType={marketType}
        betCount={position.betCount}
        totalStake={position.totalStake}
      />

      {/* Body: per-kind details */}
      <div className="mt-4">
        {marketType === "jackpot" ? (
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
  currentScore: number | null;
  baselineScore: number | null;
  marketType: string;
  betCount: number;
  totalStake: number;
}

function PositionHeader({
  currentScore,
  baselineScore,
  marketType,
  betCount,
  totalStake,
}: PositionHeaderProps) {
  const showScore = currentScore != null && marketType !== "race" && marketType !== "gainer";
  const delta = showScore && baselineScore != null && currentScore != null
    ? currentScore - baselineScore
    : null;
  const pctDelta = delta != null && baselineScore != null && baselineScore !== 0
    ? (delta / baselineScore) * 100
    : null;
  const isUp = delta != null && delta > 0;
  const isDown = delta != null && delta < 0;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-full bg-violet-500/15 dark:bg-violet-500/10 border border-violet-500/40 dark:border-violet-500/30 flex items-center justify-center shrink-0">
          <Target className="h-5 w-5 text-violet-700 dark:text-violet-400" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm">Your Position</h3>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono leading-none">
              {betCount} {betCount === 1 ? "entry" : "entries"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            <Wallet className="h-3 w-3 inline-block mr-1" />
            <span className="font-mono tabular-nums">{totalStake.toLocaleString("en-US")}</span> credits staked
          </p>
        </div>
      </div>

      {showScore && (
        <div className="text-right shrink-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Current</p>
          <p className="font-mono font-bold text-base tabular-nums">
            {currentScore!.toLocaleString("en-US")}
          </p>
          {delta != null && pctDelta != null && (
            <p
              className={cn(
                "text-[11px] font-medium tabular-nums inline-flex items-center gap-0.5",
                isUp && "text-emerald-600 dark:text-emerald-400",
                isDown && "text-red-600 dark:text-red-400",
                !isUp && !isDown && "text-muted-foreground",
              )}
            >
              {isUp ? (
                <TrendingUp className="h-3 w-3" />
              ) : isDown ? (
                <TrendingDown className="h-3 w-3" />
              ) : (
                <Activity className="h-3 w-3" />
              )}
              {delta > 0 ? "+" : ""}
              {Math.round(delta).toLocaleString("en-US")}
              {Number.isFinite(pctDelta) && Math.abs(pctDelta) >= 0.1 && (
                <span className="opacity-70">
                  ({pctDelta > 0 ? "+" : ""}
                  {pctDelta.toFixed(1)}%)
                </span>
              )}
            </p>
          )}
        </div>
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
            <div className="flex items-center gap-2 min-w-0">
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
                    "text-[10px] tabular-nums px-1.5 py-0.5 rounded",
                    isClosest && "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                    !isClosest && "bg-muted/60 text-muted-foreground",
                  )}
                >
                  {direction === 0 ? "EXACT" : direction > 0 ? "+" : "−"}
                  {Math.round(offBy).toLocaleString("en-US")}
                </span>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
              {bet.stakeAmount.toLocaleString("en-US")} cr · {formatTimeAgo(bet.placedAt)}
            </span>
          </div>
        );
      })}
      {current != null && sorted.length > 1 && (
        <p className="text-[10px] text-muted-foreground pt-1 px-1">
          Tickets sorted by closeness to current score. Closest wins on Sunday.
        </p>
      )}
    </div>
  );
}

function UpDownBody({ position }: { position: MyPositionResponse }) {
  const bet = position.bets[0];
  if (!bet) return null;

  const pickLabel = (bet.entryLabel ?? "").toLowerCase();
  const isUp = pickLabel.includes("up");
  const isDown = pickLabel.includes("down");

  const current = position.currentScore;
  const baseline = position.market.baselineScore;
  const delta = current != null && baseline != null ? current - baseline : null;
  const isWinning =
    delta != null
      ? (isUp && delta > 0) || (isDown && delta < 0)
      : null;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
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
        {isWinning != null && delta != null && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              isWinning ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : "border-red-500/40 text-red-700 dark:text-red-400",
            )}
          >
            {isWinning ? "Winning" : "Behind"}
          </Badge>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">If correct</p>
        <p className="font-mono font-semibold text-sm tabular-nums">
          {(bet.potentialPayout ?? 0).toLocaleString("en-US")}
        </p>
      </div>
    </div>
  );
}

function H2HBody({ position }: { position: MyPositionResponse }) {
  const bet = position.bets[0];
  if (!bet) return null;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-xs text-muted-foreground">You picked</span>
        <span className="text-sm font-semibold truncate" data-testid="text-my-position-h2h-pick">
          {bet.entryLabel ?? "—"}
        </span>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">If correct</p>
        <p className="font-mono font-semibold text-sm tabular-nums">
          {(bet.potentialPayout ?? 0).toLocaleString("en-US")}
        </p>
      </div>
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
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-xs text-muted-foreground">Backing</span>
        <span className="text-sm font-semibold truncate" data-testid="text-my-position-race-pick">
          {bet.entryLabel ?? "—"}
        </span>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">If correct</p>
        <p className="font-mono font-semibold text-sm tabular-nums">
          {(bet.potentialPayout ?? 0).toLocaleString("en-US")}
        </p>
      </div>
    </div>
  );
}

function GenericBody({ position }: { position: MyPositionResponse }) {
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
              <span className="text-sm font-medium truncate">{bet.entryLabel ?? "—"}</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
              {bet.stakeAmount.toLocaleString("en-US")} cr
              {bet.potentialPayout != null && (
                <span className="opacity-70"> → {bet.potentialPayout.toLocaleString("en-US")}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Tiny helper for parents that want to know whether MyPositionCard
 * rendered (so they can hide their own legacy "your prediction" pills
 * to avoid duplication). Reuses the same query under the hood.
 */
export function useHasMyPosition(marketId: string | undefined): boolean {
  const { isLoggedIn } = useAuth();
  const { data } = useQuery<MyPositionResponse>({
    queryKey: ["/api/markets", marketId, "my-position"],
    enabled: !!marketId && isLoggedIn,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/markets/${marketId}/my-position`);
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });
  return (data?.betCount ?? 0) > 0;
}

/**
 * Re-export the query key the parent should invalidate after placing
 * a new bet so the card refreshes immediately.
 */
export const myPositionQueryKey = (marketId: string) => ["/api/markets", marketId, "my-position"] as const;
