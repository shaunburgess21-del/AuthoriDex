import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Coins,
  TrendingUp,
  TrendingDown,
  History,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { "Content-Type": "application/json" };
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
}

async function fetchWithAuth(url: string): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(url, { headers, credentials: "include" });
}

interface CreditHistoryEntry {
  id: string;
  userId: string;
  txnType: string;
  amount: number;
  walletType: string;
  balanceAfter: number;
  source: string;
  idempotencyKey: string;
  metadata: any;
  createdAt: string;
}

interface CreditHistoryResponse {
  profile: {
    id: string;
    username: string | null;
    fullName: string | null;
    role: string;
    rank: string;
    xpPoints: number;
    predictCredits: number;
    totalVotes: number;
    totalPredictions: number;
    winRate: number;
    createdAt: string;
  };
  ledgerSum: number;
  drift: number;
  entries: CreditHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function TxnTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; color: string }> = {
    initial_grant: { label: "Signup Bonus", color: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
    prediction_stake: { label: "Bet Placed", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    prediction_payout: { label: "Payout", color: "bg-green-500/15 text-green-600 dark:text-green-400" },
    prediction_refund: { label: "Refund", color: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
    admin_adjustment: { label: "Admin Adj.", color: "bg-red-500/15 text-red-600 dark:text-red-400" },
    bonus: { label: "Bonus", color: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
  };
  const c = config[type] || { label: type, color: "" };
  return <Badge variant="outline" className={`text-xs border-0 ${c.color}`}>{c.label}</Badge>;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AdminUserCreditHistory({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery<CreditHistoryResponse>({
    queryKey: ["/api/admin/users", userId, "credit-history", page],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/users/${userId}/credit-history?page=${page}`);
      if (!res.ok) throw new Error("Failed to load credit history");
      return res.json();
    },
    enabled: open,
  });

  const startEntry = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const endEntry = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setPage(1); onOpenChange(v); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-credit-history-title">
            <History className="h-5 w-5" />
            User Details
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-destructive opacity-50" />
            <p className="text-destructive">Failed to load credit history</p>
            <p className="text-sm mt-1">Check your connection and try again</p>
          </div>
        ) : data ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-lg font-bold" data-testid="text-user-display-name">{data.profile.username || data.profile.fullName || "Unknown"}</p>
                <Badge variant="outline" className="text-xs">{data.profile.role}</Badge>
                <Badge variant="secondary" className="text-xs">{data.profile.rank}</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-muted-foreground text-xs">Credits</p>
                  <p className="text-lg font-bold flex items-center gap-1" data-testid="text-user-credits">
                    <Coins className="h-4 w-4 text-amber-500" />
                    {data.profile.predictCredits}
                  </p>
                </div>
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-muted-foreground text-xs">XP</p>
                  <p className="text-lg font-bold" data-testid="text-user-xp">{data.profile.xpPoints}</p>
                </div>
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-muted-foreground text-xs">Predictions</p>
                  <p className="text-lg font-bold" data-testid="text-user-predictions">{data.profile.totalPredictions}</p>
                </div>
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-muted-foreground text-xs">Win Rate</p>
                  <p className="text-lg font-bold" data-testid="text-user-winrate">{data.profile.winRate}%</p>
                </div>
              </div>
            </div>

            {data.drift !== 0 && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm" data-testid="alert-credit-drift">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <div>
                  <p className="font-medium text-destructive">Credit Drift Detected</p>
                  <p className="text-xs text-muted-foreground">
                    Cached: {data.profile.predictCredits} | Ledger: {data.ledgerSum} | Drift: {data.drift}
                  </p>
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium">Credit History</p>
                <p className="text-xs text-muted-foreground" data-testid="text-entry-count">
                  {data.total > 0 ? `${startEntry}–${endEntry} of ${data.total}` : "0 entries"}
                </p>
              </div>
              {data.entries.length > 0 ? (
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                  {data.entries.map(entry => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between p-2.5 rounded-md border text-sm"
                      data-testid={`ledger-entry-${entry.id}`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {entry.amount >= 0 ? (
                          <TrendingUp className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-red-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <TxnTypeBadge type={entry.txnType} />
                            {entry.metadata?.reason && (
                              <span className="text-xs text-muted-foreground truncate max-w-[200px]">{entry.metadata.reason}</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(entry.createdAt)}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className={`font-mono font-medium ${entry.amount >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {entry.amount >= 0 ? "+" : ""}{entry.amount}
                        </p>
                        <p className="text-xs text-muted-foreground">{entry.balanceAfter} bal</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  <p>No credit history entries</p>
                </div>
              )}

              {data.totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground" data-testid="text-page-indicator">
                    Page {data.page} of {data.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => setPage(p => p + 1)}
                    data-testid="button-next-page"
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
