import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/PersonAvatar";
import { SentimentMiniBar } from "./SentimentMiniBar";
import { CategoryPill } from "@/components/CategoryPill";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { cn } from "@/lib/utils";

interface WebSentimentRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  positivePct: number;
  positive: number;
  negative: number;
  total: number;
}

interface WebSentimentResponse {
  data: {
    rows: WebSentimentRow[];
    total: number;
    asOf: string | null;
    minOpinionated: number;
  };
}

function sentimentBand(pct: number): string {
  if (pct >= 75) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 25) return "text-amber-600 dark:text-amber-400";
  return "text-red-500";
}

export function WebSentimentTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/insights/crowd/web-sentiment"],
    queryFn: async () => {
      const res = await fetch("/api/insights/crowd/web-sentiment", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<WebSentimentResponse>;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isError) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Failed to load the web sentiment leaderboard.
        </CardContent>
      </Card>
    );
  }

  const rows = data?.data.rows ?? [];

  return (
    <Card className="overflow-visible">
      <div className="relative isolate overflow-hidden rounded-t-xl">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] bg-[linear-gradient(90deg,transparent_0%,rgb(34,211,238)_50%,transparent_100%)]"
          aria-hidden
        />
        <CardHeader className="relative z-[2] flex flex-col gap-4 space-y-0 bg-card/95 pb-4 pt-5">
          <div className="flex-1">
            <CardTitle className="text-2xl font-serif flex items-center gap-2">
              <Globe className="h-5 w-5 text-[#22D3EE]" aria-hidden />
              Web Sentiment
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground/70 max-w-xl">
              How positive the open web is about each profile, based on{" "}
              <span className="font-medium text-foreground">DataForSEO</span> content
              analysis. Profiles with fewer than{" "}
              {data?.data.minOpinionated ?? 50} opinionated citations are hidden.
            </p>
          </div>
        </CardHeader>
      </div>

      <CardContent className="p-0">
        {isLoading && rows.length === 0 && (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No profiles have enough opinionated web citations yet.
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <ul className="divide-y divide-border/40">
            {rows.map((row, idx) => (
              <li key={row.id}>
                <Link
                  href={`/person/${row.id}`}
                  onClick={() =>
                    logInsightsEvent("crowd", "web_sentiment_row_click", {
                      personId: row.id,
                    })
                  }
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <span className="text-sm font-mono text-muted-foreground tabular-nums w-8 shrink-0">
                    {idx + 1}
                  </span>
                  <PersonAvatar name={row.name} avatar={row.avatar} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{row.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {row.category && (
                        <CategoryPill category={row.category} size="sm" />
                      )}
                      <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                        #{row.rank}
                      </span>
                    </div>
                  </div>
                  <div className="hidden sm:block w-32 shrink-0">
                    <SentimentMiniBar
                      positive={row.positive}
                      negative={row.negative}
                      showCounts={false}
                    />
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={cn(
                        "text-base font-semibold tabular-nums",
                        sentimentBand(row.positivePct),
                      )}
                    >
                      {row.positivePct}%
                    </p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {(row.positive + row.negative).toLocaleString()} mentions
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {data?.data.asOf && (
          <div className="border-t border-border/40 p-3 text-center">
            <p className="text-[10px] text-muted-foreground">
              Updated{" "}
              {new Date(data.data.asOf).toLocaleString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · refreshed weekly
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
