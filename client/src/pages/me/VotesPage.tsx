import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  Vote,
  Swords,
  TrendingUp,
  TrendingDown,
  BarChart3,
  MessageCircle,
  ImageIcon,
  UserPlus,
  Star,
  ChevronDown,
  Check,
  Eye,
  EyeOff,
  Sparkles,
  Flame,
  Trophy,
  Target,
  Info,
  ThumbsUp,
  Users,
  Lock,
} from "lucide-react";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getAuthHeaders } from "@/lib/queryClient";
import { ProfileTabs, type ProfileTab } from "@/components/ProfileTabs";
import { MyVoteCard, type MyVoteCardData } from "@/components/me/MyVoteCard";
import { PersonAvatar } from "@/components/PersonAvatar";
import { DoughnutChart, type DoughnutSegment } from "@/components/charts/DoughnutChart";
import { useItemVisibility, voteTypeToPrivacyType } from "@/hooks/useItemVisibility";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
} from "recharts";

type UnifiedVote = MyVoteCardData;

// Shared colors per vote type so the doughnut, the card accent, and the filter
// chips all reinforce each other.
const VOTE_TYPE_COLOR: Record<string, string> = {
  overall_rating: "#06B6D4",
  face_off: "#8B5CF6",
  sentiment: "#22D3EE",
  value_vote: "#F59E0B",
  trending_poll: "#3B82F6",
  opinion_poll: "#0EA5E9",
  image_curate: "#EC4899",
  induction: "#10B981",
};

// Vote types that carry a Support/Oppose/Neutral stance (used for voice balance).
const STANCE_VOTE_TYPES = new Set([
  "sentiment",
  "value_vote",
  "trending_poll",
  "image_curate",
  "overall_rating",
]);

// Person-tied vote types (used for "Subjects you've shaped").
const PERSON_VOTE_TYPES = new Set([
  "sentiment",
  "value_vote",
  "image_curate",
  "induction",
  "overall_rating",
]);

const VOTE_TYPES = [
  { value: "overall_rating", label: "Overall Rating", icon: ThumbsUp },
  { value: "face_off", label: "Matchups", icon: Swords },
  { value: "sentiment", label: "Over/Underrated", icon: TrendingUp },
  { value: "value_vote", label: "Value Votes", icon: Star },
  { value: "trending_poll", label: "Sentiment Polls", icon: BarChart3 },
  { value: "opinion_poll", label: "Opinion Polls", icon: MessageCircle },
  { value: "image_curate", label: "Image Curate", icon: ImageIcon },
  { value: "induction", label: "Induction", icon: UserPlus },
] as const;

type VoteTypeValue = (typeof VOTE_TYPES)[number]["value"];

const VALID_TABS = ["overview", "votes", "impact"] as const;
type VotesTab = (typeof VALID_TABS)[number];

const TABS: ProfileTab[] = [
  { id: "overview", label: "Overview", icon: Eye, accent: "#3C83F6" },
  { id: "votes", label: "My Votes", icon: Vote, accent: "#22D3EE" },
  { id: "impact", label: "Impact", icon: Sparkles, accent: "#F59E0B" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getVoteTypeLabel(voteType: string) {
  return VOTE_TYPES.find((t) => t.value === voteType)?.label ?? voteType;
}

function getInitialTab(): VotesTab {
  if (typeof window === "undefined") return "overview";
  const param = new URLSearchParams(window.location.search).get("tab");
  return VALID_TABS.includes(param as VotesTab) ? (param as VotesTab) : "overview";
}

function getInitialVoteFilter(): VoteTypeValue | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("type");
  const match = VOTE_TYPES.find((t) => t.value === param);
  return match ? match.value : null;
}

function getInitialHiddenOnly(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("hidden") === "1";
}

// Small inline pill used by filter rows. Visually quiet when inactive; accent-tinted when active.
function FilterPill({
  active,
  onClick,
  children,
  accent = "cyan",
  count,
  dataTestId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: "cyan" | "violet" | "amber" | "emerald" | "rose" | "blue" | "slate";
  count?: number;
  dataTestId?: string;
}) {
  const accentClass: Record<string, string> = {
    cyan: "border-cyan-500/50 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
    violet: "border-violet-500/50 bg-violet-500/15 text-violet-600 dark:text-violet-300",
    amber: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    emerald: "border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    rose: "border-rose-500/50 bg-rose-500/15 text-rose-600 dark:text-rose-300",
    blue: "border-blue-500/50 bg-blue-500/15 text-blue-600 dark:text-blue-300",
    slate: "border-slate-400/50 bg-slate-500/15 text-slate-600 dark:text-slate-300",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
        active
          ? accentClass[accent]
          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] tabular-nums",
            active ? "bg-background/40" : "bg-muted/60",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function VotesPage() {
  const { user, profile } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<VotesTab>(getInitialTab);
  const [activeFilter, setActiveFilterState] = useState<VoteTypeValue | null>(
    getInitialVoteFilter,
  );
  const [hiddenOnly, setHiddenOnlyState] = useState<boolean>(getInitialHiddenOnly);

  const writeQuery = (patch: Record<string, string | null>) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState({}, "", url.toString());
  };

  const handleTabChange = (next: string) => {
    const tab = VALID_TABS.includes(next as VotesTab) ? (next as VotesTab) : "overview";
    setActiveTab(tab);
    writeQuery({ tab: tab === "overview" ? null : tab });
  };

  const setActiveFilter = (next: VoteTypeValue | null) => {
    setActiveFilterState(next);
    writeQuery({ type: next });
  };

  const setHiddenOnly = (next: boolean) => {
    setHiddenOnlyState(next);
    writeQuery({ hidden: next ? "1" : null });
  };

  const { data: votes, isLoading, isFetching, error } = useQuery<UnifiedVote[]>({
    queryKey: ["/api/me/votes", activeFilter ?? "all"],
    queryFn: async () => {
      const url = activeFilter ? `/api/me/votes?type=${activeFilter}` : "/api/me/votes";
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, { credentials: "include", headers: authHeaders });
      if (!res.ok) throw new Error("Failed to fetch votes");
      return res.json();
    },
    enabled: !!user,
  });

  // Full votes (unfiltered) — powers the Overview and Impact tabs so they don't flicker when filters change.
  const { data: allVotes } = useQuery<UnifiedVote[]>({
    queryKey: ["/api/me/votes", "all"],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/me/votes", { credentials: "include", headers: authHeaders });
      if (!res.ok) throw new Error("Failed to fetch votes");
      return res.json();
    },
    enabled: !!user,
  });

  const visibility = useItemVisibility();
  const profileIsPrivate = profile ? profile.isPublic === false : false;

  const handleToggleVisibility = (vote: UnifiedVote, nextHidden: boolean) => {
    const pType = voteTypeToPrivacyType(vote.voteType);
    if (!pType) return;
    visibility.mutate({ itemType: pType, itemId: String(vote.id), hidden: nextHidden });
  };

  const list = votes ?? [];
  const filtered = hiddenOnly ? list.filter((v) => v.hidden) : list;

  const totalCount = useMemo(() => {
    if (allVotes) return allVotes.length;
    if (list.length) return list.length;
    return profile?.totalVotes ?? 0;
  }, [allVotes, list.length, profile?.totalVotes]);

  const hiddenCount = useMemo(() => list.filter((v) => v.hidden).length, [list]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <Vote className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to view your votes</h2>
          <Button
            onClick={() => navigateToLogin(setLocation)}
            className="mt-4"
            data-testid="button-sign-in"
          >
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else setLocation("/me");
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold">My Votes</h1>
            <p className="text-xs text-muted-foreground">
              Your voice, every subject you&apos;ve shaped
            </p>
          </div>
        </div>
      </header>

      <div
        id="profile-tabs-section"
        className="sticky top-14 z-40 border-b bg-background/80 backdrop-blur-xl"
      >
        <div className="container mx-auto px-4 py-2 max-w-3xl">
          <ProfileTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
            tabs={TABS}
            noBottomMargin
          />
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
        {profileIsPrivate && (
          <Card className="p-3 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-2 text-xs sm:text-sm">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium text-amber-700 dark:text-amber-300">
                  Your profile is private
                </p>
                <p className="text-muted-foreground">
                  Nothing below is currently visible to others. You can still choose per-item
                  visibility here — it&apos;ll apply the moment you make your profile public.
                </p>
              </div>
            </div>
          </Card>
        )}

        {activeTab === "overview" && (
          <OverviewTab
            allVotes={allVotes ?? []}
            hiddenCount={allVotes ? allVotes.filter((v) => v.hidden).length : 0}
            totalVotes={totalCount}
            currentStreak={profile?.currentStreak ?? 0}
            onJumpToHidden={() => {
              setHiddenOnly(true);
              handleTabChange("votes");
            }}
            onJumpToVotes={() => handleTabChange("votes")}
            onJumpToImpact={() => handleTabChange("impact")}
            onFilterAndJumpToVotes={(type) => {
              setActiveFilter(type);
              handleTabChange("votes");
            }}
            isLoading={!allVotes && isLoading}
          />
        )}

        {activeTab === "votes" && (
          <VotesTabPanel
            votes={filtered}
            allCount={list.length}
            hiddenCount={hiddenCount}
            hiddenOnly={hiddenOnly}
            onToggleHiddenOnly={() => setHiddenOnly(!hiddenOnly)}
            activeFilter={activeFilter}
            onChangeFilter={setActiveFilter}
            onToggleVisibility={handleToggleVisibility}
            profileIsPrivate={profileIsPrivate}
            isPending={visibility.isPending}
            isLoading={isLoading}
            isFetching={isFetching}
            error={error as Error | undefined}
            setLocation={setLocation}
          />
        )}

        {activeTab === "impact" && (
          <ImpactTab
            allVotes={allVotes ?? []}
            isLoading={!allVotes && isLoading}
            onJumpToVotes={() => handleTabChange("votes")}
            setLocation={setLocation}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Tab: Overview ----------

function OverviewTab({
  allVotes,
  hiddenCount,
  totalVotes,
  currentStreak,
  onJumpToHidden,
  onJumpToVotes,
  onJumpToImpact,
  onFilterAndJumpToVotes,
  isLoading,
}: {
  allVotes: UnifiedVote[];
  hiddenCount: number;
  totalVotes: number;
  currentStreak: number;
  onJumpToHidden: () => void;
  onJumpToVotes: () => void;
  onJumpToImpact: () => void;
  onFilterAndJumpToVotes: (type: VoteTypeValue) => void;
  isLoading: boolean;
}) {
  const monthlyData = useMemo(() => {
    const buckets = new Map<string, number>();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(key, 0);
    }
    for (const v of allVotes) {
      const d = new Date(v.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries()).map(([key, count]) => {
      const [y, m] = key.split("-");
      return { label: MONTHS[Number(m) - 1], value: count, key, year: Number(y) };
    });
  }, [allVotes]);

  // Doughnut: mix by vote type.
  const byTypeSegments: DoughnutSegment[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of allVotes) counts.set(v.voteType, (counts.get(v.voteType) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        id: type,
        label: getVoteTypeLabel(type),
        value: count,
        color: VOTE_TYPE_COLOR[type] ?? "#64748B",
      }));
  }, [allVotes]);

  // Doughnut: Support / Oppose / Neutral across stance-carrying votes.
  // overall_rating is bucketed by zone (1-2 = oppose, 3 = neutral, 4-5 = support).
  const voiceBalanceSegments: DoughnutSegment[] = useMemo(() => {
    let support = 0;
    let oppose = 0;
    let neutral = 0;
    for (const v of allVotes) {
      if (!STANCE_VOTE_TYPES.has(v.voteType)) continue;
      if (v.voteType === "overall_rating") {
        const r = Math.round(v.value || 0);
        if (r >= 4) support += 1;
        else if (r <= 2) oppose += 1;
        else neutral += 1;
        continue;
      }
      if (v.value > 0) support += 1;
      else if (v.value < 0) oppose += 1;
      else neutral += 1;
    }
    return [
      { id: "support", label: "Support", value: support, color: "#10B981" },
      { id: "oppose", label: "Oppose", value: oppose, color: "#F43F5E" },
      { id: "neutral", label: "Neutral", value: neutral, color: "#64748B" },
    ];
  }, [allVotes]);

  const voiceTotal = voiceBalanceSegments.reduce((s, seg) => s + seg.value, 0);
  const voiceLean = useMemo(() => {
    if (voiceTotal === 0) return null;
    const [support, oppose] = voiceBalanceSegments;
    const sPct = support.value / voiceTotal;
    const oPct = oppose.value / voiceTotal;
    if (Math.abs(sPct - oPct) < 0.05) return "Balanced";
    return sPct > oPct ? "Optimist" : "Sceptic";
  }, [voiceBalanceSegments, voiceTotal]);

  // Most-voted subject (across any person-tied type, incl. overall_rating).
  const topSubject = useMemo(() => {
    const byKey = new Map<
      string,
      { name: string; total: number; up: number; down: number; avatar?: string | null; imageSlug?: string | null }
    >();
    for (const v of allVotes) {
      if (!PERSON_VOTE_TYPES.has(v.voteType)) continue;
      const name = v.targetName?.trim();
      if (!name || name === "Unknown") continue;
      const key = v.subjectId || name;
      const cur = byKey.get(key) ?? { name, total: 0, up: 0, down: 0 };
      cur.total += 1;
      // Overall rating: 4+ = up, 1-2 = down; 3 neutral.
      if (v.voteType === "overall_rating") {
        const r = Math.round(v.value || 0);
        if (r >= 4) cur.up += 1;
        else if (r <= 2) cur.down += 1;
      } else {
        if (v.value > 0) cur.up += 1;
        if (v.value < 0) cur.down += 1;
      }
      if (!cur.avatar && v.subjectAvatar) cur.avatar = v.subjectAvatar;
      if (!cur.imageSlug && v.subjectImageSlug) cur.imageSlug = v.subjectImageSlug;
      byKey.set(key, cur);
    }
    const sorted = Array.from(byKey.values()).sort((a, b) => b.total - a.total);
    return sorted[0] ?? null;
  }, [allVotes]);

  // Alignment % (community majority).
  const alignment = useMemo(() => {
    let comparable = 0;
    let aligned = 0;
    for (const v of allVotes) {
      if (v.alignedWithMajority === true) { comparable += 1; aligned += 1; }
      else if (v.alignedWithMajority === false) { comparable += 1; }
    }
    return { comparable, aligned, pct: comparable > 0 ? Math.round((aligned / comparable) * 100) : null };
  }, [allVotes]);

  const visibleCount = totalVotes - hiddenCount;
  const hasData = allVotes.length > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={<Vote className="h-4 w-4 text-cyan-500" />}
          label="Total votes"
          value={totalVotes.toLocaleString()}
        />
        <StatTile
          icon={<Flame className="h-4 w-4 text-orange-500" />}
          label="Current streak"
          value={`${currentStreak} day${currentStreak === 1 ? "" : "s"}`}
        />
        <StatTile
          icon={<Eye className="h-4 w-4 text-emerald-500" />}
          label="Public"
          value={`${visibleCount}`}
          helper={totalVotes > 0 ? `${Math.round((visibleCount / totalVotes) * 100)}% of total` : undefined}
        />
        <StatTile
          icon={<EyeOff className="h-4 w-4 text-muted-foreground" />}
          label="Hidden"
          value={`${hiddenCount}`}
          helper={
            hiddenCount > 0 ? (
              <button
                className="text-primary hover:underline text-[10px]"
                onClick={onJumpToHidden}
              >
                Review →
              </button>
            ) : undefined
          }
        />
      </div>

      {isLoading ? (
        <>
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </>
      ) : hasData ? (
        <>
          {topSubject && (
            <MostVotedSubjectHero
              subject={topSubject}
              totalVotes={allVotes.length}
              onSeeAll={onJumpToImpact}
            />
          )}

          <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm">Votes cast per month</h3>
                <p className="text-xs text-muted-foreground">Last 6 months</p>
              </div>
              <Badge variant="outline" className="gap-1 text-[10px]">
                <TrendingUp className="h-3 w-3" /> {allVotes.length} lifetime
              </Badge>
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyData} margin={{ top: 5, right: 8, left: -24, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-muted-foreground"
                    allowDecimals={false}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3C83F6"
                    strokeWidth={2.2}
                    dot={{ r: 3, fill: "#3C83F6" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm">How you vote</h3>
                <p className="text-xs text-muted-foreground">Tap a slice to filter your votes</p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs" onClick={onJumpToVotes}>
                Browse all →
              </Button>
            </div>
            <DoughnutChart
              data={byTypeSegments}
              centerTitle={allVotes.length}
              centerSubtitle="votes"
              height={240}
              onSegmentClick={(id) => {
                const match = VOTE_TYPES.find((t) => t.value === id);
                if (match) onFilterAndJumpToVotes(match.value);
              }}
            />
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <AlignmentTile
              pct={alignment.pct}
              comparable={alignment.comparable}
              aligned={alignment.aligned}
            />
            <VoiceBalanceTile
              segments={voiceBalanceSegments}
              voiceTotal={voiceTotal}
              lean={voiceLean}
            />
          </div>

          <JourneyTimeline allVotes={allVotes} />
        </>
      ) : (
        <EmptyState
          onStart={() => {
            window.location.assign("/vote");
          }}
        />
      )}
    </div>
  );
}

function MostVotedSubjectHero({
  subject,
  totalVotes,
  onSeeAll,
}: {
  subject: { name: string; total: number; up: number; down: number; avatar?: string | null; imageSlug?: string | null };
  totalVotes: number;
  onSeeAll: () => void;
}) {
  const share = totalVotes > 0 ? Math.round((subject.total / totalVotes) * 100) : 0;
  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500/15 via-cyan-500/10 to-transparent" />
      <div className="relative flex items-center gap-4">
        <PersonAvatar
          name={subject.name}
          avatar={subject.avatar ?? undefined}
          imageSlug={subject.imageSlug ?? undefined}
          className="h-16 w-16 ring-2 ring-blue-500/30 shadow-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Most-voted subject
          </p>
          <p className="mt-0.5 text-xl font-bold leading-tight truncate" title={subject.name}>
            {subject.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground tabular-nums">{subject.total}</span>{" "}
              {subject.total === 1 ? "vote" : "votes"}
              {totalVotes > 0 && (
                <span className="ml-1 text-muted-foreground/80">({share}% of yours)</span>
              )}
            </span>
            {subject.up > 0 && (
              <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                <ChevronDown className="hidden" aria-hidden />
                <TrendingUp className="h-3 w-3" /> {subject.up} up
              </span>
            )}
            {subject.down > 0 && (
              <span className="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400">
                <TrendingDown className="h-3 w-3" /> {subject.down} down
              </span>
            )}
          </div>
          <button
            onClick={onSeeAll}
            className="mt-2 text-xs font-medium text-primary hover:underline"
            data-testid="hero-see-all-impact"
          >
            See all on Impact →
          </button>
        </div>
      </div>
    </Card>
  );
}

function AlignmentTile({
  pct,
  comparable,
  aligned,
}: {
  pct: number | null;
  comparable: number;
  aligned: number;
}) {
  const readyThreshold = 5;
  const ready = pct !== null && comparable >= readyThreshold;

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">Community alignment</h3>
            <Badge variant="outline" className="text-[10px]">
              {ready ? `${comparable} compared` : "Needs more votes"}
            </Badge>
          </div>
          {ready ? (
            <>
              <p className="mt-2 text-3xl font-mono font-bold tabular-nums">{pct}%</p>
              <p className="text-xs text-muted-foreground">
                of your picks matched the crowd&apos;s majority
                <span className="ml-1 text-muted-foreground/80">
                  ({aligned} of {comparable})
                </span>
              </p>
              <div className="mt-3 h-2 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              We&apos;ll measure your alignment once you have at least {readyThreshold} comparable votes
              (matchups, polls, sentiment, value, or overall rating).
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function VoiceBalanceTile({
  segments,
  voiceTotal,
  lean,
}: {
  segments: DoughnutSegment[];
  voiceTotal: number;
  lean: string | null;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-sm">Voice balance</h3>
          <p className="text-xs text-muted-foreground">How often you cheer, challenge, or stay neutral</p>
        </div>
        {lean && (
          <Badge variant="outline" className="text-[10px]">
            {lean}
          </Badge>
        )}
      </div>
      <div className="mt-2">
        <DoughnutChart
          data={segments}
          centerTitle={voiceTotal}
          centerSubtitle="stance votes"
          height={200}
        />
      </div>
    </Card>
  );
}

// Milestone journey bar. Each milestone can be "earned" or still ahead.
interface Milestone {
  id: string;
  label: string;
  earned: boolean;
  progress?: number; // 0..1 for not-yet-earned
  hint?: string;
}

function JourneyTimeline({ allVotes }: { allVotes: UnifiedVote[] }) {
  const milestones: Milestone[] = useMemo(() => {
    const total = allVotes.length;
    const firstMatchup = allVotes.some((v) => v.voteType === "face_off");
    const firstRating = allVotes.some((v) => v.voteType === "overall_rating");
    const firstValue = allVotes.some((v) => v.voteType === "value_vote");
    const n = (needed: number) => ({
      earned: total >= needed,
      progress: Math.min(1, total / needed),
      hint: `${Math.min(total, needed)}/${needed}`,
    });
    return [
      { id: "first", label: "First vote", ...n(1) },
      { id: "v10", label: "10 votes", ...n(10) },
      { id: "v50", label: "50 votes", ...n(50) },
      { id: "v100", label: "100 votes", ...n(100) },
      { id: "first_matchup", label: "First matchup", earned: firstMatchup, progress: firstMatchup ? 1 : 0 },
      { id: "first_rating", label: "First rating", earned: firstRating, progress: firstRating ? 1 : 0 },
      { id: "first_value", label: "First value vote", earned: firstValue, progress: firstValue ? 1 : 0 },
    ];
  }, [allVotes]);

  const earnedCount = milestones.filter((m) => m.earned).length;
  const nextIdx = milestones.findIndex((m) => !m.earned);
  const nextProgress =
    nextIdx >= 0 && milestones[nextIdx].progress !== undefined
      ? milestones[nextIdx].progress!
      : 0;
  // Track fill percentage. Line passes through all node centers;
  // fill reaches the last-earned node, with a partial extension into the next node's progress.
  const denom = Math.max(1, milestones.length - 1);
  const baseFill = earnedCount > 0 ? (earnedCount - 1) / denom : 0;
  const extraFill = earnedCount < milestones.length ? nextProgress / denom : 0;
  const progressPct = Math.min(100, Math.max(0, (baseFill + extraFill) * 100));

  return (
    <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Your voting journey</h3>
          <p className="text-xs text-muted-foreground">
            {earnedCount} of {milestones.length} milestones earned
          </p>
        </div>
        <Trophy className="h-4 w-4 text-amber-500" />
      </div>

      {/* Desktop: horizontal track with connecting line + glowing earned nodes */}
      <div className="hidden md:block relative pt-1">
        <div className="absolute left-5 right-5 top-[22px] h-0.5 rounded-full bg-muted" aria-hidden />
        <div
          className="absolute left-5 top-[22px] h-0.5 rounded-full bg-gradient-to-r from-cyan-500 to-cyan-500/40 transition-all duration-500"
          style={{ width: `calc((100% - 40px) * ${progressPct / 100})` }}
          aria-hidden
        />
        <ol className="relative flex items-start justify-between gap-1">
          {milestones.map((m) => (
            <li key={m.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div
                className={cn(
                  "relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-background transition-all",
                  m.earned
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-500 shadow-[0_0_12px_-2px_rgba(34,211,238,0.65)]"
                    : "border-dashed border-muted-foreground/40 text-muted-foreground",
                )}
              >
                {m.earned ? <Check className="h-4 w-4" /> : <Target className="h-4 w-4" />}
              </div>
              <p
                className="line-clamp-2 max-w-[88px] text-center text-[10px] font-medium leading-tight"
                title={m.label}
              >
                {m.label}
              </p>
              {!m.earned && m.hint && (
                <p className="text-[9px] text-muted-foreground tabular-nums">{m.hint}</p>
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* Mobile: vertical track with left border and full-row milestones */}
      <ol className="md:hidden relative space-y-4 border-l-2 border-muted pl-5">
        {milestones.map((m) => (
          <li key={m.id} className="relative">
            <div
              className={cn(
                "absolute -left-[29px] top-0 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-background",
                m.earned
                  ? "border-cyan-500 bg-cyan-500/15 text-cyan-500 shadow-[0_0_12px_-2px_rgba(34,211,238,0.65)]"
                  : "border-dashed border-muted-foreground/40 text-muted-foreground",
              )}
            >
              {m.earned ? <Check className="h-4 w-4" /> : <Target className="h-4 w-4" />}
            </div>
            <div className="pl-8 pt-1">
              <p className="text-sm font-medium leading-tight">{m.label}</p>
              {m.earned ? (
                <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-600 dark:text-cyan-400">
                  Earned
                </p>
              ) : (
                <>
                  {m.hint && (
                    <p className="text-[10px] text-muted-foreground tabular-nums">{m.hint}</p>
                  )}
                  {m.progress !== undefined && m.progress > 0 && (
                    <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-muted/60">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                        style={{ width: `${Math.round(m.progress * 100)}%` }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function StatTile({
  icon,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  helper?: React.ReactNode;
}) {
  return (
    <Card className="p-3 text-center space-y-1 border-white/5 bg-card/60 backdrop-blur-sm">
      <div className="flex items-center justify-center">{icon}</div>
      <p className="text-2xl font-mono font-bold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
        {label}
      </p>
      {helper ? <div className="pt-0.5 leading-none">{helper}</div> : null}
    </Card>
  );
}

// ---------- Tab: Votes ----------

function VotesTabPanel({
  votes,
  allCount,
  hiddenCount,
  hiddenOnly,
  onToggleHiddenOnly,
  activeFilter,
  onChangeFilter,
  onToggleVisibility,
  profileIsPrivate,
  isPending,
  isLoading,
  isFetching,
  error,
  setLocation,
}: {
  votes: UnifiedVote[];
  allCount: number;
  hiddenCount: number;
  hiddenOnly: boolean;
  onToggleHiddenOnly: () => void;
  activeFilter: VoteTypeValue | null;
  onChangeFilter: (value: VoteTypeValue | null) => void;
  onToggleVisibility: (vote: UnifiedVote, hidden: boolean) => void;
  profileIsPrivate: boolean;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | undefined;
  setLocation: (to: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" data-testid="votes-filter-row">
        <FilterPill
          active={!activeFilter}
          accent="cyan"
          onClick={() => onChangeFilter(null)}
          dataTestId="filter-pill-all"
        >
          All
        </FilterPill>
        {VOTE_TYPES.map((t) => {
          const Icon = t.icon;
          return (
            <FilterPill
              key={t.value}
              active={activeFilter === t.value}
              accent="cyan"
              onClick={() => onChangeFilter(t.value)}
              dataTestId={`filter-pill-${t.value}`}
            >
              <Icon className="h-3 w-3" />
              {t.label}
            </FilterPill>
          );
        })}
        <FilterPill
          active={hiddenOnly}
          accent="amber"
          onClick={onToggleHiddenOnly}
          count={hiddenCount}
          dataTestId="toggle-hidden-only"
        >
          <EyeOff className="h-3 w-3" />
          Hidden only
        </FilterPill>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <Vote className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-lg font-semibold mb-2">Couldn&apos;t load votes</h2>
          <p className="text-muted-foreground mb-4">Please try again in a moment.</p>
          <Button onClick={() => window.location.reload()} data-testid="button-retry-votes">
            Retry
          </Button>
        </Card>
      ) : votes.length > 0 ? (
        <div
          className={`grid grid-cols-1 lg:grid-cols-2 gap-3 transition-opacity ${
            isFetching && !isLoading ? "opacity-75" : ""
          }`}
        >
          {votes.map((vote) => (
            <MyVoteCard
              key={`${vote.voteType}-${vote.id}`}
              vote={vote}
              profileIsPrivate={profileIsPrivate}
              onToggleVisibility={onToggleVisibility}
              isPending={isPending}
            />
          ))}
        </div>
      ) : hiddenOnly ? (
        <Card className="p-8 text-center">
          <EyeOff className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-2">No hidden votes</h2>
          <p className="text-muted-foreground mb-4">Everything is visible on your public profile.</p>
          <Button variant="outline" onClick={onToggleHiddenOnly}>
            Show all votes
          </Button>
        </Card>
      ) : allCount === 0 ? (
        <EmptyState onStart={() => setLocation("/vote")} />
      ) : (
        <Card className="p-8 text-center">
          <Vote className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-2">No matches</h2>
          <p className="text-muted-foreground mb-4">Try clearing filters to see more.</p>
          <Button variant="outline" onClick={() => onChangeFilter(null)}>
            Clear filters
          </Button>
        </Card>
      )}
    </div>
  );
}

// ---------- Tab: Impact ----------

interface ShapedSubject {
  key: string;
  name: string;
  total: number;
  up: number;
  down: number;
  avatar: string | null;
  imageSlug: string | null;
}

function ImpactTab({
  allVotes,
  isLoading,
  onJumpToVotes,
  setLocation,
}: {
  allVotes: UnifiedVote[];
  isLoading: boolean;
  onJumpToVotes: () => void;
  setLocation: (to: string) => void;
}) {
  // Aggregate person-tied votes (incl. overall_rating) by subjectId when available,
  // falling back to name so older data without a server-side subjectId still clusters.
  const shapedSubjects = useMemo<ShapedSubject[]>(() => {
    const byKey = new Map<string, ShapedSubject>();
    for (const v of allVotes) {
      if (!PERSON_VOTE_TYPES.has(v.voteType)) continue;
      const name = v.targetName?.trim();
      if (!name || name === "Unknown") continue;
      const key = v.subjectId || name;
      const cur = byKey.get(key) ?? {
        key,
        name,
        total: 0,
        up: 0,
        down: 0,
        avatar: null,
        imageSlug: null,
      };
      cur.total += 1;
      if (v.voteType === "overall_rating") {
        const r = Math.round(v.value || 0);
        if (r >= 4) cur.up += 1;
        else if (r <= 2) cur.down += 1;
      } else {
        if (v.value > 0) cur.up += 1;
        if (v.value < 0) cur.down += 1;
      }
      if (!cur.avatar && v.subjectAvatar) cur.avatar = v.subjectAvatar;
      if (!cur.imageSlug && v.subjectImageSlug) cur.imageSlug = v.subjectImageSlug;
      byKey.set(key, cur);
    }
    return Array.from(byKey.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [allVotes]);

  // Contrarian index: % of comparable votes where the user went against the crowd.
  const contrarian = useMemo(() => {
    let comparable = 0;
    let against = 0;
    for (const v of allVotes) {
      if (v.alignedWithMajority === true) comparable += 1;
      else if (v.alignedWithMajority === false) { comparable += 1; against += 1; }
    }
    return {
      comparable,
      against,
      pct: comparable > 0 ? Math.round((against / comparable) * 100) : null,
    };
  }, [allVotes]);

  const badges = useMemo(() => {
    const arr: { id: string; label: string; description: string; icon: React.ReactNode; earned: boolean }[] = [];
    arr.push({
      id: "first_vote",
      label: "First Vote",
      description: "Cast your first vote",
      icon: <Vote className="h-5 w-5 text-cyan-500" />,
      earned: allVotes.length >= 1,
    });
    arr.push({
      id: "vote_25",
      label: "Quarter Century",
      description: "Cast 25 votes",
      icon: <Target className="h-5 w-5 text-sky-500" />,
      earned: allVotes.length >= 25,
    });
    arr.push({
      id: "vote_100",
      label: "Century Citizen",
      description: "Cast 100 votes",
      icon: <Trophy className="h-5 w-5 text-amber-500" />,
      earned: allVotes.length >= 100,
    });
    const distinctTypes = new Set(allVotes.map((v) => v.voteType)).size;
    arr.push({
      id: "well_rounded",
      label: "Well-Rounded",
      description: "Vote in 4+ different sections",
      icon: <Sparkles className="h-5 w-5 text-violet-500" />,
      earned: distinctTypes >= 4,
    });
    arr.push({
      id: "subject_shaper",
      label: "Subject Shaper",
      description: "Cast 5+ votes on the same person",
      icon: <Flame className="h-5 w-5 text-orange-500" />,
      earned: shapedSubjects.some((s) => s.total >= 5),
    });
    return arr;
  }, [allVotes, shapedSubjects]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (allVotes.length < 5) {
    return (
      <Card className="p-8 text-center space-y-4">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 mx-auto">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Your impact is just beginning</h2>
        <p className="text-muted-foreground max-w-sm mx-auto">
          Cast at least 5 votes to unlock a personalised impact map showing which subjects you&apos;ve
          shaped the most.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" onClick={onJumpToVotes}>
            <Vote className="h-4 w-4 mr-2" /> See my votes
          </Button>
          <Button size="sm" onClick={() => setLocation("/vote")}>
            Cast a vote
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <ContrarianIndexCard
        pct={contrarian.pct}
        comparable={contrarian.comparable}
        against={contrarian.against}
      />

      <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-sm">Subjects you&apos;ve shaped</h3>
            <p className="text-xs text-muted-foreground">The people your voice has most weighed in on</p>
          </div>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Flame className="h-3 w-3" /> Top 6
          </Badge>
        </div>
        {shapedSubjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No person-tied votes yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {shapedSubjects.map((s, i) => (
              <li
                key={s.key}
                className="flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-white/5 hover:bg-white/5"
              >
                <span className="w-5 shrink-0 text-center font-mono text-sm font-bold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <PersonAvatar
                  name={s.name}
                  avatar={s.avatar ?? undefined}
                  imageSlug={s.imageSlug ?? undefined}
                  className="h-12 w-12"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate" title={s.name}>
                    {s.name}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {s.up > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">+{s.up} up</span>
                    )}
                    {s.down > 0 && (
                      <span className="text-rose-600 dark:text-rose-400">−{s.down} down</span>
                    )}
                    {s.up === 0 && s.down === 0 && <span>votes</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-lg font-bold tabular-nums leading-none">
                    {s.total}
                  </span>
                  <MiniTrend direction={s.up - s.down} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="p-4 sm:p-5 border-white/5 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-sm">Badges</h3>
            <p className="text-xs text-muted-foreground">Earn milestones as you vote</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {badges.map((b) => (
            <div
              key={b.id}
              className={cn(
                "relative rounded-lg border p-3 text-center transition",
                b.earned
                  ? "border-cyan-500/30 bg-cyan-500/5 ring-1 ring-cyan-500/30"
                  : "border-border/60 bg-muted/10 opacity-30 grayscale",
              )}
            >
              {!b.earned && (
                <Lock
                  className="absolute right-1.5 top-1.5 h-3 w-3 text-muted-foreground"
                  aria-hidden
                />
              )}
              <div className="flex justify-center mb-1.5">{b.icon}</div>
              <p className="text-xs font-semibold">{b.label}</p>
              <p className="text-[10px] text-muted-foreground">{b.description}</p>
              {b.earned && (
                <Badge
                  variant="outline"
                  className="mt-1.5 h-4 gap-1 border-emerald-500/40 bg-emerald-500/10 text-[9px] text-emerald-600 dark:text-emerald-300"
                >
                  <Check className="h-2.5 w-2.5" /> Earned
                </Badge>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function MiniTrend({ direction }: { direction: number }) {
  if (direction > 0) return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  if (direction < 0) return <TrendingDown className="h-4 w-4 text-rose-500" />;
  return <div className="h-[2px] w-5 rounded-full bg-muted-foreground/50" />;
}

function ContrarianIndexCard({
  pct,
  comparable,
  against,
}: {
  pct: number | null;
  comparable: number;
  against: number;
}) {
  const readyThreshold = 5;
  const ready = pct !== null && comparable >= readyThreshold;

  // Personality label that describes the user's contrarian tendency.
  const persona = ready
    ? pct! >= 60
      ? "Pure Contrarian"
      : pct! >= 40
        ? "Healthy Sceptic"
        : pct! >= 20
          ? "Independent Thinker"
          : "Consensus Voice"
    : null;

  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-transparent" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <Target className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">Contrarian index</h3>
            {persona && (
              <Badge
                variant="outline"
                className="border-violet-500/40 bg-violet-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-violet-600 dark:text-violet-300"
              >
                {persona}
              </Badge>
            )}
          </div>
          {ready ? (
            <>
              <p className="mt-2 text-3xl font-mono font-bold tabular-nums">{pct}%</p>
              <p className="text-xs text-muted-foreground">
                of your comparable votes went against the crowd&apos;s majority
                <span className="ml-1 text-muted-foreground/80">
                  ({against} of {comparable})
                </span>
              </p>
              <div className="mt-3 h-2 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Your contrarian streak unlocks after {readyThreshold} comparable votes. You&apos;ve got{" "}
              {comparable} so far.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <Card className="p-10 text-center space-y-4">
      <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 mx-auto">
        <Vote className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold">No votes yet</h2>
      <p className="text-muted-foreground max-w-sm mx-auto">
        Every great story starts with a single vote. Share your voice on the subjects that matter
        to you.
      </p>
      <Button size="lg" onClick={onStart} data-testid="button-start-voting">
        <Vote className="h-4 w-4 mr-2" />
        Start Voting
      </Button>
    </Card>
  );
}
