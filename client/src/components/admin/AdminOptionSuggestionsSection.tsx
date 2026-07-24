import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UploadImageInput } from "@/components/ui/upload-image-input";
import { RecencySortSelect } from "@/components/admin/RecencySortSelect";
import { sortByRecency, type RecencySort } from "@/lib/recencySort";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowBigUp, Check, X, Loader2 } from "lucide-react";

interface OptionSuggestionRow {
  id: string;
  pollId: string;
  name: string;
  imageUrl: string | null;
  personId: string | null;
  status: string;
  suggestedBy: string;
  adminNotes: string | null;
  approvedOptionId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  pollTitle: string | null;
  pollSlug: string | null;
  suggesterUsername: string | null;
  voteCount: number;
}

const SUGGESTIONS_KEY = "/api/admin/opinion-poll-option-suggestions";

function parseAdminError(err: unknown): string {
  if (err instanceof Error && err.message) {
    const jsonMatch = err.message.match(/^\d+:\s*(\{[\s\S]*\})\s*$/);
    if (jsonMatch) {
      try {
        const j = JSON.parse(jsonMatch[1]) as { error?: string };
        if (j.error) return j.error;
      } catch {
        /* ignore */
      }
    }
    return err.message;
  }
  return "Something went wrong.";
}

export function AdminOptionSuggestionsSection() {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [sortOrder, setSortOrder] = useState<RecencySort>("default");
  const [approveTarget, setApproveTarget] = useState<OptionSuggestionRow | null>(null);
  const [approveName, setApproveName] = useState("");
  const [approveImageUrl, setApproveImageUrl] = useState("");
  const [rejectTarget, setRejectTarget] = useState<OptionSuggestionRow | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const { data: suggestions, isLoading } = useQuery<OptionSuggestionRow[]>({
    queryKey: [SUGGESTIONS_KEY, statusFilter],
    queryFn: async () => {
      const res = await apiRequest("GET", `${SUGGESTIONS_KEY}?status=${encodeURIComponent(statusFilter)}`);
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return res.json();
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [SUGGESTIONS_KEY] });

  const approveMutation = useMutation({
    mutationFn: async (payload: { id: string; name?: string; imageUrl?: string }) => {
      const { id, ...body } = payload;
      const res = await apiRequest("POST", `${SUGGESTIONS_KEY}/${id}/approve`, body);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/opinion-polls"] });
      setApproveTarget(null);
      toast("Option approved", { description: "Added to the poll's options." });
    },
    onError: (err) => toast.error("Could not approve", { description: parseAdminError(err) }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (payload: { id: string; adminNotes?: string }) => {
      const { id, ...body } = payload;
      const res = await apiRequest("POST", `${SUGGESTIONS_KEY}/${id}/reject`, body);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setRejectTarget(null);
      toast("Suggestion rejected");
    },
    onError: (err) => toast.error("Could not reject", { description: parseAdminError(err) }),
  });

  const openApprove = (row: OptionSuggestionRow) => {
    setApproveTarget(row);
    setApproveName(row.name);
    setApproveImageUrl(row.imageUrl || "");
  };

  const openReject = (row: OptionSuggestionRow) => {
    setRejectTarget(row);
    setRejectNotes("");
  };

  const rows = suggestions ?? [];
  const sortedRows = sortByRecency(rows, sortOrder, (row) => row.createdAt);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Option Suggestions</CardTitle>
              <CardDescription>
                Community-suggested options for opinion polls. Approving one adds it to the poll&apos;s options. Sorted
                by community votes.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]" data-testid="select-suggestion-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
              <RecencySortSelect
                value={sortOrder}
                onValueChange={setSortOrder}
                testId="select-suggestion-sort"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading suggestions...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-admin-suggestions">
              No {statusFilter === "all" ? "" : statusFilter} suggestions.
            </div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Option</th>
                    <th className="text-left p-3 font-medium">Poll</th>
                    <th className="text-left p-3 font-medium">Suggested by</th>
                    <th className="text-right p-3 font-medium">Votes</th>
                    <th className="text-center p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.id} className="border-b last:border-b-0 hover-elevate" data-testid={`row-suggestion-${row.id}`}>
                      <td className="p-3 font-medium">{row.name}</td>
                      <td className="p-3 text-muted-foreground max-w-[220px] truncate">{row.pollTitle || row.pollId}</td>
                      <td className="p-3 text-muted-foreground">{row.suggesterUsername || "—"}</td>
                      <td className="p-3 text-right font-mono">
                        <span className="inline-flex items-center gap-1">
                          <ArrowBigUp className="h-3.5 w-3.5" />
                          {row.voteCount}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {row.status === "pending" ? (
                          <Badge variant="outline" className="text-muted-foreground">Pending</Badge>
                        ) : row.status === "approved" ? (
                          <Badge className="bg-emerald-500/25 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 dark:border-emerald-500/30">
                            Approved
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-red-600 dark:text-red-400 border-red-500/40">Rejected</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-2">
                          {row.status === "pending" && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-emerald-600 dark:text-emerald-400"
                                onClick={() => openApprove(row)}
                                aria-label="Approve"
                                data-testid={`button-approve-suggestion-${row.id}`}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-red-600 dark:text-red-400"
                                onClick={() => openReject(row)}
                                aria-label="Reject"
                                data-testid={`button-reject-suggestion-${row.id}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
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

      <Dialog open={!!approveTarget} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve option</DialogTitle>
            <DialogDescription>
              This adds the option to &ldquo;{approveTarget?.pollTitle}&rdquo;. You can adjust the display name and add an
              optional image before approving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Option name</Label>
              <Input
                value={approveName}
                onChange={(e) => setApproveName(e.target.value)}
                data-testid="input-approve-name"
              />
            </div>
            <div>
              <Label>Image (optional)</Label>
              <UploadImageInput
                value={approveImageUrl}
                onChange={setApproveImageUrl}
                moduleName="opinion-poll-options"
                slugOrId={approveTarget?.id || "suggestion"}
                placeholder="Upload or paste image URL"
                buttonTestId="input-approve-image"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)} disabled={approveMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                approveTarget &&
                approveMutation.mutate({
                  id: approveTarget.id,
                  name: approveName.trim() || undefined,
                  imageUrl: approveImageUrl.trim() || undefined,
                })
              }
              disabled={approveMutation.isPending || !approveName.trim()}
              className="bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-confirm-approve"
            >
              {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve & add option"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject suggestion</DialogTitle>
            <DialogDescription>
              Reject &ldquo;{rejectTarget?.name}&rdquo;. You can add an optional internal note.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Admin notes (optional)</Label>
            <Textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Reason for rejection (internal only)"
              data-testid="input-reject-notes"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={rejectMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                rejectTarget && rejectMutation.mutate({ id: rejectTarget.id, adminNotes: rejectNotes.trim() || undefined })
              }
              disabled={rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
