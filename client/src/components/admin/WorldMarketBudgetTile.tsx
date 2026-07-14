/**
 * World-market LLM daily budget tile.
 *
 * Live view over the per-process budget counter in
 * `server/agents/worldMarketBudget.ts`. Shows today's running spend
 * against the daily cap, plus reservation/release/block counters and
 * a clear amber state when the cap is exhausted.
 *
 * Purpose for the operator:
 *   - Confirm the safety rail is wired (counter ticks on real days
 *     when WORLD_MARKETS_LLM_ENABLED is on).
 *   - Spot a runaway TTL or short-horizon spike WHILE it's happening
 *     instead of finding out from the OpenAI billing dashboard next
 *     month.
 *   - See the daily exhaustion state at a glance — once the cap
 *     trips, every world-market agent decision abstains until UTC
 *     midnight, which can otherwise look like "agents aren't trading"
 *     in the absence of this tile.
 *
 * Auto-refreshes every 30s while the tab is open. PER-PROCESS counter:
 * the tile shows whatever the SERVING process saw, which on a
 * single-instance Railway deployment is the only process.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  PauseCircle,
  Wallet,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface BudgetResponse {
  dateUtc: string;
  spendUsd: number;
  callsReserved: number;
  callsReleased: number;
  callsBlocked: number;
  capUsd: number;
  remainingUsd: number;
  exhausted: boolean;
  flagEnabled: boolean;
  assessmentsEnabled?: boolean;
  perCallEstimateUsd: number;
}

function formatUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}

function formatPct(v: number): string {
  return `${v.toFixed(0)}%`;
}

export function WorldMarketBudgetTile() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<BudgetResponse>({
    queryKey: ["/api/admin/amm/world-market-budget"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/amm/world-market-budget");
      return res.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const usedPct = data && data.capUsd > 0 ? (data.spendUsd / data.capUsd) * 100 : 0;
  const successfulCalls = data ? data.callsReserved - data.callsReleased : 0;

  // Tone the progress bar by utilisation:
  //   < 50% used         → neutral (everything fine)
  //   50% <= used < 90%  → green tint (active, on track)
  //   90% <= used < 100% → amber (close to cap)
  //   exhausted          → red
  const progressTone = !data
    ? "bg-muted"
    : data.exhausted
    ? "bg-rose-500"
    : usedPct >= 90
    ? "bg-amber-500"
    : usedPct >= 50
    ? "bg-emerald-500"
    : "bg-violet-500";

  return (
    <Card data-testid="world-market-budget-tile">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-violet-500" />
            <CardTitle>World-market LLM budget</CardTitle>
          </div>
          {data ? (
            !data.flagEnabled ? (
              <Badge
                variant="outline"
                className="border-muted-foreground/30 text-muted-foreground"
                data-testid="badge-budget-flag-off"
              >
                Flag off
              </Badge>
            ) : data.assessmentsEnabled === false ? (
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                data-testid="badge-budget-assessments-off"
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Anchor only
              </Badge>
            ) : data.exhausted ? (
              <Badge
                variant="outline"
                className="border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10"
                data-testid="badge-budget-exhausted"
              >
                <PauseCircle className="h-3 w-3 mr-1" />
                Cap reached
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                data-testid="badge-budget-active"
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Active
              </Badge>
            )
          ) : null}
        </div>
        <CardDescription>
          Per-process safety rail on world-market OpenAI spend. Resets at
          UTC midnight. The cap only blocks NEW LLM calls — cached
          assessments continue to serve normally. Raise the cap via
          Railway env <span className="font-mono text-xs">WORLD_MARKETS_DAILY_BUDGET_USD</span>{" "}
          once steady-state cost is understood.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data ? (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
            <p className="font-medium text-rose-600 dark:text-rose-400">
              Failed to load budget snapshot
            </p>
            <button
              className="mt-2 text-xs underline"
              onClick={() => refetch()}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {!data.flagEnabled ? (
              <div className="rounded-md border border-muted-foreground/20 bg-muted/30 p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  World-market agents are disabled.
                </span>{" "}
                Agents abstain from world markets entirely (except convergence/sell
                carve-outs); no OpenAI calls fire so the budget counter stays at $0.
                Numbers below will stay at zero until{" "}
                <span className="font-mono">WORLD_MARKETS_LLM_ENABLED=true</span>{" "}
                is set in Railway.
              </div>
            ) : data.assessmentsEnabled === false ? (
              <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  LLM assessments are off (anchor-only).
                </span>{" "}
                Scouted markets can still trade via source-anchor; manual/unanchored
                markets abstain. Budget should stay near $0 unless assessments are
                re-enabled. Controlled by{" "}
                <span className="font-mono">WORLD_MARKETS_LLM_ASSESSMENTS_ENABLED</span>.
              </div>
            ) : null}

            {/* Headline progress bar */}
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-2xl font-semibold tabular-nums"
                    data-testid="text-budget-spend"
                  >
                    {formatUsd(data.spendUsd)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    of {formatUsd(data.capUsd)}
                  </span>
                </div>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatPct(usedPct)} used
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full ${progressTone} transition-all`}
                  style={{ width: `${Math.min(100, usedPct)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                Remaining today: {formatUsd(data.remainingUsd)} · est.
                {" "}{formatUsd(data.perCallEstimateUsd)}/call
              </p>
            </div>

            {/* Counter grid */}
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-md border bg-card p-3">
                <p className="text-xs text-muted-foreground">Successful calls</p>
                <p
                  className="text-lg font-medium tabular-nums"
                  data-testid="text-budget-successful-calls"
                >
                  {successfulCalls}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {data.callsReserved} reserved · {data.callsReleased} released
                </p>
              </div>
              <div className="rounded-md border bg-card p-3">
                <p className="text-xs text-muted-foreground">Blocked today</p>
                <p
                  className={`text-lg font-medium tabular-nums ${
                    data.callsBlocked > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : ""
                  }`}
                  data-testid="text-budget-blocked-calls"
                >
                  {data.callsBlocked}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  refused at the cap boundary
                </p>
              </div>
              <div className="rounded-md border bg-card p-3">
                <p className="text-xs text-muted-foreground">UTC date</p>
                <p
                  className="text-lg font-medium tabular-nums"
                  data-testid="text-budget-utc-date"
                >
                  {data.dateUtc}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  resets at 00:00 UTC
                </p>
              </div>
            </div>

            {/* Exhausted callout */}
            {data.exhausted && data.flagEnabled && data.assessmentsEnabled !== false ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  Daily cap reached — new LLM assessments abstaining
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Fresh OpenAI assessments will abstain until the UTC day rolls
                  over. Source-anchor bets on scouted markets are unaffected by
                  this cap. Cached assessments still serve when assessments are
                  enabled. If this fires unexpectedly, check Railway logs for{" "}
                  <span className="font-mono">[WorldEngineBudget]</span>. Raise{" "}
                  <span className="font-mono">WORLD_MARKETS_DAILY_BUDGET_USD</span>{" "}
                  in Railway if steady-state cost has simply outgrown the
                  current cap.
                </p>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              {isFetching ? "refreshing\u2026" : "auto-refreshes every 30s"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
