/**
 * AMM operational health dashboard.
 *
 * Live view over `amm_health_check_runs` (populated by the in-process
 * scheduler in `server/index.ts` every 15 min, plus the cron endpoint and
 * the manual "Run now" button below). Sits next to the existing manual
 * financial-invariants `Health` sub-tab, which it does NOT replace —
 * different concern entirely:
 *
 *   - Health (existing): "are the books balanced right now?"  — manual,
 *     financial invariants (state vs bets math, settlement idempotency).
 *
 *   - Operations (this file): "is anything operationally wrong right now,
 *     and was anything wrong overnight?" — auto-refreshing, persisted,
 *     trend-aware. Surfaces every audit in `server/jobs/amm-health.ts`
 *     (orphan ledger, seed-return drift, stuck CLOSED_PENDING markets,
 *     negative credits, dup idempotency keys, agent pause, live
 *     convergence, calibration, and friends — the card list renders
 *     whatever the latest run returned, so new checks appear without
 *     touching this file).
 *
 * Three sections, top-to-bottom:
 *   1. Status header  — overall pill, last-run timestamp, source badge,
 *                       auto-refresh toggle, "Run now" button (rate-limited
 *                       to one call per 60s on the server).
 *   2. 24h trend      — one cell per persisted run, colour-coded by overall
 *                       status (green pass / amber warn / red fail), with a
 *                       hover tooltip showing the run's per-check breakdown.
 *                       Highest-leverage glance: "did anything go wrong
 *                       overnight?".
 *   3. Per-check cards — one card per audit on the latest run, with the
 *                       full `details` text and an expandable JSON drawer
 *                       for the affected-rows sample. Reuses the existing
 *                       Copy IDs button when sample rows carry `marketId`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Cloud,
  Copy,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { apiRequest, ApiError } from "@/lib/queryClient";

// ---------------------------------------------------------------------------
// API response shapes — mirror server/jobs/amm-health.ts + the three admin
// endpoints in server/routes.ts. Kept loose-typed where the server already
// stores JSONB so we don't double-validate every render.
// ---------------------------------------------------------------------------

type CheckStatus = "pass" | "warn" | "fail";

interface OperationalCheck {
  name: string;
  status: CheckStatus;
  details: string;
  rowCount?: number;
  sample?: Array<Record<string, unknown>>;
}

interface OperationalRun {
  id: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  total: number;
  passed: number;
  warned: number;
  failed: number;
  lookbackDays: number;
  source: "scheduler" | "cron" | "manual";
  triggeredBy: string | null;
  checks: OperationalCheck[];
  createdAt: string;
}

interface LatestResponse {
  run: OperationalRun | null;
}

interface HistoryRunSummary {
  id: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  total: number;
  passed: number;
  warned: number;
  failed: number;
  source: "scheduler" | "cron" | "manual";
}

interface HistoryResponse {
  hours: number;
  cutoff: string;
  runs: HistoryRunSummary[];
}

interface RunNowResponse {
  ok: boolean;
  result: OperationalRun;
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Polling cadence while the tab is mounted and visible. Matches the
// runbook's "every 15 min" scheduler cadence loosely — re-fetching every
// 60s means a fresh scheduler row appears on screen within at most a
// minute of being written, without hammering the DB.
const AUTO_REFRESH_INTERVAL_MS = 60_000;

// Trend strip window. The history endpoint clamps to [1, 168]; 24h gives
// 96 cells at the 15-min cadence — comfortably scannable.
const TREND_HOURS = 24;

// Empty-state poll cadence. Used only on first boot before the scheduler
// has ticked once (60s stagger).
const EMPTY_STATE_POLL_MS = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return "just now";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}

/**
 * Estimate when the next in-process scheduler tick will fire.
 *
 * Important subtlety: the scheduler ticks every 15 min on its own setInterval
 * clock (see server/index.ts), independent of any `manual` or `cron` runs.
 * Basing the estimate on `latest.startedAt` would lie whenever the latest
 * persisted run was a manual or cron one — so we look up the most recent
 * row whose `source==='scheduler'` instead and project from that.
 *
 * Returns "—" if we can't see a scheduler row in the trend window (e.g.
 * fresh deploy before the first tick, or scheduler disabled in serverless
 * mode where only cron runs land in the table).
 */
function nextSchedulerRunIn(history: HistoryResponse | undefined): string {
  if (!history) return "—";
  const lastScheduler = history.runs.find((r) => r.source === "scheduler");
  if (!lastScheduler) return "—";
  const next = new Date(lastScheduler.startedAt).getTime() + 15 * 60 * 1000;
  const ms = next - Date.now();
  if (ms <= 0) return "any moment";
  const min = Math.ceil(ms / 60_000);
  return `~${min} min`;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function classifyOverall(run: OperationalRun): "pass" | "warn" | "fail" {
  if (!run.ok) return "fail";
  if (run.warned > 0) return "warn";
  return "pass";
}

function classifyHistoryRun(run: HistoryRunSummary): "pass" | "warn" | "fail" {
  if (!run.ok) return "fail";
  if (run.warned > 0) return "warn";
  return "pass";
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);
  return visible;
}

function statusToneClass(status: "pass" | "warn" | "fail"): string {
  switch (status) {
    case "pass":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "warn":
      return "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10";
    case "fail":
      return "border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10";
  }
}

function checkToneClass(status: CheckStatus): string {
  switch (status) {
    case "pass":
      return "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5";
    case "warn":
      return "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5";
    case "fail":
      return "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5";
  }
}

function CheckIcon({ status, className = "h-4 w-4" }: { status: CheckStatus; className?: string }) {
  if (status === "pass") return <CheckCircle className={className} />;
  if (status === "warn") return <AlertTriangle className={className} />;
  return <XCircle className={className} />;
}

function SourceBadge({ source }: { source: "scheduler" | "cron" | "manual" }) {
  // Three distinct icons + colours so a glance at the badge is enough to know
  // which writer landed the run: in-process scheduler (Clock, violet),
  // external cron POSTed by Railway / GH Actions (Cloud, sky-blue), or a
  // human-clicked "Run now" (Zap, indigo).
  const map: Record<
    "scheduler" | "cron" | "manual",
    { label: string; cls: string; Icon: LucideIcon }
  > = {
    scheduler: {
      label: "SCHEDULER",
      cls: "border-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-500/10",
      Icon: Clock,
    },
    cron: {
      label: "CRON",
      cls: "border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10",
      Icon: Cloud,
    },
    manual: {
      label: "MANUAL",
      cls: "border-indigo-500/40 text-indigo-600 dark:text-indigo-400 bg-indigo-500/10",
      Icon: Zap,
    },
  };
  const m = map[source] ?? map.scheduler;
  return (
    <Badge variant="outline" className={`text-[10px] tracking-wider ${m.cls}`}>
      <m.Icon className="h-3 w-3 mr-1" />
      {m.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Trend strip — one cell per persisted run over the last 24h.
//
// Renders pure CSS, no chart lib. We get tighter hover semantics + better
// dark-mode behaviour than wrapping recharts around what is essentially a
// row of coloured rectangles.
// ---------------------------------------------------------------------------

function TrendStrip({ history }: { history: HistoryResponse | undefined }) {
  // Render a placeholder strip while loading so the layout doesn't jump.
  if (!history) {
    return (
      <div className="h-10 rounded-md bg-muted/40 animate-pulse" data-testid="trend-strip-loading" />
    );
  }

  // Server returns most-recent-first; the strip reads left-to-right as
  // oldest-to-newest, so reverse before mapping.
  const cells = [...history.runs].reverse();

  if (cells.length === 0) {
    return (
      <div
        className="h-10 rounded-md border border-dashed border-muted-foreground/30 flex items-center justify-center text-xs text-muted-foreground"
        data-testid="trend-strip-empty"
      >
        No runs in the last {history.hours}h yet — the scheduler will start writing rows within 60s of boot.
      </div>
    );
  }

  return (
    <div
      className="flex gap-[2px] h-10 rounded-md overflow-hidden bg-muted/30 p-[2px]"
      data-testid="trend-strip"
      role="group"
      aria-label={`AMM operational health, last ${history.hours} hours, ${cells.length} runs`}
    >
      {cells.map((run) => {
        const cls = classifyHistoryRun(run);
        const colour =
          cls === "pass"
            ? "bg-emerald-500/70 hover:bg-emerald-500"
            : cls === "warn"
              ? "bg-amber-500/70 hover:bg-amber-500"
              : "bg-rose-500/80 hover:bg-rose-500";
        const tooltip = [
          formatTimestamp(run.startedAt),
          `${run.passed} pass · ${run.warned} warn · ${run.failed} fail`,
          `source: ${run.source}`,
          `${run.durationMs}ms`,
        ].join("\n");
        return (
          <div
            key={run.id}
            className={`flex-1 min-w-[3px] rounded-[2px] cursor-help transition-colors ${colour}`}
            title={tooltip}
            data-testid={`trend-cell-${cls}`}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-check card — one card per audit on the latest run.
// ---------------------------------------------------------------------------

function copyMarketIdsFromSample(sample: Array<Record<string, unknown>>) {
  const ids = sample
    .map((row) => {
      if (typeof row.marketId === "string") return row.marketId;
      if (typeof row.id === "string") return row.id;
      if (typeof row.market_id === "string") return row.market_id as string;
      return null;
    })
    .filter((s): s is string => !!s);
  if (ids.length === 0) {
    toast("No market IDs in this check");
    return;
  }
  void navigator.clipboard.writeText(ids.join("\n")).then(() => {
    toast("Copied", {
      description: `${ids.length} market ID${ids.length === 1 ? "" : "s"} copied`,
    });
  });
}

function PerCheckCard({ check }: { check: OperationalCheck }) {
  const tone = checkToneClass(check.status);
  const sample = check.sample ?? [];
  const sampleHasMarketIds = sample.some(
    (row) =>
      typeof row.marketId === "string" ||
      typeof row.id === "string" ||
      typeof row.market_id === "string",
  );

  return (
    <Card
      className={tone}
      data-testid={`ops-check-${check.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-start gap-2 min-w-0">
            <CheckIcon status={check.status} className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium text-sm flex items-center gap-2 flex-wrap">
                {check.name}
                {check.rowCount !== undefined && check.rowCount > 0 ? (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {check.rowCount} row{check.rowCount === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{check.details}</p>
            </div>
          </div>
          {sample.length > 0 && sampleHasMarketIds ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyMarketIdsFromSample(sample)}
              data-testid={`button-copy-${check.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy IDs
            </Button>
          ) : null}
        </div>
        {sample.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground select-none">
              View {sample.length} sample row{sample.length === 1 ? "" : "s"}
            </summary>
            <pre className="text-[11px] mt-2 p-2 rounded-md bg-muted/40 overflow-x-auto max-h-64">
              {JSON.stringify(sample, null, 2)}
            </pre>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function AmmOperationsTab() {
  const queryClient = useQueryClient();
  const visible = useDocumentVisible();
  const [autoRefresh, setAutoRefresh] = useState(true);
  // Bumps once per second so the "X min ago" caption ticks without
  // hitting the network. Cheap; only mounted while the tab is open.
  const [, setNowTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = setInterval(() => setNowTick((n) => (n + 1) % 1_000), 1_000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [visible]);

  // Latest single run — drives the status header + per-check cards.
  // While in the empty-state (`run === null` from a fresh deploy), we
  // poll faster (5s) so the UI catches the first scheduler tick quickly.
  const latestQuery = useQuery<LatestResponse>({
    queryKey: ["/api/admin/amm/operational-health/latest"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/amm/operational-health/latest");
      return res.json();
    },
    refetchInterval: visible && autoRefresh
      ? (q) => {
          const data = q.state.data as LatestResponse | undefined;
          return data?.run ? AUTO_REFRESH_INTERVAL_MS : EMPTY_STATE_POLL_MS;
        }
      : false,
    refetchOnWindowFocus: false,
  });

  // 24h trend strip. Same auto-refresh cadence as the latest endpoint;
  // both queries share the queryClient cache, so a manual "Run now"
  // invalidates both at once below.
  const historyQuery = useQuery<HistoryResponse>({
    queryKey: ["/api/admin/amm/operational-health/history", TREND_HOURS],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/amm/operational-health/history?hours=${TREND_HOURS}`);
      return res.json();
    },
    refetchInterval: visible && autoRefresh ? AUTO_REFRESH_INTERVAL_MS : false,
    refetchOnWindowFocus: false,
  });

  const runNowMutation = useMutation<RunNowResponse>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/amm/operational-health/run");
      const json = (await res.json()) as RunNowResponse;
      return json;
    },
    onSuccess: (data) => {
      // Both queries depend on amm_health_check_runs, and the new row is
      // already inserted by the time this resolves. Invalidate both so
      // the user sees the run they just triggered without waiting for
      // the auto-refresh tick.
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/amm/operational-health/latest"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/amm/operational-health/history", TREND_HOURS] });
      toast(data.ok ? "Health check passed" : "Health check found issues", {
        description: `${data.result.passed} pass · ${data.result.warned} warn · ${data.result.failed} fail · ${data.result.durationMs}ms`,
      });
    },
    onError: (err: unknown) => {
      // Server returns a 429 + Retry-After header + structured JSON body for
      // the 60s manual-run cooldown. Branch off the typed `ApiError.status`
      // (more reliable than scraping the message) and surface the exact
      // wait-time the server prescribed instead of a generic "wait a minute".
      if (err instanceof ApiError && err.status === 429) {
        const seconds = err.retryAfter ?? 60;
        toast("Rate limited", {
          description: `Please wait ${seconds}s before re-running. The 15-min scheduler covers regular monitoring.`,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      toast("Run failed", { description: msg });
    },
  });

  const latest = latestQuery.data?.run ?? null;
  const overall = latest ? classifyOverall(latest) : null;
  const history = historyQuery.data;

  const sortedChecks = useMemo<OperationalCheck[]>(() => {
    if (!latest) return [];
    // Failures first, then warnings, then passes — admins should see
    // what's red before they see what's green.
    const order: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2 };
    return [...latest.checks].sort((a, b) => order[a.status] - order[b.status]);
  }, [latest]);

  return (
    <div className="space-y-4" data-testid="amm-operations-tab">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-violet-500" />
            AMM operational health
          </CardTitle>
          <CardDescription>
            Live view of the in-process health-check scheduler, run every 15 minutes: orphan
            ledger rows, seed-return drift, stuck markets, negative Vox, duplicate idempotency
            keys, agent pause state, live convergence, calibration, and more — one card per
            audit below. See the AMM Monitoring Runbook for the failure-mode playbook.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status header */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              {latest && overall ? (
                <>
                  <Badge variant="outline" className={`text-sm ${statusToneClass(overall)}`} data-testid="ops-overall-badge">
                    <CheckIcon status={overall} className="h-3.5 w-3.5 mr-1.5" />
                    {overall === "pass"
                      ? "ALL CLEAR"
                      : overall === "warn"
                        ? "PASS WITH WARNINGS"
                        : "FAILING"}
                  </Badge>
                  <span className="text-sm text-muted-foreground" data-testid="ops-summary-counts">
                    {latest.passed} pass · {latest.warned} warn · {latest.failed} fail
                  </span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground" title={formatTimestamp(latest.startedAt)} data-testid="ops-relative-time">
                    {relativeTime(latest.startedAt)}
                  </span>
                  <SourceBadge source={latest.source} />
                </>
              ) : latestQuery.isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading latest run…</span>
                </>
              ) : (
                <>
                  <Badge variant="outline" className="text-sm border-dashed">
                    <Clock className="h-3.5 w-3.5 mr-1.5" />
                    Initialising
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Waiting for the first scheduler tick (within ~60s of boot).
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch
                  id="ops-auto-refresh"
                  checked={autoRefresh}
                  onCheckedChange={setAutoRefresh}
                  data-testid="switch-auto-refresh"
                />
                <Label htmlFor="ops-auto-refresh" className="text-xs text-muted-foreground cursor-pointer">
                  Auto-refresh
                </Label>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => runNowMutation.mutate()}
                disabled={runNowMutation.isPending}
                data-testid="button-ops-run-now"
              >
                {runNowMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Run now
              </Button>
            </div>
          </div>

          {latest ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="rounded-md bg-muted/30 px-3 py-2">
                <div className="text-muted-foreground">Total checks</div>
                <div className="text-base font-semibold mt-0.5">{latest.total}</div>
              </div>
              <div className="rounded-md bg-muted/30 px-3 py-2">
                <div className="text-muted-foreground">Last run duration</div>
                <div className="text-base font-semibold mt-0.5">{latest.durationMs} ms</div>
              </div>
              <div className="rounded-md bg-muted/30 px-3 py-2">
                <div className="text-muted-foreground">Lookback window</div>
                <div className="text-base font-semibold mt-0.5">{latest.lookbackDays}d</div>
              </div>
              <div
                className="rounded-md bg-muted/30 px-3 py-2"
                title="Projected from the most recent SCHEDULER row in the trend window. Manual / cron runs do not affect this estimate."
              >
                <div className="text-muted-foreground">Next scheduler run</div>
                <div className="text-base font-semibold mt-0.5">
                  {nextSchedulerRunIn(history)}
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* 24h trend strip */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-violet-500" />
            Last {TREND_HOURS}h
          </CardTitle>
          <CardDescription className="text-xs">
            One cell per persisted run. Hover for per-run breakdown. Green = clean pass,
            amber = pass with warnings, red = failing checks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <TrendStrip history={history} />
          {history && history.runs.length > 0 ? (
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span data-testid="trend-count">
                {history.runs.length} run{history.runs.length === 1 ? "" : "s"} in window
              </span>
              <span className="flex items-center gap-3">
                <TrendLegend tone="pass" label="pass" />
                <TrendLegend tone="warn" label="warn" />
                <TrendLegend tone="fail" label="fail" />
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Per-check cards */}
      {latest ? (
        <div className="space-y-3" data-testid="ops-check-list">
          <h3 className="text-sm font-semibold text-muted-foreground tracking-wide uppercase">
            Latest checks
          </h3>
          {sortedChecks.map((c) => (
            <PerCheckCard key={c.name} check={c} />
          ))}
        </div>
      ) : !latestQuery.isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <Clock className="h-5 w-5 mx-auto mb-2 opacity-60" />
            No persisted runs yet. The first scheduler tick lands within ~60 seconds of server
            boot — this view will populate automatically. You can also click <strong>Run now</strong>
            above to trigger an audit immediately.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function TrendLegend({ tone, label }: { tone: "pass" | "warn" | "fail"; label: string }) {
  const colour =
    tone === "pass"
      ? "bg-emerald-500/70"
      : tone === "warn"
        ? "bg-amber-500/70"
        : "bg-rose-500/80";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-sm ${colour}`} />
      {label}
    </span>
  );
}
