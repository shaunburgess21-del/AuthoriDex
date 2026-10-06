import { Check } from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS } from "@/lib/sentimentPollVoteDisplay";
import { cn } from "@/lib/utils";
import type { RankedCandidate } from "./types";

interface CandidateTileProps {
  candidate: RankedCandidate;
  voted: boolean;
  onOpen: () => void;
}

/** Portrait tile for the browse grid; tapping opens the spotlight. */
export function CandidateTile({ candidate, voted, onOpen }: CandidateTileProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      data-testid={`tile-induction-${candidate.id}`}
    >
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-xl bg-muted/40 ring-1 transition-all duration-200",
          voted ? "ring-[#00C853]/50" : "ring-border/50 group-hover:ring-cyan-500/60",
          "group-hover:shadow-lg group-hover:shadow-cyan-500/10",
        )}
      >
        <div className="absolute inset-0 transition-transform duration-300 group-hover:scale-105 motion-reduce:group-hover:scale-100 [&_*]:!rounded-none">
          <PersonAvatar
            name={candidate.displayName}
            avatar={candidate.avatar}
            imageSlug={candidate.imageSlug}
            imageContext="induction"
            className="h-full w-full text-xl"
          />
        </div>
        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm">
          #{candidate.rank}
        </span>
        {voted && (
          <span
            className={cn(
              "absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full shadow-md",
              SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS,
            )}
            aria-label="You voted"
          >
            <Check className="h-3 w-3 text-white" />
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug transition-colors group-hover:text-cyan-600 dark:group-hover:text-cyan-300">
        {candidate.displayName}
      </p>
      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {candidate.seedVotes.toLocaleString("en-US")} {candidate.seedVotes === 1 ? "vote" : "votes"}
      </p>
    </button>
  );
}
