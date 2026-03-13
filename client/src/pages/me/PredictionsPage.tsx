import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  XCircle,
  Target,
  Flame,
  Trophy,
  Coins,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLChart } from "@/components/predict/PLChart";
import { OutcomePathChart } from "@/components/predict/OutcomePathChart";
import { PersonAvatar } from "@/components/PersonAvatar";
import { inferPredictionDirection } from "./predictions-utils";

interface UserPrediction {
  betId: string;
  marketId: string;
  marketSlug: string;
  marketTitle: string;
  marketStatus: string;
  marketType: string;
  entryLabel: string;
  stakeAmount: number;
  result: "won" | "lost" | "refunded" | "pending";
  payout: number;
  baselineScore: number;
  currentScore: number;
  betCreatedAt: string;
  marketCadence: string;
  marketCategory: string;
  potentialPayout: number;
  personName: string;
  personAvatar: string;
  startAt: string;
  endAt: string;
}

interface PredictionStats {
  total: number;
  won: number;
  lost: number;
  refunded: number;
  pending: number;
  netCredits: number;
  winRate: number;
  bestCategory: string;
  currentStreak: number;
}

interface PredictionsResponse {
  predictions: UserPrediction[];
  stats: PredictionStats;
}

type StatusFilter = "all" | "pending" | "won" | "lost" | "refunded";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Active" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "refunded", label: "Refunded" },
];

function formatScore(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function normalizeResponse(data: unknown): { predictions: UserPrediction[]; stats: PredictionStats | null } {
  if (Array.isArray(data)) {
    return { predictions: data as UserPrediction[], stats: null };
  }
  const resp = data as PredictionsResponse;
  return { predictions: resp.predictions ?? [], stats: resp.stats ?? null };
}

export default function PredictionsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [expandedBet, setExpandedBet] = useState<string | null>(null);

  const { data: rawData, isLoading, error } = useQuery<PredictionsResponse | UserPrediction[]>({
    queryKey: ["/api/me/predictions"],
    enabled: !!user,
  });

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to view your predictions</h2>
          <Button onClick={() => setLocation("/login")} className="mt-4" data-testid="button-sign-in">
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  const { predictions, stats } = rawData ? normalizeResponse(rawData) : { predictions: [], stats: null };

  const categories = Array.from(new Set(predictions.map((p) => p.marketCategory).filter(Boolean)));

  const filtered = predictions.filter((p) => {
    if (statusFilter !== "all" && p.result !== statusFilter) return false;
    if (categoryFilter !== "all" && p.marketCategory !== categoryFilter) return false;
    return true;
  });

  const plChartData = predictions.map((p) => ({
    createdAt: p.betCreatedAt,
    result: p.result,
    stakeAmount: p.stakeAmount,
    payout: p.payout,
  }));

  const getStatusBadge = (status: UserPrediction["result"]) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30"><Clock className="h-3 w-3 mr-1" />Active</Badge>;
      case "won":
        return <Badge className="bg-green-500/20 text-green-300 border-green-500/30"><CheckCircle className="h-3 w-3 mr-1" />Won</Badge>;
      case "lost":
        return <Badge className="bg-red-500/20 text-red-300 border-red-500/30"><XCircle className="h-3 w-3 mr-1" />Lost</Badge>;
      case "refunded":
        return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30">Refunded</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case "up":
        return <TrendingUp className="h-4 w-4 text-green-400" />;
      case "down":
        return <TrendingDown className="h-4 w-4 text-red-400" />;
      default:
        return <Target className="h-4 w-4 text-violet-400" />;
    }
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                setLocation("/me");
              }
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold">My Predictions</h1>
            <p className="text-xs text-muted-foreground">
              Track your prediction performance
            </p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
        {/* ---------- Summary Bar ---------- */}
        {isLoading ? (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <Card className="p-3 text-center space-y-1">
              <Clock className="h-4 w-4 mx-auto text-blue-400" />
              <p className="text-xl font-bold text-blue-400">{stats.pending}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Open</p>
            </Card>
            <Card className="p-3 text-center space-y-1">
              <Trophy className="h-4 w-4 mx-auto text-green-400" />
              <p className="text-xl font-bold text-green-400">{stats.won}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Won</p>
            </Card>
            <Card className="p-3 text-center space-y-1">
              <XCircle className="h-4 w-4 mx-auto text-red-400" />
              <p className="text-xl font-bold text-red-400">{stats.lost}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Lost</p>
            </Card>
            <Card className="p-3 text-center space-y-1">
              <Coins className="h-4 w-4 mx-auto text-amber-400" />
              <p className={`text-xl font-bold ${stats.netCredits >= 0 ? "text-green-400" : "text-red-400"}`}>
                {stats.netCredits >= 0 ? "+" : ""}{stats.netCredits.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground leading-tight">Net Credits</p>
            </Card>
            <Card className="p-3 text-center space-y-1">
              <BarChart3 className="h-4 w-4 mx-auto text-violet-400" />
              <p className="text-xl font-bold text-violet-400">{stats.winRate}%</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Win Rate</p>
            </Card>
            <Card className="p-3 text-center space-y-1">
              <Flame className="h-4 w-4 mx-auto text-orange-400" />
              <p className="text-xl font-bold text-orange-400">{stats.currentStreak}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Streak</p>
            </Card>
          </div>
        ) : null}

        {/* ---------- P/L Chart ---------- */}
        {!isLoading && predictions.length > 0 && (
          <Card className="p-4">
            <PLChart predictions={plChartData} />
          </Card>
        )}

        {/* ---------- Filter Bar ---------- */}
        {!isLoading && predictions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {STATUS_TABS.map((tab) => (
                <Badge
                  key={tab.value}
                  variant={statusFilter === tab.value ? "default" : "outline"}
                  className={`cursor-pointer transition-colors ${
                    statusFilter === tab.value
                      ? ""
                      : "hover:bg-accent"
                  }`}
                  onClick={() => setStatusFilter(tab.value)}
                >
                  {tab.label}
                  {stats && tab.value !== "all" && (
                    <span className="ml-1 opacity-70">
                      {stats[tab.value as keyof Pick<PredictionStats, "pending" | "won" | "lost" | "refunded">]}
                    </span>
                  )}
                  {stats && tab.value === "all" && (
                    <span className="ml-1 opacity-70">{stats.total}</span>
                  )}
                </Badge>
              ))}
            </div>

            {categories.length > 1 && (
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[140px] h-8 text-xs ml-auto">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {/* ---------- Content ---------- */}
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <Card className="p-8 text-center">
            <TrendingUp className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-lg font-semibold mb-2">Couldn&apos;t load predictions</h2>
            <p className="text-muted-foreground mb-4">Please try again in a moment.</p>
            <Button onClick={() => window.location.reload()} data-testid="button-retry-predictions">
              Retry
            </Button>
          </Card>
        ) : filtered.length > 0 ? (
          <div className="space-y-3">
            {filtered.map((prediction) => {
              const direction = inferPredictionDirection(prediction.entryLabel);
              const isExpanded = expandedBet === prediction.betId;
              const delta = (prediction.currentScore || 0) - (prediction.baselineScore || 0);
              const pctDelta =
                prediction.baselineScore > 0
                  ? ((delta / prediction.baselineScore) * 100).toFixed(1)
                  : "0";
              const isResolved = prediction.result === "won" || prediction.result === "lost";
              const payoutDisplay = isResolved
                ? prediction.payout
                : prediction.potentialPayout || prediction.payout;

              return (
                <Card
                  key={prediction.betId}
                  className="overflow-hidden transition-colors hover:bg-accent/5 cursor-pointer"
                  data-testid={`prediction-item-${prediction.betId}`}
                  onClick={() => setExpandedBet(isExpanded ? null : prediction.betId)}
                >
                  <div className="p-4">
                    {/* Top row: avatar + title + status */}
                    <div className="flex items-start gap-3 mb-3">
                      {prediction.personName && (
                        <PersonAvatar
                          name={prediction.personName}
                          avatar={prediction.personAvatar}
                          size="sm"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-snug line-clamp-2">
                          {prediction.marketTitle || "Prediction"}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                          {getDirectionIcon(direction)}
                          <span>Picked: <span className="text-foreground font-medium">{prediction.entryLabel || "Unknown"}</span></span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {getStatusBadge(prediction.result)}
                        <button
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedBet(isExpanded ? null : prediction.betId);
                          }}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Score row */}
                    {prediction.baselineScore > 0 && (
                      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                        <span>Baseline: <span className="font-mono text-foreground">{formatScore(prediction.baselineScore)}</span></span>
                        <span>
                          {isResolved ? "Close" : "Current"}:{" "}
                          <span className="font-mono text-foreground">{formatScore(prediction.currentScore)}</span>
                        </span>
                        <span className={`font-mono font-medium ${delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {delta >= 0 ? "+" : ""}{formatScore(delta)} ({delta >= 0 ? "+" : ""}{pctDelta}%)
                        </span>
                      </div>
                    )}

                    {/* Bottom row: stake, payout, time, tags */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        Stake: <span className="text-foreground font-medium">{prediction.stakeAmount} credits</span>
                      </span>
                      {payoutDisplay > 0 && (
                        <span className={prediction.result === "lost" ? "text-red-400" : "text-green-400"}>
                          {isResolved ? "" : "Est. "}
                          {prediction.result === "lost" ? "-" : "+"}
                          {payoutDisplay} credits
                        </span>
                      )}
                      <span className="text-muted-foreground ml-auto">
                        {formatDate(prediction.betCreatedAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 mt-2">
                      {prediction.marketCategory && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {prediction.marketCategory}
                        </Badge>
                      )}
                      {prediction.marketCadence && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {prediction.marketCadence}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* ---------- Expanded Detail ---------- */}
                  {isExpanded && (
                    <div className="border-t border-border/50 bg-muted/5 p-4 space-y-4">
                      {prediction.marketId && prediction.marketType === "native" && (
                        <OutcomePathChart
                          marketId={prediction.marketId}
                          baselineScore={prediction.baselineScore}
                          currentScore={prediction.currentScore}
                          personName={prediction.personName || "Person"}
                          compact
                          userPick={direction === "up" ? "up" : direction === "down" ? "down" : null}
                        />
                      )}

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Delta vs Baseline</p>
                          <p className={`font-mono font-semibold ${delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {delta >= 0 ? "+" : ""}{delta.toLocaleString("en-US")} ({delta >= 0 ? "+" : ""}{pctDelta}%)
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Market Window</p>
                          <p className="text-foreground">
                            {prediction.startAt ? formatDate(prediction.startAt) : "—"} &mdash;{" "}
                            {prediction.endAt ? formatDate(prediction.endAt) : "—"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Market Status</p>
                          <p className="text-foreground capitalize">{prediction.marketStatus}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Market Type</p>
                          <p className="text-foreground capitalize">{prediction.marketType}</p>
                        </div>
                      </div>

                      {prediction.marketSlug && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocation(`/predict/${prediction.marketSlug}`);
                          }}
                        >
                          View Market
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        ) : predictions.length > 0 && filtered.length === 0 ? (
          <Card className="p-8 text-center">
            <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">No matching predictions</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Try adjusting your filters to see more results.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setStatusFilter("all");
                setCategoryFilter("all");
              }}
            >
              Clear Filters
            </Button>
          </Card>
        ) : (
          <Card className="p-10 text-center space-y-4">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 mx-auto">
              <Zap className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold">No predictions yet</h2>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Predict which celebrities will rise or fall in fame. Stake credits and earn rewards when you&apos;re right.
            </p>
            <Button size="lg" onClick={() => setLocation("/predict")} data-testid="button-start-predicting">
              <TrendingUp className="h-4 w-4 mr-2" />
              Start Predicting
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
