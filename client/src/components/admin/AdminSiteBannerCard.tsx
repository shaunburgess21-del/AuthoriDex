import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { SiteBannerStyle, SiteBannerLinkDisplay } from "@shared/schema";

type BannerStatus = "disabled" | "scheduled" | "live" | "ended";

interface SiteBannerRow {
  id: string;
  message: string;
  href: string | null;
  linkLabel: string | null;
  linkDisplay: SiteBannerLinkDisplay;
  style: SiteBannerStyle;
  startsAt: string;
  endsAt: string | null;
  isEnabled: boolean;
  dismissible: boolean;
  status: BannerStatus;
}

const LINK_LABEL_PRESETS = ["Learn more", "View details", "Get started", "Predict now"];
const CUSTOM_LABEL = "__custom__";

const STATUS_VARIANT: Record<BannerStatus, "default" | "secondary" | "outline" | "destructive"> = {
  live: "default",
  scheduled: "secondary",
  ended: "outline",
  disabled: "destructive",
};

const PREVIEW_STYLE: Record<SiteBannerStyle, string> = {
  promo:
    "bg-gradient-to-r from-violet-950/95 via-indigo-950/95 to-cyan-950/95 border border-violet-500/40 text-violet-50",
  info: "bg-primary/15 border border-primary/30 text-foreground",
  warning: "bg-amber-950/90 border border-amber-500/40 text-amber-50",
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string {
  return new Date(local).toISOString();
}

const defaultStarts = () => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return toDatetimeLocal(d.toISOString());
};

export function AdminSiteBannerCard() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [href, setHref] = useState("");
  const [linkLabelMode, setLinkLabelMode] = useState<string>(LINK_LABEL_PRESETS[0]);
  const [linkLabelCustom, setLinkLabelCustom] = useState("");
  const [linkDisplay, setLinkDisplay] = useState<SiteBannerLinkDisplay>("cta_chevron");
  const [style, setStyle] = useState<SiteBannerStyle>("promo");
  const [startsAt, setStartsAt] = useState(defaultStarts);
  const [endsAt, setEndsAt] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [dismissible, setDismissible] = useState(true);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["/api/admin/site-banner"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/site-banner");
      return res.json() as Promise<SiteBannerRow[]>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const hasHref = href.trim().length > 0;
      const res = await apiRequest("POST", "/api/admin/site-banner", {
        message: message.trim(),
        href: hasHref ? href.trim() : null,
        linkLabel: hasHref ? effectiveLinkLabel || null : null,
        linkDisplay: hasHref ? linkDisplay : "cta_chevron",
        style,
        startsAt: localToIso(startsAt),
        endsAt: endsAt ? localToIso(endsAt) : null,
        isEnabled,
        dismissible,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/site-banner"] });
      queryClient.invalidateQueries({ queryKey: ["/api/site-banner"] });
      toast.success("Site banner created");
      setMessage("");
      setHref("");
      setLinkLabelMode(LINK_LABEL_PRESETS[0]);
      setLinkLabelCustom("");
      setLinkDisplay("cta_chevron");
    },
    onError: (e: unknown) => {
      const { title, description } = parseApiError(e, "Failed to create banner");
      toast.error(title, description ? { description } : undefined);
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<{ isEnabled: boolean }>;
    }) => {
      const res = await apiRequest("PATCH", `/api/admin/site-banner/${id}`, patch);
      return res.json();
    },
    onSuccess: (_data, { patch }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/site-banner"] });
      queryClient.invalidateQueries({ queryKey: ["/api/site-banner"] });
      if (patch.isEnabled !== undefined) {
        toast.success(patch.isEnabled ? "Banner enabled" : "Banner disabled");
      }
    },
    onError: (e: unknown) => {
      const { title, description } = parseApiError(e, "Update failed");
      toast.error(title, description ? { description } : undefined);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/site-banner/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/site-banner"] });
      queryClient.invalidateQueries({ queryKey: ["/api/site-banner"] });
      toast.success("Banner removed");
    },
    onError: (e: unknown) => {
      const { title, description } = parseApiError(e, "Delete failed");
      toast.error(title, description ? { description } : undefined);
    },
  });

  const effectiveLinkLabel =
    linkLabelMode === CUSTOM_LABEL ? linkLabelCustom.trim() : linkLabelMode;

  const previewStrip = useMemo(() => {
    if (!message.trim()) return null;
    const label = effectiveLinkLabel || "Learn more";
    const hasHref = href.trim().length > 0;
    return (
      <div
        className={cn(
          "rounded-md px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 text-center",
          PREVIEW_STYLE[style],
        )}
        data-testid="site-banner-admin-preview"
      >
        {hasHref && linkDisplay === "inline_link" ? (
          <span>
            {message.trim()}{" "}
            <span className="font-semibold underline underline-offset-2">{label}</span>
          </span>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 sm:flex-row sm:gap-2">
            <span className="break-words">{message.trim()}</span>
            {hasHref && (
              <span className="text-xs opacity-80 shrink-0">{label} →</span>
            )}
          </div>
        )}
      </div>
    );
  }, [message, href, style, linkDisplay, effectiveLinkLabel]);

  const handleCreate = () => {
    if (!message.trim()) {
      toast.error("Message is required");
      return;
    }
    if (!startsAt) {
      toast.error("Start time is required");
      return;
    }
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) {
      toast.error("End must be after start");
      return;
    }
    if (
      href.trim() &&
      linkLabelMode === CUSTOM_LABEL &&
      !linkLabelCustom.trim()
    ) {
      toast.error("Custom link text is required");
      return;
    }
    createMutation.mutate();
  };

  return (
    <Card data-testid="card-site-banner-admin">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-violet-500" />
          Site announcement banner
        </CardTitle>
        <CardDescription>
          Fixed strip at the top of every page for all visitors (including logged-out). Not the
          same as Notifications → broadcast (bell only).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <AlertDescription className="text-xs">
            Only one banner is shown publicly: the newest enabled row whose schedule includes now.
            Disable or set an end date to turn off without deleting history.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="banner-message">Message (max 200)</Label>
            <Input
              id="banner-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 200))}
              placeholder="New weekly markets are live — predict now"
              data-testid="input-site-banner-message"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="banner-href">Optional link (path or URL)</Label>
            <Input
              id="banner-href"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="/predict or https://..."
              data-testid="input-site-banner-href"
            />
          </div>
          {href.trim() && (
            <>
              <div className="space-y-2">
                <Label>Link text</Label>
                <Select value={linkLabelMode} onValueChange={setLinkLabelMode}>
                  <SelectTrigger data-testid="select-site-banner-link-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_LABEL_PRESETS.map((preset) => (
                      <SelectItem key={preset} value={preset}>
                        {preset}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_LABEL}>Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {linkLabelMode === CUSTOM_LABEL && (
                  <Input
                    value={linkLabelCustom}
                    onChange={(e) => setLinkLabelCustom(e.target.value.slice(0, 40))}
                    placeholder="Custom link text (max 40)"
                    data-testid="input-site-banner-link-label-custom"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Link style</Label>
                <Select
                  value={linkDisplay}
                  onValueChange={(v) => setLinkDisplay(v as SiteBannerLinkDisplay)}
                >
                  <SelectTrigger data-testid="select-site-banner-link-display">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cta_chevron">Separate CTA (chevron)</SelectItem>
                    <SelectItem value="inline_link">Inline link (Railway)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label>Style</Label>
            <Select value={style} onValueChange={(v) => setStyle(v as SiteBannerStyle)}>
              <SelectTrigger data-testid="select-site-banner-style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="promo">Promo (brand)</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="banner-starts">Starts (local)</Label>
            <Input
              id="banner-starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              data-testid="input-site-banner-starts"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="banner-ends">Ends (optional, local)</Label>
            <Input
              id="banner-ends"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              data-testid="input-site-banner-ends"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="banner-enabled"
              checked={isEnabled}
              onCheckedChange={setIsEnabled}
              data-testid="switch-site-banner-enabled"
            />
            <Label htmlFor="banner-enabled">Enabled</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="banner-dismissible"
              checked={dismissible}
              onCheckedChange={setDismissible}
              data-testid="switch-site-banner-dismissible"
            />
            <Label htmlFor="banner-dismissible">Dismissible (per tab session)</Label>
          </div>
        </div>

        {previewStrip && (
          <div className="space-y-2">
            <Label>Live preview</Label>
            {previewStrip}
          </div>
        )}

        <Button
          onClick={handleCreate}
          disabled={createMutation.isPending}
          data-testid="button-create-site-banner"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          Create banner
        </Button>

        <div className="space-y-2">
          <Label>Recent banners</Label>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !rows?.length ? (
            <p className="text-sm text-muted-foreground">No banners yet.</p>
          ) : (
            <div className="border rounded-lg divide-y overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="p-2 font-medium">Message</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium hidden md:table-cell">Schedule</th>
                    <th className="p-2 font-medium w-28">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} data-testid={`row-site-banner-${row.id}`}>
                      <td className="p-2 max-w-[220px]">
                        <div className="truncate" title={row.message}>
                          {row.message}
                        </div>
                        {row.href && (
                          <div className="mt-0.5 text-xs text-muted-foreground truncate">
                            {(row.linkLabel?.trim() || "Learn more")} ·{" "}
                            {(row.linkDisplay ?? "cta_chevron") === "inline_link"
                              ? "inline"
                              : "chevron"}
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                      </td>
                      <td className="p-2 hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.startsAt).toLocaleString()}
                        {row.endsAt
                          ? ` → ${new Date(row.endsAt).toLocaleString()}`
                          : " → open"}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={patchMutation.isPending}
                            onClick={() =>
                              patchMutation.mutate({
                                id: row.id,
                                patch: { isEnabled: !row.isEnabled },
                              })
                            }
                            data-testid={`button-toggle-site-banner-${row.id}`}
                          >
                            {row.isEnabled ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (confirm("Delete this banner?")) deleteMutation.mutate(row.id);
                            }}
                            data-testid={`button-delete-site-banner-${row.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
