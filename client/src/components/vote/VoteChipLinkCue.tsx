import { useEffect, useRef } from "react";
import { VoteTypeCueIcon } from "@/components/vote/VoteTypeCue";
import type { VoteChipLinkCue } from "@/lib/voteChipLinkCue";

/**
 * Small pill under a vote section heading. The header positions it
 * absolutely, so mounting it does not change the row height.
 * Hidden from md (768px) up. aria-hidden so a screen reader is not
 * told about a cue that repeats the heading.
 */
export function VoteChipLinkCuePill({
  cue,
  onDone,
}: {
  cue: VoteChipLinkCue;
  onDone: () => void;
}) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const timeout = window.setTimeout(() => onDoneRef.current(), 2100);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <span
      className="vote-chip-link-cue pointer-events-none absolute left-3 top-10 z-20 inline-flex w-max max-w-[calc(100vw-8.5rem)] items-center gap-1 whitespace-nowrap rounded-full border border-cyan-500/40 bg-background px-1.5 py-1 text-[11px] font-medium leading-none text-foreground shadow-sm md:hidden"
      data-testid={`vote-chip-link-cue-${cue.kind}`}
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        onDoneRef.current();
      }}
    >
      <VoteTypeCueIcon kind={cue.kind} className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span>{cue.text}</span>
    </span>
  );
}
