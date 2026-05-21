/**
 * Persona-band P&L admin tile.
 *
 * Rolls up agent prediction performance (Brier + win rate) AND realised
 * credit P&L from trading, grouped by `simulation_profile.personaBand`
 * (sharp / casual / noisy / liquidity / whale). Shows them side-by-side
 * because they measure different things and the divergence between them
 * is itself a signal:
 *
 *   - Brier rewards CALIBRATION on probability estimates (a good Brier
 *     means the agent's stated confidences track actual win rates).
 *   - Credit P&L rewards actually MAKING money — which depends on
 *     calibration AND position sizing AND timing against the LMSR curve.
 *
 * When Brier is good (<0.20) but Credit P&L is negative, the agent is
 * calibrated on probabilities but is either sizing or timing badly. We
 * surface that combination with an amber row flag so the operator
 * spots it without doing the math.
 *
 * Healthy expected state across a multi-week window:
 *   - sharp band: best (lowest) Brier, positive credit P&L
 *   - casual / noisy: middling Brier, near-zero credit P&L on average
 *   - liquidity: low activity, near-zero credit P&L
 *   - whale: high variance, sometimes positive sometimes negative
 *
 * If a non-sharp band sits well above sharps in credit P&L across a
 * 30d window, that's strong evidence of a pricing-engine bug (probably
 * around market open / cold-start, since shaprs trade the second half
 * of the week heavier).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Loader2, ScaleIcon } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ---------------------------------------------------------------------------
// API shape (mirrors `server/routes.ts:/api/admin/amm/persona-pnl`)
// ---------------------------------------------------------------------------
interface PersonaBandRow {
  band: string;
  agentCount: number;
  settledBets: number;
  wins: number;
  brierAvg: number | null;
  winRate: number | null;
  creditPnl: number;
  tradeCount: number;
  divergence: boolean;
}

interface PersonaPnlResponse {
  windowLabel: string;
  windowDays: number | null;
  bands: PersonaBandRow[];
  generatedAt: string;
}

const BAND_ORDER = ["sharp", "casual", "noisy", "liquidity", "whale", "unknown"];

function sortBands(bands: PersonaBandRow[]): PersonaBandRow[] {
  return [...bands].sort(
    (a, b) =>
      (BAND_ORDER.indexOf(a.band) === -1 ? 99 : BAND_ORDER.indexOf(a.band)) -
      (BAND_ORDER.indexOf(b.band) === -1 ? 99 : BAND_ORDER.indexOf(b.band)),
  );
}

function formatCredits(v: number): string {
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  const abs = Math.abs(v);
  return sign + abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(1)}%`;
}

function formatBrier(b: number | null): string {
  if (b == null || !Number.isFinite(b)) return "—";
  return b.toFixed(3);
}

function bandLabel(band: string): string {
  if (band === "unknown") return "Unknown";
  return band.charAt(0).toUpperCase() + band.slice(1);
}

/**
 * Tone the credit-P&L cell.
 *
 *   strongPositive: +Ꝟ5000 or more across the window — sharps
 *                   land here when calibrated correctly.
 *   positive:       any positive sum.
 *   neutral:        near zero (|pnl| < 100) — typical for liquidity.
 *   negative:       any negative sum — flag if the band ALSO has good
 *                   Brier (divergence).
 */
function pnlTone(v: number): "strong" | "positive" | "neutral" | "negative" {
  if (v >= 5000) return "strong";
  if (v > 0) return "positive";
  if (Math.abs(v) < 100) return "neutral";
  return "negative";
}

const TONE_CLASSES: Record<ReturnType<typeof pnlTone>, string> = {
  strong: "text-emerald-600 dark:text-emerald-400 font-semibold",
  positive: "text-emerald-600 dark:text-emerald-400",
  neutral: "text-muted-foreground",
  negative: "text-rose-600 dark:text-rose-400",
};

// Brier "good" threshold mirrors the divergence rule in the server
// endpoint. Below this, the agent's stated probabilities are reliable.
// Above 0.25 is essentially random for binary markets (always-50/50 =
// 0.25); we don't surface that as a divergence because it isn't one.
const BRIER_GOOD_THRESHOLD = 0.20;

export function PersonaPnlTile() {
  const [windowChoice, setWindowChoice] = useState<"7" | "30" | "0">("30");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<PersonaPnlResponse>({
    queryKey: ["/api/admin/amm/persona-pnl", windowChoice],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/amm/persona-pnl?days=${windowChoice}`,
      );
      return res.json();
    },
    // Auto-refresh while visible. 60s matches the Operations tab cadence
    // — persona-band rollups change at the resolution cadence (per
    // weekly resolution) so this is plenty fresh.
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const bands = data ? sortBands(data.bands) : [];
  const divergentBands = bands.filter((b) => b.divergence);

  return (
    <Card data-testid="persona-pnl-tile">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ScaleIcon className="h-5 w-5 text-violet-500" />
            <CardTitle>Persona-band P&L</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {(["7", "30", "0"] as const).map((w) => (
              <Button
                key={w}
                size="sm"
                variant={windowChoice === w ? "default" : "outline"}
                onClick={() => setWindowChoice(w)}
                data-testid={`button-persona-pnl-window-${w}`}
              >
                {w === "0" ? "Lifetime" : `${w}d`}
              </Button>
            ))}
          </div>
        </div>
        <CardDescription>
          Brier score (lower = better calibration) and realised credit P&L
          (AMM + jackpot trading, excludes house top-ups) grouped by
          simulation persona. When Brier is good (&lt;0.20) but credit P&L
          is negative, the agent is calibrated on probabilities but is
          sizing or timing badly against the LMSR curve — flagged amber.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data ? (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
            <p className="font-medium text-rose-600 dark:text-rose-400">
              Failed to load persona-band P&L
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {divergentBands.length > 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  Calibration / P&L divergence detected
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {divergentBands.map((b) => bandLabel(b.band)).join(", ")}{" "}
                  {divergentBands.length === 1 ? "has" : "have"} good Brier
                  scores (probability calls are reliable) but{" "}
                  {divergentBands.length === 1 ? "is" : "are"} losing Vox
                  on trades. Either position sizing or trade timing is fighting
                  the LMSR price function. Check `sizing.ts` and the
                  conviction-band logic for that persona band.
                </p>
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Band</TableHead>
                  <TableHead className="text-right">Agents</TableHead>
                  <TableHead className="text-right">Settled bets</TableHead>
                  <TableHead className="text-right">Brier</TableHead>
                  <TableHead className="text-right">Win rate</TableHead>
                  <TableHead className="text-right">Trade count</TableHead>
                  <TableHead className="text-right">
                    Credit P&L ({data.windowLabel})
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bands.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                      No persona-band data in this window.
                    </TableCell>
                  </TableRow>
                ) : (
                  bands.map((b) => {
                    const tone = pnlTone(b.creditPnl);
                    return (
                      <TableRow
                        key={b.band}
                        className={
                          b.divergence
                            ? "bg-amber-500/5 hover:bg-amber-500/10"
                            : undefined
                        }
                        data-testid={`row-persona-${b.band}`}
                      >
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            {bandLabel(b.band)}
                            {b.divergence ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                              >
                                divergence
                              </Badge>
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.agentCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.settledBets.toLocaleString()}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            b.brierAvg != null && b.brierAvg < BRIER_GOOD_THRESHOLD
                              ? "text-emerald-600 dark:text-emerald-400"
                              : ""
                          }`}
                        >
                          {formatBrier(b.brierAvg)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPct(b.winRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.tradeCount.toLocaleString()}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${TONE_CLASSES[tone]}`}>
                          {formatCredits(b.creditPnl)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              Last updated: {new Date(data.generatedAt).toLocaleTimeString()}
              {isFetching ? " · refreshing…" : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
