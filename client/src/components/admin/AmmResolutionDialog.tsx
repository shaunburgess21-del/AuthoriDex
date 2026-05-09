/**
 * Shared resolve / void confirmation modal used by both the Settlement
 * Center and the AMM admin tab.
 *
 * Extracted from `AdminSettlementCenter.tsx` (Phase 5) so the AMM
 * Markets sub-tab can fire the same well-tested resolve / void flow
 * without duplicating the modal. Behaviour is identical to the
 * original — engine-aware URL switching for parimutuel vs AMM, and
 * a payout-preview side-panel for parimutuel markets.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Loader2,
  Users,
  Coins,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabase";

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

export interface ResolvableMarket {
  id: string;
  title: string;
  marketType: string;
  /** Phase 4: 'amm' markets resolve via the LMSR settlement endpoint. */
  engine?: "parimutuel" | "amm" | string | null;
  pool?: number;
  uniqueBettors?: number;
  entries: Array<{ id: string; label: string; marketId?: string }>;
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

export function AmmResolutionDialog({
  market,
  open,
  onOpenChange,
  /**
   * Extra invalidation keys for callers outside the Settlement Center
   * (e.g. the AMM admin tab needs `/api/admin/amm/markets`,
   * `/api/admin/amm/house`, `/api/admin/amm/trades` to refresh after a
   * resolve / void). Defaults cover the Settlement Center surface.
   */
  invalidateOnSettle = [],
}: {
  market: ResolvableMarket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invalidateOnSettle?: Array<readonly unknown[]>;
}) {
  const queryClient = useQueryClient();
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const isAmm = market.engine === "amm";

  // Parimutuel preview is the only path that needs a server-rendered
  // payout breakdown; AMM payouts are always 1 credit per winning
  // share so we skip the preview call and rely on the inspector.
  const { data: preview, isLoading: previewLoading } = useQuery<ResolutionPreview>({
    queryKey: ["/api/admin/markets", market.id, "preview-resolution"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/markets/${market.id}/preview-resolution`);
      if (!res.ok) throw new Error("Failed to preview");
      return res.json();
    },
    enabled: open && !isAmm,
  });

  const invalidateAfter = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/pending"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/resolved"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/ops-summary"] });
    for (const k of invalidateOnSettle) {
      queryClient.invalidateQueries({ queryKey: [...k] });
    }
  };

  const settleMutation = useMutation({
    mutationFn: async () => {
      const isNative = market.marketType !== "community";
      const url = isAmm
        ? `/api/admin/markets/${market.id}/amm-resolve`
        : isNative
          ? `/api/admin/native-markets/${market.id}/settle`
          : `/api/admin/open-markets/${market.id}/settle`;
      const body = isAmm
        ? { winnerEntryId: selectedEntry, notes }
        : isNative
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
        toast("Already Resolved", { description: "This market was already settled — no action needed." });
      } else {
        toast("Market Resolved", { description: "Payouts distributed successfully" });
      }
      invalidateAfter();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error("Settlement Failed", { description: err.message }),
  });

  const voidMutation = useMutation({
    mutationFn: async () => {
      const isNative = market.marketType !== "community";
      const url = isAmm
        ? `/api/admin/markets/${market.id}/amm-resolve`
        : isNative
          ? `/api/admin/native-markets/${market.id}/settle`
          : `/api/admin/open-markets/${market.id}/void`;
      const body = isAmm
        ? { voidMarket: true, notes: voidReason }
        : isNative
          ? { notes: voidReason }
          : { voidReason };
      const res = await fetchWithAuth(url, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Failed to void");
      return res.json();
    },
    onSuccess: () => {
      toast("Market Voided", { description: "All stakes refunded" });
      invalidateAfter();
      onOpenChange(false);
    },
    onError: () => toast.error("Void Failed", { description: "Could not void market" }),
  });

  const selectedPreview = preview?.entries.find((e) => e.entryId === selectedEntry);

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
            {isAmm && (
              <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                LMSR / AMM
              </Badge>
            )}
            {typeof market.pool === "number" && (
              <span className="flex items-center gap-1"><Coins className="h-3.5 w-3.5" /> {market.pool} credits pool</span>
            )}
            {typeof market.uniqueBettors === "number" && (
              <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {market.uniqueBettors} bettors</span>
            )}
          </div>
          {isAmm && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
              This is an AMM market. Settling pays each holder of the winning side
              <span className="font-mono"> 1 credit per share</span>; voiding refunds every position at its cost basis. The house keeps the rest as market-maker P/L.
            </div>
          )}

          {!showVoid && isAmm ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Select winning outcome:</p>
              {market.entries.map((entry) => {
                const isSelected = selectedEntry === entry.id;
                return (
                  <Card
                    key={entry.id}
                    className={`cursor-pointer transition-colors ${isSelected ? "ring-2 ring-primary" : ""}`}
                    onClick={() => setSelectedEntry(entry.id)}
                    data-testid={`entry-option-${entry.id}`}
                  >
                    <CardContent className="p-4 flex items-center gap-2">
                      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-primary" : "border-muted-foreground/30"}`}>
                        {isSelected && <div className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      <span className="font-medium">{entry.label}</span>
                    </CardContent>
                  </Card>
                );
              })}

              <div className="space-y-2">
                <label className="text-sm font-medium">Resolution Notes</label>
                <Textarea
                  placeholder="e.g., Confirmed via AP News report on Feb 25..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  data-testid="input-resolution-notes"
                />
              </div>
            </div>
          ) : previewLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : preview && !showVoid ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Select winning outcome:</p>
              {preview.entries.map((entry) => {
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
                                <div key={p.userId || `payout-${i}`} className="flex items-center justify-between text-xs">
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
                  onChange={(e) => setNotes(e.target.value)}
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
                  onChange={(e) => setVoidReason(e.target.value)}
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
                    : isAmm && selectedEntry
                      ? "Resolve — pay 1 credit per winning share"
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
