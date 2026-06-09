import { PersonAvatar } from "@/components/PersonAvatar";
import { cn } from "@/lib/utils";

/**
 * Joined rank-cell + avatar container, shared by Rankings, Web Sentiment, and
 * the home LeaderboardRow pattern.
 */
export function LeaderboardRankAvatar({
  rank,
  name,
  avatar,
  imageSlug,
  className,
}: {
  rank: number;
  name: string;
  avatar: string | null;
  imageSlug?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center rounded-lg overflow-hidden shrink-0",
        className,
      )}
      data-testid="leaderboard-rank-avatar"
    >
      <div className="flex items-center justify-center min-w-[32px] sm:min-w-[36px] h-12 lg:h-[58px] rounded-l-lg bg-muted border-r border-border dark:border-transparent dark:bg-[#101318]">
        <span className="font-mono font-semibold text-muted-foreground dark:text-slate-400 text-[16px] sm:text-[18px] tabular-nums">
          {rank}
        </span>
      </div>
      <PersonAvatar
        name={name}
        avatar={avatar}
        imageSlug={imageSlug ?? undefined}
        size="md"
        className="h-12 w-12 lg:h-[58px] lg:w-[58px] rounded-none rounded-r-md"
      />
    </div>
  );
}
