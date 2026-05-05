import { useState, useMemo, useEffect, type ReactElement } from "react";
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
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Check, X, Search, Trash2, Edit2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const HOVER_TOOLTIP_MEDIA = "(hover: hover) and (pointer: fine)";

const INDUCTION_STATUS_OPTIONS = ["Queue", "Inactive", "Archived", "Rejected", "Inducted"] as const;

type InductionFormData = {
  displayName: string;
  category: string;
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
};

const EMPTY_FORM: InductionFormData = {
  displayName: "",
  category: "tech",
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
};

function formDataToApiBody(form: InductionFormData): Record<string, unknown> {
  return {
    displayName: form.displayName,
    category: form.category,
    imageSlug: form.imageSlug.trim() || null,
    wikiSlug: form.wikiSlug.trim() || null,
    seedVotes: form.seedVotes,
    inductionStatus: form.inductionStatus,
    searchQueryOverride: form.searchQueryOverride.trim() || null,
    xHandle: form.xHandle,
    instagramHandle: form.instagramHandle,
    tiktokHandle: form.tiktokHandle,
    youtubeId: form.youtubeId,
    spotifyId: form.spotifyId,
  };
}

async function uploadInductionGallerySlot(candidateId: string, file: File): Promise<void> {
  const fd = new FormData();
  fd.append("file", file);
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
  imageSlug: string | null;
  seedVotes: number;
  wikiSlug: string | null;
  xHandle?: string | null;
  instagramHandle?: string | null;
  tiktokHandle?: string | null;
  youtubeId?: string | null;
  spotifyId?: string | null;
  searchQueryOverride?: string | null;
  inductionStatus?: string | null;
  isActive: boolean;
}

type AdminCategoryRow = { id: string; label: string; sortOrder: number };

export function AdminInductionQueue() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editCandidate, setEditCandidate] = useState<InductionCandidate | null>(null);
  const [formData, setFormData] = useState<InductionFormData>({ ...EMPTY_FORM });
  const [pendingGalleryFiles, setPendingGalleryFiles] = useState<File[]>([]);

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
      for (const file of galleryFiles.slice(0, 4)) {
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
      for (const file of galleryFiles.slice(0, 4)) {
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

  const openEdit = (c: InductionCandidate) => {
    setEditCandidate(c);
    setPendingGalleryFiles([]);
    setFormData({
      displayName: c.displayName,
      category: normalizeMarketCategory(c.category),
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
    });
  };

  const candidates = data?.data || [];
  const filteredCandidates = candidates.filter((c) => {
    if (searchQuery && !c.displayName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter === "active" && !c.isActive) return false;
    if (statusFilter === "inactive" && c.isActive) return false;
    return true;
  });

  const handleSubmit = () => {
    if (!formData.displayName || !formData.category) return;
    const body = formDataToApiBody(formData);
    const galleryFiles = pendingGalleryFiles.slice(0, 4);
    if (editCandidate) {
      updateMutation.mutate({ id: editCandidate.id, ...body, galleryFiles });
    } else {
      createMutation.mutate({ ...body, galleryFiles });
    }
  };

  const closeDialog = () => {
    setShowCreateDialog(false);
    setEditCandidate(null);
    resetForm();
  };

  const canStageUploads = formData.imageSlug.trim().length > 0;

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
              <SelectTrigger className="w-[140px]" data-testid="select-induction-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="text-sm text-muted-foreground mb-3">
            Showing {filteredCandidates.length} of {candidates.length} candidates
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
                          <PersonAvatar name={candidate.displayName} imageSlug={candidate.imageSlug} imageContext="induction" size="xs" />
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
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Inactive
                          </Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          {candidate.isActive && (
                            <>
                              <DesktopActionTooltip content="Approve and add this candidate to the main leaderboard (full profile).">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-emerald-600 dark:text-emerald-400"
                                  onClick={() => approveMutation.mutate(candidate.id)}
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
                            onClick={() => deleteMutation.mutate(candidate.id)}
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
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Images (after save)</p>
              <div>
                <Label htmlFor="induction-gallery-input">Gallery staging (max 4)</Label>
                <input
                  id="induction-gallery-input"
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={!canStageUploads || createMutation.isPending || updateMutation.isPending}
                  className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5"
                  data-testid="input-candidate-gallery"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files || []);
                    setPendingGalleryFiles(picked.slice(0, 4));
                    e.target.value = "";
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Set Image Slug first. Files upload to storage as <code className="text-xs">1.webp</code>…<code className="text-xs">4.webp</code>{" "}
                  under that slug and are linked to the profile when you approve induction.
                </p>
                {pendingGalleryFiles.length > 0 && (
                  <p className="text-xs mt-2 text-foreground">
                    {pendingGalleryFiles.length} file(s) queued — will upload after you click {editCandidate ? "Update" : "Create"}.
                  </p>
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
    </>
  );
}
