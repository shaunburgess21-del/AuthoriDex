import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, LayoutGroup } from "framer-motion";
import {
  Zap, ThumbsUp, TrendingUp, TrendingDown,
  Play, Pause,
} from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
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
}
interface ApprovalResponse { people: PulsePerson[] }

interface RankedPerson extends PulsePerson {
  score: number;
}

interface PulseFrame {
  timestamp: string;
  label: string;
  rankings: RankedPerson[];
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

const MIN_SPEED = 60;
const MAX_SPEED = 2000;
const DEFAULT_SPEED = 1000;
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

function buildApprovalGradient(rating: number): string {
  const r = Math.max(1, Math.min(5, Math.round(rating)));
  const colors = APPROVAL_COLORS.slice(0, r);
  if (colors.length === 1) return colors[0];
  const stops = colors.map((c, i) => `${c} ${(i / (colors.length - 1)) * 100}%`).join(", ");
  return `linear-gradient(90deg, ${stops})`;
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
  onClick,
  showLiveDetails,
}: {
  person: RankedPerson;
  rank: number;
  mode: PulseMode;
  maxScore: number;
  onClick: () => void;
  showLiveDetails: boolean;
}) {
  const isTrend = mode === "trend";
  const isApproval = mode === "approval";
  const score = person.score;
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  const accentColor = getRankColor(rank, mode);
  const catHex = getCategoryHex(person.category ?? "");
  const change = person.change24h;
  const hasChange = showLiveDetails && isTrend && change != null && !isNaN(change);
  const isPositive = (change ?? 0) >= 0;

  const barStyle = isApproval
    ? { background: buildApprovalGradient(person.approvalAvgRating ?? 0) }
    : { backgroundColor: accentColor };

  return (
    <motion.button
      layout="position"
      onClick={onClick}
      className="flex items-center gap-0 w-full py-[5px] transition-colors hover:bg-muted/20 group relative"
      animate={{ opacity: 1 }}
      transition={{
        layout: { type: "spring", damping: 30, stiffness: 350 },
        opacity: { duration: 0.25 },
      }}
    >
      {/* Rank + Avatar block (matches leaderboard style) */}
      <div className="relative flex items-center shrink-0">
        <div
          className="flex items-center justify-center w-[24px] sm:w-[28px] self-stretch rounded-l-md bg-transparent"
        >
          <span className="font-mono font-semibold text-slate-400 text-[13px] sm:text-[15px]">
            {rank}
          </span>
        </div>
        <PersonAvatar
          name={person.name}
          imageSlug={person.imageSlug}
          size="sm"
          className="h-[26px] w-[26px] sm:h-[30px] sm:w-[30px] rounded-none rounded-r-md"
        />
      </div>

      {/* Name + category (left aligned beside avatar) */}
      <div className="flex flex-col min-w-0 shrink-0 w-[85px] sm:w-[120px] ml-2 sm:ml-3">
        <span className="text-[11px] sm:text-[13px] font-semibold text-foreground truncate leading-tight text-left">
          {person.name}
        </span>
        <span className="text-[9px] sm:text-[10px] font-medium leading-tight mt-0.5 truncate text-left" style={{ color: catHex }}>
          {getMarketCategoryLabel(person.category)}
        </span>
      </div>

      {/* Score bar */}
      <div className="flex-1 h-2 sm:h-2.5 bg-muted/20 rounded-full overflow-hidden min-w-0 mx-2 sm:mx-3">
        <motion.div
          className="h-full rounded-full"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          style={barStyle}
        />
      </div>

      {/* Score value */}
      <span
        className="text-[11px] sm:text-[13px] font-bold tabular-nums shrink-0 text-right pr-2 sm:pr-3"
        style={{ color: isApproval ? APPROVAL_COLORS[Math.min(4, Math.max(0, Math.round(person.approvalAvgRating ?? 3) - 1))] : accentColor }}
      >
        {isTrend
          ? formatScore(score)
          : `${(person.approvalAvgRating ?? 0).toFixed(1)}/5`
        }
      </span>

      {/* Sparkline (live trend, desktop only) */}
      {showLiveDetails && isTrend && person.sparkline && person.sparkline.length >= 2 && (
        <MiniSparkline data={person.sparkline} />
      )}

      {/* 24h change badge (live trend only) */}
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

// --------------- Main Component ---------------

export function VoxDexPulse() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<PulseMode>("trend");
  const [timeRange, setTimeRange] = useState<TimeRange>("48h");
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("All");
  const [isPlaying, setIsPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [autoStarted, setAutoStarted] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const catParam = category === "All" ? "" : category;
  const days = TIME_RANGES.find(t => t.key === timeRange)!.days;

  // ---------- Data Fetching ----------

  const { data: trendData, isLoading: trendLoading } = useQuery<TrendResponse>({
    queryKey: ["/api/pulse/trend-history", days, catParam],
    queryFn: async () => {
      const res = await fetch(`/api/pulse/trend-history?days=${days}&limit=10&category=${catParam}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 3 * 60_000,
    enabled: mode === "trend",
  });

  const { data: approvalData, isLoading: approvalLoading } = useQuery<ApprovalResponse>({
    queryKey: ["/api/pulse/approval-current", catParam],
    queryFn: async () => {
      const res = await fetch(`/api/pulse/approval-current?limit=10&category=${catParam}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 3 * 60_000,
    enabled: mode === "approval",
  });

  // ---------- Derived ----------

  const isLoading = mode === "trend" ? trendLoading : approvalLoading;
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

  const approvalRatings = useMemo(() => {
    if (mode !== "approval") return {};
    const map: Record<string, number> = {};
    for (const p of livePeople) {
      map[p.id] = p.approvalAvgRating ?? 0;
    }
    return map;
  }, [mode, livePeople]);

  return (
    <section className="container mx-auto px-4 max-w-7xl pt-4 pb-2 flex flex-col">
      {/* Section label */}
      <p className="order-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-2">
        VoxDex Pulse
      </p>

      {/* Controls row */}
      <div className="order-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
        {/* Mode toggle */}
        <div className="inline-flex items-center rounded-lg bg-muted/50 p-0.5 shrink-0">
          <button
            onClick={() => setMode("trend")}
            className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              mode === "trend" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
            }`}
          >
            {mode === "trend" && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-blue-500" />}
            <Zap className={`h-3.5 w-3.5 ${mode === "trend" ? "text-blue-400" : ""}`} />
            Trend Score
          </button>
          <button
            onClick={() => setMode("approval")}
            className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              mode === "approval" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
            }`}
          >
            {mode === "approval" && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-cyan-400" />}
            <ThumbsUp className={`h-3.5 w-3.5 ${mode === "approval" ? "text-cyan-400" : ""}`} />
            Approval Rating
          </button>
        </div>

        {/* Time range toggles (trend only) */}
        {mode === "trend" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {TIME_RANGES.map(r => {
              const isActive = timeRange === r.key;
              return (
                <button
                  key={r.key}
                  onClick={() => setTimeRange(r.key)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all backdrop-blur ${
                    isActive
                      ? "bg-blue-500/20 text-blue-300 border border-blue-400/50 shadow-[0_0_8px_rgba(59,130,246,0.15)]"
                      : "bg-muted/40 border border-border/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {r.key}
                </button>
              );
            })}

            {/* Play/Pause */}
            {hasFrames && (
              <button
                onClick={togglePause}
                className="flex items-center justify-center h-7 w-7 rounded-lg bg-blue-500/20 border border-blue-400/50 text-blue-400 hover:bg-blue-500/30 transition-all shadow-[0_0_8px_rgba(59,130,246,0.15)]"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
              </button>
            )}

            {/* Speed control -- desktop only (mobile version rendered below card) */}
            {isTimelapse && (
              <div className="hidden sm:flex">
                <SpeedSlider speed={speed} onChange={setSpeed} accentColor={accentColor} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category filter -- below controls on desktop, below card on mobile */}
      <div className="order-5 sm:order-3 flex items-center gap-1.5 overflow-x-auto scrollbar-hide mt-2 sm:mt-0 mb-2">
        {CATEGORIES.map(cat => (
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

      {/* Timelapse progress bar */}
      {isTimelapse && frames.length > 1 && (
        <div className="order-3 sm:order-4 flex items-center gap-2 mb-2 px-0.5">
          <span className="text-[9px] text-muted-foreground font-medium tabular-nums shrink-0">{startLabel}</span>
          <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: speed / 1000, ease: "linear" }}
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
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium hidden sm:block">
                {mode === "trend"
                  ? "Score"
                  : "Votes \u00B7 Rating"
                }
              </span>
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
                  onClick={() => navigate(`/person/${person.id}`)}
                  showLiveDetails={mode === "trend" && !isPlaying && frameIndex >= (frames.length > 0 ? frames.length - 1 : 0)}
                />
              ))}
            </LayoutGroup>
          </div>
        )}
      </div>

      {/* Speed slider -- mobile only, below card + categories */}
      {isTimelapse && (
        <div className="order-6 sm:hidden flex justify-center mt-2">
          <SpeedSlider speed={speed} onChange={setSpeed} accentColor={accentColor} />
        </div>
      )}
    </section>
  );
}
