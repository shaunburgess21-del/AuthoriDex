import { useState, useMemo, useEffect, useRef, type ReactElement } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { normalizeMarketCategory, MARKET_CATEGORY_OPTIONS } from "@shared/constants";
import { SOCIAL_HANDLE_HELP } from "@shared/handleNormalise";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Check, X, Search, Trash2, Edit2, ImagePlus, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AdminCategoryMultiSelect } from "@/components/admin/AdminCategoryMultiSelect";

const HOVER_TOOLTIP_MEDIA = "(hover: hover) and (pointer: fine)";
const MAX_INDUCTION_GALLERY = 5;

const INDUCTION_STATUS_OPTIONS = ["Queue", "Inactive", "Archived", "Rejected", "Inducted"] as const;

type InductionFormData = {
  displayName: string;
  category: string;
  secondaryCategories: string[];
  imageSlug: string;
  wikiSlug: string;
  seedVotes: number;
  inductionStatus: string;
  searchQueryOverride: string;
  xHandle: string;
  instagramHandle: string;
  tiktokHandle: string;
  youtubeId: string;
  spotifyId: string;
  googleTrendsTopicId: string;
};

const EMPTY_FORM: InductionFormData = {
  displayName: "",
  category: "tech",
  secondaryCategories: [],
  imageSlug: "",
  wikiSlug: "",
  seedVotes: 0,
  inductionStatus: "Queue",
  searchQueryOverride: "",
  xHandle: "",
  instagramHandle: "",
  tiktokHandle: "",
  youtubeId: "",
  spotifyId: "",
  googleTrendsTopicId: "",
};

function formDataToApiBody(form: InductionFormData): Record<string, unknown> {
  return {
    displayName: form.displayName,
    category: form.category,
    secondaryCategories: form.secondaryCategories,
    imageSlug: form.imageSlug.trim() || undefined,
    wikiSlug: form.wikiSlug.trim() || null,
    seedVotes: form.seedVotes,
    inductionStatus: form.inductionStatus,
    searchQueryOverride: form.searchQueryOverride.trim() || null,
    xHandle: form.xHandle,
    instagramHandle: form.instagramHandle,
    tiktokHandle: form.tiktokHandle,
    youtubeId: form.youtubeId,
    spotifyId: form.spotifyId,
    googleTrendsTopicId: form.googleTrendsTopicId.trim() || null,
  };
}

async function uploadInductionGallerySlot(candidateId: string, file: File, slot?: number): Promise<void> {
  const fd = new FormData();
  fd.append("file", file);
  if (slot !== undefined) {
    fd.append("slot", String(slot));
  }
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/admin/induction/${candidateId}/images`, {
    method: "POST",
    headers,
    body: fd,
    credentials: "include",
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

/** Hover tooltips only on fine-pointer + hover-capable devices (avoids Radix press-to-open on touch). */
function DesktopActionTooltip({ children, content }: { children: ReactElement; content: string }) {
  const [supportsHoverTooltip, setSupportsHoverTooltip] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(HOVER_TOOLTIP_MEDIA);
    const update = () => setSupportsHoverTooltip(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!supportsHoverTooltip) {
    return children;
  }

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-[260px]">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

interface InductionCandidate {
  id: string;
  displayName: string;
  category: string;
  secondaryCategories?: string[] | null;
  imageSlug: string | null;
  avatar: string | null;
  seedVotes: number;
  wikiSlug: string | null;
  xHandle?: string | null;
  instagramHandle?: string | null;
  tiktokHandle?: string | null;
  youtubeId?: string | null;
  spotifyId?: string | null;
  searchQueryOverride?: string | null;
  googleTrendsTopicId?: string | null;
  inductionStatus?: string | null;
  isActive: boolean;
}

type PendingInductionAction = { kind: "approve" | "delete"; candidate: InductionCandidate };

type AdminCategoryRow = { id: string; label: string; sortOrder: number };

export function AdminInductionQueue() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editCandidate, setEditCandidate] = useState<InductionCandidate | null>(null);
  const [formData, setFormData] = useState<InductionFormData>({ ...EMPTY_FORM });
  const [pendingGalleryFiles, setPendingGalleryFiles] = useState<File[]>([]);
  const [trendsLookupLoading, setTrendsLookupLoading] = useState(false);
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<PendingInductionAction | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const { data: adminCategoryRows } = useQuery<AdminCategoryRow[]>({
    queryKey: ["/api/admin/categories"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/categories");
      if (!res.ok) throw new Error("Failed to fetch categories");
      return res.json();
    },
  });

  const categorySelectOptions = useMemo(() => {
    const rows = adminCategoryRows ?? [];
    if (rows.length > 0) {
      return [...rows]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id))
        .map((r) => ({ value: r.id, label: r.label }));
    }
    return MARKET_CATEGORY_OPTIONS.map((c) => ({ value: c.value, label: c.label }));
  }, [adminCategoryRows]);

  const { data, isLoading } = useQuery<{ data: InductionCandidate[]; totalCount: number }>({
    queryKey: ["/api/admin/induction"],
  });

  const resetForm = () => {
    setFormData({ ...EMPTY_FORM });
    setPendingGalleryFiles([]);
  };

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown> & { galleryFiles: File[] }) => {
      const { galleryFiles, ...body } = payload;
      const res = await apiRequest("POST", "/api/admin/induction", body);
      const created = (await res.json()) as { id: string };
      const uploadFailures: string[] = [];
      for (const file of galleryFiles.slice(0, MAX_INDUCTION_GALLERY)) {
        try {
          await uploadInductionGallerySlot(created.id, file);
        } catch (err: any) {
          uploadFailures.push(`${file.name}: ${err?.message || "upload failed"}`);
        }
      }
      return { created, uploadFailures };
    },
    onSuccess: ({ uploadFailures }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vote/induction"] });
      setShowCreateDialog(false);
      resetForm();
      if (uploadFailures.length > 0) {
        toast.error("Candidate created", {
          description: `Image upload issues: ${uploadFailures.slice(0, 2).join(" · ")}${uploadFailures.length > 2 ? " …" : ""}`,
        });
      } else {
        toast("Candidate Created");
      }
    },
    onError: (err: Error) => {
      toast.error(err?.message || "Failed to create candidate");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string; galleryFiles: File[] } & Record<string, unknown>) => {
      const { id, galleryFiles, ...body } = payload;
      await apiRequest("PATCH", `/api/admin/induction/${id}`, body);
      const uploadFailures: string[] = [];
      for (const file of galleryFiles.slice(0, MAX_INDUCTION_GALLERY)) {
        try {
          await uploadInductionGallerySlot(id, file);
        } catch (err: any) {
          uploadFailures.push(`${file.name}: ${err?.message || "upload failed"}`);
        }
      }
      return { uploadFailures };
    },
    onSuccess: ({ uploadFailures }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vote/induction"] });
      setEditCandidate(null);
      resetForm();
      if (uploadFailures.length > 0) {
        toast.error("Candidate updated", {
          description: `Image upload issues: ${uploadFailures.slice(0, 2).join(" · ")}${uploadFailures.length > 2 ? " …" : ""}`,
        });
      } else {
        toast("Candidate Updated");
      }
    },
    onError: (err: Error) => {
      toast.error(err?.message || "Failed to update candidate");
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/induction/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vote/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      toast("Candidate Approved", { description: "Added to leaderboard with all native modules." });
    },
    onError: () => toast.error("Failed to approve candidate"),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/admin/induction/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vote/induction"] });
      toast("Candidate Deactivated");
    },
    onError: () => toast.error("Failed to deactivate candidate"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/induction/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vote/induction"] });
      toast("Candidate Deleted");
    },
    onError: () => toast.error("Failed to delete candidate"),
  });

  const confirmPendingDestructiveAction = () => {
    if (!pendingDestructiveAction) return;
    const { kind, candidate } = pendingDestructiveAction;
    const clearPending = () => setPendingDestructiveAction(null);
    if (kind === "approve") {
      approveMutation.mutate(candidate.id, { onSettled: clearPending });
    } else {
      deleteMutation.mutate(candidate.id, { onSettled: clearPending });
    }
  };

  const isPendingDestructiveConfirm =
    (pendingDestructiveAction?.kind === "approve" && approveMutation.isPending) ||
    (pendingDestructiveAction?.kind === "delete" && deleteMutation.isPending);

  const openEdit = (c: InductionCandidate) => {
    setEditCandidate(c);
    setPendingGalleryFiles([]);
    setFormData({
      displayName: c.displayName,
      category: normalizeMarketCategory(c.category),
      secondaryCategories: (c.secondaryCategories as string[] | null) ?? [],
      imageSlug: c.imageSlug || "",
      wikiSlug: c.wikiSlug || "",
      seedVotes: c.seedVotes,
      inductionStatus: c.inductionStatus || "Queue",
      searchQueryOverride: c.searchQueryOverride || "",
      xHandle: c.xHandle || "",
      instagramHandle: c.instagramHandle || "",
      tiktokHandle: c.tiktokHandle || "",
      youtubeId: c.youtubeId || "",
      spotifyId: c.spotifyId || "",
      googleTrendsTopicId: c.googleTrendsTopicId || "",
    });
  };

  const candidates = data?.data || [];
  const inQueueCount = useMemo(() => candidates.filter((c) => c.isActive).length, [candidates]);
  const historyCount = candidates.length - inQueueCount;
  const filteredCandidates = candidates.filter((c) => {
    if (searchQuery && !c.displayName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter === "active" && !c.isActive) return false;
    if (statusFilter === "inactive" && c.isActive) return false;
    return true;
  });
  const listSummary = useMemo(() => {
    if (statusFilter === "active") {
      return `${filteredCandidates.length} in queue`;
    }
    if (statusFilter === "inactive") {
      return `${filteredCandidates.length} promoted or removed (history)`;
    }
    return `${inQueueCount} in queue · ${historyCount} in history · ${candidates.length} total records`;
  }, [statusFilter, filteredCandidates.length, inQueueCount, historyCount, candidates.length]);

  const handleSubmit = () => {
    if (!formData.displayName || !formData.category) return;
    const body = formDataToApiBody(formData);
    const galleryFiles = pendingGalleryFiles.slice(0, MAX_INDUCTION_GALLERY);
    if (editCandidate) {
      updateMutation.mutate({ id: editCandidate.id, ...body, galleryFiles });
    } else {
      createMutation.mutate({ ...body, galleryFiles });
    }
  };

  const handleGalleryFilesPick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPendingGalleryFiles((prev) => {
      const next = [...prev];
      for (const file of Array.from(files)) {
        if (next.length >= MAX_INDUCTION_GALLERY) break;
        next.push(file);
      }
      if (next.length === prev.length) {
        toast.error(`You can upload up to ${MAX_INDUCTION_GALLERY} images.`);
      }
      return next;
    });
  };

  const closeDialog = () => {
    setShowCreateDialog(false);
    setEditCandidate(null);
    resetForm();
  };

  const canStageUploads = !createMutation.isPending && !updateMutation.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Induction Queue</CardTitle>
              <CardDescription>Manage new celebrity nominations for community voting</CardDescription>
            </div>
            <Button
              onClick={() => {
                resetForm();
                setShowCreateDialog(true);
              }}
              data-testid="button-create-candidate"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Candidate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-induction-admin-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[220px]" data-testid="select-induction-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">In Queue</SelectItem>
                <SelectItem value="inactive">Promoted &amp; Removed</SelectItem>
                <SelectItem value="all">All Records</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="text-sm text-muted-foreground mb-3">
            {listSummary}
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading candidates...</div>
          ) : filteredCandidates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No candidates found. Click &quot;Add Candidate&quot; to create one.</div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Name</th>
                    <th className="text-left p-3 font-medium">Category</th>
                    <th className="text-right p-3 font-medium">Seed Votes</th>
                    <th className="text-center p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((candidate) => (
                    <tr key={candidate.id} className="border-b last:border-b-0 hover-elevate" data-testid={`row-induction-${candidate.id}`}>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <PersonAvatar name={candidate.displayName} avatar={candidate.avatar} imageSlug={candidate.imageSlug} imageContext="induction" size="xs" />
                          <span className="font-medium">{candidate.displayName}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {candidate.category}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-mono">{candidate.seedVotes}</td>
                      <td className="p-3 text-center">
                        {candidate.isActive ? (
                          <Badge className="bg-emerald-500/25 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 dark:border-emerald-500/30">
                            In Queue
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            {candidate.inductionStatus && candidate.inductionStatus !== "Queue"
                              ? candidate.inductionStatus
                              : "Removed"}
                          </Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-2">
                          {candidate.isActive && (
                            <>
                              <DesktopActionTooltip content="Approve and add this candidate to the main leaderboard (full profile).">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-emerald-600 dark:text-emerald-400"
                                  onClick={() => setPendingDestructiveAction({ kind: "approve", candidate })}
                                  disabled={approveMutation.isPending}
                                  aria-label="Approve"
                                  data-testid={`button-approve-${candidate.id}`}
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                              </DesktopActionTooltip>
                              <DesktopActionTooltip content="Deactivate this candidate so they no longer appear in the Induction Queue.">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-red-600 dark:text-red-400"
                                  onClick={() => rejectMutation.mutate(candidate.id)}
                                  disabled={rejectMutation.isPending}
                                  aria-label="Reject"
                                  data-testid={`button-reject-${candidate.id}`}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </DesktopActionTooltip>
                            </>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(candidate)}
                            aria-label="Edit"
                            data-testid={`button-edit-${candidate.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-600 dark:text-red-400"
                            onClick={() => setPendingDestructiveAction({ kind: "delete", candidate })}
                            disabled={deleteMutation.isPending}
                            aria-label="Delete"
                            data-testid={`button-delete-${candidate.id}`}
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
        </CardContent>
      </Card>

      <Dialog
        open={showCreateDialog || !!editCandidate}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editCandidate ? "Edit Candidate" : "Add New Candidate"}</DialogTitle>
            <DialogDescription>
              {editCandidate ? "Update candidate details" : "Add a new celebrity to the induction queue"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Identity</p>
              <div>
                <Label>Display Name *</Label>
                <Input
                  value={formData.displayName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, displayName: e.target.value }))}
                  placeholder="Full name"
                  data-testid="input-candidate-name"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Category *</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData((prev) => ({ ...prev, category: v }))}>
                    <SelectTrigger data-testid="select-candidate-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categorySelectOptions.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Candidate workflow status</Label>
                  <Select
                    value={formData.inductionStatus}
                    onValueChange={(v) => setFormData((prev) => ({ ...prev, inductionStatus: v }))}
                  >
                    <SelectTrigger data-testid="select-candidate-induction-status">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUCTION_STATUS_OPTIONS.map((st) => (
                        <SelectItem key={st} value={st}>
                          {st}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Not the same as Main leaderboard vs Induction in Celebrities—this is the vote card lifecycle.</p>
                </div>
              </div>
              <AdminCategoryMultiSelect
                options={categorySelectOptions}
                value={formData.secondaryCategories}
                onChange={(next) => setFormData((prev) => ({ ...prev, secondaryCategories: next }))}
                primaryValue={formData.category}
                testId="candidate-secondary-categories"
              />
              <div>
                <Label>Image Slug</Label>
                <Input
                  value={formData.imageSlug}
                  onChange={(e) => setFormData((prev) => ({ ...prev, imageSlug: e.target.value }))}
                  placeholder="auto-generated from name if blank on save"
                  data-testid="input-candidate-image-slug"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Used for vote-page images and for staging files under <code className="text-xs">celebrity-large/&lt;slug&gt;/</code> before
                  induction.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Wiki Slug</Label>
                  <Input
                    value={formData.wikiSlug}
                    onChange={(e) => setFormData((prev) => ({ ...prev, wikiSlug: e.target.value }))}
                    placeholder="e.g., Jensen_Huang"
                    data-testid="input-candidate-wiki"
                  />
                </div>
                <div>
                  <Label>Seed Votes</Label>
                  <Input
                    type="number"
                    value={formData.seedVotes}
                    onChange={(e) => setFormData((prev) => ({ ...prev, seedVotes: parseInt(e.target.value, 10) || 0 }))}
                    placeholder="0"
                    data-testid="input-candidate-seed-votes"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Social and discovery</p>
              <div>
                <Label>Search query override</Label>
                <Input
                  value={formData.searchQueryOverride}
                  onChange={(e) => setFormData((prev) => ({ ...prev, searchQueryOverride: e.target.value }))}
                  placeholder="Optional — passed to leaderboard person on approve"
                  data-testid="input-candidate-search-override"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>X handle</Label>
                  <Input
                    value={formData.xHandle}
                    onChange={(e) => setFormData((prev) => ({ ...prev, xHandle: e.target.value }))}
                    placeholder="e.g., elonmusk"
                    data-testid="input-candidate-x"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{SOCIAL_HANDLE_HELP.xHandle}</p>
                </div>
                <div>
                  <Label>Instagram handle</Label>
                  <Input
                    value={formData.instagramHandle}
                    onChange={(e) => setFormData((prev) => ({ ...prev, instagramHandle: e.target.value }))}
                    placeholder="e.g., zendaya"
                    data-testid="input-candidate-instagram"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{SOCIAL_HANDLE_HELP.instagramHandle}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>TikTok handle</Label>
                  <Input
                    value={formData.tiktokHandle}
                    onChange={(e) => setFormData((prev) => ({ ...prev, tiktokHandle: e.target.value }))}
                    placeholder="e.g., khaby.lame"
                    data-testid="input-candidate-tiktok"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{SOCIAL_HANDLE_HELP.tiktokHandle}</p>
                </div>
                <div>
                  <Label>YouTube channel ID</Label>
                  <Input
                    value={formData.youtubeId}
                    onChange={(e) => setFormData((prev) => ({ ...prev, youtubeId: e.target.value }))}
                    placeholder='UC… (24 chars)'
                    data-testid="input-candidate-youtube"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{SOCIAL_HANDLE_HELP.youtubeId}</p>
                </div>
              </div>
              <div>
                <Label>Spotify artist ID</Label>
                <Input
                  value={formData.spotifyId}
                  onChange={(e) => setFormData((prev) => ({ ...prev, spotifyId: e.target.value }))}
                  placeholder="22-character ID from artist URL"
                  data-testid="input-candidate-spotify"
                />
                <p className="text-xs text-muted-foreground mt-1">{SOCIAL_HANDLE_HELP.spotifyId}</p>
              </div>
              <div>
                <Label>Google Trends Topic ID (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    value={formData.googleTrendsTopicId}
                    onChange={(e) => setFormData((prev) => ({ ...prev, googleTrendsTopicId: e.target.value }))}
                    placeholder="e.g., /m/0cqt90"
                    data-testid="input-candidate-trends-topic"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!formData.displayName.trim() || trendsLookupLoading}
                    onClick={async () => {
                      setTrendsLookupLoading(true);
                      try {
                        const headers = await getAuthHeaders();
                        const resp = await fetch("/api/admin/trends-topic-suggestions", {
                          method: "POST",
                          headers: { ...headers, "Content-Type": "application/json" },
                          body: JSON.stringify({ query: formData.displayName.trim() }),
                        });
                        if (!resp.ok) throw new Error(await resp.text());
                        const data = await resp.json();
                        if (data.suggestions?.length > 0) {
                          const personSuggestion = data.suggestions.find((s: any) =>
                            s.type?.toLowerCase().includes("person") ||
                            s.type?.toLowerCase().includes("politician") ||
                            s.type?.toLowerCase().includes("athlete") ||
                            s.type?.toLowerCase().includes("singer") ||
                            s.type?.toLowerCase().includes("actor")
                          ) || data.suggestions[0];
                          setFormData(prev => ({ ...prev, googleTrendsTopicId: personSuggestion.topicId }));
                          toast.success("Topic ID found", {
                            description: `${personSuggestion.title} (${personSuggestion.type}) — ${personSuggestion.topicId}`,
                          });
                        } else {
                          toast.info("No suggestions", { description: "Google Trends has no entity match for this name." });
                        }
                      } catch (err: any) {
                        toast.error("Lookup failed", { description: err.message });
                      } finally {
                        setTrendsLookupLoading(false);
                      }
                    }}
                    data-testid="button-candidate-trends-lookup"
                  >
                    {trendsLookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lookup"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Unique Google Trends entity ID for disambiguation. Click Lookup to auto-detect.
                  {!formData.googleTrendsTopicId && (
                    <span className="text-yellow-600 ml-1">Without a Topic ID, Trends data uses name search (less accurate).</span>
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Images (after save)</p>
              <div>
                <Label>Profile images (optional, max 5)</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Stored in Supabase. Uploads run after the candidate is saved.
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleGalleryFilesPick(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={!canStageUploads || pendingGalleryFiles.length >= MAX_INDUCTION_GALLERY}
                    data-testid="button-induction-add-images"
                  >
                    <ImagePlus className="h-4 w-4 mr-2" />
                    Add images
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {pendingGalleryFiles.length}/{MAX_INDUCTION_GALLERY} selected
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Image slug is optional on create; if blank it is auto-generated from the candidate name.
                </p>
                {pendingGalleryFiles.length > 0 && (
                  <ul className="text-xs space-y-1 max-h-28 overflow-y-auto mt-2">
                    {pendingGalleryFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{file.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2"
                          onClick={() => setPendingGalleryFiles((prev) => prev.filter((_, j) => j !== index))}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => closeDialog()} data-testid="button-cancel-candidate">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!formData.displayName || !formData.category || createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-candidate"
              >
                {editCandidate ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingDestructiveAction}
        onOpenChange={(open) => {
          if (!open) setPendingDestructiveAction(null);
        }}
      >
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDestructiveAction?.kind === "delete" ? "Delete candidate?" : "Add to main leaderboard?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {pendingDestructiveAction?.kind === "approve" ? (
                  <>
                    Add{" "}
                    <span className="font-medium text-foreground">{pendingDestructiveAction.candidate.displayName}</span> to
                    the main leaderboard? This creates their full FameDex profile and native modules (Overall Rating,
                    Curate Profile, etc.).
                  </>
                ) : pendingDestructiveAction?.kind === "delete" ? (
                  <>
                    Permanently delete{" "}
                    <span className="font-medium text-foreground">{pendingDestructiveAction.candidate.displayName}</span> from
                    the induction queue? This cannot be undone.
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={isPendingDestructiveConfirm}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant={pendingDestructiveAction?.kind === "delete" ? "destructive" : "default"}
              onClick={confirmPendingDestructiveAction}
              disabled={isPendingDestructiveConfirm}
            >
              {pendingDestructiveAction?.kind === "delete" ? "Delete" : "Add to leaderboard"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
