import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Clock,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Gavel,
  Eye,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabase";
import { formatTimeAgo } from "@/lib/formatDate";
import { AmmResolutionDialog, type ScoutAssessmentView } from "./AmmResolutionDialog";
import { CURRENCY } from "@/lib/currency";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { "Content-Type": "application/json" };
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(url, { ...options, headers: { ...headers, ...options.headers }, credentials: "include" });
}

interface PendingMarket {
  id: string;
  title: string;
  marketType: string;
  /** Phase 4: 'amm' markets resolve via the LMSR settlement endpoint. */
  engine?: "parimutuel" | "amm" | string | null;
  category: string | null;
  endAt: string;
  pool: number;
  betCount: number;
  uniqueBettors: number;
  pendingHours: number;
  pendingReason?: string;
  warnings: string[];
  entries: Array<{ id: string; label: string; marketId: string }>;
  resolutionCriteria?: string[] | null;
  sourceUrl?: string | null;
  /** Flexible market metadata; may carry the AI scout's last assessment. */
  metadata?: {
    scoutAssessment?: ScoutAssessmentView | null;
    source?: {
      url?: string | null;
      resolutionRulesText?: string | null;
    } | null;
  } | null;
}

interface ResolvedMarket {
  id: string;
  title: string;
  marketType: string;
  category: string | null;
  status: string;
  resolvedAt: string | null;
  resolveMethod: string | null;
  resolverName: string;
  pool: number;
  betCount: number;
  winnersCount: number;
  losersCount: number;
  totalPayouts: number;
  remainder: number;
  voidReason: string | null;
  resolutionNotes: string | null;
}

function WarningBadge({ warning }: { warning: string }) {
  const config: Record<string, { label: string; variant: "destructive" | "outline" | "secondary" }> = {
    no_bets: { label: "No Bets", variant: "outline" },
    stuck: { label: "Stuck", variant: "destructive" },
    concentration: { label: ">50% One User", variant: "secondary" },
  };
  const c = config[warning] || { label: warning, variant: "outline" };
  return <Badge variant={c.variant} className="text-xs">{c.label}</Badge>;
}

function MarketTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    jackpot: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    community: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    updown: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    h2h: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    gainer: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  };
  return (
    <Badge variant="outline" className={`text-xs border-0 ${colors[type] || ""}`}>
      {type === "h2h" ? "H2H" : type === "updown" ? "Up/Down" : type.charAt(0).toUpperCase() + type.slice(1)}
    </Badge>
  );
}

function PayoutDetailDialog({
  marketId,
  open,
  onOpenChange,
}: {
  marketId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/markets", marketId, "payout-summary"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/markets/${marketId}/payout-summary`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Payout Details</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-muted-foreground">Total Pool</p>
                <p className="text-lg font-bold">{data.totalPool}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-muted-foreground">Total Payouts</p>
                <p className="text-lg font-bold">{data.totalPayouts}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-muted-foreground">Winners / Losers</p>
                <p className="text-lg font-bold">{data.winnersCount} / {data.losersCount}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-muted-foreground">Remainder</p>
                <p className="text-lg font-bold">{data.remainder}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-muted-foreground">Largest Payout</p>
                <p className="text-lg font-bold">{data.largestPayout}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-muted-foreground">Total Bets</p>
                <p className="text-lg font-bold">{data.totalBets}</p>
              </div>
            </div>
            <div className="text-sm">
              <p className="font-medium mb-2">Ledger Entries</p>
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="outline">{data.ledgerEntries?.stakes || 0} stakes</Badge>
                <Badge variant="outline">{data.ledgerEntries?.payouts || 0} payouts</Badge>
                <Badge variant="outline">{data.ledgerEntries?.refunds || 0} refunds</Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Remainder policy: burned (Vox is virtual)</p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function AdminSettlementCenter() {
  const [resolveMarket, setResolveMarket] = useState<PendingMarket | null>(null);
  const [payoutDetailId, setPayoutDetailId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Confirm guard: cleanup voids + refunds every stale pending market
  // in one shot, so it shouldn't fire on a single click.
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const queryClient = useQueryClient();
  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const { data: pendingMarkets, isLoading: pendingLoading, error: pendingError } = useQuery<PendingMarket[]>({
    queryKey: ["/api/admin/markets/pending"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/markets/pending");
      if (!res.ok) throw new Error("Failed to load pending markets");
      return res.json();
    },
    refetchInterval: isVisible ? 60000 : false,
    refetchOnWindowFocus: false,
  });

  const { data: resolvedMarkets, isLoading: resolvedLoading, error: resolvedError } = useQuery<ResolvedMarket[]>({
    queryKey: ["/api/admin/markets/resolved"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/markets/resolved");
      if (!res.ok) throw new Error("Failed to load resolved markets");
      return res.json();
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/markets/pending/cleanup", {
        method: "POST",
        body: JSON.stringify({ olderThanHours: 24 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Cleanup failed" }));
        throw new Error(err.error || "Cleanup failed");
      }
      return res.json();
    },
    onSuccess: (result: { cleaned?: Array<unknown>; skipped?: Array<unknown> }) => {
      toast("Cleanup complete", { description: `${result.cleaned?.length || 0} stale markets cleaned, ${result.skipped?.length || 0} skipped.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/resolved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ops-summary"] });
    },
    onError: (err: Error) => {
      toast.error("Cleanup failed", { description: err.message });
    },
  });

  const pendingCount = pendingMarkets?.length || 0;
  const needsAttention = pendingMarkets?.filter(m => m.warnings.includes("stuck")).length || 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-settlement-title">Settlement Center</h2>
        <p className="text-muted-foreground">Resolve closed markets and distribute payouts</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-amber-500/15">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-pending-count">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">Pending Resolution</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-red-500/15">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-attention-count">{needsAttention}</p>
              <p className="text-xs text-muted-foreground">Needs Attention</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-green-500/15">
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-resolved-count">{resolvedMarkets?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Recently Resolved</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
          <div>
            <CardTitle className="text-lg">Pending Settlements</CardTitle>
            <CardDescription>Closed markets and AI-flagged resolve-now World Markets</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <Badge variant="secondary">{pendingCount} pending</Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCleanupConfirm(true)}
              disabled={cleanupMutation.isPending}
              data-testid="button-clean-stale-pending"
            >
              {cleanupMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
              Clean Stale
            </Button>
            <Dialog open={showCleanupConfirm} onOpenChange={setShowCleanupConfirm}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Clean stale pending markets?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  Voids jackpot markets and community markets with zero active bets that have
                  been pending longer than 24 hours (AMM seed returned). Community markets with
                  active bets are skipped and still need manual resolution. This cannot be undone.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setShowCleanupConfirm(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setShowCleanupConfirm(false);
                      cleanupMutation.mutate();
                    }}
                    data-testid="button-confirm-clean-stale"
                  >
                    Void &amp; refund stale markets
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {pendingLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : pendingError ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-destructive opacity-50" />
              <p className="text-destructive">Failed to load pending markets</p>
              <p className="text-sm mt-1">Check your connection and try refreshing</p>
            </div>
          ) : pendingMarkets && pendingMarkets.length > 0 ? (
            <div className="space-y-2">
              {pendingMarkets.map(market => {
                const isAiResolveNow = market.pendingReason === "ai_resolve_now";
                const scout = market.metadata?.scoutAssessment;
                const scoutDetail =
                  scout?.leaning
                    ? `${typeof scout.confidence === "number" ? `${Math.round(scout.confidence * 100)}% → ` : ""}${scout.leaning}`
                    : "Condition met";
                return (
                <div
                  key={market.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer"
                  onClick={() => setResolveMarket(market)}
                  data-testid={`market-pending-${market.id}`}
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm truncate">{market.title}</p>
                      <MarketTypeBadge type={market.marketType} />
                      {market.pendingReason && (
                        <Badge
                          variant="outline"
                          className={`text-xs ${isAiResolveNow ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : "capitalize"}`}
                        >
                          {isAiResolveNow
                            ? "AI: resolve now"
                            : market.pendingReason.replace(/_/g, " ")}
                        </Badge>
                      )}
                      {market.warnings.map(w => <WarningBadge key={w} warning={w} />)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {market.category && <span>{market.category}</span>}
                      <span>{CURRENCY.symbol}{market.pool}</span>
                      <span>{market.betCount} bets</span>
                      <span>{market.uniqueBettors} bettors</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {isAiResolveNow
                          ? scoutDetail
                          : market.pendingHours > 0
                            ? `${market.pendingHours}h pending`
                            : "Just closed"}
                      </span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="ml-2 shrink-0" data-testid={`button-resolve-${market.id}`}>
                    <Gavel className="h-4 w-4 mr-1" />
                    Resolve
                  </Button>
                </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>All caught up — no markets pending resolution</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4 cursor-pointer"
          onClick={() => setShowHistory(!showHistory)}
        >
          <div>
            <CardTitle className="text-lg">Settlement History</CardTitle>
            <CardDescription>Recently resolved and voided markets</CardDescription>
          </div>
          <Button variant="ghost" size="icon">
            {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CardHeader>
        {showHistory && (
          <CardContent>
            {resolvedLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : resolvedMarkets && resolvedMarkets.length > 0 ? (
              <div className="space-y-2">
                {resolvedMarkets.map(market => (
                  <div
                    key={market.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                    data-testid={`market-resolved-${market.id}`}
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm truncate">{market.title}</p>
                        <MarketTypeBadge type={market.marketType} />
                        <Badge variant={market.status === "RESOLVED" ? "secondary" : "destructive"} className="text-xs">
                          {market.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span>{CURRENCY.symbol}{market.pool}</span>
                        {market.status === "RESOLVED" && (
                          <>
                            <span className="text-green-600 dark:text-green-400">{market.winnersCount} winners</span>
                            <span>{market.totalPayouts} paid</span>
                          </>
                        )}
                        <span>by {market.resolverName}</span>
                        <span>{formatTimeAgo(market.resolvedAt)}</span>
                        {market.resolutionNotes && (() => {
                          try {
                            const notes = JSON.parse(market.resolutionNotes);
                            if (notes.type === "jackpot") {
                              if (notes.outcome === "no_entries") {
                                return <span className="italic">"Jackpot: no entries, voided (actual={notes.actualScore})"</span>;
                              }
                              return <span className="italic">"Jackpot: actual={notes.actualScore}, closest={notes.winningPrediction}, margin={notes.margin}, entries={notes.totalEntries}, payout={notes.payout?.toLocaleString?.() ?? notes.payout}"</span>;
                            }
                            return <span className="italic">"{market.resolutionNotes}"</span>;
                          } catch {
                            return <span className="italic">"{market.resolutionNotes}"</span>;
                          }
                        })()}
                        {market.voidReason && <span className="text-destructive italic">Void: {market.voidReason}</span>}
                      </div>
                    </div>
                    {market.status === "RESOLVED" && market.pool > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPayoutDetailId(market.id)}
                        data-testid={`button-payout-detail-${market.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No settlement history yet</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {resolveMarket && (
        <AmmResolutionDialog
          market={{
            ...resolveMarket,
            scoutAssessment: resolveMarket.metadata?.scoutAssessment ?? null,
            resolutionCriteria: resolveMarket.resolutionCriteria ?? null,
            sourceRulesText:
              resolveMarket.metadata?.source?.resolutionRulesText ?? null,
            sourceUrl:
              resolveMarket.metadata?.source?.url ??
              resolveMarket.sourceUrl ??
              null,
          }}
          open={!!resolveMarket}
          onOpenChange={open => { if (!open) setResolveMarket(null); }}
        />
      )}

      {payoutDetailId && (
        <PayoutDetailDialog
          marketId={payoutDetailId}
          open={!!payoutDetailId}
          onOpenChange={open => { if (!open) setPayoutDetailId(null); }}
        />
      )}
    </div>
  );
}
