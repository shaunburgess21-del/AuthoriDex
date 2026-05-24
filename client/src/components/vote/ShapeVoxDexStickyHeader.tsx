import { Sparkles } from "lucide-react";

interface ShapeVoxDexStickyHeaderProps {
  onInfoClick?: () => void;
}

export function ShapeVoxDexStickyHeader({ onInfoClick }: ShapeVoxDexStickyHeaderProps) {
  const iconBox = (
    <Sparkles className="size-5 text-cyan-600 dark:text-cyan-400 md:size-6" />
  );

  return (
    <div
      style={{
        marginLeft: "calc(-50vw + 50%)",
        marginRight: "calc(-50vw + 50%)",
        paddingLeft: "calc(50vw - 50%)",
        paddingRight: "calc(50vw - 50%)",
      }}
      className="sticky top-16 z-[41] relative mb-6 min-h-16 border-y border-white/10 bg-background backdrop-blur-sm"
      data-testid="shape-voxdex-sticky-header"
      data-sticky-vote-bar
    >
      <div className="relative z-10 px-2 py-3 md:px-6 md:py-4">
        <div className="flex min-w-0 flex-row flex-nowrap items-center justify-center md:justify-start md:gap-4">
          <div className="flex min-w-0 shrink flex-col items-center gap-0.5 md:grid md:grid-cols-[auto_1fr] md:grid-rows-[auto_auto] md:items-center md:gap-x-3 md:gap-y-0">
            {onInfoClick ? (
              <button
                type="button"
                onClick={onInfoClick}
                className="hidden shrink-0 rounded-lg bg-cyan-500/15 md:row-span-2 md:flex md:h-full md:w-auto md:aspect-square items-center justify-center transition-colors hover:bg-cyan-500/25"
                aria-label="About community governance"
                data-testid="button-governance-info"
              >
                {iconBox}
              </button>
            ) : (
              <div
                className="hidden shrink-0 rounded-lg bg-cyan-500/15 md:row-span-2 md:flex md:h-full md:w-auto md:aspect-square items-center justify-center"
                aria-hidden
              >
                {iconBox}
              </div>
            )}
            <p className="min-w-0 truncate text-base font-semibold text-foreground text-center md:col-start-2 md:row-start-1 md:text-left md:text-lg md:font-bold">
              Shape the VoxDex
            </p>
            <p className="min-w-0 max-w-[min(100%,20rem)] truncate text-xs text-muted-foreground text-center md:hidden">
              Rate, curate, and shape the leaderboard
            </p>
            <p className="hidden min-w-0 truncate text-sm text-muted-foreground md:col-start-2 md:row-start-2 md:block md:text-left md:text-base">
              Weigh in on ratings, influence who makes the leaderboard, curate their profile images
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
