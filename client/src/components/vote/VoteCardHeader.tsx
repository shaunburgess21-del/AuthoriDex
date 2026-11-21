import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { VoteTypeCue } from "@/components/vote/VoteTypeCue";
import type { VoteFeedKind } from "@/lib/voteMixedFeed";

/**
 * Top row of a vote card: comments on the left, category chip on the right.
 *
 * With a type cue, the row is three tracks. The side tracks are equal
 * (`1fr`), so the cue sits on the card's centre line whichever end is wider.
 * Those tracks may shrink (`minmax(0, 1fr)`) and clip, which keeps a long
 * chip off the cue on a 320px screen. The cue itself stays full width
 * (`min-w-max`) — "Head-to-head" does not ellipsize to make room.
 *
 * Without a cue, the row stays the original space-between pair.
 */
export function VoteCardHeader({
  leading,
  trailing,
  kind,
  className,
}: {
  leading: ReactNode;
  trailing?: ReactNode;
  kind?: VoteFeedKind | null;
  className?: string;
}) {
  if (!kind) {
    return (
      <div className={cn("mb-3 flex items-center justify-between gap-2", className)}>
        {leading}
        {trailing}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mb-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2",
        className,
      )}
      data-testid={`vote-card-header-${kind}`}
    >
      <div className="flex min-w-0 items-center overflow-hidden">{leading}</div>
      <div className="pointer-events-none flex min-w-max items-center justify-center">
        <VoteTypeCue kind={kind} />
      </div>
      <div className="flex min-w-0 items-center justify-end overflow-hidden [&_button]:max-w-full [&_button]:min-w-0">
        {trailing}
      </div>
    </div>
  );
}
