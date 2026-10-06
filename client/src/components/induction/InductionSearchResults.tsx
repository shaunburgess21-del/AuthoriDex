import { Fragment } from "react";
import { Link } from "wouter";
import { Check, ChevronRight, Sparkles, UserPlus, Vote } from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { foldText, highlightRanges, queryTokens } from "@/lib/inductionSearch";
import { SENTIMENT_POLL_SUPPORT_BUTTON_COMPACT_CLASS } from "@/lib/sentimentPollVoteDisplay";
import { cn } from "@/lib/utils";
import type { RankedCandidate } from "./types";

export interface LeaderboardMatch {
  id: string;
  name: string;
  avatar: string | null;
  imageSlug?: string | null;
  rank: number;
  category: string | null;
}

interface InductionSearchResultsProps {
  query: string;
  results: RankedCandidate[];
  /** Rows rendered before "keep typing" kicks in. */
  limit: number;
  leaderboardMatches: LeaderboardMatch[];
  activeIndex: number;
  isVoted: (id: string) => boolean;
  onOpen: (index: number) => void;
  onVote: (id: string) => void;
  onSuggest: () => void;
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  const ranges = highlightRanges(name, queryTokens(query));
  if (ranges.length === 0) return <>{name}</>;
  const parts: JSX.Element[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) parts.push(<Fragment key={`t${i}`}>{name.slice(cursor, r.start)}</Fragment>);
    parts.push(
      <span key={`h${i}`} className="text-cyan-600 dark:text-cyan-300">
        {name.slice(r.start, r.end)}
      </span>,
    );
    cursor = r.end;
  });
  if (cursor < name.length) parts.push(<Fragment key="tail">{name.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}

export function InductionSearchResults({
  query,
  results,
  limit,
  leaderboardMatches,
  activeIndex,
  isVoted,
  onOpen,
  onVote,
  onSuggest,
}: InductionSearchResultsProps) {
  const trimmed = query.trim();
  const shown = results.slice(0, limit);
  const hiddenCount = results.length - shown.length;
  const nothingFound = results.length === 0 && leaderboardMatches.length === 0;
  const folded = foldText(trimmed);
  const exactMatch =
    results.some((c) => foldText(c.displayName) === folded) ||
    leaderboardMatches.some((p) => foldText(p.name) === folded);

  if (nothingFound) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-cyan-500/40 bg-cyan-500/[0.04] px-6 py-10 text-center dark:border-cyan-500/30">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10">
          <UserPlus className="h-7 w-7 text-cyan-600 dark:text-cyan-400" />
        </div>
        <h3 className="text-lg font-semibold">&ldquo;{trimmed}&rdquo; isn&apos;t in the queue yet</h3>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          Be the one to nominate them. Once approved, they join the queue and everyone can vote them onto the leaderboard.
        </p>
        <button
          type="button"
          onClick={onSuggest}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-cyan-500 px-5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all hover:bg-cyan-400 active:scale-[0.98]"
          data-testid="button-suggest-search-miss"
        >
          <UserPlus className="h-4 w-4" />
          Suggest {trimmed}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {results.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            In the queue · {results.length}
          </h2>
          <ul className="space-y-1.5" aria-label="Induction candidates">
            {shown.map((candidate, index) => {
              const voted = isVoted(candidate.id);
              const active = index === activeIndex;
              return (
                <li
                  key={candidate.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-xl border pr-2 transition-colors",
                    active
                      ? "border-cyan-500/50 bg-cyan-500/[0.07]"
                      : "border-transparent hover:border-border/60 hover:bg-muted/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(index)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-2 pl-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                    data-testid={`result-induction-${candidate.id}`}
                  >
                    <div className="shrink-0 overflow-hidden rounded-lg [&_*]:!rounded-none">
                      <PersonAvatar
                        name={candidate.displayName}
                        avatar={candidate.avatar}
                        imageSlug={candidate.imageSlug}
                        imageContext="induction"
                        className="h-12 w-12"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        <HighlightedName name={candidate.displayName} query={trimmed} />
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {candidate.category} · #{candidate.rank} · {candidate.seedVotes.toLocaleString("en-US")}{" "}
                        {candidate.seedVotes === 1 ? "vote" : "votes"}
                      </p>
                    </div>
                  </button>
                  {voted ? (
                    <span
                      className={cn(
                        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold",
                        SENTIMENT_POLL_SUPPORT_BUTTON_COMPACT_CLASS,
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Voted
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onVote(candidate.id)}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-700 transition-colors hover:bg-cyan-500/20 dark:text-cyan-300"
                      aria-label={`Vote to induct ${candidate.displayName}`}
                      data-testid={`button-quick-vote-${candidate.id}`}
                    >
                      <Vote className="h-3.5 w-3.5" />
                      Vote
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 && (
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              +{hiddenCount} more — keep typing to narrow it down
            </p>
          )}
        </section>
      )}

      {leaderboardMatches.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-blue-500" />
            Already on the leaderboard
          </h2>
          <ul className="space-y-1.5">
            {leaderboardMatches.map((person) => (
              <li key={person.id}>
                <Link
                  href={`/person/${person.id}`}
                  className="flex items-center gap-3 rounded-xl border border-transparent p-2 transition-colors hover:border-border/60 hover:bg-muted/40"
                  data-testid={`leaderboard-match-${person.id}`}
                >
                  <div className="shrink-0 overflow-hidden rounded-lg [&_*]:!rounded-none">
                    <PersonAvatar
                      name={person.name}
                      avatar={person.avatar}
                      imageSlug={person.imageSlug}
                      className="h-10 w-10"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      <HighlightedName name={person.name} query={trimmed} />
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Ranked #{person.rank} on the live leaderboard
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!exactMatch && (
        <button
          type="button"
          onClick={onSuggest}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-cyan-500/40 p-3 text-left transition-colors hover:border-cyan-500/70 hover:bg-cyan-500/[0.05] dark:border-cyan-500/30"
          data-testid="button-suggest-from-results"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
            <UserPlus className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Not who you&apos;re looking for?</span>
            <span className="block truncate text-xs text-muted-foreground">
              Suggest &ldquo;{trimmed}&rdquo; for the Induction Queue
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
