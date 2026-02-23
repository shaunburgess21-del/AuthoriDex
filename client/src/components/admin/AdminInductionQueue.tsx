import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, Check, X, Search, Trash2, Edit2 } from "lucide-react";

interface InductionCandidate {
  id: string;
  displayName: string;
  category: string;
  imageSlug: string | null;
  seedVotes: number;
  wikiSlug: string | null;
  isActive: boolean;
}

const CATEGORIES = ["Tech", "Music", "Creator", "Sports", "Business", "Politics"];

export function AdminInductionQueue() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editCandidate, setEditCandidate] = useState<InductionCandidate | null>(null);

  const [formData, setFormData] = useState({
    displayName: "",
    category: "Tech",
    imageSlug: "",
    wikiSlug: "",
    seedVotes: 0,
  });

  const { data, isLoading } = useQuery<{ data: InductionCandidate[]; totalCount: number }>({
    queryKey: ['/api/admin/induction'],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/admin/induction', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/induction'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vote/induction'] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: "Candidate Created" });
    },
    onError: () => toast({ title: "Failed to create candidate", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest('PATCH', `/api/admin/induction/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/induction'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vote/induction'] });
      setEditCandidate(null);
      resetForm();
      toast({ title: "Candidate Updated" });
    },
    onError: () => toast({ title: "Failed to update candidate", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/admin/induction/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/induction'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vote/induction'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leaderboard'] });
      toast({ title: "Candidate Approved", description: "Added to leaderboard with all native modules." });
    },
    onError: () => toast({ title: "Failed to approve candidate", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/admin/induction/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/induction'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vote/induction'] });
      toast({ title: "Candidate Deactivated" });
    },
    onError: () => toast({ title: "Failed to deactivate candidate", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/admin/induction/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/induction'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vote/induction'] });
      toast({ title: "Candidate Deleted" });
    },
    onError: () => toast({ title: "Failed to delete candidate", variant: "destructive" }),
  });

  const resetForm = () => setFormData({ displayName: "", category: "Tech", imageSlug: "", wikiSlug: "", seedVotes: 0 });

  const openEdit = (c: InductionCandidate) => {
    setEditCandidate(c);
    setFormData({
      displayName: c.displayName,
      category: c.category,
      imageSlug: c.imageSlug || "",
      wikiSlug: c.wikiSlug || "",
      seedVotes: c.seedVotes,
    });
  };

  const candidates = data?.data || [];
  const filteredCandidates = candidates.filter(c => {
    if (searchQuery && !c.displayName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter === "active" && !c.isActive) return false;
    if (statusFilter === "inactive" && c.isActive) return false;
    return true;
  });

  const handleSubmit = () => {
    if (!formData.displayName || !formData.category) return;
    if (editCandidate) {
      updateMutation.mutate({ id: editCandidate.id, ...formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Induction Queue</CardTitle>
              <CardDescription>Manage new celebrity nominations for community voting</CardDescription>
            </div>
            <Button onClick={() => { resetForm(); setShowCreateDialog(true); }} data-testid="button-create-candidate">
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
            <div className="text-center py-8 text-muted-foreground">No candidates found. Click "Add Candidate" to create one.</div>
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
                          <PersonAvatar name={candidate.displayName} imageSlug={candidate.imageSlug} size="xs" />
                          <span className="font-medium">{candidate.displayName}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">{candidate.category}</Badge>
                      </td>
                      <td className="p-3 text-right font-mono">{candidate.seedVotes}</td>
                      <td className="p-3 text-center">
                        {candidate.isActive ? (
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1">
                          {candidate.isActive && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-emerald-400"
                                onClick={() => approveMutation.mutate(candidate.id)}
                                disabled={approveMutation.isPending}
                                data-testid={`button-approve-${candidate.id}`}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-red-400"
                                onClick={() => rejectMutation.mutate(candidate.id)}
                                disabled={rejectMutation.isPending}
                                data-testid={`button-reject-${candidate.id}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(candidate)}
                            data-testid={`button-edit-${candidate.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-400"
                            onClick={() => deleteMutation.mutate(candidate.id)}
                            disabled={deleteMutation.isPending}
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

      <Dialog open={showCreateDialog || !!editCandidate} onOpenChange={(open) => { if (!open) { setShowCreateDialog(false); setEditCandidate(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editCandidate ? "Edit Candidate" : "Add New Candidate"}</DialogTitle>
            <DialogDescription>{editCandidate ? "Update candidate details" : "Add a new celebrity to the induction queue"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Display Name *</Label>
              <Input
                value={formData.displayName}
                onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
                placeholder="Full name"
                data-testid="input-candidate-name"
              />
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData(prev => ({ ...prev, category: v }))}>
                <SelectTrigger data-testid="select-candidate-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Image Slug</Label>
              <Input
                value={formData.imageSlug}
                onChange={(e) => setFormData(prev => ({ ...prev, imageSlug: e.target.value }))}
                placeholder="auto-generated from name if blank"
                data-testid="input-candidate-image-slug"
              />
              <p className="text-xs text-muted-foreground mt-1">Used to resolve images from storage buckets</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Wiki Slug</Label>
                <Input
                  value={formData.wikiSlug}
                  onChange={(e) => setFormData(prev => ({ ...prev, wikiSlug: e.target.value }))}
                  placeholder="e.g., Jensen_Huang"
                  data-testid="input-candidate-wiki"
                />
              </div>
              <div>
                <Label>Seed Votes</Label>
                <Input
                  type="number"
                  value={formData.seedVotes}
                  onChange={(e) => setFormData(prev => ({ ...prev, seedVotes: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                  data-testid="input-candidate-seed-votes"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditCandidate(null); }} data-testid="button-cancel-candidate">
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
