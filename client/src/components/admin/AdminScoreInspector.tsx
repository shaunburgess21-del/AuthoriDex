import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Search, Microscope, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PeopleSearchResult {
  id: string;
  name: string;
  category: string;
  avatar: string | null;
  rank: number | null;
  fameIndex: number | null;
}

interface SnapshotBreakdown {
  timestamp: string;
  runId: string;
  rawValues: {
    wikiPageviews: number | null;
    newsCount: number | null;
    searchVolume: number | null;
    wiki7dAvg: number | null;
  };
  scores: {
    massScore: number | null;
    velocityScore: number | null;
    velocityAdjusted: number | null;
    trendScore: number | null;
    fameIndex: number | null;
  };
  freshness: any;
  stabilization: any;
  momentum: string | null;
  confidence: number | null;
  diversityMultiplier: number | null;
  snapshotOrigin: string | null;
  diagnostics: any;
}

interface SourceStatBlock {
  p25: number;
  p50: number;
  p75: number;
  count?: number;
}

interface AuditResponse {
  person: {
    id: string;
    name: string;
    category?: string;
    wikiSlug: string | null;
    searchQueryOverride: string | null;
  };
  currentRanking: {
    fameIndex: number | null;
    fameIndexLive: number | null;
    rank: number | null;
    liveRank: number | null;
    change24h: number | null;
    change7d: number | null;
    trendScore: number | null;
  } | null;
  sourceStats: {
    wiki: SourceStatBlock;
    news: SourceStatBlock;
    search: SourceStatBlock;
  };
  sourceHealth: Record<string, { state: string; reason?: string; lastHealthyTimestamp?: string }>;
  recentSnapshots: SnapshotBreakdown[];
  last10Snapshots: SnapshotBreakdown[];
  requestedDays: number;
  auditTimestamp: string;
}

// Derive a rough percentile bucket (low/mid/high) for quick colour coding.
// Keeps parity with MomentumSignals thresholds.
function percentileTone(value: number | null | undefined, stats: SourceStatBlock | undefined): string {
  if (value == null || !stats) return "text-muted-foreground";
  if (value <= stats.p25) return "text-muted-foreground";
  if (value >= stats.p75) return "text-green-500";
  return "text-yellow-500";
}

function formatDelta(current: number | null, prev: number | null): string {
  if (current == null || prev == null) return "";
  const delta = current - prev;
  if (Math.abs(delta) < 0.5) return "=";
  return delta > 0 ? `+${Math.round(delta).toLocaleString()}` : Math.round(delta).toLocaleString();
}

function deltaTone(current: number | null, prev: number | null): string {
  if (current == null || prev == null) return "text-muted-foreground";
  const delta = current - prev;
  if (Math.abs(delta) < 0.5) return "text-muted-foreground";
  return delta > 0 ? "text-green-500" : "text-red-500";
}

export function AdminScoreInspector() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [days, setDays] = useState(2);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const searchQuery = useQuery<{ query: string; results: PeopleSearchResult[] }>({
    queryKey: ["/api/admin/people-search", debouncedQuery],
    queryFn: async () => {
      if (debouncedQuery.length < 2) return { query: debouncedQuery, results: [] };
      const res = await apiRequest(
        "GET",
        `/api/admin/people-search?q=${encodeURIComponent(debouncedQuery)}`
      );
      return res.json();
    },
    enabled: debouncedQuery.length >= 2,
  });

  const auditQuery = useQuery<AuditResponse>({
    queryKey: ["/api/admin/score-audit", selectedId, days],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/score-audit/${selectedId}?days=${days}`
      );
      return res.json();
    },
    enabled: !!selectedId,
  });

  const audit = auditQuery.data;
  // recentSnapshots is DESC by time; chronological order for charts is reverse.
  const snapshotsChrono = useMemo(() => {
    const arr = audit?.recentSnapshots ?? audit?.last10Snapshots ?? [];
    return [...arr].reverse();
  }, [audit]);

  const chartData = useMemo(
    () =>
      snapshotsChrono.map((s) => ({
        t: new Date(s.timestamp).getTime(),
        tLabel: new Date(s.timestamp).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
        }),
        wiki: s.rawValues.wikiPageviews ?? 0,
        news: s.rawValues.newsCount ?? 0,
        search: s.rawValues.searchVolume ?? 0,
        fame: s.scores.fameIndex ?? 0,
      })),
    [snapshotsChrono]
  );

  return (
    <Card data-testid="card-score-inspector">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Microscope className="h-5 w-5 text-cyan-500" />
          Score Inspector
        </CardTitle>
        <CardDescription>
          Search for a person and drill into their raw inputs, normalized percentiles, and per-tick fame index for the
          last {days} day{days === 1 ? "" : "s"}. Useful for answering "why is this person ranked here?"
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="h-4 w-4 text-muted-foreground absolute top-1/2 -translate-y-1/2 left-3" />
          <Input
            ref={inputRef}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name (min 2 chars)…"
            className="pl-9"
            data-testid="input-score-inspector-search"
          />
          {searchInput && (
            <button
              type="button"
              className="absolute top-1/2 -translate-y-1/2 right-2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchInput("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {debouncedQuery.length >= 2 && (searchQuery.data?.results?.length ?? 0) > 0 && !selectedId && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-[320px] overflow-y-auto">
              {searchQuery.data!.results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 border-b last:border-0"
                  onClick={() => {
                    setSelectedId(r.id);
                    setSearchInput(r.name);
                  }}
                  data-testid={`result-person-${r.id}`}
                >
                  <Avatar className="h-6 w-6">
                    {r.avatar && <AvatarImage src={r.avatar} alt={r.name} />}
                    <AvatarFallback className="text-[10px]">
                      {r.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {r.category}
                      {r.rank != null && <> · Rank #{r.rank}</>}
                      {r.fameIndex != null && <> · FI {r.fameIndex.toLocaleString()}</>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {debouncedQuery.length >= 2 && searchQuery.data && searchQuery.data.results.length === 0 && !selectedId && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg px-3 py-4 text-sm text-muted-foreground">
              No matches for "{debouncedQuery}"
            </div>
          )}
        </div>

        {selectedId && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedId(null);
                setSearchInput("");
              }}
              data-testid="button-clear-inspector-selection"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">History:</span>
              {[1, 2, 5, 7, 14].map((d) => (
                <Button
                  key={d}
                  variant={days === d ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setDays(d)}
                  data-testid={`button-inspector-days-${d}`}
                >
                  {d}d
                </Button>
              ))}
            </div>
            {auditQuery.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
        )}

        {auditQuery.isLoading && selectedId && (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading audit…
          </div>
        )}

        {auditQuery.isError && (
          <div className="text-sm text-red-500" data-testid="text-inspector-error">
            Failed to load: {(auditQuery.error as Error)?.message || "Unknown error"}
          </div>
        )}

        {audit && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-lg font-semibold">{audit.person.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {audit.person.category}
                    {audit.person.wikiSlug && <> · wiki: {audit.person.wikiSlug}</>}
                    {audit.person.searchQueryOverride && (
                      <> · search override: "{audit.person.searchQueryOverride}"</>
                    )}
                  </div>
                </div>
                {audit.currentRanking && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Rank</div>
                      <div className="font-mono font-semibold">
                        #{audit.currentRanking.rank ?? "—"}
                        {audit.currentRanking.liveRank != null &&
                          audit.currentRanking.liveRank !== audit.currentRanking.rank && (
                            <span className="text-muted-foreground ml-1">(live #{audit.currentRanking.liveRank})</span>
                          )}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Fame Index</div>
                      <div className="font-mono font-semibold">
                        {audit.currentRanking.fameIndex?.toLocaleString() ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">24h</div>
                      <div
                        className={cn(
                          "font-mono font-semibold",
                          (audit.currentRanking.change24h ?? 0) > 0
                            ? "text-green-500"
                            : (audit.currentRanking.change24h ?? 0) < 0
                              ? "text-red-500"
                              : "text-muted-foreground"
                        )}
                      >
                        {audit.currentRanking.change24h != null
                          ? `${audit.currentRanking.change24h > 0 ? "+" : ""}${audit.currentRanking.change24h.toFixed(1)}%`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">7d</div>
                      <div
                        className={cn(
                          "font-mono font-semibold",
                          (audit.currentRanking.change7d ?? 0) > 0
                            ? "text-green-500"
                            : (audit.currentRanking.change7d ?? 0) < 0
                              ? "text-red-500"
                              : "text-muted-foreground"
                        )}
                      >
                        {audit.currentRanking.change7d != null
                          ? `${audit.currentRanking.change7d > 0 ? "+" : ""}${audit.currentRanking.change7d.toFixed(1)}%`
                          : "—"}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3 text-[11px]">
                {(["wiki", "news", "search"] as const).map((key) => {
                  const s = audit.sourceStats[key];
                  return (
                    <div key={key} className="rounded border bg-background/50 p-2">
                      <div className="text-muted-foreground uppercase tracking-wide">{key} percentiles</div>
                      <div className="font-mono">
                        p25 {s.p25.toFixed(1)} · p50 {s.p50.toFixed(1)} · p75 {s.p75.toFixed(1)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {chartData.length >= 2 && (
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-2">Fame Index (last {days}d)</div>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <XAxis dataKey="tLabel" tick={{ fontSize: 10 }} minTickGap={30} />
                        <YAxis tick={{ fontSize: 10 }} width={40} />
                        <Tooltip
                          contentStyle={{ fontSize: 11 }}
                          labelFormatter={(v) => v as string}
                          formatter={(v: any) => [Number(v).toLocaleString(), "FI"]}
                        />
                        <Line type="monotone" dataKey="fame" stroke="#06b6d4" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-2">Raw signals (normalized per-axis)</div>
                  <div className="h-32 grid grid-cols-3 gap-2">
                    {(["wiki", "news", "search"] as const).map((key) => (
                      <div key={key} className="flex flex-col">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{key}</div>
                        <div className="flex-1">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                              <Tooltip
                                contentStyle={{ fontSize: 11 }}
                                labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.tLabel ?? ""}
                                formatter={(v: any) => [Number(v).toLocaleString(), key]}
                              />
                              <Line
                                type="monotone"
                                dataKey={key}
                                stroke={key === "wiki" ? "#8b5cf6" : key === "news" ? "#f59e0b" : "#10b981"}
                                strokeWidth={1.5}
                                dot={false}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_auto] items-center gap-2 px-3 py-2 bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span>Time</span>
                <span>Wiki pv (Δ)</span>
                <span>News (Δ)</span>
                <span>Search (Δ)</span>
                <span>Fame · Δ</span>
                <span className="text-right">Origin</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto divide-y">
                {snapshotsChrono
                  .slice()
                  .reverse()
                  .map((s, idx, arr) => {
                    const prev = arr[idx + 1]; // earlier in time (because we reversed back to DESC)
                    const wiki = s.rawValues.wikiPageviews;
                    const news = s.rawValues.newsCount;
                    const search = s.rawValues.searchVolume;
                    const fame = s.scores.fameIndex;
                    const stats = audit.sourceStats;
                    return (
                      <div
                        key={`${s.runId}-${idx}`}
                        className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_auto] items-center gap-2 px-3 py-2 text-xs hover:bg-muted/30"
                        data-testid={`row-snapshot-${idx}`}
                      >
                        <span className="text-muted-foreground font-mono">
                          {new Date(s.timestamp).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className={cn("font-mono", percentileTone(wiki, stats.wiki))}>
                          {wiki != null ? Math.round(wiki).toLocaleString() : "—"}
                          <span className={cn("ml-1 text-[10px]", deltaTone(wiki, prev?.rawValues?.wikiPageviews ?? null))}>
                            {formatDelta(wiki, prev?.rawValues?.wikiPageviews ?? null)}
                          </span>
                        </span>
                        <span className={cn("font-mono", percentileTone(news, stats.news))}>
                          {news != null ? news : "—"}
                          <span className={cn("ml-1 text-[10px]", deltaTone(news, prev?.rawValues?.newsCount ?? null))}>
                            {formatDelta(news, prev?.rawValues?.newsCount ?? null)}
                          </span>
                        </span>
                        <span className={cn("font-mono", percentileTone(search, stats.search))}>
                          {search != null ? search.toFixed(1) : "—"}
                          <span className={cn("ml-1 text-[10px]", deltaTone(search, prev?.rawValues?.searchVolume ?? null))}>
                            {formatDelta(search, prev?.rawValues?.searchVolume ?? null)}
                          </span>
                        </span>
                        <span className="font-mono font-medium">
                          {fame != null ? fame.toLocaleString() : "—"}
                          <span className={cn("ml-1 text-[10px]", deltaTone(fame, prev?.scores?.fameIndex ?? null))}>
                            {formatDelta(fame, prev?.scores?.fameIndex ?? null)}
                          </span>
                        </span>
                        <span className="text-right text-[10px] text-muted-foreground">
                          {s.snapshotOrigin || "ingest"}
                          {s.momentum && s.momentum !== "Stable" && (
                            <Badge variant="outline" className="ml-1 text-[9px] py-0 px-1">
                              {s.momentum}
                            </Badge>
                          )}
                        </span>
                      </div>
                    );
                  })}
                {snapshotsChrono.length === 0 && (
                  <div className="px-3 py-6 text-sm text-center text-muted-foreground">No snapshots recorded yet.</div>
                )}
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground">
              Cell colour reflects rolling-window percentile: grey ≤ p25, yellow &lt; p75, green ≥ p75. Δ is change from
              the previous snapshot in this list.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
