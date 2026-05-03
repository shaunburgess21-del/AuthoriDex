import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Megaphone,
  Loader2,
  Send,
  Users,
  CheckCircle2,
  Eye,
  MailOpen,
  AlertTriangle,
  Activity,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CANONICAL_CATEGORIES } from "@shared/constants";
import { getAdminAccessBlock } from "./AdminAccessGate";

type AudienceKind =
  | "everyone"
  | "active_30d"
  | "placed_bet"
  | "category_subscribers"
  | "single_user"
  | "test_self";

interface AudienceFilter {
  kind: AudienceKind;
  category?: string;
  userId?: string;
}

interface BroadcastResponse {
  broadcastId: string;
  target: number;
  delivered: number;
}

interface BroadcastListItem {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  priority: number;
  category: string;
  audience: AudienceFilter;
  targetCount: number;
  deliveredCount: number;
  status: string;
  sentAt: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByUsername: string | null;
  stats: {
    delivered: number;
    seen: number;
    read: number;
    dismissed: number;
    clicks: number;
  };
}

interface BroadcastListResponse {
  items: BroadcastListItem[];
  nextOffset: number | null;
}

interface AudiencePreview {
  count: number;
  sample: { id: string; username: string | null }[];
}

interface UserNotificationItem {
  id: string;
  kind: string;
  category: string;
  title: string;
  body: string | null;
  href: string | null;
  priority: number;
  entityType: string | null;
  entityId: string | null;
  seenAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  idempotencyKey: string;
  createdAt: string;
}

const AUDIENCE_OPTIONS: { value: AudienceKind; label: string; hint: string }[] = [
  {
    value: "everyone",
    label: "Everyone",
    hint: "All non-bot user profiles. Use sparingly — this hits every active account.",
  },
  {
    value: "active_30d",
    label: "Active in last 30 days",
    hint: "Users with a `lastActiveAt` within the last 30 days. The standard 'engaged user' bucket.",
  },
  {
    value: "placed_bet",
    label: "Has placed a bet",
    hint: "Anyone who has ever placed at least one prediction-market bet.",
  },
  {
    value: "category_subscribers",
    label: "Category subscribers",
    hint: "Users who picked this category in the InterestsPicker (statedInterests).",
  },
  {
    value: "single_user",
    label: "Specific user",
    hint: "Send to one user by their ID. Useful for support replies.",
  },
  {
    value: "test_self",
    label: "Just me (test send)",
    hint: "Sends only to your own account. Use this to sanity-check copy + links before broadcasting.",
  },
];

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Admin → Notifications.
 *
 * Single page with two tabs:
 *   - Compose: write + preview audience count + send / test-send.
 *   - History: every past broadcast with seen/read rates.
 *
 * Mounted at both `/admin/notifications` (canonical) and
 * `/admin/announcements` (legacy alias) so existing bookmarks and
 * audit-log deep links still resolve.
 *
 * The per-user notification inspector lives behind a button on each
 * row in the history (and on the Users admin section) that opens
 * the UserNotificationInspectorDialog component below.
 */
export default function AdminNotificationsPage() {
  const { user, profile, profileLoading, isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"compose" | "history">("compose");

  // Composer state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [priority, setPriority] = useState<"0" | "1">("1");
  const [audience, setAudience] = useState<AudienceFilter>({ kind: "active_30d" });
  const [singleUserId, setSingleUserId] = useState("");
  const [categoryAudience, setCategoryAudience] = useState<string>("sports");

  // Per-user inspector. Supports being opened directly via a query
  // string (e.g. /admin/notifications?inspect=<userId>) so the Users
  // section of AdminDashboard can deep-link straight to a user's bell
  // history without us threading shared state through the giant
  // AdminDashboard component.
  const [inspectorUserId, setInspectorUserId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const inspect = params.get("inspect");
    if (inspect) setInspectorUserId(inspect);
  }, []);

  const accessBlock = getAdminAccessBlock({
    profileLoading,
    user,
    profile,
    isAdmin,
    onGoHome: () => setLocation("/"),
  });

  const effectiveAudience = useMemo<AudienceFilter>(() => {
    if (audience.kind === "category_subscribers") {
      return { kind: "category_subscribers", category: categoryAudience };
    }
    if (audience.kind === "single_user") {
      return { kind: "single_user", userId: singleUserId.trim() };
    }
    return audience;
  }, [audience, categoryAudience, singleUserId]);

  const previewQuery = useQuery<AudiencePreview>({
    queryKey: ["admin-broadcast-preview", effectiveAudience],
    queryFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/notifications/broadcast/preview",
        { audience: effectiveAudience },
      );
      return res.json();
    },
    enabled:
      isAdmin &&
      !accessBlock &&
      !(effectiveAudience.kind === "single_user" && !effectiveAudience.userId),
    staleTime: 30_000,
  });

  const historyQuery = useQuery<BroadcastListResponse>({
    queryKey: ["admin-broadcast-history"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/notifications/broadcasts");
      return res.json();
    },
    enabled: isAdmin && !accessBlock && tab === "history",
    staleTime: 15_000,
  });

  const send = useMutation({
    mutationFn: async (overrideAudience?: AudienceFilter) => {
      const payload = {
        title: title.trim(),
        body: body.trim() || undefined,
        href: href.trim() || undefined,
        priority: priority === "1" ? 1 : 0,
        audience: overrideAudience ?? effectiveAudience,
      };
      const res = await apiRequest(
        "POST",
        "/api/admin/notifications/broadcast",
        payload,
      );
      return (await res.json()) as BroadcastResponse;
    },
    onSuccess: (data, variables) => {
      const isTest = (variables ?? effectiveAudience)?.kind === "test_self";
      toast.success(
        isTest
          ? `Test sent. Check your bell (${data.delivered} of ${data.target}).`
          : `Sent to ${data.delivered} of ${data.target} users.`,
      );
      if (!isTest) {
        // Clear the form for non-test sends so the admin doesn't accidentally
        // re-send the same broadcast with stale copy. Test sends keep the
        // form populated so the next click is "send for real".
        setTitle("");
        setBody("");
        setHref("");
      }
      queryClient.invalidateQueries({ queryKey: ["admin-broadcast-history"] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Failed to send broadcast");
    },
  });

  if (accessBlock) return <>{accessBlock}</>;

  const trimmedTitle = title.trim();
  const composerInvalid = trimmedTitle.length < 3 || send.isPending;
  const audienceInvalid =
    (effectiveAudience.kind === "single_user" &&
      !effectiveAudience.userId) ||
    (effectiveAudience.kind === "category_subscribers" &&
      !effectiveAudience.category) ||
    previewQuery.data?.count === 0;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/admin")}
            aria-label="Back to admin"
            data-testid="button-back-admin"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h1 className="font-serif font-bold text-xl">Notifications</h1>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "compose" | "history")}>
          <TabsList className="mb-6">
            <TabsTrigger value="compose" data-testid="tab-compose">
              <Sparkles className="h-4 w-4 mr-1.5" />
              Compose
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <Activity className="h-4 w-4 mr-1.5" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compose">
            <div className="grid gap-6 md:grid-cols-[1fr,360px]">
              <Card className="p-6 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="bc-title">Title</Label>
                  <Input
                    id="bc-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Weekly markets are live"
                    maxLength={200}
                    data-testid="input-broadcast-title"
                  />
                  <p className="text-xs text-muted-foreground">
                    {title.length}/200. Bold first row of every notification.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bc-body">Body (optional)</Label>
                  <Textarea
                    id="bc-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="One short sentence of context."
                    maxLength={2000}
                    rows={3}
                    data-testid="textarea-broadcast-body"
                  />
                  <p className="text-xs text-muted-foreground">
                    {body.length}/2000.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bc-href">Deep link (optional)</Label>
                  <Input
                    id="bc-href"
                    value={href}
                    onChange={(e) => setHref(e.target.value)}
                    placeholder="/predict#jackpot or https://example.com/blog"
                    maxLength={2000}
                    data-testid="input-broadcast-href"
                  />
                  <p className="text-xs text-muted-foreground">
                    Internal paths route within the app. External URLs open in
                    a new tab.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bc-priority">Priority</Label>
                  <Select
                    value={priority}
                    onValueChange={(v) => setPriority(v as "0" | "1")}
                  >
                    <SelectTrigger
                      id="bc-priority"
                      data-testid="select-broadcast-priority"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">
                        High — auto-toast in active sessions
                      </SelectItem>
                      <SelectItem value="0">
                        Silent — bell only (no toast)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bc-audience">Audience</Label>
                  <Select
                    value={audience.kind}
                    onValueChange={(v) =>
                      setAudience({ kind: v as AudienceKind })
                    }
                  >
                    <SelectTrigger
                      id="bc-audience"
                      data-testid="select-broadcast-audience"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUDIENCE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {AUDIENCE_OPTIONS.find((o) => o.value === audience.kind)
                      ?.hint}
                  </p>

                  {audience.kind === "category_subscribers" && (
                    <Select
                      value={categoryAudience}
                      onValueChange={setCategoryAudience}
                    >
                      <SelectTrigger
                        className="mt-2"
                        data-testid="select-broadcast-category"
                      >
                        <SelectValue placeholder="Pick a category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CANONICAL_CATEGORIES.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {audience.kind === "single_user" && (
                    <Input
                      className="mt-2"
                      value={singleUserId}
                      onChange={(e) => setSingleUserId(e.target.value)}
                      placeholder="User ID (UUID from profiles.id)"
                      data-testid="input-broadcast-single-user"
                    />
                  )}
                </div>
              </Card>

              {/* Preview pane — count, sample usernames, and a render of
                  what the bell row will look like. */}
              <Card className="p-5 space-y-5 self-start sticky md:top-24">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Audience preview
                  </h3>
                  {previewQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> resolving…
                    </p>
                  ) : previewQuery.data ? (
                    <>
                      <p
                        className="text-2xl font-bold tabular-nums"
                        data-testid="preview-count"
                      >
                        {previewQuery.data.count.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {previewQuery.data.count === 0
                          ? "No users match this filter."
                          : previewQuery.data.sample.length > 0
                            ? `incl. ${previewQuery.data.sample
                                .map((s) => `@${s.username ?? s.id.slice(0, 6)}`)
                                .join(", ")}${
                                previewQuery.data.count >
                                previewQuery.data.sample.length
                                  ? ` +${previewQuery.data.count - previewQuery.data.sample.length} more`
                                  : ""
                              }`
                            : "user(s)"}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Tweak the audience to refresh the count.
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <Megaphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    Bell preview
                  </h3>
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="flex items-start gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-blue-500/15 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                        <Megaphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className="font-semibold leading-tight truncate"
                          data-testid="preview-title"
                        >
                          {trimmedTitle || "Broadcast title…"}
                        </p>
                        {body.trim() && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {body}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {priority === "1" ? "High priority" : "Silent"} •
                          just now
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={composerInvalid || send.isPending}
                    onClick={() => send.mutate({ kind: "test_self" })}
                    data-testid="button-broadcast-test"
                  >
                    {send.isPending && send.variables?.kind === "test_self" ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    Send test to me
                  </Button>
                  <Button
                    className="w-full"
                    disabled={composerInvalid || audienceInvalid}
                    onClick={() => setConfirmOpen(true)}
                    data-testid="button-broadcast-send"
                  >
                    {send.isPending && send.variables?.kind !== "test_self" ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Send broadcast
                  </Button>
                </div>

                {effectiveAudience.kind !== "test_self" &&
                  (previewQuery.data?.count ?? 0) > 1000 && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div>
                        Large audience ({previewQuery.data?.count.toLocaleString()}).
                        Consider a test send first.
                      </div>
                    </div>
                  )}
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <Card className="p-0 overflow-hidden">
              {historyQuery.isLoading ? (
                <div className="p-8 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading broadcasts…
                </div>
              ) : !historyQuery.data || historyQuery.data.items.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No broadcasts yet. Compose one in the Compose tab.
                </div>
              ) : (
                <ul className="divide-y">
                  {historyQuery.data.items.map((b) => (
                    <li key={b.id} className="p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-full bg-blue-500/15 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                          <Megaphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm leading-tight">
                              {b.title}
                            </p>
                            <Badge
                              variant={
                                b.status === "sent"
                                  ? "secondary"
                                  : b.status === "failed"
                                    ? "destructive"
                                    : "outline"
                              }
                              className="text-[10px] py-0 px-1.5 leading-none shrink-0"
                            >
                              {b.status}
                            </Badge>
                          </div>
                          {b.body && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                              {b.body}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {b.audience.kind.replace(/_/g, " ")}
                              {b.audience.category ? ` · ${b.audience.category}` : ""}
                            </span>
                            <span>
                              {formatRelative(b.sentAt ?? b.createdAt)}
                            </span>
                            {b.createdByUsername && (
                              <span>by @{b.createdByUsername}</span>
                            )}
                            {b.href && (
                              <a
                                href={b.href}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-0.5 hover:text-foreground"
                              >
                                link
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>

                          <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
                            <Stat
                              label="Delivered"
                              value={b.stats.delivered}
                              hint={`/ ${b.targetCount} target`}
                            />
                            <Stat
                              label="Seen"
                              value={b.stats.seen}
                              percent={pct(b.stats.seen, b.stats.delivered)}
                              icon={<Eye className="h-3 w-3" />}
                            />
                            <Stat
                              label="Read"
                              value={b.stats.read}
                              percent={pct(b.stats.read, b.stats.delivered)}
                              icon={<MailOpen className="h-3 w-3" />}
                            />
                            <Stat
                              label="Dismissed"
                              value={b.stats.dismissed}
                              percent={pct(
                                b.stats.dismissed,
                                b.stats.delivered,
                              )}
                            />
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <p className="text-[11px] text-muted-foreground mt-3 text-center">
              Stats are computed live from the notifications table — dismissals
              and reads update without a refresh on the next page load.
            </p>
          </TabsContent>
        </Tabs>
      </div>

      <UserNotificationInspectorDialog
        userId={inspectorUserId}
        onClose={() => setInspectorUserId(null)}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-broadcast">
          <AlertDialogHeader>
            <AlertDialogTitle>Send broadcast?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deliver{" "}
              <span className="font-semibold text-foreground">
                "{trimmedTitle}"
              </span>{" "}
              to{" "}
              <span className="font-semibold text-foreground">
                {previewQuery.data?.count.toLocaleString() ?? "?"} users
              </span>
              . Notifications can't be recalled after sending. Consider running
              a test send first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                send.mutate(undefined);
              }}
              data-testid="button-confirm-send"
            >
              Send to {previewQuery.data?.count.toLocaleString() ?? "?"} users
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface StatProps {
  label: string;
  value: number;
  percent?: string;
  hint?: string;
  icon?: React.ReactNode;
}

function Stat({ label, value, percent, hint, icon }: StatProps) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums">
        {value.toLocaleString()}
        {percent && percent !== "—" && (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {percent}
          </span>
        )}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * Standalone inspector that renders the last N notifications for a
 * given user. Surfaced both from the History tab (via "view recipient"
 * — not yet wired, but the dialog is reusable) and from
 * Admin → Users (next iteration). Read-only by design — admins
 * shouldn't be able to mutate a user's bell from here.
 */
export function UserNotificationInspectorDialog({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const open = Boolean(userId);
  const { data, isLoading } = useQuery<{ items: UserNotificationItem[] }>({
    queryKey: ["admin-user-notifications", userId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/users/${userId}/notifications`,
      );
      return res.json();
    },
    enabled: open,
    staleTime: 15_000,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>User notifications</DialogTitle>
          <DialogDescription>
            Last 50 notification rows for this user, newest first. Read-only.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {isLoading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : !data || data.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No notifications for this user yet.
            </p>
          ) : (
            <ul className="divide-y">
              {data.items.map((n) => (
                <li key={n.id} className="py-2.5">
                  <div className="flex items-start gap-2">
                    <Badge
                      variant="outline"
                      className="text-[10px] py-0 px-1.5 leading-none shrink-0"
                    >
                      {n.kind}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight">
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-2">
                        <span>{formatRelative(n.createdAt)}</span>
                        {n.seenAt && <span>seen</span>}
                        {n.readAt && <span>read</span>}
                        {n.dismissedAt && <span>dismissed</span>}
                        <span>p{n.priority}</span>
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
