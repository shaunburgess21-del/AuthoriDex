import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { getAuthHeaders } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { PersonAvatar } from "@/components/PersonAvatar";
import { InsightsSection } from "./insights-ui";

async function fetchBreakdown() {
  const headers = await getAuthHeaders();
  const res = await fetch("/api/insights/me/breakdown", { headers, credentials: "include" });
  if (!res.ok) throw new Error("breakdown failed");
  const json = await res.json();
  return json.data;
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  const mod10 = n % 10;
  if (mod10 === 1) return "st";
  if (mod10 === 2) return "nd";
  if (mod10 === 3) return "rd";
  return "th";
}

function percentileDescriptor(percentile: number): string {
  const topPct = 100 - percentile;
  if (topPct <= 5) return `You're in the top ${Math.max(1, Math.round(topPct))}% of predictors`;
  if (topPct <= 25) return `You're in the top ${Math.round(topPct)}% of predictors`;
  return `You're ahead of ${percentile}% of predictors on the platform`;
}

export function YouTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/insights/me/breakdown"],
    queryFn: fetchBreakdown,
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-destructive text-center py-8">
        Could not load your stats. Place a few predictions and try again.
      </p>
    );
  }

  const calibrationChart = (data.calibration ?? [])
    .filter((b: { count: number }) => b.count > 0)
    .map((b: { label: string; actualWinRate: number; count: number }) => ({
      label: b.label,
      winRate: Math.round(b.actualWinRate * 100),
      count: b.count,
    }))
    .sort(
      (a: { label: string }, b: { label: string }) =>
        parseInt(a.label, 10) - parseInt(b.label, 10),
    );

  const voteHistogram = (data.voteBehaviour?.histogram ?? []).map(
    (h: { rating: number; count: number }) => ({
      label: String(h.rating),
      count: h.count,
    }),
  );

  const byMarketType = data.byMarketType ?? [];
  const byCategory = data.byCategory ?? [];

  const percentile = data.percentileVsPlatform?.percentile;
  const cohortSize = data.percentileVsPlatform?.cohortSize ?? 0;

  return (
    <div className="space-y-6 md:space-y-8">
      <InsightsSection
        title="Calibration"
        description="Your entry odds vs actual win rate on settled predictions (Brier-style buckets)."
        accent="voxdex"
      >
        {calibrationChart.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Need more settled predictions to chart calibration — keep predicting.
          </p>
        ) : (
          <div className="h-[280px] md:h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calibrationChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                <Tooltip
                  formatter={(value: number, _name: string, item: { payload?: { count: number } }) => [
                    `${value}% (${item.payload?.count ?? 0} bets)`,
                    "Win rate",
                  ]}
                />
                <Bar dataKey="winRate" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} name="Win %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </InsightsSection>

      <div className="grid md:grid-cols-2 gap-6">
        <InsightsSection title="ROI by market type" description="Net credits and win rate when resolved.">
          {byMarketType.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resolved bets yet.</p>
          ) : (
            <ul className="space-y-0 divide-y divide-border/40">
              {byMarketType.map(
                (row: {
                  marketType: string;
                  resolved: number;
                  winRate: number;
                  netCredits: number;
                }) => (
                  <li
                    key={row.marketType}
                    className="flex justify-between py-3 text-sm first:pt-0 last:pb-0"
                  >
                    <span className="capitalize font-medium">{row.marketType}</span>
                    <span className="text-muted-foreground tabular-nums text-right">
                      {row.resolved} bets · {(row.winRate * 100).toFixed(0)}% ·{" "}
                      <span className={row.netCredits >= 0 ? "text-green-600" : "text-red-500"}>
                        {row.netCredits >= 0 ? "+" : ""}
                        {row.netCredits} cr
                      </span>
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
        </InsightsSection>

        <InsightsSection title="Best categories" description="Where your win rate is strongest.">
          {byCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No category breakdown yet.</p>
          ) : (
            <ul className="space-y-0 divide-y divide-border/40">
              {[...byCategory]
                .sort((a: { winRate: number }, b: { winRate: number }) => b.winRate - a.winRate)
                .slice(0, 8)
                .map((row: { category: string; resolved: number; winRate: number }) => (
                  <li
                    key={row.category}
                    className="flex justify-between py-3 text-sm first:pt-0 last:pb-0"
                  >
                    <span>{row.category}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {(row.winRate * 100).toFixed(0)}% ({row.resolved})
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </InsightsSection>
      </div>

      <InsightsSection
        title="Vote behaviour"
        description="How you rate people on the 1–10 scale."
        accent="blue"
      >
        {(data.voteBehaviour?.totalVotes ?? 0) < 5 ? (
          <p className="text-sm text-muted-foreground">
            Cast at least 5 votes to see your rating distribution.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={voteHistogram} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(271 81% 56%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-2">
              {(data.voteBehaviour?.topCategories ?? []).map(
                (cat: { category: string; count: number; avgRating: number }) => (
                  <span
                    key={cat.category}
                    className="text-xs rounded-full border border-border/50 px-2.5 py-1 bg-muted/30"
                  >
                    {cat.category} · {cat.count} votes · avg {cat.avgRating.toFixed(1)}
                  </span>
                ),
              )}
            </div>
          </div>
        )}
      </InsightsSection>

      <InsightsSection
        title="Percentile vs platform"
        description="How your prediction win rate compares to other active predictors."
        accent="voxdex"
      >
        {!data.percentileVsPlatform?.qualifies ? (
          <p className="text-sm text-muted-foreground">
            Resolve 10+ predictions to join the platform percentile cohort (
            {cohortSize} predictors qualified so far).
          </p>
        ) : percentile == null ? (
          <p className="text-sm text-muted-foreground">Could not compute percentile yet.</p>
        ) : (
          <div className="text-center py-4">
            <p className="text-4xl md:text-5xl font-bold tabular-nums bg-gradient-to-r from-violet-500 to-blue-500 bg-clip-text text-transparent">
              {percentile}
              <span className="text-2xl">{ordinalSuffix(percentile)}</span>
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              {percentileDescriptor(percentile)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-3">
              Based on {cohortSize} profiles with 10+ resolved markets
            </p>
          </div>
        )}
      </InsightsSection>

      <InsightsSection
        title="Your early calls"
        description="Votes or bets when someone was outside the top 30 who later broke into the top 10."
        accent="blue"
      >
        {(data.earlyCalls ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keep predicting on lower-ranked people to build your early-calls record.
          </p>
        ) : (
          <ul className="space-y-3">
            {(data.earlyCalls ?? []).map(
              (call: {
                personId: string;
                personName: string;
                personAvatar?: string | null;
                message: string;
                currentRank: number;
              }) => (
                <li
                  key={call.personId}
                  className="rounded-lg border border-border/40 p-3 flex items-start gap-3"
                >
                  <Link href={`/person/${call.personId}`} className="shrink-0">
                    <PersonAvatar name={call.personName} avatar={call.personAvatar ?? null} size="sm" />
                  </Link>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{call.personName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{call.message}</p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    #{call.currentRank}
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </InsightsSection>
    </div>
  );
}
