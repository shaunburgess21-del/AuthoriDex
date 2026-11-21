import { MessageSquare, Swords, ThumbsUp, Vote, type LucideIcon } from "lucide-react";
import { VOTE_FEED_CUE_LABELS, type VoteFeedKind } from "@/lib/voteMixedFeed";

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
      <span className="truncate keep-descenders">{VOTE_FEED_CUE_LABELS[kind]}</span>
    </span>
  );
}

export function VoteTypeCueIcon({ kind, className }: { kind: VoteFeedKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} aria-hidden />;
}

const SECTION_KIND: Record<string, VoteFeedKind> = {
  "Sentiment Polls": "sentiment",
  Matchups: "matchup",
  "Opinion Polls": "opinion",
  "Overall Rating": "rating",
};

export function voteSectionCueKind(section: string): VoteFeedKind | null {
  return SECTION_KIND[section] ?? null;
}
