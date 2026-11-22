import { useRanks } from "@/hooks/useGamification";
import { InfoHint } from "@/components/InfoHint";

/** Rank progress used in the avatar menu and on My Account. */
export function XPProgressBar({ xp }: { xp: number }) {
  const { data: ranks } = useRanks();

  if (!ranks || ranks.length === 0) {
    return (
      <div className="flex items-center justify-end text-xs">
        <span className="inline-flex items-center gap-1 font-mono text-amber-600 dark:text-amber-400">
          {xp.toLocaleString("en-US")} XP
          <InfoHint term="xp" side="left" className="h-3 w-3" />
        </span>
      </div>
    );
  }

  const sortedRanks = [...ranks].sort((a, b) => a.tier - b.tier);
  const currentRank =
    sortedRanks.find((r) => xp >= r.minXp && (r.maxXp === null || xp <= r.maxXp)) ??
    sortedRanks[0];
  const currentIdx = sortedRanks.indexOf(currentRank);
  const nextRank = currentIdx < sortedRanks.length - 1 ? sortedRanks[currentIdx + 1] : null;

  const rankProgress = nextRank
    ? ((xp - currentRank.minXp) / (nextRank.minXp - currentRank.minXp)) * 100
    : 100;

  return (
    <div className="space-y-1.5" data-testid="xp-progress-bar">
      <div className="flex items-center justify-end text-xs">
        <span className="inline-flex items-center gap-1 font-mono text-amber-600 dark:text-amber-400">
          {xp.toLocaleString("en-US")} XP
          <InfoHint term="xp" side="left" className="h-3 w-3" />
        </span>
      </div>
      <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(rankProgress, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground text-right">
        {nextRank
          ? `${(nextRank.minXp - xp).toLocaleString()} XP to ${nextRank.name}`
          : "Max rank reached"}
      </p>
    </div>
  );
}
