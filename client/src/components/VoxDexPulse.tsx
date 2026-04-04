import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, LayoutGroup } from "framer-motion";
import {
  Zap, ThumbsUp, TrendingUp, TrendingDown,
  Play, Pause, Info, ChevronDown,
} from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { TrendScoreInfoContent } from "@/components/TrendScoreInfo";
import { ApprovalRatingInfoContent } from "@/components/ApprovalRatingInfo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";

// --------------- Types ---------------

interface PulsePerson {
  id: string;
  name: string;
  category: string;
  imageSlug: string | null;
  trendScore?: number;
  change24h?: number | null;
  sparkline?: number[];
  approvalAvgRating?: number | null;
  approvalVotesCount?: number | null;
}

interface TrendResponse {
  people: PulsePerson[];
  series: Record<string, { timestamp: string; trendScore: number }[]>;
  availableCategories?: string[];
}
interface ApprovalResponse {
  people: PulsePerson[];
  availableCategories?: string[];
}

interface RankedPerson extends PulsePerson {
  score: number;
}

interface PulseFrame {
  timestamp: string;
  label: string;
  rankings: RankedPerson[];
}

type ApprovalRatingKey = "1" | "2" | "3" | "4" | "5";

interface ApprovalBreakdown {
  personId: string;
  totalVotes: number;
  counts: Record<ApprovalRatingKey, number>;
  percentages: Record<ApprovalRatingKey, number>;
}

// --------------- Constants ---------------

type PulseMode = "trend" | "approval";
type TimeRange = "48h" | "7D" | "14D" | "30D" | "90D";

const TIME_RANGES: { key: TimeRange; days: number }[] = [
  { key: "48h", days: 2 },
  { key: "7D", days: 7 },
  { key: "14D", days: 14 },
  { key: "30D", days: 30 },
  { key: "90D", days: 90 },
];

const CATEGORIES = [
  "All", "Tech", "Business", "Politics", "Sports",
  "Music", "Film & TV", "Gaming", "Creator", "Food & Drink", "Lifestyle",
] as const;

const CATEGORY_HEX: Record<string, string> = {
  tech: "#1E90FF", music: "#EC4899", politics: "#94A3B8", business: "#B8860B",
  sports: "#FB923C", "film-tv": "#A855F7", gaming: "#7C3AED", creator: "#FACC15",
  "food-drink": "#D97706", lifestyle: "#DB2777", misc: "#94A3B8",
};

const APPROVAL_COLORS = ["#FF0000", "#FF6D00", "#FFC400", "#76FF03", "#00C853"];

const MIN_SPEED = 1000;
const MAX_SPEED = 3000;
/** Default ~10% from Slow (left); center was 50% = 2000ms */
const DEFAULT_SPEED = Math.round(MAX_SPEED - 0.1 * (MAX_SPEED - MIN_SPEED));
const MAX_FRAMES = 100;

// --------------- Helpers ---------------

function getCategoryHex(category: string): string {
  return CATEGORY_HEX[normalizeMarketCategory(category)] ?? "#94A3B8";
}

function formatScore(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

function getRankColor(rank: number, mode: PulseMode): string {
  const base = mode === "trend" ? [59, 130, 246] : [34, 211, 238];
  const fade = Math.min((rank - 1) / 9, 1);
  const opacity = 1 - fade * 0.6;
  return `rgba(${base[0]}, ${base[1]}, ${base[2]}, ${opacity})`;
}

function formatFrameDate(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${months[d.getMonth()]} ${d.getDate()}, ${h12}${ampm}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function buildFrames(people: PulsePerson[], series: Record<string, { timestamp: string; trendScore: number }[]>): PulseFrame[] {
  const tsSet = new Set<string>();
  Object.values(series).forEach(arr => arr.forEach(pt => tsSet.add(pt.timestamp)));
  const allTs = Array.from(tsSet).sort();
  if (allTs.length === 0) return [];

  const step = Math.max(1, Math.floor(allTs.length / MAX_FRAMES));
  const sampled = allTs.filter((_, i) => i % step === 0);
  if (sampled[sampled.length - 1] !== allTs[allTs.length - 1]) {
    sampled.push(allTs[allTs.length - 1]);
  }

  const personSeriesMap: Record<string, { timestamp: string; trendScore: number }[]> = {};
  for (const person of people) {
    personSeriesMap[person.id] = series[person.id] ?? [];
  }

  return sampled.map(ts => {
    const rankings: RankedPerson[] = people.map(person => {
      const pSeries = personSeriesMap[person.id];
      let score = 0;
      for (let i = pSeries.length - 1; i >= 0; i--) {
        if (pSeries[i].timestamp <= ts) {
          score = pSeries[i].trendScore;
          break;
        }
      }
      return { ...person, score };
    });
    rankings.sort((a, b) => b.score - a.score);
    return { timestamp: ts, label: formatFrameDate(ts), rankings };
  });
}

// --------------- MiniSparkline ---------------

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 48;
  const h = 18;
  const pad = 1;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const trending = data[data.length - 1] >= data[0];
  const color = trending ? "#22C55E" : "#EF4444";

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="hidden sm:block shrink-0" aria-hidden>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      <circle
        cx={points[points.length - 1].split(",")[0]}
        cy={points[points.length - 1].split(",")[1]}
        r={2}
        fill={color}
      />
    </svg>
  );
}

// --------------- SpeedSlider ---------------

function SpeedSlider({
  speed,
  onChange,
  accentColor,
}: {
  speed: number;
  onChange: (ms: number) => void;
  accentColor: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pct = ((MAX_SPEED - speed) / (MAX_SPEED - MIN_SPEED)) * 100;

  const updateFromPointer = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newSpeed = MAX_SPEED - ratio * (MAX_SPEED - MIN_SPEED);
    onChange(Math.round(newSpeed));
  }, [onChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX);
  }, [updateFromPointer]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    updateFromPointer(e.clientX);
  }, [updateFromPointer]);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Slow</span>
      <div
        ref={trackRef}
        className="relative w-20 sm:w-24 h-5 flex items-center cursor-pointer touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="absolute inset-x-0 h-1 rounded-full bg-muted/40" />
        <div
          className="absolute left-0 h-1 rounded-full"
          style={{ width: `${pct}%`, backgroundColor: accentColor }}
        />
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-2 shadow-md -translate-x-1/2"
          style={{ left: `${pct}%`, backgroundColor: accentColor, borderColor: "rgba(255,255,255,0.9)" }}
        />
      </div>
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Fast</span>
    </div>
  );
}

// --------------- PulseRow ---------------

function PulseRow({
  person,
  rank,
  mode,
  maxScore,
  onNavigate,
  approvalBreakdown,
  onApprovalSegmentTap,
  showLiveDetails,
}: {
  person: RankedPerson;
  rank: number;
  mode: PulseMode;
  maxScore: number;
  onNavigate: () => void;
  approvalBreakdown?: ApprovalBreakdown | null;
  onApprovalSegmentTap?: (rating: number, person: RankedPerson) => void;
  showLiveDetails: boolean;
}) {
  const isTrend = mode === "trend";
  const score = person.score;
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  const accentColor = getRankColor(rank, mode);
  const catHex = getCategoryHex(person.category ?? "");
  const change = person.change24h;
  const hasChange = showLiveDetails && isTrend && change != null && !isNaN(change);
  const isPositive = (change ?? 0) >= 0;
  const approvalSegmentPercents = (() => {
    const fallback = [0, 0, 0, 0, 0];
    if (!approvalBreakdown || approvalBreakdown.totalVotes <= 0) return fallback;
    const p = [
      approvalBreakdown.percentages["1"],
      approvalBreakdown.percentages["2"],
      approvalBreakdown.percentages["3"],
      approvalBreakdown.percentages["4"],
      approvalBreakdown.percentages["5"],
    ];
    const sum = p.reduce((acc, val) => acc + val, 0);
    if (sum <= 0) return fallback;
    const adjusted = [...p];
    adjusted[4] = Number(Math.max(0, adjusted[4] + (100 - sum)).toFixed(2));
    return adjusted;
  })();

  const sharedRowClasses = "flex items-center gap-0 w-full py-[5px] transition-colors hover:bg-muted/20 group relative";

  if (isTrend) {
    return (
      <motion.button
        layout="position"
        onClick={onNavigate}
        className={sharedRowClasses}
        animate={{ opacity: 1 }}
        transition={{
          layout: { type: "spring", damping: 30, stiffness: 350 },
          opacity: { duration: 0.25 },
        }}
      >
        <div className="relative flex items-center shrink-0">
          <div className="flex items-center justify-center w-[26px] sm:w-7 self-stretch rounded-l-md bg-transparent">
            <span className="font-mono font-bold text-slate-400 text-[14px] text-center tabular-nums">
              {rank}
            </span>
          </div>
          <PersonAvatar
            name={person.name}
            imageSlug={person.imageSlug}
            size="sm"
            className="h-10 w-10 shrink-0 rounded-none rounded-r-md"
          />
        </div>

        <div className="flex flex-col min-w-0 shrink-0 w-[100px] sm:w-[132px] ml-1.5 sm:ml-2">
          <span className="font-medium text-xs sm:text-sm text-foreground truncate leading-tight text-left">
            {person.name}
          </span>
          <span className="text-[10px] sm:text-xs font-medium leading-tight mt-0.5 truncate text-left" style={{ color: catHex }}>
            {getMarketCategoryLabel(person.category)}
          </span>
        </div>

        <div className="flex-1 h-2 sm:h-2.5 bg-muted/20 rounded-full overflow-hidden min-w-0 mx-1.5 sm:mx-2">
          <motion.div
            className="h-full rounded-full"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            style={{ backgroundColor: accentColor }}
          />
        </div>

        <span
          className="text-xs sm:text-sm font-bold tabular-nums shrink-0 text-right pr-2 sm:pr-3"
          style={{ color: accentColor }}
        >
          {formatScore(score)}
        </span>

        {showLiveDetails && person.sparkline && person.sparkline.length >= 2 && (
          <MiniSparkline data={person.sparkline} />
        )}

        {hasChange && (
          <span
            className={`hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium tabular-nums shrink-0 mr-2 ${
              isPositive ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
            }`}
          >
            {isPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {isPositive ? "+" : ""}{change!.toFixed(1)}%
          </span>
        )}
      </motion.button>
    );
  }

  return (
    <motion.div
      layout="position"
      className={sharedRowClasses}
      animate={{ opacity: 1 }}
      transition={{
        layout: { type: "spring", damping: 30, stiffness: 350 },
        opacity: { duration: 0.25 },
      }}
    >
      {/* Rank + Avatar block */}
      <button
        type="button"
        onClick={onNavigate}
        className="relative flex items-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
        aria-label={`View ${person.name} profile`}
      >
        <div className="flex items-center justify-center w-[26px] sm:w-7 self-stretch rounded-l-md bg-transparent">
          <span className="font-mono font-bold text-slate-400 text-[14px] text-center tabular-nums">
            {rank}
          </span>
        </div>
        <PersonAvatar
          name={person.name}
          imageSlug={person.imageSlug}
          size="sm"
          className="h-10 w-10 shrink-0 rounded-none rounded-r-md"
        />
      </button>

      {/* Name + category */}
      <button
        type="button"
        onClick={onNavigate}
        className="flex flex-col min-w-0 shrink-0 w-[100px] sm:w-[132px] ml-1.5 sm:ml-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-sm"
      >
        <span className="font-medium text-xs sm:text-sm text-foreground truncate leading-tight text-left">
          {person.name}
        </span>
        <span className="text-[10px] sm:text-xs font-medium leading-tight mt-0.5 truncate text-left" style={{ color: catHex }}>
          {getMarketCategoryLabel(person.category)}
        </span>
      </button>

      {/* Score/Approval bar */}
      <div className="flex-1 h-2 sm:h-2.5 bg-muted/20 rounded-full overflow-hidden min-w-0 mx-1.5 sm:mx-2 border border-white/5">
        <motion.div
          className="h-full rounded-full overflow-hidden"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <div className="flex h-full w-full">
            {approvalSegmentPercents.map((segmentPct, index) => {
              const rating = index + 1;
              return (
                <button
                  key={rating}
                  type="button"
                  className="h-full transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  style={{
                    width: `${segmentPct}%`,
                    backgroundColor: APPROVAL_COLORS[index],
                    borderRight: index < 4 ? "1px solid rgba(15, 23, 42, 0.45)" : "none",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onApprovalSegmentTap?.(rating, person);
                  }}
                  aria-label={`${person.name} rating ${rating} segment`}
                />
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Score value */}
      <span
        className="text-xs sm:text-sm font-bold tabular-nums shrink-0 text-right pr-2 sm:pr-3"
        style={{ color: APPROVAL_COLORS[Math.min(4, Math.max(0, Math.round(person.approvalAvgRating ?? 3) - 1))] }}
      >
        {(person.approvalAvgRating ?? 0).toFixed(1)}<span style={{ color: "#A3A7B0" }}>/5</span>
      </span>

    </motion.div>
  );
}

// --------------- Main Component ---------------

interface VoxDexPulseProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function VoxDexPulse({ collapsed, onToggle }: VoxDexPulseProps) {
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<PulseMode>("trend");
  const [timeRange, setTimeRange] = useState<TimeRange>("48h");
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("All");
  const [isPlaying, setIsPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [limit, setLimit] = useState(10);
  const [autoStarted, setAutoStarted] = useState(false);
  const [approvalBreakdownCache, setApprovalBreakdownCache] = useState<Record<string, ApprovalBreakdown>>({});
  const [selectedSegmentInsight, setSelectedSegmentInsight] = useState<{
    personId: string;
    personName: string;
    category: string;
    rating: number;
    count: number;
    totalVotes: number;
    percentage: number;
  } | null>(null);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const wasPlayingBeforeSeekRef = useRef(false);

  const catParam = category === "All" ? "" : category;
  const days = TIME_RANGES.find((t) => t.key === timeRange)?.days ?? 2;

  // ---------- Data Fetching ----------

  const {
    data: trendData,
    isLoading: trendLoading,
    isError: trendIsError,
    error: trendQueryError,
    refetch: refetchTrend,
  } = useQuery<TrendResponse>({
    queryKey: ["/api/pulse/trend-history", days, limit, catParam],
    queryFn: async () => {
      const res = await fetch(`/api/pulse/trend-history?days=${days}&limit=${limit}&category=${catParam}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 3 * 60_000,
    placeholderData: (prev) => prev,
    enabled: mode === "trend",
  });

  const {
    data: approvalData,
    isLoading: approvalLoading,
    isError: approvalIsError,
    error: approvalQueryError,
    refetch: refetchApproval,
  } = useQuery<ApprovalResponse>({
    queryKey: ["/api/pulse/approval-current", limit, catParam],
    queryFn: async () => {
      const res = await fetch(`/api/pulse/approval-current?limit=${limit}&category=${catParam}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 3 * 60_000,
    placeholderData: (prev) => prev,
    enabled: mode === "approval",
  });

  // ---------- Derived ----------

  const isLoading = mode === "trend" ? trendLoading : approvalLoading;
  const pulseIsError = mode === "trend" ? trendIsError : approvalIsError;
  const pulseErr = mode === "trend" ? trendQueryError : approvalQueryError;
  const pulseErrorMessage = pulseErr instanceof Error ? pulseErr.message : "Something went wrong";
  const livePeople = mode === "trend" ? trendData?.people ?? [] : approvalData?.people ?? [];

  const liveRankings: RankedPerson[] = useMemo(() =>
    livePeople.map(p => ({
      ...p,
      score: mode === "trend"
        ? (p.trendScore ?? 0)
        : (p.approvalVotesCount ?? 0),
    })),
    [livePeople, mode]
  );

  const frames = useMemo(() => {
    if (mode !== "trend" || !trendData?.series) return [];
    return buildFrames(trendData.people, trendData.series);
  }, [mode, trendData]);

  const hasFrames = frames.length > 1;

  const currentRankings = useMemo(() => {
    if (mode === "trend" && hasFrames && frameIndex < frames.length) {
      return frames[frameIndex].rankings;
    }
    return liveRankings;
  }, [mode, hasFrames, frames, frameIndex, liveRankings]);

  const maxScore = useMemo(() => {
    if (mode === "approval") {
      return Math.max(...liveRankings.map(p => p.score), 1);
    }
    if (hasFrames) {
      let m = 1;
      for (const f of frames) for (const r of f.rankings) if (r.score > m) m = r.score;
      return m;
    }
    return Math.max(...liveRankings.map(p => p.score), 1);
  }, [mode, hasFrames, frames, liveRankings]);

  const accentColor = mode === "trend" ? "#3B82F6" : "#22D3EE";

  const visibleCategories = useMemo(() => {
    const apiCategories = mode === "trend"
      ? trendData?.availableCategories
      : approvalData?.availableCategories;
    const present = new Set(apiCategories ?? currentRankings.map(p => p.category).filter(Boolean));
    return CATEGORIES.filter(c => c === "All" || present.has(c));
  }, [mode, trendData?.availableCategories, approvalData?.availableCategories, currentRankings]);

  useEffect(() => {
    if (category !== "All" && !visibleCategories.includes(category)) {
      setCategory("All");
    }
  }, [category, visibleCategories]);

  // ---------- Playback ----------

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
  }, []);

  const startPlayback = useCallback((fromStart = true) => {
    if (!hasFrames) return;
    if (fromStart) setFrameIndex(0);
    setIsPlaying(true);
  }, [hasFrames]);

  const togglePause = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
    } else if (hasFrames) {
      if (frameIndex >= frames.length - 1) setFrameIndex(0);
      setIsPlaying(true);
    }
  }, [isPlaying, hasFrames, frameIndex, frames.length]);

  useEffect(() => {
    if (!isPlaying || frames.length === 0) {
      if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
      return;
    }
    playRef.current = setInterval(() => {
      setFrameIndex(prev => {
        if (prev >= frames.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, speed);
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [isPlaying, frames.length, speed]);

  useEffect(() => {
    stopPlayback();
    setFrameIndex(0);
    setAutoStarted(false);
  }, [mode, category, timeRange]);

  useEffect(() => {
    if (collapsed) stopPlayback();
  }, [collapsed]);

  useEffect(() => {
    if (mode === "trend" && hasFrames && !autoStarted && !trendLoading) {
      setAutoStarted(true);
      setSpeed(DEFAULT_SPEED);
      setFrameIndex(0);
      setIsPlaying(true);
    }
  }, [mode, hasFrames, autoStarted, trendLoading]);

  // ---------- Render ----------

  const isTimelapse = mode === "trend" && hasFrames;
  const currentFrameLabel = isTimelapse && frameIndex < frames.length
    ? frames[frameIndex].label
    : null;

  const progressPct = isTimelapse && frames.length > 1
    ? (frameIndex / (frames.length - 1)) * 100
    : 0;

  const startLabel = frames.length > 0 ? formatShortDate(frames[0].timestamp) : "";
  const endLabel = frames.length > 0 ? formatShortDate(frames[frames.length - 1].timestamp) : "";

  const clientXToFrameIndex = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track || frames.length <= 1) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.min(frames.length - 1, Math.round(ratio * (frames.length - 1)));
  }, [frames.length]);

  const handleSeekPointerDown = useCallback((e: React.PointerEvent) => {
    if (frames.length <= 1) return;
    e.preventDefault();
    wasPlayingBeforeSeekRef.current = isPlaying;
    setIsPlaying(false);
    setFrameIndex(clientXToFrameIndex(e.clientX));

    const onMove = (ev: PointerEvent) => {
      const next = clientXToFrameIndex(ev.clientX);
      if (next >= 0 && next < frames.length) setFrameIndex(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (wasPlayingBeforeSeekRef.current) setIsPlaying(true);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [frames.length, isPlaying, clientXToFrameIndex]);

  const approvalRatings = useMemo(() => {
    if (mode !== "approval") return {};
    const map: Record<string, number> = {};
    for (const p of livePeople) {
      map[p.id] = p.approvalAvgRating ?? 0;
    }
    return map;
  }, [mode, livePeople]);

  const fetchApprovalBreakdown = useCallback(async (personId: string): Promise<ApprovalBreakdown | null> => {
    if (approvalBreakdownCache[personId]) return approvalBreakdownCache[personId];
    try {
      const res = await fetch(`/api/pulse/approval-breakdown/${personId}`);
      if (!res.ok) throw new Error("Failed to fetch approval breakdown");
      const payload = await res.json() as ApprovalBreakdown;
      setApprovalBreakdownCache((prev) => ({ ...prev, [personId]: payload }));
      return payload;
    } catch (error) {
      console.error("Failed to fetch approval breakdown:", error);
      return null;
    }
  }, [approvalBreakdownCache]);

  const handleApprovalSegmentTap = useCallback(async (rating: number, person: RankedPerson) => {
    const cached = approvalBreakdownCache[person.id] ?? null;
    const breakdown = cached ?? await fetchApprovalBreakdown(person.id);
    const key = String(rating) as ApprovalRatingKey;
    const count = breakdown?.counts?.[key] ?? 0;
    const totalVotes = breakdown?.totalVotes ?? 0;
    const percentage = totalVotes > 0 ? Number(((count / totalVotes) * 100).toFixed(1)) : 0;

    setSelectedSegmentInsight({
      personId: person.id,
      personName: person.name,
      category: person.category,
      rating,
      count,
      totalVotes,
      percentage,
    });
  }, [approvalBreakdownCache, fetchApprovalBreakdown]);

  useEffect(() => {
    if (mode !== "approval") return;
    for (const person of livePeople) {
      if (!approvalBreakdownCache[person.id]) {
        void fetchApprovalBreakdown(person.id);
      }
    }
  }, [mode, livePeople, approvalBreakdownCache, fetchApprovalBreakdown]);

  const insightOpen = selectedSegmentInsight !== null;
  const insightColor = selectedSegmentInsight
    ? APPROVAL_COLORS[Math.max(0, Math.min(4, selectedSegmentInsight.rating - 1))]
    : APPROVAL_COLORS[2];

  return (
    <section className="container mx-auto px-4 max-w-7xl pt-2 pb-0 mb-6">
      <div className="rounded-xl pulse-card-voxdex transition-all duration-200">
        <div className={`p-4 ${collapsed ? 'pt-4 pb-4' : 'pt-5'}`}>
          {/* Header row — always visible */}
          <div
            className="flex items-center gap-3 cursor-pointer select-none group"
            onClick={onToggle}
          >
            <div className="h-9 w-9 rounded-lg flex items-center justify-center pulse-icon-voxdex">
              <Zap className="h-4 w-4 text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-slate-100">Vox Pulse</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                {mode === "trend" ? "Trend Score" : "Approval Rating"}
              </p>
            </div>
            <div className={`h-6 w-6 rounded-md flex items-center justify-center bg-slate-700/30 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
              <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
            </div>
          </div>

          {/* Body — only when expanded */}
          {!collapsed && (
          <div className="flex flex-col mt-4" data-voxdex-pulse-widget>

      <div className="order-2 flex flex-col gap-2 mb-2">
        {pulseIsError && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
            role="alert"
          >
            <span className="text-muted-foreground">
              Could not load pulse data{pulseErrorMessage ? `: ${pulseErrorMessage}` : ""}.
            </span>
            <button
              type="button"
              onClick={() => void (mode === "trend" ? refetchTrend() : refetchApproval())}
              className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
              Retry
            </button>
          </div>
        )}

        {/* Single row on desktop (Speed right of Pause); wraps on mobile so Top sits left of 48h */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center rounded-lg bg-muted/50 p-0.5 shrink-0">
            <button
              onClick={() => setMode("trend")}
              className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === "trend" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              {mode === "trend" && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#3C83F6]" />}
              <Zap className={`h-3.5 w-3.5 ${mode === "trend" ? "text-[#3C83F6]" : ""}`} />
              Trend Score
            </button>
            <button
              onClick={() => setMode("approval")}
              className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === "approval" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              {mode === "approval" && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[#22D3EE]" />}
              <ThumbsUp className={`h-3.5 w-3.5 ${mode === "approval" ? "text-[#22D3EE]" : ""}`} />
              Approval Rating
            </button>
          </div>
          <TouchTooltip
            content={mode === "trend" ? <TrendScoreInfoContent /> : <ApprovalRatingInfoContent />}
            side="bottom"
            align="end"
            contentClassName="max-w-[280px]"
            showCloseButton
          >
            <span className="inline-flex shrink-0">
              <Info
                className={`h-4 w-4 cursor-help shrink-0 ${mode === "trend" ? "text-[#3C83F6]/60" : "text-[#22D3EE]/60"}`}
                data-testid="icon-pulse-info"
              />
            </span>
          </TouchTooltip>

          {mode === "trend" && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {TIME_RANGES.map(r => {
                const isActive = timeRange === r.key;
                return (
                  <button
                    key={r.key}
                    onClick={() => setTimeRange(r.key)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all backdrop-blur shrink-0 ${
                      isActive
                        ? "bg-blue-500/20 text-blue-300 border border-blue-400/50 shadow-[0_0_8px_rgba(59,130,246,0.15)]"
                        : "bg-muted/40 border border-border/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                  >
                    {r.key}
                  </button>
                );
              })}
              {hasFrames && (
                <button
                  onClick={togglePause}
                  className="flex items-center justify-center h-7 w-7 rounded-lg bg-blue-500/20 border border-blue-400/50 text-blue-400 hover:bg-blue-500/30 transition-all shadow-[0_0_8px_rgba(59,130,246,0.15)] shrink-0"
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
                </button>
              )}
            </div>
          )}
          {mode === "trend" && isTimelapse && (
            <div className="hidden sm:flex min-w-[140px] max-w-[200px] shrink-0 basis-[180px]">
              <SpeedSlider speed={speed} onChange={setSpeed} accentColor={accentColor} />
            </div>
          )}
        </div>
      </div>

      {/* Category filter only (Top N is in top row beside 48h) */}
      <div className="order-5 sm:order-3 flex items-center gap-1.5 overflow-x-auto scrollbar-hide mt-2 sm:mt-0 mb-2">
        {visibleCategories.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all ${
              category === cat
                ? mode === "trend"
                  ? "bg-blue-500/20 text-blue-300 border border-blue-400/40"
                  : "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40"
                : "bg-muted/40 border border-border/40 text-muted-foreground hover:bg-muted/60"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {isTimelapse && (
        <div className="order-6 flex flex-col items-center pb-2 sm:hidden">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
            Playback speed
          </span>
          <SpeedSlider speed={speed} onChange={setSpeed} accentColor={accentColor} />
        </div>
      )}

      {/* Timelapse seek bar (interactive) */}
      {isTimelapse && frames.length > 1 && (
        <div className="order-3 sm:order-4 flex items-center gap-2 mb-2 px-0.5">
          <span className="text-[9px] text-muted-foreground font-medium tabular-nums shrink-0">{startLabel}</span>
          <div
            ref={trackRef}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={frames.length - 1}
            aria-valuenow={frameIndex}
            aria-label="Timelapse position"
            tabIndex={0}
            className="flex-1 min-h-[12px] flex items-center cursor-pointer touch-none select-none rounded-full overflow-hidden bg-muted/30"
            onPointerDown={handleSeekPointerDown}
          >
            <motion.div
              className="h-full min-h-[4px] w-0 rounded-full pointer-events-none shrink-0"
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: isPlaying ? speed / 1000 : 0, ease: "linear" }}
              style={{ backgroundColor: accentColor }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground font-medium tabular-nums shrink-0">{endLabel}</span>
        </div>
      )}

      {/* Leaderboard card */}
      <div className="order-4 sm:order-5 rounded-xl border border-border/50 bg-card/50 backdrop-blur overflow-hidden">
        {isLoading ? (
          <div className="h-[280px] flex items-center justify-center">
            <div className="text-center">
              <div
                className="inline-block h-5 w-5 animate-spin rounded-full border-[2px] border-solid border-r-transparent"
                style={{ borderColor: `${accentColor} transparent ${accentColor} ${accentColor}` }}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">Loading...</p>
            </div>
          </div>
        ) : currentRankings.length === 0 ? (
          <div className="h-[160px] flex items-center justify-center">
            <p className="text-xs text-muted-foreground">
              {mode === "approval" ? "No approval ratings yet" : "No trend data available"}
            </p>
          </div>
        ) : (
          <div>
            {/* Header row */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                {currentFrameLabel
                  ? `Trending \u00B7 ${currentFrameLabel}`
                  : `${mode === "trend" ? "Top Trending" : "Most Voted"} \u00B7 ${category === "All" ? "All" : category}`
                }
              </span>
              <div className="flex items-center gap-2">
                <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                  <SelectTrigger
                    className="h-6 w-[66px] text-[10px] bg-muted/50 border-border/40 rounded-md gap-1 px-1.5 shrink-0"
                    data-testid="select-pulse-top-n"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 30, 40, 50, 60, 70, 80, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        Top {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium hidden sm:block">
                  {mode === "trend"
                    ? "Score"
                    : "Votes \u00B7 Rating"
                  }
                </span>
              </div>
            </div>

            {/* Rows */}
            <LayoutGroup>
              {currentRankings.map((person, idx) => (
                <PulseRow
                  key={person.id}
                  person={mode === "approval" ? { ...person, score: person.score, approvalAvgRating: approvalRatings[person.id] ?? person.approvalAvgRating } : person}
                  rank={idx + 1}
                  mode={mode}
                  maxScore={maxScore}
                  onNavigate={() => navigate(`/person/${person.id}`)}
                  approvalBreakdown={mode === "approval" ? approvalBreakdownCache[person.id] ?? null : null}
                  onApprovalSegmentTap={mode === "approval" ? handleApprovalSegmentTap : undefined}
                  showLiveDetails={mode === "trend" && !isPlaying && frameIndex >= (frames.length > 0 ? frames.length - 1 : 0)}
                />
              ))}
            </LayoutGroup>
          </div>
        )}
      </div>

          </div>
          )}
        </div>
      </div>

      {isMobile ? (
        <Drawer open={insightOpen} onOpenChange={(open) => { if (!open) setSelectedSegmentInsight(null); }}>
          <DrawerContent className="px-4 pb-6 pt-3">
            <DrawerTitle className="sr-only">Approval Segment Insight</DrawerTitle>
            <DrawerDescription className="sr-only">
              Breakdown for selected approval rating segment
            </DrawerDescription>

            {selectedSegmentInsight && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-card/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {selectedSegmentInsight.personName} · {getMarketCategoryLabel(selectedSegmentInsight.category)}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <h4 className="text-lg font-semibold text-foreground">Rating {selectedSegmentInsight.rating}/5</h4>
                    <span className="rounded-full px-2 py-1 text-xs font-semibold text-white" style={{ backgroundColor: insightColor }}>
                      {selectedSegmentInsight.percentage.toFixed(1)}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedSegmentInsight.count.toLocaleString()} votes out of {selectedSegmentInsight.totalVotes.toLocaleString()} total
                  </p>
                </div>
              </div>
            )}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={insightOpen} onOpenChange={(open) => { if (!open) setSelectedSegmentInsight(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogTitle>Approval Segment Insight</DialogTitle>
            <DialogDescription>
              Real vote distribution for the selected rating segment
            </DialogDescription>

            {selectedSegmentInsight && (
              <div className="space-y-3">
                <div className="rounded-xl border border-border/60 bg-card/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {selectedSegmentInsight.personName} · {getMarketCategoryLabel(selectedSegmentInsight.category)}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <h4 className="text-base font-semibold text-foreground">Rating {selectedSegmentInsight.rating}/5</h4>
                    <span className="rounded-full px-2 py-1 text-xs font-semibold text-white" style={{ backgroundColor: insightColor }}>
                      {selectedSegmentInsight.percentage.toFixed(1)}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedSegmentInsight.count.toLocaleString()} votes out of {selectedSegmentInsight.totalVotes.toLocaleString()} total
                  </p>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
