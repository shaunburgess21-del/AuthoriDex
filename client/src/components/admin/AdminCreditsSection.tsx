import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { CreditCard, Plus, AlertTriangle, RefreshCcw, Users } from "lucide-react";
import {
  CREDIT_CATEGORIES,
  type CreditCategory,
} from "@shared/credit-config";

interface CreditActionRow {
  id: number;
  key: string;
  label: string;
  proposedCredits: number;
  dailyCap: number | null;
  category: string;
  notes: string | null;
  isActive: boolean;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ReconciliationResponse {
  totalProfiles: number;
  profilesWithLedger: number;
  reconciledCount: number;
  discrepancyCount: number;
  discrepancies: Array<{
    userId: string;
    profileBalance: number;
    ledgerSum: number;
    delta: number;
    ledgerEntries: number;
  }>;
}

/**
 * Admin Vox section — two tabs:
 *
 *   1. Actions: live CRUD against credit_actions. Edits invalidate
 *      the gamificationService cache server-side, so a tweak to
 *      proposedCredits is picked up by the next adjustCredits()
 *      call without a redeploy.
 *
 *   2. Reconciliation: drift report from /api/admin/credit-reconciliation.
 *      Surfaces human users (not agents or the AMM house wallet) where
 *      profiles.predict_credits != ledger sum.
 *
 * Internal API / table / function names keep their "credit" naming
 * (credit_actions, predictCredits, proposedCredits). Only the
 * user-visible label is "Vox".
 */
export function AdminCreditsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Vox</h2>
        <p className="text-muted-foreground">
          Tune the engagement earn loop and audit ledger drift.
        </p>
      </div>

      <Tabs defaultValue="actions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="actions" data-testid="tab-credit-actions">
            <CreditCard className="h-4 w-4 mr-2" /> Actions
          </TabsTrigger>
          <TabsTrigger value="reconciliation" data-testid="tab-credit-reconciliation">
            <AlertTriangle className="h-4 w-4 mr-2" /> Reconciliation
          </TabsTrigger>
          <TabsTrigger value="referrals" data-testid="tab-credit-referrals">
            <Users className="h-4 w-4 mr-2" /> Referrals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actions">
          <CreditActionsPanel />
        </TabsContent>
        <TabsContent value="reconciliation">
          <ReconciliationPanel />
        </TabsContent>
        <TabsContent value="referrals">
          <ReferralsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreditActionsPanel() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CreditActionRow | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery<CreditActionRow[]>({
    queryKey: ["/api/admin/credit-actions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/credit-actions");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (
      payload: {
        key: string;
        proposedCredits?: number;
        dailyCap?: number | null;
        isActive?: boolean;
        notes?: string;
        label?: string;
      },
    ) => {
      const { key, ...body } = payload;
      const res = await apiRequest("PATCH", `/api/admin/credit-actions/${key}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/credit-actions"] });
      toast.success("Credit action updated");
      setEditing(null);
    },
    onError: (err: any) => {
      toast.error("Update failed", { description: err?.message });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: {
      key: string;
      label: string;
      category: string;
      proposedCredits: number;
      dailyCap: number | null;
      notes: string;
      isActive: boolean;
      requiresApproval: boolean;
    }) => {
      const res = await apiRequest("POST", "/api/admin/credit-actions", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/credit-actions"] });
      toast.success("Credit action created");
      setCreating(false);
    },
    onError: (err: any) => {
      toast.error("Create failed", { description: err?.message });
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, CreditActionRow[]>();
    for (const row of data ?? []) {
      const list = map.get(row.category) ?? [];
      list.push(row);
      map.set(row.category, list);
    }
    return Array.from(map.entries());
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Edits take effect on the next adjustCredits() call (cache is
          invalidated server-side).
        </p>
        <Button
          size="sm"
          onClick={() => setCreating(true)}
          data-testid="button-create-credit-action"
        >
          <Plus className="h-4 w-4 mr-2" /> New action
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {!isLoading && grouped.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No credit actions seeded. Run the gamification seed script to
          populate the table.
        </Card>
      )}

      {grouped.map(([category, rows]) => (
        <Card key={category} className="overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide">
            {category}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Key / Label</th>
                <th className="px-3 py-2 font-medium text-right">Vox</th>
                <th className="px-3 py-2 font-medium text-right">Daily cap</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-border/60 align-top"
                  data-testid={`credit-action-row-${row.key}`}
                >
                  <td className="px-3 py-2">
                    <p className="font-medium">{row.label}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {row.key}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.proposedCredits}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {row.dailyCap === null ? "—" : `${row.dailyCap}/day`}
                  </td>
                  <td className="px-3 py-2">
                    <Switch
                      checked={row.isActive}
                      onCheckedChange={(checked) =>
                        updateMutation.mutate({
                          key: row.key,
                          isActive: checked,
                        })
                      }
                      data-testid={`toggle-active-${row.key}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-xs">
                    {row.notes ?? ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(row)}
                      data-testid={`button-edit-${row.key}`}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {editing && (
        <EditActionDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => updateMutation.mutate({ key: editing.key, ...patch })}
          isSaving={updateMutation.isPending}
        />
      )}

      {creating && (
        <CreateActionDialog
          onClose={() => setCreating(false)}
          onSave={(payload) => createMutation.mutate(payload)}
          isSaving={createMutation.isPending}
        />
      )}
    </div>
  );
}

interface EditPatch {
  proposedCredits?: number;
  dailyCap?: number | null;
  notes?: string;
  label?: string;
}

function EditActionDialog({
  row,
  onClose,
  onSave,
  isSaving,
}: {
  row: CreditActionRow;
  onClose: () => void;
  onSave: (patch: EditPatch) => void;
  isSaving: boolean;
}) {
  const [proposedCredits, setProposedCredits] = useState(String(row.proposedCredits));
  const [dailyCap, setDailyCap] = useState(
    row.dailyCap === null ? "" : String(row.dailyCap),
  );
  const [notes, setNotes] = useState(row.notes ?? "");
  const [label, setLabel] = useState(row.label);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit credit action</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Key
            </Label>
            <p className="font-mono text-sm">{row.key}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-label">Label</Label>
            <Input
              id="edit-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-credits">Vox</Label>
              <Input
                id="edit-credits"
                type="number"
                value={proposedCredits}
                onChange={(e) => setProposedCredits(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-cap">Daily cap (blank = none)</Label>
              <Input
                id="edit-cap"
                type="number"
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                placeholder="No cap"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <Input
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
                proposedCredits: Number(proposedCredits),
                dailyCap: dailyCap === "" ? null : Number(dailyCap),
                notes,
                label,
              })
            }
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CATEGORY_OPTIONS: CreditCategory[] = [
  CREDIT_CATEGORIES.ENGAGEMENT,
  CREDIT_CATEGORIES.QUALITY,
  CREDIT_CATEGORIES.STREAK,
  CREDIT_CATEGORIES.SOCIAL,
  CREDIT_CATEGORIES.SPECIAL,
];

function CreateActionDialog({
  onClose,
  onSave,
  isSaving,
}: {
  onClose: () => void;
  onSave: (payload: {
    key: string;
    label: string;
    category: string;
    proposedCredits: number;
    dailyCap: number | null;
    notes: string;
    isActive: boolean;
    requiresApproval: boolean;
  }) => void;
  isSaving: boolean;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<CreditCategory>(CREDIT_CATEGORIES.ENGAGEMENT);
  const [proposedCredits, setProposedCredits] = useState("0");
  const [dailyCap, setDailyCap] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [requiresApproval, setRequiresApproval] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New credit action</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="create-key">Key (snake_case, unique)</Label>
            <Input
              id="create-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. share_card_clicked"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-label">Label</Label>
            <Input
              id="create-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-category">Category</Label>
            <select
              id="create-category"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value as CreditCategory)}
            >
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="create-credits">Vox</Label>
              <Input
                id="create-credits"
                type="number"
                value={proposedCredits}
                onChange={(e) => setProposedCredits(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-cap">Daily cap (blank = none)</Label>
              <Input
                id="create-cap"
                type="number"
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-notes">Notes</Label>
            <Input
              id="create-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">
                Inactive actions skip awarding silently.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Requires approval</Label>
              <p className="text-xs text-muted-foreground">
                Mark suggestion-style actions that only fire after admin sign-off.
              </p>
            </div>
            <Switch
              checked={requiresApproval}
              onCheckedChange={setRequiresApproval}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || !key.trim() || !label.trim()}
            onClick={() =>
              onSave({
                key: key.trim(),
                label: label.trim(),
                category,
                proposedCredits: Number(proposedCredits) || 0,
                dailyCap: dailyCap === "" ? null : Number(dailyCap),
                notes,
                isActive,
                requiresApproval,
              })
            }
          >
            {isSaving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReconciliationPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery<ReconciliationResponse>({
    queryKey: ["/api/admin/credit-reconciliation"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/credit-reconciliation");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Compares <code>profiles.predict_credits</code> against the
          <code>credit_ledger</code> sum per user. Drift indicates a missing
          ledger row or a direct balance mutation that bypassed the helper.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            queryClient.invalidateQueries({
              queryKey: ["/api/admin/credit-reconciliation"],
            })
          }
          disabled={isFetching}
          data-testid="button-refresh-reconciliation"
        >
          <RefreshCcw className="h-4 w-4 mr-2" />
          {isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !data ? (
        <Card className="p-4 text-sm">No data.</Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Profiles" value={data.totalProfiles} />
            <Stat label="With ledger" value={data.profilesWithLedger} />
            <Stat label="Reconciled" value={data.reconciledCount} tone="ok" />
            <Stat
              label="Drift"
              value={data.discrepancyCount}
              tone={data.discrepancyCount === 0 ? "ok" : "warn"}
            />
          </div>

          {data.discrepancyCount === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              All profiles reconcile to their ledger sum. No drift.
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide">
                Drift detail
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium text-right">Cached</th>
                    <th className="px-3 py-2 font-medium text-right">Ledger sum</th>
                    <th className="px-3 py-2 font-medium text-right">Δ</th>
                    <th className="px-3 py-2 font-medium text-right">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {data.discrepancies.map((row) => (
                    <tr
                      key={row.userId}
                      className="border-t border-border/60"
                      data-testid={`drift-row-${row.userId}`}
                    >
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {row.userId}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.profileBalance.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.ledgerSum.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        <Badge
                          variant="outline"
                          className={
                            row.delta > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }
                        >
                          {row.delta > 0 ? "+" : ""}
                          {row.delta.toLocaleString("en-US")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.ledgerEntries}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

interface ReferralRow {
  refereeId: string;
  refereeUsername: string | null;
  refereeCreatedAt: string | null;
  refereeFirstActionAt: string | null;
  referrerId: string | null;
  referrerUsername: string | null;
  creditAmount: number | null;
  creditAwardedAt: string | null;
}

function ReferralsPanel() {
  const { data, isLoading } = useQuery<ReferralRow[]>({
    queryKey: ["/api/admin/referrals"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/referrals");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (!data || data.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No referrals yet. Once a user signs up via a ?ref= link, they'll
        appear here.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-2 border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide">
        Referral activity ({data.length} most recent)
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Referrer</th>
            <th className="px-3 py-2 font-medium">Referee</th>
            <th className="px-3 py-2 font-medium">Signed up</th>
            <th className="px-3 py-2 font-medium">First action</th>
            <th className="px-3 py-2 font-medium text-right">Vox</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={row.refereeId}
              className="border-t border-border/60"
              data-testid={`referral-row-${row.refereeId}`}
            >
              <td className="px-3 py-2">
                {row.referrerUsername ?? (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2">
                {row.refereeUsername ?? (
                  <span className="text-xs text-muted-foreground font-mono">
                    {row.refereeId.slice(0, 8)}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {row.refereeCreatedAt
                  ? new Date(row.refereeCreatedAt).toLocaleDateString()
                  : "—"}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {row.refereeFirstActionAt
                  ? new Date(row.refereeFirstActionAt).toLocaleDateString()
                  : (
                    <Badge variant="outline" className="text-xs">
                      Pending
                    </Badge>
                  )}
              </td>
              <td className="px-3 py-2 text-right">
                {row.creditAmount !== null ? (
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    +{row.creditAmount.toLocaleString("en-US")}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <Card className="p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-2xl font-bold ${color}`}>{value.toLocaleString("en-US")}</p>
    </Card>
  );
}
