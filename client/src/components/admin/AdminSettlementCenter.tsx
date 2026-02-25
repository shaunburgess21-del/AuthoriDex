import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Gavel,
  Clock,
  Loader2,
  Users,
  Coins,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

async function getAuthHeaders(): Promise<Record<string, string>> {
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
  category: string | null;
  endAt: string;
  pool: number;
  betCount: number;
  uniqueBettors: number;
  pendingHours: number;
  warnings: string[];
  entries: Array<{ id: string; label: string; marketId: string }>;
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

interface ResolutionPreview {
  marketId: string;
  title: string;
  totalPool: number;
  totalBets: number;
  uniqueBettors: number;
  entries: Array<{
    entryId: string;
    entryLabel: string;
    totalStaked: number;
    betCount: number;
    winnersCount: number;
    losersCount: number;
    totalPayouts: number;
    remainder: number;
    payoutDetails: Array<{ userId: string; username: string; stake: number; payout: number }>;
  }>;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

function ResolutionDialog({
  market,
  open,
  onOpenChange,
}: {
  market: PendingMarket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const { data: preview, isLoading: previewLoading } = useQuery<ResolutionPreview>({
    queryKey: ["/api/admin/markets", market.id, "preview-resolution"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/markets/${market.id}/preview-resolution`);
      if (!res.ok) throw new Error("Failed to preview");
      return res.json();
    },
    enabled: open,
  });

  const settleMutation = useMutation({
    mutationFn: async () => {
      const isNative = market.marketType !== "community";
      const url = isNative
        ? `/api/admin/native-markets/${market.id}/settle`
        : `/api/admin/open-markets/${market.id}/settle`;
      const body = isNative
        ? { winnerEntryId: selectedEntry, notes }
        : { winnerEntryId: selectedEntry, resolutionNotes: notes };
      const res = await fetchWithAuth(url, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        const msg = err.error || "Failed to settle";
        const isAlreadySettled = /already (resolved|settled)/i.test(msg) || /not.*OPEN|not.*CLOSED_PENDING/i.test(msg);
        if (isAlreadySettled) {
          return { alreadySettled: true, message: msg };
        }
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.alreadySettled) {
        toast({ title: "Already Resolved", description: "This market was already settled — no action needed." });
      } else {
        toast({ title: "Market Resolved", description: "Payouts distributed successfully" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/resolved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ops-summary"] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Settlement Failed", description: err.message, variant: "destructive" }),
  });

  const voidMutation = useMutation({
    mutationFn: async () => {
      const isNative = market.marketType !== "community";
      const url = isNative
        ? `/api/admin/native-markets/${market.id}/settle`
        : `/api/admin/open-markets/${market.id}/void`;
      const body = isNative ? { notes: voidReason } : { voidReason };
      const res = await fetchWithAuth(url, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Failed to void");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Market Voided", description: "All stakes refunded" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/resolved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ops-summary"] });
      onOpenChange(false);
    },
    onError: () => toast({ title: "Void Failed", description: "Could not void market", variant: "destructive" }),
  });

  const selectedPreview = preview?.entries.find(e => e.entryId === selectedEntry);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Gavel className="h-5 w-5" />
            Resolve Market
          </DialogTitle>
          <DialogDescription>{market.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground">
            <MarketTypeBadge type={market.marketType} />
            <span className="flex items-center gap-1"><Coins className="h-3.5 w-3.5" /> {market.pool} credits pool</span>
            <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {market.uniqueBettors} bettors</span>
          </div>

          {previewLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : preview && !showVoid ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Select winning outcome:</p>
              {preview.entries.map(entry => {
                const isSelected = selectedEntry === entry.entryId;
                const stakePercent = preview.totalPool > 0 ? Math.round((entry.totalStaked / preview.totalPool) * 100) : 0;
                return (
                  <Card
                    key={entry.entryId}
                    className={`cursor-pointer transition-colors ${isSelected ? "ring-2 ring-primary" : ""}`}
                    onClick={() => setSelectedEntry(entry.entryId)}
                    data-testid={`entry-option-${entry.entryId}`}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-primary" : "border-muted-foreground/30"}`}>
                            {isSelected && <div className="h-2 w-2 rounded-full bg-primary" />}
                          </div>
                          <span className="font-medium">{entry.entryLabel}</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span>{entry.betCount} bets</span>
                          <span>{entry.totalStaked} credits ({stakePercent}%)</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary/60 rounded-full" style={{ width: `${stakePercent}%` }} />
                      </div>
                      {isSelected && entry.winnersCount > 0 && (
                        <div className="mt-2 p-3 rounded-md bg-muted/50 space-y-2">
                          <p className="text-sm font-medium">Payout Preview</p>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <p className="text-muted-foreground">Winners</p>
                              <p className="font-medium text-green-600 dark:text-green-400">{entry.winnersCount}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Total Payouts</p>
                              <p className="font-medium">{entry.totalPayouts} credits</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Remainder</p>
                              <p className="font-medium">{entry.remainder}</p>
                            </div>
                          </div>
                          {entry.payoutDetails.length > 0 && (
                            <div className="mt-2 space-y-1">
                              <p className="text-xs text-muted-foreground">Top payouts:</p>
                              {entry.payoutDetails.map((p, i) => (
                                <div key={i} className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">{p.username}</span>
                                  <span className="font-medium">{p.stake} → {p.payout} credits</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {isSelected && entry.winnersCount === 0 && (
                        <div className="mt-2 p-3 rounded-md bg-muted/50">
                          <p className="text-sm text-muted-foreground">No bets on this outcome — no payouts to distribute</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              <div className="space-y-2">
                <label className="text-sm font-medium">Resolution Notes</label>
                <Textarea
                  placeholder="e.g., Confirmed via AP News report on Feb 25..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  data-testid="input-resolution-notes"
                />
              </div>
            </div>
          ) : showVoid ? (
            <div className="space-y-3">
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <p className="text-sm font-medium text-destructive">Void Market</p>
                <p className="text-xs text-muted-foreground mt-1">All stakes will be refunded to bettors. This cannot be undone.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason for voiding (required)</label>
                <Textarea
                  placeholder="Why is this market being voided?"
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                  data-testid="input-void-reason"
                />
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {!showVoid ? (
            <>
              <Button
                variant="outline"
                onClick={() => setShowVoid(true)}
                className="text-destructive"
                data-testid="button-show-void"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Void Instead
              </Button>
              <Button
                onClick={() => settleMutation.mutate()}
                disabled={!selectedEntry || settleMutation.isPending}
                data-testid="button-confirm-resolve"
              >
                {settleMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                {settleMutation.isPending
                  ? "Resolving..."
                  : selectedPreview
                    ? `Resolve — ${selectedPreview.totalPayouts} credits to ${selectedPreview.winnersCount} winner${selectedPreview.winnersCount !== 1 ? "s" : ""}`
                    : "Select an outcome"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setShowVoid(false)} data-testid="button-cancel-void">
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => voidMutation.mutate()}
                disabled={!voidReason.trim() || voidMutation.isPending}
                data-testid="button-confirm-void"
              >
                {voidMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                {voidMutation.isPending ? "Voiding..." : "Void & Refund All Stakes"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            <p className="text-xs text-muted-foreground">Remainder policy: burned (virtual credits)</p>
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

  const { data: pendingMarkets, isLoading: pendingLoading, error: pendingError } = useQuery<PendingMarket[]>({
    queryKey: ["/api/admin/markets/pending"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/markets/pending");
      if (!res.ok) throw new Error("Failed to load pending markets");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: resolvedMarkets, isLoading: resolvedLoading, error: resolvedError } = useQuery<ResolvedMarket[]>({
    queryKey: ["/api/admin/markets/resolved"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/markets/resolved");
      if (!res.ok) throw new Error("Failed to load resolved markets");
      return res.json();
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
            <CardDescription>Markets awaiting resolution — oldest first</CardDescription>
          </div>
          {pendingCount > 0 && (
            <Badge variant="secondary">{pendingCount} pending</Badge>
          )}
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
              {pendingMarkets.map(market => (
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
                      {market.warnings.map(w => <WarningBadge key={w} warning={w} />)}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {market.category && <span>{market.category}</span>}
                      <span>{market.pool} credits</span>
                      <span>{market.betCount} bets</span>
                      <span>{market.uniqueBettors} bettors</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {market.pendingHours > 0 ? `${market.pendingHours}h pending` : "Just closed"}
                      </span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="ml-2 shrink-0" data-testid={`button-resolve-${market.id}`}>
                    <Gavel className="h-4 w-4 mr-1" />
                    Resolve
                  </Button>
                </div>
              ))}
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
                        <span>{market.pool} credits</span>
                        {market.status === "RESOLVED" && (
                          <>
                            <span className="text-green-600 dark:text-green-400">{market.winnersCount} winners</span>
                            <span>{market.totalPayouts} paid</span>
                          </>
                        )}
                        <span>by {market.resolverName}</span>
                        <span>{formatTimeAgo(market.resolvedAt)}</span>
                        {market.resolutionNotes && <span className="italic">"{market.resolutionNotes}"</span>}
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
        <ResolutionDialog
          market={resolveMarket}
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
