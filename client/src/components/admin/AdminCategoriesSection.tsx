import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type CategoryUsage = {
  celebrities: number;
  trendingPolls: number;
  opinionPolls: number;
  faceOffs: number;
  inductionCandidates: number;
  predictionMarkets: number;
  leaderboardRows: number;
};

export type AdminCategoryRow = {
  id: string;
  label: string;
  sortOrder: number;
  createdAt: string | null;
  usage: CategoryUsage;
  totalUsage: number;
};

function formatAdminApiError(err: unknown): string {
  if (err instanceof ApiError) {
    const m = /^(\d{3}):\s*(.*)$/s.exec(err.message);
    if (m?.[2]) {
      try {
        const j = JSON.parse(m[2]) as { error?: string | { message?: string } };
        if (typeof j?.error === "string") return j.error;
        if (j?.error && typeof j.error === "object" && typeof j.error.message === "string") {
          return j.error.message;
        }
      } catch {
        return m[2].slice(0, 400);
      }
    }
  }
  return err instanceof Error ? err.message : "Request failed";
}

type ContentsResponse = {
  category: { id: string; label: string };
  celebrities: Array<{ id: string; name: string; category: string; status: string }>;
  trendingPolls: Array<{ id: string; headline: string; slug: string | null; status: string; category: string }>;
  opinionPolls: Array<{ id: string; title: string; slug: string; visibility: string | null; category: string }>;
  faceOffs: Array<{ id: string; title: string; slug: string | null; visibility: string | null; category: string }>;
  inductionCandidates: Array<{ id: string; displayName: string; inductionStatus: string; category: string }>;
  predictionMarkets: Array<{
    id: string;
    title: string;
    slug: string;
    status: string;
    marketType: string;
    category: string | null;
  }>;
  leaderboardRows: Array<{ id: string; name: string; category: string | null }>;
};

export function AdminCategoriesSection({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);

  const { data: categories, isLoading: listLoading } = useQuery({
    queryKey: ["/api/admin/categories"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/categories");
      return res.json() as Promise<AdminCategoryRow[]>;
    },
    enabled,
  });

  const { data: contents, isLoading: contentsLoading } = useQuery({
    queryKey: ["/api/admin/categories", selectedId, "contents"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/categories/${encodeURIComponent(selectedId!)}/contents`);
      return res.json() as Promise<ContentsResponse>;
    },
    enabled: enabled && !!selectedId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/categories", {
        id: newId.trim().toLowerCase(),
        label: newLabel.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      setNewId("");
      setNewLabel("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      toast.success("Category created");
    },
    onError: (err) => {
      toast.error(formatAdminApiError(err));
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/categories/${encodeURIComponent(id)}`, { label });
      return (await res.json()) as {
        ok: boolean;
        id: string;
        label: string;
        cascade?: Record<string, number>;
      };
    },
    onSuccess: (result) => {
      setEditingLabel(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories", result.id, "contents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/celebrities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tracked-people"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opinion-polls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/matchups"] });
      const totalMigrated = Object.values(result.cascade ?? {}).reduce((sum, n) => sum + (n || 0), 0);
      if (totalMigrated > 0) {
        toast.success(`Renamed to "${result.label}" — updated ${totalMigrated} reference${totalMigrated === 1 ? "" : "s"}.`);
      } else {
        toast.success(`Renamed to "${result.label}".`);
      }
    },
    onError: (err) => {
      toast.error(formatAdminApiError(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/categories/${encodeURIComponent(id)}`);
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      queryClient.removeQueries({ queryKey: ["/api/admin/categories", id, "contents"] });
      if (selectedId === id) setSelectedId(null);
      toast.success("Category deleted");
    },
    onError: (err) => {
      toast.error(formatAdminApiError(err));
    },
  });

  const selectedCategory = useMemo(
    () => categories?.find((c) => c.id === selectedId),
    [categories, selectedId],
  );

  useEffect(() => {
    if (!categories?.length || !selectedId) return;
    if (!categories.some((c) => c.id === selectedId)) setSelectedId(null);
  }, [categories, selectedId]);

  useEffect(() => {
    setEditingLabel(null);
  }, [selectedId]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Categories</h2>
        <p className="text-muted-foreground">
          Manage canonical categories. Renaming the display label cascades to celebrities, polls, face-offs,
          induction candidates, prediction markets, and the leaderboard cache. Deleting is allowed only when no
          rows reference the category (matched loosely for legacy title-case vs kebab-case values).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add category</CardTitle>
          <CardDescription>
            Use a URL-safe id (lowercase, hyphens). Example: <code className="text-xs">film-tv</code>,{" "}
            <code className="text-xs">science</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="space-y-2 flex-1 min-w-[140px]">
            <Label htmlFor="new-cat-id">Id</Label>
            <Input
              id="new-cat-id"
              placeholder="e.g. science"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              autoComplete="off"
              data-testid="input-new-category-id"
            />
          </div>
          <div className="space-y-2 flex-1 min-w-[160px]">
            <Label htmlFor="new-cat-label">Display label</Label>
            <Input
              id="new-cat-label"
              placeholder="e.g. Science"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              autoComplete="off"
              data-testid="input-new-category-label"
            />
          </div>
          <Button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!newId.trim() || !newLabel.trim() || createMutation.isPending}
            data-testid="button-add-category"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-h-[320px]">
          <CardHeader>
            <CardTitle>All categories</CardTitle>
            <CardDescription>Click a row to inspect contents. Total counts include every reference type.</CardDescription>
          </CardHeader>
          <CardContent>
            {listLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !categories?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No categories found. Run migration <code className="text-xs">0031_content_categories</code> if this is a
                fresh database.
              </p>
            ) : (
              <div className="rounded-md border divide-y max-h-[480px] overflow-y-auto">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "w-full text-left px-3 py-3 flex flex-col gap-1 hover:bg-muted/60 transition-colors",
                      selectedId === c.id && "bg-violet-500/10 border-l-2 border-l-violet-500",
                    )}
                    data-testid={`row-category-${c.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.label}</span>
                      <Badge variant={c.totalUsage > 0 ? "secondary" : "outline"}>{c.totalUsage} uses</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{c.id}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-[320px]">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle>Details</CardTitle>
              {selectedCategory && editingLabel !== null ? (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const trimmed = editingLabel.trim();
                        if (trimmed && !renameMutation.isPending) {
                          renameMutation.mutate({ id: selectedCategory.id, label: trimmed });
                        }
                      } else if (e.key === "Escape") {
                        setEditingLabel(null);
                      }
                    }}
                    autoFocus
                    className="h-8 max-w-xs"
                    data-testid="input-edit-category-label"
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      disabled={!editingLabel.trim() || renameMutation.isPending}
                      title={
                        editingLabel.trim() === selectedCategory.label
                          ? "Re-save to backfill any existing rows that still use the old label"
                          : "Save and propagate to all references"
                      }
                      onClick={() =>
                        renameMutation.mutate({
                          id: selectedCategory.id,
                          label: editingLabel.trim(),
                        })
                      }
                      data-testid="button-save-category"
                    >
                      {renameMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Save
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={renameMutation.isPending}
                      onClick={() => setEditingLabel(null)}
                      data-testid="button-cancel-edit-category"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <CardDescription className="flex items-center gap-2 flex-wrap">
                  <span>
                    {selectedCategory
                      ? `${selectedCategory.label} (${selectedCategory.id})`
                      : "Select a category on the left"}
                  </span>
                  {selectedCategory && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => setEditingLabel(selectedCategory.label)}
                      title="Edit display label"
                      data-testid="button-edit-category"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                  )}
                </CardDescription>
              )}
            </div>
            {selectedCategory && editingLabel === null && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={selectedCategory.totalUsage > 0 || deleteMutation.isPending}
                onClick={() => {
                  if (selectedCategory.totalUsage > 0) return;
                  if (!confirm(`Delete category "${selectedCategory.label}" (${selectedCategory.id})?`)) return;
                  deleteMutation.mutate(selectedCategory.id);
                }}
                title={
                  selectedCategory.totalUsage > 0
                    ? "Reassign or remove content before deleting"
                    : "Delete this empty category"
                }
                data-testid="button-delete-category"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </>
                )}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!selectedId ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Choose a category to browse its contents.</p>
            ) : contentsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : contents ? (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <UsageChip label="Celebrities" n={contents.celebrities.length} />
                  <UsageChip label="Trending polls" n={contents.trendingPolls.length} />
                  <UsageChip label="Opinion polls" n={contents.opinionPolls.length} />
                  <UsageChip label="Face-offs" n={contents.faceOffs.length} />
                  <UsageChip label="Induction" n={contents.inductionCandidates.length} />
                  <UsageChip label="Predictions" n={contents.predictionMarkets.length} />
                  <UsageChip label="Leaderboard cache" n={contents.leaderboardRows.length} />
                </div>

                <Tabs defaultValue="celebrities" className="w-full">
                  <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
                    <TabsTrigger value="celebrities" className="text-xs">
                      Celebrities ({contents.celebrities.length})
                    </TabsTrigger>
                    <TabsTrigger value="trending" className="text-xs">
                      Trending polls ({contents.trendingPolls.length})
                    </TabsTrigger>
                    <TabsTrigger value="opinion" className="text-xs">
                      Opinion polls ({contents.opinionPolls.length})
                    </TabsTrigger>
                    <TabsTrigger value="faceoffs" className="text-xs">
                      Face-offs ({contents.faceOffs.length})
                    </TabsTrigger>
                    <TabsTrigger value="induction" className="text-xs">
                      Induction ({contents.inductionCandidates.length})
                    </TabsTrigger>
                    <TabsTrigger value="markets" className="text-xs">
                      Predictions ({contents.predictionMarkets.length})
                    </TabsTrigger>
                    <TabsTrigger value="leaderboard" className="text-xs">
                      Leaderboard ({contents.leaderboardRows.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="celebrities" className="mt-3">
                    <SimpleTable
                      empty="No celebrities in this category."
                      rows={contents.celebrities.map((r) => ({
                        key: r.id,
                        cols: [r.name, r.status, <span className="text-muted-foreground text-xs">{r.category}</span>],
                      }))}
                      headers={["Name", "Status", "Stored category"]}
                    />
                  </TabsContent>
                  <TabsContent value="trending" className="mt-3">
                    <SimpleTable
                      empty="No trending polls in this category."
                      rows={contents.trendingPolls.map((r) => ({
                        key: r.id,
                        cols: [r.headline, r.slug ?? "—", String(r.status)],
                      }))}
                      headers={["Headline", "Slug", "Status"]}
                    />
                  </TabsContent>
                  <TabsContent value="opinion" className="mt-3">
                    <SimpleTable
                      empty="No opinion polls in this category."
                      rows={contents.opinionPolls.map((r) => ({
                        key: r.id,
                        cols: [r.title, r.slug, r.visibility ?? "—"],
                      }))}
                      headers={["Title", "Slug", "Visibility"]}
                    />
                  </TabsContent>
                  <TabsContent value="faceoffs" className="mt-3">
                    <SimpleTable
                      empty="No face-offs in this category."
                      rows={contents.faceOffs.map((r) => ({
                        key: r.id,
                        cols: [r.title, r.slug ?? "—", r.visibility ?? "—"],
                      }))}
                      headers={["Title", "Slug", "Visibility"]}
                    />
                  </TabsContent>
                  <TabsContent value="induction" className="mt-3">
                    <SimpleTable
                      empty="No induction candidates in this category."
                      rows={contents.inductionCandidates.map((r) => ({
                        key: r.id,
                        cols: [r.displayName, r.inductionStatus],
                      }))}
                      headers={["Name", "Status"]}
                    />
                  </TabsContent>
                  <TabsContent value="markets" className="mt-3">
                    <SimpleTable
                      empty="No prediction markets in this category."
                      rows={contents.predictionMarkets.map((r) => ({
                        key: r.id,
                        cols: [r.title, r.slug, r.marketType, r.status],
                      }))}
                      headers={["Title", "Slug", "Type", "Status"]}
                    />
                  </TabsContent>
                  <TabsContent value="leaderboard" className="mt-3">
                    <p className="text-xs text-muted-foreground mb-2">
                      Leaderboard cache rows in this category that are not already listed under Celebrities (same person ID).
                    </p>
                    <SimpleTable
                      empty="No leaderboard rows in this category."
                      rows={contents.leaderboardRows.map((r) => ({
                        key: r.id,
                        cols: [r.name, <span className="text-muted-foreground text-xs">{r.category ?? "—"}</span>],
                      }))}
                      headers={["Name", "Stored category"]}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">Failed to load contents.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UsageChip({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 bg-background">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{n}</span>
    </span>
  );
}

function SimpleTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: { key: string; cols: ReactNode[] }[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">{empty}</p>;
  }
  return (
    <div className="rounded-md border overflow-x-auto max-h-[320px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            {headers.map((h, i) => (
              <th key={`${i}-${h}`} className="text-left font-medium px-3 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.key} className="hover:bg-muted/40">
              {r.cols.map((cell, i) => (
                <td key={i} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
