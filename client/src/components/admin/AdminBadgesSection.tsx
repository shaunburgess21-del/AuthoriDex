import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Award,
  ListChecks,
  ScrollText,
  Plus,
  Trash2,
} from "lucide-react";
import {
  BADGE_CATEGORIES,
  BADGE_RARITIES,
  BADGES,
} from "@shared/badge-config";

interface BadgeRow {
  id: number;
  key: string;
  name: string;
  description: string;
  category: string;
  rarity: string;
  icon: string;
  criteriaJson: Record<string, unknown> | null;
  isActive: boolean;
  visibleOnFrontend: boolean;
  sortOrder: number;
  awardCount: number;
  createdAt: string | null;
}

interface AwardLogRow {
  id: number;
  userId: string;
  badgeKey: string;
  earnedAt: string | null;
  metadata: Record<string, unknown> | null;
  username: string | null;
  badgeName: string | null;
  rarity: string | null;
}

const RARITY_ACCENT: Record<string, string> = {
  COMMON: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  RARE: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  EPIC: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  LEGENDARY: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

/**
 * Admin Badges section. Three tabs:
 *   1. Definitions — list + edit visibility/active/sort/copy. Creating
 *      new badges goes through `shared/badge-config.ts` + reseed; the
 *      admin UI deliberately does not support row creation so the
 *      config file stays the source of truth.
 *   2. Award Log — recent user_badges rows joined to profiles + badge
 *      definitions. Filterable by badge key.
 *   3. Manual Award — pick a userId + badge key, fire the award (or
 *      revoke an existing one).
 */
export function AdminBadgesSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Badges</h2>
        <p className="text-muted-foreground">
          Tune badge visibility + audit / manage user awards. Definitions
          live in <code className="text-xs">shared/badge-config.ts</code>;
          this panel reads + edits the seeded rows.
        </p>
      </div>

      <Tabs defaultValue="definitions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="definitions" data-testid="tab-badge-defs">
            <ListChecks className="h-4 w-4 mr-2" /> Definitions
          </TabsTrigger>
          <TabsTrigger value="log" data-testid="tab-badge-log">
            <ScrollText className="h-4 w-4 mr-2" /> Award Log
          </TabsTrigger>
          <TabsTrigger value="manual" data-testid="tab-badge-manual">
            <Plus className="h-4 w-4 mr-2" /> Manual Award
          </TabsTrigger>
        </TabsList>

        <TabsContent value="definitions" className="space-y-4">
          <DefinitionsPanel />
        </TabsContent>
        <TabsContent value="log" className="space-y-4">
          <AwardLogPanel />
        </TabsContent>
        <TabsContent value="manual" className="space-y-4">
          <ManualAwardPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DefinitionsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<BadgeRow[]>({
    queryKey: ["/api/admin/badges"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/badges");
      return res.json();
    },
  });

  const [editing, setEditing] = useState<BadgeRow | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, BadgeRow[]>();
    for (const cat of Object.keys(BADGE_CATEGORIES)) map.set(cat, []);
    for (const row of data ?? []) {
      const arr = map.get(row.category) ?? [];
      arr.push(row);
      map.set(row.category, arr);
    }
    return Array.from(map.entries()).filter(([, rows]) => rows.length > 0);
  }, [data]);

  const updateMut = useMutation({
    mutationFn: async ({ key, body }: { key: string; body: Partial<BadgeRow> }) => {
      const res = await apiRequest("PATCH", `/api/admin/badges/${key}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/badges"] });
      toast.success("Badge updated");
      setEditing(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-6">
      {grouped.map(([category, rows]) => (
        <Card key={category} className="p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            {category} <span className="text-xs">({rows.length})</span>
          </h3>
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.key}
                className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-white/5 bg-card/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    <UiBadge
                      variant="outline"
                      className={`text-[10px] ${RARITY_ACCENT[row.rarity] ?? ""}`}
                    >
                      {row.rarity}
                    </UiBadge>
                    {!row.isActive && (
                      <UiBadge variant="outline" className="text-[10px] text-rose-300 border-rose-500/40">
                        inactive
                      </UiBadge>
                    )}
                    {!row.visibleOnFrontend && (
                      <UiBadge variant="outline" className="text-[10px] text-amber-300 border-amber-500/40">
                        hidden
                      </UiBadge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    <code className="text-[10px]">{row.key}</code> · {row.description}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{row.awardCount} awards</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(row)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit badge</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  defaultValue={editing.name}
                  onChange={(e) =>
                    setEditing((prev) => prev && { ...prev, name: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  defaultValue={editing.description}
                  onChange={(e) =>
                    setEditing((prev) => prev && { ...prev, description: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Sort order</Label>
                <Input
                  type="number"
                  defaultValue={editing.sortOrder}
                  onChange={(e) =>
                    setEditing(
                      (prev) => prev && { ...prev, sortOrder: parseInt(e.target.value, 10) || 0 },
                    )
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch
                  checked={editing.isActive}
                  onCheckedChange={(v) =>
                    setEditing((prev) => prev && { ...prev, isActive: v })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Visible on frontend</Label>
                <Switch
                  checked={editing.visibleOnFrontend}
                  onCheckedChange={(v) =>
                    setEditing((prev) => prev && { ...prev, visibleOnFrontend: v })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editing) return;
                updateMut.mutate({
                  key: editing.key,
                  body: {
                    name: editing.name,
                    description: editing.description,
                    sortOrder: editing.sortOrder,
                    isActive: editing.isActive,
                    visibleOnFrontend: editing.visibleOnFrontend,
                  },
                });
              }}
              disabled={updateMut.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AwardLogPanel() {
  const [filterKey, setFilterKey] = useState<string>("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<AwardLogRow[]>({
    queryKey: ["/api/admin/badges/award-log", filterKey],
    queryFn: async () => {
      const url = filterKey
        ? `/api/admin/badges/award-log?badgeKey=${encodeURIComponent(filterKey)}`
        : "/api/admin/badges/award-log";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const revokeMut = useMutation({
    mutationFn: async ({ userId, key }: { userId: string; key: string }) => {
      const res = await apiRequest(
        "DELETE",
        `/api/admin/badges/award/${userId}/${key}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/badges/award-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/badges"] });
      toast.success("Award revoked");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Filter by badge key</Label>
        <Input
          className="max-w-[260px]"
          placeholder="e.g. first_vote"
          value={filterKey}
          onChange={(e) => setFilterKey(e.target.value.trim())}
        />
      </div>
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-2">Earned</th>
                <th>User</th>
                <th>Badge</th>
                <th>Rarity</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-white/5">
                  <td className="py-2 text-xs">
                    {row.earnedAt ? new Date(row.earnedAt).toLocaleString() : "—"}
                  </td>
                  <td>
                    <div className="text-xs">
                      <div>{row.username ?? "(unknown)"}</div>
                      <code className="text-[10px] text-muted-foreground">{row.userId}</code>
                    </div>
                  </td>
                  <td>
                    <div className="text-xs">
                      {row.badgeName ?? row.badgeKey}
                      <div>
                        <code className="text-[10px] text-muted-foreground">{row.badgeKey}</code>
                      </div>
                    </div>
                  </td>
                  <td>
                    {row.rarity && (
                      <UiBadge
                        variant="outline"
                        className={`text-[10px] ${RARITY_ACCENT[row.rarity] ?? ""}`}
                      >
                        {row.rarity}
                      </UiBadge>
                    )}
                  </td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (confirm(`Revoke ${row.badgeKey} from ${row.username ?? row.userId}?`)) {
                          revokeMut.mutate({ userId: row.userId, key: row.badgeKey });
                        }
                      }}
                      disabled={revokeMut.isPending}
                    >
                      <Trash2 className="h-3 w-3 mr-1" /> Revoke
                    </Button>
                  </td>
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground text-xs">
                    No awards.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ManualAwardPanel() {
  const [userId, setUserId] = useState("");
  const [badgeKey, setBadgeKey] = useState("");
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();

  const awardMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/badges/award", {
        userId: userId.trim(),
        badgeKey: badgeKey.trim(),
        note: note.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/badges/award-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/badges"] });
      toast.success("Badge awarded");
      setUserId("");
      setBadgeKey("");
      setNote("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className="p-4 space-y-3 max-w-xl">
      <div>
        <Label>User ID (Supabase auth UUID)</Label>
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </div>
      <div>
        <Label>Badge key</Label>
        <Input
          value={badgeKey}
          onChange={(e) => setBadgeKey(e.target.value)}
          placeholder="e.g. founder, admin_awarded"
          list="badge-key-options"
        />
        <datalist id="badge-key-options">
          {BADGES.map((b) => (
            <option key={b.key} value={b.key} />
          ))}
        </datalist>
      </div>
      <div>
        <Label>Note (optional)</Label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason / context for the audit log"
        />
      </div>
      <div>
        <Button
          onClick={() => awardMut.mutate()}
          disabled={!userId.trim() || !badgeKey.trim() || awardMut.isPending}
        >
          <Award className="h-4 w-4 mr-2" /> Award badge
        </Button>
      </div>
    </Card>
  );
}
