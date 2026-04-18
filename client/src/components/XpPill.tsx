import { useState } from "react";
import { useUserStats, useRanks, useWeeklyXp } from "@/hooks/useGamification";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  User,
  TrendingUp,
  Eye,
  BarChart3,
  Award,
  Star,
  Crown,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface XpPillProps {
  size?: "sm" | "md" | "lg";
  variant?: "standalone" | "inline";
  className?: string;
}

const RANK_ICONS: Record<string, LucideIcon> = {
  user: User,
  "trending-up": TrendingUp,
  eye: Eye,
  "bar-chart": BarChart3,
  award: Award,
  star: Star,
  crown: Crown,
  sparkles: Sparkles,
};

type RankRow = {
  tier: number;
  name: string;
  minXp: number;
  maxXp: number | null;
  color: string;
  icon: string | null;
  description: string | null;
};

const SIZE = {
  sm: { pad: "px-2.5 py-1", text: "text-[12px]", icon: 12, gap: "gap-1.5" },
  md: { pad: "px-3 py-1.5", text: "text-[13px]", icon: 14, gap: "gap-2" },
  lg: { pad: "px-4 py-2", text: "text-[14px]", icon: 16, gap: "gap-2.5" },
} as const;

// Flat charcoal pill — stays dark in both light and dark page modes. Status object.
const PILL_STYLE: React.CSSProperties = {
  backgroundColor: "#1C1F26",
  border: "0.5px solid rgba(255, 255, 255, 0.08)",
  boxShadow: "inset 0 1px 0 0 rgba(255, 255, 255, 0.06)",
  color: "#E8E9ED",
};

// Light mode needs edge definition against a light page background.
// Matches dark mode otherwise — pill is an identity object, doesn't invert.
const PILL_STYLE_LIGHT_EDGE: React.CSSProperties = {
  ...PILL_STYLE,
  border: "0.5px solid rgba(0, 0, 0, 0.2)",
};

function getRankProgress(xp: number, ranks: RankRow[] | undefined) {
  if (!ranks || ranks.length === 0) return null;
  const sorted = [...ranks].sort((a, b) => a.tier - b.tier);
  const cur =
    sorted.find(r => xp >= r.minXp && (r.maxXp === null || xp <= r.maxXp)) ??
    sorted[0];
  const idx = sorted.indexOf(cur);
  const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;
  const pct = next ? ((xp - cur.minXp) / (next.minXp - cur.minXp)) * 100 : 100;
  return {
    current: cur,
    next,
    pct: Math.min(pct, 100),
    xpToNext: next ? next.minXp - xp : null,
  };
}

function GhostPill({ sizeKey }: { sizeKey: "sm" | "md" | "lg" }) {
  const s = SIZE[sizeKey];
  // Match pill dimensions so layout doesn't shift when stats load.
  const widthCh = sizeKey === "sm" ? "w-[88px]" : sizeKey === "md" ? "w-[104px]" : "w-[120px]";
  return (
    <div
      className={`inline-flex items-center rounded-full ${s.pad} ${widthCh} animate-pulse`}
      style={{ backgroundColor: "rgba(255, 255, 255, 0.05)", height: sizeKey === "sm" ? 24 : sizeKey === "md" ? 28 : 32 }}
      aria-hidden="true"
    />
  );
}

export function XpPill({ size = "md", className = "" }: XpPillProps) {
  const [open, setOpen] = useState(false);
  const { data: stats, isLoading: statsLoading } = useUserStats();
  const { data: ranks } = useRanks();
  const { data: weekly } = useWeeklyXp(!!stats);

  // Signed-out: render nothing at all.
  if (!statsLoading && !stats) return null;

  // Loading: ghost placeholder at full pill dimensions (no layout shift).
  if (statsLoading || !stats) {
    return <GhostPill sizeKey={size} />;
  }

  const s = SIZE[size];
  const xp = stats.xpPoints;
  const currentRankName = stats.rank?.name ?? "Citizen";
  const currentRankIconName = stats.rank?.icon ?? "user";
  const currentRankColor = stats.rank?.color ?? "#E8E9ED";
  const Icon = RANK_ICONS[currentRankIconName] ?? User;

  const progress = getRankProgress(xp, ranks as RankRow[] | undefined);
  const rankDescription = progress?.current.description ?? null;
  const dialogHeadingId = "xp-pill-rank-heading";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Open XP progress"
          aria-expanded={open}
          className={`inline-flex items-center rounded-full tabular-nums font-medium ${s.pad} ${s.text} ${s.gap} cursor-pointer transition-[filter] hover:brightness-110 active:brightness-95 focus:outline-none focus:ring-2 focus:ring-white/20 ${className}`}
          style={PILL_STYLE_LIGHT_EDGE}
          data-testid="xp-pill"
        >
          <Icon
            aria-hidden="true"
            style={{ color: currentRankColor, height: s.icon, width: s.icon }}
          />
          <span>{xp.toLocaleString("en-US")} XP</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-labelledby={dialogHeadingId}
        align="end"
        sideOffset={8}
        className="w-[320px] max-w-[calc(100vw-32px)] p-4"
      >
        {/* Rank header row */}
        <div className="flex items-center gap-2.5 mb-3">
          <Icon
            aria-hidden="true"
            className="shrink-0"
            style={{ color: currentRankColor, height: 24, width: 24 }}
          />
          <h3 id={dialogHeadingId} className="text-[18px] font-medium leading-tight flex-1 truncate">
            {currentRankName}
          </h3>
          <span className="text-xs text-muted-foreground truncate">
            @{stats.username}
          </span>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center justify-end text-xs">
            <span className="font-mono text-amber-600 dark:text-amber-400 text-[14px] font-semibold">
              {xp.toLocaleString("en-US")} XP
            </span>
          </div>
          {progress ? (
            <>
              <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground text-right">
                {progress.next && progress.xpToNext !== null
                  ? `${progress.xpToNext.toLocaleString()} XP to ${progress.next.name}`
                  : "Max rank reached"}
              </p>
            </>
          ) : (
            <div className="h-2 bg-muted/50 rounded-full overflow-hidden" />
          )}
        </div>

        <div className="border-t border-black/8 dark:border-white/8 my-3" />

        {/* This week + rank description */}
        <div className="flex items-start gap-4 mb-3">
          <div className="shrink-0">
            <p className="text-[11px] text-muted-foreground">This week</p>
            <p className="text-[15px] font-semibold text-green-600 dark:text-green-500 tabular-nums">
              {weekly ? `+${weekly.weeklyXp.toLocaleString("en-US")} XP` : "—"}
            </p>
          </div>
          {rankDescription && (
            <p className="text-[11px] text-muted-foreground leading-snug flex-1 text-right">
              {rankDescription}
            </p>
          )}
        </div>

        <div className="border-t border-black/8 dark:border-white/8 my-3" />

        {/* TODO: wire to VoxMax hub when that page ships. Intentionally inert. */}
        <button
          type="button"
          onClick={(e) => e.preventDefault()}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-view-full-progression"
        >
          View full progression →
        </button>
      </PopoverContent>
    </Popover>
  );
}

export default XpPill;
