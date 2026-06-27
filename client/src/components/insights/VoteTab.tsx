import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Scale,
  Swords,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightsSection, InsightsEmptyState } from "./insights-ui";
import { MarketThumbCollage } from "@/components/predict/MarketThumbCollage";
import { useInsightsQuery } from "@/lib/insights-hooks";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { writeInsightsQuery } from "@shared/insights/filters";
import type {
  InsightsApprovalPersonRow,
  InsightsDiscoverRow,
  InsightsDivergenceType,
  InsightsTrendingPollRow,
  PolarisationItem,
  PolarisationResponse,
  TopVoteMatchup,
  TopVotedResponse,
} from "@shared/insights/types";
import { cn } from "@/lib/utils";

/**
 * Insights Vote tab — curated community vote highlights with thumbnails,
 * split bars, and cross-links to full vote surfaces.
 */

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed: ${path}`);
  return res.json();
}

function formatVotes(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "vote" : "votes"}`;
}

function VoteRowThumb({
  imageUrl,
  participants,
}: {
  imageUrl?: string | null;
  participants?: { name: string; avatar: string | null }[];
}) {
  if (participants && participants.length >= 2) {
    return (
      <div className="shrink-0">
        <MarketThumbCollage
          variant="split"
          participants={participants}
          size="sm"
          splitAccent="vote"
          className="w-14"
        />
      </div>
    );
  }
  const src = imageUrl ?? participants?.[0]?.avatar;
  const name = participants?.[0]?.name ?? "?";
  if (src) {
    return (
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-border/40">
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }
  return <PersonAvatar name={name} avatar={src} size="sm" className="shrink-0" />;
}

function formatOptionCount(optionCount?: number | null): string | null {
  if (optionCount == null || optionCount <= 0) return null;
  return `${optionCount} ${optionCount === 1 ? "option" : "options"}`;
}

function MatchupSplitBar({
  optionAPct,
  optionBPct,
  neutralPct = 0,
}: {
  optionAPct: number;
  optionBPct: number;
  neutralPct?: number;
}) {
  const total = optionAPct + optionBPct + neutralPct || 1;
  const aW = Math.max(neutralPct > 0 ? 4 : 8, (optionAPct / total) * 100);
  const nW = neutralPct > 0 ? Math.max(4, (neutralPct / total) * 100) : 0;
  const bW = Math.max(neutralPct > 0 ? 4 : 8, (optionBPct / total) * 100);
  const scale = 100 / (aW + nW + bW);
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
      <div
        className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all"
        style={{ width: `${aW * scale}%` }}
      />
      {nW > 0 ? (
        <div
          className="h-full bg-slate-400/60 transition-all"
          style={{ width: `${nW * scale}%` }}
        />
      ) : null}
      <div
        className="h-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all"
        style={{ width: `${bW * scale}%` }}
      />
    </div>
  );
}

function matchupPcts(item: {
  optionAPct?: number | null;
  optionBPct?: number | null;
  neutralPct?: number | null;
  optionAVotes?: number | null;
  optionBVotes?: number | null;
  neutralVotes?: number | null;
  totalVotes: number;
}) {
  if (item.optionAPct != null && item.optionBPct != null) {
    const neutralPct =
      item.neutralPct ??
      (item.totalVotes > 0 && item.neutralVotes
        ? Math.round((item.neutralVotes / item.totalVotes) * 100)
        : 0);
    return {
      a: Math.round(item.optionAPct),
      b: Math.round(item.optionBPct),
      n: Math.round(neutralPct),
    };
  }
  const aVotes = item.optionAVotes ?? 0;
  const bVotes = item.optionBVotes ?? 0;
  const nVotes = item.neutralVotes ?? 0;
  const total = aVotes + bVotes + nVotes || item.totalVotes || 1;
  return {
    a: Math.round((aVotes / total) * 100),
    b: Math.round((bVotes / total) * 100),
    n: Math.round((nVotes / total) * 100),
  };
}

function MatchupInsightRow({
  title,
  slug,
  participants,
  totalVotes,
  optionAPct,
  optionBPct,
  neutralPct,
  optionAVotes,
  optionBVotes,
  neutralVotes,
  onClick,
}: {
  title: string;
  slug: string | null;
  participants?: PolarisationItem["participants"];
  totalVotes: number;
  optionAPct: number;
  optionBPct: number;
  neutralPct?: number;
  optionAVotes?: number;
  optionBVotes?: number;
  neutralVotes?: number;
  onClick?: () => void;
}) {
  const href = slug ? `/vote/matchups/${slug}` : null;
  const pcts = matchupPcts({
    optionAPct,
    optionBPct,
    neutralPct,
    optionAVotes,
    optionBVotes,
    neutralVotes,
    totalVotes,
  });

  const body = (
    <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-background/50 p-3 transition-colors hover:bg-muted/40">
      <VoteRowThumb participants={participants} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug line-clamp-2">{title}</p>
          <span className="shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground">
            {formatVotes(totalVotes)}
          </span>
        </div>
        <div className="mt-2">
          <MatchupSplitBar
            optionAPct={pcts.a}
            optionBPct={pcts.b}
            neutralPct={pcts.n}
          />
        </div>
        <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
          {pcts.a}% · {pcts.b}%
          {pcts.n > 0 ? ` · ${pcts.n}% neutral` : ""}
        </p>
      </div>
    </div>
  );

  if (!href) return body;
  return (
    <Link href={href} onClick={onClick}>
      {body}
    </Link>
  );
}

function OpinionPollInsightRow({
  title,
  slug,
  thumb,
  totalVotes,
  optionCount,
  leaderLabel,
  leaderPct,
  runnerUpLabel,
  runnerUpPct,
  onClick,
}: {
  title: string;
  slug: string | null;
  thumb?: string | null;
  totalVotes: number;
  optionCount?: number;
  leaderLabel?: string | null;
  leaderPct?: number | null;
  runnerUpLabel?: string | null;
  runnerUpPct?: number | null;
  onClick?: () => void;
}) {
  const href = slug ? `/vote/opinion-polls/${slug}` : null;
  const optionMeta = formatOptionCount(optionCount);

  const body = (
    <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-background/50 p-3 transition-colors hover:bg-muted/40">
      <VoteRowThumb imageUrl={thumb} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug line-clamp-2">{title}</p>
          <span className="shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground">
            {formatVotes(totalVotes)}
          </span>
        </div>
        {leaderLabel && leaderPct != null ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Top pick:{" "}
            <span className="font-semibold text-cyan-600 dark:text-cyan-400">
              {leaderLabel}{" "}
              <span className="tabular-nums">{leaderPct}%</span>
            </span>
          </p>
        ) : null}
        {runnerUpLabel ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            2nd:{" "}
            <span className="font-medium text-foreground">{runnerUpLabel}</span>
            {runnerUpPct != null ? (
              <span className="tabular-nums"> {runnerUpPct}%</span>
            ) : null}
          </p>
        ) : null}
        {optionMeta ? (
          <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">{optionMeta}</p>
        ) : null}
      </div>
    </div>
  );

  if (!href) return body;
  return (
    <Link href={href} onClick={onClick}>
      {body}
    </Link>
  );
}

function PolarisationTile({ variant }: { variant: "knife-edge" | "landslide" }) {
  const { data, isLoading } = useInsightsQuery<PolarisationResponse>(
    "/api/insights/discover/polarisation",
  );

  const list =
    variant === "knife-edge"
      ? (data?.faceOffs?.evenlySplit ?? [])
      : (data?.polls?.lopsided ?? []);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
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
        const isKnifeEdge = variant === "knife-edge";
        const pcts = isKnifeEdge ? matchupPcts(item) : null;

        return (
          <li key={`${item.kind}-${item.id}`}>
            {isKnifeEdge && pcts ? (
              <MatchupInsightRow
                title={item.title}
                slug={item.slug}
                participants={item.participants}
                totalVotes={item.totalVotes}
                optionAPct={pcts.a}
                optionBPct={pcts.b}
                neutralPct={pcts.n}
                optionAVotes={item.optionAVotes ?? undefined}
                optionBVotes={item.optionBVotes ?? undefined}
                neutralVotes={item.neutralVotes ?? undefined}
                onClick={() =>
                  logInsightsEvent("vote", "polarisation_row_click", {
                    variant,
                    kind: item.kind,
                    pollId: item.id,
                  })
                }
              />
            ) : (
              <OpinionPollInsightRow
                title={item.title}
                slug={item.slug}
                thumb={item.leaderImageUrl ?? item.imageUrl}
                totalVotes={item.totalVotes}
                optionCount={item.optionCount ?? undefined}
                leaderLabel={item.leaderLabel}
                leaderPct={item.leaderPct}
                runnerUpLabel={item.runnerUpLabel}
                runnerUpPct={item.runnerUpPct}
                onClick={() =>
                  logInsightsEvent("vote", "polarisation_row_click", {
                    variant,
                    kind: item.kind,
                    pollId: item.id,
                  })
                }
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MostVotedPollsTile() {
  const { data, isLoading } = useInsightsQuery<TopVotedResponse>("/api/insights/vote/top");
  const polls = data?.polls ?? [];

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (polls.length === 0) {
    return <InsightsEmptyState message="No active opinion polls yet." />;
  }

  return (
    <ul className="space-y-2">
      {polls.map((poll) => (
        <li key={poll.id}>
          <OpinionPollInsightRow
            title={poll.title}
            slug={poll.slug}
            thumb={poll.leaderImageUrl ?? poll.imageUrl}
            totalVotes={poll.totalVotes}
            optionCount={poll.optionCount}
            leaderLabel={poll.leaderLabel}
            leaderPct={poll.leaderPct}
            runnerUpLabel={poll.runnerUpLabel}
            runnerUpPct={poll.runnerUpPct}
            onClick={() =>
              logInsightsEvent("vote", "most_voted_poll_click", { pollId: poll.id })
            }
          />
        </li>
      ))}
    </ul>
  );
}

function MostVotedMatchupsTile() {
  const { data, isLoading } = useInsightsQuery<TopVotedResponse>("/api/insights/vote/top");
  const matchups = data?.matchups ?? [];

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (matchups.length === 0) {
    return <InsightsEmptyState message="No active matchups yet." />;
  }

  return (
    <ul className="space-y-2">
      {matchups.map((m: TopVoteMatchup) => {
        const pcts = matchupPcts(m);
        return (
          <li key={m.id}>
            <MatchupInsightRow
              title={m.title}
              slug={m.slug}
              participants={m.participants}
              totalVotes={m.totalVotes}
              optionAPct={pcts.a}
              optionBPct={pcts.b}
              neutralPct={pcts.n}
              optionAVotes={m.optionAVotes}
              optionBVotes={m.optionBVotes}
              neutralVotes={m.neutralVotes}
              onClick={() =>
                logInsightsEvent("vote", "most_voted_matchup_click", { matchupId: m.id })
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

const VALUE_VOTE_COPY: Record<
  "underrated" | "overrated",
  {
    title: string;
    description: string;
    empty: string;
    subtext: string;
    pctKey: "underratedPct" | "overratedPct";
    icon: typeof ArrowUp;
    iconClass: string;
    pctClass: string;
  }
> = {
  underrated: {
    title: "Underrated",
    description: "Profiles the crowd thinks deserve more credit.",
    empty: "Not enough underrated votes yet.",
    subtext: "of voters say underrated",
    pctKey: "underratedPct",
    icon: ArrowUp,
    iconClass: "text-[#00C853]",
    pctClass: "text-[#00C853]",
  },
  overrated: {
    title: "Overrated",
    description: "Profiles the crowd thinks are overhyped.",
    empty: "Not enough overrated votes yet.",
    subtext: "of voters say overrated",
    pctKey: "overratedPct",
    icon: ArrowDown,
    iconClass: "text-[#FF0000]",
    pctClass: "text-[#FF0000]",
  },
};

function ValueVoteTile({ divergenceType }: { divergenceType: "underrated" | "overrated" }) {
  const { data, isLoading } = useInsightsQuery<{ rows: InsightsDiscoverRow[]; total: number }>(
    `/api/insights/discover/divergence?type=${divergenceType}&limit=6`,
    { queryKey: ["/api/insights/discover/divergence", divergenceType, 6] },
  );

  const rows = data?.rows ?? [];
  const copy = VALUE_VOTE_COPY[divergenceType];
  const Icon = copy.icon;

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) {
    return <InsightsEmptyState message={copy.empty} />;
  }

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const pct = Math.round(Number(row[copy.pctKey] ?? 0));
        return (
          <li key={row.id}>
            <Link
              href={`/person/${row.id}`}
              onClick={() =>
                logInsightsEvent("vote", "divergence_row_click", {
                  type: divergenceType as InsightsDivergenceType,
                  personId: row.id,
                })
              }
              className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/50 p-2.5 transition-colors hover:bg-muted/40"
            >
              <PersonAvatar name={row.name} avatar={row.avatar} size="xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <p className="truncate text-[10px] leading-snug text-muted-foreground">
                  {copy.subtext}
                </p>
              </div>
              <span className="shrink-0 text-right">
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
                    copy.pctClass,
                  )}
                >
                  <Icon className={cn("h-3 w-3", copy.iconClass)} />
                  {pct}%
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ApprovalBoardLink() {
  return (
    <button
      type="button"
      className="inline-flex text-xs text-muted-foreground transition-colors hover:text-foreground"
      onClick={() => {
        logInsightsEvent("vote", "approval_board_link_click");
        writeInsightsQuery({ tab: "crowd", clearFilters: true });
      }}
    >
      View full approval board →
    </button>
  );
}

function ApprovalExtremesTile({ direction }: { direction: "asc" | "desc" }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/pulse/approval-current", direction, 6, 20],
    queryFn: () =>
      fetchJson<{ people: InsightsApprovalPersonRow[] }>(
        `/api/pulse/approval-current?limit=6&direction=${direction}&minVotes=20`,
      ),
    staleTime: 90_000,
  });

  const rows = data?.people ?? [];
  const isLowest = direction === "asc";

  if (isLoading) return <Skeleton className="h-40 w-full" />;
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
    <div className="space-y-3">
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
              className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/50 p-2.5 transition-colors hover:bg-muted/40"
            >
              <PersonAvatar name={p.name} avatar={p.avatar} size="xs" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
              <span className="shrink-0 text-right">
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
                    isLowest ? "text-red-500" : "text-green-600 dark:text-green-400",
                  )}
                >
                  <Star className="h-3 w-3 fill-current" />
                  {p.approvalAvgRating.toFixed(1)}
                </span>
                <span className="block text-[10px] tabular-nums text-muted-foreground">
                  {formatVotes(p.approvalVotesCount)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <ApprovalBoardLink />
    </div>
  );
}

function SentimentLegend() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" aria-hidden />
        Approve
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" aria-hidden />
        Neutral
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
        Oppose
      </span>
    </div>
  );
}

function sentimentCloseness(p: InsightsTrendingPollRow): number {
  return Math.abs(p.approvePercent - p.disapprovePercent);
}

function sentimentDominance(p: InsightsTrendingPollRow): number {
  return Math.max(p.approvePercent, p.neutralPercent, p.disapprovePercent);
}

function useSentimentPollRows() {
  return useQuery({
    queryKey: ["/api/trending-polls", "insights-vote"],
    queryFn: () => fetchJson<InsightsTrendingPollRow[]>("/api/trending-polls"),
    staleTime: 90_000,
  });
}

/** Vertical list — reads well in half-width desktop columns and on mobile. */
const SENTIMENT_TILE_LIST_CLASS = "space-y-2";

function SentimentSplitBar({ poll }: { poll: InsightsTrendingPollRow }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 sm:gap-2 text-[10px] tabular-nums min-w-0">
      <span className="shrink-0 font-semibold text-green-600 dark:text-green-400 w-[26px] text-right">
        {poll.approvePercent}%
      </span>
      <div className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/60">
        <div
          className="h-full bg-green-500/70"
          style={{ width: `${poll.approvePercent}%` }}
        />
        <div
          className="h-full bg-slate-400/40"
          style={{ width: `${poll.neutralPercent}%` }}
        />
        <div
          className="h-full bg-red-500/70"
          style={{ width: `${poll.disapprovePercent}%` }}
        />
      </div>
      <span className="shrink-0 font-semibold text-red-500 w-[26px]">
        {poll.disapprovePercent}%
      </span>
    </div>
  );
}

function SentimentSplitRow({
  poll,
  onClick,
}: {
  poll: InsightsTrendingPollRow;
  onClick?: () => void;
}) {
  const href = poll.slug ? `/polls/${poll.slug}` : null;

  const body = (
    <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-background/50 p-3 transition-colors hover:bg-muted/40">
      <PersonAvatar
        name={poll.personName ?? poll.headline}
        avatar={poll.personAvatar ?? poll.imageUrl}
        size="sm"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug line-clamp-2">{poll.headline}</p>
          <span className="shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground">
            {formatVotes(poll.totalVotes)}
          </span>
        </div>
        <SentimentSplitBar poll={poll} />
      </div>
    </div>
  );

  if (!href) return body;
  return (
    <Link href={href} onClick={onClick}>
      {body}
    </Link>
  );
}

function SentimentPulseTile() {
  const { data, isLoading } = useSentimentPollRows();

  const rows = (data ?? [])
    .filter((p) => p.totalVotes >= 5)
    .sort((a, b) => sentimentCloseness(a) - sentimentCloseness(b))
    .slice(0, 5);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) {
    return <InsightsEmptyState message="No sentiment topics with enough votes yet." />;
  }

  return (
    <ul className={SENTIMENT_TILE_LIST_CLASS}>
      {rows.map((p) => (
        <li key={p.id}>
          <SentimentSplitRow
            poll={p}
            onClick={() => logInsightsEvent("vote", "sentiment_row_click", { pollId: p.id })}
          />
        </li>
      ))}
    </ul>
  );
}

function SentimentLandslideTile() {
  const { data, isLoading } = useSentimentPollRows();

  const rows = (data ?? [])
    .filter((p) => p.totalVotes >= 5)
    .sort((a, b) => sentimentDominance(b) - sentimentDominance(a))
    .slice(0, 5);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) {
    return <InsightsEmptyState message="No landslide sentiment topics yet." />;
  }

  return (
    <ul className={SENTIMENT_TILE_LIST_CLASS}>
      {rows.map((p) => (
        <li key={p.id}>
          <SentimentSplitRow
            poll={p}
            onClick={() =>
              logInsightsEvent("vote", "sentiment_landslide_row_click", { pollId: p.id })
            }
          />
        </li>
      ))}
    </ul>
  );
}

export function VoteTab() {
  return (
    <div className="space-y-6 md:space-y-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <Swords className="h-4 w-4 text-cyan-500" /> Knife-edge matchups
            </span>
          }
          description="The tightest head-to-head votes. Pick a side and tip the balance."
        >
          <PolarisationTile variant="knife-edge" />
        </InsightsSection>

        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4 text-cyan-500" /> Most-voted matchups
            </span>
          }
          description="The head-to-head battles drawing the most votes."
        >
          <MostVotedMatchupsTile />
        </InsightsSection>

        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4 text-cyan-500" /> Landslide opinion polls
            </span>
          }
          description="Opinion polls where one choice is pulling clearly ahead."
        >
          <PolarisationTile variant="landslide" />
        </InsightsSection>

        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4 text-cyan-500" /> Most-voted opinion polls
            </span>
          }
          description="The opinion polls drawing the most votes."
        >
          <MostVotedPollsTile />
        </InsightsSection>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <Scale className="h-4 w-4 text-amber-500" /> Closest sentiment splits
            </span>
          }
          description="Sentiment polls with the closest approve-vs-oppose split."
          action={<SentimentLegend />}
        >
          <SentimentPulseTile />
        </InsightsSection>

        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4 text-amber-500" /> Landslide sentiment polls
            </span>
          }
          description="Sentiment polls where one stance is pulling clearly ahead."
          action={<SentimentLegend />}
        >
          <SentimentLandslideTile />
        </InsightsSection>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-green-600" /> Highest approval
            </span>
          }
          description="Highest VoxDex approval ratings (min 20 votes)."
        >
          <ApprovalExtremesTile direction="desc" />
        </InsightsSection>

        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <TrendingDown className="h-4 w-4 text-red-500" /> Lowest approval
            </span>
          }
          description="Lowest VoxDex approval ratings (min 20 votes)."
        >
          <ApprovalExtremesTile direction="asc" />
        </InsightsSection>

        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <ArrowUp className="h-4 w-4 text-[#00C853]" /> Underrated
            </span>
          }
          description={VALUE_VOTE_COPY.underrated.description}
        >
          <ValueVoteTile divergenceType="underrated" />
        </InsightsSection>

        <InsightsSection
          tab="vote"
          title={
            <span className="inline-flex items-center gap-1.5">
              <ArrowDown className="h-4 w-4 text-[#FF0000]" /> Overrated
            </span>
          }
          description={VALUE_VOTE_COPY.overrated.description}
        >
          <ValueVoteTile divergenceType="overrated" />
        </InsightsSection>
      </div>
    </div>
  );
}
