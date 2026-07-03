import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sharePage } from "@/lib/share";
import { hapticSuccess, hapticError } from "@/lib/haptic";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { useXpBurst } from "@/components/XpBurstProvider";
import { StakeModal, type StakeSelection } from "@/components/StakeModal";
import { CashOutSheet, type CashOutSelection } from "@/components/CashOutSheet";
import { formatVoxCompact, formatVox, formatVoxDelta, formatVoxPrice, voxWord } from "@/lib/currency";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest, getAuthHeaders, parseApiError } from "@/lib/queryClient";
import { useIdempotencyKey } from "@/lib/useIdempotencyKey";
import { navigateToLogin } from "@/lib/authReturn";
import { formatTimeAgo, formatDate } from "@/lib/formatDate";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { CardComments, useCommentCount } from "@/components/comments/CardComments";
import { CommentsBottomSheet } from "@/components/snap-scroll/CommentsBottomSheet";
import {
  type ApiAmmStateBlock,
  deriveBuyQuote,
  pricesFor,
  priceToPercent,
  snapshotFromApi,
} from "@/lib/ammClient";
import { resolveMarketHeadlineImageUrl } from "@/lib/predictMarketImage";
import { MyPositionCard, myPositionQueryKey } from "@/components/predict/MyPositionCard";
import { AmmPriceHistoryChart } from "@/components/predict/AmmPriceHistoryChart";
import { MarketActivityFeed } from "@/components/predict/MarketActivityFeed";
import { MarketDetailSkeleton } from "@/components/predict/MarketDetailSkeleton";
import { RelatedMarkets } from "@/components/predict/RelatedMarkets";
import { MuteMarketToggle } from "@/components/predict/MuteMarketToggle";
import { MarketCycleStrip } from "@/components/predict/MarketCycleStrip";
import { getCommunityMarketStatusMessage } from "@/lib/marketClosedMessaging";
import { useShareCard } from "@/contexts/ShareCardContext";
import { buildTradeShareData, buildPositionShareData } from "@/lib/share-data";
import { goBack } from "@/lib/goBack";
import { predictDetailSectionCardClass } from "@/lib/predict-detail-ui";
import { ImageLightbox } from "@/components/ImageLightbox";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useAmmPriceStream } from "@/hooks/useAmmPriceStream";
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
  MessageSquare,
  ChevronRight,
  Activity,
  Banknote,
} from "lucide-react";

interface MarketEntry {
  id: string;
  label: string;
  totalStake: number;
  noStake?: number;
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
  jackpotTotalPool?: number | null;
  jackpotTotalEntries?: number | null;
  jackpotPayout?: number | null;
  jackpotTiedWinners?: number | null;
  notesText?: string | null;
  /** Post-settlement AI one-liner (prediction_markets.resolution_summary). */
  aiSummary?: string | null;
}

interface JackpotWinnerRow {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  predictedScore: number | null;
  payout: number | null;
  margin: number | null;
}

interface JackpotWinners {
  visibleWinners: JackpotWinnerRow[];
  hiddenWinnerCount: number;
  totalWinners: number;
}

interface MarketData {
  id: string;
  marketType: string;
  openMarketType: "binary" | "multi" | "updown";
  /**
   * Underlying market engine. Community markets are 'amm'; jackpot
   * markets remain 'parimutuel'. The detail page swaps in live LMSR
   * pricing + sell affordances when this is 'amm'.
   */
  engine?: "amm" | "parimutuel" | string;
  /** LMSR state block, only present for engine='amm' markets. */
  ammState?: ApiAmmStateBlock | null;
  status: "OPEN" | "CLOSED_PENDING" | "RESOLVED" | "VOID";
  title: string;
  slug: string;
  teaser?: string | null;
  summary?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
  coverImageUrl?: string | null;
  personId?: string | null;
  sourceUrl?: string | null;
  featured?: boolean;
  timezone?: string | null;
  resolutionCriteria?: string[] | null;
  resolutionSources?: ResolutionSource[] | null;
  resolveMethod?: string | null;
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
  jackpotWinners?: JackpotWinners | null;
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
  // Fallback popularity weight when no AMM price map is available
  // (e.g. jackpot markets). Uses live stake (yes + no) only.
  const totalLivePool = entries.reduce(
    (sum, e) => sum + (e.totalStake || 0) + (e.noStake || 0),
    0,
  );
  return entries.map((e) => {
    const yesStake = e.totalStake || 0;
    const noStake = e.noStake || 0;
    const livePool = yesStake + noStake;
    const yesPercentage = livePool > 0 ? Math.round((yesStake / livePool) * 100) : 50;
    return {
      ...e,
      percentage: totalLivePool > 0 ? Math.round((livePool / totalLivePool) * 100) : Math.round(100 / entries.length),
      displayStake: livePool,
      yesPercentage,
      noPercentage: livePool > 0 ? 100 - yesPercentage : 50,
    };
  });
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
  isResolved,
}: {
  entries: (MarketEntry & { percentage: number; displayStake: number })[];
  selectedEntry: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
  isResolved?: boolean;
}) {
  // Once a market is resolved, binary outcomes always render in
  // displayOrder so Yes is on the left and No on the right. We rely
  // on the Winner/Lost tone badge (set further down) to highlight the
  // official outcome rather than reordering the row, since admins
  // sometimes use these as Above/Below pairs where the visual order
  // is meaningful.
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
          {isResolved && (
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">of pool</div>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{formatNumber(yesEntry.displayStake)} staked</span>
            <span>{yesEntry.betCount} predictions</span>
          </div>
        </button>
      )}
      {noEntry && (
        <button
          onClick={() => !disabled && onSelect(noEntry.id)}
          disabled={disabled}
          className={`relative p-4 rounded-xl border-2 transition-all text-left ${
            selectedEntry === noEntry.id
              ? "border-[#FF0000] bg-[#FF0000]/20 dark:bg-[#FF0000]/15 shadow-lg shadow-[#FF0000]/30 dark:shadow-[#FF0000]/20"
              : "border-[#FF0000]/30 dark:border-[#FF0000]/20 bg-[#FF0000]/8 dark:bg-[#FF0000]/5 hover:border-[#FF0000]/40"
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
            <XCircle className="h-5 w-5 text-[#FF0000]" />
            <span className="font-semibold text-[#FF0000]">{noEntry.label}</span>
          </div>
          <div className="text-3xl font-bold text-[#FF0000] font-mono">{noEntry.percentage}%</div>
          {isResolved && (
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">of pool</div>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{formatNumber(noEntry.displayStake)} staked</span>
            <span>{noEntry.betCount} predictions</span>
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
  isResolved,
}: {
  entries: (MarketEntry & { percentage: number; displayStake: number })[];
  selectedEntry: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
  isResolved?: boolean;
}) {
  // While the market is open we sort by popularity (largest pool share
  // first) so the favourite leads. Once it's resolved we instead pin
  // winners to the top and break ties on pool share — this avoids the
  // confusing case from the bug report where a popular but losing
  // outcome sits visually above the official winner.
  const sorted = [...entries].sort((a, b) => {
    if (isResolved) {
      const aWin = a.resolutionStatus === "winner" ? 1 : 0;
      const bWin = b.resolutionStatus === "winner" ? 1 : 0;
      if (aWin !== bWin) return bWin - aWin;
    }
    return b.percentage - a.percentage;
  });
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
            {/* No avatar placeholder — see pick-row comment. Names alone
                read better than "S." on mobile when the column shrinks. */}
            <span
              className={`w-[40%] sm:w-[30%] text-sm truncate shrink-0 ${
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
              className={`text-sm font-mono font-bold shrink-0 ${isResolved ? "w-[78px]" : "w-[48px]"} text-right ${
                tone?.textClass ?? (isLeading ? "text-violet-500 dark:text-violet-300" : "text-blue-500 dark:text-blue-300")
              }`}
            >
              {entry.percentage}%{isResolved && (
                <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  of pool
                </span>
              )}
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
  isResolved,
}: {
  entries: (MarketEntry & { percentage: number; displayStake: number })[];
  selectedEntry: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
  underlying: string;
  metric: string;
  strike: string;
  unit: string;
  isResolved?: boolean;
}) {
  const sorted = [...entries].sort((a, b) => a.displayOrder - b.displayOrder);
  // Strike defaults to "0" when the field was never populated. Hiding
  // the card in that case avoids the misleading "Strike Price 0" tile
  // that was showing on every native Up/Down resolved page (see bug
  // report). On resolved markets the card is also redundant with the
  // Open / Close score tiles in the result-summary section above.
  const strikeNumber = Number(strike);
  const hasStrike = !!strike && Number.isFinite(strikeNumber) && strikeNumber !== 0;
  const showStrikeCard = hasStrike && !isResolved;

  return (
    <div className="space-y-4">
      {showStrikeCard && (
        <Card className="p-4 bg-muted/10 border-border/40">
          <div className="text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{underlying} {metric}</p>
            <p className="text-3xl font-bold font-mono text-violet-600 dark:text-violet-400">
              {unit}{strikeNumber.toLocaleString('en-US')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Strike Price</p>
          </div>
        </Card>
      )}
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
                    : "border-[#FF0000] bg-[#FF0000]/20 dark:bg-[#FF0000]/15 shadow-lg shadow-[#FF0000]/30 dark:shadow-[#FF0000]/20"
                  : isAbove
                    ? "border-green-500/30 dark:border-green-500/20 bg-green-500/8 dark:bg-green-500/5 hover:border-green-500/40"
                    : "border-[#FF0000]/30 dark:border-[#FF0000]/20 bg-[#FF0000]/8 dark:bg-[#FF0000]/5 hover:border-[#FF0000]/40"
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
                  <TrendingDown className="h-5 w-5 text-[#FF0000]" />
                )}
                <span className={`font-semibold ${isAbove ? "text-green-600 dark:text-green-400" : "text-[#FF0000]"}`}>
                  {entry.label}
                </span>
              </div>
              <div className={`text-3xl font-bold font-mono ${isAbove ? "text-green-600 dark:text-green-400" : "text-[#FF0000]"}`}>
                {entry.percentage}%
              </div>
              {isResolved && (
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">of pool</div>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span>{formatNumber(entry.displayStake)} staked</span>
                <span>{entry.betCount} predictions</span>
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
  const { user, profile, isLoggedIn, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const { trigger: triggerXpBurst } = useXpBurst();
  const { openShareCard } = useShareCard();
  const marketCommentCount = useCommentCount("open-market", params.slug || "");

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
  const [commentsSheetOpen, setCommentsSheetOpen] = useState(false);
  /**
   * Sprint 5 / Phase 4.1+4.2: StakeModal state for community AMM
   * markets. Previously the buy flow was an inline form ("Place Your
   * Prediction") which had no Sell tab, no live LMSR quote, and
   * didn't match the polished modal used on Up/Down + H2H + Race.
   * Community markets now route the buy/sell flow through the modal;
   * the jackpot inline form is the only inline path still rendered
   * by this page.
   */
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<StakeSelection | null>(null);
  // Idempotency key per trade-modal intent. See `useIdempotencyKey.ts`.
  const tradeIdempotencyKey = useIdempotencyKey(stakeModalOpen, [
    pendingSelection?.entryId,
    pendingSelection?.direction,
  ]);
  // Cash-out flow lives in its own sheet (CashOutSheet), not the
  // StakeModal — buy and sell are fully separate surfaces now.
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [cashOutSelection, setCashOutSelection] = useState<CashOutSelection | null>(null);
  const cashOutIdempotencyKey = useIdempotencyKey(cashOutOpen, [
    cashOutSelection?.entryId,
  ]);

  // Refs for the "Add another entry / Increase stake" CTA on
  // MyPositionCard. Jackpot has a single always-rendered input we can
  // focus directly. For community/multi markets the stake input only
  // mounts after the user picks an entry, so we just scroll the
  // section into view and let the user choose their entry from there.
  const jackpotInputRef = useRef<HTMLInputElement | null>(null);
  const placePredictionSectionRef = useRef<HTMLDivElement | null>(null);

  const { data: market, isLoading, error } = useQuery<MarketData>({
    queryKey: ["/api/open-markets", params.slug],
    queryFn: async () => {
      const res = await fetch(`/api/open-markets/${params.slug}`);
      if (!res.ok) throw new Error("Market not found");
      return res.json();
    },
    enabled: !!params.slug,
  });

  // Tier 1.1: live price push. Opens a single SSE connection to
  // `/api/markets/:id/amm/stream` for this market and merges each
  // event into the cached payload above, so the price tiles +
  // receipt card + position rows update instantly when another
  // trader moves the market. Guarded on `market?.id` so logged-out
  // browse + native-market redirects don't pay for a stream they
  // can't render.
  useAmmPriceStream(market?.id ?? null, {
    queryKey: ["/api/open-markets", params.slug],
  });

  // Native market types have dedicated detail pages with the live chart,
  // "What needs to happen" callout, sticky position bar, and the
  // same-side top-up / opposite-side hedge guards. Whenever a native
  // market is reached via the generic /markets/:slug URL (PublicProfile
  // history, RelatedMarkets, watchlist, notifications, shared links),
  // route the user to the canonical surface so they get the polished,
  // guarded experience instead of the legacy generic form below. The
  // generic page is kept for community + jackpot, which have no
  // dedicated route. We use `replace: true` so Back skips the legacy
  // URL and returns to wherever the user actually came from.
  useEffect(() => {
    if (!market?.id || !market?.marketType) return;
    // Resolved / void natives stay on this page — the OPEN-only native
    // list feed used to make /predict/updown/:id show "Market not found"
    // after settlement. OPEN markets still redirect to the polished
    // native detail surfaces.
    if (market.status !== "OPEN") return;
    const dest =
      market.marketType === "updown" ? `/predict/updown/${market.id}` :
      market.marketType === "h2h"    ? `/predict/h2h/${market.id}` :
      market.marketType === "gainer" ? `/predict/race/${market.id}` :
      null;
    if (dest) {
      setLocation(dest, { replace: true });
    }
  }, [market?.id, market?.marketType, market?.status, setLocation]);

  // The page used to fetch /api/me/predictions to surface a per-market
  // "your prediction" pill list. That responsibility now belongs to
  // <MyPositionCard /> below, which fetches a per-market endpoint
  // (/api/markets/:id/my-position) — so we no longer need the global
  // predictions query here. See MyPositionCard for the migration notes.
  //
  // We DO read the same /my-position endpoint here to power the
  // no-hedging guards on the inline form (block opposite-direction
  // tap on multi, block other-entry tap on binary, show "Currently
  // staked" line for same-side top-ups). React Query dedupes the
  // request with MyPositionCard so this is effectively free.
  const { data: myPositionData } = useQuery<{
    bets: Array<{ entryId: string; direction: string; stakeAmount: number; status: string }>;
  }>({
    queryKey: market?.id ? myPositionQueryKey(market.id) : ["/api/markets", "_none_", "my-position"],
    // Use apiRequest so React Query dedupes this with the identical
    // call inside MyPositionCard — same query key + same fetcher
    // means a single network round-trip per render.
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/markets/${market!.id}/my-position`);
      return res.json();
    },
    enabled: !!market?.id && !!user,
  });

  // Aggregate per-entry stakes split by direction. Mirrors the shape
  // used on the Predict page so the guard logic reads the same.
  const userBetsByEntry = useMemo(() => {
    const map = new Map<string, { yesStake: number; noStake: number }>();
    for (const b of myPositionData?.bets ?? []) {
      if (b.status !== "active") continue;
      const dir = b.direction === "no" ? "no" : "yes";
      const prev = map.get(b.entryId) ?? { yesStake: 0, noStake: 0 };
      map.set(b.entryId, {
        yesStake: prev.yesStake + (dir === "yes" ? (b.stakeAmount || 0) : 0),
        noStake: prev.noStake + (dir === "no" ? (b.stakeAmount || 0) : 0),
      });
    }
    return map;
  }, [myPositionData]);

  // Single-entry binary markets only have one entry per user. We surface
  // it explicitly so the binary-form guard can lock the opposite entry.
  const userPickedEntryId = useMemo(() => {
    for (const [eId, s] of userBetsByEntry) {
      if (s.yesStake + s.noStake > 0) return eId;
    }
    return null;
  }, [userBetsByEntry]);

  const isCommunityMarket = market?.marketType === "community";
  const isJackpotMarket = market?.marketType === "jackpot";
  const isAmm = market?.engine === "amm";
  const effectiveOpenMarketType: "binary" | "multi" | "updown" = market?.openMarketType
    ? market.openMarketType
    : market?.marketType === "updown"
      ? "updown"
      : "multi";

  const ammSnapshot = useMemo(
    () => (isAmm ? snapshotFromApi(market?.ammState ?? null) : null),
    [isAmm, market?.ammState],
  );
  const ammPriceMap = useMemo(
    () => (ammSnapshot ? pricesFor(ammSnapshot) : null),
    [ammSnapshot],
  );

  // Parallel AMM position query so the persistent Share button on
  // MyPositionCard can build an honest position payload (netShares,
  // avgEntryPrice, currentPrice). Endpoint returns `{ positions: [] }`
  // for jackpot markets, so it's safe to leave enabled here.
  const { data: ammPositionData } = useQuery<{
    positions: Array<{
      entryId: string;
      entryLabel: string;
      netShares: number;
      netCreditsIn: number;
      avgEntryPrice: number;
      currentPrice: number;
      currentValue: number;
    }>;
  }>({
    queryKey: ["/api/markets", market?.id, "amm-position"],
    enabled: !!market?.id && !!isAmm,
    staleTime: 30_000,
    retry: false,
  });

  const betMutation = useMutation({
    mutationFn: async ({
      entryId,
      stakeAmount: amount,
      direction,
      maxPricePerShare,
    }: {
      entryId: string;
      stakeAmount: number;
      direction: "yes" | "no";
      maxPricePerShare?: number;
    }) => {
      if (!market) {
        throw new Error("Market not loaded");
      }

      if (market.marketType === "community") {
        const res = await apiRequest(
          "POST",
          `/api/open-markets/${params.slug}/bet`,
          { entryId, stakeAmount: amount, direction, maxPricePerShare },
          { idempotencyKey: tradeIdempotencyKey },
        );
        return res.json();
      }

      if (market.marketType === "jackpot") {
        throw new Error("Use the jackpot entry form on this page.");
      }

      const res = await apiRequest(
        "POST",
        `/api/native-markets/${market.id}/bet`,
        {
          entryId,
          stakeAmount: amount,
          maxPricePerShare,
        },
        { idempotencyKey: tradeIdempotencyKey },
      );
      return res.json();
    },
    onSuccess: async (data: any) => {
      const isAmmTrade = data?.engine === "amm";
      if (isAmmTrade && market) {
        // Find the entry the user picked so we can use its label as the
        // share-card eyebrow. `selectedEntry` is still the most recent
        // pick at this point (we only reset it after invalidate runs).
        const pickedEntry = market.entries?.find((e) => e.id === selectedEntry);
        const entryLabel = pickedEntry?.label || selectedDirection.toUpperCase();
        const lowerLabel = entryLabel.toLowerCase();
        // Community markets are often binary (Yes / No). We map Yes/Up
        // to the emerald direction accent and No/Down to rose; anything
        // else falls back to "other" (violet).
        const direction: "up" | "down" | "other" =
          lowerLabel === "yes" || lowerLabel === "up"
            ? "up"
            : lowerLabel === "no" || lowerLabel === "down"
              ? "down"
              : "other";
        const shares = Number(data?.sharesPurchased) || 0;
        const chargeCredits = Number(data?.chargeCredits) || 0;
        // Belt-and-braces: native-markets returns pricePerShareAvg
        // explicitly; community open-markets started returning it in
        // the same Sprint 2 commit. If a stale build is still in flight
        // we derive avg fill price from chargeCredits / shares.
        const pricePerShare =
          Number(data?.pricePerShareAvg) ||
          (shares > 0 ? chargeCredits / shares : 0);
        const tradeData = buildTradeShareData({
          actionType: "buy",
          username: profile?.username || "you",
          // Community markets may or may not be linked to a person.
          // When unlinked we leave personName null — the share card
          // falls back to a "—" hero and lets the market title carry
          // the meaning.
          personName: market.linkedPersonName ?? null,
          personAvatar: market.linkedPersonAvatar ?? market.coverImageUrl ?? null,
          marketTitle: market.title,
          category: market.category ?? null,
          entryLabel,
          direction,
          shares,
          pricePerShare,
          stakeAmount: chargeCredits,
        });
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        // Sprint 3: prefer the per-bet share URL so community-market
        // shares preview the trade variant. Falls back to the market
        // page URL on missing betId (legacy pari-mutuel rows).
        const shareUrl = data?.betId
          ? `${origin}/share/bet/${data.betId}`
          : `${origin}/markets/${market.slug}`;
        const fallbackText = `I just backed ${entryLabel} on "${market.title}" on VoxDex!\n${shareUrl}`;
        toast("Shares purchased", {
          description: `${Math.round(shares).toLocaleString()} ${entryLabel} shares · ${formatVox(chargeCredits)}`,
          action: {
            label: "Share",
            onClick: () =>
              openShareCard({
                data: tradeData,
                fallbackText,
                shareUrl,
                filenameBase: `voxdex-trade-${(data?.betId ?? "buy").toString().slice(0, 8)}`,
              }),
          },
        });
      } else {
        toast(
          isAmmTrade ? "Shares purchased" : "Prediction placed!",
          {
            description: isAmmTrade && Number.isFinite(Number(data?.sharesPurchased))
              ? `You bought ${Number(data.sharesPurchased).toFixed(2)} shares for ${Number.isFinite(Number(data?.chargeCredits)) ? formatVox(Number(data.chargeCredits)) : "—"}.`
              : "Your prediction has been recorded.",
          },
        );
      }
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets", params.slug] }),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/updown"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/h2h"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/native-markets/gainer"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
        market?.id ? queryClient.invalidateQueries({ queryKey: myPositionQueryKey(market.id) }) : Promise.resolve(),
        market?.id ? queryClient.invalidateQueries({ queryKey: ["/api/markets", market.id, "price-history"] }) : Promise.resolve(),
      ]);
      setSelectedEntry(null);
      setSelectedDirection("yes");
      setStakeAmount("");
    },
    onError: (err: Error) => {
      const { title, description } = parseApiError(err, "Failed to place prediction");
      toast.error(title, { description });
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
    onSuccess: async (data: any) => {
      toast("Jackpot entry placed!", { description: `Your prediction ${data.predictedScore.toLocaleString("en-US")} has been recorded.` });
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      setJackpotScoreInput("");
      setJackpotSuggestions([]);
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets", params.slug] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/predict/recent-activity"] }),
        market?.id ? queryClient.invalidateQueries({ queryKey: myPositionQueryKey(market.id) }) : Promise.resolve(),
      ]);
    },
    onError: (error: any) => {
      if (error?.code === "NUMBER_TAKEN") {
        setJackpotSuggestions(error?.suggestions || []);
      } else {
        setJackpotSuggestions([]);
      }
      toast.error("Failed to place jackpot entry", { description: error?.message || "Please try again." });
    },
  });


  /**
   * Sprint 5 / Phase 4.7 fix: track whether the AMM auto-open has
   * fired so the second effect (which depends on openBuyModal) is
   * idempotent. Without this ref a state update inside openBuyModal
   * could re-run the effect and pop the modal a second time after the
   * user closes it.
   */
  const ammAutoOpenFiredRef = useRef(false);
  /**
   * Entry id queued for AMM auto-open. The first effect parses the
   * pick param and stores the resolved entry id here; the second
   * effect (which has openBuyModal in scope) reads it and calls
   * `openBuyModal`. Split this way because `openBuyModal` is defined
   * further down the component body — keeping it out of this effect's
   * closure means we don't need to put a render-fresh function in the
   * deps array.
   */
  const [ammAutoOpenEntryId, setAmmAutoOpenEntryId] = useState<string | null>(null);

  useEffect(() => {
    if (pickApplied || !market?.entries) return;

    // Explicit pick from the URL wins (links from leaderboard pin
    // taps, etc.). When neither pick nor direction is supplied but
    // the user already has an active position we pre-select it so
    // the top-up flow lands directly on the right side without a
    // tap — mirrors the StakeModal pattern shipped on native cards.
    if (pickParam) {
      const pickLower = pickParam.toLowerCase();
      const matchedById = market.entries.find((e) => e.id === pickParam);
      const matchedByLabel = market.entries.find((e) =>
        e.label.toLowerCase() === pickLower ||
        e.label.toLowerCase().includes(pickLower)
      );
      const matched = matchedById || matchedByLabel;
      if (matched) {
        setSelectedEntry(matched.id);
        // Sprint 5 / Phase 4.7 fix: on AMM (non-jackpot) markets the
        // inline form is hidden — selectedEntry alone won't take the
        // user anywhere. Queue an auto-open so the StakeModal pops
        // for the picked entry, matching the one-tap UX native cards
        // already provide via `onPickEntry`. Jackpot keeps its own
        // inline UI and is excluded here.
        if (isAmm && !isJackpotMarket) {
          setAmmAutoOpenEntryId(matched.id);
        }
      }
      if (directionParam === "yes" || directionParam === "no") {
        setSelectedDirection(directionParam);
      }
      setPickApplied(true);
      return;
    }

    if (userPickedEntryId) {
      const stakes = userBetsByEntry.get(userPickedEntryId);
      const dir: "yes" | "no" =
        stakes && stakes.noStake > stakes.yesStake ? "no" : "yes";
      setSelectedEntry(userPickedEntryId);
      setSelectedDirection(dir);
      setPickApplied(true);
    }
  }, [pickParam, directionParam, market?.entries, pickApplied, userPickedEntryId, userBetsByEntry, isAmm, isJackpotMarket]);

  const timeLeft = useCountdown(market?.closeAt || market?.endAt || null);

  const entriesWithPercentages = useMemo(() => {
    if (!market?.entries) return [];
    if (isAmm && ammPriceMap) {
      return market.entries.map((e) => {
        const price = Number(ammPriceMap[e.id] ?? 0);
        const pct = Math.max(0, Math.min(100, Math.round(price * 100)));
        return {
          ...e,
          percentage: pct,
          displayStake: e.totalStake || 0,
          yesPercentage: pct,
          noPercentage: Math.max(0, 100 - pct),
        };
      });
    }
    return getEntryPercentages(market.entries);
  }, [market?.entries, isAmm, ammPriceMap]);

  const totalPool = useMemo(() => {
    if (!market) return 0;
    return (market.entries || []).reduce(
      (sum, e) => sum + (e.totalStake || 0) + (e.noStake || 0),
      0,
    );
  }, [market]);

  const totalParticipants = useMemo(() => {
    if (!market) return 0;
    return market.totalParticipants || 0;
  }, [market]);

  const potentialPayout = useMemo(() => null, []);

  // AMM buy quote — preview-only LMSR quote built off the live `ammState`
  // snapshot. Mirrors the modal's `ammBuyQuote` so the inline form on
  // this page shows share count + max payout + slippage without any
  // backend round-trip.
  const ammBuyQuote = useMemo(() => {
    if (!isAmm || !selectedEntry || !market?.ammState) return null;
    const amount = Number(stakeAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return deriveBuyQuote(market.ammState, selectedEntry, amount);
  }, [isAmm, selectedEntry, stakeAmount, market?.ammState]);
  const ammEntryPrice = useMemo(() => {
    if (!isAmm || !ammPriceMap || !selectedEntry) return null;
    const p = ammPriceMap[selectedEntry];
    return Number.isFinite(p) ? Number(p) : null;
  }, [isAmm, ammPriceMap, selectedEntry]);

  /**
   * Sprint 5 / Phase 4.2: Community AMM sell mutation. Hits the
   * dedicated /api/markets/:id/sell endpoint (LMSR sell of YES shares
   * of one entry). Mirrors the receipt + cache invalidation pattern
   * used by the buy flow above so the per-entry position rows refresh
   * immediately after a sell.
   */
  const ammSellMutation = useMutation({
    mutationFn: async ({
      entryId,
      shares,
      minPricePerShare,
    }: {
      entryId: string;
      shares: number;
      minPricePerShare?: number;
    }) => {
      if (!market) throw new Error("Market not loaded");
      const res = await apiRequest(
        "POST",
        `/api/markets/${market.id}/sell`,
        {
          entryId,
          shares,
          minPricePerShare,
        },
        { idempotencyKey: cashOutIdempotencyKey },
      );
      return res.json();
    },
    onSuccess: async (data: any) => {
      hapticSuccess();
      const proceeds = Math.round(Number(data?.proceeds ?? 0));
      toast("Cashed out", {
        description:
          proceeds > 0
            ? `Proceeds credited: +${formatVox(proceeds)}`
            : "Proceeds have been credited to your wallet.",
      });
      if (data?.xp?.xpAwarded) {
        triggerXpBurst(data.xp.xpAwarded, undefined, data.xp.reason);
      }
      setCashOutOpen(false);
      setCashOutSelection(null);
      await Promise.all([
        refreshProfile(),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/open-markets", params.slug] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/me/amm-positions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] }),
        market?.id ? queryClient.invalidateQueries({ queryKey: myPositionQueryKey(market.id) }) : Promise.resolve(),
        market?.id ? queryClient.invalidateQueries({ queryKey: ["/api/markets", market.id, "amm-position"] }) : Promise.resolve(),
        market?.id ? queryClient.invalidateQueries({ queryKey: ["/api/markets", market.id, "price-history"] }) : Promise.resolve(),
      ]);
    },
    onError: (err: Error) => {
      hapticError();
      const { title, description } = parseApiError(err, "Failed to cash out position");
      toast.error(title, { description });
    },
  });

  /**
   * Sprint 5 / Phase 4.1: build a StakeSelection for the community
   * AMM market and open the modal in buy mode. `direction` is only
   * meaningful for multi community markets (Yes/No per entry) —
   * binary markets bake the side into the entry label.
   *
   * We re-derive `crowdSentiment` from the live LMSR price (rounded
   * to whole %) so the modal hero pill matches the Live Market card
   * immediately above it, and pass `engine: 'amm' + ammState` so the
   * modal flips into LMSR mode (live Ꝟ/share quote, Sell tab gated
   * on `ammNetShares`).
   */
  const openBuyModal = (entry: MarketEntry, direction: "yes" | "no" = "yes") => {
    if (!isLoggedIn) {
      navigateToLogin(setLocation);
      return;
    }
    if (!market) return;
    const livePrice = ammPriceMap ? Number(ammPriceMap[entry.id] ?? 0) : 0;
    const crowdSentiment = Math.round(Math.max(0, Math.min(1, livePrice)) * 100);
    const netSharesForEntry =
      ammPositionData?.positions?.find((p) => p.entryId === entry.id)?.netShares ?? 0;
    setPendingSelection({
      type: "community",
      marketId: market.id,
      entryId: entry.id,
      choice:
        effectiveOpenMarketType === "binary"
          ? entry.label
          : `${direction === "no" ? "No" : "Yes"} \u00b7 ${entry.label}`,
      marketName: market.title,
      personName: market.linkedPersonName ?? undefined,
      crowdSentiment,
      bettingCutoff: market.closeAt || market.endAt || null,
      endAt: market.endAt || undefined,
      direction:
        effectiveOpenMarketType === "binary"
          ? undefined
          : direction,
      openMarketType: effectiveOpenMarketType,
      engine: "amm",
      ammState: market.ammState ?? null,
      ammNetShares: netSharesForEntry,
    } as StakeSelection);
    setStakeModalOpen(true);
  };

  /**
   * Open the CashOutSheet for a specific AMM entry. Only meaningful
   * when the user holds netShares on the entry — the per-entry Cash
   * out buttons are hidden otherwise.
   */
  const openCashOut = (entry: MarketEntry) => {
    if (!isLoggedIn) {
      navigateToLogin(setLocation);
      return;
    }
    if (!market) return;
    const pos = ammPositionData?.positions?.find((p) => p.entryId === entry.id);
    if (!pos || pos.netShares <= 1e-6) return;
    setCashOutSelection({
      marketId: market.id,
      entryId: entry.id,
      sideLabel: entry.label,
      sideTone: "neutral",
      marketName: market.title,
      netShares: pos.netShares,
      netCreditsIn: pos.netCreditsIn,
      avgEntryPrice: pos.avgEntryPrice,
      bettingCutoff: market.closeAt || market.endAt || null,
      endAt: market.endAt || undefined,
      ammState: market.ammState ?? null,
    });
    setCashOutOpen(true);
  };

  /**
   * Sprint 5 / Phase 4.1: StakeModal buy confirm. Routes through the
   * existing `betMutation` (which already handles both community and
   * native paths) so the receipt + share toast + cache invalidations
   * stay consistent with the legacy inline form. We dispatch on the
   * `pendingSelection.entryId / direction` because the modal can flip
   * sides via `onDirectionChange` without reopening.
   */
  const handleConfirmStakeFromModal = async (
    amount: number,
    meta?: { maxPricePerShare?: number },
  ) => {
    if (!pendingSelection?.entryId) return;
    const direction =
      pendingSelection.direction === "no" ? "no" : "yes";
    await betMutation.mutateAsync({
      entryId: pendingSelection.entryId,
      stakeAmount: amount,
      direction,
      maxPricePerShare: meta?.maxPricePerShare,
    });
    setStakeModalOpen(false);
    setPendingSelection(null);
  };

  /**
   * CashOutSheet sell confirm. Sends `shares` to the community sell
   * endpoint via `ammSellMutation`.
   */
  const handleConfirmCashOut = async (
    shares: number,
    meta?: { minPricePerShare?: number },
  ) => {
    if (!cashOutSelection?.entryId) return;
    await ammSellMutation.mutateAsync({
      entryId: cashOutSelection.entryId,
      shares,
      minPricePerShare: meta?.minPricePerShare,
    });
  };

  /**
   * Sprint 5 / Phase 4.7 fix: AMM auto-open. Fires `openBuyModal` once
   * after the pickApplied effect resolved a URL pick to a real entry,
   * matching the one-tap modal UX of native (Up/Down / H2H / Race)
   * cards. Guards on the `ammAutoOpenFiredRef` so a re-render driven
   * by the modal state itself doesn't spawn a second modal.
   */
  useEffect(() => {
    if (ammAutoOpenFiredRef.current) return;
    if (!ammAutoOpenEntryId || !isAmm || isJackpotMarket) return;
    if (!market || market.status !== "OPEN") return;
    const entry = market.entries?.find((e) => e.id === ammAutoOpenEntryId);
    if (!entry) return;
    const direction: "yes" | "no" =
      directionParam === "no" ? "no" : "yes";
    ammAutoOpenFiredRef.current = true;
    openBuyModal(entry, direction);
    setAmmAutoOpenEntryId(null);
  }, [ammAutoOpenEntryId, isAmm, isJackpotMarket, market, directionParam]);

  const walletBalance = profile?.predictCredits ?? 0;

  /* Dynamic meta — keeps the browser tab title and JS-running crawlers
   * (Google, Bing) in sync with the market. Slack / iMessage / X go via
   * the bot-UA Vercel rewrite (see vercel.json) to /api/og/markets/:slug. */
  useDocumentMeta({
    title: market ? `${market.title} • VoxDex` : "Market • VoxDex",
    description: market
      ? market.teaser ?? market.summary ?? `Predict on "${market.title}" — World market on VoxDex.`
      : null,
    image: market
      ? `/api/og/image/market.png?title=${encodeURIComponent(market.title)}&subtitle=${encodeURIComponent("World market • VoxDex")}&badge=${encodeURIComponent("World market")}`
      : null,
  });

  if (isLoading && !market) {
    return <MarketDetailSkeleton />;
  }

  if (error || !market) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => goBack(setLocation, "/markets")} aria-label="Go back" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <Link href="/">
                <button className="flex items-center gap-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" data-testid="button-logo-home">
                  <VoxDexLogo size={32} />
                  <span className="font-serif font-bold text-xl hidden sm:block">VoxDex</span>
                </button>
              </Link>
            </div>
            <HeaderUserActions />
          </div>
        </header>
        <div className="container mx-auto px-4 pt-20 pb-24 md:pb-6 text-center" data-testid="market-not-found">
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
  const isResolved = market.status === "RESOLVED";
  const resultOpenScore = market.resolutionSummary?.openScore ?? market.baselineScore ?? null;
  const resultCloseScore = market.resolutionSummary?.closeScore ?? null;
  const resultActualScore = market.resolutionSummary?.actualScore ?? null;
  const resultWinningPrediction = market.resolutionSummary?.winningPrediction ?? null;
  const resultResolvedAt = market.resolutionSummary?.closeSnapshotAt || market.resolvedAt || null;
  const headlineImageUrl = resolveMarketHeadlineImageUrl(market);

  // Status-driven copy lives in lib/marketClosedMessaging so every
  // "this market isn't open" surface (weekly, community, jackpot,
  // popovers) speaks in the same voice.
  const { title: resultTitle, description: resultDescription } =
    getCommunityMarketStatusMessage({
      status: market.status,
      outcomeLabel: market.resolutionSummary?.outcomeLabel ?? null,
      voidReason: market.voidReason ?? null,
      isJackpotMarket,
    });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => goBack(setLocation, "/markets")} aria-label="Go back" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Link href="/">
              <button
                className="flex items-center gap-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="button-logo-home"
              >
                <VoxDexLogo size={32} />
                <span className="font-serif font-bold text-xl hidden sm:block">VoxDex</span>
              </button>
            </Link>
          </div>
          <HeaderUserActions />
        </div>
      </header>

      <div className="container mx-auto px-4 pt-6 pb-24 md:pb-6 max-w-3xl">
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
            {!headerImgError && headlineImageUrl && (
              <div
                className="w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-800 cursor-pointer"
                onClick={() => setExpandedImage(headlineImageUrl)}
              >
                <img
                  src={headlineImageUrl}
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
            <div className="ml-auto flex items-center gap-1">
              <MuteMarketToggle marketId={market.id} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => sharePage(`${market.title} on VoxDex`, { sharerUserId: user?.id, surface: "market" })}
                data-testid="button-share"
              >
                <Share2 className="h-4 w-4 mr-1" />
                Share
              </Button>
            </div>
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

          {/* Native-parity timing strip: "Trading closes … / Results …"
              with a live countdown. Community only (jackpot rows on this
              page keep their own weekly cutoff hero) and only while the
              market is OPEN — the result card owns closed/resolved copy,
              and the strip's RESOLVED variant carries weekly-native
              wording that doesn't fit world events. */}
          {market.marketType === "community" && market.status === "OPEN" && (market.closeAt || market.endAt) && (
            <MarketCycleStrip
              bettingCutoff={market.closeAt || market.endAt}
              resolveAt={market.endAt}
              variant="full"
              engine="amm"
              className="mt-4"
            />
          )}
        </div>

        {/* Live "My Position" / "Your Result" card. Renders for both
            open and resolved markets — open shows current standing and
            adds an "Add another entry" CTA, resolved shows what the
            user took home (payout + signed net) so the page answers
            "how did I do?" alongside the official outcome. Hidden when
            the user has no bets on the market (the card returns null
            internally). */}
        {!isInactive && market.id && (
          <MyPositionCard
            marketId={market.id}
            marketType={market.marketType}
            marketStatus={market.status}
            isAmm={isAmm}
            hideCta={!isOpen}
            onAddEntry={() => {
              // Scroll the place-prediction section into view, then
              // focus the appropriate input. setTimeout 250ms lets the
              // smooth scroll settle before we focus, avoiding the
              // jarring jump-to-input that focus() alone causes.
              placePredictionSectionRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
              window.setTimeout(() => {
                if (isJackpotMarket) {
                  jackpotInputRef.current?.focus();
                }
              }, 250);
            }}
            // Sprint 3.1: persistent Share affordance for AMM open
            // positions on community markets. Picks the biggest
            // currently-valued position across all entries.
            onShare={(() => {
              if (!isAmm) return undefined;
              const positions = (ammPositionData?.positions ?? []).filter(
                (p) => p.netShares > 1e-6,
              );
              if (positions.length === 0) return undefined;
              const pos = positions.reduce((biggest, p) =>
                p.currentValue > biggest.currentValue ? p : biggest,
              );
              return () => {
                const entry = market.entries?.find(
                  (e: any) => e.id === pos.entryId,
                ) as any;
                const person = entry?.person ?? null;
                const isBinary = market.openMarketType === "binary";
                const data = buildPositionShareData({
                  username: profile?.username || "you",
                  personName: person?.name ?? null,
                  personAvatar: person?.avatar ?? null,
                  marketTitle: market.title,
                  category: market.category ?? null,
                  entryLabel: pos.entryLabel,
                  direction: isBinary
                    ? pos.entryLabel.toLowerCase() === "no"
                      ? "down"
                      : "up"
                    : "other",
                  netShares: pos.netShares,
                  avgEntryPrice: pos.avgEntryPrice,
                  currentPrice: pos.currentPrice,
                  costBasis: pos.netCreditsIn,
                  currentValue: pos.currentValue,
                  endAt: market.endAt || "",
                });
                const origin =
                  typeof window !== "undefined"
                    ? window.location.origin
                    : "";
                const pathname =
                  typeof window !== "undefined"
                    ? window.location.pathname
                    : "";
                openShareCard({
                  data,
                  fallbackText: `I'm holding ${Math.floor(pos.netShares)} shares on "${market.title}" on VoxDex!\n${origin}${pathname}`,
                  shareUrl: `${origin}${pathname}`,
                  filenameBase: `voxdex-position-${market.id.slice(0, 8)}`,
                });
              };
            })()}
          />
        )}

        {/* AMM Live Market panel — surfaces the canonical LMSR price
            for each outcome. For multi markets we show a vertical
            list of bars; for binary we show two equal tiles.
            Consolidated Live Market card mirrors the Up/Down + Race
            patterns:
              1. Header chips (Ꝟ VOL + Traders + LIVE)
              2. Per-position rows when the user holds netShares on
                 any entry — conversational copy + inline Sell button
              3. Per-entry Buy CTAs:
                   - Binary (2 entries): two-tile grid with a Buy
                     button per side, mirroring the Up/Down layout
                   - Multi (N entries): per-row layout with a Buy
                     button (label + price + Buy on each row),
                     mirroring the Race candidate list. */}
        {isAmm && ammPriceMap && market.entries && market.entries.length > 0 && (() => {
          const liveVolume = Number(market.ammState?.totalUserCreditsIn ?? 0);
          const liveVolumeLabel = liveVolume > 0 ? formatVoxCompact(liveVolume) : null;
          // Sprint 5 / Phase 4.3: trader count chip uses the same
          // `totalParticipants` memo as the existing hero stats below
          // so the two surfaces stay numerically aligned.
          const traderCount = totalParticipants;
          const openPositions = (ammPositionData?.positions ?? []).filter(
            (p) => p.netShares > 1e-6,
          );
          return (
            <Card className={predictDetailSectionCardClass("p-4 mb-6")} data-testid="section-amm-live-market">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Live Market
                </h2>
                <div className="flex items-center gap-1.5">
                  {liveVolumeLabel && (
                    <Badge
                      variant="outline"
                      className="text-[10px] tabular-nums text-muted-foreground border-border/50"
                      data-testid="community-live-market-volume"
                    >
                      {liveVolumeLabel} vol
                    </Badge>
                  )}
                  {traderCount > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] tabular-nums text-muted-foreground border-border/50 flex items-center gap-1"
                    >
                      <Users className="h-2.5 w-2.5" />
                      {traderCount}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/40 dark:border-emerald-500/30 text-[10px]">
                    LIVE
                  </Badge>
                </div>
              </div>

              {/* Per-position rows. One row per entry the user holds
                  netShares on. Re-using the same conversational copy
                  pattern as H2H + Race so the "Your position" block
                  reads identically across detail pages. */}
              {openPositions.length > 0 && (
                <div className="space-y-2 pb-3 mb-3 border-b border-border/40">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Your positions
                  </p>
                  {openPositions
                    .slice()
                    .sort((a, b) => b.currentValue - a.currentValue)
                    .map((pos) => {
                      const entry = market.entries?.find((e) => e.id === pos.entryId);
                      if (!entry) return null;
                      const unrealisedPnl = pos.currentValue - pos.netCreditsIn;
                      const maxProfitIfWin = pos.netShares - pos.netCreditsIn;
                      const pnlIsZero = Math.abs(unrealisedPnl) < 0.005;
                      const pnlClass = pnlIsZero
                        ? "text-muted-foreground"
                        : unrealisedPnl >= 0
                          ? "text-green-700 dark:text-green-500"
                          : "text-red-700 dark:text-red-500";
                      return (
                        <div
                          key={pos.entryId}
                          className="rounded-lg bg-muted/30 p-3"
                          data-testid={`community-position-row-${pos.entryId}`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{entry.label}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {pos.netShares.toFixed(2)} shares · avg {formatVoxPrice(pos.avgEntryPrice, 3)} · cost {formatVoxPrice(pos.netCreditsIn, 0)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Cash out now: ~{formatVoxPrice(pos.currentValue)}{" "}
                              <span className={`font-mono font-medium ${pnlClass}`}>
                                ({formatVoxDelta(unrealisedPnl)})
                              </span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              If {entry.label} wins: {formatVoxPrice(pos.netShares)}{" "}
                              <span className="font-mono font-medium text-green-700 dark:text-green-500">
                                ({formatVoxDelta(maxProfitIfWin)})
                              </span>
                            </p>
                          </div>
                          <div className="mt-2 flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              disabled={!isOpen}
                              onClick={() => openCashOut(entry)}
                              data-testid={`community-position-sell-${pos.entryId}`}
                              className="gap-1 px-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                            >
                              <Banknote className="h-3.5 w-3.5" />
                              <span>Cash out ~{formatVox(Math.round(pos.currentValue))}</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!isOpen}
                              onClick={() => openBuyModal(entry, "yes")}
                              data-testid={`community-position-add-${pos.entryId}`}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  <p className="text-[10px] text-muted-foreground text-center pt-1">
                    Live prices — these numbers shift as the market moves.
                  </p>
                </div>
              )}

              {effectiveOpenMarketType === "multi" ? (
                <div className="space-y-2">
                  {[...entriesWithPercentages].sort((a, b) => b.percentage - a.percentage).map((entry) => {
                    const livePrice = Number(ammPriceMap[entry.id] ?? 0);
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 text-sm rounded-lg border border-border/40 bg-background/40 p-2"
                        data-testid={`amm-live-row-${entry.id}`}
                      >
                        <span className="w-[28%] sm:w-[26%] truncate font-medium">{entry.label}</span>
                        <div className="flex-1 h-5 rounded-md overflow-hidden border border-blue-500/25 bg-slate-900/80">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                            style={{ width: `${Math.max(entry.percentage, 1)}%` }}
                          />
                        </div>
                        <span className="font-mono font-bold text-sm w-12 text-right tabular-nums">{entry.percentage}%</span>
                        <span className="font-mono text-[10px] text-muted-foreground w-14 text-right tabular-nums hidden sm:block">
                          {formatVoxPrice(livePrice)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isOpen}
                          onClick={() => openBuyModal(entry, "yes")}
                          className="shrink-0 h-8 px-3"
                          data-testid={`community-buy-${entry.id}`}
                        >
                          Buy
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {[...entriesWithPercentages].sort((a, b) => a.displayOrder - b.displayOrder).map((entry) => {
                    const livePrice = Number(ammPriceMap[entry.id] ?? 0);
                    const isYesLike =
                      entry.label.toLowerCase() === "yes" ||
                      entry.label.toLowerCase() === "above" ||
                      entry.displayOrder === 0;
                    const tileColor = isYesLike
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-rose-500/30 bg-rose-500/5";
                    const priceColor = isYesLike
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400";
                    const btnColor = isYesLike
                      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                      : "border-rose-500/40 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10";
                    return (
                      <div
                        key={entry.id}
                        className={`rounded-lg border p-3 text-center ${tileColor}`}
                        data-testid={`amm-live-tile-${entry.id}`}
                      >
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{entry.label}</p>
                        <p className={`text-2xl font-bold font-mono ${priceColor}`}>{entry.percentage}%</p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">{formatVoxPrice(livePrice)} / share</p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isOpen}
                          onClick={() => openBuyModal(entry, "yes")}
                          className={`mt-2 w-full h-8 ${btnColor}`}
                          data-testid={`community-buy-${entry.id}`}
                        >
                          Buy {entry.label}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground/70 mt-3 text-center">
                Live LMSR pricing — each share pays Ꝟ1 if the outcome wins.
              </p>
            </Card>
          );
        })()}

        {/* AMM price history chart — shows market consensus drift.
            Sits above the place-prediction form so users see the
            trend before they trade. */}
        {isAmm && market.entries && market.entries.length > 0 && (() => {
          const palette = ["#10b981", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];
          const series = market.entries
            .slice()
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .slice(0, palette.length)
            .map((e, i) => ({ entryId: e.id, label: e.label, color: palette[i] }));
          return (
            <Card className={predictDetailSectionCardClass("p-4 mb-6")} data-testid="section-amm-price-history">
              <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Market Price History
              </h2>
              <AmmPriceHistoryChart
                marketId={market.id}
                series={series}
                livePrices={ammPriceMap ?? {}}
                height={220}
              />
            </Card>
          );
        })()}

        {/* Live trade feed for this market — keeps community markets in
            sync with the rest of the platform's social surfaces. */}
        {market.id && (
          <div className="mb-6">
            <MarketActivityFeed marketId={market.id} />
          </div>
        )}

        {/* Jackpot keeps its own inline form (unique-score input +
            different endpoint). Non-jackpot community markets are
            AMM-only and buy via the Live Market card above. */}
        {isOpen && !isInactive && isJackpotMarket && (
          <Card
            ref={placePredictionSectionRef}
            className="p-5 mb-6 border-border/40 bg-muted/5"
            data-testid="section-place-prediction"
          >
            <h2 className="text-lg font-serif font-bold mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-violet-700 dark:text-violet-500" />
              Place Your Prediction
            </h2>

            {!isLoggedIn ? (
              <div className="text-center py-4">
                <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">Sign in to place predictions</p>
                <Button onClick={() => navigateToLogin(setLocation)} data-testid="button-login-to-predict">
                  Sign In
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Predict exact closing Trend Score</label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Enter exact score (e.g. 352000)"
                    ref={jackpotInputRef}
                    value={jackpotScoreInput}
                    onChange={(e) => setJackpotScoreInput(e.target.value)}
                    className="bg-background/50"
                    data-testid="input-jackpot-predicted-score"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Jackpot entries are unique per score and cost Ꝟ100.
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

            {(market.resolutionSummary?.outcomeLabel || market.resolutionSummary?.notesText || market.resolutionSummary?.aiSummary || market.voidReason) && (
              <div className="rounded-lg border border-border/50 bg-background/40 px-4 py-3 mb-4">
                {market.resolutionSummary?.outcomeLabel && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Outcome:</span>{" "}
                    <span className="font-semibold text-foreground">{market.resolutionSummary.outcomeLabel}</span>
                  </p>
                )}
                {!market.resolutionSummary?.outcomeLabel && !market.resolutionSummary?.aiSummary && (market.resolutionSummary?.notesText || market.voidReason) && (
                  <p className="text-sm text-muted-foreground">
                    {market.voidReason || market.resolutionSummary?.notesText}
                  </p>
                )}
                {market.resolutionSummary?.aiSummary && (
                  <p className="text-sm italic text-muted-foreground mt-1" data-testid="text-ai-resolution-summary">
                    {market.resolutionSummary.aiSummary}
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

            {/* Jackpot winner block — only renders for resolved jackpot
                markets. The endpoint already filters out winners whose
                profile is private or who hid their winning bet, so we
                just need to express the resulting state in copy:
                  - 1+ visible winners, no hidden ones → list usernames
                  - mix of visible + hidden → list visible, then a note
                  - all hidden / no rows → privacy-respecting fallback
                Tied jackpots get a "split between N players" line so
                the per-winner share isn't mistaken for the full pool. */}
            {isJackpotMarket && market.status === "RESOLVED" && (() => {
              const wp = market.jackpotWinners ?? null;
              const visible = wp?.visibleWinners ?? [];
              const hiddenCount = wp?.hiddenWinnerCount ?? 0;
              const totalWinners = wp?.totalWinners ?? (visible.length + hiddenCount);
              const totalPool = market.resolutionSummary?.jackpotTotalPool ?? null;
              const totalEntries = market.resolutionSummary?.jackpotTotalEntries ?? null;
              const tied = market.resolutionSummary?.jackpotTiedWinners ?? totalWinners;
              const hasAnyWinnerInfo = visible.length > 0 || hiddenCount > 0 || totalWinners > 0;
              if (!hasAnyWinnerInfo && totalPool === null && totalEntries === null) {
                return null;
              }
              return (
                <div
                  className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/8 dark:bg-amber-500/5 px-4 py-3"
                  data-testid="section-jackpot-winners"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                      {totalWinners > 1 ? "Jackpot winners" : "Jackpot winner"}
                    </p>
                  </div>
                  {visible.length > 0 ? (
                    <div className="space-y-1.5">
                      {visible.map((w) => (
                        <div key={w.userId} className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-semibold text-amber-700 dark:text-amber-300 truncate">
                            {w.username ? `@${w.username}` : "Anonymous"}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                            {w.predictedScore != null && (
                              <span className="mr-2">
                                guessed {w.predictedScore.toLocaleString("en-US")}
                              </span>
                            )}
                            {w.payout != null && (
                              <span className="font-mono font-semibold text-amber-700 dark:text-amber-300">
                                {formatVox(w.payout)}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                      {hiddenCount > 0 && (
                        <p className="text-xs text-muted-foreground italic">
                          {hiddenCount === 1
                            ? "1 winner hidden by their profile settings"
                            : `${hiddenCount} winners hidden by their profile settings`}
                        </p>
                      )}
                    </div>
                  ) : hiddenCount > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {hiddenCount === 1
                        ? "Winning user hidden by profile settings"
                        : `${hiddenCount} winning users hidden by profile settings`}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No entries this round.</p>
                  )}
                  {(totalPool != null || totalEntries != null || (tied != null && tied > 1)) && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      {totalEntries != null && (
                        <span className="mr-2">
                          {totalEntries} {totalEntries === 1 ? "entry" : "entries"}
                        </span>
                      )}
                      {totalPool != null && (
                        <span className="mr-2">
                          Pool {formatVox(totalPool)}
                        </span>
                      )}
                      {tied != null && tied > 1 && (
                        <span>Split {tied} ways</span>
                      )}
                    </p>
                  )}
                </div>
              );
            })()}
          </Card>
        )}

        {/* "Outcomes" / "Final pool split" card. Uses staked Vox
            as the historical signal. While the AMM market is open the
            Live Market panel above renders the same info using LMSR
            prices, so we suppress this card. On resolved markets we
            keep the historical Vox-staked view ("Final pool split")
            since `entriesWithPercentages` is AMM-aware and the
            headline flips accordingly. */}
        {!isJackpotMarket && !(isAmm && isOpen) && (
        <Card className="p-5 mb-6" data-testid="section-outcomes">
          {/* On open markets the percentages are an investing signal
              (live crowd odds). Once resolved they're a historical
              record of how Vox ended up split, not your payout.
              The heading + helper text + per-row "of pool" suffix all
              flip together so the page can't be skim-read as "winning
              outcomes ranked by likelihood". */}
          <h2 className="text-lg font-serif font-bold mb-1 flex items-center gap-2">
            <Target className="h-5 w-5 text-violet-700 dark:text-violet-500" />
            {isClosedMarket ? "Final pool split" : "Outcomes"}
          </h2>
          {isClosedMarket ? (
            <p className="text-xs text-muted-foreground mb-4">
              These percentages show how the crowd staked their Vox before close — not the official outcome or your payout.
              {isResolved ? " Official winners are pinned to the top." : ""}
            </p>
          ) : (
            <div className="mb-4" />
          )}
          {effectiveOpenMarketType === "binary" && (
            <BinaryOutcomes
              entries={entriesWithPercentages}
              selectedEntry={selectedEntry}
              onSelect={setSelectedEntry}
              disabled={!isOpen}
              isResolved={isResolved}
            />
          )}
          {effectiveOpenMarketType === "multi" && (
            <MultiOutcomes
              entries={entriesWithPercentages}
              selectedEntry={selectedEntry}
              onSelect={setSelectedEntry}
              disabled={!isOpen}
              isResolved={isResolved}
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
              isResolved={isResolved}
            />
          )}
        </Card>
        )}

        <div className={`grid grid-cols-2 ${isAmm ? "sm:grid-cols-3" : "sm:grid-cols-4"} gap-3 mb-6`} data-testid="section-stats">
          {!isAmm && (
            <Card className="p-3 text-center">
              <Zap className="h-4 w-4 text-violet-700 dark:text-violet-500 mx-auto mb-1" />
              <p className="text-lg font-bold font-mono" data-testid="text-total-pool">{formatNumber(totalPool)}</p>
              <p className="text-xs text-muted-foreground">Total Pool</p>
            </Card>
          )}
          <Card className="p-3 text-center">
            <Users className="h-4 w-4 text-violet-700 dark:text-violet-500 mx-auto mb-1" />
            <p className="text-lg font-bold font-mono" data-testid="text-total-participants">{formatNumber(totalParticipants)}</p>
            <p className="text-xs text-muted-foreground">{isAmm ? "Traders" : "Participants"}</p>
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
          <>
            <button
              type="button"
              onClick={() => setCommentsSheetOpen(true)}
              className="w-full flex items-center justify-between rounded-xl border border-border/50 bg-card p-4 mb-6 md:hidden focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-cyan-700 dark:text-cyan-500" />
                <span className="text-sm font-semibold">Discussion</span>
                <span className="text-xs text-muted-foreground">({marketCommentCount})</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>

            <div className="hidden md:block">
              <CardComments
                entityType="open-market"
                slug={params.slug || ""}
                focusContextTitle={market.title}
              />
            </div>
          </>
        )}

        {/* More like this — bottom of the page so it sits below the
            primary trade flow + discussion. Picks from the cached
            `/api/open-markets` list and biases same-category items
            to the front. */}
        <div className="mt-8">
          <RelatedMarkets
            type="community"
            currentMarketId={market.id}
            category={market.category ?? null}
          />
        </div>
      </div>

      {isCommunityMarket && (
        <>
          <button
            type="button"
            onClick={() => setCommentsSheetOpen(true)}
            className="fixed bottom-24 right-4 z-40 md:hidden flex items-center gap-1.5 rounded-full bg-violet-600 text-white px-4 py-2.5 shadow-lg focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs font-semibold">{marketCommentCount}</span>
          </button>

          <CommentsBottomSheet
            open={commentsSheetOpen}
            onOpenChange={setCommentsSheetOpen}
            entityType="open-market"
            slug={params.slug || ""}
          />
        </>
      )}

      <ImageLightbox
        open={!!expandedImage}
        src={expandedImage ?? ""}
        alt={market.title}
        onClose={() => setExpandedImage(null)}
        zIndexClass="z-50"
      />

      {/* StakeModal for community AMM markets — buy only. The buy
          flow is opened from per-entry buttons inside the Live Market
          card above; cash-out lives in the CashOutSheet below. Jackpot
          markets use their own inline form and never reach this
          modal. */}
      <StakeModal
        open={stakeModalOpen}
        onClose={() => {
          setStakeModalOpen(false);
          setPendingSelection(null);
        }}
        selection={pendingSelection}
        onConfirm={handleConfirmStakeFromModal}
        walletBalance={walletBalance}
        liveAmmState={market?.ammState ?? null}
        onDirectionChange={(dir) => {
          if (!pendingSelection) return;
          if (pendingSelection.type !== "community") return;
          if (effectiveOpenMarketType === "binary") return;
          if (dir !== "yes" && dir !== "no") return;
          const entry = market?.entries?.find((e) => e.id === pendingSelection.entryId);
          if (!entry) return;
          const livePrice = ammPriceMap ? Number(ammPriceMap[entry.id] ?? 0) : 0;
          const crowdSentiment = Math.round(Math.max(0, Math.min(1, livePrice)) * 100);
          setPendingSelection({
            ...pendingSelection,
            choice: `${dir === "no" ? "No" : "Yes"} \u00b7 ${entry.label}`,
            direction: dir,
            crowdSentiment,
          });
        }}
      />

      <CashOutSheet
        selection={cashOutSelection}
        open={cashOutOpen}
        onClose={() => {
          setCashOutOpen(false);
          setCashOutSelection(null);
        }}
        onConfirmSell={handleConfirmCashOut}
        liveAmmState={market?.ammState ?? null}
      />
    </div>
  );
}
