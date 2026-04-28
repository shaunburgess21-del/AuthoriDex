import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDetailNavigation } from "@/hooks/useDetailNavigation";
import type { VoteListNavType } from "@/lib/voteListNavigation";

export function VoteDetailNavCluster({
  listType,
  slug,
}: {
  listType: VoteListNavType;
  slug: string | undefined;
}) {
  const { showNav, total, currentIndex, goPrev, goNext, prevSlug, nextSlug } = useDetailNavigation(
    slug,
    listType,
  );

  if (!showNav) return null;

  return (
    // gap-1.5 (was gap-1) keeps the chevrons from kissing the
    // count text. Buttons are 36px (h-9 w-9) — the Apple HIG
    // minimum tap target — so thumb taps don't slip onto an
    // adjacent control. min-w-[3.5rem] on the count fits "X of XXX"
    // without flexing the cluster width when the user swipes
    // through a long list.
    <div className="flex items-center gap-1.5 justify-self-center">
      <button
        type="button"
        aria-label="Previous in list"
        disabled={!prevSlug}
        onClick={goPrev}
        className="h-9 w-9 rounded-lg border border-border/60 flex items-center justify-center bg-transparent hover:bg-muted/30 hover:border-border transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-border/60"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-xs text-muted-foreground font-medium tabular-nums px-0.5 min-w-[3.5rem] text-center">
        {currentIndex} of {total}
      </span>
      <button
        type="button"
        aria-label="Next in list"
        disabled={!nextSlug}
        onClick={goNext}
        className="h-9 w-9 rounded-lg border border-border/60 flex items-center justify-center bg-transparent hover:bg-muted/30 hover:border-border transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-border/60"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
