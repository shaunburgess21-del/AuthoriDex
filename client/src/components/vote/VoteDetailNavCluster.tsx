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
    <div className="flex items-center gap-1 justify-self-center">
      <button
        type="button"
        aria-label="Previous in list"
        disabled={!prevSlug}
        onClick={goPrev}
        className="p-2 rounded-lg hover:bg-muted/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="text-xs text-muted-foreground font-medium tabular-nums px-0.5 min-w-[3.25rem] text-center">
        {currentIndex} of {total}
      </span>
      <button
        type="button"
        aria-label="Next in list"
        disabled={!nextSlug}
        onClick={goNext}
        className="p-2 rounded-lg hover:bg-muted/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
