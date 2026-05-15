import { Badge } from "@/components/ui/badge";
import { getRankConfig } from "@/lib/gamification-content";

interface UserRankBadgeProps {
  /** Rank name as stored on `profiles.rank`. Unknown values fall back to Citizen. */
  rank: string;
  /** Use a slightly smaller text scale for tight surfaces (e.g. user menu). */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Single source of truth for rendering a user's rank badge anywhere
 * in the client. Replaces three near-duplicate `RankBadge` components
 * (MePage, PublicProfilePage, UserMenu) that each carried their own
 * stale dictionary and silently dropped tiers introduced after the
 * file was first written (most notably VoxMax Legend).
 *
 * The hex colour comes from shared/rank-config.ts so a tier rebalance
 * propagates to every surface in one edit. We render it via inline
 * CSS variables so the contained background/text/border tokens can
 * stay theme-aware (light + dark) without spinning a Tailwind colour
 * for every rank.
 */
export function UserRankBadge({ rank, size = "md", className = "" }: UserRankBadgeProps) {
  const config = getRankConfig(rank);
  const Icon = config.icon;

  // Use the rank colour with low alpha for the surface and full
  // opacity for the icon + text. This keeps every rank visually
  // distinct without leaning on Tailwind palette names that have to
  // be re-curated when the ladder rebalances.
  const tintBg = hexToRgba(config.color, 0.18);
  const tintBorder = hexToRgba(config.color, 0.4);

  return (
    <Badge
      variant="outline"
      className={`gap-1.5 ${size === "sm" ? "text-xs px-2 py-0.5" : "px-3 py-1"} ${className}`}
      style={{
        backgroundColor: tintBg,
        borderColor: tintBorder,
        color: config.color,
      }}
    >
      <Icon className="h-3 w-3" />
      <span className="font-medium">{config.name}</span>
    </Badge>
  );
}

/**
 * Tiny hex → rgba helper. Lives here (instead of a generic utils
 * file) because UserRankBadge is the only consumer today; promote
 * if a second caller appears.
 */
function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
