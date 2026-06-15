import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CURRENCY } from "@/lib/currency";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  Award,
  Crown,
  Flame,
  Plus,
  RefreshCcw,
  Search,
  Trophy,
  User as UserIcon,
  Zap,
} from "lucide-react";
import {
  STREAK_MILESTONES,
  STREAK_MILESTONE_XP,
  STREAK_TARGET_DAYS,
  type StreakMilestone,
} from "@shared/streak-config";
import { CAPABILITY_GATES, RANKS } from "@shared/rank-config";
import { CREDIT_ACTIONS } from "@shared/credit-config";
import { STREAK_MILESTONE_BADGE_KEYS } from "@shared/badge-config";
import { AdminCreditsSection } from "./AdminCreditsSection";
import { AdminBadgesSection } from "./AdminBadgesSection";
import { BadgeCard, type BadgeCardData } from "@/components/BadgeCard";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface XpActionRow {
  actionType: string;
  displayName: string;
  xpValue: number;
  dailyCap: number | null;
  description: string | null;
  isActive: boolean;
  category: string;
  lifetimeAwards: number;
  lifetimeXpGranted: number;
}

interface RankRow {
  id: number;
  name: string;
  tier: number;
  minXp: number;
  maxXp: number | null;
  voteMultiplier: number;
  color: string;
  icon: string | null;
  description: string | null;
}

interface UserGamificationResponse {
  profile: {
    userId: string;
    username: string | null;
    avatarUrl: string | null;
    rank: string;
    xpPoints: number;
    predictCredits: number;
    currentStreak: number | null;
    longestStreak: number | null;
    lastLoginDate: string | null;
    highestRank: string | null;
    createdAt: string;
  };
  recentXp: Array<{
    actionType: string;
    xpValue: number;
    createdAt: string;
    idempotencyKey: string;
  }>;
  recentCredits: Array<{
    txnType: string;
    amount: number;
    balanceAfter: number;
    createdAt: string;
  }>;
  badges: Array<{
    badgeKey: string;
    earnedAt: string;
    name: string;
    rarity: string;
    category: string;
    icon: string;
  }>;
  streakHealth: {
    currentStreak: number;
    longestStreak: number;
    lastLoginDate: string | null;
    hasGraceAvailable: boolean;
  };
}

interface StreakHealthResponse {
  totalUsers: number;
  activeStreaks: number;
  streakDistribution: Array<{ range: string; count: number }>;
  longestCurrentStreak: number;
  avgStreak: number;
}

const XP_CATEGORIES = [
  "ENGAGEMENT",
  "CONTENT",
  "VOTING",
  "PREDICTION",
  "STREAK",
  "PROFILE",
  "SOCIAL",
  "SPECIAL",
] as const;
type XpCategory = (typeof XP_CATEGORIES)[number];

// Tabs in the order the section presents them. `xp` is the leftmost
// (and default) since XP is the most-edited surface as the new earn
// surfaces ship; credits/badges sit in the middle as the existing
// daily-driver tools; user lookup is rightmost as the destination
// for support tickets rather than configuration.
const TAB_ORDER = [
  "xp",
  "ranks",
  "streaks",
  "credits",
  "badges",
  "users",
] as const;
type GamificationSubTab = (typeof TAB_ORDER)[number];

interface AdminGamificationSectionProps {
  /**
   * Initial sub-tab to land on. Used by the alias redirect from the
   * deprecated `credits` / `badges` activeSection values so a user
   * with a stale localStorage section still lands on the right pane.
   */
  initialSubTab?: GamificationSubTab;
}

/**
 * Unified Gamification CMS — a single admin section spanning the
 * full XP / Ranks / Streaks / Credits / Badges / User-lookup
 * surface area. Sub-tab pattern matches the Voting CMS / Predict
 * CMS shells in AdminDashboard.tsx (controlled shadcn Tabs +
 * sessionStorage persistence) so the muscle memory carries over
 * for admins switching between sections.
 */
export function AdminGamificationSection({
  initialSubTab,
}: AdminGamificationSectionProps) {
  const [subTab, setSubTab] = useState<GamificationSubTab>(() => {
    if (initialSubTab && TAB_ORDER.includes(initialSubTab)) return initialSubTab;
    const stored = sessionStorage.getItem("admin_gamification_tab");
    if (stored && (TAB_ORDER as readonly string[]).includes(stored)) {
      return stored as GamificationSubTab;
    }
    return "xp";
  });

  useEffect(() => {
    sessionStorage.setItem("admin_gamification_tab", subTab);
  }, [subTab]);

  // When the parent passes a fresh initialSubTab (e.g. the user just
  // navigated from a `credits` deep-link), honour it on the next render.
  useEffect(() => {
    if (initialSubTab && (TAB_ORDER as readonly string[]).includes(initialSubTab)) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Gamification CMS</h2>
        <p className="text-muted-foreground">
          Configure XP, Ranks, Vox, Badges, and Streak rewards.
        </p>
      </div>

      <Tabs
        value={subTab}
        onValueChange={(v) => setSubTab(v as GamificationSubTab)}
        className="w-full"
      >
        {/* Horizontal-scroll wrapper matches the Voting CMS shell — six
            tabs overflow on mobile by design; the wrapper hides the
            scrollbar so it doesn't compete with the section padding. */}
        <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="inline-flex w-max">
            <TabsTrigger value="xp" data-testid="tab-gamification-xp">
              <Zap className="h-4 w-4 mr-2" /> XP Actions
            </TabsTrigger>
            <TabsTrigger value="ranks" data-testid="tab-gamification-ranks">
              <Crown className="h-4 w-4 mr-2" /> Ranks
            </TabsTrigger>
            <TabsTrigger value="streaks" data-testid="tab-gamification-streaks">
              <Flame className="h-4 w-4 mr-2" /> Streaks
            </TabsTrigger>
            <TabsTrigger value="credits" data-testid="tab-gamification-credits">
              <Trophy className="h-4 w-4 mr-2" /> Vox
            </TabsTrigger>
            <TabsTrigger value="badges" data-testid="tab-gamification-badges">
              <Award className="h-4 w-4 mr-2" /> Badges
            </TabsTrigger>
            <TabsTrigger value="users" data-testid="tab-gamification-users">
              <UserIcon className="h-4 w-4 mr-2" /> User Lookup
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="xp" className="mt-4">
          <XpActionsPanel />
        </TabsContent>
        <TabsContent value="ranks" className="mt-4">
          <RanksPanel />
        </TabsContent>
        <TabsContent value="streaks" className="mt-4">
          <StreaksPanel />
        </TabsContent>
        <TabsContent value="credits" className="mt-4">
          <AdminCreditsSection />
        </TabsContent>
        <TabsContent value="badges" className="mt-4">
          <AdminBadgesSection />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UserLookupPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// -----------------------------------------------------------------------------
// XP Actions panel
// -----------------------------------------------------------------------------

type XpStatusFilter = "all" | "active" | "inactive";

function XpActionsPanel() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<XpStatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<XpCategory | "ALL">(
    "ALL",
  );
  const [editing, setEditing] = useState<XpActionRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [reseedOpen, setReseedOpen] = useState(false);

  const { data, isLoading } = useQuery<XpActionRow[]>({
    queryKey: ["/api/admin/xp-actions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/xp-actions");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      actionType: string;
      xpValue?: number;
      dailyCap?: number | null;
      isActive?: boolean;
      description?: string;
    }) => {
      const { actionType, ...body } = payload;
      const res = await apiRequest(
        "PATCH",
        `/api/admin/xp-actions/${actionType}`,
        body,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/xp-actions"] });
      toast.success("XP action updated");
      setEditing(null);
    },
    onError: (err: any) => {
      toast.error("Update failed", { description: err?.message });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: {
      actionType: string;
      displayName: string;
      xpValue: number;
      dailyCap: number | null;
      description: string;
    }) => {
      const res = await apiRequest("POST", "/api/admin/xp-actions", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/xp-actions"] });
      toast.success("XP action created");
      setCreating(false);
    },
    onError: (err: any) => {
      toast.error("Create failed", { description: err?.message });
    },
  });

  const reseedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/seed-gamification");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/xp-actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/credit-actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ranks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/badges"] });
      toast.success("Gamification reseeded from defaults");
      setReseedOpen(false);
    },
    onError: (err: any) => {
      toast.error("Reseed failed", { description: err?.message });
    },
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    return rows.filter((row) => {
      if (statusFilter === "active" && !row.isActive) return false;
      if (statusFilter === "inactive" && row.isActive) return false;
      if (categoryFilter !== "ALL" && row.category !== categoryFilter) return false;
      return true;
    });
  }, [data, statusFilter, categoryFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold">XP Actions</h3>
          <p className="text-sm text-muted-foreground">
            Tune per-action XP values, daily caps, and active state. Lifetime
            stats are aggregated live from the XP ledger.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReseedOpen(true)}
            data-testid="button-reseed-xp"
          >
            <RefreshCcw className="h-4 w-4 mr-2" /> Reseed Defaults
          </Button>
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="button-create-xp-action"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Action
          </Button>
        </div>
      </div>

      <Card className="p-3 flex flex-wrap gap-2">
        <FilterChips
          label="Status"
          options={[
            { id: "all", label: "All" },
            { id: "active", label: "Active" },
            { id: "inactive", label: "Inactive" },
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as XpStatusFilter)}
          testIdPrefix="xp-status"
        />
        <FilterChips
          label="Category"
          options={[
            { id: "ALL", label: "All" },
            ...XP_CATEGORIES.map((c) => ({ id: c, label: c })),
          ]}
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v as XpCategory | "ALL")}
          testIdPrefix="xp-category"
        />
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">XP</th>
                <th className="px-3 py-2 text-right">Daily cap</th>
                <th className="px-3 py-2 text-right">Lifetime awards</th>
                <th className="px-3 py-2 text-right">Lifetime XP</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2 sr-only">Edit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.actionType}
                  className="border-b last:border-0 hover:bg-muted/30"
                  data-testid={`row-xp-${row.actionType}`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.displayName}</div>
                    <code className="text-[11px] text-muted-foreground">
                      {row.actionType}
                    </code>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px]">
                      {row.category}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.xpValue}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.dailyCap ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.lifetimeAwards.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.lifetimeXpGranted.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <Switch
                      checked={row.isActive}
                      onCheckedChange={(next) =>
                        updateMutation.mutate({
                          actionType: row.actionType,
                          isActive: next,
                        })
                      }
                      data-testid={`toggle-xp-active-${row.actionType}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(row)}
                      data-testid={`button-edit-xp-${row.actionType}`}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    No XP actions match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {editing && (
        <XpActionEditDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSave={(payload) => updateMutation.mutate(payload)}
          isSaving={updateMutation.isPending}
        />
      )}
      {creating && (
        <XpActionCreateDialog
          onClose={() => setCreating(false)}
          onCreate={(payload) => createMutation.mutate(payload)}
          isSaving={createMutation.isPending}
        />
      )}
      <AlertDialog open={reseedOpen} onOpenChange={setReseedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reseed gamification defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This resets all XP action, credit action, rank, and badge
              definitions to the seed defaults from <code>shared/*-config.ts</code>.
              Any manual edits to those rows will be overwritten. User XP,
              credit balances, and earned badges are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                reseedMutation.mutate();
              }}
              data-testid="button-confirm-reseed"
            >
              {reseedMutation.isPending ? "Reseeding..." : "Reseed"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function XpActionEditDialog({
  row,
  onClose,
  onSave,
  isSaving,
}: {
  row: XpActionRow;
  onClose: () => void;
  onSave: (payload: {
    actionType: string;
    xpValue?: number;
    dailyCap?: number | null;
    isActive?: boolean;
    description?: string;
  }) => void;
  isSaving: boolean;
}) {
  const [xpValue, setXpValue] = useState(String(row.xpValue));
  const [dailyCap, setDailyCap] = useState(
    row.dailyCap == null ? "" : String(row.dailyCap),
  );
  const [noCap, setNoCap] = useState(row.dailyCap == null);
  const [isActive, setIsActive] = useState(row.isActive);
  const [description, setDescription] = useState(row.description ?? "");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit XP action — {row.displayName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="xp-edit-value">XP value</Label>
            <Input
              id="xp-edit-value"
              type="number"
              min={0}
              max={10000}
              value={xpValue}
              onChange={(e) => setXpValue(e.target.value)}
              data-testid="input-xp-value"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="xp-edit-cap">Daily cap</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="xp-edit-no-cap"
                  checked={noCap}
                  onCheckedChange={(v) => {
                    setNoCap(v);
                    if (v) setDailyCap("");
                  }}
                />
                <span className="text-xs text-muted-foreground">No cap</span>
              </div>
            </div>
            <Input
              id="xp-edit-cap"
              type="number"
              min={1}
              max={1000}
              disabled={noCap}
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              data-testid="input-xp-cap"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="xp-edit-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
            <Label htmlFor="xp-edit-active">Active</Label>
          </div>
          <div>
            <Label htmlFor="xp-edit-description">Description</Label>
            <Textarea
              id="xp-edit-description"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                actionType: row.actionType,
                xpValue: Number(xpValue),
                dailyCap: noCap ? null : Number(dailyCap),
                isActive,
                description,
              })
            }
            disabled={isSaving}
            data-testid="button-save-xp"
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function XpActionCreateDialog({
  onClose,
  onCreate,
  isSaving,
}: {
  onClose: () => void;
  onCreate: (payload: {
    actionType: string;
    displayName: string;
    xpValue: number;
    dailyCap: number | null;
    description: string;
  }) => void;
  isSaving: boolean;
}) {
  const [actionType, setActionType] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [xpValue, setXpValue] = useState("10");
  const [dailyCap, setDailyCap] = useState("");
  const [noCap, setNoCap] = useState(true);
  const [description, setDescription] = useState("");

  const validKey = /^[a-z][a-z0-9_]{1,49}$/.test(actionType);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New XP action</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="xp-create-key">actionType (snake_case)</Label>
            <Input
              id="xp-create-key"
              value={actionType}
              onChange={(e) => setActionType(e.target.value.toLowerCase())}
              placeholder="e.g. comment_helpful"
              data-testid="input-create-key"
            />
            {!validKey && actionType.length > 0 && (
              <p className="text-xs text-destructive mt-1">
                Must start with a letter, lowercase + digits + underscore only,
                2-50 chars.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="xp-create-name">Display name</Label>
            <Input
              id="xp-create-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="xp-create-value">XP value</Label>
            <Input
              id="xp-create-value"
              type="number"
              min={0}
              max={10000}
              value={xpValue}
              onChange={(e) => setXpValue(e.target.value)}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="xp-create-cap">Daily cap</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="xp-create-no-cap"
                  checked={noCap}
                  onCheckedChange={(v) => {
                    setNoCap(v);
                    if (v) setDailyCap("");
                  }}
                />
                <span className="text-xs text-muted-foreground">No cap</span>
              </div>
            </div>
            <Input
              id="xp-create-cap"
              type="number"
              min={1}
              max={1000}
              disabled={noCap}
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="xp-create-description">Description</Label>
            <Textarea
              id="xp-create-description"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onCreate({
                actionType,
                displayName,
                xpValue: Number(xpValue),
                dailyCap: noCap ? null : Number(dailyCap),
                description,
              })
            }
            disabled={isSaving || !validKey || !displayName.trim()}
            data-testid="button-confirm-create-xp"
          >
            {isSaving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Ranks panel
// -----------------------------------------------------------------------------

function RanksPanel() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RankRow | null>(null);

  const { data, isLoading } = useQuery<RankRow[]>({
    queryKey: ["/api/admin/ranks"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/ranks");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      tier: number;
      minXp?: number;
      maxXp?: number | null;
      voteMultiplier?: number;
      description?: string;
    }) => {
      const { tier, ...body } = payload;
      const res = await apiRequest("PATCH", `/api/admin/ranks/${tier}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ranks"] });
      toast.success("Rank updated");
      setEditing(null);
    },
    onError: (err: any) => {
      toast.error("Update failed", { description: err?.message });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold">Ranks</h3>
        <p className="text-sm text-muted-foreground">
          Live <code>ranks</code> table is the runtime source of truth.{" "}
          <code>shared/rank-config.ts</code> provides seed defaults; edits here
          survive until the next reseed.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(data ?? []).map((rank) => (
            <Card key={rank.tier} className="p-4 flex items-start gap-3">
              <span
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: rank.color }}
              >
                {rank.tier}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold truncate">{rank.name}</p>
                  <Badge variant="outline" className="text-[10px]">
                    x{rank.voteMultiplier.toFixed(2)}
                  </Badge>
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {rank.minXp.toLocaleString()} XP
                  {rank.maxXp != null
                    ? ` – ${rank.maxXp.toLocaleString()} XP`
                    : "+"}
                </p>
                {rank.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {rank.description}
                  </p>
                )}
                <div className="mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(rank)}
                    data-testid={`button-edit-rank-${rank.tier}`}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-4">
        <h4 className="font-semibold">Capability Unlocks</h4>
        <p className="text-xs text-muted-foreground mt-1">
          Capability gates are configured in{" "}
          <code>shared/rank-config.ts</code> — contact a developer to modify.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-2 py-1">Capability</th>
                <th className="px-2 py-1">Min tier</th>
                <th className="px-2 py-1">Description</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_GATES.map((g) => {
                const rank = RANKS.find((r) => r.tier === g.minTier);
                return (
                  <tr key={g.capability} className="border-b last:border-0">
                    <td className="px-2 py-1 font-mono text-xs">
                      {g.capability}
                    </td>
                    <td className="px-2 py-1">
                      Tier {g.minTier} — {rank?.name ?? "?"}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {g.description}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <RankEditDialog
          row={editing}
          allRanks={data ?? []}
          onClose={() => setEditing(null)}
          onSave={(payload) => updateMutation.mutate(payload)}
          isSaving={updateMutation.isPending}
        />
      )}
    </div>
  );
}

function RankEditDialog({
  row,
  allRanks,
  onClose,
  onSave,
  isSaving,
}: {
  row: RankRow;
  allRanks: RankRow[];
  onClose: () => void;
  onSave: (payload: {
    tier: number;
    minXp: number;
    voteMultiplier: number;
    description: string;
  }) => void;
  isSaving: boolean;
}) {
  const [minXp, setMinXp] = useState(String(row.minXp));
  const [voteMultiplier, setVoteMultiplier] = useState(
    row.voteMultiplier.toFixed(2),
  );
  const [description, setDescription] = useState(row.description ?? "");

  // The maxXp display is purely derived from the next tier's minXp;
  // PATCH will recompute on the server side via the adjacency
  // checks. Tier 8 stays open-ended.
  const next = allRanks.find((r) => r.tier === row.tier + 1);
  const derivedMax =
    row.tier === 8 ? "Open-ended" : next ? next.minXp.toLocaleString() : "?";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Edit Tier {row.tier} — {row.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="rank-min-xp">Min XP</Label>
            <Input
              id="rank-min-xp"
              type="number"
              min={0}
              value={minXp}
              onChange={(e) => setMinXp(e.target.value)}
              data-testid="input-rank-min-xp"
            />
          </div>
          <div>
            <Label>Max XP (derived)</Label>
            <Input value={derivedMax} disabled />
            <p className="text-[11px] text-muted-foreground mt-1">
              Derived from the next tier's min XP. To change, edit Tier{" "}
              {row.tier + 1} first.
            </p>
          </div>
          <div>
            <Label htmlFor="rank-multiplier">Vote multiplier (1.0 - 3.0)</Label>
            <Input
              id="rank-multiplier"
              type="number"
              min={1}
              max={3}
              step={0.25}
              value={voteMultiplier}
              onChange={(e) => setVoteMultiplier(e.target.value)}
              data-testid="input-rank-multiplier"
            />
          </div>
          <div>
            <Label htmlFor="rank-description">Description</Label>
            <Textarea
              id="rank-description"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                tier: row.tier,
                minXp: Number(minXp),
                voteMultiplier: Number(voteMultiplier),
                description,
              })
            }
            disabled={isSaving}
            data-testid="button-save-rank"
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Streaks panel
// -----------------------------------------------------------------------------

function StreaksPanel() {
  const { data: health, isLoading } = useQuery<StreakHealthResponse>({
    queryKey: ["/api/admin/streak-health"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/streak-health");
      return res.json();
    },
  });

  // Build the milestone table from shared config so XP / credit /
  // badge unlocks always agree with the runtime values.
  const milestoneRows = useMemo(() => {
    return STREAK_MILESTONES.map((day) => {
      const credit = CREDIT_ACTIONS.find(
        (a) => a.key === `streak_milestone_${day}_credits`,
      );
      const badgeKey = STREAK_MILESTONE_BADGE_KEYS[day];
      return {
        day,
        xp: STREAK_MILESTONE_XP[day as StreakMilestone],
        credits: credit?.proposedCredits ?? 0,
        badgeKey: badgeKey ?? null,
      };
    });
  }, []);

  const maxBucket = useMemo(() => {
    const counts = (health?.streakDistribution ?? []).map((b) => b.count);
    return Math.max(1, ...counts);
  }, [health]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold">Streaks</h3>
        <p className="text-sm text-muted-foreground">
          Streak configuration is read-only; user streak distribution updates
          live as users check in.
        </p>
      </div>

      <Card className="p-4">
        <h4 className="font-semibold mb-2">Current Configuration</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Target days</p>
            <p className="font-semibold">{STREAK_TARGET_DAYS}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Milestones</p>
            <p className="font-semibold">{STREAK_MILESTONES.length}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-2 py-1">Day</th>
                <th className="px-2 py-1 text-right">XP bonus</th>
                <th className="px-2 py-1 text-right">Credit bonus</th>
                <th className="px-2 py-1">Badge unlocked</th>
              </tr>
            </thead>
            <tbody>
              {milestoneRows.map((m) => (
                <tr key={m.day} className="border-b last:border-0">
                  <td className="px-2 py-1 font-semibold">Day {m.day}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    +{m.xp.toLocaleString()} XP
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    +{CURRENCY.symbol}{m.credits.toLocaleString()}
                  </td>
                  <td className="px-2 py-1">
                    {m.badgeKey ? (
                      <code className="text-xs">{m.badgeKey}</code>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Streak configuration is managed in{" "}
          <code>shared/streak-config.ts</code> — a code change and redeploy is
          required to update these values.
        </p>
      </Card>

      <Card className="p-4">
        <h4 className="font-semibold mb-2 flex items-center gap-2">
          <Activity className="h-4 w-4" /> Streak Health
        </h4>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !health ? (
          <p className="text-sm text-muted-foreground">No data.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Total users" value={health.totalUsers} />
              <Stat label="Active streaks" value={health.activeStreaks} />
              <Stat
                label="Longest current"
                value={health.longestCurrentStreak}
              />
              <Stat label="Avg streak" value={health.avgStreak.toFixed(1)} />
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-2">
                Distribution
              </p>
              <div className="space-y-2">
                {health.streakDistribution.map((b) => (
                  <div key={b.range} className="flex items-center gap-3">
                    <span className="w-16 text-xs font-mono">{b.range}</span>
                    <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                      <div
                        className="h-full bg-amber-500/70"
                        style={{
                          width: `${(b.count / maxBucket) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="w-12 text-xs text-right tabular-nums">
                      {b.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// User Lookup panel
// -----------------------------------------------------------------------------

interface AdminUserListItem {
  id: string;
  username: string | null;
  rank?: string;
}

function UserLookupPanel() {
  const [searchInput, setSearchInput] = useState("");
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [innerTab, setInnerTab] = useState<
    "xp" | "credits" | "badges" | "streak"
  >("xp");

  // The search resolves a username (or pasted userId) to a userId
  // before fetching the gamification aggregate. Two-step lookup keeps
  // the gamification endpoint userId-only on the server.
  const { data: searchResults, isFetching: searching } = useQuery<
    AdminUserListItem[]
  >({
    queryKey: ["/api/admin/users", searchInput],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/users?search=${encodeURIComponent(searchInput)}&page=1&pageSize=50&sort=created_desc`,
      );
      const json = await res.json();
      return Array.isArray(json) ? json : (json.users ?? []);
    },
    enabled: searchInput.trim().length >= 2,
  });

  const { data: gamification, isLoading: loadingUser } =
    useQuery<UserGamificationResponse>({
      queryKey: ["/api/admin/users", activeUserId, "gamification"],
      queryFn: async () => {
        const res = await apiRequest(
          "GET",
          `/api/admin/users/${activeUserId}/gamification`,
        );
        return res.json();
      },
      enabled: !!activeUserId,
    });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold">User Gamification Lookup</h3>
        <p className="text-sm text-muted-foreground">
          Search by username or paste a userId to inspect XP, credits, badges,
          and streak state for one user.
        </p>
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Username or userId"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            data-testid="input-user-search"
          />
        </div>
        {searchInput.trim().length >= 2 && (
          <div className="mt-2 max-h-40 overflow-y-auto border rounded">
            {searching ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Searching...
              </p>
            ) : (searchResults?.length ?? 0) === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No matches.
              </p>
            ) : (
              (searchResults ?? []).slice(0, 20).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setActiveUserId(u.id);
                    setSearchInput("");
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 border-b last:border-0"
                  data-testid={`result-user-${u.id}`}
                >
                  <span className="font-medium">{u.username ?? "(no username)"}</span>
                  <span className="ml-2 text-xs text-muted-foreground font-mono">
                    {u.id.slice(0, 8)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </Card>

      {!activeUserId ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          Search for a user to view their gamification state.
        </Card>
      ) : loadingUser || !gamification ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <UserGamificationView
          data={gamification}
          innerTab={innerTab}
          onInnerTabChange={setInnerTab}
          onClose={() => setActiveUserId(null)}
        />
      )}
    </div>
  );
}

function UserGamificationView({
  data,
  innerTab,
  onInnerTabChange,
  onClose,
}: {
  data: UserGamificationResponse;
  innerTab: "xp" | "credits" | "badges" | "streak";
  onInnerTabChange: (v: "xp" | "credits" | "badges" | "streak") => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-muted overflow-hidden shrink-0">
            {data.profile.avatarUrl && (
              <img
                src={data.profile.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="text-lg font-semibold truncate">
                {data.profile.username ?? "(no username)"}
              </p>
              <Badge variant="outline">{data.profile.rank}</Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {data.profile.userId}
            </p>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <Stat label="XP" value={data.profile.xpPoints ?? 0} />
              <Stat
                label="Vox"
                value={data.profile.predictCredits ?? 0}
              />
              <Stat
                label="Current streak"
                value={data.profile.currentStreak ?? 0}
              />
              <Stat
                label="Longest streak"
                value={data.profile.longestStreak ?? 0}
              />
              <Stat
                label="Highest rank"
                value={data.profile.highestRank ?? "—"}
              />
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </Card>

      <Tabs
        value={innerTab}
        onValueChange={(v) =>
          onInnerTabChange(v as "xp" | "credits" | "badges" | "streak")
        }
      >
        <TabsList>
          <TabsTrigger value="xp">XP History</TabsTrigger>
          <TabsTrigger value="credits">Vox</TabsTrigger>
          <TabsTrigger value="badges">Badges</TabsTrigger>
          <TabsTrigger value="streak">Streak</TabsTrigger>
        </TabsList>

        <TabsContent value="xp" className="mt-4">
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2 text-right">XP</th>
                </tr>
              </thead>
              <tbody>
                {data.recentXp.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.actionType}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.xpValue >= 0 ? `+${row.xpValue}` : row.xpValue}
                    </td>
                  </tr>
                ))}
                {data.recentXp.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-4 text-center text-muted-foreground"
                    >
                      No XP awards yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="credits" className="mt-4">
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {data.recentCredits.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.txnType}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.amount >= 0 ? `+${row.amount}` : row.amount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.balanceAfter.toLocaleString()}
                    </td>
                  </tr>
                ))}
                {data.recentCredits.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-4 text-center text-muted-foreground"
                    >
                      No credit activity yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="badges" className="mt-4">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground mb-3">
              Earned: {data.badges.length}
            </p>
            {data.badges.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No badges earned yet.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {data.badges.map((b) => {
                  const card: BadgeCardData = {
                    key: b.badgeKey,
                    name: b.name,
                    description: "",
                    category: b.category,
                    rarity: b.rarity,
                    icon: b.icon,
                    earned: true,
                    earnedAt: b.earnedAt,
                  };
                  return <BadgeCard key={b.badgeKey} badge={card} size="sm" />;
                })}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="streak" className="mt-4">
          <Card className="p-4 space-y-3 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Current" value={data.streakHealth.currentStreak} />
              <Stat label="Longest" value={data.streakHealth.longestStreak} />
              <Stat
                label="Last login"
                value={data.streakHealth.lastLoginDate ?? "—"}
              />
              <Stat
                label="Grace available"
                value={data.streakHealth.hasGraceAvailable ? "Yes" : "No"}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              To adjust a user's streak directly, use the database tools or
              contact a developer. The streak machine is the only writer to
              currentStreak / longestStreak.
            </p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Shared bits
// -----------------------------------------------------------------------------

function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
  testIdPrefix,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="uppercase text-muted-foreground mr-1">{label}</span>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`rounded-full border px-2 py-0.5 transition-colors ${
            value === opt.id
              ? "border-primary bg-primary/15 text-primary"
              : "border-white/10 text-muted-foreground hover:bg-muted/40"
          }`}
          data-testid={`filter-${testIdPrefix}-${opt.id}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
