import { MessageSquare, Swords, ThumbsUp, Vote, type LucideIcon } from "lucide-react";
import {
  voteSectionHeadingPrefix,
  VOTE_FEED_CUE_LABELS,
  type VoteFeedKind,
} from "@/lib/voteMixedFeed";

const ICONS: Record<VoteFeedKind, LucideIcon> = {
  matchup: Swords,
  sentiment: MessageSquare,
  opinion: Vote,
  rating: ThumbsUp,
};

/** Grey icon + one word. Sits in the existing header row so the card does not grow. */
export function VoteTypeCue({ kind }: { kind: VoteFeedKind }) {
  const Icon = ICONS[kind];
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 text-[11px] leading-none text-muted-foreground"
      data-testid={`vote-type-cue-${kind}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{VOTE_FEED_CUE_LABELS[kind]}</span>
    </span>
  );
}

export function VoteTypeCueIcon({ kind, className }: { kind: VoteFeedKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} aria-hidden />;
}

export function voteSectionCueKind(section: string): VoteFeedKind | null {
  return voteSectionHeadingPrefix(section)?.kind ?? null;
}

/**
 * Section title with the matching chip's icon and cue in front of the name.
 * The cue group stays on one line so the separator wraps with the prefix,
 * and the section name can break onto the next line.
 */
export function VoteSectionHeading({ title }: { title: string }) {
  const cue = voteSectionHeadingPrefix(title);
  if (!cue) return title;
  return (
    <>
      <span
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium text-muted-foreground"
        data-testid={`vote-section-cue-${cue.kind}`}
      >
        <VoteTypeCueIcon kind={cue.kind} className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span>{cue.label}</span>
        <span aria-hidden="true">·</span>
      </span>
      <span className="min-w-0" data-testid={`vote-section-name-${cue.kind}`}>{title}</span>
    </>
  );
}
