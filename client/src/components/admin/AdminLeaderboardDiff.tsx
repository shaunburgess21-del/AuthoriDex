import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowUp, ArrowDown, Minus, Sparkle, ChevronsDown, Loader2, RefreshCw, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";

interface DiffRow {
  personId: string;
  name: string;
  category: string | null;
  avatar: string | null;
  currentRank: number | null;
  currentFameIndex: number | null;
  change24h: number | null;
  previousRank: number | null;
  previousFameIndex: number | null;
  rankDelta: number | null;
  fameIndexDelta: number | null;
  status: "new" | "dropped" | "up" | "down" | "same";
}

interface DiffResponse {
  hoursAgo: number;
  limit: number;
  matchWindowHours: number;
  coverage: { totalPeople: number; matchedPeople: number };
  rows: DiffRow[];
  computedAt: string;
}

const HOURS_OPTIONS = [
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "48", label: "48 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
];

function statusBadge(row: DiffRow): { icon: JSX.Element; label: string; tone: string } {
  switch (row.status) {
    case "new":
      return {
        icon: <Sparkle className="h-3.5 w-3.5" />,
        label: "NEW",
        tone: "bg-cyan-500/15 text-cyan-500 border-cyan-500/40",
      };
    case "dropped":
      return {
        icon: <ChevronsDown className="h-3.5 w-3.5" />,
        label: "dropped",
        tone: "bg-red-500/15 text-red-500 border-red-500/40",
      };
    case "up":
      return {
        icon: <ArrowUp className="h-3.5 w-3.5" />,
        label: `+${row.rankDelta}`,
        tone: "bg-green-500/15 text-green-500 border-green-500/40",
      };
    case "down":
      return {
        icon: <ArrowDown className="h-3.5 w-3.5" />,
        label: `${row.rankDelta}`,
        tone: "bg-red-500/15 text-red-500 border-red-500/40",
      };
    default:
      return {
        icon: <Minus className="h-3.5 w-3.5" />,
        label: "same",
        tone: "bg-muted text-muted-foreground border-border",
      };
  }
}

export function AdminLeaderboardDiff() {
  const [hours, setHours] = useState("24");
  const [limit, setLimit] = useState("20");

  const query = useQuery<DiffResponse>({
    queryKey: ["/api/admin/leaderboard-diff", hours, limit],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/leaderboard-diff?hours=${hours}&limit=${limit}`
      );
      return res.json();
    },
    // Coarse-grained; default 5-min refetchInterval is fine.
  });

  const data = query.data;
  const rows = data?.rows ?? [];
  // Show current-top first (ascending by current rank), then dropped rows at bottom.
  const current = rows
    .filter((r) => r.currentRank != null)
    .sort((a, b) => (a.currentRank ?? 999) - (b.currentRank ?? 999));
  const dropped = rows.filter((r) => r.currentRank == null);

  const coverageText = data
    ? data.coverage.totalPeople === 0
      ? ""
      : `${data.coverage.matchedPeople}/${data.coverage.totalPeople} current top ${data.limit} had a snapshot near t-${data.hoursAgo}h`
    : "";

  return (
    <Card data-testid="card-leaderboard-diff">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompare className="h-5 w-5 text-cyan-500" />
          Leaderboard Diff
        </CardTitle>
        <CardDescription>
          Compare the top-N right now with the top-N from N hours ago. Shows who moved, who's new, who dropped out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Compare to</span>
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger className="w-[140px]" data-testid="select-diff-hours">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label} ago
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Top</span>
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger className="w-[100px]" data-testid="select-diff-limit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="30">30</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            data-testid="button-refresh-diff"
          >
            {query.isFetching ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
          {coverageText && (
            <span className="text-xs text-muted-foreground ml-auto" data-testid="text-diff-coverage">
              {coverageText}
            </span>
          )}
        </div>

        {query.isLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Computing diff…
          </div>
        )}

        {query.isError && (
          <div className="text-sm text-red-500" data-testid="text-diff-error">
            Failed to load: {(query.error as Error)?.message || "Unknown error"}
          </div>
        )}

        {data && !query.isLoading && (
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[auto_2fr_auto_auto_auto] items-center gap-3 px-3 py-2 bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Now</span>
              <span>Person</span>
              <span className="text-right">Fame Index</span>
              <span className="text-right">Then → Now</span>
              <span className="text-right">Move</span>
            </div>
            <div className="max-h-[560px] overflow-y-auto divide-y">
              {current.map((row) => {
                const badge = statusBadge(row);
                return (
                  <div
                    key={row.personId}
                    className="grid grid-cols-[auto_2fr_auto_auto_auto] items-center gap-3 px-3 py-2 text-sm hover:bg-muted/30"
                    data-testid={`row-diff-${row.personId}`}
                  >
                    <span className="font-mono text-xs w-8 text-right">#{row.currentRank}</span>
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-6 w-6">
                        {row.avatar && <AvatarImage src={row.avatar} alt={row.name} />}
                        <AvatarFallback className="text-[10px]">
                          {row.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{row.name}</div>
                        {row.category && (
                          <div className="truncate text-[10px] text-muted-foreground">{row.category}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs">
                      {row.currentFameIndex != null ? row.currentFameIndex.toLocaleString() : "—"}
                      {row.fameIndexDelta != null && (
                        <div
                          className={cn(
                            "text-[10px]",
                            row.fameIndexDelta > 0
                              ? "text-green-500"
                              : row.fameIndexDelta < 0
                                ? "text-red-500"
                                : "text-muted-foreground"
                          )}
                        >
                          {row.fameIndexDelta > 0 ? "+" : ""}
                          {row.fameIndexDelta.toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="text-right font-mono text-xs text-muted-foreground">
                      {row.previousRank != null ? `#${row.previousRank}` : "—"}
                      <span className="mx-1">→</span>
                      {row.currentRank != null ? `#${row.currentRank}` : "—"}
                    </div>
                    <div className="flex justify-end">
                      <Badge variant="outline" className={cn("gap-1 font-mono text-[10px]", badge.tone)}>
                        {badge.icon}
                        {badge.label}
                      </Badge>
                    </div>
                  </div>
                );
              })}

              {dropped.length > 0 && (
                <>
                  <div className="px-3 py-1.5 bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Dropped out of top {data.limit}
                  </div>
                  {dropped.map((row) => {
                    const badge = statusBadge(row);
                    return (
                      <div
                        key={row.personId}
                        className="grid grid-cols-[auto_2fr_auto_auto_auto] items-center gap-3 px-3 py-2 text-sm opacity-70 hover:opacity-100 hover:bg-muted/30"
                        data-testid={`row-diff-dropped-${row.personId}`}
                      >
                        <span className="font-mono text-xs w-8 text-right text-muted-foreground">—</span>
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="h-6 w-6">
                            {row.avatar && <AvatarImage src={row.avatar} alt={row.name} />}
                            <AvatarFallback className="text-[10px]">
                              {row.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{row.name}</div>
                            {row.category && (
                              <div className="truncate text-[10px] text-muted-foreground">{row.category}</div>
                            )}
                          </div>
                        </div>
                        <div className="text-right font-mono text-xs text-muted-foreground">—</div>
                        <div className="text-right font-mono text-xs text-muted-foreground">
                          {row.previousRank != null ? `#${row.previousRank}` : "—"}
                          <span className="mx-1">→</span>—
                        </div>
                        <div className="flex justify-end">
                          <Badge variant="outline" className={cn("gap-1 font-mono text-[10px]", badge.tone)}>
                            {badge.icon}
                            {badge.label}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {current.length === 0 && dropped.length === 0 && (
                <div className="px-3 py-6 text-sm text-center text-muted-foreground">
                  No data yet. Wait for the next ingest tick.
                </div>
              )}
            </div>
          </div>
        )}

        {data && data.coverage.totalPeople > 0 && data.coverage.matchedPeople < data.coverage.totalPeople * 0.5 && (
          <div className="text-xs text-yellow-500" data-testid="text-diff-low-coverage">
            ⚠ Only {data.coverage.matchedPeople}/{data.coverage.totalPeople} people had a snapshot within ±
            {data.matchWindowHours}h of t-{data.hoursAgo}h. Rows marked "NEW" may just be people we didn't have data
            for at that time (e.g. newly tracked).
          </div>
        )}
      </CardContent>
    </Card>
  );
}
