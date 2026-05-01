import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Megaphone, Loader2, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAdminAccessBlock } from "./AdminAccessGate";

type Audience = "all" | "admins";

interface BroadcastResponse {
  success: boolean;
  batchId: string;
  recipients: number;
  inserted: number;
}

/**
 * Admin → Broadcast announcement.
 *
 * Composes a single notification and fans it out to every active user
 * (or admins/moderators only). Lives at /admin/announcements; linked
 * from the main admin dashboard but standalone so we can iterate on
 * targeting/preview without touching the giant AdminDashboard.tsx.
 *
 * Idempotency lives entirely server-side — each submission generates
 * a fresh batch id, so accidental double-clicks DO double-fan. This is
 * the lesser evil compared to silently dropping a re-broadcast that
 * the admin genuinely intended (e.g. amended copy on the same topic).
 * The form's pending state should make double-clicks rare in practice.
 */
export default function AdminAnnouncementsPage() {
  const { user, profile, profileLoading, isAdmin } = useAuth();
  const [, setLocation] = useLocation();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [lastResult, setLastResult] = useState<BroadcastResponse | null>(null);

  const broadcast = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        audience,
      };
      if (body.trim()) payload.body = body.trim();
      if (href.trim()) payload.href = href.trim();
      const res = await apiRequest("POST", "/api/admin/announcements", payload);
      return (await res.json()) as BroadcastResponse;
    },
    onSuccess: (data) => {
      setLastResult(data);
      toast.success(`Announcement sent to ${data.inserted} of ${data.recipients} users.`);
      setTitle("");
      setBody("");
      setHref("");
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Failed to broadcast announcement");
    },
  });

  const accessBlock = getAdminAccessBlock({
    profileLoading,
    user,
    profile,
    isAdmin,
    onGoHome: () => setLocation("/"),
  });
  if (accessBlock) return <>{accessBlock}</>;

  const canSubmit = title.trim().length >= 3 && !broadcast.isPending;

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
            <h1 className="font-serif font-bold text-xl">Compose Announcement</h1>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <Card className="p-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ann-title">Title</Label>
            <Input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly markets are live"
              maxLength={140}
              data-testid="input-announcement-title"
            />
            <p className="text-xs text-muted-foreground">
              {title.length}/140 characters. Shows in bold at the top of the row.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ann-body">Body (optional)</Label>
            <Textarea
              id="ann-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="A short follow-up sentence."
              maxLength={500}
              rows={3}
              data-testid="textarea-announcement-body"
            />
            <p className="text-xs text-muted-foreground">{body.length}/500 characters.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ann-href">Deep link (optional)</Label>
            <Input
              id="ann-href"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="/predict or https://example.com/blog/post"
              maxLength={500}
              data-testid="input-announcement-href"
            />
            <p className="text-xs text-muted-foreground">
              Internal paths route within the app. External URLs open via window navigation.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ann-audience">Audience</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
              <SelectTrigger id="ann-audience" data-testid="select-announcement-audience">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All onboarded users (ToS-accepted)</SelectItem>
                <SelectItem value="admins">Admins &amp; moderators only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {audience === "admins"
                ? "Useful for ops dry-runs before a wider broadcast."
                : "Excludes shadow accounts that never finished onboarding."}
            </p>
          </div>

          <div className="pt-2">
            <Button
              onClick={() => broadcast.mutate()}
              disabled={!canSubmit}
              className="w-full"
              data-testid="button-broadcast-announcement"
            >
              {broadcast.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Broadcasting...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send announcement
                </>
              )}
            </Button>
          </div>

          {lastResult && (
            <Card className="bg-emerald-500/10 border-emerald-500/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="font-semibold">Sent.</span>{" "}
                  Reached {lastResult.inserted} of {lastResult.recipients} users.
                </p>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {lastResult.batchId.slice(0, 8)}
                </Badge>
              </div>
            </Card>
          )}
        </Card>
      </div>
    </div>
  );
}
