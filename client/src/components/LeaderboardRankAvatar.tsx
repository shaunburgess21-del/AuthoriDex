import type { ReactNode } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { cn } from "@/lib/utils";

/**
 * Joined rank-cell + avatar container, shared by Rankings, Web Sentiment,
 * VoxDex Pulse, and Category Race rows.
 */
export function LeaderboardRankAvatar({
  rank,
  rankSlot,
  name,
  avatar,
  imageSlug,
  size = "md",
  className,
}: {
  rank?: number;
  rankSlot?: ReactNode;
  name: string;
  avatar: string | null;
  imageSlug?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const isSm = size === "sm";
  const rankTextClass = isSm
    ? rank != null && rank >= 100
      ? "text-[10px] sm:text-[11px]"
      : "text-[13px]"
    : rank != null && rank >= 100
      ? "text-sm sm:text-[15px]"
      : "text-[16px] sm:text-[18px]";

  return (
    <div
      className={cn(
        "relative flex items-center overflow-hidden shrink-0",
        isSm ? "rounded-md" : "rounded-lg",
        className,
      )}
      data-testid="leaderboard-rank-avatar"
    >
      <div
        className={cn(
          "flex items-center justify-center self-stretch border-r border-border dark:border-transparent dark:bg-[#101318] bg-muted",
          isSm
            ? "min-w-[26px] sm:min-w-7 h-10 rounded-l-md"
            : "min-w-[32px] sm:min-w-[36px] h-12 lg:h-[58px] rounded-l-lg",
        )}
      >
        {rankSlot ?? (
          <span
            className={cn(
              "font-mono font-semibold text-muted-foreground dark:text-slate-400 tabular-nums text-center leading-none px-0.5",
              rankTextClass,
            )}
          >
            {rank}
          </span>
        )}
      </div>
      <PersonAvatar
        name={name}
        avatar={avatar}
        imageSlug={imageSlug ?? undefined}
        size={isSm ? "sm" : "md"}
        className={cn(
          "shrink-0 rounded-none rounded-r-md",
          isSm ? "h-10 w-10" : "h-12 w-12 lg:h-[58px] lg:w-[58px]",
        )}
      />
    </div>
  );
}
