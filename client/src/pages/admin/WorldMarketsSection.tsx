/**
 * World Markets admin section (Prediction CMS → World Markets tab).
 *
 * Extracted from AdminDashboard.tsx and rebuilt mobile-first:
 *  - tappable ops summary chips (needs resolution / closing soon / drafts / open)
 *  - filters collapse into a bottom drawer below `md`
 *  - market rows stack into touch-friendly cards with labeled Edit / Resolve
 *    buttons and an overflow menu for the destructive actions
 *  - a sticky bulk-action bar replaces the header bulk buttons on phones
 *
 * Desktop keeps the inline filter bar and single-row cards. The parent
 * (AdminDashboard) still owns the markets query and the create / edit /
 * settle / void / delete modals — this component only reports intents
 * upward via callbacks.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerClose,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  Archive,
  Clock,
  ExternalLink,
  Eye,
  Gamepad2,
  Gavel,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { normalizeMarketCategory } from "@shared/constants";
import { AdminSortableCardList } from "@/components/admin/AdminSortableCardList";
import { fetchWithAuth } from "@/pages/admin/adminAuth";
import { useVisualViewportOffset } from "@/hooks/useVisualViewportOffset";
import type { PredictionMarket } from "@/pages/admin/adminTypes";

type RwSortBy = "manual" | "created" | "endAt" | "fit";
type OpsPreset = "needs_resolution" | "closing_soon" | null;

const HOURS_48 = 48 * 60 * 60 * 1000;

/** OPEN live/inactive World Market the AI scout has marked as resolvable now. */
function isAiResolveNow(market: PredictionMarket): boolean {
  if (market.status !== "OPEN") return false;
  if (market.visibility !== "live" && market.visibility !== "inactive") return false;
  const assessment = (market.metadata as { scoutAssessment?: { recommendedAction?: string } } | null)
    ?.scoutAssessment;
  return assessment?.recommendedAction === "resolve_now";
}

interface WorldMarketsSectionProps {
  markets: PredictionMarket[] | undefined;
  marketsLoading: boolean;
  categoryOptions: { value: string; label: string }[];
  frontendSortMode: string;
  frontendSortPending: boolean;
  onFrontendSortChange: (mode: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onSettle: (id: string) => void;
  onVoid: (id: string) => void;
  onDelete: (market: { id: string; title: string }) => void;
  /** Deep-link preset for the visibility filter (e.g. ?vis=draft). */
  initialVisFilter?: string | null;
}

/**
 * Single state chip merging `status` and `visibility`. For OPEN markets the
 * operational state is the visibility (Draft / Live / Inactive / Archived);
 * once the market leaves OPEN, the status is what matters. AI-flagged
 * resolve_now markets (live/inactive only) get an extra "AI" badge
 * from the row renderer.
 */
function MarketStateChip({ market }: { market: PredictionMarket }) {
  if (market.status === "CLOSED_PENDING") {
    return (
      <Badge variant="outline" className="text-xs border-amber-500/40 dark:border-amber-500/30 text-amber-500">
        Needs resolution
      </Badge>
    );
  }
  if (market.status === "RESOLVED") {
    return <Badge variant="secondary" className="text-xs">Resolved</Badge>;
  }
  if (market.status === "VOID") {
    return (
      <Badge variant="outline" className="text-xs border-red-500/40 dark:border-red-500/30 text-red-500">
        Void
      </Badge>
    );
  }
  switch (market.visibility) {
    case "draft":
      return (
        <Badge variant="outline" className="text-xs border-yellow-500/40 dark:border-yellow-500/30 text-yellow-500">
          Draft
        </Badge>
      );
    case "live":
      return (
        <Badge variant="outline" className="text-xs border-green-500/40 dark:border-green-500/30 text-green-500">
          Live
        </Badge>
      );
    case "inactive":
      return (
        <Badge variant="outline" className="text-xs border-orange-500/40 dark:border-orange-500/30 text-orange-500">
          Inactive
        </Badge>
      );
    case "archived":
      return (
        <Badge variant="outline" className="text-xs border-red-500/40 dark:border-red-500/30 text-red-500">
          Archived
        </Badge>
      );
    default:
      return <Badge variant="default" className="text-xs">Open</Badge>;
  }
}

export function WorldMarketsSection({
  markets,
  marketsLoading,
  categoryOptions,
  frontendSortMode,
  frontendSortPending,
  onFrontendSortChange,
  onCreate,
  onEdit,
  onSettle,
  onVoid,
  onDelete,
  initialVisFilter,
}: WorldMarketsSectionProps) {
  const queryClient = useQueryClient();
  // Keeps the fixed bulk bar glued to the visible bottom edge on iOS WebKit
  // (same compensation the admin bottom nav applies).
  const viewportOffset = useVisualViewportOffset();

  const [search, setSearch] = useState("");
  const [visFilter, setVisFilterRaw] = useState(() =>
    initialVisFilter && ["draft", "live", "inactive", "archived"].includes(initialVisFilter)
      ? initialVisFilter
      : "all",
  );
  const [statusFilter, setStatusFilterRaw] = useState("all");
  const [catFilter, setCatFilterRaw] = useState("all");
  const [typeFilter, setTypeFilterRaw] = useState("all");
  const [sortBy, setSortBy] = useState<RwSortBy>("manual");
  const [opsPreset, setOpsPreset] = useState<OpsPreset>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchPublishing, setBatchPublishing] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [scoutRunning, setScoutRunning] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Manual filter changes drop the active ops chip so the visible list is
  // never constrained by an invisible extra filter.
  const setVisFilter = (v: string) => { setOpsPreset(null); setVisFilterRaw(v); };
  const setStatusFilter = (v: string) => { setOpsPreset(null); setStatusFilterRaw(v); };
  const setCatFilter = (v: string) => { setOpsPreset(null); setCatFilterRaw(v); };
  const setTypeFilter = (v: string) => { setOpsPreset(null); setTypeFilterRaw(v); };

  const communityMarkets = useMemo(
    () => (markets || []).filter((m) => m.marketType === "community"),
    [markets],
  );

  // Prune stale ids (deleted markets) so the bulk bar count stays honest.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(communityMarkets.map((m) => m.id));
      const next = new Set(Array.from(prev).filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [communityMarkets]);

  const opsCounts = useMemo(() => {
    const now = Date.now();
    let needsResolution = 0;
    let closingSoon = 0;
    let drafts = 0;
    let open = 0;
    for (const m of communityMarkets) {
      const end = new Date(m.endAt).getTime();
      if (
        m.status === "CLOSED_PENDING" ||
        (m.status === "OPEN" && end < now) ||
        isAiResolveNow(m)
      ) {
        needsResolution++;
      }
      if (m.status === "OPEN" && end >= now && end <= now + HOURS_48) closingSoon++;
      // Must match the chip's filter (visibility=draft) so count === list length.
      if (m.visibility === "draft") drafts++;
      if (m.status === "OPEN") open++;
    }
    return { needsResolution, closingSoon, drafts, open };
  }, [communityMarkets]);

  const resetFilters = () => {
    setOpsPreset(null);
    setVisFilterRaw("all");
    setStatusFilterRaw("all");
    setCatFilterRaw("all");
    setTypeFilterRaw("all");
    setSortBy("manual");
  };

  /** Chip presets reset the manual filters so the chip is the only filter. */
  const applyOpsPreset = (preset: Exclude<OpsPreset, null>) => {
    if (opsPreset === preset) {
      resetFilters();
      return;
    }
    setVisFilterRaw("all");
    setStatusFilterRaw("all");
    setCatFilterRaw("all");
    setTypeFilterRaw("all");
    setSortBy("endAt");
    setOpsPreset(preset);
  };

  const toggleDraftsChip = () => {
    const active = visFilter === "draft" && !opsPreset;
    resetFilters();
    if (!active) setVisFilterRaw("draft");
  };

  const toggleOpenChip = () => {
    const active = statusFilter === "OPEN" && !opsPreset;
    resetFilters();
    if (!active) setStatusFilterRaw("OPEN");
  };

  const rwMarkets = useMemo(() => {
    const now = Date.now();
    let list = [...communityMarkets];
    if (opsPreset === "needs_resolution") {
      list = list.filter((m) => {
        const end = new Date(m.endAt).getTime();
        return (
          m.status === "CLOSED_PENDING" ||
          (m.status === "OPEN" && end < now) ||
          isAiResolveNow(m)
        );
      });
    } else if (opsPreset === "closing_soon") {
      list = list.filter((m) => {
        const end = new Date(m.endAt).getTime();
        return m.status === "OPEN" && end >= now && end <= now + HOURS_48;
      });
    }
    if (visFilter !== "all") list = list.filter((m) => m.visibility === visFilter);
    if (catFilter !== "all") {
      list = list.filter((m) => normalizeMarketCategory(m.category) === catFilter);
    }
    if (statusFilter !== "all") list = list.filter((m) => m.status === statusFilter);
    if (typeFilter !== "all") list = list.filter((m) => m.openMarketType === typeFilter);
    if (search) list = list.filter((m) => m.title?.toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      if (sortBy === "manual") {
        const ao = a.cmsDisplayOrder ?? 0;
        const bo = b.cmsDisplayOrder ?? 0;
        if (ao !== bo) return ao - bo;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sortBy === "endAt") return new Date(a.endAt).getTime() - new Date(b.endAt).getTime();
      if (sortBy === "fit") {
        const readFit = (m: PredictionMarket) => {
          const fit = (m.metadata as { fitScore?: number } | null)?.fitScore;
          return typeof fit === "number" ? fit : -1;
        };
        const delta = readFit(b) - readFit(a);
        if (delta !== 0) return delta;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return list;
  }, [communityMarkets, opsPreset, search, visFilter, catFilter, statusFilter, typeFilter, sortBy]);

  const statusSummary = useMemo(() => {
    const open = rwMarkets.filter((m) => m.status === "OPEN").length;
    const resolved = rwMarkets.filter((m) => m.status === "RESOLVED").length;
    const other = rwMarkets.length - open - resolved;
    return { open, resolved, other };
  }, [rwMarkets]);

  const canReorder =
    visFilter === "all" &&
    catFilter === "all" &&
    statusFilter === "all" &&
    typeFilter === "all" &&
    !search.trim() &&
    sortBy === "manual" &&
    !opsPreset;

  const activeFilterCount =
    (visFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (catFilter !== "all" ? 1 : 0) +
    (typeFilter !== "all" ? 1 : 0) +
    (sortBy !== "manual" ? 1 : 0);

  const runBatchVisibility = async (visibility: "live" | "archived") => {
    setBatchPublishing(true);
    try {
      const resp = await apiRequest("POST", "/api/admin/open-markets/batch-visibility", {
        marketIds: Array.from(selectedIds),
        visibility,
      });
      const data = await resp.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      setSelectedIds(new Set());
      const skipped: Array<{ title: string }> = Array.isArray(data.skipped)
        ? data.skipped
        : [];
      if (visibility === "live") {
        if (skipped.length > 0) {
          // Publishing a settled source would hand agents a known winner, so
          // the server drops those from the batch instead of failing it.
          toast.warning(`${data.updated} published, ${skipped.length} skipped`, {
            description: `Source already settled: ${skipped
              .map((s) => s.title)
              .join(", ")}`,
          });
        } else {
          toast("Markets Published", { description: `${data.updated} markets set to live.` });
        }
      } else {
        toast("Markets Archived", { description: `${data.updated} markets archived.` });
      }
    } catch {
      toast.error("Error", {
        description: visibility === "live" ? "Failed to publish markets." : "Failed to archive markets.",
      });
    } finally {
      setBatchPublishing(false);
    }
  };

  const runBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBatchDeleting(true);
    try {
      const resp = await apiRequest("POST", "/api/admin/open-markets/batch-delete", {
        marketIds: ids,
      });
      const data = await resp.json() as {
        deleted?: number;
        failed?: number;
        failures?: { id: string; error: string; message?: string }[];
      };
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] });
      setConfirmBulkDelete(false);

      const deleted = data.deleted ?? 0;
      const failed = data.failed ?? 0;
      if (failed > 0) {
        const failedIds = new Set((data.failures ?? []).map((f) => f.id));
        setSelectedIds(failedIds);
        toast.error("Partial delete", {
          description: `Deleted ${deleted}, failed ${failed}. Failed rows stay selected.`,
        });
      } else {
        setSelectedIds(new Set());
        toast("Markets deleted", {
          description: `${deleted} world market${deleted === 1 ? "" : "s"} permanently removed.`,
        });
      }
    } catch {
      toast.error("Error", { description: "Failed to delete selected markets." });
    } finally {
      setBatchDeleting(false);
    }
  };

  const bulkBusy = batchPublishing || batchDeleting;

  const runScout = async () => {
    setScoutRunning(true);
    try {
      const resp = await apiRequest("POST", "/api/admin/market-scout/run");
      const data = await resp.json();
      if (data.sourceWatch?.resolvedUpstream > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
        toast("Source markets resolved", {
          description: `${data.sourceWatch.resolvedUpstream} scouted market(s) resolved upstream — winner pre-filled in Settlement.`,
        });
      }
      if (!data.enabled) {
        toast("Market Scout is disabled", {
          description: "Set MARKET_SCOUT_ENABLED=true on the server to enable scanning.",
        });
      } else if (data.budgetBlocked) {
        toast("Scout budget exhausted", {
          description: "Daily LLM budget reached — try again tomorrow or raise MARKET_SCOUT_DAILY_BUDGET_USD.",
        });
      } else if (data.created > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
        resetFilters();
        setVisFilterRaw("draft");
        const seriesNote =
          typeof data.seriesBlocked === "number" && data.seriesBlocked > 0
            ? `, ${data.seriesBlocked} blocked as series duplicates`
            : "";
        toast("Scout complete", {
          description: `${data.created} new draft${data.created === 1 ? "" : "s"} created (${data.deduped} already imported${seriesNote}). Review under Visibility: Draft.`,
        });
      } else {
        const seriesNote =
          typeof data.seriesBlocked === "number" && data.seriesBlocked > 0
            ? ` ${data.seriesBlocked} blocked as series duplicates.`
            : "";
        toast("Scout complete", {
          description: `No new drafts — ${data.fetched} trending candidates, ${data.deduped} already imported.${seriesNote}`,
        });
      }
    } catch {
      toast.error("Error", { description: "Market scout run failed." });
    } finally {
      setScoutRunning(false);
    }
  };

  const featureMutation = useMutation({
    mutationFn: async ({ id, featured }: { id: string; featured: boolean }) => {
      const res = await fetchWithAuth(`/api/admin/open-markets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to update market");
      }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] });
      toast(vars.featured ? "Market featured" : "Market unfeatured");
    },
    onError: (err: Error) => toast.error("Error", { description: err.message }),
  });

  const handleReorder = async (orderedIds: string[]) => {
    const res = await fetchWithAuth("/api/admin/open-markets/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err as { error?: string }).error || res.statusText;
      toast.error("Could not save order", { description: msg });
      throw new Error(msg || "Reorder failed");
    }
    toast.success("World market order saved");
    queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] });
  };

  // Shared between the desktop inline bar and the mobile filter drawer.
  const filterSelects: Array<{ key: string; label: string; el: React.ReactNode }> = [
    {
      key: "visibility",
      label: "Visibility",
      el: (
        <Select value={visFilter} onValueChange={setVisFilter}>
          <SelectTrigger className="w-full md:w-[150px] h-11 md:h-9">
            <SelectValue placeholder="Visibility" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All visibility</SelectItem>
            <SelectItem value="draft">Visibility: Draft</SelectItem>
            <SelectItem value="live">Visibility: Published</SelectItem>
            <SelectItem value="inactive">Visibility: Inactive</SelectItem>
            <SelectItem value="archived">Visibility: Archived</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      key: "status",
      label: "Status",
      el: (
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-[150px] h-11 md:h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="OPEN">Status: Open</SelectItem>
            <SelectItem value="CLOSED_PENDING">Status: Pending</SelectItem>
            <SelectItem value="RESOLVED">Status: Resolved</SelectItem>
            <SelectItem value="VOID">Status: Void</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      key: "category",
      label: "Category",
      el: (
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-full md:w-[120px] h-11 md:h-9">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categoryOptions.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      key: "type",
      label: "Type",
      el: (
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full md:w-[110px] h-11 md:h-9">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="binary">Yes/No</SelectItem>
            <SelectItem value="multi">Multi</SelectItem>
            <SelectItem value="updown">Up/Down</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      key: "sort",
      label: "Admin sort",
      el: (
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as RwSortBy)}>
          <SelectTrigger className="w-full md:w-[140px] h-11 md:h-9">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual order</SelectItem>
            <SelectItem value="endAt">Resolution date</SelectItem>
            <SelectItem value="created">Newest first</SelectItem>
            <SelectItem value="fit">Fit score</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      key: "frontend-sort",
      label: "Public feed sort (applies to every user)",
      el: (
        <Select
          value={frontendSortMode}
          onValueChange={onFrontendSortChange}
          disabled={frontendSortPending}
        >
          <SelectTrigger className="w-full md:w-[210px] h-11 md:h-9" data-testid="select-frontend-sort">
            <SelectValue placeholder="Front-end sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="volume">Front-end: Volume (default)</SelectItem>
            <SelectItem value="newest">Front-end: Newest first</SelectItem>
            <SelectItem value="manual">Front-end: Manual order</SelectItem>
            <SelectItem value="endAt">Front-end: Resolution date</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
  ];

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>World Markets</CardTitle>
          <CardDescription>Prediction markets for real-world events</CardDescription>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="default"
              className="hidden md:inline-flex"
              disabled={bulkBusy}
              onClick={() => runBatchVisibility("live")}
              data-testid="button-batch-publish"
            >
              {batchPublishing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
              Publish {selectedIds.size}
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="hidden md:inline-flex"
              disabled={bulkBusy}
              onClick={() => runBatchVisibility("archived")}
              data-testid="button-batch-archive"
            >
              Archive {selectedIds.size}
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="hidden md:inline-flex text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              disabled={bulkBusy}
              onClick={() => setConfirmBulkDelete(true)}
              data-testid="button-batch-delete"
            >
              {batchDeleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Delete {selectedIds.size}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={scoutRunning}
            onClick={runScout}
            data-testid="button-market-scout-run"
          >
            {scoutRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {scoutRunning ? "Scanning..." : "Scan now"}
          </Button>
          <Button onClick={onCreate} size="sm" data-testid="button-create-rw-market">
            <Plus className="h-4 w-4 mr-1" />
            Create
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Ops summary chips — one-tap filter presets for on-the-go triage. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <button
            type="button"
            onClick={() => applyOpsPreset("needs_resolution")}
            aria-pressed={opsPreset === "needs_resolution"}
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              opsPreset === "needs_resolution"
                ? "border-amber-500/60 bg-amber-500/10"
                : "hover:bg-muted/50"
            }`}
            data-testid="chip-needs-resolution"
          >
            <p className={`text-lg font-bold leading-tight ${opsCounts.needsResolution > 0 ? "text-amber-500" : ""}`}>
              {opsCounts.needsResolution}
            </p>
            <p className="text-xs text-muted-foreground">Needs resolution</p>
          </button>
          <button
            type="button"
            onClick={() => applyOpsPreset("closing_soon")}
            aria-pressed={opsPreset === "closing_soon"}
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              opsPreset === "closing_soon"
                ? "border-sky-500/60 bg-sky-500/10"
                : "hover:bg-muted/50"
            }`}
            data-testid="chip-closing-soon"
          >
            <p className="text-lg font-bold leading-tight">{opsCounts.closingSoon}</p>
            <p className="text-xs text-muted-foreground">Closing in 48h</p>
          </button>
          <button
            type="button"
            onClick={toggleDraftsChip}
            aria-pressed={visFilter === "draft" && !opsPreset}
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              visFilter === "draft" && !opsPreset
                ? "border-yellow-500/60 bg-yellow-500/10"
                : "hover:bg-muted/50"
            }`}
            data-testid="chip-drafts"
          >
            <p className={`text-lg font-bold leading-tight ${opsCounts.drafts > 0 ? "text-yellow-500" : ""}`}>
              {opsCounts.drafts}
            </p>
            <p className="text-xs text-muted-foreground">Drafts to review</p>
          </button>
          <button
            type="button"
            onClick={toggleOpenChip}
            aria-pressed={statusFilter === "OPEN" && !opsPreset}
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              statusFilter === "OPEN" && !opsPreset
                ? "border-green-500/60 bg-green-500/10"
                : "hover:bg-muted/50"
            }`}
            data-testid="chip-open"
          >
            <p className="text-lg font-bold leading-tight">{opsCounts.open}</p>
            <p className="text-xs text-muted-foreground">Open markets</p>
          </button>
        </div>

        {/* Mobile: search + Filters drawer trigger */}
        <div className="md:hidden mb-4 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 h-11"
              data-testid="input-rw-market-search"
            />
            <Button
              variant="outline"
              className="h-11 shrink-0 relative"
              onClick={() => setFiltersOpen(true)}
              data-testid="button-open-filters"
            >
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {rwMarkets.length} shown
            {rwMarkets.length > 0 && (
              <>
                {" "}
                · {statusSummary.open} open
                {statusSummary.resolved > 0 ? `, ${statusSummary.resolved} resolved` : ""}
                {statusSummary.other > 0 ? `, ${statusSummary.other} other` : ""}
              </>
            )}
          </p>
        </div>

        <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
          <DrawerContent className="max-h-[88dvh]">
            <DrawerHeader className="pb-2">
              <DrawerTitle>Filters</DrawerTitle>
            </DrawerHeader>
            <div className="space-y-3 overflow-y-auto px-4 pb-2">
              {filterSelects.map((f) => (
                <div
                  key={f.key}
                  className={`space-y-1.5 ${f.key === "frontend-sort" ? "border-t pt-3" : ""}`}
                >
                  <Label className="text-xs text-muted-foreground">{f.label}</Label>
                  {f.el}
                </div>
              ))}
            </div>
            <DrawerFooter
              className="flex-row gap-2"
              style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <Button variant="outline" className="flex-1 h-11" onClick={resetFilters} data-testid="button-reset-filters">
                Reset
              </Button>
              <DrawerClose asChild>
                <Button className="flex-1 h-11" data-testid="button-apply-filters">
                  Show {rwMarkets.length} result{rwMarkets.length === 1 ? "" : "s"}
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        {/* Desktop: inline filter bar */}
        <div className="hidden md:flex items-center gap-2 mb-4 flex-wrap">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[160px]"
            data-testid="input-rw-market-search-desktop"
          />
          {filterSelects.map((f) => (
            <Fragment key={f.key}>{f.el}</Fragment>
          ))}
          <span className="text-xs text-muted-foreground ml-auto">
            {rwMarkets.length} shown
            {rwMarkets.length > 0 && (
              <>
                {" "}
                · {statusSummary.open} open
                {statusSummary.resolved > 0 ? `, ${statusSummary.resolved} resolved` : ""}
                {statusSummary.other > 0 ? `, ${statusSummary.other} other` : ""}
              </>
            )}
          </span>
        </div>

        {marketsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : rwMarkets.length > 0 ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 px-3 pb-1 w-fit cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.size === rwMarkets.length && rwMarkets.length > 0}
                onChange={(e) => {
                  if (e.target.checked) setSelectedIds(new Set(rwMarkets.map((m) => m.id)));
                  else setSelectedIds(new Set());
                }}
                className="rounded h-4 w-4"
              />
              <span className="text-xs text-muted-foreground">Select all</span>
            </label>
            <AdminSortableCardList
              items={rwMarkets}
              disabled={!canReorder}
              disabledReason={
                !canReorder
                  ? "Choose \"Manual order\" in Sort and clear all filters and search to drag rows into your preferred order."
                  : undefined
              }
              listClassName="space-y-2"
              onReorder={handleReorder}
              renderItem={(market, { dragHandle }) => {
                const daysUntilEnd = Math.ceil((new Date(market.endAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                const resolvesSoon = daysUntilEnd >= 0 && daysUntilEnd <= 7 && market.status === "OPEN";
                const overdue = daysUntilEnd < 0 && (market.status === "OPEN" || market.status === "CLOSED_PENDING");
                const canResolve = market.status === "OPEN" || market.status === "CLOSED_PENDING";
                const meta = market.metadata as
                  | {
                      source?: {
                        provider?: string;
                        url?: string;
                        upstreamResolvedAt?: string;
                      };
                      fitScore?: number;
                      draftHealth?: { flags?: string[]; reviewExpiresAt?: string | null };
                    }
                  | null
                  | undefined;
                const sourceUrl = meta?.source?.url;
                // Triage at a glance: a draft whose source already settled can
                // never be published, and a stale one needs a second look.
                const sourceResolved = !!meta?.source?.upstreamResolvedAt;
                const healthFlags = Array.isArray(meta?.draftHealth?.flags)
                  ? meta!.draftHealth!.flags!
                  : [];
                // Unreviewed drafts clear themselves out after the review
                // window. The server stamps the deadline only while the
                // policy is switched on, so an absent value means nothing
                // expires — never infer a countdown from createdAt here.
                // Still gated on draft: the stamp is written while a market is
                // a draft and isn't cleared on publish, so a live row would
                // otherwise keep claiming it was about to clear itself out.
                const reviewExpiresAt =
                  market.visibility === "draft"
                    ? (meta?.draftHealth?.reviewExpiresAt ?? null)
                    : null;
                const reviewHoursLeft = reviewExpiresAt
                  ? Math.ceil(
                      (new Date(reviewExpiresAt).getTime() - Date.now()) / 3600_000,
                    )
                  : null;
                const staleLabel = healthFlags.includes("book_oversubscribed")
                  ? "Odds broken"
                  : healthFlags.includes("book_short")
                    ? "Odds short"
                    : healthFlags.includes("schedule_drift")
                      ? "Rescheduled"
                      : null;
                return (
                  <div
                    className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 p-3 rounded-lg border"
                    data-testid={`market-row-${market.id}`}
                  >
                    <div className="flex items-start md:items-center gap-2 min-w-0 flex-1">
                      {/* Drag reorder is a laptop task — dnd-kit fights touch scrolling. */}
                      {dragHandle ? <span className="hidden md:inline-flex shrink-0">{dragHandle}</span> : null}
                      <label className="flex items-center shrink-0 p-1 -m-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(market.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(market.id);
                            else next.delete(market.id);
                            setSelectedIds(next);
                          }}
                          className="rounded h-4 w-4"
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug line-clamp-2 md:line-clamp-1">{market.title}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <MarketStateChip market={market} />
                          {isAiResolveNow(market) && (
                            <Badge
                              variant="outline"
                              className="text-xs border-amber-500/40 dark:border-amber-500/30 text-amber-500"
                              data-testid={`badge-ai-resolve-${market.id}`}
                            >
                              AI: resolve now
                            </Badge>
                          )}
                          {market.openMarketType && (
                            <Badge variant="outline" className="text-xs">
                              {market.openMarketType === "binary" ? "Yes/No" :
                               market.openMarketType === "multi" ? "Multi" : "Up/Down"}
                            </Badge>
                          )}
                          {market.category && (
                            <Badge variant="outline" className="text-xs capitalize">{market.category}</Badge>
                          )}
                          {market.featured && (
                            <Badge variant="outline" className="text-xs border-yellow-500/40 dark:border-yellow-500/30 text-yellow-500">
                              <Star className="h-3 w-3 mr-1" />Featured
                            </Badge>
                          )}
                          {resolvesSoon && (
                            <Badge variant="outline" className="text-xs border-amber-500/40 dark:border-amber-500/30 text-amber-500">
                              <Clock className="h-3 w-3 mr-1" />Resolves soon
                            </Badge>
                          )}
                          {overdue && (
                            <Badge variant="outline" className="text-xs border-red-500/40 dark:border-red-500/30 text-red-600 dark:text-red-400">
                              <AlertTriangle className="h-3 w-3 mr-1" />Overdue
                            </Badge>
                          )}
                          {market.personId && (
                            <Badge variant="outline" className="text-xs border-purple-500/40 dark:border-purple-500/30 text-purple-600 dark:text-purple-400">
                              Linked
                            </Badge>
                          )}
                          {sourceResolved && (
                            <Badge
                              variant="outline"
                              className="text-xs border-red-500/40 dark:border-red-500/30 text-red-600 dark:text-red-400"
                              title="Polymarket has already settled this event — it can't be published"
                              data-testid={`badge-source-resolved-${market.id}`}
                            >
                              <AlertTriangle className="h-3 w-3 mr-1" />Source settled
                            </Badge>
                          )}
                          {!sourceResolved && staleLabel && (
                            <Badge
                              variant="outline"
                              className="text-xs border-amber-500/40 dark:border-amber-500/30 text-amber-600 dark:text-amber-400"
                              title="The source has changed since this was drafted — re-check before publishing"
                              data-testid={`badge-draft-stale-${market.id}`}
                            >
                              {staleLabel}
                            </Badge>
                          )}
                          {meta?.source?.provider && (() => {
                            const label = meta.source!.provider === "polymarket" ? "Polymarket" : meta.source!.provider;
                            const chip = (
                              <Badge variant="outline" className="text-xs border-sky-500/40 dark:border-sky-500/30 text-sky-600 dark:text-sky-400">
                                <Sparkles className="h-3 w-3 mr-1" />
                                {label}
                                {typeof meta.fitScore === "number" ? ` · Fit ${meta.fitScore}` : ""}
                              </Badge>
                            );
                            return sourceUrl ? (
                              <a
                                href={sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex"
                                title="Open source market"
                                data-testid={`link-scout-source-${market.id}`}
                              >
                                {chip}
                              </a>
                            ) : chip;
                          })()}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {daysUntilEnd >= 0
                            ? `Resolves in ${daysUntilEnd}d`
                            : `Ended ${Math.abs(daysUntilEnd)}d ago`}
                          {" · "}{new Date(market.endAt).toLocaleDateString()}
                          {reviewHoursLeft !== null && (
                            <span
                              className={
                                reviewHoursLeft <= 24
                                  ? "text-amber-600 dark:text-amber-400"
                                  : undefined
                              }
                              data-testid={`text-review-window-${market.id}`}
                            >
                              {" · "}
                              {reviewHoursLeft > 0
                                ? `clears in ${reviewHoursLeft}h if not published`
                                : "clearing out"}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 md:shrink-0 pl-7 md:pl-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 md:flex-none h-10 md:h-9"
                        onClick={() => onEdit(market.id)}
                        data-testid={`button-edit-market-${market.id}`}
                      >
                        <Pencil className="h-4 w-4 mr-1.5" />
                        Edit
                      </Button>
                      {canResolve && (
                        <Button
                          variant="default"
                          size="sm"
                          className="flex-1 md:flex-none h-10 md:h-9"
                          onClick={() => onSettle(market.id)}
                          data-testid={`button-settle-${market.id}`}
                        >
                          <Gavel className="h-4 w-4 mr-1.5" />
                          Resolve
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 md:h-9 md:w-9 shrink-0"
                            aria-label="More actions"
                            data-testid={`button-more-${market.id}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {market.status === "OPEN" && (
                            <DropdownMenuItem
                              onClick={() => featureMutation.mutate({ id: market.id, featured: !market.featured })}
                              disabled={featureMutation.isPending}
                            >
                              <Star className="h-4 w-4 mr-2" />
                              {market.featured ? "Unfeature" : "Feature"}
                            </DropdownMenuItem>
                          )}
                          {sourceUrl && (
                            <DropdownMenuItem asChild>
                              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4 mr-2" />
                                Open source market
                              </a>
                            </DropdownMenuItem>
                          )}
                          {(market.status === "OPEN" || sourceUrl) && <DropdownMenuSeparator />}
                          {market.status === "OPEN" && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => onVoid(market.id)}
                              data-testid={`button-void-${market.id}`}
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              Void &amp; refund
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => onDelete({ id: market.id, title: market.title })}
                            data-testid={`button-delete-world-market-${market.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete permanently
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              }}
            />
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Gamepad2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No World Markets match your filters</p>
            <Button className="mt-4" onClick={onCreate} data-testid="button-create-first-market">
              <Plus className="h-4 w-4 mr-2" />
              Create First Market
            </Button>
          </div>
        )}

        {/* Sticky bulk-action bar (mobile) — sits above the admin bottom nav.
            The spacer keeps the last row's buttons reachable under the bar. */}
        {selectedIds.size > 0 && <div className="h-20 md:hidden" aria-hidden="true" />}
        {selectedIds.size > 0 && (
          <div
            className="md:hidden fixed inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl px-3 py-2"
            style={{
              bottom: "calc(64px + env(safe-area-inset-bottom, 0px))",
              transform: viewportOffset !== 0 ? `translateY(${viewportOffset}px)` : undefined,
            }}
            data-testid="bulk-action-bar"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium shrink-0">{selectedIds.size} selected</span>
              <Button
                size="sm"
                className="flex-1 h-10"
                disabled={bulkBusy}
                onClick={() => runBatchVisibility("live")}
                data-testid="button-bulk-publish-mobile"
              >
                {batchPublishing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
                Publish
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-10"
                disabled={bulkBusy}
                onClick={() => runBatchVisibility("archived")}
                data-testid="button-bulk-archive-mobile"
              >
                <Archive className="h-4 w-4 mr-1" />
                Archive
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-10 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                disabled={bulkBusy}
                onClick={() => setConfirmBulkDelete(true)}
                data-testid="button-bulk-delete-mobile"
              >
                {batchDeleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                Delete
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-10 w-10 p-0 shrink-0"
                onClick={() => setSelectedIds(new Set())}
                aria-label="Clear selection"
                data-testid="button-bulk-clear"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>

    <Dialog
      open={confirmBulkDelete}
      onOpenChange={(open) => {
        if (!batchDeleting) setConfirmBulkDelete(open);
      }}
    >
      <DialogContent className="max-w-md" data-testid="dialog-batch-delete-world-markets">
        <DialogHeader>
          <DialogTitle>
            Delete {selectedIds.size} world market{selectedIds.size === 1 ? "" : "s"} permanently?
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              This removes the selected markets from the database and admin list.
            </span>
            <span className="block text-destructive/90">
              If any market is still open, active stakes are refunded first (same as void). Resolved
              history for those markets will be removed. This cannot be undone.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={batchDeleting}
            onClick={() => setConfirmBulkDelete(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={batchDeleting || selectedIds.size === 0}
            onClick={runBatchDelete}
            data-testid="button-confirm-batch-delete-world-markets"
          >
            {batchDeleting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
