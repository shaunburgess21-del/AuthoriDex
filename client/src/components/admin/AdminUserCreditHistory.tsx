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
  Vote,
  Mail,
  UserPlus,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { labelForTxnType } from "@shared/credit-config";
import { surfaceLabelForVoteType } from "@shared/lib/vote-action-display";

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

type ActivityFilter = "all" | "credit" | "vote";

type AdminCreditActivityEntry = {
  kind: "credit";
  id: string;
  createdAt: string;
  txnType: string;
  amount: number;
  balanceAfter: number;
  displayTitle: string;
  displaySubtitle?: string;
  href?: string;
};

type AdminVoteActivityEntry = {
  kind: "vote";
  id: string;
  createdAt: string;
  voteType: string;
  actionKind: string;
  displayTitle: string;
  displaySubtitle?: string;
  href?: string;
};

type AdminActivityEntry = AdminCreditActivityEntry | AdminVoteActivityEntry;

interface ActivityHistoryResponse {
  profile: {
    id: string;
    username: string | null;
    email: string | null;
    role: string;
    rank: string;
    xpPoints: number;
    predictCredits: number;
    totalVotes: number;
    totalPredictions: number;
    winRate: number;
    createdAt: string;
    emailMarketingUnsubscribed: boolean;
    emailMarketingUnsubscribedAt: string | null;
    emailMarketingUnsubscribeSource: string | null;
    referralCode: string | null;
    referredBy: { id: string; username: string | null } | null;
    referredCount: number;
  };
  ledgerSum: number;
  drift: number;
  entries: AdminActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface EmailLogResponse {
  emails: Array<{
    idempotencyKey: string;
    category: string;
    template: string;
    sentAt: string;
  }>;
}

const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "credit", label: "Credits" },
  { id: "vote", label: "Votes" },
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ActivityRow({ entry }: { entry: AdminActivityEntry }) {
  if (entry.kind === "credit") {
    const title = entry.displayTitle || labelForTxnType(entry.txnType);
    const Icon = entry.amount >= 0 ? TrendingUp : TrendingDown;
    const amountClass =
      entry.amount >= 0
        ? "text-green-600 dark:text-green-400"
        : "text-red-600 dark:text-red-400";

    return (
      <div
        className="flex items-center justify-between p-2.5 rounded-md border text-sm"
        data-testid={`activity-entry-credit-${entry.id}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Icon className={`h-4 w-4 shrink-0 ${amountClass}`} />
          <div className="min-w-0">
            <p className="font-medium line-clamp-2">{title}</p>
            {entry.displaySubtitle ? (
              <p className="text-xs text-muted-foreground line-clamp-1">{entry.displaySubtitle}</p>
            ) : null}
            <p className="text-xs text-muted-foreground mt-0.5">{formatDate(entry.createdAt)}</p>
          </div>
        </div>
        <div className="text-right shrink-0 ml-2">
          <p className={`font-mono font-medium ${amountClass}`}>
            {entry.amount >= 0 ? "+" : ""}
            {entry.amount}
          </p>
          <p className="text-xs text-muted-foreground">{entry.balanceAfter} bal</p>
        </div>
      </div>
    );
  }

  const title = entry.displayTitle || surfaceLabelForVoteType(entry.voteType);
  const subtitle = entry.displaySubtitle;

  return (
    <div
      className="flex items-center justify-between p-2.5 rounded-md border text-sm"
      data-testid={`activity-entry-vote-${entry.id}`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Vote className="h-4 w-4 text-violet-500 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-medium line-clamp-2">{title}</p>
            <Badge variant="outline" className="text-xs border-0 bg-violet-500/15 text-violet-600 dark:text-violet-400">
              Vote
            </Badge>
          </div>
          {subtitle ? (
            <p className="text-xs text-muted-foreground line-clamp-1">{subtitle}</p>
          ) : null}
          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(entry.createdAt)}</p>
        </div>
      </div>
    </div>
  );
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
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const { data, isLoading, error } = useQuery<ActivityHistoryResponse>({
    queryKey: ["/api/admin/users", userId, "activity-history", page, filter],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `/api/admin/users/${userId}/activity-history?page=${page}&filter=${filter}`,
      );
      if (!res.ok) throw new Error("Failed to load activity history");
      return res.json();
    },
    enabled: open,
  });

  const { data: emailLog, isError: emailLogError } = useQuery<EmailLogResponse>({
    queryKey: ["/api/admin/users", userId, "email-log"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/users/${userId}/email-log`);
      if (!res.ok) throw new Error("Failed to load email log");
      return res.json();
    },
    enabled: open,
  });

  const startEntry = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const endEntry = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  const handleFilterChange = (next: ActivityFilter) => {
    setFilter(next);
    setPage(1);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setPage(1);
          setFilter("all");
        }
        onOpenChange(v);
      }}
    >
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
            <p className="text-destructive">Failed to load activity history</p>
            <p className="text-sm mt-1">Check your connection and try again</p>
          </div>
        ) : data ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-lg font-bold" data-testid="text-user-display-name">{data.profile.username || "Unknown"}</p>
                <Badge variant="outline" className="text-xs">{data.profile.role}</Badge>
                <Badge variant="secondary" className="text-xs">{data.profile.rank}</Badge>
              </div>
              <p className="text-sm text-muted-foreground" data-testid="text-user-email">
                {data.profile.email || "No email available"}
              </p>
              <div
                className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${
                  data.profile.emailMarketingUnsubscribed
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                }`}
                data-testid="text-user-email-subscription-state"
              >
                <span className="font-medium">Email marketing:</span>
                <span>
                  {data.profile.emailMarketingUnsubscribed ? "Unsubscribed" : "Subscribed"}
                </span>
                {data.profile.emailMarketingUnsubscribedAt ? (
                  <span className="text-muted-foreground">
                    ({formatDate(data.profile.emailMarketingUnsubscribedAt)})
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-muted-foreground text-xs">Vox</p>
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

            {/* Referral attribution */}
            <div data-testid="section-user-referrals">
              <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                Referrals
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div className="p-2.5 rounded-md bg-muted/50">
                  <p className="text-muted-foreground text-xs">Referral code</p>
                  <p className="font-mono text-sm" data-testid="text-user-referral-code">
                    {data.profile.referralCode ?? "—"}
                  </p>
                </div>
                <div className="p-2.5 rounded-md bg-muted/50">
                  <p className="text-muted-foreground text-xs">Referred by</p>
                  <p className="text-sm truncate" data-testid="text-user-referred-by">
                    {data.profile.referredBy
                      ? data.profile.referredBy.username ?? data.profile.referredBy.id.slice(0, 8)
                      : "Organic signup"}
                  </p>
                </div>
                <div className="p-2.5 rounded-md bg-muted/50">
                  <p className="text-muted-foreground text-xs">Users referred</p>
                  <p className="text-sm font-bold" data-testid="text-user-referred-count">
                    {data.profile.referredCount}
                  </p>
                </div>
              </div>
            </div>

            {/* Transactional email history */}
            <div data-testid="section-user-emails">
              <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Emails sent
                {emailLog && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({emailLog.emails.length})
                  </span>
                )}
              </p>
              {emailLog && emailLog.emails.length > 0 ? (
                <div className="space-y-1 max-h-[180px] overflow-y-auto">
                  {emailLog.emails.map((e) => (
                    <div
                      key={e.idempotencyKey}
                      className="flex items-center justify-between gap-2 p-2 rounded-md border text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{e.template}</p>
                        <p className="text-muted-foreground">{e.category}</p>
                      </div>
                      <span className="text-muted-foreground shrink-0">{formatDate(e.sentAt)}</span>
                    </div>
                  ))}
                </div>
              ) : emailLogError ? (
                <p className="text-xs text-destructive">Couldn't load the email log.</p>
              ) : (
                <p className="text-xs text-muted-foreground">No emails logged for this user.</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <p className="text-sm font-medium">Activity History</p>
                <p className="text-xs text-muted-foreground" data-testid="text-entry-count">
                  {data.total > 0 ? `${startEntry}–${endEntry} of ${data.total}` : "0 entries"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {FILTERS.map((f) => (
                  <Button
                    key={f.id}
                    variant={filter === f.id ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleFilterChange(f.id)}
                    data-testid={`filter-activity-${f.id}`}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
              {data.entries.length > 0 ? (
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                  {data.entries.map((entry) => (
                    <ActivityRow key={`${entry.kind}-${entry.id}`} entry={entry} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  <p>No activity entries</p>
                </div>
              )}

              {data.totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                    onClick={() => setPage((p) => p + 1)}
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
