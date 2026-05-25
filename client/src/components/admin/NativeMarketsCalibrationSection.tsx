/**
 * Native markets calibration — Up/Down / H2H / Gainer odds vs trend signal.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, LineChart, Loader2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "sonner";

interface CalibrationRow {
  marketId: string;
  personName: string;
  category: string | null;
  marketType: string;
  pctVsOpen: number | null;
  ammUpPct: number | null;
  compositeImpliedPct: number | null;
  llmProbability: number | null;
  llmDirection: string | null;
  mispricingVsComposite: number | null;
  disagreementDelta: number | null;
  rationale: string | null;
  lastAssessedAt: string | null;
}

interface CalibrationResponse {
  ok: boolean;
  status: {
    enabled: boolean;
    model: string;
    budget: {
      spendUsd: number;
      capUsd: number;
      remainingUsd: number;
      exhausted: boolean;
    };
    cacheTtlHours: number;
    callsToday?: number;
    assessedMarkets?: number;
    cacheHitRatio?: number | null;
  };
  rows: CalibrationRow[];
  histogram: {
    buckets: Array<{ pctOpenMid: number; avgAmmUpPct: number; count: number }>;
  };
}

function pct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

/** Highlight AMM vs composite implied (launch-readiness), not LLM disagreement. */
function rowTone(mispricingVsComposite: number | null): string {
  if (mispricingVsComposite == null) return "";
  if (mispricingVsComposite > 0.35) return "bg-rose-500/10";
  if (mispricingVsComposite > 0.2) return "bg-amber-500/10";
  return "";
}

export function NativeMarketsCalibrationSection() {
  const [open, setOpen] = useState(true);
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery<CalibrationResponse>({
    queryKey: ["/api/admin/native-markets/calibration"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/native-markets/calibration");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const refreshMutation = useMutation({
    mutationFn: async (marketId: string) => {
      const res = await apiRequest("POST", "/api/admin/native-markets/refresh-assessment", {
        marketId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast.success("Assessment refreshed");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/native-markets/calibration"] });
    },
    onError: (e: Error) => toast.error("Refresh failed", { description: e.message }),
  });

  const budgetPct = useMemo(() => {
    if (!data?.status.budget.capUsd) return 0;
    return (data.status.budget.spendUsd / data.status.budget.capUsd) * 100;
  }, [data]);

  const maxHist = useMemo(() => {
    const buckets = data?.histogram.buckets ?? [];
    return Math.max(...buckets.map((b) => b.avgAmmUpPct), 0.01);
  }, [data]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card data-testid="native-markets-calibration">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <LineChart className="h-5 w-5 text-emerald-500" />
                <div>
                  <CardTitle>Native markets calibration</CardTitle>
                  <CardDescription>
                    Trend vs AMM vs LLM read (Up/Down, H2H, Gainer). Set{" "}
                    <code className="text-xs">NATIVE_MARKETS_LLM_ENABLED=true</code> on Railway to
                    enable assessments.
                  </CardDescription>
                </div>
              </div>
              <ChevronDown
                className={`h-5 w-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data?.status.enabled ? "default" : "secondary"}>
                LLM {data?.status.enabled ? "ON" : "OFF"}
              </Badge>
              {data?.status.model && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {data.status.model}
                </Badge>
              )}
              {data?.status.budget.exhausted && (
                <Badge variant="destructive">Budget exhausted</Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Refresh
              </Button>
            </div>

            {data && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs">LLM spend today</div>
                  <div className="font-semibold tabular-nums">
                    ${data.status.budget.spendUsd.toFixed(2)} / ${data.status.budget.capUsd.toFixed(2)}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${data.status.budget.exhausted ? "bg-rose-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, budgetPct)}%` }}
                    />
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs">LLM calls today</div>
                  <div className="font-semibold tabular-nums">
                    {data.status.callsToday ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs">Assessed / open</div>
                  <div className="font-semibold tabular-nums">
                    {data.status.assessedMarkets ?? 0} / {data.rows.length}
                    {data.status.cacheHitRatio != null && (
                      <span className="text-muted-foreground text-xs font-normal ml-1">
                        ({(data.status.cacheHitRatio * 100).toFixed(0)}% cached)
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground text-xs">AMM vs signal (Δ&gt;20%)</div>
                  <div className="font-semibold tabular-nums">
                    {data.rows.filter((r) => (r.mispricingVsComposite ?? 0) > 0.2).length}
                  </div>
                </div>
              </div>
            )}

            {data?.histogram.buckets.length ? (
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground mb-2">
                  Cohort histogram (avg AMM Up% by trend bucket)
                </div>
                <svg viewBox="0 0 320 80" className="w-full max-w-lg h-20 text-emerald-500">
                  <line x1="0" y1="75" x2="320" y2="75" stroke="currentColor" opacity="0.2" />
                  {data.histogram.buckets.map((b, i) => {
                    const x = 20 + i * 28;
                    const h = (b.avgAmmUpPct / maxHist) * 60;
                    return (
                      <rect
                        key={b.pctOpenMid}
                        x={x}
                        y={75 - h}
                        width="18"
                        height={h}
                        fill="currentColor"
                        opacity="0.7"
                      />
                    );
                  })}
                  <line
                    x1="0"
                    y1="15"
                    x2="320"
                    y2="65"
                    stroke="currentColor"
                    opacity="0.25"
                    strokeDasharray="4"
                  />
                </svg>
              </div>
            ) : null}

            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading calibration…
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">vs open</TableHead>
                      <TableHead className="text-right">AMM Up</TableHead>
                      <TableHead className="text-right">Composite</TableHead>
                      <TableHead className="text-right">LLM</TableHead>
                      <TableHead>Δ</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.rows.slice(0, 40).map((row) => (
                      <TableRow key={row.marketId} className={rowTone(row.mispricingVsComposite)}>
                        <TableCell className="font-medium max-w-[140px] truncate">
                          {row.personName}
                          {row.rationale && (
                            <div
                              className="text-[10px] text-muted-foreground truncate max-w-[200px]"
                              title={row.rationale}
                            >
                              {row.rationale}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {row.marketType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {pct(row.pctVsOpen)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {pct(row.ammUpPct)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {pct(row.compositeImpliedPct)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {row.llmProbability != null ? (
                            <>
                              {pct(row.llmProbability)}{" "}
                              <span className="text-muted-foreground">{row.llmDirection}</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {row.disagreementDelta != null
                            ? pct(row.disagreementDelta)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {data?.status.enabled && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={refreshMutation.isPending}
                              onClick={() => refreshMutation.mutate(row.marketId)}
                            >
                              LLM
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
