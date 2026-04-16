import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatActivityAge } from "@/lib/formatDate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  ArrowLeft,
  RefreshCw,
  Check,
  X,
  Eye,
  EyeOff,
  Inbox,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { getAdminAccessBlock } from "./AdminAccessGate";

// ---------------------------------------------------------------------------
// Types matching the GET /api/admin/suggestions response shape.
// ---------------------------------------------------------------------------
type SuggestionRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  submittedBy: string;
  status: string;
  adminNotes: string | null;
  approvedAsId: string | null;
  approvedAsType: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submitterUsername: string | null;
  submitterAvatar: string | null;
};

type ListResponse = { data: SuggestionRow[]; totalCount: number };

type StatusFilter = "pending" | "approved" | "rejected" | "all";
type TypeFilter =
  | "all"
  | "matchup"
  | "sentiment_poll"
  | "opinion_poll"
  | "induction"
  | "profile_image"
  | "open_market";

const PAGE_SIZE = 25;

const TYPE_LABEL: Record<string, string> = {
  matchup: "Matchup",
  sentiment_poll: "Sentiment Poll",
  opinion_poll: "Opinion Poll",
  induction: "Induction",
  profile_image: "Profile Image",
  open_market: "Open Market",
};

// Distinct badge class per type — match existing palette (cyan/violet/emerald/amber/fuchsia/rose).
const TYPE_BADGE_CLASS: Record<string, string> = {
  matchup: "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300",
  sentiment_poll: "bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300",
  opinion_poll: "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
  induction: "bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-600 dark:text-fuchsia-300",
  profile_image: "bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-300",
  open_market: "bg-violet-500/15 border-violet-500/40 text-violet-600 dark:text-violet-300",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300",
  approved: "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
  rejected: "bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-300",
};

// ---------------------------------------------------------------------------
// Compact payload preview — 3-4 most important fields per type, no raw JSON.
// ---------------------------------------------------------------------------
function PayloadPreview({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  const rows: Array<{ label: string; value: string }> = [];
  const g = (key: string): string | undefined => {
    const v = payload?.[key];
    if (v === null || v === undefined || v === "") return undefined;
    return typeof v === "string" ? v : String(v);
  };

  if (type === "matchup") {
    const title = g("title");
    const cat = g("category");
    const a = g("optionAText");
    const b = g("optionBText");
    if (title) rows.push({ label: "Title", value: title });
    if (cat) rows.push({ label: "Category", value: cat });
    if (a && b) rows.push({ label: "Contenders", value: `${a} vs ${b}` });
  } else if (type === "sentiment_poll") {
    const h = g("headline");
    const cat = g("category");
    const subj = g("subjectText");
    if (h) rows.push({ label: "Headline", value: h });
    if (cat) rows.push({ label: "Category", value: cat });
    if (subj) rows.push({ label: "Subject", value: subj });
  } else if (type === "opinion_poll") {
    const title = g("title");
    const cat = g("category");
    const opts = Array.isArray(payload?.options) ? (payload.options as unknown[]).length : 0;
    if (title) rows.push({ label: "Title", value: title });
    if (cat) rows.push({ label: "Category", value: cat });
    rows.push({ label: "Options", value: `${opts} option${opts === 1 ? "" : "s"}` });
  } else if (type === "induction") {
    const name = g("displayName");
    const cat = g("category");
    const url = g("socialUrl");
    if (name) rows.push({ label: "Display Name", value: name });
    if (cat) rows.push({ label: "Category", value: cat });
    if (url) rows.push({ label: "Social URL", value: url });
  } else if (type === "open_market") {
    const title = g("title");
    const mt = g("openMarketType");
    const cat = g("category");
    const entries = Array.isArray(payload?.entries) ? (payload.entries as unknown[]).length : 0;
    if (title) rows.push({ label: "Title", value: title });
    if (mt) rows.push({ label: "Type", value: mt });
    if (cat) rows.push({ label: "Category", value: cat });
    if (entries > 0) rows.push({ label: "Entries", value: `${entries}` });
  } else if (type === "profile_image") {
    const pn = g("personName") ?? g("personId");
    rows.push({ label: "Person", value: pn ?? "—" });
    rows.push({ label: "Status", value: "Deferred — manual review via curate UI" });
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No preview available.</p>;
  }

  return (
    <dl className="text-sm space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-2">
          <dt className="text-muted-foreground min-w-[110px]">{r.label}:</dt>
          <dd className="font-medium truncate">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Single suggestion card — payload preview, expand-JSON toggle, approve/reject.
// ---------------------------------------------------------------------------
function SuggestionCard({ row, statusFilter }: { row: SuggestionRow; statusFilter: StatusFilter }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/suggestions/${row.id}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Suggestion approved!", description: "Content is now live." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/suggestions"] });
    },
    onError: (err: any) => {
      toast({
        title: "Approval failed",
        description: err?.message ?? "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (adminNotes: string) => {
      const res = await apiRequest("PATCH", `/api/admin/suggestions/${row.id}/reject`, {
        adminNotes: adminNotes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Suggestion rejected", description: "The submitter will see this on their profile." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/suggestions"] });
      setRejecting(false);
      setRejectReason("");
    },
    onError: (err: any) => {
      toast({
        title: "Rejection failed",
        description: err?.message ?? "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const typeLabel = TYPE_LABEL[row.type] ?? row.type;
  const typeBadgeClass = TYPE_BADGE_CLASS[row.type] ?? "bg-muted text-foreground";
  const statusBadgeClass = STATUS_BADGE_CLASS[row.status] ?? "bg-muted text-foreground";
  const isPending = row.status === "pending";
  const showStatusBadge = statusFilter !== "pending";

  return (
    <Card className="p-4 space-y-3" data-testid={`suggestion-card-${row.id}`}>
      {/* Header row: type badge + status badge + timestamp */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={typeBadgeClass}>
            {typeLabel}
          </Badge>
          {showStatusBadge && (
            <Badge variant="outline" className={statusBadgeClass}>
              {row.status}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{formatActivityAge(row.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Avatar className="h-6 w-6">
            {row.submitterAvatar && <AvatarImage src={row.submitterAvatar} alt={row.submitterUsername ?? ""} />}
            <AvatarFallback className="text-xs">
              {(row.submitterUsername ?? "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">@{row.submitterUsername ?? "unknown"}</span>
        </div>
      </div>

      {/* Compact payload preview */}
      <PayloadPreview type={row.type} payload={row.payload ?? {}} />

      {/* Expandable full JSON */}
      <div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid={`toggle-payload-${row.id}`}
        >
          {expanded ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {expanded ? "Hide full payload" : "View full payload"}
        </button>
        {expanded && (
          <pre className="mt-2 p-3 rounded-md bg-muted/50 border text-xs overflow-x-auto font-mono max-h-72">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        )}
      </div>

      {/* Admin notes for rejected rows */}
      {row.status === "rejected" && row.adminNotes && (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2 text-xs">
          <span className="font-medium">Rejection reason:</span> {row.adminNotes}
        </div>
      )}

      {/* Approved link-through info */}
      {row.status === "approved" && row.approvedAsType && row.approvedAsId && (
        <div className="text-xs text-muted-foreground">
          Created as <span className="font-mono">{row.approvedAsType}</span>: {row.approvedAsId}
        </div>
      )}

      {/* Action row — only for pending */}
      {isPending && !rejecting && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRejecting(true)}
            disabled={approveMutation.isPending}
            className="border-red-500/50 text-red-600 dark:text-red-400 hover:bg-red-500/10"
            data-testid={`button-reject-${row.id}`}
          >
            <X className="h-4 w-4 mr-1" />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending || rejectMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            data-testid={`button-approve-${row.id}`}
          >
            {approveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            Approve
          </Button>
        </div>
      )}

      {/* Inline reject reason input */}
      {isPending && rejecting && (
        <div className="space-y-2 pt-1">
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Optional reason (shown to submitter)..."
            maxLength={500}
            data-testid={`input-reject-reason-${row.id}`}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRejecting(false);
                setRejectReason("");
              }}
              disabled={rejectMutation.isPending}
              data-testid={`button-cancel-reject-${row.id}`}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => rejectMutation.mutate(rejectReason)}
              disabled={rejectMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid={`button-confirm-reject-${row.id}`}
            >
              {rejectMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <X className="h-4 w-4 mr-1" />
              )}
              Confirm Reject
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AdminSuggestionsPage() {
  const [, setLocation] = useLocation();
  const { user, profile, isAdmin, profileLoading } = useAuth();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [pages, setPages] = useState(1);

  const handleStatusChange = (v: StatusFilter) => {
    setStatusFilter(v);
    setPages(1);
  };
  const handleTypeChange = (v: TypeFilter) => {
    setTypeFilter(v);
    setPages(1);
  };

  const queryKey = useMemo(
    () => ["/api/admin/suggestions", statusFilter, typeFilter, pages] as const,
    [statusFilter, typeFilter, pages]
  );

  const { data, isLoading, isError, error, isFetching } = useQuery<ListResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      params.set("limit", String(PAGE_SIZE * pages));
      params.set("offset", "0");
      const res = await apiRequest("GET", `/api/admin/suggestions?${params.toString()}`);
      return res.json();
    },
    // requireAdmin gate — but only fetch once we know the user is an admin.
    enabled: !profileLoading && isAdmin,
  });

  // ---- Auth gate ----------------------------------------------------------
  const adminAccessBlock = getAdminAccessBlock({
    profileLoading,
    user,
    profile,
    isAdmin,
    onGoHome: () => setLocation("/"),
  });
  if (adminAccessBlock) return adminAccessBlock;

  const rows = data?.data ?? [];
  const totalCount = data?.totalCount ?? 0;
  const canLoadMore = rows.length < totalCount;

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/admin")}
              data-testid="button-back-to-admin"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">Suggestions Review Queue</h1>
              <p className="text-xs text-muted-foreground truncate">
                Community-submitted content awaiting admin approval
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/suggestions"] })}
            disabled={isFetching}
            data-testid="button-refresh-suggestions"
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-3xl">
        {/* Filter bar */}
        <Card className="p-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={(v) => handleStatusChange(v as StatusFilter)}>
                <SelectTrigger className="w-[140px] h-9" data-testid="filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Type</label>
              <Select value={typeFilter} onValueChange={(v) => handleTypeChange(v as TypeFilter)}>
                <SelectTrigger className="w-[180px] h-9" data-testid="filter-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="matchup">Matchup</SelectItem>
                  <SelectItem value="sentiment_poll">Sentiment Poll</SelectItem>
                  <SelectItem value="opinion_poll">Opinion Poll</SelectItem>
                  <SelectItem value="induction">Induction</SelectItem>
                  <SelectItem value="open_market">Open Market</SelectItem>
                  <SelectItem value="profile_image">Profile Image</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto text-xs text-muted-foreground" data-testid="suggestions-count">
              {isLoading ? "Loading…" : `Showing ${rows.length} of ${totalCount} suggestions`}
            </div>
          </div>
        </Card>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <Card className="p-8 text-center">
            <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive" />
            <h3 className="text-base font-semibold mb-1">Failed to load suggestions</h3>
            <p className="text-sm text-muted-foreground">{(error as Error)?.message ?? "Unknown error"}</p>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="p-10 text-center">
            <Inbox className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <h3 className="text-base font-semibold mb-1">
              No {statusFilter === "all" ? "" : statusFilter} suggestions to review
            </h3>
            <p className="text-sm text-muted-foreground">
              {statusFilter === "pending"
                ? "The queue is empty — new community suggestions will appear here."
                : "Adjust the filters above to see more."}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <SuggestionCard key={row.id} row={row} statusFilter={statusFilter} />
            ))}
            {canLoadMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => setPages((p) => p + 1)}
                  disabled={isFetching}
                  data-testid="button-load-more"
                >
                  {isFetching ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : null}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
