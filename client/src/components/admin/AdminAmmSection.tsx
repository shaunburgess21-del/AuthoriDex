/**
 * Phase 5 AMM admin dashboard.
 *
 * Four sub-tabs:
 *   - Overview: house wallet stats + cooldown settings panel
 *   - Markets: paginated table of every AMM market with expandable
 *              per-entry inspector + Resolve/Void action
 *   - Trades:  paginated feed of every AMM buy/sell with agent/house
 *              badges
 *   - Health:  on-demand audit runner that surfaces drift between
 *              market_amm_state, market_bets, and credit_ledger
 *
 * All five `/api/admin/amm/*` GET endpoints are read-only; the only
 * mutations are the cooldown setter (existing) and the Resolve/Void
 * paths reused via the shared `AmmResolutionDialog`.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  Gauge,
  Gavel,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { AmmResolutionDialog, type ResolvableMarket } from "./AmmResolutionDialog";
import { AmmOperationsTab } from "./AmmOperationsTab";
import { PersonaPnlTile } from "./PersonaPnlTile";

// ---------------------------------------------------------------------------
// API response shapes (mirroring server/routes.ts)
// ---------------------------------------------------------------------------

interface HouseSnapshot {
  houseProfileId: string;
  houseBalance: number;
  ledgerSum: number;
  ledgerReconciliation: { profileCredits: number; ledgerSum: number; drift: number; ok: boolean };
  aggregates: {
    initialGrant: number;
    totalSeeded: number;
    /** Lifetime warm-start outflow (0 until WARM_START_PRIORS_ENABLED flips on). */
    totalWarmStartCost: number;
    /**
     * Lifetime warm-start INFLOW — house's warm-bought shares that won
     * at resolution. Pairs with `totalWarmStartCost` so a future tile
     * can show net warm-start P&L. Reads 0 until the first warm-started
     * market resolves with the warmed side as the winner.
     */
    totalWarmStartPayout: number;
    totalSettledCredits: number;
    totalPaidOut: number;
    totalRefunded: number;
  };
  openMarkets: { count: number; totalSeedExposure: number; totalUserCreditsIn: number };
  resolvedMarkets: {
    count: number;
    totalSeedDebited: number;
    totalSettleCredited: number;
    realisedPnl: number;
  };
}

interface CooldownSettings {
  preResolveCooldownMs: number;
  updatedAt: string;
  updatedBy: string | null;
  bounds: { defaultMs: number; minMs: number; maxMs: number };
}

interface AmmMarketRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  marketType: string;
  openMarketType: string | null;
  visibility: string | null;
  startAt: string | null;
  endAt: string | null;
  closeAt: string | null;
  resolvedAt: string | null;
  liquidityB: number;
  outcomeOrder: string[];
  shareQuantities: Record<string, number>;
  prices: Record<string, number>;
  houseSeedAmount: number;
  totalUserCreditsIn: number;
  maxPayoutLiability: number;
  traderCount: number;
  tradeCount: number;
  totalVolume: number;
  stateUpdatedAt: string | null;
  /** Phase 5 polish: entries are denormalized into the listing so the
   *  Resolve modal can render without a second round-trip. */
  entries: Array<{ id: string; label: string; displayOrder: number; resolutionStatus: string }>;
}

interface AmmMarketsList {
  markets: AmmMarketRow[];
  total: number;
  limit: number;
  offset: number;
}

interface AmmMarketDetail {
  market: {
    id: string;
    slug: string;
    title: string;
    status: string;
    marketType: string;
    openMarketType: string | null;
    visibility: string | null;
    engine: string;
    startAt: string | null;
    endAt: string | null;
    closeAt: string | null;
    resolvedAt: string | null;
    voidReason: string | null;
    settledBy: string | null;
    resolutionNotes: string | null;
  };
  ammState: {
    liquidityB: number;
    outcomeOrder: string[];
    shareQuantities: Record<string, number>;
    houseSeedAmount: number;
    totalUserCreditsIn: number;
    prices: Record<string, number>;
    stateUpdatedAt: string | null;
  };
  entries: Array<{
    entryId: string;
    label: string | null;
    displayOrder: number;
    resolutionStatus: string | null;
    q: number;
    price: number;
    payoutLiabilityIfWinner: number;
    projectedHousePnlIfWinner: number;
  }>;
  trades: { traderCount: number; tradeCount: number; totalVolume: number };
  houseProjections: { expectedHousePnl: number; maxPayoutLiability: number };
}

interface AmmTrade {
  id: string;
  createdAt: string | null;
  userId: string;
  username: string | null;
  isAgent: boolean;
  isHouse: boolean;
  marketId: string;
  marketSlug: string;
  marketTitle: string;
  marketType: string;
  entryId: string;
  entryLabel: string;
  actionType: "buy" | "sell" | string;
  shareCount: number | null;
  stakeAmount: number;
  pricePerShare: number | null;
  status: string;
}

interface AmmTradesFeed {
  trades: AmmTrade[];
  total: number;
  limit: number;
  offset: number;
}

interface AmmHealthCheck {
  check: string;
  severity: "ok" | "warn" | "error";
  message: string;
  affected: Array<Record<string, unknown>>;
}

interface AmmHealthReport {
  overall: "ok" | "warn" | "error";
  checkedAt: string;
  ammMarketCount: number;
  tolerances: { shares: number; credits: number };
  checks: AmmHealthCheck[];
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

/**
 * Pause polling intervals when the tab is hidden. Mirrors the pattern
 * used in `AdminSettlementCenter` so background admin sessions don't
 * keep hitting the DB.
 */
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

function formatCredits(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  return sign + abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatCreditsAbs(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "0";
  return Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    OPEN: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    CLOSED_PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    RESOLVED: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
    VOID: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  };
  return (
    <Badge variant="outline" className={`text-xs ${map[status] || ""}`}>
      {status}
    </Badge>
  );
}

function MarketTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    jackpot: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    community: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    updown: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    h2h: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    gainer: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
    race: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  };
  return (
    <Badge variant="outline" className={`text-xs border-0 ${colors[type] || ""}`}>
      {type === "h2h" ? "H2H" : type === "updown" ? "Up/Down" : type.charAt(0).toUpperCase() + type.slice(1)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Overview sub-tab
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  testId,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  testId?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-rose-600 dark:text-rose-400"
          : "";
  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-3">
        <div className="p-2 rounded-md bg-violet-500/15">
          <Icon className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="min-w-0">
          <p className={`text-2xl font-bold tabular-nums ${toneClass}`} data-testid={testId}>{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {hint && <p className="text-[11px] text-muted-foreground/80 mt-0.5">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewTab() {
  const queryClient = useQueryClient();
  const isVisible = useDocumentVisible();

  const { data: house, isLoading: houseLoading } = useQuery<HouseSnapshot>({
    queryKey: ["/api/admin/amm/house"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/amm/house");
      return res.json();
    },
    refetchInterval: isVisible ? 30_000 : false,
    refetchOnWindowFocus: false,
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<CooldownSettings>({
    queryKey: ["/api/admin/amm/settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/amm/settings");
      return res.json();
    },
  });

  const [cooldownInput, setCooldownInput] = useState<string>("");
  useEffect(() => {
    if (settings && cooldownInput === "") {
      setCooldownInput(String(Math.round(settings.preResolveCooldownMs / 1000)));
    }
  }, [settings, cooldownInput]);

  const cooldownMutation = useMutation({
    mutationFn: async (seconds: number) => {
      const res = await apiRequest("POST", "/api/admin/amm/settings", {
        preResolveCooldownMs: Math.round(seconds * 1000),
      });
      return res.json();
    },
    onSuccess: (data: { clamped?: boolean; preResolveCooldownMs: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/amm/settings"] });
      const seconds = Math.round(data.preResolveCooldownMs / 1000);
      toast(
        data.clamped ? "Cooldown clamped to bounds" : "Cooldown updated",
        { description: `Pre-resolve cooldown is now ${seconds}s` },
      );
    },
    onError: (err: Error) => {
      toast.error("Update failed", { description: err.message });
    },
  });

  if (houseLoading || !house) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const reconcileTone = house.ledgerReconciliation.ok ? "good" : "bad";
  const realisedTone = house.resolvedMarkets.realisedPnl >= 0 ? "good" : "bad";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          icon={Landmark}
          label="House balance (virtual credits)"
          value={formatCredits(house.houseBalance)}
          hint={`Initial grant: ${formatCredits(house.aggregates.initialGrant)}`}
          testId="stat-house-balance"
        />
        <StatCard
          icon={house.resolvedMarkets.realisedPnl >= 0 ? TrendingUp : TrendingDown}
          label="Realised P&L"
          value={formatCredits(house.resolvedMarkets.realisedPnl)}
          hint={`Across ${house.resolvedMarkets.count} resolved/void markets`}
          tone={realisedTone}
          testId="stat-realised-pnl"
        />
        <StatCard
          icon={Coins}
          label="Open seed exposure"
          value={formatCredits(house.openMarkets.totalSeedExposure)}
          hint={`${house.openMarkets.count} live markets · ${formatCredits(house.openMarkets.totalUserCreditsIn)} user credits in`}
          testId="stat-open-exposure"
        />
        <StatCard
          icon={ShieldCheck}
          label="Ledger reconciliation"
          value={house.ledgerReconciliation.ok ? "OK" : `Drift ${formatCredits(house.ledgerReconciliation.drift)}`}
          hint={`profile=${formatCredits(house.ledgerReconciliation.profileCredits)} · ledger=${formatCredits(house.ledgerReconciliation.ledgerSum)}`}
          tone={reconcileTone}
          testId="stat-reconcile"
        />
        <StatCard
          icon={TrendingUp}
          label="Total seeded (lifetime)"
          value={formatCredits(house.aggregates.totalSeeded)}
          hint={`Settle credits: ${formatCredits(house.aggregates.totalSettledCredits)}`}
          testId="stat-total-seeded"
        />
        <StatCard
          icon={Activity}
          label="Open AMM markets"
          value={String(house.openMarkets.count)}
          hint={`${house.resolvedMarkets.count} resolved · ${formatCredits(house.openMarkets.totalUserCreditsIn)} credits flowing`}
          testId="stat-open-count"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-violet-500" />
            Pre-resolve cooldown
          </CardTitle>
          <CardDescription>
            How many seconds before <span className="font-mono">endAt</span> betting
            stops on AMM markets, so users can&apos;t snipe the resolution. Defaults to
            5 minutes; can be raised once we observe how late-hour trading behaves
            with agents live.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settingsLoading || !settings ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-sm font-medium">Cooldown (seconds)</label>
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={cooldownInput}
                    onChange={(e) => setCooldownInput(e.target.value)}
                    className="w-32"
                    data-testid="input-cooldown-seconds"
                  />
                </div>
                <Button
                  onClick={() => {
                    const v = Number(cooldownInput);
                    if (!Number.isFinite(v) || v <= 0) {
                      toast.error("Invalid value", { description: "Must be a positive number" });
                      return;
                    }
                    cooldownMutation.mutate(v);
                  }}
                  disabled={cooldownMutation.isPending}
                  data-testid="button-save-cooldown"
                >
                  {cooldownMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Save
                </Button>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>
                  Current: <span className="font-mono">{Math.round(settings.preResolveCooldownMs / 1000)}s</span>
                  {" · "}Default: <span className="font-mono">{Math.round(settings.bounds.defaultMs / 1000)}s</span>
                  {" · "}Bounds:{" "}
                  <span className="font-mono">
                    [{Math.round(settings.bounds.minMs / 1000)}s, {Math.round(settings.bounds.maxMs / 1000)}s]
                  </span>
                </p>
                <p>
                  Last updated: {shortDate(settings.updatedAt)}{" "}
                  {settings.updatedBy ? `by ${settings.updatedBy}` : "(default)"}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PersonaPnlTile />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markets sub-tab
// ---------------------------------------------------------------------------

function MarketRowExpanded({ marketId }: { marketId: string }) {
  const isVisible = useDocumentVisible();
  // Inspector polls slower than the listing (which already polls every
  // 15s). 20s is enough to feel live without doubling the DB hit, and
  // listing invalidations on resolve will refresh both views together.
  const { data, isLoading } = useQuery<AmmMarketDetail>({
    queryKey: ["/api/admin/amm/markets", marketId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/amm/markets/${marketId}`);
      return res.json();
    },
    refetchInterval: isVisible ? 20_000 : false,
    refetchOnWindowFocus: false,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading inspector...
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div className="p-3 rounded-md bg-muted/40">
          <p className="text-xs text-muted-foreground">Liquidity b</p>
          <p className="font-mono">{data.ammState.liquidityB}</p>
        </div>
        <div className="p-3 rounded-md bg-muted/40">
          <p className="text-xs text-muted-foreground">House seed</p>
          <p className="font-mono">{formatCredits(data.ammState.houseSeedAmount)}</p>
        </div>
        <div className="p-3 rounded-md bg-muted/40">
          <p className="text-xs text-muted-foreground">Total user credits in</p>
          <p className="font-mono">{formatCredits(data.ammState.totalUserCreditsIn)}</p>
        </div>
        <div className="p-3 rounded-md bg-muted/40">
          <p className="text-xs text-muted-foreground">Max payout liability</p>
          <p className="font-mono">{formatCredits(data.houseProjections.maxPayoutLiability)}</p>
        </div>
        <div className="p-3 rounded-md bg-muted/40">
          <p className="text-xs text-muted-foreground">Expected house P&L (price-weighted)</p>
          <p className={`font-mono ${data.houseProjections.expectedHousePnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {formatCredits(data.houseProjections.expectedHousePnl)}
          </p>
        </div>
        <div className="p-3 rounded-md bg-muted/40">
          <p className="text-xs text-muted-foreground">Trades</p>
          <p className="font-mono">{data.trades.tradeCount} ({data.trades.traderCount} traders)</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Per-entry breakdown</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entry</TableHead>
              <TableHead className="text-right">Shares (q)</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Liability if winner</TableHead>
              <TableHead className="text-right">House P&L if winner</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e) => (
              <TableRow key={e.entryId} data-testid={`amm-entry-row-${e.entryId}`}>
                <TableCell className="font-medium">{e.label ?? e.entryId.slice(0, 8)}</TableCell>
                <TableCell className="text-right font-mono">{e.q.toFixed(2)}</TableCell>
                <TableCell className="text-right font-mono">{formatPct(e.price)}</TableCell>
                <TableCell className="text-right font-mono">{formatCredits(e.payoutLiabilityIfWinner)}</TableCell>
                <TableCell className={`text-right font-mono ${e.projectedHousePnlIfWinner >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {formatCredits(e.projectedHousePnlIfWinner)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">
                    {e.resolutionStatus ?? "pending"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <details className="rounded-md border bg-muted/30 p-2">
        <summary className="cursor-pointer text-xs text-muted-foreground select-none">
          Raw AMM state JSON
        </summary>
        <pre className="text-[11px] mt-2 overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(data.ammState, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// Market types the AMM engine actually drives. Jackpot stays parimutuel
// per Phase 9 plan, so it's deliberately omitted from the filter chips.
const AMM_MARKET_TYPE_FILTERS = [
  { value: "", label: "All" },
  { value: "updown", label: "Up/Down" },
  { value: "h2h", label: "H2H" },
  { value: "community", label: "Community" },
  { value: "gainer", label: "Gainer" },
] as const;

function MarketsTab() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const limit = 25;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ResolvableMarket | null>(null);
  const isVisible = useDocumentVisible();

  const { data, isLoading } = useQuery<AmmMarketsList>({
    queryKey: ["/api/admin/amm/markets", statusFilter, typeFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(page * limit));
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("marketType", typeFilter);
      const res = await apiRequest("GET", `/api/admin/amm/markets?${params}`);
      return res.json();
    },
    refetchInterval: isVisible ? 15_000 : false,
    refetchOnWindowFocus: false,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Build the resolve target straight from the listing row — the
  // listing endpoint pre-fetches entry labels, so no extra API call.
  const buildResolveTarget = (m: AmmMarketRow): ResolvableMarket => ({
    id: m.id,
    title: m.title,
    marketType: m.marketType,
    engine: "amm",
    pool: m.totalUserCreditsIn + m.houseSeedAmount,
    uniqueBettors: m.traderCount,
    entries: m.entries.map((e) => ({
      id: e.id,
      label: e.label,
      marketId: m.id,
    })),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground w-12">Status:</span>
        {(["", "OPEN", "CLOSED_PENDING", "RESOLVED", "VOID"] as const).map((s) => (
          <Button
            key={s || "all"}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatusFilter(s);
              setPage(0);
            }}
            data-testid={`filter-status-${s || "all"}`}
          >
            {s || "All"}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {total} market{total === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground w-12">Type:</span>
        {AMM_MARKET_TYPE_FILTERS.map((t) => (
          <Button
            key={t.value || "all"}
            variant={typeFilter === t.value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTypeFilter(t.value);
              setPage(0);
            }}
            data-testid={`filter-type-${t.value || "all"}`}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.markets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No AMM markets match this filter yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Market</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">b</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Traders</TableHead>
                  <TableHead className="text-right">Max Liab.</TableHead>
                  <TableHead>Ends / Resolved</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.markets.map((m) => {
                  const isExpanded = expandedId === m.id;
                  const canResolve = m.status === "OPEN" || m.status === "CLOSED_PENDING";
                  return (
                    <Fragment key={m.id}>
                      <TableRow data-testid={`amm-market-row-${m.id}`}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => setExpandedId(isExpanded ? null : m.id)}
                            data-testid={`button-expand-${m.id}`}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{m.title}</div>
                          <div className="text-xs text-muted-foreground font-mono">{m.slug}</div>
                        </TableCell>
                        <TableCell><MarketTypeBadge type={m.marketType} /></TableCell>
                        <TableCell><StatusBadge status={m.status} /></TableCell>
                        <TableCell className="text-right font-mono">{m.liquidityB}</TableCell>
                        <TableCell className="text-right font-mono">{formatCredits(m.totalVolume)}</TableCell>
                        <TableCell className="text-right font-mono">{m.traderCount}</TableCell>
                        <TableCell className="text-right font-mono">{formatCredits(m.maxPayoutLiability)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {m.resolvedAt ? (
                            <span title={`endAt: ${shortDate(m.endAt)}`}>
                              resolved {shortDate(m.resolvedAt)}
                            </span>
                          ) : (
                            shortDate(m.endAt)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {canResolve ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (m.entries.length === 0) {
                                  toast.error("No entries on this market", { description: "Cannot resolve a market with no outcomes" });
                                  return;
                                }
                                setResolveTarget(buildResolveTarget(m));
                              }}
                              data-testid={`button-resolve-${m.id}`}
                            >
                              <Gavel className="h-3.5 w-3.5 mr-1.5" />
                              Resolve / Void
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={10} className="bg-muted/20">
                            <MarketRowExpanded marketId={m.id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          data-testid="button-markets-prev"
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {page + 1} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page + 1 >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          data-testid="button-markets-next"
        >
          Next
        </Button>
      </div>

      {resolveTarget && (
        <AmmResolutionDialog
          market={resolveTarget}
          open={!!resolveTarget}
          onOpenChange={(open) => {
            if (!open) setResolveTarget(null);
          }}
          invalidateOnSettle={[
            ["/api/admin/amm/markets"],
            ["/api/admin/amm/house"],
            ["/api/admin/amm/trades"],
            ["/api/admin/amm/health"],
          ]}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trades sub-tab
// ---------------------------------------------------------------------------

function TradesTab() {
  const [side, setSide] = useState<"" | "buy" | "sell">("");
  const [page, setPage] = useState(0);
  const limit = 50;
  const isVisible = useDocumentVisible();

  const { data, isLoading } = useQuery<AmmTradesFeed>({
    queryKey: ["/api/admin/amm/trades", side, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(page * limit));
      if (side) params.set("side", side);
      const res = await apiRequest("GET", `/api/admin/amm/trades?${params}`);
      return res.json();
    },
    // Only poll the freshest page; back-pages are static.
    refetchInterval: isVisible && page === 0 ? 10_000 : false,
    refetchOnWindowFocus: false,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Side:</span>
        {(["", "buy", "sell"] as const).map((s) => (
          <Button
            key={s || "all"}
            variant={side === s ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setSide(s);
              setPage(0);
            }}
            data-testid={`filter-side-${s || "all"}`}
          >
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : "All"}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {total} trade{total === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.trades.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No AMM trades yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Shares</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.trades.map((t) => (
                  <TableRow key={t.id} data-testid={`amm-trade-row-${t.id}`}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {shortDate(t.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{t.username ?? t.userId.slice(0, 8)}</span>
                        {t.isAgent && (
                          <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-500/10">
                            <Bot className="h-2.5 w-2.5 mr-0.5" />agent
                          </Badge>
                        )}
                        {t.isHouse && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10">
                            house
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium truncate max-w-[28ch]" title={t.marketTitle}>
                        {t.marketTitle}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        <MarketTypeBadge type={t.marketType} />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{t.entryLabel}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${t.actionType === "buy" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : "border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10"}`}>
                        {t.actionType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {t.shareCount != null ? t.shareCount.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm ${t.actionType === "buy" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                      title={t.actionType === "buy" ? "User paid these credits" : "User received these credits"}
                    >
                      {t.actionType === "buy" ? "+" : "−"}{formatCreditsAbs(t.stakeAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {t.pricePerShare != null ? formatPct(t.pricePerShare) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          data-testid="button-trades-prev"
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {page + 1} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page + 1 >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          data-testid="button-trades-next"
        >
          Load more
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health sub-tab
// ---------------------------------------------------------------------------

function HealthTab() {
  const [hasRun, setHasRun] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<AmmHealthReport>({
    queryKey: ["/api/admin/amm/health"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/amm/health");
      return res.json();
    },
    enabled: hasRun,
    refetchOnWindowFocus: false,
    // Audit is intentionally manual; never auto-poll.
    staleTime: Infinity,
  });

  const run = () => {
    if (!hasRun) {
      // First click: flipping `enabled` true triggers the initial fetch.
      setHasRun(true);
    } else {
      // Subsequent clicks: just refetch.
      void refetch();
    }
  };

  const copyAffected = (affected: Array<Record<string, unknown>>) => {
    const ids = affected
      .map((a) => (typeof a.marketId === "string" ? a.marketId : null))
      .filter((id): id is string => !!id);
    if (ids.length === 0) {
      toast("No market IDs in this check");
      return;
    }
    void navigator.clipboard.writeText(ids.join("\n")).then(() => {
      toast("Copied", { description: `${ids.length} market ID${ids.length === 1 ? "" : "s"} copied` });
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-violet-500" />
            AMM invariants audit
          </CardTitle>
          <CardDescription>
            Runs four cheap checks across every AMM market. Use this whenever a
            settlement misbehaves, after agent re-tuning (Phase 10), or as a
            pre-flight before launch. No mutations — read-only audit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={run} disabled={isLoading || isFetching} data-testid="button-run-audit">
            {isLoading || isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {hasRun ? "Re-run audit" : "Run audit"}
          </Button>
        </CardContent>
      </Card>

      {hasRun && (isLoading || isFetching) && !data ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Badge
              variant="outline"
              className={
                data.overall === "ok"
                  ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                  : data.overall === "warn"
                    ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                    : "border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10"
              }
              data-testid="health-overall-badge"
            >
              {data.overall === "ok" ? <CheckCircle className="h-3.5 w-3.5 mr-1" /> : <AlertTriangle className="h-3.5 w-3.5 mr-1" />}
              {data.overall.toUpperCase()}
            </Badge>
            <span>Checked at {shortDate(data.checkedAt)}</span>
            <span>·</span>
            <span>{data.ammMarketCount} AMM markets</span>
          </div>
          {data.checks.map((c) => {
            const tone =
              c.severity === "ok"
                ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5"
                : c.severity === "warn"
                  ? "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5"
                  : "border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/5";
            const Icon = c.severity === "ok" ? CheckCircle : c.severity === "warn" ? AlertTriangle : XCircle;
            return (
              <Card key={c.check} className={tone} data-testid={`health-check-${c.check}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{c.check}</p>
                        <p className="text-xs text-muted-foreground">{c.message}</p>
                      </div>
                    </div>
                    {c.affected.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyAffected(c.affected)}
                        data-testid={`button-copy-${c.check}`}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        Copy IDs
                      </Button>
                    )}
                  </div>
                  {c.affected.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                        View {c.affected.length} affected row{c.affected.length === 1 ? "" : "s"}
                      </summary>
                      <pre className="text-[11px] mt-2 p-2 rounded-md bg-muted/40 overflow-x-auto max-h-64">
{JSON.stringify(c.affected, null, 2)}
                      </pre>
                    </details>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------------

export function AdminAmmSection() {
  const tabs = useMemo(
    () => [
      { id: "overview", label: "Overview", icon: Activity },
      { id: "markets", label: "Markets", icon: Coins },
      { id: "trades", label: "Trades", icon: TrendingUp },
      { id: "health", label: "Health", icon: ShieldCheck },
      { id: "operations", label: "Operations", icon: Gauge },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2" data-testid="text-amm-title">
          <Activity className="h-6 w-6 text-violet-500" />
          AMM Dashboard
        </h2>
        <p className="text-muted-foreground">
          Audit the LMSR engine, watch trades land, and catch math drift before agents wake up.
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id} data-testid={`tab-amm-${t.id}`}>
              <t.icon className="h-4 w-4 mr-1.5" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="markets"><MarketsTab /></TabsContent>
        <TabsContent value="trades"><TradesTab /></TabsContent>
        <TabsContent value="health"><HealthTab /></TabsContent>
        <TabsContent value="operations"><AmmOperationsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
