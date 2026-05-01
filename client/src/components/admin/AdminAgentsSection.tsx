import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  Bot,
  Coins,
  Eraser,
  FlaskConical,
  Loader2,
  Megaphone,
  Pencil,
  Play,
  ThumbsUp,
  RefreshCw,
  Sparkles,
  Trash2,
  Vote,
} from "lucide-react";
import { toast } from "sonner";

const COHORT_ID = "v2-2026-prelaunch";

interface CohortStats {
  total_agents: number;
  active_agents: number;
  active_v2_agents: number;
  active_legacy_agents: number;
}

interface PoolRow {
  marketType: string;
  openMarkets: number;
  avgPool: number;
  minPool: number;
  maxPool: number;
}

interface PnlRow {
  id: string;
  username: string;
  isActive: boolean;
  profitLoss: number;
  totalBets: number;
  volume: number;
}

interface AgentRow {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  archetype: string;
  isActive: boolean;
  simulationProfile: { cohortId?: string; personaBand?: string } | null;
}

interface PendingActionRow {
  id: string;
  agentId: string;
  marketId: string;
  actionType: string;
  status: string;
  executeAfter: string;
  stakeAmount: number;
}

interface CostSafetyInfo {
  world_markets_llm_enabled: boolean;
  world_market_boost_enabled: boolean;
  cached_world_assessments: number;
  open_world_markets: number;
  ttl_tiers?: {
    final_hours: number;
    near_hours: number;
    medium_hours: number;
    long_hours: number;
  };
  markets_by_tier?: {
    final: number;
    near: number;
    medium: number;
    long: number;
  };
}

interface AgentStatusResponse {
  agents: AgentRow[];
  cohort: CohortStats;
  pending_count: number;
  executed_count: number;
  failed_count: number;
  next_actions: PendingActionRow[];
  pnl: PnlRow[];
  comments: { comments_24h: number; comments_7d: number; replies_7d?: number };
  likes?: { likes_24h: number; likes_7d: number; upvotes_7d: number; downvotes_7d: number };
  ratings?: { ratings_24h: number; ratings_7d: number; avg_rating_7d: number | string };
  pool_realism: PoolRow[];
  cost_safety?: CostSafetyInfo;
}

interface DryRunMarketPreview {
  marketId: string;
  marketType?: string;
  title?: string;
  estimatedAction: "prediction_candidate" | "likely_abstain" | string;
  categoryMatch?: boolean;
}

interface DryRunAgentPreview {
  agentId: string;
  username: string;
  personaBand?: string;
  skillTier?: string;
  weeklyVoteCap?: number;
  weeklyCommentCap?: number;
  markets?: DryRunMarketPreview[];
}

interface DryRunPreview {
  ok?: boolean;
  writes?: boolean;
  sampledAgents?: number;
  sampledMarkets?: number;
  previews?: DryRunAgentPreview[];
}

function formatCredits(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${abs}`;
}

function pnlTone(value: number): string {
  if (value > 0) return "text-emerald-500";
  if (value < 0) return "text-red-500";
  return "text-muted-foreground";
}

function bandTone(band: string | undefined): string {
  switch (band) {
    case "sharp":
      return "bg-emerald-500/15 text-emerald-500 border-emerald-500/40";
    case "whale":
      return "bg-violet-500/15 text-violet-500 border-violet-500/40";
    case "noisy":
      return "bg-amber-500/15 text-amber-500 border-amber-500/40";
    case "liquidity":
      return "bg-cyan-500/15 text-cyan-500 border-cyan-500/40";
    case "casual":
      return "bg-blue-500/15 text-blue-500 border-blue-500/40";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function AdminAgentsSection() {
  const queryClient = useQueryClient();
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [pendingToggleAgentId, setPendingToggleAgentId] = useState<string | null>(null);
  const [pendingClearAgentId, setPendingClearAgentId] = useState<string | null>(null);
  const [dryRunPreview, setDryRunPreview] = useState<DryRunPreview | null>(null);

  const statusQuery = useQuery<AgentStatusResponse>({
    queryKey: ["/api/admin/agents/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/agents/status");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const status = statusQuery.data;

  const pnlByAgent = useMemo(() => {
    const map = new Map<string, PnlRow>();
    status?.pnl.forEach((row) => map.set(row.id, row));
    return map;
  }, [status?.pnl]);

  const pendingByAgent = useMemo(() => {
    const map = new Map<string, number>();
    status?.next_actions.forEach((row) => {
      map.set(row.agentId, (map.get(row.agentId) ?? 0) + 1);
    });
    return map;
  }, [status?.next_actions]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/agents/status"] });
    statusQuery.refetch();
  };

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/agents/seed", {
        archiveLegacy: true,
        hideLegacyProfiles: true,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("V2 cohort seeded", {
        description: `Created ${data?.created?.length ?? 0}, skipped ${data?.skipped?.length ?? 0}, errors ${data?.errors?.length ?? 0}. Archived ${data?.archive?.archived ?? 0} legacy.`,
      });
      setConfirmSeed(false);
      refresh();
    },
    onError: (err: Error) => toast.error("Seed failed", { description: err.message }),
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/agents/archive-legacy", {
        hideProfiles: true,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Legacy agents archived", {
        description: `Archived ${data?.archived ?? 0}, hid ${data?.hiddenProfiles ?? 0} profiles, skipped ${data?.skippedActions ?? 0} pending actions.`,
      });
      refresh();
    },
    onError: (err: Error) => toast.error("Archive failed", { description: err.message }),
  });

  // The three sweep endpoints below run as background jobs server-side
  // (predictions especially can take >30s with LLM calls). The UI just acks
  // the start; the user refreshes /status to see real counts.
  const runPredictMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/agents/run");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Prediction batch started", {
        description: data?.message ?? "Running in background — refresh in 1-3 min to see scheduled actions.",
      });
      setTimeout(refresh, 5000);
    },
    onError: (err: Error) => toast.error("Could not start prediction batch", { description: err.message }),
  });

  const runVotesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/agents/run-votes");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Vote sweep started", {
        description: data?.message ?? "Running in background — refresh shortly to see counts update.",
      });
      setTimeout(refresh, 5000);
    },
    onError: (err: Error) => toast.error("Could not start vote sweep", { description: err.message }),
  });

  const runCommentsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/agents/run-comments");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Comment sweep started", {
        description: data?.message ?? "Running in background — refresh shortly to see Comments 7d update.",
      });
      setTimeout(refresh, 5000);
    },
    onError: (err: Error) => toast.error("Could not start comment sweep", { description: err.message }),
  });

  const runLikesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/agents/run-likes");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Comment-likes sweep started", {
        description: data?.message ?? "Running in background — refresh shortly to see Likes 7d update.",
      });
      setTimeout(refresh, 5000);
    },
    onError: (err: Error) => toast.error("Could not start likes sweep", { description: err.message }),
  });

  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/admin/agents/dry-run?agents=12&markets=8");
      return res.json();
    },
    onSuccess: (data: DryRunPreview) => {
      setDryRunPreview(data ?? null);
      const sampled = data?.sampledAgents ?? 0;
      toast("Dry run preview ready", {
        description: `Sampled ${sampled} agents. See preview panel below.`,
      });
    },
    onError: (err: Error) => toast.error("Dry run failed", { description: err.message }),
  });

  const clearWorldAbstainedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/agents/clear-world-abstained");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Cleared world-abstained queue", {
        description: `Deleted ${data?.deleted ?? 0} stale abstain records.`,
      });
      refresh();
    },
    onError: (err: Error) => toast.error("Clear failed", { description: err.message }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ agentId, active }: { agentId: string; active: boolean }) => {
      setPendingToggleAgentId(agentId);
      const res = await apiRequest("POST", `/api/admin/agents/${agentId}/toggle-active`, { active });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast(data?.active ? "Agent resumed" : "Agent paused", {
        description: data?.skippedPending
          ? `Also skipped ${data.skippedPending} pending actions.`
          : undefined,
      });
      refresh();
    },
    onError: (err: Error) => toast.error("Toggle failed", { description: err.message }),
    onSettled: () => setPendingToggleAgentId(null),
  });

  const clearPendingMutation = useMutation({
    mutationFn: async (agentId: string) => {
      setPendingClearAgentId(agentId);
      const res = await apiRequest("POST", `/api/admin/agents/${agentId}/clear-pending`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Pending queue cleared", {
        description: `Skipped ${data?.skipped ?? 0} actions for this agent.`,
      });
      refresh();
    },
    onError: (err: Error) => toast.error("Clear failed", { description: err.message }),
    onSettled: () => setPendingClearAgentId(null),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ agentId, username }: { agentId: string; username: string }) => {
      const res = await apiRequest("POST", `/api/admin/agents/${agentId}/rename`, { username });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.unchanged) {
        toast("No change", { description: "That's the current name." });
        return;
      }
      toast("Agent renamed", {
        description: `${data?.agent?.previousUsername ?? "Agent"} \u2192 @${data?.agent?.username}`,
      });
      refresh();
    },
    onError: (err: Error) => toast.error("Rename failed", { description: err.message }),
  });

  const handleRenameAgent = (agent: { id: string; username: string }) => {
    const next = window.prompt(
      `Rename @${agent.username}\n\nNew username (3-30 chars, letters/numbers/underscore):`,
      agent.username,
    );
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === agent.username) return;
    renameMutation.mutate({ agentId: agent.id, username: trimmed });
  };

  const cohort = status?.cohort;
  const v2Agents = useMemo(() => {
    if (!status) return [];
    return status.agents
      .filter((agent) => agent.simulationProfile?.cohortId === COHORT_ID)
      .sort((a, b) => {
        const pnlA = pnlByAgent.get(a.id)?.profitLoss ?? 0;
        const pnlB = pnlByAgent.get(b.id)?.profitLoss ?? 0;
        if (pnlB !== pnlA) return pnlB - pnlA;
        return a.username.localeCompare(b.username);
      });
  }, [status, pnlByAgent]);

  const legacyAgents = useMemo(() => {
    if (!status) return [];
    return status.agents.filter((agent) => agent.simulationProfile?.cohortId !== COHORT_ID);
  }, [status]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold">Agents</h2>
          <p className="text-muted-foreground">
            Manage the {COHORT_ID} simulation cohort, its activity loops, and per-agent state.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={statusQuery.isFetching}
            data-testid="button-refresh-agents"
          >
            {statusQuery.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Cohort summary */}
      <Card data-testid="card-agents-cohort">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-violet-500" />
            Cohort Summary
          </CardTitle>
          <CardDescription>
            Live state of the agent simulation. V2 = current cohort; legacy = pre-V2 agents that should be archived.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <SummaryStat label="Total agents" value={cohort?.total_agents} />
            <SummaryStat label="Active" value={cohort?.active_agents} />
            <SummaryStat label="Active V2" value={cohort?.active_v2_agents} tone="text-emerald-500" />
            <SummaryStat
              label="Active legacy"
              value={cohort?.active_legacy_agents}
              tone={(cohort?.active_legacy_agents ?? 0) > 0 ? "text-amber-500" : undefined}
            />
            <SummaryStat label="Pending actions" value={status?.pending_count} />
            <SummaryStat label="Comments 7d" value={status?.comments?.comments_7d} />
            <SummaryStat label="Replies 7d" value={status?.comments?.replies_7d} />
            <SummaryStat label="Likes 7d" value={status?.likes?.likes_7d} />
            <SummaryStat label="Ratings 7d" value={status?.ratings?.ratings_7d} />
          </div>
          {(status?.ratings?.ratings_7d ?? 0) > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Avg rating last 7d: {Number(status?.ratings?.avg_rating_7d ?? 0).toFixed(2)} / 5
            </p>
          )}
          {(status?.likes?.likes_7d ?? 0) > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Likes last 7d: {status?.likes?.upvotes_7d ?? 0}↑ / {status?.likes?.downvotes_7d ?? 0}↓
            </p>
          )}
        </CardContent>
      </Card>

      {/* Cost safety — World Market LLM kill switch & cache state */}
      {status?.cost_safety && (
        <Card
          data-testid="card-agents-cost-safety"
          className={
            status.cost_safety.world_markets_llm_enabled
              ? "border-amber-500/40"
              : "border-emerald-500/40"
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-500" />
              OpenAI Cost Safety
            </CardTitle>
            <CardDescription>
              World Markets used to fire one LLM web-search call per agent per market (~$0.25 each, ~$45 burned in 2 hours on 2026-05-01).
              The kill switch below pauses all World Market LLM activity. When enabled, the per-market cache means only ONE call per market per refresh window (shared by all {cohort?.active_v2_agents ?? 0} V2 agents). The refresh window is adaptive — short for markets resolving in days, long for year-out markets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">World Market LLM</div>
                <div
                  className={`text-lg font-semibold ${
                    status.cost_safety.world_markets_llm_enabled
                      ? "text-amber-500"
                      : "text-emerald-500"
                  }`}
                >
                  {status.cost_safety.world_markets_llm_enabled ? "ENABLED" : "DISABLED"}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  env: <code>WORLD_MARKETS_LLM_ENABLED</code>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Boost mode</div>
                <div
                  className={`text-lg font-semibold ${
                    status.cost_safety.world_market_boost_enabled ? "text-amber-500" : "text-emerald-500"
                  }`}
                >
                  {status.cost_safety.world_market_boost_enabled ? "ON (3x volume)" : "OFF"}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  env: <code>WORLD_MARKET_BOOST_ENABLED</code>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Cached assessments</div>
                <div className="text-lg font-semibold">
                  {status.cost_safety.cached_world_assessments} / {status.cost_safety.open_world_markets}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  open world markets covered by cache
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Adaptive refresh windows</div>
                {status.cost_safety.ttl_tiers ? (
                  <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                    <div>&lt;3d to resolve: <span className="text-foreground">{status.cost_safety.ttl_tiers.final_hours}h</span></div>
                    <div>3-14d: <span className="text-foreground">{status.cost_safety.ttl_tiers.near_hours}h</span></div>
                    <div>14-60d: <span className="text-foreground">{status.cost_safety.ttl_tiers.medium_hours / 24}d</span></div>
                    <div>&gt;60d: <span className="text-foreground">{status.cost_safety.ttl_tiers.long_hours / 24}d</span></div>
                  </div>
                ) : (
                  <div className="text-lg font-semibold">—</div>
                )}
              </div>
            </div>
            {status.cost_safety.markets_by_tier && (
              <div className="mt-3 rounded-md border bg-muted/20 p-3 text-xs">
                <div className="mb-1 text-muted-foreground">Open world markets by resolution window:</div>
                <div className="flex flex-wrap gap-3 text-foreground">
                  <span>Final stretch (&lt;3d): <span className="font-semibold">{status.cost_safety.markets_by_tier.final}</span></span>
                  <span>Near (3-14d): <span className="font-semibold">{status.cost_safety.markets_by_tier.near}</span></span>
                  <span>Medium (14-60d): <span className="font-semibold">{status.cost_safety.markets_by_tier.medium}</span></span>
                  <span>Long (&gt;60d): <span className="font-semibold">{status.cost_safety.markets_by_tier.long}</span></span>
                </div>
              </div>
            )}
            {!status.cost_safety.world_markets_llm_enabled && (
              <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                Safe mode: agents are abstaining on World Markets without touching OpenAI. Native markets (Jackpot, H2H, UpDown, Gainer) are unaffected and still use the deterministic engine (no LLM cost).
              </div>
            )}
            {status.cost_safety.world_markets_llm_enabled && (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                LLM mode active. Expected spend: ~$0.25 per uncovered World Market per refresh window. Estimated cost for next sweep: ~$
                {(
                  Math.max(0, status.cost_safety.open_world_markets - status.cost_safety.cached_world_assessments) * 0.25
                ).toFixed(2)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action buttons */}
      <Card data-testid="card-agents-actions">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" />
            Cohort Actions
          </CardTitle>
          <CardDescription>
            One-click controls for the simulation. Use Dry Run first if you're unsure how an action will fan out.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              onClick={() => runPredictMutation.mutate()}
              disabled={runPredictMutation.isPending}
              data-testid="button-run-predictions"
            >
              {runPredictMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Run Prediction Batch
            </Button>
            <Button
              variant="outline"
              onClick={() => runVotesMutation.mutate()}
              disabled={runVotesMutation.isPending}
              data-testid="button-run-votes"
            >
              {runVotesMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Vote className="h-4 w-4 mr-2" />}
              Run Vote Sweep
            </Button>
            <Button
              variant="outline"
              onClick={() => runCommentsMutation.mutate()}
              disabled={runCommentsMutation.isPending}
              data-testid="button-run-comments"
            >
              {runCommentsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Megaphone className="h-4 w-4 mr-2" />}
              Run Comment Sweep
            </Button>
            <Button
              variant="outline"
              onClick={() => runLikesMutation.mutate()}
              disabled={runLikesMutation.isPending}
              data-testid="button-run-likes"
            >
              {runLikesMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ThumbsUp className="h-4 w-4 mr-2" />}
              Run Likes Sweep
            </Button>
            <Button
              variant="outline"
              onClick={() => dryRunMutation.mutate()}
              disabled={dryRunMutation.isPending}
              data-testid="button-agents-dry-run"
            >
              {dryRunMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-2" />}
              Dry Run
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            {confirmSeed ? (
              <div className="flex flex-col gap-2 w-full">
                <p className="text-xs text-amber-500">
                  This will archive ALL legacy agents (hide their profiles, skip pending actions) and seed a fresh V2 cohort with new usernames, avatars, and personas. Action is idempotent — existing V2 agents will be skipped.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    onClick={() => seedMutation.mutate()}
                    disabled={seedMutation.isPending}
                    data-testid="button-confirm-seed"
                  >
                    {seedMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Yes, archive legacy & seed V2
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmSeed(false)} data-testid="button-cancel-seed">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setConfirmSeed(true)}
                data-testid="button-seed-cohort"
              >
                <Bot className="h-4 w-4 mr-2" />
                Seed V2 Cohort (archive legacy)
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
              data-testid="button-archive-legacy"
            >
              {archiveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Archive Legacy Only
            </Button>
            <Button
              variant="ghost"
              onClick={() => clearWorldAbstainedMutation.mutate()}
              disabled={clearWorldAbstainedMutation.isPending}
              data-testid="button-clear-world-abstained"
            >
              {clearWorldAbstainedMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eraser className="h-4 w-4 mr-2" />}
              Clear World-Abstained
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dry run preview */}
      {dryRunPreview && (
        <Card data-testid="card-dry-run-preview">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FlaskConical className="h-5 w-5 text-violet-500" />
                  Dry Run Preview
                </CardTitle>
                <CardDescription>
                  What the next prediction sweep would look like — nothing has been written to the DB.
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDryRunPreview(null)} data-testid="button-close-dry-run">
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(() => {
              const previews = dryRunPreview.previews ?? [];
              let predictCount = 0;
              let abstainCount = 0;
              let total = 0;
              for (const agent of previews) {
                for (const market of agent.markets ?? []) {
                  total += 1;
                  if (market.estimatedAction === "prediction_candidate") predictCount += 1;
                  else abstainCount += 1;
                }
              }
              const predictPct = total > 0 ? Math.round((predictCount / total) * 100) : undefined;
              const abstainPct = total > 0 ? Math.round((abstainCount / total) * 100) : undefined;
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <SummaryStat label="Sampled agents" value={dryRunPreview.sampledAgents} />
                  <SummaryStat label="Sampled markets" value={dryRunPreview.sampledMarkets} />
                  <SummaryStat label="Predict %" value={predictPct} tone="text-emerald-500" />
                  <SummaryStat label="Abstain %" value={abstainPct} tone="text-muted-foreground" />
                </div>
              );
            })()}
            {Array.isArray(dryRunPreview.previews) && dryRunPreview.previews.length > 0 && (
              <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-md border border-border">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead className="text-right">Predict</TableHead>
                      <TableHead className="text-right">Abstain</TableHead>
                      <TableHead>Top market</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dryRunPreview.previews.map((row) => {
                      const markets = row.markets ?? [];
                      const predict = markets.filter((m) => m.estimatedAction === "prediction_candidate").length;
                      const abstain = markets.length - predict;
                      const sample = markets.find((m) => m.estimatedAction === "prediction_candidate") ?? markets[0];
                      return (
                        <TableRow key={row.agentId}>
                          <TableCell className="font-medium">{row.username}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={bandTone(row.personaBand)}>
                              {row.personaBand ?? "-"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-emerald-500">{predict}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{abstain}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                            {sample
                              ? `${sample.title ?? sample.marketId}${sample.categoryMatch ? " (★ specialty)" : ""}`
                              : "no markets"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pool realism */}
      <Card data-testid="card-pool-realism">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-cyan-500" />
            Pool Realism
          </CardTitle>
          <CardDescription>
            Average and range of total stakes across open markets per type. Use this to spot pools that look too thin or too lopsided.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status?.pool_realism?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Market type</TableHead>
                  <TableHead className="text-right">Open markets</TableHead>
                  <TableHead className="text-right">Avg pool</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.pool_realism.map((row) => (
                  <TableRow key={row.marketType} data-testid={`row-pool-${row.marketType}`}>
                    <TableCell className="font-medium capitalize">{row.marketType}</TableCell>
                    <TableCell className="text-right">{row.openMarkets}</TableCell>
                    <TableCell className="text-right">{formatCredits(row.avgPool)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCredits(row.minPool)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCredits(row.maxPool)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No open markets right now.</p>
          )}
        </CardContent>
      </Card>

      {/* V2 agents table */}
      <Card data-testid="card-agents-list">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-500" />
            V2 Agents
            <Badge variant="outline" className="ml-2">{v2Agents.length}</Badge>
          </CardTitle>
          <CardDescription>
            Sorted by P&amp;L, descending. Pause an agent to freeze them without banning their profile; clear pending to drop their queued actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statusQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading agents...
            </div>
          ) : v2Agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No V2 agents found. Use "Seed V2 Cohort" above.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Persona</TableHead>
                    <TableHead className="text-right">P&amp;L</TableHead>
                    <TableHead className="text-right">Bets</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {v2Agents.map((agent) => {
                    const pnl = pnlByAgent.get(agent.id);
                    const pendingCount = pendingByAgent.get(agent.id) ?? 0;
                    const band = agent.simulationProfile?.personaBand;
                    return (
                      <TableRow key={agent.id} data-testid={`row-agent-${agent.username}`}>
                        <TableCell className="font-medium">
                          <div className="inline-flex items-center gap-1.5">
                            <span>{agent.username}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => handleRenameAgent({ id: agent.id, username: agent.username })}
                              disabled={renameMutation.isPending}
                              title="Rename agent"
                              data-testid={`button-rename-${agent.username}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={bandTone(band)}>
                            {band ?? "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-right font-mono ${pnlTone(pnl?.profitLoss ?? 0)}`}>
                          {formatCredits(pnl?.profitLoss ?? 0)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{pnl?.totalBets ?? 0}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {pendingCount > 0 ? (
                            <Badge variant="outline" className="bg-amber-500/15 text-amber-500 border-amber-500/40">
                              {pendingCount}
                            </Badge>
                          ) : (
                            "0"
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="inline-flex items-center justify-center gap-2">
                            <Switch
                              checked={agent.isActive}
                              onCheckedChange={(checked) =>
                                toggleActiveMutation.mutate({ agentId: agent.id, active: checked })
                              }
                              disabled={pendingToggleAgentId === agent.id}
                              data-testid={`switch-agent-active-${agent.username}`}
                            />
                            {pendingToggleAgentId === agent.id && (
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => clearPendingMutation.mutate(agent.id)}
                            disabled={pendingClearAgentId === agent.id || pendingCount === 0}
                            data-testid={`button-clear-pending-${agent.username}`}
                          >
                            {pendingClearAgentId === agent.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Eraser className="h-4 w-4 mr-1" />
                            )}
                            Clear
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legacy agents */}
      {legacyAgents.length > 0 && (
        <Card data-testid="card-legacy-agents">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-500">
              <Bot className="h-5 w-5" />
              Legacy Agents ({legacyAgents.length})
            </CardTitle>
            <CardDescription>
              Pre-V2 agents detected. Run "Archive Legacy Only" or "Seed V2 Cohort" above to phase them out without losing historical data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              {legacyAgents.map((agent) => agent.username).join(", ")}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? ""}`}>{value ?? "-"}</div>
    </div>
  );
}
