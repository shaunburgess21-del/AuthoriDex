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

// sm is the canonical pill at every placement. Mobile dimensions match the
// Credits pill geometry; desktop dimensions (md: breakpoint) match the
// sub-header "My Votes" / "My Positions" button height.
// md and lg kept for future use (e.g. profile hero).
const SIZE = {
  sm: {
    pad: "px-2.5 py-1.5 md:px-3 md:py-1 md:min-h-8",
    text: "text-sm md:text-xs",
    icon: 14,
    gap: "gap-1.5",
  },
  md: { pad: "px-3 py-1.5", text: "text-sm", icon: 14, gap: "gap-2" },
  lg: { pad: "px-4 py-2", text: "text-base", icon: 16, gap: "gap-2.5" },
} as const;

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
  // Transparent silver outline matching the loaded state.
  const widthCh = sizeKey === "sm" ? "w-[88px]" : sizeKey === "md" ? "w-[104px]" : "w-[120px]";
  return (
    <div
      className={`inline-flex items-center rounded-md border border-slate-300/30 bg-transparent ${s.pad} ${widthCh} animate-pulse`}
      aria-hidden="true"
    />
  );
}

// Understated silver outline. Transparent background, silver border, silver
// icon + text. Tier-specific identity lives only in the tier-8 iridescent edge.

export function XpPill({ size = "sm", className = "" }: XpPillProps) {
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
  const rankColor = stats.rank?.color ?? "#6B7280";
  const tier = stats.rank?.tier ?? 1;
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
          className={`relative inline-flex items-center rounded-md border border-slate-300/60 bg-transparent text-slate-300 font-mono font-bold tabular-nums ${s.pad} ${s.text} ${s.gap} cursor-pointer transition-colors hover:border-slate-200/80 hover:text-slate-200 active:brightness-95 focus:outline-none focus:ring-2 focus:ring-slate-300/40 ${className}`}
          data-testid="xp-pill"
        >
          <Icon
            aria-hidden="true"
            className="text-slate-300"
            style={{ height: s.icon, width: s.icon }}
          />
          <span>{xp.toLocaleString("en-US")} XP</span>

          {/* Tier 8 — VoxMax Legend iridescent edge. Static, no animation. */}
          {tier === 8 && (
            <span
              style={{
                position: "absolute",
                inset: -1,
                borderRadius: "inherit",
                padding: 1,
                background:
                  "conic-gradient(from 180deg, #E5E4E2, #A8A9AD, #F5F5F7, #D0D0D4, #E5E4E2)",
                WebkitMask:
                  "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                WebkitMaskComposite: "xor",
                maskComposite: "exclude",
                pointerEvents: "none",
              }}
              aria-hidden="true"
            />
          )}
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
            style={{ color: rankColor, height: 24, width: 24 }}
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
