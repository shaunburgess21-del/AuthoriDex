import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Star, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightsSection, InsightsEmptyState } from "./insights-ui";
import { useInsightsQuery } from "@/lib/insights-hooks";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import type {
  InsightsDiscoverRow,
} from "@shared/insights/types";
import { cn } from "@/lib/utils";

/**
 * V1 Vote tab — six tiles surfacing community vote activity.
 *
 * Reuses existing aggregate endpoints where possible. No new backend work
 * beyond a `direction=asc` param added to /api/pulse/approval-current
 * (so the "Polarising" tile can fetch lowest-approval profiles).
 */

interface PolarisationRow {
  id: string;
  slug: string | null;
  title: string;
  kind: "opinion_poll" | "face_off";
  maxPct: number;
  spreadStddev: number | null;
  totalVotes: number;
  label: string;
}

interface OpinionPollOption {
  id: string;
  name: string;
  imageUrl: string | null;
  personId: string | null;
  personName: string | null;
  votes: number;
  percent: number;
}

interface OpinionPoll {
  id: string;
  slug: string | null;
  title: string;
  category: string | null;
  imageUrl: string | null;
  options: OpinionPollOption[];
  totalVotes: number;
}

interface TrendingPoll {
  id: string;
  headline: string;
  slug: string | null;
  category: string | null;
  totalVotes: number;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  personName: string | null;
  personAvatar: string | null;
}

interface ApprovalPersonRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  approvalAvgRating: number;
  approvalVotesCount: number;
}

/** Raw fetch — for endpoints that return a bare payload (arrays / {people}). */
async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed: ${path}`);
  return res.json();
}

function pollHref(item: PolarisationRow): string | null {
  if (!item.slug) return null;
  return item.kind === "opinion_poll"
    ? `/vote/opinion-polls/${item.slug}`
    : `/vote/matchups/${item.slug}`;
}

function PollMiniBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-blue-600/80 to-blue-400/60 transition-all"
        style={{ width: `${Math.max(pct, 2)}%` }}
      />
    </div>
  );
}

function PolarisationTile({
  variant,
}: {
  variant: "knife-edge" | "landslide";
}) {
  // Shares the default key (["/api/insights/discover/polarisation"]) with
  // DiscoverTab — useInsightsQuery guarantees both cache the SAME unwrapped shape.
  const { data, isLoading } = useInsightsQuery<{
    lopsided: PolarisationRow[];
    evenlySplit: PolarisationRow[];
    polls: { lopsided: PolarisationRow[]; evenlySplit: PolarisationRow[] };
    faceOffs: { lopsided: PolarisationRow[]; evenlySplit: PolarisationRow[] };
  }>("/api/insights/discover/polarisation");

  // Use the per-kind lists (not the merged top-5) so neither kind gets crowded
  // out: knife-edge shows the most evenly-split face-offs; landslide shows the
  // most lopsided opinion polls.
  const list =
    variant === "knife-edge"
      ? (data?.faceOffs.evenlySplit ?? [])
      : (data?.polls.lopsided ?? []);

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (list.length === 0) {
    return (
      <InsightsEmptyState
        message={
          variant === "knife-edge"
            ? "No knife-edge matchups right now."
            : "No landslide opinion polls right now."
        }
      />
    );
  }

  return (
    <ul className="space-y-2">
      {list.slice(0, 5).map((item) => {
        const href = pollHref(item);
        const body = (
          <div className="rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 p-3 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug line-clamp-2">{item.title}</p>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                {Math.round(item.maxPct)}%
              </span>
            </div>
            <div className="mt-2">
              <PollMiniBar pct={item.maxPct} />
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
              {item.totalVotes.toLocaleString()} {item.totalVotes === 1 ? "vote" : "votes"}
            </p>
          </div>
        );
        return (
          <li key={`${item.kind}-${item.id}`}>
            {href ? (
              <Link
                href={href}
                onClick={() =>
                  logInsightsEvent("vote", "polarisation_row_click", {
                    variant,
                    kind: item.kind,
                    pollId: item.id,
                  })
                }
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MostVotedPollsTile() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/opinion-polls", "most-voted"],
    queryFn: () => fetchJson<OpinionPoll[]>("/api/opinion-polls"),
    staleTime: 90_000,
  });

  const ranked = (data ?? [])
    .filter((p) => p.totalVotes > 0)
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 5);

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (ranked.length === 0) {
    return <InsightsEmptyState message="No active opinion polls yet." />;
  }

  return (
    <ul className="space-y-2">
      {ranked.map((poll) => {
        const leader = [...poll.options].sort((a, b) => b.percent - a.percent)[0];
        const href = poll.slug ? `/vote/opinion-polls/${poll.slug}` : null;
        const body = (
          <div className="rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 p-3 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug line-clamp-2">{poll.title}</p>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                {poll.totalVotes.toLocaleString()}
              </span>
            </div>
            {leader && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Leading:{" "}
                <span className="font-medium text-foreground">{leader.name}</span>{" "}
                <span className="tabular-nums">({leader.percent}%)</span>
              </p>
            )}
          </div>
        );
        return (
          <li key={poll.id}>
            {href ? (
              <Link
                href={href}
                onClick={() =>
                  logInsightsEvent("vote", "most_voted_click", { pollId: poll.id })
                }
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DivergenceTile() {
  // Distinct 3-element key (DiscoverTab uses a 2-element key) so no cache
  // collision; still unwrap the envelope for consistency.
  const { data, isLoading } = useInsightsQuery<{ rows: InsightsDiscoverRow[]; total: number }>(
    "/api/insights/discover/divergence?type=underrated_gaining&limit=3",
    { queryKey: ["/api/insights/discover/divergence", "underrated_gaining", 3] },
  );

  const rows = data?.rows ?? [];

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (rows.length === 0) {
    return (
      <InsightsEmptyState message="Need a few more votes per person before this fills up." />
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/person/${row.id}`}
            onClick={() =>
              logInsightsEvent("vote", "divergence_row_click", { personId: row.id })
            }
            className="flex items-center gap-2.5 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
          >
            <PersonAvatar name={row.name} avatar={row.avatar} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{row.name}</p>
              <p className="text-[10px] text-muted-foreground leading-snug truncate">
                {row.highlight}
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ApprovalExtremesTile({
  direction,
}: {
  direction: "asc" | "desc";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/pulse/approval-current", direction, 5, 20],
    queryFn: () =>
      fetchJson<{ people: ApprovalPersonRow[] }>(
        `/api/pulse/approval-current?limit=5&direction=${direction}&minVotes=20`,
      ),
    staleTime: 90_000,
  });

  const rows = data?.people ?? [];
  const isLowest = direction === "asc";

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (rows.length === 0) {
    return (
      <InsightsEmptyState
        message={
          isLowest
            ? "Not enough low-approval ratings yet."
            : "Not enough approval ratings yet."
        }
      />
    );
  }

  return (
    <ul className="space-y-1.5">
      {rows.map((p) => (
        <li key={p.id}>
          <Link
            href={`/person/${p.id}`}
            onClick={() =>
              logInsightsEvent("vote", "approval_extreme_click", {
                direction,
                personId: p.id,
              })
            }
            className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
          >
            <PersonAvatar name={p.name} avatar={p.avatar} size="xs" />
            <span className="flex-1 min-w-0 truncate text-sm font-medium">{p.name}</span>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums shrink-0",
                isLowest ? "text-red-500" : "text-green-600 dark:text-green-400",
              )}
            >
              <Star className="h-3 w-3 fill-current" />
              {p.approvalAvgRating.toFixed(1)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SentimentPulseTile() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/trending-polls", "controversy"],
    queryFn: () => fetchJson<TrendingPoll[]>("/api/trending-polls"),
    staleTime: 90_000,
  });

  // Sort by closeness to a 50/50 split (most controversial first).
  const rows = (data ?? [])
    .filter((p) => p.totalVotes >= 5)
    .sort(
      (a, b) =>
        Math.abs(a.approvePercent - 50) - Math.abs(b.approvePercent - 50),
    )
    .slice(0, 5);

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (rows.length === 0) {
    return <InsightsEmptyState message="No sentiment topics with enough votes yet." />;
  }

  return (
    <ul className="space-y-2">
      {rows.map((p) => {
        // Trending poll detail lives at `/polls/:slug` (see App.tsx routes
        // and /api/polls/:slug). Earlier I used /vote/polls/:slug which
        // doesn't exist and 404s.
        const href = p.slug ? `/polls/${p.slug}` : null;
        const body = (
          <div className="rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 p-3 transition-colors">
            <p className="text-sm font-medium leading-snug line-clamp-2">{p.headline}</p>
            <div className="mt-2 flex items-center gap-2 text-[10px] tabular-nums">
              <span className="text-green-600 dark:text-green-400 font-semibold">
                {p.approvePercent}%
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden flex">
                <div
                  className="h-full bg-green-500/70"
                  style={{ width: `${p.approvePercent}%` }}
                />
                <div
                  className="h-full bg-slate-400/40"
                  style={{ width: `${p.neutralPercent}%` }}
                />
                <div
                  className="h-full bg-red-500/70"
                  style={{ width: `${p.disapprovePercent}%` }}
                />
              </div>
              <span className="text-red-500 font-semibold">{p.disapprovePercent}%</span>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
              {p.totalVotes.toLocaleString()} {p.totalVotes === 1 ? "vote" : "votes"}
            </p>
          </div>
        );
        return (
          <li key={p.id}>
            {href ? (
              <Link
                href={href}
                onClick={() =>
                  logInsightsEvent("vote", "sentiment_row_click", { pollId: p.id })
                }
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function VoteTab() {
  return (
    <div className="space-y-6 md:space-y-8">
      <div className="grid lg:grid-cols-2 gap-6">
        <InsightsSection
          title="Knife-edge matchups"
          description="Head-to-head votes that could go either way."
          accent="blue"
        >
          <PolarisationTile variant="knife-edge" />
        </InsightsSection>

        <InsightsSection
          title="Landslide opinion polls"
          description="Polls where the crowd has clearly picked a side."
        >
          <PolarisationTile variant="landslide" />
        </InsightsSection>

        <InsightsSection
          title="Most-voted opinion polls"
          description="Where the community is showing up to weigh in."
        >
          <MostVotedPollsTile />
        </InsightsSection>

        <InsightsSection
          title="Underrated & gaining"
          description="Profiles the crowd thinks are underrated while their attention rises."
        >
          <DivergenceTile />
        </InsightsSection>

        <InsightsSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-green-600" /> Highest approval
            </span>
          }
          description="Highest VoxDex approval ratings (min 20 votes)."
        >
          <ApprovalExtremesTile direction="desc" />
        </InsightsSection>

        <InsightsSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <TrendingDown className="h-3.5 w-3.5 text-red-500" /> Lowest approval
            </span>
          }
          description="Lowest VoxDex approval ratings (min 20 votes)."
        >
          <ApprovalExtremesTile direction="asc" />
        </InsightsSection>
      </div>

      <InsightsSection
        title="Sentiment pulse"
        description="Trending topics where support and opposition are closest to 50/50."
        accent="voxdex"
      >
        <SentimentPulseTile />
      </InsightsSection>
    </div>
  );
}
