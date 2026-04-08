import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sharePage } from "@/lib/share";
import { UserMenu } from "@/components/UserMenu";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { formatTimeAgo, formatDate } from "@/lib/formatDate";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { CardComments } from "@/components/comments/CardComments";
import {
  ArrowLeft,
  Star,
  Clock,
  Users,
  Loader2,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Target,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Trophy,
  BarChart3,
  Lock,
  Info,
  Gavel,
  Share2,
  X,
} from "lucide-react";

interface MarketEntry {
  id: string;
  label: string;
  totalStake: number;
  noStake?: number;
  seedCount: number;
  displayOrder: number;
  resolutionStatus: string;
  betCount: number;
}

interface MarketComment {
  id: string;
  userId: string;
  username: string;
  body: string;
  parentId: string | null;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

interface ResolutionSource {
  label: string;
  url: string;
}

interface ResolutionSummary {
  outcomeLabel?: string | null;
  openScore?: number | null;
  closeScore?: number | null;
  actualScore?: number | null;
  winningPrediction?: number | null;
  margin?: number | null;
  closeSnapshotAt?: string | null;
  notesText?: string | null;
}

interface MarketData {
  id: string;
  marketType: string;
  openMarketType: "binary" | "multi" | "updown";
  status: "OPEN" | "CLOSED_PENDING" | "RESOLVED" | "VOID";
  title: string;
  slug: string;
  teaser?: string | null;
  summary?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
  coverImageUrl?: string | null;
  sourceUrl?: string | null;
  featured?: boolean;
  timezone?: string | null;
  resolutionCriteria?: string[] | null;
  resolutionSources?: ResolutionSource[] | null;
  resolveMethod?: string | null;
  seedParticipants?: number;
  seedVolume?: string | null;
  underlying?: string | null;
  metric?: string | null;
  strike?: string | null;
  unit?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  closeAt?: string | null;
  resolvedAt?: string | null;
  baselineScore?: string | number | null;
  voidReason?: string | null;
  resolutionNotes?: string | null;
  resolutionSummary?: ResolutionSummary | null;
  createdAt: string;
  entries: MarketEntry[];
  comments?: MarketComment[];
  totalParticipants?: number;
  linkedPersonName?: string | null;
  linkedPersonAvatar?: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-green-500/25 dark:bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/40 dark:border-green-500/30" },
  CLOSED_PENDING: { label: "Closed", className: "bg-amber-500/25 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40 dark:border-amber-500/30" },
  RESOLVED: { label: "Resolved", className: "bg-blue-500/25 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40 dark:border-blue-500/30" },
  VOID: { label: "Void", className: "bg-red-500/25 dark:bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40 dark:border-red-500/30" },
};

function useCountdown(endDate: string | null) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!endDate) return;
    const update = () => {
      const now = new Date().getTime();
      const end = new Date(endDate).getTime();
      const diff = end - now;
      if (diff <= 0) {
        setTimeLeft("Ended");
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h remaining`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m remaining`);
      } else {
        setTimeLeft(`${minutes}m remaining`);
      }
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [endDate]);

  return timeLeft;
}

function getEntryPercentages(entries: MarketEntry[]) {
  const totalWeight = entries.reduce(
    (sum, e) => sum + (e.totalStake || 0) + (e.noStake || 0) + (e.seedCount || 0),
    0,
  );
  return entries.map((e) => {
    const yesStake = e.totalStake || 0;
    const noStake = e.noStake || 0;
    const weight = yesStake + noStake + (e.seedCount || 0);
    const livePool = yesStake + noStake;
    const yesPercentage = livePool > 0 ? Math.round((yesStake / livePool) * 100) : 50;
    return {
      ...e,
      percentage: totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : Math.round(100 / entries.length),
      displayStake: weight,
      yesPercentage,
      noPercentage: livePool > 0 ? 100 - yesPercentage : 50,
    };
  });
}

function calculateProjectedPayout(
  entries: MarketEntry[],
  entryId: string,
  stakeAmount: number,
  direction: "yes" | "no",
) {
  const currentEntry = entries.find((entry) => entry.id === entryId);
  if (!currentEntry) return null;

  const otherEntries = entries.filter((entry) => entry.id !== entryId);
  const totalPoolBefore = entries.reduce(
    (sum, entry) => sum + (entry.totalStake || 0) + (entry.noStake || 0),
    0,
  );
  const totalNoPoolBefore = entries.reduce((sum, entry) => sum + (entry.noStake || 0), 0);

  let winnerPoolBefore = 0;
  if (direction === "no") {
    const likelyWinningEntry = otherEntries.reduce<MarketEntry | null>((best, entry) => {
      if (!best) return entry;
      return (entry.totalStake || 0) > (best.totalStake || 0) ? entry : best;
    }, null);
    winnerPoolBefore =
      (likelyWinningEntry?.totalStake || 0) +
      (totalNoPoolBefore - (likelyWinningEntry?.noStake || 0));
  } else {
    winnerPoolBefore =
      (currentEntry.totalStake || 0) +
      otherEntries.reduce((sum, entry) => sum + (entry.noStake || 0), 0);
  }

  const winnerPoolAfter = winnerPoolBefore + stakeAmount;
  const totalPoolAfter = totalPoolBefore + stakeAmount;
  return Math.round((stakeAmount / Math.max(winnerPoolAfter, 1)) * totalPoolAfter);
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

function formatScoreValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "TBD";
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(num)) return Math.round(num).toLocaleString("en-US");
  return String(value);
}

function getEntryResolutionTone(status: string | null | undefined) {
  switch (status) {
    case "winner":
      return {
        cardClass: "border-amber-400/70 bg-amber-500/15 dark:bg-amber-500/10 shadow-[0_0_18px_rgba(245,158,11,0.16)]",
        rowClass: "bg-amber-500/15 dark:bg-amber-500/10 ring-1 ring-amber-400/30",
        barClass: "from-amber-400 via-amber-500 to-yellow-500 shadow-[0_0_12px_rgba(245,158,11,0.35)]",
        labelClass: "bg-amber-500/20 dark:bg-amber-500/15 text-amber-500 dark:text-amber-300 border border-amber-500/50 dark:border-amber-400/40",
        textClass: "text-amber-500 dark:text-amber-300",
        label: "Winner",
      };
    case "loser":
      return {
        cardClass: "border-slate-600/40 bg-slate-800/40",
        rowClass: "bg-slate-800/40 opacity-80",
        barClass: "from-slate-600 to-slate-500",
        labelClass: "bg-slate-500/15 dark:bg-slate-500/10 text-slate-500 dark:text-slate-300 border border-slate-500/40 dark:border-slate-500/30",
        textClass: "text-slate-500 dark:text-slate-300",
        label: "Lost",
      };
    case "void":
      return {
        cardClass: "border-slate-500/60 dark:border-slate-500/50 bg-slate-500/8 dark:bg-slate-500/5",
        rowClass: "bg-slate-500/8 dark:bg-slate-500/5 ring-1 ring-slate-500/20",
        barClass: "from-slate-500 to-slate-400",
        labelClass: "bg-slate-500/15 dark:bg-slate-500/10 text-slate-500 dark:text-slate-300 border border-slate-500/40 dark:border-slate-500/30",
        textClass: "text-slate-500 dark:text-slate-300",
        label: "Void",
      };
    default:
      return null;
  }
}

function BinaryOutcomes({
  entries,
  selectedEntry,
  onSelect,
  disabled,
}: {
  entries: (MarketEntry & { percentage: number; displayStake: number })[];
  selectedEntry: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const sorted = [...entries].sort((a, b) => a.displayOrder - b.displayOrder);
  const yesEntry = sorted[0];
  const noEntry = sorted[1];
  const yesTone = getEntryResolutionTone(yesEntry?.resolutionStatus);
  const noTone = getEntryResolutionTone(noEntry?.resolutionStatus);

  return (
    <div className="grid grid-cols-2 gap-3">
      {yesEntry && (
        <button
          onClick={() => !disabled && onSelect(yesEntry.id)}
          disabled={disabled}
          className={`relative p-4 rounded-xl border-2 transition-all text-left ${
            selectedEntry === yesEntry.id
              ? "border-green-500 bg-green-500/20 dark:bg-green-500/15 shadow-lg shadow-green-500/30 dark:shadow-green-500/20"
              : "border-green-500/30 dark:border-green-500/20 bg-green-500/8 dark:bg-green-500/5 hover:border-green-500/40"
          } ${yesTone?.cardClass ?? ""} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          data-testid={`button-outcome-${yesEntry.id}`}
        >
          {yesTone && (
            <div className="absolute right-3 top-3">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${yesTone.labelClass}`}>
                {yesTone.label}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-5 w-5 text-green-700 dark:text-green-500" />
            <span className="font-semibold text-green-600 dark:text-green-400">{yesEntry.label}</span>
          </div>
          <div className="text-3xl font-bold text-green-600 dark:text-green-400 font-mono">{yesEntry.percentage}%</div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{formatNumber(yesEntry.displayStake)} staked</span>
            <span>{yesEntry.betCount} bets</span>
          </div>
        </button>
      )}
      {noEntry && (
        <button
          onClick={() => !disabled && onSelect(noEntry.id)}
          disabled={disabled}
          className={`relative p-4 rounded-xl border-2 transition-all text-left ${
            selectedEntry === noEntry.id
              ? "border-red-500 bg-red-500/20 dark:bg-red-500/15 shadow-lg shadow-red-500/30 dark:shadow-red-500/20"
              : "border-red-500/30 dark:border-red-500/20 bg-red-500/8 dark:bg-red-500/5 hover:border-red-500/40"
          } ${noTone?.cardClass ?? ""} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          data-testid={`button-outcome-${noEntry.id}`}
        >
          {noTone && (
            <div className="absolute right-3 top-3">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${noTone.labelClass}`}>
                {noTone.label}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="h-5 w-5 text-red-700 dark:text-red-500" />
            <span className="font-semibold text-red-600 dark:text-red-400">{noEntry.label}</span>
          </div>
          <div className="text-3xl font-bold text-red-600 dark:text-red-400 font-mono">{noEntry.percentage}%</div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{formatNumber(noEntry.displayStake)} staked</span>
            <span>{noEntry.betCount} bets</span>
          </div>
        </button>
      )}
    </div>
  );
}

function MultiOutcomes({
  entries,
  selectedEntry,
  onSelect,
  disabled,
}: {
  entries: (MarketEntry & { percentage: number; displayStake: number })[];
  selectedEntry: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const sorted = [...entries].sort((a, b) => b.percentage - a.percentage);
  const maxPercentage = Math.max(...sorted.map((e) => e.percentage), 0);

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((entry) => {
        const isLeading = entry.percentage === maxPercentage && entry.percentage > 0;
        const isUserPick = selectedEntry === entry.id;
        const tone = getEntryResolutionTone(entry.resolutionStatus);
        return (
          <button
            type="button"
            key={entry.id}
            disabled={disabled}
            onClick={() => !disabled && onSelect(entry.id)}
            className={`flex items-center gap-3 w-full text-left rounded-lg py-0.5 -mx-1 px-1 transition-colors ${
              isUserPick ? "bg-violet-500/8 dark:bg-violet-500/5 ring-1 ring-violet-500/20" : ""
            } ${tone?.rowClass ?? ""} ${disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/20"}`}
            data-testid={`button-outcome-${entry.id}`}
          >
            {(entry as any).imageUrl ? (
              <Avatar className="h-8 w-8 shrink-0 rounded-md">
                <AvatarImage src={(entry as any).imageUrl} alt={entry.label} className="object-cover" />
                <AvatarFallback className="text-[9px] rounded-md">{entry.label[0]}</AvatarFallback>
              </Avatar>
            ) : (
              <div className="h-8 w-8 shrink-0 rounded-md bg-muted/40 flex items-center justify-center">
                <span className="text-xs font-semibold text-muted-foreground">{entry.label[0]}</span>
              </div>
            )}
            <span
              className={`w-[30%] sm:w-[25%] text-sm truncate shrink-0 ${
                isUserPick ? "font-semibold text-foreground" : isLeading ? "font-medium text-violet-600 dark:text-violet-400" : "text-muted-foreground"
              }`}
            >
              {entry.label}
            </span>
            {/* Track: home-style dark blue glass (pulse-card-blue adjacent) */}
            <div className="flex-1 h-6 rounded-md overflow-hidden border border-blue-500/25 bg-gradient-to-b from-slate-900/90 to-slate-950/95 backdrop-blur-sm shadow-[inset_0_1px_2px_rgba(59,130,246,0.1)]">
              <div
                className={`h-full rounded-sm transition-all duration-700 ease-out ${
                  tone
                    ? `bg-gradient-to-r ${tone.barClass}`
                    : isLeading
                    ? "bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 shadow-[0_0_12px_rgba(59,130,246,0.35)]"
                    : "bg-gradient-to-r from-blue-600/95 to-blue-500/75"
                }`}
                style={{ width: `${Math.max(entry.percentage, 1)}%` }}
              />
            </div>
            <span
              className={`text-sm font-mono font-bold shrink-0 w-[48px] text-right ${
                tone?.textClass ?? (isLeading ? "text-violet-500 dark:text-violet-300" : "text-blue-500 dark:text-blue-300")
              }`}
            >
              {entry.percentage}%
            </span>
            {tone && (
              <span className={`hidden sm:inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${tone.labelClass}`}>
                {tone.label}
              </span>
            )}
            <span className="text-xs text-muted-foreground shrink-0 w-[56px] text-right hidden sm:block">
              {formatNumber(entry.displayStake)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function UpDownOutcomes({
  entries,
  selectedEntry,
  onSelect,
  disabled,
  underlying,
  metric,
  strike,
  unit,
}: {
  entries: (MarketEntry & { percentage: number; displayStake: number })[];
  selectedEntry: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
  underlying: string;
  metric: string;
  strike: string;
  unit: string;
}) {
  const sorted = [...entries].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/10 border-border/40">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{underlying} {metric}</p>
          <p className="text-3xl font-bold font-mono text-violet-600 dark:text-violet-400">
            {unit}{Number(strike).toLocaleString('en-US')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Strike Price</p>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        {sorted.map((entry) => {
          const isAbove = entry.label.toLowerCase().includes("above") || entry.label.toLowerCase().includes("yes") || entry.displayOrder === 0;
          const tone = getEntryResolutionTone(entry.resolutionStatus);
          return (
            <button
              key={entry.id}
              onClick={() => !disabled && onSelect(entry.id)}
              disabled={disabled}
              className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                selectedEntry === entry.id
                  ? isAbove
                    ? "border-green-500 bg-green-500/20 dark:bg-green-500/15 shadow-lg shadow-green-500/30 dark:shadow-green-500/20"
                    : "border-red-500 bg-red-500/20 dark:bg-red-500/15 shadow-lg shadow-red-500/30 dark:shadow-red-500/20"
                  : isAbove
                    ? "border-green-500/30 dark:border-green-500/20 bg-green-500/8 dark:bg-green-500/5 hover:border-green-500/40"
                    : "border-red-500/30 dark:border-red-500/20 bg-red-500/8 dark:bg-red-500/5 hover:border-red-500/40"
              } ${tone?.cardClass ?? ""} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
              data-testid={`button-outcome-${entry.id}`}
            >
              {tone && (
                <div className="absolute right-3 top-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.labelClass}`}>
                    {tone.label}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 mb-2">
                {isAbove ? (
                  <TrendingUp className="h-5 w-5 text-green-700 dark:text-green-500" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-700 dark:text-red-500" />
                )}
                <span className={`font-semibold ${isAbove ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {entry.label}
                </span>
              </div>
              <div className={`text-3xl font-bold font-mono ${isAbove ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {entry.percentage}%
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>{formatNumber(entry.displayStake)} staked</span>
                <span>{entry.betCount} bets</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MarketDetailPage() {
  const params = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { user, isLoggedIn, refreshProfile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const pickParam = urlParams?.get("pick") || null;
  const directionParam = urlParams?.get("direction") || null;

  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [selectedDirection, setSelectedDirection] = useState<"yes" | "no">("yes");
  const [stakeAmount, setStakeAmount] = useState("");
  const [jackpotScoreInput, setJackpotScoreInput] = useState("");
  const [jackpotSuggestions, setJackpotSuggestions] = useState<number[]>([]);
  const [pickApplied, setPickApplied] = useState(false);
  const [headerImgError, setHeaderImgError] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const { data: market, isLoading, error } = useQuery<MarketData>({
    queryKey: ["/api/open-markets", params.slug],
    queryFn: async () => {
      const res = await fetch(`/api/open-markets/${params.slug}`);
      if (!res.ok) throw new Error("Market not found");
      return res.json();
    },
    enabled: !!params.slug,
  });

  const isCommunityMarket = market?.marketType === "community";
  const isJackpotMarket = market?.marketType === "jackpot";
  const effectiveOpenMarketType: "binary" | "multi" | "updown" = market?.openMarketType
    ? market.openMarketType
    : market?.marketType === "updown"
      ? "updown"
      : "multi";

  const betMutation = useMutation({
    mutationFn: async ({ entryId, stakeAmount: amount, direction }: { entryId: string; stakeAmount: number; direction: "yes" | "no" }) => {
      if (!market) {
        throw new Error("Market not loaded");
      }

      if (market.marketType === "community") {
        const res = await apiRequest("POST", `/api/open-markets/${params.slug}/bet`, { entryId, stakeAmount: amount, direction });
        return res.json();
      }

      if (market.marketType === "jackpot") {
        throw new Error("Use the jackpot entry form on this page.");
      }

      const res = await apiRequest("POST", `/api/native-markets/${market.id}/bet`, {
        entryId,
        stakeAmount: amount,
      });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Prediction placed!", description: "Your prediction has been recorded." });
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets", params.slug] }),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/updown"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/h2h"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/gainer"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
      ]);
      setSelectedEntry(null);
      setSelectedDirection("yes");
      setStakeAmount("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to place prediction", description: err.message, variant: "destructive" });
    },
  });

  const jackpotPredictedScore = useMemo(() => {
    const parsed = Number(jackpotScoreInput);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
  }, [jackpotScoreInput]);

  const jackpotMutation = useMutation({
    mutationFn: async (predictedScore: number) => {
      if (!market) throw new Error("Market not loaded");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      };
      const res = await fetch(`/api/native-markets/${market.id}/jackpot-bet`, {
        method: "POST",
        headers,
        body: JSON.stringify({ predictedScore }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(data.message || data.error || "Failed to place jackpot entry");
        err.code = data.error;
        err.suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
        throw err;
      }
      return data as { predictedScore: number };
    },
    onSuccess: async (data) => {
      toast({
        title: "Jackpot entry placed!",
        description: `Your prediction ${data.predictedScore.toLocaleString("en-US")} has been recorded.`,
      });
      setJackpotScoreInput("");
      setJackpotSuggestions([]);
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets", params.slug] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/predict/recent-activity"] }),
      ]);
    },
    onError: (error: any) => {
      if (error?.code === "NUMBER_TAKEN") {
        setJackpotSuggestions(error?.suggestions || []);
      } else {
        setJackpotSuggestions([]);
      }
      toast({
        title: "Failed to place jackpot entry",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });


  useEffect(() => {
    if (pickParam && market?.entries && !pickApplied) {
      const pickLower = pickParam.toLowerCase();
      const matchedById = market.entries.find((e) => e.id === pickParam);
      const matchedByLabel = market.entries.find((e) =>
        e.label.toLowerCase() === pickLower ||
        e.label.toLowerCase().includes(pickLower)
      );
      const matched = matchedById || matchedByLabel;
      if (matched) {
        setSelectedEntry(matched.id);
      }
      if (directionParam === "yes" || directionParam === "no") {
        setSelectedDirection(directionParam);
      }
      setPickApplied(true);
    }
  }, [pickParam, directionParam, market?.entries, pickApplied]);

  const timeLeft = useCountdown(market?.closeAt || market?.endAt || null);

  const entriesWithPercentages = useMemo(() => {
    if (!market?.entries) return [];
    return getEntryPercentages(market.entries);
  }, [market?.entries]);

  const totalPool = useMemo(() => {
    if (!market) return 0;
    const entryWeights = (market.entries || []).reduce((sum, e) => sum + (e.totalStake || 0) + (e.seedCount || 0), 0);
    return entryWeights;
  }, [market]);

  const totalParticipants = useMemo(() => {
    if (!market) return 0;
    const entrySeedTotal = (market.entries || []).reduce((sum: number, e: any) => sum + (e.seedCount || 0), 0);
    return (market.totalParticipants || 0) + entrySeedTotal;
  }, [market]);

  const potentialPayout = useMemo(() => {
    if (!selectedEntry || !stakeAmount || !market) return null;
    const amount = Number(stakeAmount);
    if (isNaN(amount) || amount <= 0) return null;
    if (market.marketType === "community") {
      return calculateProjectedPayout(market.entries || [], selectedEntry, amount, selectedDirection);
    }
    const entry = entriesWithPercentages.find((e) => e.id === selectedEntry);
    if (!entry || entry.percentage === 0) return null;
    const pctFraction = selectedDirection === "no"
      ? (100 - entry.percentage) / 100
      : entry.percentage / 100;
    const payout = (amount / Math.max(pctFraction, 0.01)) * 0.95;
    return Math.round(payout);
  }, [selectedEntry, stakeAmount, selectedDirection, entriesWithPercentages, market]);

  const handlePlaceBet = () => {
    if (!isLoggedIn) {
      setLocation("/login");
      return;
    }
    if (!selectedEntry || !stakeAmount) return;
    const amount = Number(stakeAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid amount", description: "Enter a valid stake amount.", variant: "destructive" });
      return;
    }
    betMutation.mutate({ entryId: selectedEntry, stakeAmount: amount, direction: selectedDirection });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loading-spinner" />
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => window.history.back()} aria-label="Go back" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <Link href="/">
                <button className="flex items-center gap-2 hover:opacity-80 transition-opacity" data-testid="button-logo-home">
                  <VoxDexLogo size={32} />
                  <span className="font-serif font-bold text-xl hidden sm:block">VoxDex</span>
                </button>
              </Link>
            </div>
            <UserMenu />
          </div>
        </header>
        <div className="container mx-auto px-4 py-20 text-center" data-testid="market-not-found">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-serif font-bold mb-2">Market Not Found</h1>
          <p className="text-muted-foreground mb-6">This market doesn't exist or has been removed.</p>
          <Button onClick={() => setLocation("/predict")} data-testid="button-back-to-markets">
            Back to Markets
          </Button>
        </div>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[market.status] || STATUS_CONFIG.OPEN;
  const isOpen = market.status === "OPEN";
  const isInactive = (market as any).visibility === "inactive";
  const isClosedMarket = market.status !== "OPEN";
  const resultOpenScore = market.resolutionSummary?.openScore ?? market.baselineScore ?? null;
  const resultCloseScore = market.resolutionSummary?.closeScore ?? null;
  const resultActualScore = market.resolutionSummary?.actualScore ?? null;
  const resultWinningPrediction = market.resolutionSummary?.winningPrediction ?? null;
  const resultResolvedAt = market.resolutionSummary?.closeSnapshotAt || market.resolvedAt || null;

  let resultTitle = "Market Closed";
  let resultDescription = "Betting has ended for this market.";
  if (market.status === "CLOSED_PENDING") {
    resultTitle = "Awaiting Resolution";
    resultDescription = "Betting is closed. We are waiting for the final outcome to be confirmed.";
  } else if (market.status === "RESOLVED") {
    resultTitle = "Official Result";
    resultDescription = market.resolutionSummary?.outcomeLabel
      ? `${market.resolutionSummary.outcomeLabel} was the final outcome.`
      : isJackpotMarket
        ? "This jackpot market has been resolved."
        : "This market has been officially resolved.";
  } else if (market.status === "VOID") {
    resultTitle = "Market Voided";
    resultDescription = market.voidReason || "This market was cancelled and any affected bets were voided or refunded.";
  }

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => window.history.back()} aria-label="Go back" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Link href="/">
              <button
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                data-testid="button-logo-home"
              >
                <VoxDexLogo size={32} />
                <span className="font-serif font-bold text-xl hidden sm:block">VoxDex</span>
              </button>
            </Link>
          </div>
          <UserMenu />
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-3xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Badge variant="outline" className={statusConfig.className} data-testid="badge-status">
              {statusConfig.label}
            </Badge>
            {market.category && <CategoryPill category={market.category} data-testid="badge-category" />}
            {market.featured && (
              <Badge variant="outline" className="bg-amber-500/15 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40 dark:border-amber-500/30" data-testid="badge-featured">
                <Star className="h-3 w-3 mr-1" />
                Featured
              </Badge>
            )}
          </div>

          <div className="flex items-start gap-4 mb-4">
            {!headerImgError && (market.coverImageUrl || market.linkedPersonAvatar) && (
              <div
                className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-800 cursor-pointer"
                onClick={() =>
                  setExpandedImage((market.coverImageUrl || market.linkedPersonAvatar)!)
                }
              >
                <img
                  src={(market.coverImageUrl || market.linkedPersonAvatar)!}
                  alt={market.title}
                  className="w-full h-full object-cover"
                  onError={() => setHeaderImgError(true)}
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-serif font-bold mb-2" data-testid="text-market-title">
                {market.title}
              </h1>

              {market.teaser && (
                <p className="text-muted-foreground text-sm sm:text-base mb-3" data-testid="text-market-teaser">
                  {market.teaser}
                </p>
              )}
            </div>
          </div>

          {(market.linkedPersonName || market.endAt) && (
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              {market.linkedPersonName && (
                <span className="inline-flex items-center gap-1 text-xs text-violet-600/90 dark:text-violet-400/90 bg-violet-500/15 dark:bg-violet-500/10 rounded-full px-2.5 py-1">
                  <span className="opacity-60">Linked to</span> {market.linkedPersonName}
                </span>
              )}
              {market.endAt && (() => {
                const daysLeft = Math.ceil((new Date(market.closeAt || market.endAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                if (daysLeft <= 0) return null;
                return (
                  <span className="text-xs text-muted-foreground">
                    Resolves by {new Date(market.endAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    {daysLeft <= 7 && <Badge variant="outline" className="text-[10px] border-amber-500/40 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 ml-2 px-1.5 py-0">Closing soon</Badge>}
                  </span>
                );
              })()}
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
            {timeLeft && (
              <div className="flex items-center gap-1.5" data-testid="text-time-remaining">
                <Clock className="h-3.5 w-3.5" />
                <span>{timeLeft}</span>
              </div>
            )}
            {market.sourceUrl && (
              <a
                href={market.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 transition-colors"
                data-testid="link-source"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Source</span>
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => sharePage(`${market.title} on VoxDex`)}
              className="ml-auto"
              data-testid="button-share"
            >
              <Share2 className="h-4 w-4 mr-1" />
              Share
            </Button>
          </div>

          {market.tags && market.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-3">
              {market.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs" data-testid={`badge-tag-${tag}`}>
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {isOpen && !isInactive && (
          <Card className="p-5 mb-6 border-border/40 bg-muted/5" data-testid="section-place-prediction">
            <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-violet-700 dark:text-violet-500" />
              Place Your Prediction
            </h2>
            {!isLoggedIn ? (
              <div className="text-center py-4">
                <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">Sign in to place predictions</p>
                <Button onClick={() => setLocation("/login")} data-testid="button-login-to-predict">
                  Sign In
                </Button>
              </div>
            ) : isJackpotMarket ? (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Predict exact closing Trend Score</label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Enter exact score (e.g. 352000)"
                    value={jackpotScoreInput}
                    onChange={(e) => setJackpotScoreInput(e.target.value)}
                    className="bg-background/50"
                    data-testid="input-jackpot-predicted-score"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Jackpot entries are unique per score and cost 100 credits.
                  </p>
                </div>

                {jackpotSuggestions.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 dark:border-amber-500/20 bg-amber-500/8 dark:bg-amber-500/5 p-3">
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">That number is taken. Try one of these:</p>
                    <div className="flex flex-wrap gap-2">
                      {jackpotSuggestions.map((suggestion) => (
                        <Button
                          key={suggestion}
                          size="sm"
                          variant="outline"
                          className="border-amber-500/40 dark:border-amber-500/30 text-amber-600 dark:text-amber-400"
                          onClick={() => setJackpotScoreInput(String(suggestion))}
                          data-testid={`button-jackpot-suggestion-${suggestion}`}
                        >
                          {suggestion.toLocaleString("en-US")}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <Button
                  className="w-full bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-black font-semibold"
                  disabled={!jackpotPredictedScore || jackpotMutation.isPending}
                  onClick={() => jackpotPredictedScore && jackpotMutation.mutate(jackpotPredictedScore)}
                  data-testid="button-submit-jackpot-entry"
                >
                  {jackpotMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  {jackpotMutation.isPending
                    ? "Submitting..."
                    : !jackpotPredictedScore
                      ? "Enter an exact score"
                      : `Submit ${jackpotPredictedScore.toLocaleString("en-US")}`}
                </Button>
              </div>
            ) : effectiveOpenMarketType === "multi" ? (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Your Pick</label>
                  <div className="space-y-1.5">
                    {entriesWithPercentages.sort((a, b) => a.displayOrder - b.displayOrder).map((entry) => {
                      const isEntrySelected = selectedEntry === entry.id;
                      const isYesActive = isEntrySelected && selectedDirection === "yes";
                      const isNoActive = isEntrySelected && selectedDirection === "no";
                      return (
                        <div
                          key={entry.id}
                          className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-all ${
                            isEntrySelected ? "border-border bg-muted/30" : "border-transparent hover:bg-muted/15"
                          }`}
                          data-testid={`pick-row-${entry.id}`}
                        >
                          {(entry as any).imageUrl ? (
                            <Avatar className="h-8 w-8 shrink-0 rounded-md">
                              <AvatarImage src={(entry as any).imageUrl} alt={entry.label} className="object-cover" />
                              <AvatarFallback className="text-[10px] rounded-md">{entry.label[0]}</AvatarFallback>
                            </Avatar>
                          ) : (
                            <div className="h-8 w-8 shrink-0 rounded-md bg-muted/40 flex items-center justify-center">
                              <span className="text-xs font-semibold text-muted-foreground">{entry.label[0]}</span>
                            </div>
                          )}
                          <span className="text-sm font-medium truncate flex-1 min-w-0">{entry.label}</span>
                          <span className="text-sm font-mono font-semibold text-muted-foreground w-10 text-right shrink-0">{entry.percentage}%</span>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              className={`px-3 py-1.5 text-xs font-semibold rounded transition-all ${
                                isYesActive
                                  ? "bg-[#00C853]/20 border border-[#00C853] text-[#00C853] shadow-[0_0_8px_rgba(0,200,83,0.25)]"
                                  : "bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
                              }`}
                              onClick={() => { setSelectedEntry(entry.id); setSelectedDirection("yes"); }}
                              data-testid={`button-yes-${entry.id}`}
                            >
                              Yes
                            </button>
                            <button
                              className={`px-3 py-1.5 text-xs font-semibold rounded transition-all ${
                                isNoActive
                                  ? "bg-[#FF0000]/20 border border-[#FF0000] text-[#FF0000] shadow-[0_0_8px_rgba(255,0,0,0.25)]"
                                  : "bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
                              }`}
                              onClick={() => { setSelectedEntry(entry.id); setSelectedDirection("no"); }}
                              data-testid={`button-no-${entry.id}`}
                            >
                              No
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Stake Amount</label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Enter stake amount..."
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    className="bg-background/50"
                    data-testid="input-stake-amount"
                  />
                </div>

                {potentialPayout !== null && (
                  <div className="p-3 rounded-lg bg-green-500/8 dark:bg-green-500/5 border border-green-500/30 dark:border-green-500/20" data-testid="text-potential-payout">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Est. payout if correct</span>
                      <span className="font-bold font-mono text-green-600 dark:text-green-400">{formatNumber(potentialPayout)} credits</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Estimate -- updates as more people predict.</p>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground/50 text-center">Final payout may differ as the pool changes.</p>

                <Button
                  className="w-full bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white"
                  disabled={!selectedEntry || !stakeAmount || Number(stakeAmount) <= 0 || betMutation.isPending}
                  onClick={handlePlaceBet}
                  data-testid="button-submit-prediction"
                >
                  {betMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  {betMutation.isPending
                    ? "Placing..."
                    : !selectedEntry
                      ? "Select an outcome"
                      : !stakeAmount || Number(stakeAmount) <= 0
                        ? "Enter stake amount"
                        : `Place ${selectedDirection === "no" ? "No" : "Yes"} on ${entriesWithPercentages.find(e => e.id === selectedEntry)?.label || "..."}`}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Your Pick</label>
                  <div className="grid grid-cols-2 gap-2">
                    {entriesWithPercentages.sort((a, b) => a.displayOrder - b.displayOrder).map((entry) => {
                      const isSelected = selectedEntry === entry.id;
                      const isYesLike = entry.label.toLowerCase() === "yes" || entry.label.toLowerCase() === "above" || entry.displayOrder === 0;
                      const colorClass = isSelected
                        ? isYesLike
                          ? "bg-green-600 text-white border-green-600"
                          : "bg-red-600 text-white border-red-600"
                        : isYesLike
                          ? "border-green-500/40 dark:border-green-500/30 text-green-700 dark:text-green-500"
                          : "border-red-500/40 dark:border-red-500/30 text-red-700 dark:text-red-500";
                      return (
                        <Button
                          key={entry.id}
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          className={`${colorClass} min-w-0 whitespace-normal text-left h-auto py-2`}
                          onClick={() => setSelectedEntry(entry.id)}
                          data-testid={`button-pick-${entry.label.toLowerCase()}`}
                        >
                          {entry.label} ({entry.percentage}%)
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Stake Amount</label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Enter stake amount..."
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    className="bg-background/50"
                    data-testid="input-stake-amount"
                  />
                </div>

                {potentialPayout !== null && (
                  <div className="p-3 rounded-lg bg-green-500/8 dark:bg-green-500/5 border border-green-500/30 dark:border-green-500/20" data-testid="text-potential-payout">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Est. payout if correct</span>
                      <span className="font-bold font-mono text-green-600 dark:text-green-400">{formatNumber(potentialPayout)} credits</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Estimate -- updates as more people predict.</p>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground/50 text-center">Final payout may differ as the pool changes.</p>

                <Button
                  className="w-full bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white"
                  disabled={!selectedEntry || !stakeAmount || Number(stakeAmount) <= 0 || betMutation.isPending}
                  onClick={handlePlaceBet}
                  data-testid="button-submit-prediction"
                >
                  {betMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  {betMutation.isPending
                    ? "Placing..."
                    : !selectedEntry
                      ? "Select an outcome"
                      : !stakeAmount || Number(stakeAmount) <= 0
                        ? "Enter stake amount"
                        : "Place Prediction"}
                </Button>
              </div>
            )}
          </Card>
        )}

        {isClosedMarket && (
          <Card className="p-5 mb-6 border-violet-500/30 dark:border-violet-500/20 bg-violet-500/8 dark:bg-violet-500/5" data-testid="section-result-summary">
            <div className="flex items-start gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-violet-500/15 dark:bg-violet-500/10 flex items-center justify-center shrink-0">
                {market.status === "VOID" ? (
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                ) : market.status === "CLOSED_PENDING" ? (
                  <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Trophy className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-serif font-bold">{resultTitle}</h2>
                <p className="text-sm text-muted-foreground">{resultDescription}</p>
              </div>
            </div>

            {(market.resolutionSummary?.outcomeLabel || market.resolutionSummary?.notesText || market.voidReason) && (
              <div className="rounded-lg border border-border/50 bg-background/40 px-4 py-3 mb-4">
                {market.resolutionSummary?.outcomeLabel && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Outcome:</span>{" "}
                    <span className="font-semibold text-foreground">{market.resolutionSummary.outcomeLabel}</span>
                  </p>
                )}
                {!market.resolutionSummary?.outcomeLabel && (market.resolutionSummary?.notesText || market.voidReason) && (
                  <p className="text-sm text-muted-foreground">
                    {market.voidReason || market.resolutionSummary?.notesText}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(resultOpenScore !== null && resultOpenScore !== undefined) && (
                <Card className="p-3 text-center bg-background/40">
                  <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400 mx-auto mb-1" />
                  <p className="text-sm font-semibold font-mono">{formatScoreValue(resultOpenScore)}</p>
                  <p className="text-xs text-muted-foreground">Open Score</p>
                </Card>
              )}
              {(resultCloseScore !== null && resultCloseScore !== undefined) && (
                <Card className="p-3 text-center bg-background/40">
                  <Target className="h-4 w-4 text-violet-600 dark:text-violet-400 mx-auto mb-1" />
                  <p className="text-sm font-semibold font-mono">{formatScoreValue(resultCloseScore)}</p>
                  <p className="text-xs text-muted-foreground">Close Score</p>
                </Card>
              )}
              {(resultActualScore !== null && resultActualScore !== undefined) && (
                <Card className="p-3 text-center bg-background/40">
                  <Target className="h-4 w-4 text-amber-600 dark:text-amber-400 mx-auto mb-1" />
                  <p className="text-sm font-semibold font-mono">{formatScoreValue(resultActualScore)}</p>
                  <p className="text-xs text-muted-foreground">Actual Score</p>
                </Card>
              )}
              {(resultWinningPrediction !== null && resultWinningPrediction !== undefined) && (
                <Card className="p-3 text-center bg-background/40">
                  <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400 mx-auto mb-1" />
                  <p className="text-sm font-semibold font-mono">{formatScoreValue(resultWinningPrediction)}</p>
                  <p className="text-xs text-muted-foreground">Winning Prediction</p>
                </Card>
              )}
              {resultResolvedAt && (
                <Card className="p-3 text-center bg-background/40">
                  <Clock className="h-4 w-4 text-violet-600 dark:text-violet-400 mx-auto mb-1" />
                  <p className="text-sm font-semibold">{formatDate(resultResolvedAt)}</p>
                  <p className="text-xs text-muted-foreground">Resolved At</p>
                </Card>
              )}
              {market.resolveMethod && (
                <Card className="p-3 text-center bg-background/40">
                  <Gavel className="h-4 w-4 text-violet-600 dark:text-violet-400 mx-auto mb-1" />
                  <p className="text-sm font-semibold capitalize">{market.resolveMethod.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground">Method</p>
                </Card>
              )}
            </div>
          </Card>
        )}

        {!isJackpotMarket && (
        <Card className="p-5 mb-6" data-testid="section-outcomes">
          <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-violet-700 dark:text-violet-500" />
            Outcomes
          </h2>
          {effectiveOpenMarketType === "binary" && (
            <BinaryOutcomes
              entries={entriesWithPercentages}
              selectedEntry={selectedEntry}
              onSelect={setSelectedEntry}
              disabled={!isOpen}
            />
          )}
          {effectiveOpenMarketType === "multi" && (
            <MultiOutcomes
              entries={entriesWithPercentages}
              selectedEntry={selectedEntry}
              onSelect={setSelectedEntry}
              disabled={!isOpen}
            />
          )}
          {effectiveOpenMarketType === "updown" && (
            <UpDownOutcomes
              entries={entriesWithPercentages}
              selectedEntry={selectedEntry}
              onSelect={setSelectedEntry}
              disabled={!isOpen}
              underlying={market.underlying || ""}
              metric={market.metric || ""}
              strike={market.strike || "0"}
              unit={market.unit || ""}
            />
          )}
        </Card>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" data-testid="section-stats">
          <Card className="p-3 text-center">
            <Zap className="h-4 w-4 text-violet-700 dark:text-violet-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-pool">{formatNumber(totalPool)}</p>
            <p className="text-xs text-muted-foreground">Total Pool</p>
          </Card>
          <Card className="p-3 text-center">
            <Users className="h-4 w-4 text-violet-700 dark:text-violet-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-participants">{formatNumber(totalParticipants)}</p>
            <p className="text-xs text-muted-foreground">Participants</p>
          </Card>
          <Card className="p-3 text-center">
            <Gavel className="h-4 w-4 text-violet-700 dark:text-violet-500 mx-auto mb-1" />
            <p className="text-sm font-semibold capitalize" data-testid="text-resolve-method">
              {(market.resolveMethod || "manual").replace(/_/g, " ")}
            </p>
            <p className="text-xs text-muted-foreground">Resolution</p>
          </Card>
          <Card className="p-3 text-center">
            <Clock className="h-4 w-4 text-violet-700 dark:text-violet-500 mx-auto mb-1" />
            <p className="text-sm font-semibold" data-testid="text-close-date">
              {market.closeAt ? formatDate(market.closeAt) : market.endAt ? formatDate(market.endAt) : "TBD"}
            </p>
            <p className="text-xs text-muted-foreground">Close Date</p>
          </Card>
        </div>

        {market.summary && (
          <Card className="p-5 mb-6" data-testid="section-summary">
            <h2 className="text-lg font-serif font-bold mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-violet-700 dark:text-violet-500" />
              About
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{market.summary}</p>
            {market.description && market.description !== market.summary && (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap mt-3">{market.description}</p>
            )}
          </Card>
        )}

        {((market.resolutionCriteria && market.resolutionCriteria.length > 0) ||
          (market.resolutionSources && market.resolutionSources.length > 0)) && (
          <Card className="p-5 mb-6" data-testid="section-resolution-rules">
            <h2 className="text-lg font-serif font-bold mb-3 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-violet-700 dark:text-violet-500" />
              Resolution Rules
            </h2>
            {market.resolutionCriteria && market.resolutionCriteria.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Criteria</p>
                <ul className="space-y-1.5">
                  {market.resolutionCriteria.map((criterion, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-violet-700 dark:text-violet-500 shrink-0 mt-0.5" />
                      <span>{criterion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {market.resolutionSources && market.resolutionSources.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Sources</p>
                <div className="flex flex-col gap-1.5">
                  {market.resolutionSources.map((source, i) => (
                    <a
                      key={i}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 transition-colors"
                      data-testid={`link-resolution-source-${i}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      {source.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {isInactive && (
          <Card className="p-5 mb-6 border-amber-500/30 dark:border-amber-500/20 bg-amber-500/8 dark:bg-amber-500/5" data-testid="section-inactive-market">
            <div className="text-center py-4">
              <Clock className="h-8 w-8 text-amber-700 dark:text-amber-500 mx-auto mb-3" />
              <h2 className="text-lg font-serif font-bold mb-2">{(market as any).inactiveMessage || "Coming Soon"}</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                This market is not yet open for predictions. Check back soon for when it goes live.
              </p>
            </div>
          </Card>
        )}

        {isCommunityMarket && (
          <CardComments entityType="open-market" slug={params.slug || ""} />
        )}

        {/* Related Markets - placeholder for future implementation */}
      </div>

      {expandedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={() => setExpandedImage(null)}
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <img
            src={expandedImage}
            alt={market.title}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
